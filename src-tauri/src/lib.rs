// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use serde::Serialize;
use tauri::Emitter;
use std::io::Read;
use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[derive(Debug, Clone, Serialize)]
struct GitCommit {
    hash: String,
    parents: Vec<String>,
    author: String,
    date: String,
    subject: String,
    refs: String,
    is_head: bool,
}

#[derive(Debug, Clone, Serialize)]
struct RepoOverview {
    head: String,
    head_name: String,
    branches: Vec<String>,
    tags: Vec<String>,
    remotes: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
struct GitStatusEntry {
    status: String,
    path: String,
}

#[derive(Debug, Clone, Serialize)]
struct GitStatusSummary {
    changed: u32,
}

#[derive(Debug, Clone, Serialize)]
struct GitAheadBehind {
    ahead: u32,
    behind: u32,
    upstream: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct PullResult {
    status: String,
    operation: String,
    message: String,
    conflict_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
struct PullPredictResult {
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
    action: String,
    conflict_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
struct GitCloneProgressEvent {
    destination_path: String,
    phase: Option<String>,
    percent: Option<u32>,
    message: String,
}

fn extract_progress_percent(message: &str) -> Option<u32> {
    let idx = message.find('%')?;
    let before = &message[..idx];
    let start = before
        .rfind(|c: char| !c.is_ascii_digit())
        .map(|i| i + 1)
        .unwrap_or(0);
    let digits = before[start..].trim();
    if digits.is_empty() {
        return None;
    }
    let pct = digits.parse::<u32>().ok()?;
    if pct > 100 {
        return None;
    }
    Some(pct)
}

fn parse_git_clone_progress_line(line: &str) -> Option<(String, u32, String)> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    let without_remote = trimmed
        .strip_prefix("remote:")
        .map(|s| s.trim())
        .unwrap_or(trimmed);

    let pct = extract_progress_percent(without_remote)?;
    let phase = without_remote
        .split(':')
        .next()
        .unwrap_or_default()
        .trim()
        .to_string();

    if phase.is_empty() {
        return None;
    }

    Some((phase, pct, without_remote.to_string()))
}

fn run_git(repo_path: &str, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git")
        .args(["-C", repo_path])
        .args(args)
        .output()
        .map_err(|e| format!("Failed to spawn git: {e}"))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(format!("git command failed: {stderr}"));
    }

    Ok(String::from_utf8_lossy(&out.stdout).trim_end().to_string())
}

fn run_git_status(repo_path: &str, args: &[&str]) -> Result<(bool, String, String), String> {
    let out = Command::new("git")
        .args(["-C", repo_path])
        .args(args)
        .output()
        .map_err(|e| format!("Failed to spawn git: {e}"))?;

    let stdout = String::from_utf8_lossy(&out.stdout).trim_end().to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).trim_end().to_string();
    Ok((out.status.success(), stdout, stderr))
}

fn is_rebase_in_progress(repo_path: &str) -> bool {
    Command::new("git")
        .args(["-C", repo_path, "rev-parse", "--verify", "-q", "REBASE_HEAD"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn is_merge_in_progress(repo_path: &str) -> bool {
    Command::new("git")
        .args(["-C", repo_path, "rev-parse", "--verify", "-q", "MERGE_HEAD"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn parse_conflict_files(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();

    for line in text.lines() {
        if !line.contains("CONFLICT") {
            continue;
        }

        if let Some(idx) = line.rfind(" in ") {
            let p = line[idx + 4..].trim();
            if !p.is_empty() && !out.contains(&p.to_string()) {
                out.push(p.to_string());
            }
            continue;
        }

        if let Some(idx) = line.rfind(':') {
            let p = line[idx + 1..].trim();
            if !p.is_empty() && !out.contains(&p.to_string()) {
                out.push(p.to_string());
            }
        }
    }

    out
}

fn infer_upstream(repo_path: &str, remote_name: &str, head_name: &str) -> Option<String> {
    let upstream_out = Command::new("git")
        .args([
            "-C",
            repo_path,
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{u}",
        ])
        .output();

    if let Ok(o) = upstream_out {
        if o.status.success() {
            let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if !s.is_empty() {
                return Some(s);
            }
        }
    }

    let verify_ref = format!("refs/remotes/{remote_name}/{head_name}");
    let verify_out = Command::new("git")
        .args([
            "-C",
            repo_path,
            "show-ref",
            "--verify",
            "--quiet",
            verify_ref.as_str(),
        ])
        .output();

    if let Ok(o) = verify_out {
        if o.status.success() {
            return Some(format!("{remote_name}/{head_name}"));
        }
    }

    None
}

fn predict_merge_conflicts(repo_path: &str, upstream: &str) -> Vec<String> {
    let base = match run_git(repo_path, &["merge-base", "HEAD", upstream]) {
        Ok(s) if !s.trim().is_empty() => s,
        _ => return Vec::new(),
    };

    if let Ok((ok, stdout, _stderr)) = run_git_status(
        repo_path,
        &["merge-tree", "--name-only", base.as_str(), "HEAD", upstream],
    ) {
        if ok {
            let mut files: Vec<String> = stdout
                .lines()
                .map(|l| l.trim())
                .filter(|l| !l.is_empty())
                .map(|l| l.to_string())
                .collect();
            files.sort();
            files.dedup();
            return files;
        }
    }

    let (ok, stdout, _stderr) = match run_git_status(repo_path, &["merge-tree", base.as_str(), "HEAD", upstream]) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    if !ok {
        return Vec::new();
    }

    let mut files: Vec<String> = Vec::new();
    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("base ") || trimmed.starts_with("our ") || trimmed.starts_with("their ") {
            let parts: Vec<&str> = trimmed.split_whitespace().collect();
            if let Some(p) = parts.last() {
                if !p.is_empty() && !files.contains(&p.to_string()) {
                    files.push(p.to_string());
                }
            }
        }
    }
    files.sort();
    files.dedup();
    files
}

fn ensure_is_git_worktree(repo_path: &str) -> Result<(), String> {
    let check = Command::new("git")
        .args(["-C", repo_path, "rev-parse", "--is-inside-work-tree"])
        .output()
        .map_err(|e| format!("Failed to spawn git: {e}"))?;

    if !check.status.success() {
        return Err(String::from("Selected path is not a Git working tree."));
    }

    Ok(())
}

fn ensure_clone_destination_valid(destination_path: &str) -> Result<(), String> {
    let destination_path = destination_path.trim();
    if destination_path.is_empty() {
        return Err(String::from("destination_path is empty"));
    }

    let dest = Path::new(destination_path);

    if dest.exists() {
        if dest.is_file() {
            return Err(String::from("Destination path points to a file."));
        }

        let git_dir = dest.join(".git");
        if git_dir.exists() {
            return Err(String::from("Destination already contains a .git folder."));
        }

        let mut has_entries = false;
        if let Ok(rd) = fs::read_dir(dest) {
            for entry in rd.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name == "." || name == ".." {
                    continue;
                }
                has_entries = true;
                break;
            }
        }

        if has_entries {
            return Err(String::from("Destination folder is not empty."));
        }

        Ok(())
    } else {
        let parent = dest
            .parent()
            .ok_or_else(|| String::from("Destination folder has no parent."))?;
        if !parent.exists() {
            return Err(String::from("Destination parent folder does not exist."));
        }
        if !parent.is_dir() {
            return Err(String::from("Destination parent path is not a directory."));
        }
        Ok(())
    }
}

fn ensure_is_not_git_worktree(repo_path: &str) -> Result<(), String> {
    let check = Command::new("git")
        .args(["-C", repo_path, "rev-parse", "--is-inside-work-tree"])
        .output()
        .map_err(|e| format!("Failed to spawn git: {e}"))?;

    if check.status.success() {
        return Err(String::from("Selected path is already a Git working tree."));
    }

    Ok(())
}

#[tauri::command]
fn repo_overview(repo_path: String) -> Result<RepoOverview, String> {
    ensure_is_git_worktree(&repo_path)?;

    let head = run_git(&repo_path, &["rev-parse", "HEAD"]).unwrap_or_default();
    let head_name = run_git(&repo_path, &["symbolic-ref", "--quiet", "--short", "HEAD"]).unwrap_or_else(|_| {
        String::from("(detached)")
    });

    let branches_raw = run_git(&repo_path, &["branch", "--format=%(refname:short)"])?;
    let branches = branches_raw
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .map(|l| l.to_string())
        .collect();

    let tags_raw = run_git(&repo_path, &["tag", "--list"])?;
    let tags = tags_raw
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .map(|l| l.to_string())
        .collect();

    let remotes_raw = run_git(&repo_path, &["remote"])?;
    let remotes = remotes_raw
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .map(|l| l.to_string())
        .collect();

    Ok(RepoOverview {
        head,
        head_name,
        branches,
        tags,
        remotes,
    })
}

#[tauri::command]
fn list_commits(repo_path: String, max_count: Option<u32>) -> Result<Vec<GitCommit>, String> {
    let max_count = max_count.unwrap_or(200).min(2000);

    ensure_is_git_worktree(&repo_path)?;

    let head = run_git(&repo_path, &["rev-parse", "HEAD"]).unwrap_or_default();

    let format = "%H\x1f%P\x1f%an\x1f%ad\x1f%s\x1f%D\x1e";
    let output = Command::new("git")
        .args([
            "-C",
            &repo_path,
            "--no-pager",
            "log",
            "--all",
            "--topo-order",
            "--date=iso-strict",
            &format!("--pretty=format:{format}"),
            "-n",
            &max_count.to_string(),
        ])
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
        let date = parts.next().unwrap_or_default().to_string();
        let subject = parts.next().unwrap_or_default().to_string();
        let refs = parts.next().unwrap_or_default().to_string();

        if hash.is_empty() {
            continue;
        }

        let parents = parents_raw
            .split_whitespace()
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect();

        let is_head = head == hash;

        commits.push(GitCommit {
            hash,
            parents,
            author,
            date,
            subject,
            refs,
            is_head,
        });
    }

    Ok(commits)
}

#[tauri::command]
fn init_repo(repo_path: String) -> Result<String, String> {
    if repo_path.trim().is_empty() {
        return Err(String::from("repo_path is empty"));
    }

    let git_dir = Path::new(&repo_path).join(".git");
    if git_dir.exists() {
        return Err(String::from("Selected path already contains a .git folder."));
    }

    ensure_is_not_git_worktree(&repo_path)?;

    run_git(&repo_path, &["init"])?;
    Ok(repo_path)
}

#[tauri::command]
fn git_status(repo_path: String) -> Result<Vec<GitStatusEntry>, String> {
    ensure_is_git_worktree(&repo_path)?;

    let raw = run_git(&repo_path, &["status", "--porcelain"]).unwrap_or_default();
    let mut entries = Vec::new();

    for line in raw.lines() {
        if line.trim().is_empty() {
            continue;
        }

        let status = if line.len() >= 2 {
            line[0..2].to_string()
        } else {
            line.to_string()
        };

        let mut path = if line.len() >= 4 {
            line[3..].trim().to_string()
        } else {
            String::new()
        };

        if let Some(idx) = path.rfind(" -> ") {
            path = path[idx + 4..].trim().to_string();
        }

        if path.starts_with('"') && path.ends_with('"') && path.len() >= 2 {
            path = path[1..path.len() - 1].to_string();
        }

        entries.push(GitStatusEntry { status, path });
    }

    Ok(entries)
}

#[tauri::command]
fn git_commit(repo_path: String, message: String, paths: Vec<String>) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;

    if message.trim().is_empty() {
        return Err(String::from("Commit message is empty."));
    }

    if paths.is_empty() {
        return Err(String::from("No files selected to commit."));
    }

    let mut add_args: Vec<&str> = Vec::new();
    add_args.push("add");
    add_args.push("--");
    for p in &paths {
        if !p.trim().is_empty() {
            add_args.push(p);
        }
    }

    let add_out = Command::new("git")
        .args(["-C", &repo_path])
        .args(&add_args)
        .output()
        .map_err(|e| format!("Failed to spawn git add: {e}"))?;

    if !add_out.status.success() {
        let stderr = String::from_utf8_lossy(&add_out.stderr);
        return Err(format!("git add failed: {stderr}"));
    }

    let commit_out = Command::new("git")
        .args(["-C", &repo_path, "commit", "-m", &message])
        .output()
        .map_err(|e| format!("Failed to spawn git commit: {e}"))?;

    if !commit_out.status.success() {
        let stderr = String::from_utf8_lossy(&commit_out.stderr);
        return Err(format!("git commit failed: {stderr}"));
    }

    let new_head = run_git(&repo_path, &["rev-parse", "HEAD"]).unwrap_or_default();
    Ok(new_head)
}

#[tauri::command]
fn git_status_summary(repo_path: String) -> Result<GitStatusSummary, String> {
    ensure_is_git_worktree(&repo_path)?;

    let raw = run_git(&repo_path, &["status", "--porcelain"]).unwrap_or_default();
    let changed = raw
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .count() as u32;

    Ok(GitStatusSummary { changed })
}

#[tauri::command]
fn git_ahead_behind(repo_path: String, remote_name: Option<String>) -> Result<GitAheadBehind, String> {
    ensure_is_git_worktree(&repo_path)?;

    let head_name = run_git(&repo_path, &["symbolic-ref", "--quiet", "--short", "HEAD"]).unwrap_or_else(|_| {
        String::from("(detached)")
    });

    if head_name == "(detached)" {
        return Ok(GitAheadBehind {
            ahead: 0,
            behind: 0,
            upstream: None,
        });
    }

    let upstream_out = Command::new("git")
        .args(["-C", &repo_path, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
        .output()
        .map_err(|e| format!("Failed to spawn git rev-parse: {e}"))?;

    let mut upstream: Option<String> = None;
    if upstream_out.status.success() {
        let s = String::from_utf8_lossy(&upstream_out.stdout).trim().to_string();
        if !s.is_empty() {
            upstream = Some(s);
        }
    }

    if upstream.is_none() {
        let remote_name = remote_name.unwrap_or_else(|| String::from("origin"));
        let verify_ref = format!("refs/remotes/{remote_name}/{head_name}");
        let verify_out = Command::new("git")
            .args(["-C", &repo_path, "show-ref", "--verify", "--quiet", verify_ref.as_str()])
            .output()
            .map_err(|e| format!("Failed to spawn git show-ref: {e}"))?;

        if verify_out.status.success() {
            upstream = Some(format!("{remote_name}/{head_name}"));
        }
    }

    let upstream = match upstream {
        Some(u) => u,
        None => {
            return Ok(GitAheadBehind {
                ahead: 0,
                behind: 0,
                upstream: None,
            });
        }
    };

    let raw = run_git(&repo_path, &["rev-list", "--left-right", "--count", &format!("{upstream}...HEAD")])?;
    let parts: Vec<&str> = raw.split_whitespace().collect();
    let behind = parts
        .get(0)
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(0);
    let ahead = parts
        .get(1)
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(0);

    Ok(GitAheadBehind {
        ahead,
        behind,
        upstream: Some(upstream),
    })
}

#[tauri::command]
fn git_get_remote_url(repo_path: String, remote_name: Option<String>) -> Result<Option<String>, String> {
    ensure_is_git_worktree(&repo_path)?;

    let remote_name = remote_name.unwrap_or_else(|| String::from("origin"));

    let out = Command::new("git")
        .args(["-C", &repo_path, "remote", "get-url", remote_name.as_str()])
        .output()
        .map_err(|e| format!("Failed to spawn git remote get-url: {e}"))?;

    if !out.status.success() {
        return Ok(None);
    }

    let url = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if url.is_empty() {
        Ok(None)
    } else {
        Ok(Some(url))
    }
}

#[tauri::command]
fn git_set_remote_url(repo_path: String, remote_name: Option<String>, url: String) -> Result<(), String> {
    ensure_is_git_worktree(&repo_path)?;

    let remote_name = remote_name.unwrap_or_else(|| String::from("origin"));
    let url = url.trim().to_string();
    if url.is_empty() {
        return Err(String::from("Remote URL is empty."));
    }

    let exists_out = Command::new("git")
        .args(["-C", &repo_path, "remote", "get-url", remote_name.as_str()])
        .output()
        .map_err(|e| format!("Failed to spawn git remote get-url: {e}"))?;

    if exists_out.status.success() {
        run_git(
            &repo_path,
            &[
                "remote",
                "set-url",
                remote_name.as_str(),
                url.as_str(),
            ],
        )?;
        Ok(())
    } else {
        run_git(
            &repo_path,
            &[
                "remote",
                "add",
                remote_name.as_str(),
                url.as_str(),
            ],
        )?;
        Ok(())
    }
}

#[tauri::command]
fn git_push(
    repo_path: String,
    remote_name: Option<String>,
    branch: Option<String>,
    force: Option<bool>,
    with_lease: Option<bool>,
) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;

    let remote_name = remote_name.unwrap_or_else(|| String::from("origin"));
    let force = force.unwrap_or(false);
    let with_lease = with_lease.unwrap_or(true);

    let branch = match branch {
        Some(b) if !b.trim().is_empty() => b,
        _ => run_git(&repo_path, &["symbolic-ref", "--quiet", "--short", "HEAD"])
            .map_err(|e| format!("Failed to determine current branch: {e}"))?,
    };

    let mut args: Vec<&str> = vec!["push"];
    if force {
        if with_lease {
            args.push("--force-with-lease");
        } else {
            args.push("--force");
        }
    }
    args.push("-u");
    args.push(remote_name.as_str());
    args.push(branch.as_str());

    run_git(&repo_path, args.as_slice())
}

#[tauri::command]
fn git_pull(repo_path: String, remote_name: Option<String>) -> Result<PullResult, String> {
    ensure_is_git_worktree(&repo_path)?;

    let remote_name = remote_name.unwrap_or_else(|| String::from("origin"));
    let head_name = run_git(&repo_path, &["symbolic-ref", "--quiet", "--short", "HEAD"]).unwrap_or_else(|_| {
        String::from("(detached)")
    });
    if head_name == "(detached)" {
        return Err(String::from("Cannot pull from detached HEAD."));
    }

    let (ok, stdout, stderr) = run_git_status(&repo_path, &["pull", remote_name.as_str(), head_name.as_str()])?;
    if ok {
        return Ok(PullResult {
            status: String::from("ok"),
            operation: String::from("merge"),
            message: if !stdout.is_empty() { stdout } else { stderr },
            conflict_files: Vec::new(),
        });
    }

    if is_merge_in_progress(&repo_path) {
        let message = if !stderr.is_empty() {
            stderr.clone()
        } else {
            stdout.clone()
        };
        return Ok(PullResult {
            status: String::from("conflicts"),
            operation: String::from("merge"),
            message,
            conflict_files: parse_conflict_files(&stderr),
        });
    }

    Err(if !stderr.is_empty() { stderr } else { stdout })
}

#[tauri::command]
fn git_pull_rebase(repo_path: String, remote_name: Option<String>) -> Result<PullResult, String> {
    ensure_is_git_worktree(&repo_path)?;

    let remote_name = remote_name.unwrap_or_else(|| String::from("origin"));
    let head_name = run_git(&repo_path, &["symbolic-ref", "--quiet", "--short", "HEAD"]).unwrap_or_else(|_| {
        String::from("(detached)")
    });
    if head_name == "(detached)" {
        return Err(String::from("Cannot pull from detached HEAD."));
    }

    let (ok, stdout, stderr) =
        run_git_status(&repo_path, &["pull", "--rebase", remote_name.as_str(), head_name.as_str()])?;
    if ok {
        return Ok(PullResult {
            status: String::from("ok"),
            operation: String::from("rebase"),
            message: if !stdout.is_empty() { stdout } else { stderr },
            conflict_files: Vec::new(),
        });
    }

    if is_rebase_in_progress(&repo_path) {
        let message = if !stderr.is_empty() {
            stderr.clone()
        } else {
            stdout.clone()
        };
        return Ok(PullResult {
            status: String::from("conflicts"),
            operation: String::from("rebase"),
            message,
            conflict_files: parse_conflict_files(&stderr),
        });
    }

    Err(if !stderr.is_empty() { stderr } else { stdout })
}

#[tauri::command]
fn git_merge_continue(repo_path: String) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;

    let (ok, stdout, stderr) = run_git_status(&repo_path, &["merge", "--continue"])?;
    if ok {
        return Ok(if !stdout.is_empty() { stdout } else { stderr });
    }

    let (ok2, stdout2, stderr2) = run_git_status(&repo_path, &["commit", "--no-edit"])?;
    if ok2 {
        Ok(if !stdout2.is_empty() { stdout2 } else { stderr2 })
    } else {
        Err(if !stderr2.is_empty() { stderr2 } else { stdout2 })
    }
}

#[tauri::command]
fn git_merge_abort(repo_path: String) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;
    run_git(&repo_path, &["merge", "--abort"])
}

#[tauri::command]
fn git_rebase_continue(repo_path: String) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;
    run_git(&repo_path, &["rebase", "--continue"])
}

#[tauri::command]
fn git_rebase_abort(repo_path: String) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;
    run_git(&repo_path, &["rebase", "--abort"])
}

