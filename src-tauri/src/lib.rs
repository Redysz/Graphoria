// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use serde::{Deserialize, Serialize};
use quick_xml::events::Event as XmlEvent;
use quick_xml::Reader as XmlReader;
use zip::ZipArchive;
use calamine::Reader;
use std::io::{Read, Write};
use std::fs;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::Manager;

mod commands;

use commands::terminal::{open_terminal, open_terminal_profile};
use commands::clone::git_clone_repo;
use commands::repo::{
    change_repo_ownership_to_current_user,
    get_current_username,
    git_check_worktree,
    git_ls_remote_heads,
    git_resolve_ref,
    git_trust_repo_global,
    git_trust_repo_session,
    init_repo,
    repo_overview,
};
use commands::commits::{list_commits, list_commits_full};
use commands::status::{
    git_ahead_behind,
    git_get_remote_url,
    git_has_staged_changes,
    git_set_remote_url,
    git_status,
    git_status_summary,
};
use commands::branches::{
    git_branches_points_at,
    git_checkout_branch,
    git_checkout_commit,
    git_create_branch,
    git_create_branch_advanced,
    git_delete_branch,
    git_is_ancestor,
    git_list_branches,
    git_rename_branch,
    git_reset,
    git_reset_hard,
    git_switch,
};
use commands::stashes::{
    git_stash_apply,
    git_stash_base_commit,
    git_stash_clear,
    git_stash_drop,
    git_stash_list,
    git_stash_push_patch,
    git_stash_push_paths,
    git_stash_show,
};
use commands::tags::{
    git_create_tag,
    git_delete_remote_tag,
    git_delete_tag,
    git_list_remote_tag_targets,
    git_list_tag_targets,
    git_push_tags,
    git_rename_tag,
};
use commands::diff::{
    git_commit_changes,
    git_commit_file_content,
    git_commit_file_diff,
    git_diff_no_index,
    git_head_file_content,
    git_head_file_text_preview,
    git_head_vs_working_diff,
    git_head_vs_working_text_diff,
    git_launch_external_diff_commit,
    git_launch_external_diff_working,
    git_working_file_content,
    git_working_file_diff,
    git_working_file_diff_unified,
    git_working_file_image_base64,
    git_working_file_text_preview,
    read_text_file,
};
use commands::reflog::{git_cherry_pick, git_reflog};
use commands::conflicts::{
    git_conflict_apply_and_stage,
    git_conflict_file_versions,
    git_conflict_state,
    git_conflict_take_ours,
    git_conflict_take_theirs,
    git_rebase_skip,
};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

