use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::process::Stdio;
use std::io::Write;
use std::path::{Path, PathBuf};

fn rev_exists(repo_path: &str, rev: &str) -> bool {
    crate::git_command_in_repo(repo_path)
        .args(["rev-parse", "-q", "--verify", rev])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

fn is_am_in_progress(repo_path: &str) -> bool {
    // `git am` uses `.git/rebase-apply` and creates an `applying` file.
    let apply_dir = resolve_git_path(repo_path, "rebase-apply").ok().flatten();
    if let Some(dir) = apply_dir {
        return dir.join("applying").exists();
    }
    false
}

#[tauri::command]
pub(crate) fn git_am_abort(repo_path: String) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;
    if !is_am_in_progress(&repo_path) {
        return Err(String::from("No git am in progress."));
    }
    crate::run_git(&repo_path, &["am", "--abort"])
}

#[tauri::command]
pub(crate) fn git_am_continue_with_message(repo_path: String, message: String) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;
    if !is_am_in_progress(&repo_path) {
        return Err(String::from("No git am in progress."));
    }

    // `git am` uses `.git/rebase-apply/msg` for the commit message.
    let msg = message.trim_end_matches(['\r', '\n']).to_string();
    let _ = write_git_path_text(&repo_path, "rebase-apply/msg", msg.as_str());
    let _ = write_git_path_text(&repo_path, "rebase-apply/message", msg.as_str());

    crate::run_git(&repo_path, &["am", "--continue"])
}

#[tauri::command]
pub(crate) fn git_conflict_resolve_rename(repo_path: String, path: String, keep_name: String, keep_content: String) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let path = path.trim().to_string();
    if path.is_empty() {
        return Err(String::from("path is empty"));
    }
    let keep_name = keep_name.trim().to_string();
    let keep_content = keep_content.trim().to_string();

    if keep_name != "ours" && keep_name != "theirs" {
        return Err(String::from("keep_name must be 'ours' or 'theirs'"));
    }
    if keep_content != "ours" && keep_content != "theirs" {
        return Err(String::from("keep_content must be 'ours' or 'theirs'"));
    }

    let ours_path = path.clone();
    let _ = crate::safe_repo_join(&repo_path, ours_path.as_str()).map_err(|e| format!("Invalid path: {e}"))?;

    crate::with_repo_git_lock(&repo_path, || {
        let theirs_ref = detect_theirs_ref(&repo_path).ok_or_else(|| String::from("Failed to detect their ref (MERGE_HEAD/REBASE_HEAD)."))?;
        let renames = detect_renames_against_theirs(&repo_path, theirs_ref.as_str());
        let theirs_path = renames
            .get(ours_path.as_str())
            .cloned()
            .ok_or_else(|| String::from("Failed to detect rename target for this conflict."))?;

        let _ = crate::safe_repo_join(&repo_path, theirs_path.as_str()).map_err(|e| format!("Invalid path: {e}"))?;

        let content_bytes = if keep_content == "ours" {
            crate::git_show_path_bytes_or_empty(&repo_path, ":2", ours_path.as_str())?
        } else {
            let b = crate::git_show_path_bytes_or_empty(&repo_path, ":3", ours_path.as_str())?;
            if !b.is_empty() {
                b
            } else {
                crate::git_show_path_bytes_or_empty(&repo_path, theirs_ref.as_str(), theirs_path.as_str())?
            }
        };

        if content_bytes.is_empty() {
            return Err(String::from("Failed to load selected content for rename conflict."));
        }
        let content_text = bytes_to_text_or_err(content_bytes.as_slice())?;

        let final_path = if keep_name == "ours" {
            ours_path.clone()
        } else {
            theirs_path.clone()
        };
        let remove_path = if final_path == ours_path {
            theirs_path.clone()
        } else {
            ours_path.clone()
        };

        let full_final = crate::safe_repo_join(&repo_path, final_path.as_str()).map_err(|e| format!("Invalid path: {e}"))?;
        if let Some(parent) = full_final.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent directories: {e}"))?;
        }
        fs::write(&full_final, content_text.as_bytes()).map_err(|e| format!("Failed to write file: {e}"))?;

        crate::run_git(&repo_path, &["add", "-A", "--", final_path.as_str()])?;

        crate::run_git(&repo_path, &["rm", "-f", "--ignore-unmatch", "--", remove_path.as_str()])?;

        let full_remove = crate::safe_repo_join(&repo_path, remove_path.as_str()).map_err(|e| format!("Invalid path: {e}"))?;
        if full_remove.exists() {
            if full_remove.is_dir() {
                let _ = fs::remove_dir_all(&full_remove);
            } else {
                let _ = fs::remove_file(&full_remove);
            }
        }

        Ok(String::from("ok"))
    })
}