#[tauri::command]
fn git_pull_predict(
    repo_path: String,
    remote_name: Option<String>,
    rebase: Option<bool>,
) -> Result<PullPredictResult, String> {
    ensure_is_git_worktree(&repo_path)?;

    let remote_name = remote_name.unwrap_or_else(|| String::from("origin"));
    let rebase = rebase.unwrap_or(false);

    run_git(&repo_path, &["fetch", remote_name.as_str()])?;

    let head_name = run_git(&repo_path, &["symbolic-ref", "--quiet", "--short", "HEAD"]).unwrap_or_else(|_| {
        String::from("(detached)")
    });
    if head_name == "(detached)" {
        return Err(String::from("Cannot predict pull from detached HEAD."));
    }

    let upstream = infer_upstream(&repo_path, remote_name.as_str(), head_name.as_str());
    let (ahead, behind) = match upstream.as_ref() {
        Some(u) => {
            let raw = run_git(&repo_path, &["rev-list", "--left-right", "--count", &format!("{u}...HEAD")])
                .unwrap_or_default();
            let parts: Vec<&str> = raw.split_whitespace().collect();
            let behind = parts.get(0).and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
            let ahead = parts.get(1).and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
            (ahead, behind)
        }
        None => (0, 0),
    };

    let action = match (upstream.as_ref(), ahead, behind, rebase) {
        (None, _, _, _) => String::from("no-upstream"),
        (Some(_), _, 0, _) => String::from("noop"),
        (Some(_), 0, _, _) => String::from("fast-forward"),
        (Some(_), _, _, true) => String::from("rebase"),
        (Some(_), _, _, false) => String::from("merge-commit"),
    };

    let conflict_files = match (upstream.as_ref(), behind) {
        (Some(u), b) if b > 0 => predict_merge_conflicts(&repo_path, u.as_str()),
        _ => Vec::new(),
    };

    Ok(PullPredictResult {
        upstream,
        ahead,
        behind,
        action,
        conflict_files,
    })
}