fn parse_git_log_records(repo_path: &str, stdout: &str) -> Vec<GitCommit> {
    let head = run_git(repo_path, &["rev-parse", "HEAD"]).unwrap_or_default();
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

    let output = git_command_in_repo(repo_path)
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

fn git_log_subjects_for_range(repo_path: &str, range: &str, max_count: u32) -> Result<Vec<String>, String> {
    let fmt = "%H\x1f%s\x1e";
    let pretty = format!("--pretty=format:{fmt}");
    let max_count_s = max_count.to_string();
    let args: Vec<String> = vec![
        String::from("--no-pager"),
        String::from("log"),
        String::from("--reverse"),
        String::from("--date=iso-strict"),
        pretty,
        String::from("-n"),
        max_count_s,
        range.to_string(),
    ];

    let output = git_command_in_repo(repo_path)
        .args(args)
        .output()
        .map_err(|e| format!("Failed to spawn git log: {e}"))?;

    if !output.status.success() {
        return Ok(Vec::new());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut out = Vec::new();
    for rec in stdout.split('\x1e') {
        let t = rec.trim();
        if t.is_empty() {
            continue;
        }
        let mut parts = t.split('\x1f');
        let _hash = parts.next().unwrap_or_default();
        let subj = parts.next().unwrap_or_default().trim();
        if !subj.is_empty() {
            out.push(subj.to_string());
        }
    }
    Ok(out)
}

static SESSION_SAFE_DIRECTORIES: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static REPO_GIT_LOCKS: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();

fn session_safe_directories() -> &'static Mutex<HashSet<String>> {
    SESSION_SAFE_DIRECTORIES.get_or_init(|| Mutex::new(HashSet::new()))
}

fn repo_git_locks() -> &'static Mutex<HashMap<String, Arc<Mutex<()>>>> {
    REPO_GIT_LOCKS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn normalize_repo_path(p: &str) -> String {
    p.trim().replace('\\', "/").trim_end_matches('/').to_string()
}

fn with_repo_git_lock<T>(repo_path: &str, f: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let key = normalize_repo_path(repo_path);
    let lock = {
        let map = repo_git_locks();
        let mut guard = map
            .lock()
            .map_err(|_| String::from("Failed to lock repo git lock map."))?;
        guard.entry(key).or_insert_with(|| Arc::new(Mutex::new(()))).clone()
    };

    let _guard = lock.lock().map_err(|_| String::from("Failed to lock repo operation mutex."))?;
    f()
}

fn is_repo_session_safe(repo_path: &str) -> bool {
    let normalized = normalize_repo_path(repo_path);
    let set = session_safe_directories();
    if let Ok(guard) = set.lock() {
        guard.contains(&normalized)
    } else {
        false
    }
}

fn git_command_in_repo(repo_path: &str) -> Command {
    let mut cmd = Command::new("git");
    if is_repo_session_safe(repo_path) {
        let safe = normalize_repo_path(repo_path);
        cmd.arg("-c").arg(format!("safe.directory={safe}"));
    }
    cmd.arg("-c").arg("core.quotepath=false");
    cmd.args(["-C", repo_path]);
    cmd
}

#[tauri::command]
fn git_set_user_identity(
    repo_path: Option<String>,
    scope: String,
    user_name: String,
    user_email: String,
) -> Result<(), String> {
    let scope = scope.trim().to_lowercase();
    let user_name = user_name.trim().to_string();
    let user_email = user_email.trim().to_string();

    if user_name.is_empty() && user_email.is_empty() {
        return Err(String::from("User name and email are empty."));
    }

    if scope == "global" {
        if !user_name.is_empty() {
            let out = Command::new("git")
                .args(["config", "--global", "user.name", user_name.as_str()])
                .output()
                .map_err(|e| format!("Failed to spawn git config: {e}"))?;
            if !out.status.success() {
                let stderr = String::from_utf8_lossy(&out.stderr).trim_end().to_string();
                return Err(if !stderr.is_empty() {
                    format!("git config failed: {stderr}")
                } else {
                    String::from("git config failed.")
                });
            }
        }
        if !user_email.is_empty() {
            let out = Command::new("git")
                .args(["config", "--global", "user.email", user_email.as_str()])
                .output()
                .map_err(|e| format!("Failed to spawn git config: {e}"))?;
            if !out.status.success() {
                let stderr = String::from_utf8_lossy(&out.stderr).trim_end().to_string();
                return Err(if !stderr.is_empty() {
                    format!("git config failed: {stderr}")
                } else {
                    String::from("git config failed.")
                });
            }
        }
        return Ok(());
    }

    if scope != "repo" {
        return Err(String::from("Invalid scope. Expected 'repo' or 'global'."));
    }

    let repo_path = repo_path.unwrap_or_default();
    if repo_path.trim().is_empty() {
        return Err(String::from("repo_path is required for repo scope."));
    }
    ensure_is_git_worktree(repo_path.as_str())?;

    if !user_name.is_empty() {
        run_git(repo_path.as_str(), &["config", "user.name", user_name.as_str()])?;
    }
    if !user_email.is_empty() {
        run_git(repo_path.as_str(), &["config", "user.email", user_email.as_str()])?;
    }

    Ok(())
}

#[tauri::command]
fn reveal_in_file_explorer(path: String) -> Result<(), String> {
    let path = path.trim().to_string();
    if path.is_empty() {
        return Err(String::from("path is empty"));
    }

    let p = PathBuf::from(path);

    #[cfg(target_os = "windows")]
    {
        if p.is_dir() {
            Command::new("explorer")
                .arg(p.as_os_str())
                .spawn()
                .map_err(|e| format!("Failed to open file explorer: {e}"))?;
        } else {
            Command::new("explorer")
                .arg("/select,")
                .arg(p.as_os_str())
                .spawn()
                .map_err(|e| format!("Failed to reveal file in explorer: {e}"))?;
        }
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(p.as_os_str())
            .spawn()
            .map_err(|e| format!("Failed to reveal file in Finder: {e}"))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let dir = if p.is_dir() {
            p
        } else {
            p.parent().map(|d| d.to_path_buf()).unwrap_or(p)
        };

        Command::new("xdg-open")
            .arg(dir.as_os_str())
            .spawn()
            .map_err(|e| format!("Failed to open file manager: {e}"))?;
        return Ok(());
    }
}

fn ensure_rel_path_safe(rel: &str) -> Result<(), String> {
    let rel = rel.trim();
    if rel.is_empty() {
        return Err(String::from("path is empty"));
    }
    if rel.contains('\u{0000}') {
        return Err(String::from("path contains null byte"));
    }

    let normalized = rel.replace('\\', "/");
    let p = Path::new(normalized.as_str());
    for comp in p.components() {
        match comp {
            std::path::Component::Normal(_) | std::path::Component::CurDir => {}
            _ => return Err(String::from("path must be a relative path inside repository")),
        }
    }
    Ok(())
}

fn repo_join_path(repo_path: &str, rel: &str) -> Result<PathBuf, String> {
    ensure_rel_path_safe(rel)?;
    let rel = rel.trim().replace('\\', "/");
    let rel = rel.trim_end_matches('/');
    let rel_os = rel.replace('/', &std::path::MAIN_SEPARATOR.to_string());
    Ok(Path::new(repo_path).join(rel_os))
}

fn delete_working_path(repo_path: &str, rel: &str) -> Result<(), String> {
    let abs = repo_join_path(repo_path, rel)?;
    if !abs.exists() {
        return Ok(());
    }
    if abs.is_dir() {
        fs::remove_dir_all(abs).map_err(|e| format!("Failed to delete directory: {e}"))?;
    } else {
        fs::remove_file(abs).map_err(|e| format!("Failed to delete file: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
fn git_delete_working_path(repo_path: String, path: String) -> Result<(), String> {
    ensure_is_git_worktree(&repo_path)?;
    let path = path.trim().to_string();
    if path.is_empty() {
        return Err(String::from("path is empty"));
    }
    delete_working_path(&repo_path, path.as_str())
}

#[tauri::command]
fn git_discard_working_path(repo_path: String, path: String, is_untracked: Option<bool>) -> Result<(), String> {
    ensure_is_git_worktree(&repo_path)?;
    let path = path.trim().to_string();
    if path.is_empty() {
        return Err(String::from("path is empty"));
    }

    let is_untracked = is_untracked.unwrap_or(false);
    if is_untracked {
        return delete_working_path(&repo_path, path.as_str());
    }

    let (ok, _stdout, stderr) = run_git_status(&repo_path, &["restore", "--staged", "--worktree", "--", path.as_str()])?;
    if ok {
        return Ok(());
    }

    let (ok_reset, _stdout_reset, stderr_reset) =
        run_git_status(&repo_path, &["reset", "-q", "--", path.as_str()])?;
    let (ok_checkout, _stdout_checkout, stderr_checkout) =
        run_git_status(&repo_path, &["checkout", "--", path.as_str()])?;

    if ok_reset && ok_checkout {
        return Ok(());
    }

    let head_spec = format!("HEAD:{}", path.as_str());
    let (ok_head, _stdout_head, _stderr_head) = run_git_status(&repo_path, &["cat-file", "-e", head_spec.as_str()])?;
    if !ok_head {
        let _ = run_git_status(&repo_path, &["reset", "-q", "--", path.as_str()]);
        let _ = delete_working_path(&repo_path, path.as_str());
        return Ok(());
    }

    let msg = if !stderr.trim().is_empty() {
        stderr
    } else if !stderr_reset.trim().is_empty() {
        stderr_reset
    } else if !stderr_checkout.trim().is_empty() {
        stderr_checkout
    } else {
        String::from("Failed to discard changes for path.")
    };
    Err(msg)
}

#[tauri::command]
fn git_add_to_gitignore(repo_path: String, pattern: String) -> Result<(), String> {
    ensure_is_git_worktree(&repo_path)?;

    let pattern = pattern.trim().replace('\\', "/");
    if pattern.is_empty() {
        return Err(String::from("pattern is empty"));
    }
    ensure_rel_path_safe(pattern.as_str())?;

    let gitignore_path = Path::new(&repo_path).join(".gitignore");
    let mut content = fs::read_to_string(gitignore_path.as_path()).unwrap_or_default();
    let needle = pattern.trim_end_matches('/');
    let needle_dir = format!("{needle}/");

    let mut already = false;
    for line in content.lines() {
        let l = line.trim_end_matches('\r').trim();
        if l == needle || l == needle_dir {
            already = true;
            break;
        }
    }

    if already {
        return Ok(());
    }

    if !content.is_empty() && !content.ends_with('\n') {
        content.push('\n');
    }
    content.push_str(pattern.as_str());
    content.push('\n');

    fs::write(gitignore_path.as_path(), content).map_err(|e| format!("Failed to write .gitignore: {e}"))?;
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
struct GitCommit {
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
struct PullPredictGraphResult {
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
    action: String,
    conflict_files: Vec<String>,
    graph_commits: Vec<GitCommit>,
    created_node_ids: Vec<String>,
    head_name: String,
    remote_name: String,
}

#[derive(Debug, Clone, Serialize)]
struct GitBranchInfo {
    name: String,
    kind: String,
    target: String,
    committer_date: String,
}

#[derive(Debug, Clone, Serialize)]
struct GitCommitSummary {
    hash: String,
    author: String,
    date: String,
    subject: String,
    refs: String,
}

fn run_git(repo_path: &str, args: &[&str]) -> Result<String, String> {
    let out = git_command_in_repo(repo_path)
        .args(args)
        .output()
        .map_err(|e| format!("Failed to spawn git: {e}"))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(format!("git command failed: {stderr}"));
    }

    Ok(String::from_utf8_lossy(&out.stdout).trim_end().to_string())
}

fn run_git_with_stdin(repo_path: &str, args: &[&str], stdin_data: &str) -> Result<String, String> {
    let mut child = git_command_in_repo(repo_path)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn git: {e}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(stdin_data.as_bytes())
            .map_err(|e| format!("Failed to write to git stdin: {e}"))?;
    }

    let out = child
        .wait_with_output()
        .map_err(|e| format!("Failed to wait for git: {e}"))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(format!("git command failed: {stderr}"));
    }

    Ok(String::from_utf8_lossy(&out.stdout).trim_end().to_string())
}

fn run_git_stdout_raw(repo_path: &str, args: &[&str]) -> Result<String, String> {
    let out = git_command_in_repo(repo_path)
        .args(args)
        .output()
        .map_err(|e| format!("Failed to spawn git: {e}"))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(format!("git command failed: {stderr}"));
    }

    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

fn parse_for_each_ref(raw: &str, kind: &str) -> Vec<GitBranchInfo> {
    let mut out: Vec<GitBranchInfo> = Vec::new();
    for line in raw.lines() {
        let t = line.trim();
        if t.is_empty() {
            continue;
        }

        let parts: Vec<&str> = t.split('\x1f').collect();
        let name = parts.get(0).unwrap_or(&"").trim().to_string();
        let target = parts.get(1).unwrap_or(&"").trim().to_string();
        let committer_date = parts.get(2).unwrap_or(&"").trim().to_string();

        if name.is_empty() {
            continue;
        }

        if kind == "remote" && (name.ends_with("/HEAD") || name.contains("->")) {
            continue;
        }

        out.push(GitBranchInfo {
            name,
            kind: kind.to_string(),
            target,
            committer_date,
        });
    }
    out
}

fn list_unmerged_files(repo_path: &str) -> Vec<String> {
    let raw = match run_git(repo_path, &["diff", "--name-only", "--diff-filter=U"]) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    let mut files: Vec<String> = raw
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .map(|l| l.to_string())
        .collect();
    files.sort();
    files.dedup();
    files
}

fn safe_repo_join(repo_path: &str, rel_path: &str) -> Result<PathBuf, String> {
    let rel_path = rel_path.trim();
    if rel_path.is_empty() {
        return Err(String::from("path is empty"));
    }

    let p = Path::new(rel_path);
    if p.is_absolute() {
        return Err(String::from("path must be relative"));
    }

    for c in p.components() {
        if matches!(c, std::path::Component::ParentDir) {
            return Err(String::from("path must not contain '..'"));
        }
    }

    Ok(Path::new(repo_path).join(p))
}

fn sanitize_filename(s: &str) -> String {
    let mut out = String::new();
    for ch in s.chars() {
        if ch.is_ascii_alphanumeric() || ch == '.' || ch == '-' || ch == '_' {
            out.push(ch);
        } else {
            out.push('_');
        }
    }
    if out.is_empty() {
        String::from("file")
    } else {
        out
    }
}

fn file_extension_lower(path: &str) -> String {
    Path::new(path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn truncate_preview(mut s: String) -> String {
    const MAX_CHARS: usize = 400_000;
    if s.len() <= MAX_CHARS {
        return s;
    }
    s.truncate(MAX_CHARS);
    s
}

fn extract_docx_text(bytes: &[u8]) -> Result<String, String> {
    let cursor = std::io::Cursor::new(bytes);
    let mut zip = ZipArchive::new(cursor).map_err(|e| format!("Failed to open docx zip: {e}"))?;
    let mut file = zip
        .by_name("word/document.xml")
        .map_err(|e| format!("Failed to open word/document.xml: {e}"))?;

    let mut xml_bytes: Vec<u8> = Vec::new();
    file.read_to_end(&mut xml_bytes)
        .map_err(|e| format!("Failed to read document.xml: {e}"))?;

    let xml = String::from_utf8_lossy(xml_bytes.as_slice());
    let mut reader = XmlReader::from_str(xml.as_ref());
    reader.trim_text(true);
    let mut buf: Vec<u8> = Vec::new();
    let mut out = String::new();
    let mut in_text = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(XmlEvent::Start(e)) => {
                if e.name().as_ref() == b"w:t" {
                    in_text = true;
                } else if e.name().as_ref() == b"w:tab" {
                    out.push('\t');
                } else if e.name().as_ref() == b"w:br" || e.name().as_ref() == b"w:cr" {
                    out.push('\n');
                }
            }
            Ok(XmlEvent::End(e)) => {
                if e.name().as_ref() == b"w:t" {
                    in_text = false;
                } else if e.name().as_ref() == b"w:p" {
                    if !out.ends_with('\n') {
                        out.push('\n');
                    }
                }
            }
            Ok(XmlEvent::Text(e)) => {
                if in_text {
                    let t = e
                        .unescape()
                        .map_err(|e| format!("Failed to decode docx text: {e}"))?;
                    out.push_str(t.as_ref());
                }
            }
            Ok(XmlEvent::Eof) => break,
            Err(e) => return Err(format!("Failed to parse docx xml: {e}")),
            _ => {}
        }
        buf.clear();
    }

    Ok(out.trim_end().to_string())
}

fn extract_pdf_text(bytes: &[u8]) -> Result<String, String> {
    pdf_extract::extract_text_from_mem(bytes).map_err(|e| format!("Failed to extract pdf text: {e}"))
}

fn extract_xlsx_text(bytes: &[u8]) -> Result<String, String> {
    let cursor = std::io::Cursor::new(bytes.to_vec());
    let mut workbook = calamine::open_workbook_auto_from_rs(cursor)
        .map_err(|e| format!("Failed to open workbook: {e}"))?;

    let sheet_names = workbook.sheet_names().to_owned();
    let mut out = String::new();
    for (i, name) in sheet_names.iter().enumerate() {
        if i > 0 {
            out.push('\n');
        }
        out.push_str(name);
        out.push('\n');
        out.push_str("---\n");

        if let Ok(range) = workbook.worksheet_range(name) {
            for row in range.rows() {
                let mut first = true;
                for cell in row.iter() {
                    if !first {
                        out.push('\t');
                    }
                    first = false;
                    out.push_str(format!("{cell}").as_str());
                }
                out.push('\n');
            }
        }
    }

    Ok(out.trim_end().to_string())
}

fn extract_text_preview(path: &str, bytes: &[u8]) -> Result<String, String> {
    let ext = file_extension_lower(path);
    let text = match ext.as_str() {
        "docx" => extract_docx_text(bytes)?,
        "pdf" => extract_pdf_text(bytes)?,
        "xlsx" | "xlsm" | "xltx" | "xltm" => extract_xlsx_text(bytes)?,
        _ => {
            if bytes.iter().any(|b| *b == 0) {
                return Err(String::from("Binary file preview is not supported."));
            }
            String::from_utf8_lossy(bytes).to_string()
        }
    };
    Ok(truncate_preview(text))
}

fn make_temp_diff_dir() -> Result<PathBuf, String> {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("Failed to get system time: {e}"))?
        .as_millis();
    let dir = std::env::temp_dir().join(format!("graphoria-diff-{ts}"));
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create temp dir: {e}"))?;
    Ok(dir)
}

fn write_temp_file(dir: &Path, name: &str, content: &str) -> Result<PathBuf, String> {
    let p = dir.join(name);
    fs::write(&p, content.as_bytes()).map_err(|e| format!("Failed to write temp file: {e}"))?;
    Ok(p)
}

fn write_temp_file_bytes(dir: &Path, name: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let p = dir.join(name);
    fs::write(&p, bytes).map_err(|e| format!("Failed to write temp file: {e}"))?;
    Ok(p)
}

fn expand_external_diff_command(tool_path: &str, command: &str, local: &Path, remote: &Path, base: &Path) -> Result<String, String> {
    let tool_path = tool_path.trim();
    let mut cmd = command.trim().to_string();

    if cmd.is_empty() {
        if tool_path.is_empty() {
            return Err(String::from("Diff tool Path and Command are empty."));
        }
        cmd = format!("\"{tool_path}\" \"$LOCAL\" \"$REMOTE\"");
    }

    if !tool_path.is_empty() {
        let base_name = Path::new(tool_path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        if !base_name.is_empty() {
            let lower = cmd.to_lowercase();
            let bn_lower = base_name.to_lowercase();
            if lower.starts_with(&bn_lower) {
                cmd = format!("\"{tool_path}\"{}", &cmd[base_name.len()..]);
            }
        }
    }

    let local_s = local.to_string_lossy();
    let remote_s = remote.to_string_lossy();
    let base_s = base.to_string_lossy();
    cmd = cmd.replace("$LOCAL", local_s.as_ref());
    cmd = cmd.replace("$REMOTE", remote_s.as_ref());
    cmd = cmd.replace("$BASE", base_s.as_ref());
    Ok(cmd)
}

fn spawn_external_command(repo_path: &str, command: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .current_dir(repo_path)
            .args(["/C", command])
            .spawn()
            .map_err(|e| format!("Failed to start diff tool: {e}"))?;
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        Command::new("sh")
            .current_dir(repo_path)
            .args(["-lc", command])
            .spawn()
            .map_err(|e| format!("Failed to start diff tool: {e}"))?;
        return Ok(());
    }
}

fn run_git_status(repo_path: &str, args: &[&str]) -> Result<(bool, String, String), String> {
    let out = git_command_in_repo(repo_path)
        .args(args)
        .output()
        .map_err(|e| format!("Failed to spawn git: {e}"))?;

    let stdout = String::from_utf8_lossy(&out.stdout).trim_end().to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).trim_end().to_string();
    Ok((out.status.success(), stdout, stderr))
}

fn has_staged_changes(repo_path: &str) -> Result<bool, String> {
    let out = git_command_in_repo(repo_path)
        .args(["diff", "--cached", "--quiet"])
        .output()
        .map_err(|e| format!("Failed to spawn git diff --cached: {e}"))?;

    if out.status.success() {
        return Ok(false);
    }

    if out.status.code() == Some(1) {
        return Ok(true);
    }

    let stderr = String::from_utf8_lossy(&out.stderr).trim_end().to_string();
    Err(if !stderr.is_empty() {
        format!("git diff --cached failed: {stderr}")
    } else {
        String::from("git diff --cached failed.")
    })
}

fn is_rebase_in_progress(repo_path: &str) -> bool {
    git_command_in_repo(repo_path)
        .args(["rev-parse", "--verify", "-q", "REBASE_HEAD"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn is_merge_in_progress(repo_path: &str) -> bool {
    git_command_in_repo(repo_path)
        .args(["rev-parse", "--verify", "-q", "MERGE_HEAD"])
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
    let upstream_out = git_command_in_repo(repo_path)
        .args(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
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
    let verify_out = git_command_in_repo(repo_path)
        .args(["show-ref", "--verify", "--quiet", verify_ref.as_str()])
        .output();

    if let Ok(o) = verify_out {
        if o.status.success() {
            return Some(format!("{remote_name}/{head_name}"));
        }
    }

    None
}

fn merge_tree_header_is_conflict(header: &str) -> bool {
    let h = header.trim().to_lowercase();
    h.contains("conflict")
        || h.contains("changed in both")
        || h.contains("added in both")
        || h.contains("deleted in both")
        || h.contains("removed in both")
        || h.contains("rename")
        || h.contains("modify/delete")
        || h.contains("delete/modify")
        || h.contains("directory/file")
        || h.contains("file/directory")
}

fn normalize_conflict_path_candidate(s: &str) -> String {
    let t = s.trim().trim_matches('.').trim_matches(':').trim();
    t.to_string()
}

fn extract_path_from_conflict_header(header: &str) -> Option<String> {
    let h = header.trim();
    if h.is_empty() {
        return None;
    }

    let after_colon = if let Some(i) = h.find(':') { &h[i + 1..] } else { h };
    let after_colon = after_colon.trim();
    if after_colon.is_empty() {
        return None;
    }

    let lower = after_colon.to_lowercase();
    if let Some(i) = lower.find("merge conflict in ") {
        let p = normalize_conflict_path_candidate(&after_colon[i + "merge conflict in ".len()..]);
        if !p.is_empty() {
            return Some(p);
        }
    }

    let first = after_colon.split_whitespace().next().unwrap_or("");
    let first = normalize_conflict_path_candidate(first);
    if first.is_empty() {
        return None;
    }
    if first.eq_ignore_ascii_case("merge") || first.eq_ignore_ascii_case("conflict") {
        return None;
    }
    Some(first)
}

fn parse_merge_tree_conflict_paths(stdout: &str) -> Vec<String> {
    let mut files: Vec<String> = Vec::new();
    let mut in_conflict_block = false;

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let starts_with_alpha = trimmed
            .chars()
            .next()
            .map(|c| c.is_ascii_alphabetic())
            .unwrap_or(false);

        if starts_with_alpha && !trimmed.starts_with("base ") && !trimmed.starts_with("our ") && !trimmed.starts_with("their ") {
            in_conflict_block = merge_tree_header_is_conflict(trimmed);
            if in_conflict_block {
                let is_explicit_conflict = trimmed.to_lowercase().contains("conflict");
                if is_explicit_conflict {
                    if let Some(p) = extract_path_from_conflict_header(trimmed) {
                        if !p.trim().is_empty() {
                            files.push(p);
                        }
                    }
                }
            }
            continue;
        }

        if !in_conflict_block {
            continue;
        }

        if let Some(rest) = trimmed.strip_prefix("diff --cc ") {
            let p = normalize_conflict_path_candidate(rest);
            if !p.is_empty() {
                files.push(p);
            }
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("diff --combined ") {
            let p = normalize_conflict_path_candidate(rest);
            if !p.is_empty() {
                files.push(p);
            }
            continue;
        }

        if trimmed.starts_with("base ") || trimmed.starts_with("our ") || trimmed.starts_with("their ") {
            let parts: Vec<&str> = trimmed.split_whitespace().collect();
            if parts.len() >= 4 {
                let p = parts[3..].join(" ");
                if !p.trim().is_empty() {
                    files.push(p);
                }
            } else if let Some(p) = parts.last() {
                if !p.trim().is_empty() {
                    files.push((*p).to_string());
                }
            }
        }
    }

    files.sort();
    files.dedup();
    files
}

fn predict_merge_conflicts(repo_path: &str, upstream: &str) -> Vec<String> {
    let base = match run_git(repo_path, &["merge-base", "HEAD", upstream]) {
        Ok(s) if !s.trim().is_empty() => s,
        _ => return Vec::new(),
    };

    let base = base.trim().to_string();

    let out = match git_command_in_repo(repo_path)
        .args([
            "merge-tree",
            "--write-tree",
            "--messages",
            "--merge-base",
            base.as_str(),
            "HEAD",
            upstream,
        ])
        .output()
    {
        Ok(o) => o,
        Err(_) => return Vec::new(),
    };
    match out.status.code() {
        Some(0) | Some(1) => {}
        _ => return Vec::new(),
    }

    let mut combined = String::new();
    combined.push_str(String::from_utf8_lossy(&out.stdout).as_ref());
    if !out.stderr.is_empty() {
        combined.push('\n');
        combined.push_str(String::from_utf8_lossy(&out.stderr).as_ref());
    }
    parse_merge_tree_conflict_paths(combined.as_str())
}

fn git_show_path_bytes_or_empty(repo_path: &str, rev: &str, path: &str) -> Result<Vec<u8>, String> {
    let spec = format!("{rev}:{path}");
    let out = git_command_in_repo(repo_path)
        .args(["show", spec.as_str()])
        .output()
        .map_err(|e| format!("Failed to spawn git show: {e}"))?;

    if out.status.success() {
        return Ok(out.stdout);
    }

    let stderr = String::from_utf8_lossy(&out.stderr).trim_end().to_string();
    let s = stderr.to_lowercase();
    if s.contains("does not exist in")
        || s.contains("exists on disk, but not in")
        || s.contains("path '")
        || s.contains("path \"")
    {
        return Ok(Vec::new());
    }

    Err(if !stderr.is_empty() {
        format!("git show failed: {stderr}")
    } else {
        String::from("git show failed.")
    })
}

fn is_git_dubious_ownership_error(stderr_lower: &str) -> bool {
    stderr_lower.contains("detected dubious ownership")
        || stderr_lower.contains("dubious ownership")
        || stderr_lower.contains("safe.directory")
}

fn ensure_is_git_worktree(repo_path: &str) -> Result<(), String> {
    let check = git_command_in_repo(repo_path)
        .args(["rev-parse", "--is-inside-work-tree"])
        .output()
        .map_err(|e| format!("Failed to spawn git: {e}"))?;

    if !check.status.success() {
        let stderr = String::from_utf8_lossy(&check.stderr).trim_end().to_string();
        let stderr_lower = stderr.to_lowercase();
        if !stderr.is_empty() && is_git_dubious_ownership_error(stderr_lower.as_str()) {
            return Err(format!("GIT_DUBIOUS_OWNERSHIP\n{stderr}"));
        }
        return Err(String::from("Selected path is not a Git working tree."));
    }

    let top = git_command_in_repo(repo_path)
        .args(["rev-parse", "--show-toplevel"])
        .output()
        .map_err(|e| format!("Failed to spawn git: {e}"))?;

    if !top.status.success() {
        return Err(String::from("Selected path is not a Git working tree."));
    }

    let top_s = String::from_utf8_lossy(&top.stdout).trim().to_string();
    if top_s.is_empty() {
        return Err(String::from("Selected path is not a Git working tree."));
    }

    let selected_norm = normalize_repo_path(repo_path);
    let top_norm = normalize_repo_path(top_s.as_str());
    if !selected_norm.eq_ignore_ascii_case(top_norm.as_str()) {
        return Err(format!(
            "Selected path must be the Git repository root (folder containing .git). Try: {top_s}"
        ));
    }

    Ok(())
}

fn ensure_is_not_git_worktree(repo_path: &str) -> Result<(), String> {
    let check = git_command_in_repo(repo_path)
        .args(["rev-parse", "--is-inside-work-tree"])
        .output()
        .map_err(|e| format!("Failed to spawn git: {e}"))?;

    if check.status.success() {
        return Err(String::from("Selected path is already a Git working tree."));
    }

    Ok(())
}

#[tauri::command]
fn open_in_file_explorer(path: String) -> Result<(), String> {
    let path = path.trim().to_string();
    if path.is_empty() {
        return Err(String::from("path is empty"));
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to open file explorer: {e}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to open Finder: {e}"))?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to open file manager: {e}"))?;
    }

    Ok(())
}

fn push_history_order_args(args: &mut Vec<String>, history_order: &str) {
    match history_order {
        "date" => {
            args.push(String::from("--date-order"));
        }
        "first_parent" => {
            args.push(String::from("--first-parent"));
            args.push(String::from("--topo-order"));
        }
        _ => {
            args.push(String::from("--topo-order"));
        }
    }
}

fn list_commits_impl_v2(
    repo_path: &str,
    max_count: Option<u32>,
    only_head: bool,
    history_order: &str,
) -> Result<Vec<GitCommit>, String> {
    ensure_is_git_worktree(repo_path)?;

    let head = run_git(repo_path, &["rev-parse", "HEAD"]).unwrap_or_default();
    let head = head.trim().to_string();

    let format = "%H\x1f%P\x1f%an\x1f%ae\x1f%ad\x1f%s\x1f%D\x1e";
    let pretty = format!("--pretty=format:{format}");

    let mut args: Vec<String> = vec![String::from("--no-pager"), String::from("log")];

    if !only_head {
        args.push(String::from("--branches"));
        args.push(String::from("--tags"));
        args.push(String::from("--remotes"));
    }

    push_history_order_args(&mut args, history_order);
    args.push(String::from("--date=iso-strict"));
    args.push(pretty);

    if let Some(n) = max_count {
        args.push(String::from("-n"));
        args.push(n.to_string());
    }

    args.push(String::from("HEAD"));

    let output = git_command_in_repo(repo_path)
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
            author_email,
            date,
            subject,
            refs,
            is_head,
        });
    }

    Ok(commits)
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

    let add_out = git_command_in_repo(&repo_path)
        .args(&add_args)
        .output()
        .map_err(|e| format!("Failed to spawn git add: {e}"))?;

    if !add_out.status.success() {
        let stderr = String::from_utf8_lossy(&add_out.stderr);
        return Err(format!("git add failed: {stderr}"));
    }

    let commit_out = git_command_in_repo(&repo_path)
        .args(["commit", "-m", &message])
        .output()
        .map_err(|e| format!("Failed to spawn git commit: {e}"))?;

    if !commit_out.status.success() {
        let stderr = String::from_utf8_lossy(&commit_out.stderr);
        return Err(format!("git commit failed: {stderr}"));
    }

    let new_head = run_git(&repo_path, &["rev-parse", "HEAD"]).unwrap_or_default();

    Ok(new_head)
}

#[derive(Debug, Clone, Deserialize)]
struct GitPatchEntry {
    path: String,
    patch: String,
}

#[tauri::command]
fn git_commit_patch(repo_path: String, message: String, patches: Vec<GitPatchEntry>) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;

    let message = message.trim().to_string();
    if message.is_empty() {
        return Err(String::from("Commit message is empty."));
    }

    if patches.is_empty() {
        return Err(String::from("No hunks selected to commit."));
    }

    let mut normalized_patches: Vec<GitPatchEntry> = Vec::new();
    for p in patches.into_iter() {
        let path = p.path.trim().replace('\\', "/");
        if path.is_empty() {
            return Err(String::from("path is empty"));
        }
        ensure_rel_path_safe(path.as_str())?;

        let mut patch = p.patch.replace("\r\n", "\n");
        if patch.trim().is_empty() {
            return Err(String::from("patch is empty"));
        }
        if !patch.ends_with('\n') {
            patch.push('\n');
        }

        normalized_patches.push(GitPatchEntry { path, patch });
    }

    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let pid = std::process::id();
    let index_path = std::env::temp_dir().join(format!("graphoria_index_{pid}_{ms}.idx"));

    let cleanup = || {
        let _ = fs::remove_file(index_path.as_path());
    };

    let head_out = git_command_in_repo(&repo_path)
        .args(["rev-parse", "--verify", "HEAD"])
        .output();
    let head = match head_out {
        Ok(o) if o.status.success() => {
            let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if s.is_empty() { None } else { Some(s) }
        }
        _ => None,
    };

    let mut read_tree = git_command_in_repo(&repo_path);
    read_tree.env("GIT_INDEX_FILE", index_path.as_os_str());
    let read_tree_out = if head.is_some() {
        read_tree
            .args(["read-tree", "HEAD"])
            .output()
            .map_err(|e| format!("Failed to spawn git read-tree: {e}"))?
    } else {
        read_tree
            .args(["read-tree", "--empty"])
            .output()
            .map_err(|e| format!("Failed to spawn git read-tree: {e}"))?
    };

    if !read_tree_out.status.success() {
        cleanup();
        let stderr = String::from_utf8_lossy(&read_tree_out.stderr);
        return Err(format!("git read-tree failed: {stderr}"));
    }

    let run_with_stdin = |args: &[&str], stdin_data: &str| -> Result<(), String> {
        let mut child = git_command_in_repo(&repo_path)
            .env("GIT_INDEX_FILE", index_path.as_os_str())
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn git: {e}"))?;

        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(stdin_data.as_bytes())
                .map_err(|e| format!("Failed to write to git stdin: {e}"))?;
        }

        let out = child
            .wait_with_output()
            .map_err(|e| format!("Failed to wait for git: {e}"))?;

        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            return Err(format!("git command failed: {stderr}"));
        }

        Ok(())
    };

    for p in normalized_patches.iter() {
        let patch = p.patch.as_str();
        if run_with_stdin(
            &[
                "apply",
                "--cached",
                "--whitespace=nowarn",
                "--unidiff-zero",
                "--ignore-space-change",
            ],
            patch,
        )
        .is_err()
        {
            run_with_stdin(
                &[
                    "apply",
                    "--cached",
                    "--whitespace=nowarn",
                    "--unidiff-zero",
                    "--ignore-space-change",
                    "-C",
                    "0",
                    "--3way",
                    "--recount",
                ],
                patch,
            )?;
        }
    }

    let diff_cached_out = git_command_in_repo(&repo_path)
        .env("GIT_INDEX_FILE", index_path.as_os_str())
        .args(["diff", "--cached", "--quiet"])
        .output()
        .map_err(|e| format!("Failed to spawn git diff --cached: {e}"))?;

    if diff_cached_out.status.success() {
        cleanup();
        return Err(String::from("No hunks selected to commit."));
    }

    let commit_out = git_command_in_repo(&repo_path)
        .env("GIT_INDEX_FILE", index_path.as_os_str())
        .args(["commit", "-m", message.as_str()])
        .output()
        .map_err(|e| format!("Failed to spawn git commit: {e}"))?;

    if !commit_out.status.success() {
        cleanup();
        let stderr = String::from_utf8_lossy(&commit_out.stderr);
        return Err(format!("git commit failed: {stderr}"));
    }

    cleanup();

    let new_head = run_git(&repo_path, &["rev-parse", "HEAD"]).unwrap_or_default();
    Ok(new_head)
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

    with_repo_git_lock(&repo_path, || {
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

        let message = if !stderr.is_empty() {
            stderr.clone()
        } else {
            stdout.clone()
        };

        let merge_in_progress = is_merge_in_progress(&repo_path);
        let rebase_in_progress = is_rebase_in_progress(&repo_path);
        let mut conflict_files = list_unmerged_files(&repo_path);
        if conflict_files.is_empty() {
            conflict_files = parse_conflict_files(message.as_str());
        }

        if merge_in_progress || rebase_in_progress || !conflict_files.is_empty() {
            let op = if merge_in_progress {
                "merge"
            } else if rebase_in_progress {
                "rebase"
            } else {
                "merge"
            };
            return Ok(PullResult {
                status: String::from("conflicts"),
                operation: op.to_string(),
                message,
                conflict_files,
            });
        }

        Err(if !stderr.is_empty() {
            stderr
        } else {
            stdout
        })
    })
}