#[tauri::command]
pub(crate) fn git_conflict_resolve_rename_with_content(
    repo_path: String,
    path: String,
    keep_name: String,
    content: String,
) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let path = path.trim().to_string();
    if path.is_empty() {
        return Err(String::from("path is empty"));
    }
    let keep_name = keep_name.trim().to_string();
    if keep_name != "ours" && keep_name != "theirs" {
        return Err(String::from("keep_name must be 'ours' or 'theirs'"));
    }

    let ours_path = path.clone();
    let _ = crate::safe_repo_join(&repo_path, ours_path.as_str()).map_err(|e| format!("Invalid path: {e}"))?;

    crate::with_repo_git_lock(&repo_path, || {
        let theirs_ref = detect_theirs_ref(&repo_path).ok_or_else(|| String::from("Failed to detect their ref (MERGE_HEAD/REBASE_HEAD)."))?;
        let renames = detect_renames_against_theirs(&repo_path, theirs_ref.as_str());
        let theirs_path = renames
            .get(ours_path.as_str())
            .cloned()
            .ok_or_else(|| String::from("Failed to detect rename target for this conflict."))?;

        let _ = crate::safe_repo_join(&repo_path, theirs_path.as_str()).map_err(|e| format!("Invalid path: {e}"))?;

        let content = content;
        if content.trim().is_empty() {
            return Err(String::from("Content is empty."));
        }

        let final_path = if keep_name == "ours" {
            ours_path.clone()
        } else {
            theirs_path.clone()
        };
        let remove_path = if final_path == ours_path {
            theirs_path.clone()
        } else {
            ours_path.clone()
        };

        let full_final = crate::safe_repo_join(&repo_path, final_path.as_str()).map_err(|e| format!("Invalid path: {e}"))?;
        if let Some(parent) = full_final.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent directories: {e}"))?;
        }
        fs::write(&full_final, content.as_bytes()).map_err(|e| format!("Failed to write file: {e}"))?;

        crate::run_git(&repo_path, &["add", "-A", "--", final_path.as_str()])?;
        crate::run_git(&repo_path, &["rm", "-f", "--ignore-unmatch", "--", remove_path.as_str()])?;

        let full_remove = crate::safe_repo_join(&repo_path, remove_path.as_str()).map_err(|e| format!("Invalid path: {e}"))?;
        if full_remove.exists() {
            if full_remove.is_dir() {
                let _ = fs::remove_dir_all(&full_remove);
            } else {
                let _ = fs::remove_file(&full_remove);
            }
        }

        Ok(String::from("ok"))
    })
}

fn detect_theirs_ref(repo_path: &str) -> Option<String> {
    for r in ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REBASE_HEAD"] {
        if rev_exists(repo_path, r) {
            return Some(r.to_string());
        }
    }
    None
}

fn parse_name_status_like_z(stdout: &[u8]) -> Vec<(String, Option<String>, String)> {
    let mut out: Vec<(String, Option<String>, String)> = Vec::new();
    let mut tokens: Vec<String> = Vec::new();
    for t in stdout.split(|c| *c == 0) {
        if t.is_empty() {
            continue;
        }
        let s = String::from_utf8_lossy(t).to_string();
        if !s.is_empty() {
            tokens.push(s);
        }
    }

    let mut i: usize = 0;
    while i < tokens.len() {
        let status = tokens[i].trim().to_string();
        i += 1;
        if status.is_empty() {
            continue;
        }

        let has_rename = status.starts_with('R') || status.starts_with('C');
        if has_rename {
            if i + 1 >= tokens.len() {
                break;
            }
            let old_path = tokens[i].to_string();
            let new_path = tokens[i + 1].to_string();
            i += 2;
            if !new_path.trim().is_empty() {
                out.push((status, if old_path.trim().is_empty() { None } else { Some(old_path) }, new_path));
            }
        } else {
            if i >= tokens.len() {
                break;
            }
            let path = tokens[i].to_string();
            i += 1;
            if !path.trim().is_empty() {
                out.push((status, None, path));
            }
        }
    }

    out
}

fn detect_renames_against_theirs(repo_path: &str, theirs_ref: &str) -> HashMap<String, String> {
    let mut out: HashMap<String, String> = HashMap::new();

    let cmd_out = crate::git_command_in_repo(repo_path)
        .args(["diff", "--name-status", "-z", "-M20%", "HEAD", theirs_ref])
        .output();
    let Ok(cmd_out) = cmd_out else {
        return out;
    };
    let ok = cmd_out.status.success() || cmd_out.status.code() == Some(1);
    if !ok {
        return out;
    }

    for (status, old_path, path) in parse_name_status_like_z(cmd_out.stdout.as_slice()) {
        if status.starts_with('R') {
            if let Some(old_path) = old_path {
                if !old_path.trim().is_empty() && !path.trim().is_empty() {
                    out.insert(old_path, path);
                }
            }
        }
    }
    out
}