#[tauri::command]
fn git_fetch(repo_path: String, remote_name: Option<String>) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;

    let remote_name = remote_name.unwrap_or_else(|| String::from("origin"));
    run_git(&repo_path, &["fetch", remote_name.as_str()])
}

#[tauri::command]
fn git_ls_remote_heads(repo_url: String) -> Result<Vec<String>, String> {
    let repo_url = repo_url.trim().to_string();
    if repo_url.is_empty() {
        return Err(String::from("repo_url is empty"));
    }

    let out = Command::new("git")
        .args(["ls-remote", "--heads", repo_url.as_str()])
        .output()
        .map_err(|e| format!("Failed to spawn git ls-remote: {e}"))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(format!("git ls-remote failed: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut branches: Vec<String> = Vec::new();
    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let mut parts = trimmed.split_whitespace();
        let _hash = parts.next();
        let reference = parts.next().unwrap_or_default();
        if let Some(name) = reference.strip_prefix("refs/heads/") {
            let name = name.trim();
            if !name.is_empty() {
                branches.push(name.to_string());
            }
        }
    }
    branches.sort();
    branches.dedup();
    Ok(branches)
}

#[tauri::command]
fn git_clone_repo(
    app: tauri::AppHandle,
    repo_url: String,
    destination_path: String,
    branch: Option<String>,
    init_submodules: Option<bool>,
    download_full_history: Option<bool>,
    bare: Option<bool>,
    origin: Option<String>,
    single_branch: Option<bool>,
) -> Result<String, String> {
    let repo_url = repo_url.trim().to_string();
    let destination_path = destination_path.trim().to_string();
    let origin = origin.unwrap_or_else(|| String::from("origin")).trim().to_string();
    let init_submodules = init_submodules.unwrap_or(false);
    let download_full_history = download_full_history.unwrap_or(true);
    let bare = bare.unwrap_or(false);
    let single_branch = single_branch.unwrap_or(false);

    if repo_url.is_empty() {
        return Err(String::from("repo_url is empty"));
    }
    if destination_path.is_empty() {
        return Err(String::from("destination_path is empty"));
    }
    if origin.is_empty() {
        return Err(String::from("origin is empty"));
    }
    if bare && init_submodules {
        return Err(String::from("Cannot initialize submodules in a bare repository."));
    }

    ensure_clone_destination_valid(destination_path.as_str())?;

    if Path::new(destination_path.as_str()).exists() {
        ensure_is_not_git_worktree(destination_path.as_str())?;
    }

    let mut args: Vec<String> = vec![String::from("clone")];
    args.push(String::from("--progress"));

    if bare {
        args.push(String::from("--bare"));
    }

    args.push(String::from("--origin"));
    args.push(origin);

    if single_branch {
        args.push(String::from("--single-branch"));
    }

    if !download_full_history {
        args.push(String::from("--depth"));
        args.push(String::from("1"));
    }

    if let Some(b) = branch {
        let b = b.trim().to_string();
        if !b.is_empty() {
            args.push(String::from("--branch"));
            args.push(b);
        }
    }

    args.push(repo_url);
    args.push(destination_path.clone());

    let mut child = Command::new("git")
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn git clone: {e}"))?;

    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| String::from("Failed to capture git clone stderr."))?;

    let mut stderr_all: Vec<u8> = Vec::new();
    let mut pending: Vec<u8> = Vec::new();
    let mut buf = [0u8; 4096];
    let mut last_sent: Option<(String, u32)> = None;

    loop {
        let n = stderr
            .read(&mut buf)
            .map_err(|e| format!("Failed to read git clone progress: {e}"))?;
        if n == 0 {
            break;
        }

        stderr_all.extend_from_slice(&buf[..n]);
        pending.extend_from_slice(&buf[..n]);

        while let Some(pos) = pending.iter().position(|b| *b == b'\r' || *b == b'\n') {
            let chunk: Vec<u8> = pending.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&chunk)
                .trim_matches(&['\r', '\n'][..])
                .trim()
                .to_string();
            if line.is_empty() {
                continue;
            }

            if let Some((phase, pct, message)) = parse_git_clone_progress_line(line.as_str()) {
                let should_emit = match &last_sent {
                    Some((p, last_pct)) => p != &phase || *last_pct != pct,
                    None => true,
                };
                if should_emit {
                    let _ = app.emit(
                        "git_clone_progress",
                        GitCloneProgressEvent {
                            destination_path: destination_path.clone(),
                            phase: Some(phase.clone()),
                            percent: Some(pct),
                            message,
                        },
                    );
                    last_sent = Some((phase, pct));
                }
            }
        }
    }

    if !pending.is_empty() {
        let line = String::from_utf8_lossy(&pending).trim().to_string();
        if let Some((phase, pct, message)) = parse_git_clone_progress_line(line.as_str()) {
            let should_emit = match &last_sent {
                Some((p, last_pct)) => p != &phase || *last_pct != pct,
                None => true,
            };
            if should_emit {
                let _ = app.emit(
                    "git_clone_progress",
                    GitCloneProgressEvent {
                        destination_path: destination_path.clone(),
                        phase: Some(phase),
                        percent: Some(pct),
                        message,
                    },
                );
            }
        }
    }

    let status = child
        .wait()
        .map_err(|e| format!("Failed to wait for git clone: {e}"))?;

    if !status.success() {
        let stderr = String::from_utf8_lossy(stderr_all.as_slice()).trim().to_string();
        if !stderr.is_empty() {
            return Err(format!("git clone failed: {stderr}"));
        }
        return Err(String::from("git clone failed."));
    }

    if init_submodules {
        run_git(
            destination_path.as_str(),
            &["submodule", "update", "--init", "--recursive"],
        )?;
    }

    Ok(destination_path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            repo_overview,
            list_commits,
            init_repo,
            git_ls_remote_heads,
            git_clone_repo,
            git_status,
            git_commit,
            git_status_summary,
            git_ahead_behind,
            git_get_remote_url,
            git_set_remote_url,
            git_push,
            git_fetch,
            git_pull,
            git_pull_rebase,
            git_merge_continue,
            git_merge_abort,
            git_rebase_continue,
            git_rebase_abort,
            git_pull_predict
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
