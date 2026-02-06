use serde::Serialize;
use std::collections::HashSet;
use std::fs;

#[derive(Debug, Clone, Serialize)]
pub(crate) struct GitPatchPredictResult {
    ok: bool,
    message: String,
    files: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct GitCommit {
    hash: String,
    parents: Vec<String>,
    author: String,
    author_email: String,
    date: String,
    subject: String,
    refs: String,
    is_head: bool,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct GitPatchPredictGraphResult {
    ok: bool,
    message: String,
    conflict_files: Vec<String>,
    touched_files: Vec<String>,
    graph_commits: Vec<GitCommit>,
    created_node_ids: Vec<String>,
    head_name: String,
}

#[tauri::command]
pub(crate) fn git_predict_patch_graph(
    repo_path: String,
    patch_path: String,
    method: String,
    max_commits: Option<u32>,
) -> Result<GitPatchPredictGraphResult, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let patch_path = patch_path.trim().to_string();
    if patch_path.is_empty() {
        return Err(String::from("patch_path is empty"));
    }

    let method = method.trim().to_lowercase();
    if method != "apply" && method != "am" {
        return Err(String::from("method must be 'apply' or 'am'"));
    }

    crate::with_repo_git_lock(&repo_path, || {
        let max_commits = max_commits.unwrap_or(60).max(10).min(200);

        let bytes = fs::read(&patch_path).map_err(|e| format!("Failed to read patch file: {e}"))?;
        let text = String::from_utf8_lossy(&bytes).to_string();
        let touched_files = parse_touched_files_from_patch_text(text.as_str());
        let subjects = parse_patch_subjects(text.as_str(), 12);

        let diff_part = if method == "am" {
            extract_diff_part_for_apply_check(text.as_str())
        } else {
            text
        };

        let args: [&str; 4] = ["apply", "--check", "--", "-"];
        let res = crate::run_git_with_stdin(&repo_path, &args, diff_part.as_str());

        let (ok, message) = match res {
            Ok(msg) => (true, if msg.trim().is_empty() { String::from("ok") } else { msg }),
            Err(e) => (false, e),
        };
        let conflict_files = if ok {
            Vec::new()
        } else {
            parse_conflict_files_from_apply_check_message(message.as_str())
        };

        let head_name = crate::run_git(&repo_path, &["symbolic-ref", "--quiet", "--short", "HEAD"]).unwrap_or_else(|_| {
            String::from("(detached)")
        });
        let head_name = head_name.trim().to_string();

        let local_head = crate::run_git(&repo_path, &["rev-parse", "HEAD"]).unwrap_or_default().trim().to_string();

        let mut created_node_ids: Vec<String> = Vec::new();
        let mut graph_commits: Vec<GitCommit> = Vec::new();
        let mut predicted_head_id = local_head.clone();

        if !local_head.trim().is_empty() {
            if method == "am" {
                let mut last_parent = local_head.clone();
                let subs = if subjects.is_empty() {
                    vec![String::from("Apply patch (am)")]
                } else {
                    subjects
                };

                for (i, subj) in subs.iter().enumerate() {
                    let id = format!("predict:am:{}", i + 1);
                    created_node_ids.push(id.clone());
                    graph_commits.push(GitCommit {
                        hash: id.clone(),
                        parents: if last_parent.trim().is_empty() { vec![] } else { vec![last_parent.clone()] },
                        author: String::from("(predict)"),
                        author_email: String::new(),
                        date: String::new(),
                        subject: subj.clone(),
                        refs: String::new(),
                        is_head: false,
                    });
                    last_parent = id.clone();
                    predicted_head_id = id;
                }
            } else {
                let id = String::from("predict:apply");
                created_node_ids.push(id.clone());
                predicted_head_id = id.clone();
                graph_commits.push(GitCommit {
                    hash: id,
                    parents: vec![local_head.clone()],
                    author: String::from("(predict)"),
                    author_email: String::new(),
                    date: String::new(),
                    subject: String::from("Apply patch (working tree)"),
                    refs: String::new(),
                    is_head: false,
                });
            }

            let remaining = max_commits.saturating_sub(graph_commits.len() as u32);
            let mut commits = git_log_commits_multi(&repo_path, &[String::from("HEAD")], remaining)?;
            graph_commits.append(&mut commits);
        }

        for c in graph_commits.iter_mut() {
            c.is_head = c.hash == predicted_head_id;
            if c.is_head {
                c.refs = if head_name.trim().is_empty() {
                    String::from("HEAD")
                } else {
                    format!("HEAD -> {}", head_name)
                };
            } else {
                c.refs = String::new();
            }
        }

        Ok(GitPatchPredictGraphResult {
            ok,
            message,
            conflict_files,
            touched_files,
            graph_commits,
            created_node_ids,
            head_name,
        })
    })
}

fn parse_touched_files_from_patch_text(text: &str) -> Vec<String> {
    let mut files: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    for line in text.replace("\r\n", "\n").lines() {
        let l = line.trim_end();
        if let Some(rest) = l.strip_prefix("diff --git ") {
            // Example: diff --git a/foo/bar.txt b/foo/bar.txt
            let mut parts = rest.split_whitespace();
            let a = parts.next().unwrap_or_default();
            let b = parts.next().unwrap_or_default();
            let pick = if !b.is_empty() { b } else { a };
            let pick = pick.trim();
            if pick.starts_with("a/") || pick.starts_with("b/") {
                let p = pick[2..].to_string();
                if !p.trim().is_empty() && !seen.contains(&p) {
                    seen.insert(p.clone());
                    files.push(p);
                }
            }
        }
    }

    files
}

fn extract_diff_part_for_apply_check(text: &str) -> String {
    // `git apply` expects a raw diff. `git format-patch` produces an mbox-like
    // patch with headers before the diff. For predict we strip everything
    // before the first diff marker.
    let normalized = text.replace("\r\n", "\n");
    let mut start_idx: Option<usize> = None;
    let bytes = normalized.as_bytes();

    // Find first line starting with "diff --git ".
    let mut i: usize = 0;
    while i < normalized.len() {
        let line_start = i;
        while i < normalized.len() && bytes[i] != b'\n' {
            i += 1;
        }
        let line_end = i;
        let line = &normalized[line_start..line_end];
        if line.starts_with("diff --git ") {
            start_idx = Some(line_start);
            break;
        }
        i += 1; // skip '\n'
    }

    match start_idx {
        Some(idx) => normalized[idx..].to_string(),
        None => normalized,
    }
}

fn parse_patch_subjects(text: &str, max_subjects: usize) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let normalized = text.replace("\r\n", "\n");