fn git_file_exists_at_rev(repo_path: &str, rev: &str, path: &str) -> bool {
    let spec = format!("{rev}:{path}");
    crate::git_command_in_repo(repo_path)
        .args(["cat-file", "-e", spec.as_str()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct GitConflictFileEntry {
    status: String,
    path: String,
    stages: Vec<u8>,
}

#[tauri::command]
pub(crate) fn git_continue_info(repo_path: String) -> Result<GitContinueInfo, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let merge = crate::is_merge_in_progress(&repo_path);
    let rebase = crate::is_rebase_in_progress(&repo_path);
    let cherry = crate::is_cherry_pick_in_progress(&repo_path);
    let am = is_am_in_progress(&repo_path);
    if !merge && !rebase && !cherry && !am {
        return Err(String::from("No merge/rebase/cherry-pick/am in progress."));
    }

    let operation = if merge {
        "merge"
    } else if cherry {
        "cherry-pick"
    } else if am {
        "am"
    } else {
        "rebase"
    };

    let mut message = if operation == "merge" {
        let m = read_git_path_text(&repo_path, "MERGE_MSG")?;
        if m.trim().is_empty() {
            String::from("Merge")
        } else {
            m
        }
    } else if operation == "cherry-pick" {
        let m = read_git_path_text(&repo_path, "CHERRY_PICK_MSG")?;
        if m.trim().is_empty() {
            String::from("Cherry-pick")
        } else {
            m
        }
    } else if operation == "am" {
        // `git am` stores message in `rebase-apply/msg`.
        let m = read_git_path_text(&repo_path, "rebase-apply/msg")?;
        if m.trim().is_empty() {
            String::from("Apply patch")
        } else {
            m
        }
    } else {
        let m = read_git_path_text(&repo_path, "rebase-merge/message")?;
        if m.trim().is_empty() {
            let m2 = read_git_path_text(&repo_path, "rebase-apply/message")?;
            if m2.trim().is_empty() {
                String::from("Rebase")
            } else {
                m2
            }
        } else {
            m
        }
    };

    let files = staged_name_status(&repo_path).unwrap_or_default();

    let mut s = message.replace("\r\n", "\n");
    if !s.ends_with('\n') {
        s.push('\n');
    }
    s.push('\n');
    s.push_str("# Please enter the commit message for your changes. Lines starting\n");
    s.push_str("# with '#' will be ignored, and an empty message aborts the commit.\n");
    s.push_str("#\n");

    if operation == "merge" || operation == "cherry-pick" || operation == "am" {
        let conflicts = crate::list_unmerged_files(&repo_path);
        if !conflicts.is_empty() {
            s.push_str("# Conflicts:\n");
            for p in conflicts.iter() {
                s.push_str(format!("#\t{}\n", p).as_str());
            }
            s.push_str("#\n");
        }
    }

    if let Ok(status_text) = git_status_text(&repo_path) {
        for line in status_text.replace("\r\n", "\n").lines() {
            s.push_str("# ");
            s.push_str(line);
            s.push('\n');
        }
    }

    if !files.is_empty() {
        s.push_str("#\n");
        s.push_str("# Staged changes:\n");
        for f in files.iter() {
            s.push_str(format!("# {} {}\n", f.status, f.path).as_str());
        }
    }

    message = s;
    Ok(GitContinueInfo {
        operation: operation.to_string(),
        message,
        files,
    })
}

#[tauri::command]
pub(crate) fn git_cherry_pick_abort(repo_path: String) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;
    if !crate::is_cherry_pick_in_progress(&repo_path) {
        return Err(String::from("No cherry-pick in progress."));
    }
    crate::run_git(&repo_path, &["cherry-pick", "--abort"])
}

#[tauri::command]
pub(crate) fn git_cherry_pick_continue_with_message(repo_path: String, message: String) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;
    if !crate::is_cherry_pick_in_progress(&repo_path) {
        return Err(String::from("No cherry-pick in progress."));
    }

    // Keep message in sync with what Git expects during cherry-pick.
    // Git uses CHERRY_PICK_MSG when continuing.
    write_git_path_text(&repo_path, "CHERRY_PICK_MSG", message.as_str())?;

    // Continue without launching editor.
    let mut cmd = crate::git_command_in_repo(&repo_path);
    no_editor_env(&mut cmd);
    let out = cmd
        .args(["cherry-pick", "--continue", "--no-edit"])
        .output()
        .map_err(|e| format!("Failed to spawn git cherry-pick --continue: {e}"))?;

    let stdout = String::from_utf8_lossy(&out.stdout).trim_end().to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).trim_end().to_string();
    if out.status.success() {
        Ok(if !stdout.is_empty() { stdout } else { stderr })
    } else {
        Err(if !stderr.is_empty() { stderr } else { stdout })
    }
}