#[tauri::command]
fn git_pull_rebase(repo_path: String, remote_name: Option<String>) -> Result<PullResult, String> {
    ensure_is_git_worktree(&repo_path)?;

    with_repo_git_lock(&repo_path, || {
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

        let message = if !stderr.is_empty() {
            stderr.clone()
        } else {
            stdout.clone()
        };

        let merge_in_progress = is_merge_in_progress(&repo_path);
        let rebase_in_progress = is_rebase_in_progress(&repo_path);
        let mut conflict_files = list_unmerged_files(&repo_path);
        if conflict_files.is_empty() {
            conflict_files = parse_conflict_files(message.as_str());
        }

        if merge_in_progress || rebase_in_progress || !conflict_files.is_empty() {
            let op = if rebase_in_progress {
                "rebase"
            } else if merge_in_progress {
                "merge"
            } else {
                "rebase"
            };
            return Ok(PullResult {
                status: String::from("conflicts"),
                operation: op.to_string(),
                message,
                conflict_files,
            });
        }

        Err(if !stderr.is_empty() {
            stderr
        } else {
            stdout
        })
    })
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

    with_repo_git_lock(&repo_path, || {
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
    })
}

#[tauri::command]
fn git_pull_predict_graph(
    repo_path: String,
    remote_name: Option<String>,
    rebase: Option<bool>,
    max_commits: Option<u32>,
) -> Result<PullPredictGraphResult, String> {
    ensure_is_git_worktree(&repo_path)?;

    with_repo_git_lock(&repo_path, || {
        let remote_name = remote_name.unwrap_or_else(|| String::from("origin"));
        let rebase = rebase.unwrap_or(false);
        let max_commits = max_commits.unwrap_or(60).max(10).min(200);

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

        let local_head = run_git(&repo_path, &["rev-parse", "HEAD"]).unwrap_or_default().trim().to_string();
        let upstream_head = upstream
            .as_ref()
            .and_then(|u| run_git(&repo_path, &["rev-parse", u.as_str()]).ok())
            .unwrap_or_default()
            .trim()
            .to_string();

        let mut created_node_ids: Vec<String> = Vec::new();
        let mut graph_commits: Vec<GitCommit> = Vec::new();
        let mut predicted_head_id = local_head.clone();

        if upstream.is_none() {
            let mut commits = git_log_commits_multi(&repo_path, &[String::from("HEAD")], max_commits)?;
            graph_commits.append(&mut commits);
        } else if action == "noop" {
            let mut commits = git_log_commits_multi(&repo_path, &[String::from("HEAD")], max_commits)?;
            graph_commits.append(&mut commits);
        } else if action == "fast-forward" {
            let mut commits = if !upstream_head.is_empty() {
                git_log_commits_multi(&repo_path, &[upstream_head.clone()], max_commits)?
            } else {
                git_log_commits_multi(&repo_path, &[String::from("HEAD")], max_commits)?
            };
            predicted_head_id = upstream_head.clone();
            graph_commits.append(&mut commits);
        } else if action == "merge-commit" {
            let id = String::from("predict:merge");
            created_node_ids.push(id.clone());
            predicted_head_id = id.clone();
            graph_commits.push(GitCommit {
                hash: id,
                parents: vec![local_head.clone(), upstream_head.clone()].into_iter().filter(|s| !s.is_empty()).collect(),
                author: String::from("(predict)"),
                author_email: String::new(),
                date: String::new(),
                subject: String::from("Merge commit"),
                refs: String::new(),
                is_head: true,
            });

            let revs = vec![local_head.clone(), upstream_head.clone()]
                .into_iter()
                .filter(|s| !s.is_empty())
                .collect::<Vec<String>>();
            let mut commits = git_log_commits_multi(&repo_path, revs.as_slice(), max_commits.saturating_sub(1))?;
            graph_commits.append(&mut commits);
        } else if action == "rebase" {
            let max_rebased = max_commits.min(40);
            let subjects = if !upstream_head.is_empty() {
                git_log_subjects_for_range(&repo_path, format!("{}..HEAD", upstream_head).as_str(), max_rebased)?
            } else {
                Vec::new()
            };

            let mut last_parent = upstream_head.clone();
            let mut rebased: Vec<GitCommit> = Vec::new();
            for (i, subj) in subjects.iter().enumerate() {
                let id = format!("predict:rebase:{}", i + 1);
                created_node_ids.push(id.clone());
                rebased.push(GitCommit {
                    hash: id.clone(),
                    parents: if last_parent.trim().is_empty() { vec![] } else { vec![last_parent.clone()] },
                    author: String::from("(predict)"),
                    author_email: String::new(),
                    date: String::new(),
                    subject: subj.clone(),
                    refs: String::new(),
                    is_head: false,
                });
                last_parent = id;
            }

            rebased.reverse();
            if let Some(first) = rebased.first() {
                predicted_head_id = first.hash.clone();
            }
            graph_commits.append(&mut rebased);

            if !upstream_head.is_empty() {
                let mut commits = git_log_commits_multi(&repo_path, &[upstream_head.clone()], max_commits.saturating_sub(subjects.len() as u32))?;
                graph_commits.append(&mut commits);
            }
        }

        for c in graph_commits.iter_mut() {
            c.is_head = c.hash == predicted_head_id;
            if c.is_head {
                c.refs = format!("HEAD -> {}", head_name);
            } else {
                c.refs = String::new();
            }
        }

        Ok(PullPredictGraphResult {
            upstream,
            ahead,
            behind,
            action,
            conflict_files,
            graph_commits,
            created_node_ids,
            head_name,
            remote_name,
        })
    })
}