    for line in normalized.lines() {
        if out.len() >= max_subjects {
            break;
        }
        if let Some(rest) = line.strip_prefix("Subject:") {
            let subj = rest.trim();
            if subj.is_empty() {
                continue;
            }
            if let Some(stripped) = subj.strip_prefix("[PATCH]") {
                let s2 = stripped.trim();
                if !s2.is_empty() {
                    out.push(s2.to_string());
                } else {
                    out.push(subj.to_string());
                }
            } else {
                out.push(subj.to_string());
            }
        }
    }

    out
}

fn parse_conflict_files_from_apply_check_message(message: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    fn take_path_before_colon(s: &str) -> Option<String> {
        let r = s.trim();
        if r.is_empty() {
            return None;
        }
        let bytes = r.as_bytes();

        // Handle Windows drive paths like C:\foo\bar.txt: ...
        if bytes.len() >= 3 && bytes[1] == b':' && (bytes[2] == b'\\' || bytes[2] == b'/') {
            if let Some(pos) = r[2..].find(':') {
                let i = pos + 2;
                let p = r[..i].trim();
                if p.is_empty() {
                    None
                } else {
                    Some(p.to_string())
                }
            } else {
                None
            }
        } else if let Some(pos) = r.find(':') {
            let p = r[..pos].trim();
            if p.is_empty() {
                None
            } else {
                Some(p.to_string())
            }
        } else {
            None
        }
    }

    fn is_candidate_path(p: &str) -> bool {
        let t = p.trim();
        if t.is_empty() {
            return false;
        }
        if t.chars().any(|c| c.is_whitespace()) {
            return false;
        }
        if t.eq_ignore_ascii_case("patch") {
            return false;
        }
        t.contains('.') || t.contains('/') || t.contains('\\')
    }

    for line in message.replace("\r\n", "\n").lines() {
        let mut l = line.trim();
        if let Some(rest) = l.strip_prefix("git command failed:") {
            l = rest.trim();
        }
        if let Some(rest) = l.strip_prefix("error: patch failed:") {
            let rest = rest.trim();
            if let Some(path) = take_path_before_colon(rest) {
                let path = path.trim();
                if is_candidate_path(path) && !seen.contains(path) {
                    seen.insert(path.to_string());
                    out.push(path.to_string());
                }
            }
            continue;
        }

        if let Some(rest) = l.strip_prefix("error:") {
            let rest = rest.trim();
            if rest.is_empty() {
                continue;
            }
            if let Some(path) = take_path_before_colon(rest) {
                let path = path.trim();
                if is_candidate_path(path) && !seen.contains(path) {
                    seen.insert(path.to_string());
                    out.push(path.to_string());
                }
            }
        }
    }

    out
}