#[tauri::command]
pub(crate) fn git_continue_file_diff(repo_path: String, path: String, unified: u32) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let path = path.trim().to_string();
    if path.is_empty() {
        return Err(String::from("path is empty"));
    }
    crate::ensure_rel_path_safe(path.as_str())?;

    let u = unified.min(50);
    let unified_arg = format!("--unified={u}");
    crate::run_git_stdout_raw(
        &repo_path,
        &["diff", "--cached", "--no-color", unified_arg.as_str(), "--", path.as_str()],
    )
}

#[tauri::command]
pub(crate) fn git_continue_rename_diff(
    repo_path: String,
    old_path: String,
    new_path: String,
    unified: u32,
) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let old_path = old_path.trim().to_string();
    let new_path = new_path.trim().to_string();
    if old_path.is_empty() || new_path.is_empty() {
        return Err(String::from("old_path/new_path is empty"));
    }
    crate::ensure_rel_path_safe(old_path.as_str())?;
    crate::ensure_rel_path_safe(new_path.as_str())?;

    let u = unified.min(50);
    let unified_arg = format!("--unified={u}");
    crate::run_git_stdout_raw(
        &repo_path,
        &[
            "diff",
            "--cached",
            "--no-color",
            "-M",
            unified_arg.as_str(),
            "--",
            old_path.as_str(),
            new_path.as_str(),
        ],
    )
}

#[tauri::command]
pub(crate) fn git_merge_continue_with_message(repo_path: String, message: String) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;
    if !crate::is_merge_in_progress(&repo_path) {
        return Err(String::from("No merge in progress."));
    }

    let mut msg = message.replace("\r\n", "\n");
    if !msg.ends_with('\n') {
        msg.push('\n');
    }

    let mut child = crate::git_command_in_repo(&repo_path)
        .args(["commit", "-F", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn git commit: {e}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(msg.as_bytes())
            .map_err(|e| format!("Failed to write to git stdin: {e}"))?;
    }

    let out = child
        .wait_with_output()
        .map_err(|e| format!("Failed to wait for git: {e}"))?;

    let stdout = String::from_utf8_lossy(&out.stdout).trim_end().to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).trim_end().to_string();
    if out.status.success() {
        Ok(if !stdout.is_empty() { stdout } else { stderr })
    } else {
        Err(if !stderr.is_empty() { stderr } else { stdout })
    }
}