#[tauri::command]
fn git_pull_predict_conflict_preview(repo_path: String, upstream: String, path: String) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;

    let upstream = upstream.trim().to_string();
    if upstream.is_empty() {
        return Err(String::from("upstream is empty"));
    }

    let path = path.trim().to_string();
    if path.is_empty() {
        return Err(String::from("path is empty"));
    }

    let _ = safe_repo_join(&repo_path, path.as_str()).map_err(|e| format!("Invalid path: {e}"))?;

    let base = run_git(&repo_path, &["merge-base", "HEAD", upstream.as_str()])?;
    let base = base.trim().to_string();
    if base.is_empty() {
        return Err(String::from("Failed to determine merge-base."));
    }

    let base_bytes = git_show_path_bytes_or_empty(&repo_path, base.as_str(), path.as_str())?;
    let our_bytes = git_show_path_bytes_or_empty(&repo_path, "HEAD", path.as_str())?;
    let their_bytes = git_show_path_bytes_or_empty(&repo_path, upstream.as_str(), path.as_str())?;

    if base_bytes.iter().any(|b| *b == 0) || our_bytes.iter().any(|b| *b == 0) || their_bytes.iter().any(|b| *b == 0) {
        return Err(String::from("Binary file preview is not supported."));
    }

    let dir = make_temp_diff_dir()?;
    let ours_path = write_temp_file_bytes(dir.as_path(), "ours.txt", our_bytes.as_slice())?;
    let base_path = write_temp_file_bytes(dir.as_path(), "base.txt", base_bytes.as_slice())?;
    let theirs_path = write_temp_file_bytes(dir.as_path(), "theirs.txt", their_bytes.as_slice())?;

    let out = git_command_in_repo(&repo_path)
        .arg("merge-file")
        .arg("-p")
        .arg("--diff3")
        .arg("-L")
        .arg("ours")
        .arg("-L")
        .arg("base")
        .arg("-L")
        .arg("theirs")
        .arg(&ours_path)
        .arg(&base_path)
        .arg(&theirs_path)
        .output()
        .map_err(|e| format!("Failed to spawn git merge-file: {e}"))?;

    let _ = fs::remove_dir_all(&dir);

    match out.status.code() {
        Some(0) | Some(1) => Ok(String::from_utf8_lossy(&out.stdout).to_string()),
        _ => {
            let stderr = String::from_utf8_lossy(&out.stderr).trim_end().to_string();
            Err(if !stderr.is_empty() {
                format!("git merge-file failed: {stderr}")
            } else {
                String::from("git merge-file failed.")
            })
        }
    }
}