fn parse_git_log_records(repo_path: &str, stdout: &str) -> Vec<GitCommit> {
    let head = crate::run_git(repo_path, &["rev-parse", "HEAD"]).unwrap_or_default();
    let head = head.trim().to_string();

    let mut commits = Vec::new();
    for record in stdout.split('\x1e') {
        let record = record.trim();
        if record.is_empty() {
            continue;
        }

        let mut parts = record.split('\x1f');
        let hash = parts.next().unwrap_or_default().to_string();
        let parents_raw = parts.next().unwrap_or_default();
        let author = parts.next().unwrap_or_default().to_string();
        let author_email = parts.next().unwrap_or_default().to_string();
        let date = parts.next().unwrap_or_default().to_string();
        let subject = parts.next().unwrap_or_default().to_string();
        let _refs = parts.next().unwrap_or_default().to_string();

        if hash.is_empty() {
            continue;
        }

        let parents = parents_raw
            .split_whitespace()
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect();

        commits.push(GitCommit {
            hash: hash.clone(),
            parents,
            author,
            author_email,
            date,
            subject,
            refs: String::new(),
            is_head: head == hash,
        });
    }
    commits
}

fn git_log_commits_multi(repo_path: &str, revs: &[String], max_count: u32) -> Result<Vec<GitCommit>, String> {
    if revs.is_empty() {
        return Ok(Vec::new());
    }

    let format = "%H\x1f%P\x1f%an\x1f%ae\x1f%ad\x1f%s\x1f%D\x1e";
    let pretty = format!("--pretty=format:{format}");

    let mut args: Vec<String> = vec![String::from("--no-pager"), String::from("log")];
    args.push(String::from("--topo-order"));
    args.push(String::from("--date=iso-strict"));
    args.push(pretty);
    args.push(String::from("-n"));
    args.push(max_count.to_string());

    for r in revs {
        let t = r.trim();
        if !t.is_empty() {
            args.push(t.to_string());
        }
    }

    let output = crate::git_command_in_repo(repo_path)
        .args(args)
        .output()
        .map_err(|e| format!("Failed to spawn git log: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stderr_lower = stderr.to_lowercase();
        if stderr_lower.contains("does not have any commits yet")
            || stderr_lower.contains("does not have any commits")
            || stderr_lower.contains("your current branch")
            || stderr_lower.contains("unknown revision")
        {
            return Ok(Vec::new());
        }
        return Err(format!("git log failed: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_git_log_records(repo_path, stdout.as_ref()))
}

#[tauri::command]
pub(crate) fn git_format_patch_to_file(repo_path: String, commit: String, out_path: String) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let commit = commit.trim().to_string();
    if commit.is_empty() {
        return Err(String::from("commit is empty"));
    }

    let out_path = out_path.trim().to_string();
    if out_path.is_empty() {
        return Err(String::from("out_path is empty"));
    }

    crate::with_repo_git_lock(&repo_path, || {
        let raw = crate::run_git_stdout_raw(&repo_path, &["format-patch", "-1", "--stdout", commit.as_str()])?;
        fs::write(&out_path, raw.as_bytes()).map_err(|e| format!("Failed to write patch file: {e}"))?;
        Ok(String::from("ok"))
    })
}

#[tauri::command]
pub(crate) fn git_predict_patch_file(repo_path: String, patch_path: String, method: String) -> Result<GitPatchPredictResult, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let patch_path = patch_path.trim().to_string();
    if patch_path.is_empty() {
        return Err(String::from("patch_path is empty"));
    }

    let method = method.trim().to_lowercase();
    if method != "apply" && method != "am" {
        return Err(String::from("method must be 'apply' or 'am'"));
    }

    crate::with_repo_git_lock(&repo_path, || {
        let bytes = fs::read(&patch_path).map_err(|e| format!("Failed to read patch file: {e}"))?;
        let text = String::from_utf8_lossy(&bytes).to_string();
        let files = parse_touched_files_from_patch_text(text.as_str());

        let diff_part = if method == "am" {
            extract_diff_part_for_apply_check(text.as_str())
        } else {
            text
        };

        // `git apply --check` returns non-zero when patch doesn't apply.
        // For `am`, we approximate by checking the diff part using `git apply --check`.
        let args: [&str; 4] = ["apply", "--check", "--", "-"];
        let res = crate::run_git_with_stdin(&repo_path, &args, diff_part.as_str());

        match res {
            Ok(msg) => Ok(GitPatchPredictResult {
                ok: true,
                message: if msg.trim().is_empty() { String::from("ok") } else { msg },
                files,
            }),
            Err(e) => Ok(GitPatchPredictResult {
                ok: false,
                message: e,
                files,
            }),
        }
    })
}

#[tauri::command]
pub(crate) fn git_apply_patch_file(repo_path: String, patch_path: String, method: String) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let patch_path = patch_path.trim().to_string();
    if patch_path.is_empty() {
        return Err(String::from("patch_path is empty"));
    }

    let method = method.trim().to_lowercase();
    if method != "apply" && method != "am" {
        return Err(String::from("method must be 'apply' or 'am'"));
    }

    crate::with_repo_git_lock(&repo_path, || {
        if method == "apply" {
            crate::run_git(&repo_path, &["apply", "--", patch_path.as_str()])
        } else {
            let rebase_apply = crate::run_git(&repo_path, &["rev-parse", "--git-path", "rebase-apply"]).unwrap_or_default();
            let rebase_apply = rebase_apply.trim();
            if !rebase_apply.is_empty() {
                let p = std::path::PathBuf::from(rebase_apply);
                let full = if p.is_absolute() { p } else { std::path::Path::new(&repo_path).join(p) };
                if full.exists() {
                    return Err(String::from(
                        "A previous 'git am' (or rebase) is still in progress. Resolve it first (Continue/Abort in Graphoria), or run: git am --abort (or git rebase --abort).",
                    ));
                }
            }
            // For `am`, we apply the mbox patch file as-is.
            // Use 3-way fallback so that when the patch doesn't apply cleanly, Git attempts
            // to create real merge conflicts (unmerged index entries). This enables Graphoria's
            // conflict resolver UI and allows choosing the patch version ("theirs").
            crate::run_git(&repo_path, &["am", "-3", "--", patch_path.as_str()])
        }
    })
}