#[tauri::command]
pub(crate) fn git_rebase_continue_with_message(repo_path: String, message: String) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;
    if !crate::is_rebase_in_progress(&repo_path) {
        return Err(String::from("No rebase in progress."));
    }

    let merge_dir = resolve_git_path(&repo_path, "rebase-merge")?;
    let apply_dir = resolve_git_path(&repo_path, "rebase-apply")?;

    if merge_dir.as_ref().is_some_and(|p| p.exists()) {
        write_git_path_text(&repo_path, "rebase-merge/message", message.as_str())?;
    } else if apply_dir.as_ref().is_some_and(|p| p.exists()) {
        write_git_path_text(&repo_path, "rebase-apply/message", message.as_str())?;
    } else {
        // Fallback: try writing both (Git will read whichever applies).
        let _ = write_git_path_text(&repo_path, "rebase-merge/message", message.as_str());
        let _ = write_git_path_text(&repo_path, "rebase-apply/message", message.as_str());
    }

    let mut cmd = crate::git_command_in_repo(&repo_path);
    no_editor_env(&mut cmd);
    let out = cmd
        .args(["rebase", "--continue", "--no-edit"])
        .output()
        .map_err(|e| format!("Failed to spawn git rebase --continue: {e}"))?;

    if out.status.success() {
        let stdout = String::from_utf8_lossy(&out.stdout).trim_end().to_string();
        let stderr = String::from_utf8_lossy(&out.stderr).trim_end().to_string();
        return Ok(if !stdout.is_empty() { stdout } else { stderr });
    }

    let stdout = String::from_utf8_lossy(&out.stdout).trim_end().to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).trim_end().to_string();
    let msg = if !stderr.is_empty() { stderr.clone() } else { stdout.clone() };

    // Older Git versions may not support `--no-edit` for `rebase --continue`.
    // Retry without it.
    if msg.to_lowercase().contains("unknown option") || msg.to_lowercase().contains("no-edit") {
        let mut cmd2 = crate::git_command_in_repo(&repo_path);
        no_editor_env(&mut cmd2);
        let out2 = cmd2
            .args(["rebase", "--continue"])
            .output()
            .map_err(|e| format!("Failed to spawn git rebase --continue: {e}"))?;

        let stdout2 = String::from_utf8_lossy(&out2.stdout).trim_end().to_string();
        let stderr2 = String::from_utf8_lossy(&out2.stderr).trim_end().to_string();
        if out2.status.success() {
            Ok(if !stdout2.is_empty() { stdout2 } else { stderr2 })
        } else {
            Err(if !stderr2.is_empty() { stderr2 } else { stdout2 })
        }
    } else {
        Err(msg)
    }
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct GitConflictState {
    in_progress: bool,
    operation: String,
    files: Vec<GitConflictFileEntry>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct GitConflictFileVersions {
    base: Option<String>,
    ours: Option<String>,
    theirs: Option<String>,
    working: Option<String>,
    ours_path: Option<String>,
    theirs_path: Option<String>,
    ours_deleted: bool,
    theirs_deleted: bool,
    conflict_kind: String,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct GitContinueFileEntry {
    status: String,
    path: String,
    old_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct GitContinueInfo {
    operation: String,
    message: String,
    files: Vec<GitContinueFileEntry>,
}

fn parse_status_porcelain_z(stdout: &[u8]) -> HashMap<String, String> {
    let mut out: HashMap<String, String> = HashMap::new();

    let mut i: usize = 0;
    while i < stdout.len() {
        let start = i;
        while i < stdout.len() && stdout[i] != 0 {
            i += 1;
        }
        let rec = &stdout[start..i];
        i += 1;
        if rec.is_empty() {
            continue;
        }
        if rec.len() < 3 {
            continue;
        }

        let status = String::from_utf8_lossy(&rec[0..2]).to_string();
        let path_bytes = if rec.len() >= 4 { &rec[3..] } else { &[] };
        if path_bytes.is_empty() {
            continue;
        }

        let path = String::from_utf8_lossy(path_bytes).to_string();
        if !path.trim().is_empty() {
            out.insert(path, status);
        }

        let has_rename = rec[0] == b'R' || rec[1] == b'R' || rec[0] == b'C' || rec[1] == b'C';
        if has_rename {
            let start2 = i;
            while i < stdout.len() && stdout[i] != 0 {
                i += 1;
            }
            let _ = &stdout[start2..i];
            i += 1;
        }
    }

    out
}

fn parse_ls_files_unmerged_z(stdout: &[u8]) -> HashMap<String, Vec<u8>> {
    let mut stages_by_path: HashMap<String, HashSet<u8>> = HashMap::new();

    for rec in stdout.split(|b| *b == 0) {
        if rec.is_empty() {
            continue;
        }
        let s = String::from_utf8_lossy(rec).to_string();
        let parts: Vec<&str> = s.splitn(2, '\t').collect();
        if parts.len() != 2 {
            continue;
        }
        let meta = parts[0];
        let path = parts[1].to_string();
        if path.trim().is_empty() {
            continue;
        }
        let meta_parts: Vec<&str> = meta.split_whitespace().collect();
        if meta_parts.len() < 3 {
            continue;
        }
        let stage = meta_parts[2].trim().parse::<u8>().unwrap_or(0);
        if stage == 0 {
            continue;
        }

        let set = stages_by_path.entry(path).or_insert_with(HashSet::new);
        set.insert(stage);
    }

    let mut out: HashMap<String, Vec<u8>> = HashMap::new();
    for (path, set) in stages_by_path.into_iter() {
        let mut v: Vec<u8> = set.into_iter().collect();
        v.sort();
        out.insert(path, v);
    }

    out
}

fn bytes_to_text_or_err(bytes: &[u8]) -> Result<String, String> {
    if bytes.iter().any(|b| *b == 0) {
        return Err(String::from("Binary file preview is not supported."));
    }
    Ok(String::from_utf8_lossy(bytes).to_string())
}

fn parse_name_status_z(stdout: &[u8]) -> Vec<GitContinueFileEntry> {
    let mut out: Vec<GitContinueFileEntry> = Vec::new();
    let mut tokens: Vec<String> = Vec::new();
    for t in stdout.split(|c| *c == 0) {
        if t.is_empty() {
            continue;
        }
        let s = String::from_utf8_lossy(t).to_string();
        if !s.is_empty() {
            tokens.push(s);
        }
    }

    let mut i: usize = 0;
    while i < tokens.len() {
        let status = tokens[i].trim().to_string();
        i += 1;
        if status.is_empty() {
            continue;
        }

        let has_rename = status.starts_with('R') || status.starts_with('C');
        if has_rename {
            if i + 1 >= tokens.len() {
                break;
            }
            let old_path = tokens[i].to_string();
            let new_path = tokens[i + 1].to_string();
            i += 2;
            if !new_path.trim().is_empty() {
                out.push(GitContinueFileEntry {
                    status,
                    path: new_path,
                    old_path: if old_path.trim().is_empty() { None } else { Some(old_path) },
                });
            }
        } else {
            if i >= tokens.len() {
                break;
            }
            let path = tokens[i].to_string();
            i += 1;
            if !path.trim().is_empty() {
                out.push(GitContinueFileEntry {
                    status,
                    path,
                    old_path: None,
                });
            }
        }
    }

    out
}

fn read_git_path_text(repo_path: &str, git_path: &str) -> Result<String, String> {
    let full = resolve_git_path(repo_path, git_path)?;
    let Some(full) = full else {
        return Ok(String::new());
    };

    match fs::read(full) {
        Ok(bytes) => bytes_to_text_or_err(bytes.as_slice()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("Failed to read {git_path}: {e}")),
    }
}

#[allow(dead_code)]
fn write_git_path_text(repo_path: &str, git_path: &str, text: &str) -> Result<(), String> {
    let full = resolve_git_path(repo_path, git_path)?;
    let Some(full) = full else {
        return Err(format!("Failed to resolve git path: {git_path}"));
    };

    let mut s = text.replace("\r\n", "\n");
    if !s.ends_with('\n') {
        s.push('\n');
    }

    fs::write(full, s.as_bytes()).map_err(|e| format!("Failed to write {git_path}: {e}"))?;
    Ok(())
}

fn resolve_git_path(repo_path: &str, git_path: &str) -> Result<Option<PathBuf>, String> {
    let full = crate::run_git(repo_path, &["rev-parse", "--git-path", git_path]).unwrap_or_default();
    let full = full.trim();
    if full.is_empty() {
        return Ok(None);
    }

    let p = PathBuf::from(full);
    if p.is_absolute() {
        Ok(Some(p))
    } else {
        Ok(Some(Path::new(repo_path).join(p)))
    }
}

fn staged_name_status(repo_path: &str) -> Result<Vec<GitContinueFileEntry>, String> {
    let out = crate::git_command_in_repo(repo_path)
        .args(["diff", "--cached", "--name-status", "-z", "-M"])
        .output()
        .map_err(|e| format!("Failed to spawn git: {e}"))?;

    let ok = out.status.success() || out.status.code() == Some(1);
    if !ok {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(format!("git diff --cached failed: {stderr}"));
    }

    Ok(parse_name_status_z(out.stdout.as_slice()))
}

fn git_status_text(repo_path: &str) -> Result<String, String> {
    let out = crate::git_command_in_repo(repo_path)
        .args(["status", "--untracked-files=no"])
        .output()
        .map_err(|e| format!("Failed to spawn git status: {e}"))?;

    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    if out.status.success() {
        Ok(stdout)
    } else {
        Err(stderr)
    }
}

fn no_editor_env(cmd: &mut std::process::Command) {
    #[cfg(target_os = "windows")]
    {
        // `git` may append COMMIT_EDITMSG path as an extra argument.
        // PowerShell ignores extra args for `-Command`, making it a robust no-op editor.
        // The trailing `#` comment makes this robust even if Git appends the path into the
        // same command string (PowerShell would otherwise parse it as code).
        let ps = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command \"exit 0 #\"";
        cmd.env("GIT_EDITOR", ps);
        cmd.env("EDITOR", ps);
        cmd.env("VISUAL", ps);
        cmd.env("GIT_SEQUENCE_EDITOR", ps);
    }

    #[cfg(not(target_os = "windows"))]
    {
        cmd.env("GIT_EDITOR", "true");
        cmd.env("EDITOR", "true");
        cmd.env("VISUAL", "true");
    }
}

#[tauri::command]
pub(crate) fn git_conflict_state(repo_path: String) -> Result<GitConflictState, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    crate::with_repo_git_lock(&repo_path, || {
        let merge_in_progress = crate::is_merge_in_progress(&repo_path);
        let rebase_in_progress = crate::is_rebase_in_progress(&repo_path);
        let cherry_in_progress = crate::is_cherry_pick_in_progress(&repo_path);
        let am_in_progress = is_am_in_progress(&repo_path);

        let operation = if am_in_progress {
            String::from("am")
        } else if rebase_in_progress {
            String::from("rebase")
        } else if merge_in_progress {
            String::from("merge")
        } else if cherry_in_progress {
            String::from("cherry-pick")
        } else {
            String::new()
        };

        let in_progress = merge_in_progress || rebase_in_progress || cherry_in_progress || am_in_progress;

        let files = crate::list_unmerged_files(&repo_path);

        let status_out = crate::git_command_in_repo(&repo_path)
            .args(["status", "--porcelain", "-z", "--untracked-files=no"])
            .output()
            .map_err(|e| format!("Failed to spawn git status: {e}"))?;

        let status_map = if status_out.status.success() {
            parse_status_porcelain_z(status_out.stdout.as_slice())
        } else {
            HashMap::new()
        };

        let ls_out = crate::git_command_in_repo(&repo_path)
            .args(["ls-files", "-u", "-z"])
            .output()
            .map_err(|e| format!("Failed to spawn git ls-files: {e}"))?;

        let stages_map = if ls_out.status.success() {
            parse_ls_files_unmerged_z(ls_out.stdout.as_slice())
        } else {
            HashMap::new()
        };

        let mut entries: Vec<GitConflictFileEntry> = Vec::new();
        for p in files.iter() {
            let status = status_map.get(p).cloned().unwrap_or_else(|| String::from("U"));
            let stages = stages_map.get(p).cloned().unwrap_or_default();
            entries.push(GitConflictFileEntry {
                status,
                path: p.clone(),
                stages,
            });
        }

        Ok(GitConflictState {
            in_progress,
            operation,
            files: entries,
        })
    })
}

#[tauri::command]
pub(crate) fn git_conflict_file_versions(repo_path: String, path: String) -> Result<GitConflictFileVersions, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let path = path.trim().to_string();
    if path.is_empty() {
        return Err(String::from("path is empty"));
    }

    let full = crate::safe_repo_join(&repo_path, path.as_str()).map_err(|e| format!("Invalid path: {e}"))?;

    crate::with_repo_git_lock(&repo_path, || {
        let base_bytes = crate::git_show_path_bytes_or_empty(&repo_path, ":1", path.as_str())?;
        let ours_bytes = crate::git_show_path_bytes_or_empty(&repo_path, ":2", path.as_str())?;
        let theirs_bytes = crate::git_show_path_bytes_or_empty(&repo_path, ":3", path.as_str())?;

        let working_bytes = match fs::read(&full) {
            Ok(b) => Some(b),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(format!("Failed to read file: {e}")),
        };

        let base = if base_bytes.is_empty() {
            None
        } else {
            Some(bytes_to_text_or_err(base_bytes.as_slice())?)
        };
        let ours = if ours_bytes.is_empty() {
            None
        } else {
            Some(bytes_to_text_or_err(ours_bytes.as_slice())?)
        };
        let theirs = if theirs_bytes.is_empty() {
            None
        } else {
            Some(bytes_to_text_or_err(theirs_bytes.as_slice())?)
        };
        let working = match working_bytes {
            None => None,
            Some(b) => Some(bytes_to_text_or_err(b.as_slice())?),
        };

        let mut ours_deleted = ours.is_none() && !git_file_exists_at_rev(&repo_path, "HEAD", path.as_str());

        let mut theirs_path: Option<String> = None;
        let mut resolved_theirs = theirs;
        let mut theirs_deleted = resolved_theirs.is_none();
        let mut conflict_kind = String::from("text");

        if resolved_theirs.is_none() {
            if let Some(theirs_ref) = detect_theirs_ref(&repo_path) {
                let renames = detect_renames_against_theirs(&repo_path, theirs_ref.as_str());
                if let Some(new_path) = renames.get(path.as_str()) {
                    let theirs_alt_bytes = crate::git_show_path_bytes_or_empty(&repo_path, theirs_ref.as_str(), new_path.as_str())?;
                    if !theirs_alt_bytes.is_empty() {
                        resolved_theirs = Some(bytes_to_text_or_err(theirs_alt_bytes.as_slice())?);
                        theirs_path = Some(new_path.to_string());
                        theirs_deleted = false;
                        conflict_kind = String::from("rename");
                    }
                }

                if conflict_kind != "rename" {
                    theirs_deleted = !git_file_exists_at_rev(&repo_path, theirs_ref.as_str(), path.as_str());
                    if theirs_deleted {
                        conflict_kind = String::from("modify_delete");
                    }
                }
            }
        }

        let stage_ours_missing = ours.is_none();
        let stage_theirs_missing = resolved_theirs.is_none();
        if conflict_kind != "rename" && (stage_ours_missing ^ stage_theirs_missing) {
            conflict_kind = String::from("modify_delete");
            ours_deleted = stage_ours_missing;
            theirs_deleted = stage_theirs_missing;
        }

        if ours_deleted {
            conflict_kind = String::from("modify_delete");
        }

        Ok(GitConflictFileVersions {
            base,
            ours,
            theirs: resolved_theirs,
            working,
            ours_path: Some(path.to_string()),
            theirs_path,
            ours_deleted,
            theirs_deleted,
            conflict_kind,
        })
    })
}

#[tauri::command]
pub(crate) fn git_conflict_take_ours(repo_path: String, path: String) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let path = path.trim().to_string();
    if path.is_empty() {
        return Err(String::from("path is empty"));
    }

    let _ = crate::safe_repo_join(&repo_path, path.as_str()).map_err(|e| format!("Invalid path: {e}"))?;

    crate::with_repo_git_lock(&repo_path, || {
        let ours_bytes = crate::git_show_path_bytes_or_empty(&repo_path, ":2", path.as_str())?;
        if ours_bytes.is_empty() {
            crate::run_git(&repo_path, &["rm", "-f", "--", path.as_str()])?;
            return Ok(String::from("ok"));
        }

        let theirs_ref = detect_theirs_ref(&repo_path);
        if let Some(theirs_ref) = theirs_ref {
            let renames = detect_renames_against_theirs(&repo_path, theirs_ref.as_str());
            if let Some(new_path) = renames.get(path.as_str()) {
                crate::run_git(&repo_path, &["rm", "-f", "--", new_path.as_str()])?;
            }
        }

        crate::run_git(&repo_path, &["checkout", "--ours", "--", path.as_str()])?;
        crate::run_git(&repo_path, &["add", "--", path.as_str()])?;
        Ok(String::from("ok"))
    })
}