#[tauri::command]
async fn git_fetch(repo_path: String, remote_name: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_is_git_worktree(&repo_path)?;

        with_repo_git_lock(&repo_path, || {
            let remote_name = remote_name.unwrap_or_else(|| String::from("origin"));
            run_git(&repo_path, &["fetch", remote_name.as_str()])
        })
    })
    .await
    .map_err(|e| format!("Failed to run git fetch: {e}"))?
}

#[tauri::command]
fn git_commit_summary(repo_path: String, commit: String) -> Result<GitCommitSummary, String> {
    ensure_is_git_worktree(&repo_path)?;

    let commit = commit.trim().to_string();
    if commit.is_empty() {
        return Err(String::from("commit is empty"));
    }

    let fmt = "%H\x1f%an\x1f%ad\x1f%s\x1f%D";
    let pretty = format!("--pretty=format:{fmt}");
    let raw = run_git(
        &repo_path,
        &[
            "--no-pager",
            "show",
            "-s",
            "--date=iso-strict",
            pretty.as_str(),
            commit.as_str(),
        ],
    )?;
    let parts: Vec<&str> = raw.split('\x1f').collect();

    Ok(GitCommitSummary {
        hash: parts.get(0).unwrap_or(&"").trim().to_string(),
        author: parts.get(1).unwrap_or(&"").trim().to_string(),
        date: parts.get(2).unwrap_or(&"").trim().to_string(),
        subject: parts.get(3).unwrap_or(&"").trim().to_string(),
        refs: parts.get(4).unwrap_or(&"").trim().to_string(),
    })
}