#[tauri::command]
pub(crate) fn git_rebase_skip(repo_path: String) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;
    crate::run_git(&repo_path, &["rebase", "--skip"])
}

#[tauri::command]
pub(crate) fn git_conflict_take_theirs(repo_path: String, path: String) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let path = path.trim().to_string();
    if path.is_empty() {
        return Err(String::from("path is empty"));
    }

    let _ = crate::safe_repo_join(&repo_path, path.as_str()).map_err(|e| format!("Invalid path: {e}"))?;

    crate::with_repo_git_lock(&repo_path, || {
        let theirs_bytes = crate::git_show_path_bytes_or_empty(&repo_path, ":3", path.as_str())?;
        if !theirs_bytes.is_empty() {
            crate::run_git(&repo_path, &["checkout", "--theirs", "--", path.as_str()])?;
            crate::run_git(&repo_path, &["add", "--", path.as_str()])?;
            return Ok(String::from("ok"));
        }

        if let Some(theirs_ref) = detect_theirs_ref(&repo_path) {
            let renames = detect_renames_against_theirs(&repo_path, theirs_ref.as_str());
            if let Some(new_path) = renames.get(path.as_str()) {
                let full_new = crate::safe_repo_join(&repo_path, new_path.as_str()).map_err(|e| format!("Invalid path: {e}"))?;
                if let Some(parent) = full_new.parent() {
                    fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent directories: {e}"))?;
                }

                let theirs_new_bytes = crate::git_show_path_bytes_or_empty(&repo_path, theirs_ref.as_str(), new_path.as_str())?;
                if theirs_new_bytes.is_empty() {
                    crate::run_git(&repo_path, &["rm", "-f", "--", path.as_str()])?;
                    return Ok(String::from("ok"));
                }

                fs::write(&full_new, theirs_new_bytes.as_slice()).map_err(|e| format!("Failed to write file: {e}"))?;
                crate::run_git(&repo_path, &["add", "-A", "--", new_path.as_str()])?;
                crate::run_git(&repo_path, &["rm", "-f", "--", path.as_str()])?;
                return Ok(String::from("ok"));
            }

            if !git_file_exists_at_rev(&repo_path, theirs_ref.as_str(), path.as_str()) {
                crate::run_git(&repo_path, &["rm", "-f", "--", path.as_str()])?;
                return Ok(String::from("ok"));
            }
        }

        crate::run_git(&repo_path, &["rm", "-f", "--", path.as_str()])?;
        Ok(String::from("ok"))
    })
}

#[tauri::command]
pub(crate) fn git_conflict_apply_and_stage(repo_path: String, path: String, content: String) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let path = path.trim().to_string();
    if path.is_empty() {
        return Err(String::from("path is empty"));
    }

    let full = crate::safe_repo_join(&repo_path, path.as_str()).map_err(|e| format!("Invalid path: {e}"))?;

    crate::with_repo_git_lock(&repo_path, || {
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent directories: {e}"))?;
        }
        fs::write(&full, content.as_bytes()).map_err(|e| format!("Failed to write file: {e}"))?;
        crate::run_git(&repo_path, &["add", "--", path.as_str()])?;
        Ok(String::from("ok"))
    })
}

#[tauri::command]
#[allow(dead_code)]
pub(crate) fn git_conflict_apply(repo_path: String, path: String, content: String) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let path = path.trim().to_string();
    if path.is_empty() {
        return Err(String::from("path is empty"));
    }

    let full = crate::safe_repo_join(&repo_path, path.as_str()).map_err(|e| format!("Invalid path: {e}"))?;

    crate::with_repo_git_lock(&repo_path, || {
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent directories: {e}"))?;
        }
        fs::write(&full, content.as_bytes()).map_err(|e| format!("Failed to write file: {e}"))?;
        Ok(String::from("ok"))
    })
}