#[tauri::command]
fn git_commit_all(repo_path: String, message: String) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;

    let message = message.trim().to_string();
    if message.is_empty() {
        return Err(String::from("Commit message is empty."));
    }

    let out = git_command_in_repo(&repo_path)
        .args(["commit", "-a", "-m", &message])
        .output()
        .map_err(|e| format!("Failed to spawn git commit: {e}"))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(format!("git commit failed: {stderr}"));
    }

    let new_head = run_git(&repo_path, &["rev-parse", "HEAD"]).unwrap_or_default();
    Ok(new_head)
}

#[tauri::command]
fn git_merge_branch(repo_path: String, branch: String) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;

    let branch = branch.trim().to_string();
    if branch.is_empty() {
        return Err(String::from("branch is empty"));
    }

    run_git(&repo_path, &["merge", branch.as_str()])
}

#[tauri::command]
async fn open_devtools_main(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        let wv = app
            .get_webview_window("main")
            .ok_or_else(|| String::from("main webview window not found"))?;
        wv.open_devtools();
        Ok(())
    }

    #[cfg(not(debug_assertions))]
    {
        let _ = app;
        Err(String::from("devtools is disabled in release builds"))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            open_devtools_main,
            greet,
            repo_overview,
            list_commits,
            list_commits_full,
            init_repo,
            open_in_file_explorer,
            reveal_in_file_explorer,
            git_check_worktree,
            git_trust_repo_global,
            git_trust_repo_session,
            git_set_user_identity,
            get_current_username,
            change_repo_ownership_to_current_user,
            git_resolve_ref,
            git_ls_remote_heads,
            git_clone_repo,
            git_status,
            git_has_staged_changes,
            git_stash_list,
            git_stash_show,
            git_stash_base_commit,
            git_stash_apply,
            git_stash_drop,
            git_stash_clear,
            git_stash_push_paths,
            git_stash_push_patch,
            git_commit_changes,
            git_commit_file_diff,
            git_commit_file_content,
            git_working_file_diff,
            git_working_file_diff_unified,
            git_working_file_content,
            git_working_file_text_preview,
            git_head_file_content,
            git_head_file_text_preview,
            read_text_file,
            git_head_vs_working_diff,
            git_head_vs_working_text_diff,
            git_diff_no_index,
            git_working_file_image_base64,
            git_launch_external_diff_working,
            git_launch_external_diff_commit,
            git_discard_working_path,
            git_delete_working_path,
            git_add_to_gitignore,
            git_commit,
            git_commit_patch,
            git_status_summary,
            git_ahead_behind,
            git_get_remote_url,
            git_set_remote_url,
            git_push,
            git_fetch,
            git_checkout_commit,
            git_checkout_branch,
            git_list_branches,
            git_commit_summary,
            git_switch,
            git_rename_branch,
            git_create_branch_advanced,
            git_reset_hard,
            git_reset,
            git_is_ancestor,
            git_commit_all,
            git_create_branch,
            git_delete_branch,
            git_merge_branch,
            git_reflog,
            git_cherry_pick,
            git_branches_points_at,
            open_terminal,
            open_terminal_profile,
            git_pull,
            git_pull_rebase,
            git_merge_continue,
            git_merge_abort,
            git_rebase_continue,
            git_rebase_abort,
            git_rebase_skip,
            git_conflict_state,
            git_conflict_file_versions,
            git_conflict_take_ours,
            git_conflict_take_theirs,
            git_conflict_apply_and_stage,
            git_pull_predict,
            git_pull_predict_graph,
            git_pull_predict_conflict_preview,
            git_create_tag,
            git_delete_tag,
            git_delete_remote_tag,
            git_list_tag_targets,
            git_list_remote_tag_targets,
            git_push_tags,
            git_rename_tag
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use tempfile::TempDir;

    fn git(repo_dir: &Path, args: &[&str]) -> String {
        let out = Command::new("git")
            .current_dir(repo_dir)
            .args(args)
            .output()
            .unwrap();

        if !out.status.success() {
            panic!(
                "git failed: {:?}\nstdout: {}\nstderr: {}",
                args,
                String::from_utf8_lossy(&out.stdout),
                String::from_utf8_lossy(&out.stderr)
            );
        }

        String::from_utf8_lossy(&out.stdout).trim_end().to_string()
    }

    fn init_repo(dir: &Path) {
        git(dir, &["init"]);
        git(dir, &["config", "user.name", "Graphoria Test"]);
        git(dir, &["config", "user.email", "graphoria@test.local"]);
    }

    fn set_user(dir: &Path, name: &str, email: &str) {
        git(dir, &["config", "user.name", name]);
        git(dir, &["config", "user.email", email]);
    }

    fn write_file(repo_dir: &Path, rel_path: &str, content: &str) {
        let p = repo_dir.join(rel_path);
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(&p, content).unwrap();
    }

    fn commit_via_graphoria(repo_dir: &Path, rel_path: &str, content: &str, message: &str) -> String {
        write_file(repo_dir, rel_path, content);
        git_commit(
            repo_dir.to_string_lossy().to_string(),
            message.to_string(),
            vec![rel_path.to_string()],
        )
        .unwrap()
    }

    fn push_via_graphoria(repo_dir: &Path, remote: &str, branch: &str) {
        git_push(
            repo_dir.to_string_lossy().to_string(),
            Some(remote.to_string()),
            Some(branch.to_string()),
            Some(false),
            Some(true),
        )
        .unwrap();
    }

    fn head_hash(repo_dir: &Path) -> String {
        git(repo_dir, &["rev-parse", "HEAD"]).trim().to_string()
    }

    fn head_parents(repo_dir: &Path) -> Vec<String> {
        let raw = git(repo_dir, &["rev-list", "--parents", "-n", "1", "HEAD"]);
        raw.split_whitespace().map(|s| s.to_string()).collect()
    }

    fn commit_file(repo_dir: &Path, rel_path: &str, content: &str, message: &str, author: (&str, &str)) -> String {
        let p = repo_dir.join(rel_path);
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(&p, content).unwrap();
        git(repo_dir, &["add", "--", rel_path]);
        let author_arg = format!("--author={} <{}>", author.0, author.1);
        git(repo_dir, &["commit", "-m", message, author_arg.as_str()]);
        git(repo_dir, &["rev-parse", "HEAD"])
    }

    fn repo_path(td: &TempDir, child: &str) -> PathBuf {
        let p = td.path().join(child);
        fs::create_dir_all(&p).unwrap();
        p
    }

    struct TwoUserEnv {
        _td: TempDir,
        _remote: PathBuf,
        alice: PathBuf,
        bob: PathBuf,
        branch: String,
    }

    fn setup_two_user_env() -> TwoUserEnv {
        let td = TempDir::new().unwrap();

        let remote = repo_path(&td, "remote.git");
        git(&remote, &["init", "--bare"]);

        let seed = repo_path(&td, "seed");
        init_repo(&seed);
        git(&seed, &["branch", "-M", "master"]);
        set_user(&seed, "Seeder", "seeder@example.com");
        commit_via_graphoria(&seed, "readme.md", "seed\n", "Seed");
        git(&seed, &["remote", "add", "origin", remote.to_string_lossy().as_ref()]);
        push_via_graphoria(&seed, "origin", "master");

        let alice = repo_path(&td, "alice");
        git(td.path(), &["clone", remote.to_string_lossy().as_ref(), alice.to_string_lossy().as_ref()]);
        set_user(&alice, "Alice", "alice@example.com");

        let bob = repo_path(&td, "bob");
        git(td.path(), &["clone", remote.to_string_lossy().as_ref(), bob.to_string_lossy().as_ref()]);
        set_user(&bob, "Bob", "bob@example.com");

        TwoUserEnv {
            _td: td,
            _remote: remote,
            alice,
            bob,
            branch: String::from("master"),
        }
    }

    fn trust_repo(repo_dir: &Path) {
        git_trust_repo_session(repo_dir.to_string_lossy().to_string()).unwrap();
    }

    #[test]
    fn test_list_commits_impl_v2_parses_author_and_refs() {
        let td = TempDir::new().unwrap();
        let repo = repo_path(&td, "repo");
        init_repo(&repo);

        let h1 = commit_file(
            &repo,
            "a.txt",
            "one\n",
            "Initial commit",
            ("Alice", "alice@example.com"),
        );
        git(&repo, &["tag", "v1.0.0", h1.as_str()]);

        let _h2 = commit_file(
            &repo,
            "b.txt",
            "two\n",
            "Second commit",
            ("Bob", "bob@example.com"),
        );

        git_trust_repo_session(repo.to_string_lossy().to_string()).unwrap();

        let commits = list_commits_impl_v2(repo.to_string_lossy().as_ref(), Some(50), false, "topo").unwrap();
        assert!(commits.len() >= 2);

        let head_hash = run_git(repo.to_string_lossy().as_ref(), &["rev-parse", "HEAD"]).unwrap();
        let head_hash = head_hash.trim().to_string();

        let head = commits.iter().find(|c| c.hash == head_hash).unwrap();
        assert!(head.is_head);
        assert_eq!(head.author, "Bob");
        assert_eq!(head.author_email, "bob@example.com");
        assert!(!head.refs.trim().is_empty());

        let tagged = commits.iter().find(|c| c.subject == "Initial commit").unwrap();
        assert_eq!(tagged.author, "Alice");
        assert_eq!(tagged.author_email, "alice@example.com");
        assert!(tagged.refs.contains("tag: v1.0.0"));
    }

    #[test]
    fn test_git_pull_fast_forward_updates_head() {
        let td = TempDir::new().unwrap();

        let remote = repo_path(&td, "remote.git");
        git(&remote, &["init", "--bare"]);

        let seed = repo_path(&td, "seed");
        init_repo(&seed);
        commit_file(
            &seed,
            "readme.md",
            "seed\n",
            "Seed",
            ("Seeder", "seeder@example.com"),
        );

        let branch = git(&seed, &["rev-parse", "--abbrev-ref", "HEAD"]);
        git(&seed, &["remote", "add", "origin", remote.to_string_lossy().as_ref()]);
        git(&seed, &["push", "-u", "origin", branch.as_str()]);

        let repo_a = repo_path(&td, "repo-a");
        git(td.path(), &["clone", remote.to_string_lossy().as_ref(), repo_a.to_string_lossy().as_ref()]);
        git(&repo_a, &["config", "user.name", "Graphoria Test"]);
        git(&repo_a, &["config", "user.email", "graphoria@test.local"]);

        let repo_b = repo_path(&td, "repo-b");
        git(td.path(), &["clone", remote.to_string_lossy().as_ref(), repo_b.to_string_lossy().as_ref()]);
        git(&repo_b, &["config", "user.name", "Graphoria Test"]);
        git(&repo_b, &["config", "user.email", "graphoria@test.local"]);

        commit_file(
            &repo_a,
            "change.txt",
            "new\n",
            "New commit",
            ("Pusher", "pusher@example.com"),
        );
        git(&repo_a, &["push", "origin", branch.as_str()]);

        git_trust_repo_session(repo_b.to_string_lossy().to_string()).unwrap();
        let before = run_git(repo_b.to_string_lossy().as_ref(), &["rev-parse", "HEAD"]).unwrap();

        let result = git_pull(repo_b.to_string_lossy().to_string(), Some(String::from("origin"))).unwrap();
        assert_eq!(result.status, "ok");
        assert_eq!(result.operation, "merge");

        let after = run_git(repo_b.to_string_lossy().as_ref(), &["rev-parse", "HEAD"]).unwrap();
        assert_ne!(before.trim(), after.trim());

        let commits = list_commits_impl_v2(repo_b.to_string_lossy().as_ref(), Some(50), false, "topo").unwrap();
        assert!(commits.iter().any(|c| c.subject == "New commit"));
    }

    #[test]
    fn test_git_pull_merge_no_conflicts_creates_merge_commit() {
        let env = setup_two_user_env();

        commit_via_graphoria(&env.bob, "bob.txt", "bob-1\n", "Bob local");
        let bob_before = head_hash(&env.bob);

        commit_via_graphoria(&env.alice, "alice.txt", "alice-1\n", "Alice upstream");
        push_via_graphoria(&env.alice, "origin", env.branch.as_str());
        let alice_head = head_hash(&env.alice);

        trust_repo(&env.bob);
        let result = git_pull(env.bob.to_string_lossy().to_string(), Some(String::from("origin"))).unwrap();
        assert_eq!(result.status, "ok");
        assert_eq!(result.operation, "merge");

        let bob_after = head_hash(&env.bob);
        assert_ne!(bob_before, bob_after);

        let parents = head_parents(&env.bob);
        assert_eq!(parents.len(), 3);
        assert!(parents.iter().any(|p| p == &alice_head));

        let commits = list_commits_impl_v2(env.bob.to_string_lossy().as_ref(), Some(50), false, "topo").unwrap();
        assert!(commits.iter().any(|c| c.subject == "Bob local"));
        assert!(commits.iter().any(|c| c.subject == "Alice upstream"));
    }

    #[test]
    fn test_git_pull_rebase_no_conflicts_rebases_local_commit() {
        let env = setup_two_user_env();

        let bob_local = commit_via_graphoria(&env.bob, "bob.txt", "bob-1\n", "Bob local");

        commit_via_graphoria(&env.alice, "alice.txt", "alice-1\n", "Alice upstream");
        push_via_graphoria(&env.alice, "origin", env.branch.as_str());
        let alice_head = head_hash(&env.alice);

        trust_repo(&env.bob);
        let result = git_pull_rebase(env.bob.to_string_lossy().to_string(), Some(String::from("origin"))).unwrap();
        assert_eq!(result.status, "ok");
        assert_eq!(result.operation, "rebase");

        let bob_after = head_hash(&env.bob);
        assert_ne!(bob_local.trim(), bob_after.trim());

        let parents = head_parents(&env.bob);
        assert_eq!(parents.len(), 2);
        assert_eq!(parents[1].trim(), alice_head.trim());

        let commits = list_commits_impl_v2(env.bob.to_string_lossy().as_ref(), Some(50), false, "topo").unwrap();
        assert!(commits.iter().any(|c| c.subject == "Bob local"));
        assert!(commits.iter().any(|c| c.subject == "Alice upstream"));
    }

    #[test]
    fn test_git_pull_predict_merge_no_conflicts_reports_empty_conflicts() {
        let env = setup_two_user_env();

        commit_via_graphoria(&env.bob, "bob.txt", "bob-1\n", "Bob local");
        commit_via_graphoria(&env.alice, "alice.txt", "alice-1\n", "Alice upstream");
        push_via_graphoria(&env.alice, "origin", env.branch.as_str());

        trust_repo(&env.bob);
        let pred = git_pull_predict(env.bob.to_string_lossy().to_string(), Some(String::from("origin")), Some(false)).unwrap();
        assert!(pred.behind > 0);
        assert!(pred.conflict_files.is_empty());
    }

    #[test]
    fn test_git_pull_predict_merge_conflicts_reports_conflicting_path() {
        let env = setup_two_user_env();

        commit_via_graphoria(&env.bob, "conflict.txt", "base\n", "Base");
        push_via_graphoria(&env.bob, "origin", env.branch.as_str());

        git(&env.alice, &["pull", "--ff-only"]);
        git(&env.bob, &["pull", "--ff-only"]);

        commit_via_graphoria(&env.bob, "conflict.txt", "bob-change\n", "Bob local");
        commit_via_graphoria(&env.alice, "conflict.txt", "alice-change\n", "Alice upstream");
        push_via_graphoria(&env.alice, "origin", env.branch.as_str());

        trust_repo(&env.bob);
        let pred = git_pull_predict(env.bob.to_string_lossy().to_string(), Some(String::from("origin")), Some(false)).unwrap();
        assert!(pred.behind > 0);
        assert!(pred.conflict_files.iter().any(|p| p == "conflict.txt"));
    }

    #[test]
    fn test_git_pull_predict_rebase_conflicts_reports_conflicting_path() {
        let env = setup_two_user_env();

        commit_via_graphoria(&env.bob, "conflict.txt", "base\n", "Base");
        push_via_graphoria(&env.bob, "origin", env.branch.as_str());

        git(&env.alice, &["pull", "--ff-only"]);
        git(&env.bob, &["pull", "--ff-only"]);

        commit_via_graphoria(&env.bob, "conflict.txt", "bob-change\n", "Bob local");
        commit_via_graphoria(&env.alice, "conflict.txt", "alice-change\n", "Alice upstream");
        push_via_graphoria(&env.alice, "origin", env.branch.as_str());

        trust_repo(&env.bob);
        let pred = git_pull_predict(env.bob.to_string_lossy().to_string(), Some(String::from("origin")), Some(true)).unwrap();
        assert!(pred.behind > 0);
        assert!(pred.conflict_files.iter().any(|p| p == "conflict.txt"));
    }

    #[test]
    fn test_pull_autochoose_prefers_rebase_without_conflicts() {
        let env = setup_two_user_env();

        commit_via_graphoria(&env.bob, "bob.txt", "bob-1\n", "Bob local");
        commit_via_graphoria(&env.alice, "alice.txt", "alice-1\n", "Alice upstream");
        push_via_graphoria(&env.alice, "origin", env.branch.as_str());

        trust_repo(&env.bob);
        let pred = git_pull_predict(env.bob.to_string_lossy().to_string(), Some(String::from("origin")), Some(true)).unwrap();
        assert!(pred.behind > 0);
        assert!(pred.conflict_files.is_empty());

        let result = git_pull_rebase(env.bob.to_string_lossy().to_string(), Some(String::from("origin"))).unwrap();
        assert_eq!(result.status, "ok");
        assert_eq!(result.operation, "rebase");
        let parents = head_parents(&env.bob);
        assert_eq!(parents.len(), 2);
    }

    #[test]
    fn test_pull_autochoose_falls_back_to_merge_when_conflicts_predicted() {
        let env = setup_two_user_env();

        commit_via_graphoria(&env.bob, "conflict.txt", "base\n", "Base");
        push_via_graphoria(&env.bob, "origin", env.branch.as_str());

        git(&env.alice, &["pull", "--ff-only"]);
        git(&env.bob, &["pull", "--ff-only"]);

        commit_via_graphoria(&env.bob, "conflict.txt", "bob-change\n", "Bob local");
        commit_via_graphoria(&env.alice, "conflict.txt", "alice-change\n", "Alice upstream");
        push_via_graphoria(&env.alice, "origin", env.branch.as_str());

        trust_repo(&env.bob);
        let pred = git_pull_predict(env.bob.to_string_lossy().to_string(), Some(String::from("origin")), Some(true)).unwrap();
        assert!(pred.behind > 0);
        assert!(pred.conflict_files.iter().any(|p| p == "conflict.txt"));

        let result = git_pull(env.bob.to_string_lossy().to_string(), Some(String::from("origin"))).unwrap();
        assert_eq!(result.operation, "merge");
        assert_eq!(result.status, "conflicts");
        assert!(result.conflict_files.iter().any(|p| p == "conflict.txt"));
    }
}
