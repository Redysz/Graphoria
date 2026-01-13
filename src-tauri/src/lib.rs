// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use serde::Serialize;
use tauri::Emitter;
use base64::Engine;
use quick_xml::events::Event as XmlEvent;
use quick_xml::Reader as XmlReader;
use zip::ZipArchive;
use calamine::Reader;
use std::io::{Read, Write};
use std::fs;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

static SESSION_SAFE_DIRECTORIES: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn session_safe_directories() -> &'static Mutex<HashSet<String>> {
    SESSION_SAFE_DIRECTORIES.get_or_init(|| Mutex::new(HashSet::new()))
}

fn normalize_repo_path(p: &str) -> String {
    p.trim().replace('\\', "/").trim_end_matches('/').to_string()
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
fn git_check_worktree(repo_path: String) -> Result<(), String> {
    ensure_is_git_worktree(repo_path.trim())
}

#[tauri::command]
fn git_trust_repo_global(repo_path: String) -> Result<(), String> {
    let repo_path = repo_path.trim().to_string();
    if repo_path.is_empty() {
        return Err(String::from("repo_path is empty"));
    }

    let normalized = repo_path.replace('\\', "/").trim_end_matches('/').to_string();

    let out = Command::new("git")
        .args([
            "config",
            "--global",
            "--add",
            "safe.directory",
            normalized.as_str(),
        ])
        .output()
        .map_err(|e| format!("Failed to spawn git: {e}"))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim_end().to_string();
        if !stderr.is_empty() {
            return Err(format!("git config failed: {stderr}"));
        }
        return Err(String::from("git config failed."));
    }

    Ok(())
}

#[tauri::command]
fn git_trust_repo_session(repo_path: String) -> Result<(), String> {
    let repo_path = repo_path.trim().to_string();
    if repo_path.is_empty() {
        return Err(String::from("repo_path is empty"));
    }
    let normalized = normalize_repo_path(repo_path.as_str());
    let set = session_safe_directories();
    let mut guard = set.lock().map_err(|_| String::from("Failed to lock session safe directories."))?;
    guard.insert(normalized);
    Ok(())
}

#[tauri::command]
fn get_current_username() -> Result<String, String> {
    let u = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| String::from("current user"));
    Ok(u)
}

#[tauri::command]
fn change_repo_ownership_to_current_user(repo_path: String) -> Result<(), String> {
    let repo_path = repo_path.trim().to_string();
    if repo_path.is_empty() {
        return Err(String::from("repo_path is empty"));
    }

    #[cfg(target_os = "windows")]
    {
        let user = std::env::var("USERNAME").unwrap_or_default();
        if user.trim().is_empty() {
            return Err(String::from("Could not determine current username."));
        }

        let takeown = Command::new("cmd")
            .args(["/C", "takeown", "/F", repo_path.as_str(), "/R", "/D", "Y"])
            .output()
            .map_err(|e| format!("Failed to run takeown: {e}"))?;

        if !takeown.status.success() {
            let stderr = String::from_utf8_lossy(&takeown.stderr).trim_end().to_string();
            let stdout = String::from_utf8_lossy(&takeown.stdout).trim_end().to_string();
            let msg = if !stderr.is_empty() { stderr } else { stdout };
            if !msg.is_empty() {
                return Err(format!("Failed to change ownership (takeown): {msg}"));
            }
            return Err(String::from("Failed to change ownership (takeown)."));
        }

        let icacls = Command::new("cmd")
            .args([
                "/C",
                "icacls",
                repo_path.as_str(),
                "/setowner",
                user.as_str(),
                "/T",
                "/C",
            ])
            .output()
            .map_err(|e| format!("Failed to run icacls: {e}"))?;

        if !icacls.status.success() {
            let stderr = String::from_utf8_lossy(&icacls.stderr).trim_end().to_string();
            let stdout = String::from_utf8_lossy(&icacls.stdout).trim_end().to_string();
            let msg = if !stderr.is_empty() { stderr } else { stdout };
            if !msg.is_empty() {
                return Err(format!("Failed to change ownership (icacls): {msg}"));
            }
            return Err(String::from("Failed to change ownership (icacls)."));
        }

        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = repo_path;
        return Err(String::from("Changing ownership is only implemented on Windows."));
    }
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
struct GitStashEntry {
    index: u32,
    reference: String,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
struct GitChangeEntry {
    status: String,
    path: String,
    old_path: Option<String>,
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
        .unwrap_or_default()
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
    let mut tags: Vec<String> = tags_raw
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .map(|l| l.to_string())
        .collect();
    tags.reverse();

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
fn git_resolve_ref(repo_path: String, reference: String) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;

    let reference = reference.trim().to_string();
    if reference.is_empty() {
        return Err(String::from("reference is empty"));
    }

    let hash = run_git(&repo_path, &["rev-list", "-n", "1", reference.as_str()])?;
    let hash = hash.trim().to_string();
    if hash.is_empty() {
        return Err(String::from("Could not resolve reference to a commit."));
    }

    Ok(hash)
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

    let format = "%H\x1f%P\x1f%an\x1f%ae\x1f%ad\x1f%s\x1f%D\x1e";
    let pretty = format!("--pretty=format:{format}");

    let mut args: Vec<String> = vec![
        String::from("--no-pager"),
        String::from("log"),
    ];

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
fn list_commits(
    repo_path: String,
    max_count: Option<u32>,
    only_head: Option<bool>,
    history_order: Option<String>,
) -> Result<Vec<GitCommit>, String> {
    let max_count = max_count.unwrap_or(200).min(2000);
    let history_order = history_order.unwrap_or_else(|| String::from("topo"));
    list_commits_impl_v2(&repo_path, Some(max_count), only_head.unwrap_or(false), &history_order)
}

#[tauri::command]
fn list_commits_full(repo_path: String, only_head: Option<bool>, history_order: Option<String>) -> Result<Vec<GitCommit>, String> {
    let history_order = history_order.unwrap_or_else(|| String::from("topo"));
    list_commits_impl_v2(&repo_path, None, only_head.unwrap_or(false), &history_order)
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

    let out = git_command_in_repo(&repo_path)
        .args(["status", "--porcelain", "-z"])
        .output()
        .map_err(|e| format!("Failed to spawn git: {e}"))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(format!("git command failed: {stderr}"));
    }

    let mut entries: Vec<GitStatusEntry> = Vec::new();
    let mut i: usize = 0;
    let b = out.stdout.as_slice();
    while i < b.len() {
        let start = i;
        while i < b.len() && b[i] != 0 {
            i += 1;
        }
        let rec = &b[start..i];
        i += 1;
        if rec.is_empty() {
            continue;
        }
        if rec.len() < 3 {
            continue;
        }

        let status_bytes = &rec[0..2];
        let status = String::from_utf8_lossy(status_bytes).to_string();

        let path_bytes = if rec.len() >= 4 { &rec[3..] } else { &[] };
        if path_bytes.is_empty() {
            continue;
        }

        let has_rename = status_bytes[0] == b'R'
            || status_bytes[1] == b'R'
            || status_bytes[0] == b'C'
            || status_bytes[1] == b'C';

        if has_rename {
            let old_path = String::from_utf8_lossy(path_bytes).to_string();

            let start2 = i;
            while i < b.len() && b[i] != 0 {
                i += 1;
            }
            let new_path_bytes = &b[start2..i];
            i += 1;

            let new_path = String::from_utf8_lossy(new_path_bytes).to_string();
            if !new_path.trim().is_empty() {
                entries.push(GitStatusEntry {
                    status,
                    path: new_path,
                });
            } else if !old_path.trim().is_empty() {
                entries.push(GitStatusEntry {
                    status,
                    path: old_path,
                });
            }
        } else {
            let path = String::from_utf8_lossy(path_bytes).to_string();
            if !path.trim().is_empty() {
                entries.push(GitStatusEntry { status, path });
            }
        }
    }

    Ok(entries)
}

#[tauri::command]
fn git_has_staged_changes(repo_path: String) -> Result<bool, String> {
    ensure_is_git_worktree(&repo_path)?;
    has_staged_changes(&repo_path)
}

#[tauri::command]
fn git_stash_list(repo_path: String) -> Result<Vec<GitStashEntry>, String> {
    ensure_is_git_worktree(&repo_path)?;

    let raw = run_git(&repo_path, &["stash", "list"]).unwrap_or_default();
    let mut out: Vec<GitStashEntry> = Vec::new();

    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let mut parts = line.splitn(2, ':');
        let reference = parts.next().unwrap_or_default().trim().to_string();
        let message = parts.next().unwrap_or_default().trim().to_string();

        let mut index: u32 = 0;
        if reference.starts_with("stash@{") && reference.ends_with('}') && reference.len() >= 8 {
            let inner = &reference[7..reference.len() - 1];
            if let Ok(n) = inner.parse::<u32>() {
                index = n;
            }
        }

        if reference.is_empty() {
            continue;
        }

        out.push(GitStashEntry {
            index,
            reference,
            message,
        });
    }

    Ok(out)
}

#[tauri::command]
fn git_stash_show(repo_path: String, stash_ref: String) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;

    let stash_ref = stash_ref.trim().to_string();
    if stash_ref.is_empty() {
        return Err(String::from("stash_ref is empty"));
    }

    run_git_stdout_raw(
        &repo_path,
        &["stash", "show", "--no-color", "-p", stash_ref.as_str()],
    )
}

#[tauri::command]
fn git_stash_base_commit(repo_path: String, stash_ref: String) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;

    let stash_ref = stash_ref.trim().to_string();
    if stash_ref.is_empty() {
        return Err(String::from("stash_ref is empty"));
    }

    let spec = format!("{stash_ref}^1");
    run_git(&repo_path, &["rev-parse", spec.as_str()])
}

#[tauri::command]
fn git_stash_apply(repo_path: String, stash_ref: String) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;

    let stash_ref = stash_ref.trim().to_string();
    if stash_ref.is_empty() {
        return Err(String::from("stash_ref is empty"));
    }

    run_git(&repo_path, &["stash", "apply", stash_ref.as_str()])
}

#[tauri::command]
fn git_stash_drop(repo_path: String, stash_ref: String) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;

    let stash_ref = stash_ref.trim().to_string();
    if stash_ref.is_empty() {
        return Err(String::from("stash_ref is empty"));
    }

    run_git(&repo_path, &["stash", "drop", stash_ref.as_str()])
}

#[tauri::command]
fn git_stash_clear(repo_path: String) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;
    run_git(&repo_path, &["stash", "clear"])
}

#[tauri::command]
fn git_stash_push_paths(
    repo_path: String,
    message: String,
    paths: Vec<String>,
    include_untracked: Option<bool>,
) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;

    if paths.is_empty() {
        return Err(String::from("No files selected to stash."));
    }

    let message = if message.trim().is_empty() {
        String::from("WIP")
    } else {
        message.trim().to_string()
    };

    let include_untracked = include_untracked.unwrap_or(false);

    let mut args: Vec<&str> = Vec::new();
    args.push("stash");
    args.push("push");
    if include_untracked {
        args.push("-u");
    }
    args.push("-m");
    args.push(message.as_str());
    args.push("--");
    for p in &paths {
        if !p.trim().is_empty() {
            args.push(p);
        }
    }

    let out = git_command_in_repo(&repo_path)
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to spawn git stash push: {e}"))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(format!("git stash push failed: {stderr}"));
    }

    Ok(String::from_utf8_lossy(&out.stdout).trim_end().to_string())
}

#[tauri::command]
fn git_stash_push_patch(repo_path: String, message: String, path: String, keep_patch: String) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;

    let path = path.trim().to_string();
    if path.is_empty() {
        return Err(String::from("path is empty"));
    }

    let mut keep_patch = keep_patch.replace("\r\n", "\n");
    if !keep_patch.is_empty() && !keep_patch.ends_with('\n') {
        keep_patch.push('\n');
    }

    if has_staged_changes(&repo_path)? {
        return Err(String::from(
            "Index has staged changes. Unstage/commit them before using partial stash.",
        ));
    }

    let mut keep_patch_reversed = false;
    if !keep_patch.is_empty() {
        if let Err(e) = run_git_with_stdin(
            &repo_path,
            &[
                "apply",
                "--whitespace=nowarn",
                "--unidiff-zero",
                "--ignore-space-change",
                "-R",
            ],
            keep_patch.as_str(),
        ) {
            run_git_with_stdin(
                &repo_path,
                &[
                    "apply",
                    "--whitespace=nowarn",
                    "--unidiff-zero",
                    "--ignore-space-change",
                    "-C",
                    "0",
                    "--3way",
                    "--recount",
                    "-R",
                ],
                keep_patch.as_str(),
            )
            .map_err(|_e2| e)?;
        }
        keep_patch_reversed = true;
    }

    let message = if message.trim().is_empty() {
        String::from("WIP")
    } else {
        message.trim().to_string()
    };

    let stash_out = git_command_in_repo(&repo_path)
        .args(["stash", "push", "-m", message.as_str(), "--", path.as_str()])
        .output()
        .map_err(|e| format!("Failed to spawn git stash push: {e}"))?;

    if !stash_out.status.success() {
        if keep_patch_reversed {
            let _ = run_git_with_stdin(
                &repo_path,
                &[
                    "apply",
                    "--whitespace=nowarn",
                    "--unidiff-zero",
                    "--ignore-space-change",
                ],
                keep_patch.as_str(),
            );
        }
        let stderr = String::from_utf8_lossy(&stash_out.stderr);
        return Err(format!("git stash push failed: {stderr}"));
    }

    if keep_patch_reversed {
        if let Err(e) = run_git_with_stdin(
            &repo_path,
            &[
                "apply",
                "--whitespace=nowarn",
                "--unidiff-zero",
                "--ignore-space-change",
            ],
            keep_patch.as_str(),
        ) {
            run_git_with_stdin(
                &repo_path,
                &[
                    "apply",
                    "--whitespace=nowarn",
                    "--unidiff-zero",
                    "--ignore-space-change",
                    "-C",
                    "0",
                    "--3way",
                    "--recount",
                ],
                keep_patch.as_str(),
            )
            .map_err(|_e2| e)?;
        }
    }

    Ok(String::from_utf8_lossy(&stash_out.stdout).trim_end().to_string())
}

#[tauri::command]
fn git_commit_changes(repo_path: String, commit: String) -> Result<Vec<GitChangeEntry>, String> {
    ensure_is_git_worktree(&repo_path)?;

    let commit = commit.trim().to_string();
    if commit.is_empty() {
        return Err(String::from("commit is empty"));
    }

    let out_bytes = git_command_in_repo(&repo_path)
        .args(["show", "--name-status", "-z", "--pretty=format:", commit.as_str()])
        .output()
        .map_err(|e| format!("Failed to spawn git: {e}"))?;

    if !out_bytes.status.success() {
        let stderr = String::from_utf8_lossy(&out_bytes.stderr);
        return Err(format!("git command failed: {stderr}"));
    }

    let mut out: Vec<GitChangeEntry> = Vec::new();
    let b = out_bytes.stdout.as_slice();
    let mut i: usize = 0;
    while i < b.len() {
        let start = i;
        while i < b.len() && b[i] != 0 {
            i += 1;
        }
        let rec = &b[start..i];
        i += 1;
        if rec.is_empty() {
            continue;
        }

        let tab = rec.iter().position(|c| *c == b'\t');
        let Some(tab_pos) = tab else {
            continue;
        };

        let status_bytes = &rec[0..tab_pos];
        let status = String::from_utf8_lossy(status_bytes).trim().to_string();
        if status.is_empty() {
            continue;
        }

        let path_bytes = &rec[tab_pos + 1..];
        if path_bytes.is_empty() {
            continue;
        }

        let has_rename = status_bytes.starts_with(b"R") || status_bytes.starts_with(b"C");
        if has_rename {
            let old_path = String::from_utf8_lossy(path_bytes).to_string();

            let start2 = i;
            while i < b.len() && b[i] != 0 {
                i += 1;
            }
            let new_path_bytes = &b[start2..i];
            i += 1;
            let new_path = String::from_utf8_lossy(new_path_bytes).to_string();

            if !new_path.trim().is_empty() {
                out.push(GitChangeEntry {
                    status,
                    path: new_path,
                    old_path: if old_path.trim().is_empty() { None } else { Some(old_path) },
                });
            }
        } else {
            let path = String::from_utf8_lossy(path_bytes).to_string();
            if !path.trim().is_empty() {
                out.push(GitChangeEntry {
                    status,
                    path,
                    old_path: None,
                });
            }
        }
    }

    Ok(out)
}

#[tauri::command]
fn git_commit_file_diff(repo_path: String, commit: String, path: String) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;

    let commit = commit.trim().to_string();
    let path = path.trim().to_string();
    if commit.is_empty() {
        return Err(String::from("commit is empty"));
    }

    if path.is_empty() {
        return Err(String::from("path is empty"));
    }

    run_git_stdout_raw(
        &repo_path,
        &[
            "show",
            "--no-color",
            "--pretty=format:",
            "--patch",
            commit.as_str(),
            "--",
            path.as_str(),
        ],
    )
}

#[tauri::command]
fn git_commit_file_content(repo_path: String, commit: String, path: String) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;

    let commit = commit.trim().to_string();
    let path = path.trim().to_string();
    if commit.is_empty() {
        return Err(String::from("commit is empty"));
    }
    if path.is_empty() {
        return Err(String::from("path is empty"));
    }

    let spec = format!("{commit}:{path}");
    run_git_stdout_raw(&repo_path, &["show", spec.as_str()])
}

#[tauri::command]
fn git_working_file_diff(repo_path: String, path: String) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;

    let path = path.trim().to_string();
    if path.is_empty() {
        return Err(String::from("path is empty"));
    }

    run_git(
        &repo_path,
        &["diff", "--no-color", "--unified=3", "HEAD", "--", path.as_str()],
    )
}

#[tauri::command]
fn git_working_file_diff_unified(repo_path: String, path: String, unified: u32) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;

    let path = path.trim().to_string();
    if path.is_empty() {
        return Err(String::from("path is empty"));
    }

    let u = unified.min(50);
    let unified_arg = format!("--unified={u}");
    run_git(
        &repo_path,
        &["diff", "--no-color", unified_arg.as_str(), "HEAD", "--", path.as_str()],
    )
}

#[tauri::command]
fn git_working_file_content(repo_path: String, path: String) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;

    let full = safe_repo_join(&repo_path, path.as_str())
        .map_err(|e| format!("Invalid path: {e}"))?;

    let bytes = fs::read(full).map_err(|e| format!("Failed to read file: {e}"))?;
    if bytes.iter().any(|b| *b == 0) {
        return Err(String::from("Binary file preview is not supported."));
    }
    Ok(String::from_utf8_lossy(bytes.as_slice()).to_string())
}

#[tauri::command]
fn git_working_file_text_preview(repo_path: String, path: String) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;

    let path = path.trim().to_string();
    if path.is_empty() {
        return Err(String::from("path is empty"));
    }

    let full = safe_repo_join(&repo_path, path.as_str()).map_err(|e| format!("Invalid path: {e}"))?;
    let bytes = fs::read(full).map_err(|e| format!("Failed to read file: {e}"))?;
    extract_text_preview(path.as_str(), bytes.as_slice())
}

#[tauri::command]
fn git_head_file_text_preview(repo_path: String, path: String) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;

    let path = path.trim().to_string();
    if path.is_empty() {
        return Err(String::from("path is empty"));
    }

    let _ = safe_repo_join(&repo_path, path.as_str()).map_err(|e| format!("Invalid path: {e}"))?;

    let spec = format!("HEAD:{path}");
    let out = match git_command_in_repo(&repo_path)
        .args(["show", spec.as_str()])
        .output()
    {
        Ok(o) if o.status.success() => o.stdout,
        _ => Vec::new(),
    };

    if out.is_empty() {
        return Ok(String::new());
    }

    extract_text_preview(path.as_str(), out.as_slice())
}

#[tauri::command]
fn git_head_vs_working_text_diff(repo_path: String, path: String, unified: u32) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;

    let path = path.trim().to_string();
    if path.is_empty() {
        return Err(String::from("path is empty"));
    }

    let full = safe_repo_join(&repo_path, path.as_str()).map_err(|e| format!("Invalid path: {e}"))?;

    let head_spec = format!("HEAD:{path}");
    let head_bytes = match git_command_in_repo(&repo_path)
        .args(["show", head_spec.as_str()])
        .output()
    {
        Ok(o) if o.status.success() => o.stdout,
        _ => Vec::new(),
    };

    let working_bytes = match fs::read(full) {
        Ok(b) => b,
        Err(_) => Vec::new(),
    };

    let head_text = extract_text_preview(path.as_str(), head_bytes.as_slice()).unwrap_or_default();
    let working_text = extract_text_preview(path.as_str(), working_bytes.as_slice()).unwrap_or_default();

    let dir = make_temp_diff_dir()?;
    let safe = sanitize_filename(path.as_str());
    let left = write_temp_file(&dir, format!("HEAD_{safe}.txt").as_str(), head_text.as_str())?;
    let right = write_temp_file(&dir, format!("WORK_{safe}.txt").as_str(), working_text.as_str())?;

    let u = unified.min(50);
    let unified_arg = format!("--unified={u}");
    let out = Command::new("git")
        .args([
            "diff",
            "--no-index",
            "--no-color",
            unified_arg.as_str(),
            "--",
            left.to_string_lossy().as_ref(),
            right.to_string_lossy().as_ref(),
        ])
        .output()
        .map_err(|e| format!("Failed to spawn git: {e}"))?;

    if out.status.success() {
        return Ok(String::from_utf8_lossy(out.stdout.as_slice()).trim_end().to_string());
    }

    if out.status.code() == Some(1) {
        return Ok(String::from_utf8_lossy(out.stdout.as_slice()).trim_end().to_string());
    }

    let stderr = String::from_utf8_lossy(&out.stderr).trim_end().to_string();
    if !stderr.is_empty() {
        return Err(format!("git diff failed: {stderr}"));
    }
    Err(String::from("git diff failed."))
}

#[tauri::command]
fn git_working_file_image_base64(repo_path: String, path: String) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;

    let path = path.trim().to_string();
    if path.is_empty() {
        return Err(String::from("path is empty"));
    }

    let full = safe_repo_join(&repo_path, path.as_str()).map_err(|e| format!("Invalid path: {e}"))?;
    let bytes = fs::read(full).map_err(|e| format!("Failed to read file: {e}"))?;
    if bytes.len() > 10_000_000 {
        return Err(String::from("Image is too large to preview."));
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes.as_slice()))
}

#[tauri::command]
fn git_head_vs_working_diff(repo_path: String, path: String, unified: u32) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;

    let path = path.trim().to_string();
    if path.is_empty() {
        return Err(String::from("path is empty"));
    }

    let full = safe_repo_join(&repo_path, path.as_str()).map_err(|e| format!("Invalid path: {e}"))?;

    let head_spec = format!("HEAD:{path}");
    let head_bytes = match git_command_in_repo(&repo_path)
        .args(["show", head_spec.as_str()])
        .output()
    {
        Ok(o) if o.status.success() => o.stdout,
        _ => Vec::new(),
    };

    let working_bytes = match fs::read(full) {
        Ok(b) => b,
        Err(_) => Vec::new(),
    };

    if head_bytes.iter().any(|b| *b == 0) || working_bytes.iter().any(|b| *b == 0) {
        return Err(String::from("Binary file preview is not supported."));
    }

    let dir = make_temp_diff_dir()?;
    let safe = sanitize_filename(path.as_str());
    let left = dir.join(format!("HEAD_{safe}"));
    let right = dir.join(format!("WORK_{safe}"));
    fs::write(&left, head_bytes.as_slice()).map_err(|e| format!("Failed to write temp file: {e}"))?;
    fs::write(&right, working_bytes.as_slice()).map_err(|e| format!("Failed to write temp file: {e}"))?;

    let u = unified.min(50);
    let unified_arg = format!("--unified={u}");
    let out = Command::new("git")
        .args([
            "diff",
            "--no-index",
            "--no-color",
            unified_arg.as_str(),
            "--",
            left.to_string_lossy().as_ref(),
            right.to_string_lossy().as_ref(),
        ])
        .output()
        .map_err(|e| format!("Failed to spawn git: {e}"))?;

    if out.status.success() {
        return Ok(String::from_utf8_lossy(out.stdout.as_slice()).trim_end().to_string());
    }

    if out.status.code() == Some(1) {
        return Ok(String::from_utf8_lossy(out.stdout.as_slice()).trim_end().to_string());
    }

    let stderr = String::from_utf8_lossy(&out.stderr).trim_end().to_string();
    if !stderr.is_empty() {
        return Err(format!("git diff failed: {stderr}"));
    }
    Err(String::from("git diff failed."))
}

#[tauri::command]
fn git_diff_no_index(left_path: String, right_path: String, unified: u32) -> Result<String, String> {
    let left_path = left_path.trim().to_string();
    let right_path = right_path.trim().to_string();
    if left_path.is_empty() {
        return Err(String::from("left_path is empty"));
    }
    if right_path.is_empty() {
        return Err(String::from("right_path is empty"));
    }

    let left = Path::new(left_path.as_str());
    let right = Path::new(right_path.as_str());
    if !left.exists() {
        return Err(String::from("Left file does not exist."));
    }
    if !right.exists() {
        return Err(String::from("Right file does not exist."));
    }
    if !left.is_file() {
        return Err(String::from("Left path is not a file."));
    }
    if !right.is_file() {
        return Err(String::from("Right path is not a file."));
    }

    let u = unified.min(50);
    let unified_arg = format!("--unified={u}");
    let out = Command::new("git")
        .args([
            "diff",
            "--no-index",
            "--no-color",
            unified_arg.as_str(),
            "--",
            left.to_string_lossy().as_ref(),
            right.to_string_lossy().as_ref(),
        ])
        .output()
        .map_err(|e| format!("Failed to spawn git: {e}"))?;

    if out.status.success() {
        return Ok(String::from_utf8_lossy(out.stdout.as_slice()).trim_end().to_string());
    }

    if out.status.code() == Some(1) {
        return Ok(String::from_utf8_lossy(out.stdout.as_slice()).trim_end().to_string());
    }

    let stderr = String::from_utf8_lossy(&out.stderr).trim_end().to_string();
    if !stderr.is_empty() {
        return Err(format!("git diff failed: {stderr}"));
    }
    Err(String::from("git diff failed."))
}

#[tauri::command]
fn git_head_file_content(repo_path: String, path: String) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;

    let path = path.trim().to_string();
    if path.is_empty() {
        return Err(String::from("path is empty"));
    }

    let _ = safe_repo_join(&repo_path, path.as_str()).map_err(|e| format!("Invalid path: {e}"))?;

    let spec = format!("HEAD:{path}");
    let out = git_command_in_repo(&repo_path)
        .args(["show", spec.as_str()])
        .output()
        .map_err(|e| format!("Failed to spawn git: {e}"))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(format!("git command failed: {stderr}"));
    }

    if out.stdout.iter().any(|b| *b == 0) {
        return Err(String::from("Binary file preview is not supported."));
    }

    Ok(String::from_utf8_lossy(out.stdout.as_slice()).to_string())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    let path = path.trim().to_string();
    if path.is_empty() {
        return Err(String::from("path is empty"));
    }

    let p = Path::new(path.as_str());
    if !p.exists() {
        return Err(String::from("File does not exist."));
    }
    if !p.is_file() {
        return Err(String::from("Selected path is not a file."));
    }

    let bytes = fs::read(p).map_err(|e| format!("Failed to read file: {e}"))?;
    if bytes.iter().any(|b| *b == 0) {
        return Err(String::from("Binary file preview is not supported."));
    }
    Ok(String::from_utf8_lossy(bytes.as_slice()).to_string())
}

#[tauri::command]
fn git_launch_external_diff_working(
    repo_path: String,
    path: String,
    tool_path: Option<String>,
    command: Option<String>,
) -> Result<(), String> {
    ensure_is_git_worktree(&repo_path)?;

    let path = path.trim().to_string();
    if path.is_empty() {
        return Err(String::from("path is empty"));
    }

    let tool_path = tool_path.unwrap_or_default();
    let command = command.unwrap_or_default();

    let head_content = match run_git_stdout_raw(&repo_path, &["show", format!("HEAD:{path}").as_str()]) {
        Ok(s) => s,
        Err(_) => String::new(),
    };

    let working_content = match git_working_file_content(repo_path.clone(), path.clone()) {
        Ok(s) => s,
        Err(_) => String::new(),
    };

    let dir = make_temp_diff_dir()?;
    let safe = sanitize_filename(path.as_str());
    let local = write_temp_file(&dir, format!("LOCAL_{safe}").as_str(), head_content.as_str())?;
    let remote = write_temp_file(&dir, format!("REMOTE_{safe}").as_str(), working_content.as_str())?;
    let base = write_temp_file(&dir, format!("BASE_{safe}").as_str(), "")?;

    let expanded = expand_external_diff_command(
        tool_path.as_str(),
        command.as_str(),
        local.as_path(),
        remote.as_path(),
        base.as_path(),
    )?;
    spawn_external_command(repo_path.as_str(), expanded.as_str())
}

#[tauri::command]
fn git_launch_external_diff_commit(
    repo_path: String,
    commit: String,
    path: String,
    old_path: Option<String>,
    tool_path: Option<String>,
    command: Option<String>,
) -> Result<(), String> {
    ensure_is_git_worktree(&repo_path)?;

    let commit = commit.trim().to_string();
    let path = path.trim().to_string();
    if commit.is_empty() {
        return Err(String::from("commit is empty"));
    }
    if path.is_empty() {
        return Err(String::from("path is empty"));
    }

    let tool_path = tool_path.unwrap_or_default();
    let command = command.unwrap_or_default();
    let old_path = old_path.unwrap_or_else(|| path.clone());

    let parent = run_git(&repo_path, &["rev-parse", format!("{commit}^").as_str()]).ok();
    let local_content = match parent {
        Some(p) if !p.trim().is_empty() => run_git_stdout_raw(&repo_path, &["show", format!("{p}:{old_path}").as_str()]).unwrap_or_default(),
        _ => String::new(),
    };

    let remote_content = run_git_stdout_raw(&repo_path, &["show", format!("{commit}:{path}").as_str()]).unwrap_or_default();

    let dir = make_temp_diff_dir()?;
    let safe = sanitize_filename(path.as_str());
    let local = write_temp_file(&dir, format!("LOCAL_{safe}").as_str(), local_content.as_str())?;
    let remote = write_temp_file(&dir, format!("REMOTE_{safe}").as_str(), remote_content.as_str())?;
    let base = write_temp_file(&dir, format!("BASE_{safe}").as_str(), "")?;

    let expanded = expand_external_diff_command(
        tool_path.as_str(),
        command.as_str(),
        local.as_path(),
        remote.as_path(),
        base.as_path(),
    )?;
    spawn_external_command(repo_path.as_str(), expanded.as_str())
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

    let upstream_out = git_command_in_repo(&repo_path)
        .args(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
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
        let verify_out = git_command_in_repo(&repo_path)
            .args(["show-ref", "--verify", "--quiet", verify_ref.as_str()])
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

    let out = git_command_in_repo(&repo_path)
        .args(["remote", "get-url", remote_name.as_str()])
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

    let exists_out = git_command_in_repo(&repo_path)
        .args(["remote", "get-url", remote_name.as_str()])
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
fn git_checkout_commit(repo_path: String, commit: String) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;

    let commit = commit.trim().to_string();
    if commit.is_empty() {
        return Err(String::from("commit is empty"));
    }

    run_git(&repo_path, &["checkout", commit.as_str()])
}

#[tauri::command]
fn git_checkout_branch(repo_path: String, branch: String) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;

    let branch = branch.trim().to_string();
    if branch.is_empty() {
        return Err(String::from("branch is empty"));
    }

    run_git(&repo_path, &["checkout", branch.as_str()])
}

#[tauri::command]
fn git_list_branches(repo_path: String, include_remote: Option<bool>) -> Result<Vec<GitBranchInfo>, String> {
    ensure_is_git_worktree(&repo_path)?;

    let format = "%(refname:short)\x1f%(objectname)\x1f%(committerdate:iso-strict)";
    let local_raw = run_git(&repo_path, &["for-each-ref", "--format", format, "refs/heads"])?;
    let mut out = parse_for_each_ref(local_raw.as_str(), "local");

    if include_remote.unwrap_or(true) {
        let remote_raw = run_git(&repo_path, &["for-each-ref", "--format", format, "refs/remotes"])?;
        out.extend(parse_for_each_ref(remote_raw.as_str(), "remote"));
    }

    Ok(out)
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
fn git_switch(
    repo_path: String,
    branch: String,
    create: Option<bool>,
    force: Option<bool>,
    start_point: Option<String>,
    track: Option<bool>,
) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;

    let branch = branch.trim().to_string();
    if branch.is_empty() {
        return Err(String::from("branch is empty"));
    }

    let create = create.unwrap_or(false);
    let force = force.unwrap_or(false);
    let track = track.unwrap_or(false);
    let start_point = start_point.unwrap_or_default().trim().to_string();

    if create {
        let mut args: Vec<&str> = Vec::new();
        args.push("switch");
        if track {
            args.push("--track");
        }
        args.push(if force { "-C" } else { "-c" });
        args.push(branch.as_str());
        if !start_point.is_empty() {
            args.push(start_point.as_str());
        }
        return run_git(&repo_path, args.as_slice());
    }

    run_git(&repo_path, &["switch", branch.as_str()])
}

#[tauri::command]
fn git_rename_branch(repo_path: String, old_name: String, new_name: String) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;

    let old_name = old_name.trim().to_string();
    let new_name = new_name.trim().to_string();
    if old_name.is_empty() {
        return Err(String::from("old_name is empty"));
    }
    if new_name.is_empty() {
        return Err(String::from("new_name is empty"));
    }

    run_git(&repo_path, &["branch", "-m", old_name.as_str(), new_name.as_str()])
}

#[tauri::command]
fn git_create_branch_advanced(
    repo_path: String,
    branch: String,
    at: Option<String>,
    checkout: Option<bool>,
    orphan: Option<bool>,
    clear_working_tree: Option<bool>,
) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;

    let branch = branch.trim().to_string();
    if branch.is_empty() {
        return Err(String::from("branch is empty"));
    }

    let at = at.unwrap_or_default().trim().to_string();
    let checkout = checkout.unwrap_or(false);
    let orphan = orphan.unwrap_or(false);
    let clear_working_tree = clear_working_tree.unwrap_or(false);

    if orphan {
        let mut args: Vec<&str> = Vec::new();
        args.push("switch");
        args.push("--orphan");
        args.push(branch.as_str());
        if !at.is_empty() {
            args.push(at.as_str());
        }
        let mut msg = run_git(&repo_path, args.as_slice())?;

        if clear_working_tree {
            let rm_out = run_git(&repo_path, &["rm", "-rf", "--ignore-unmatch", "."])?;
            if !rm_out.trim().is_empty() {
                if !msg.trim().is_empty() {
                    msg.push('\n');
                }
                msg.push_str(rm_out.trim_end());
            }

            let clean_out = run_git(&repo_path, &["clean", "-fd"])?;
            if !clean_out.trim().is_empty() {
                if !msg.trim().is_empty() {
                    msg.push('\n');
                }
                msg.push_str(clean_out.trim_end());
            }
        }

        return Ok(msg);
    }

    if checkout {
        if at.is_empty() {
            return run_git(&repo_path, &["switch", "-c", branch.as_str()]);
        }
        return run_git(&repo_path, &["switch", "-c", branch.as_str(), at.as_str()]);
    }

    if at.is_empty() {
        run_git(&repo_path, &["branch", branch.as_str()])
    } else {
        run_git(&repo_path, &["branch", branch.as_str(), at.as_str()])
    }
}

#[tauri::command]
fn git_reset_hard(repo_path: String) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;
    run_git(&repo_path, &["reset", "--hard"])
}

#[tauri::command]
fn git_reset(repo_path: String, mode: String, target: String) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;

    let mode = mode.trim().to_lowercase();
    let target = target.trim().to_string();
    if target.is_empty() {
        return Err(String::from("target is empty"));
    }

    let flag = match mode.as_str() {
        "soft" => "--soft",
        "mixed" => "--mixed",
        "hard" => "--hard",
        _ => return Err(String::from("Invalid reset mode. Use: soft, mixed or hard.")),
    };

    run_git(&repo_path, &["reset", flag, target.as_str()])
}

#[tauri::command]
fn git_is_ancestor(repo_path: String, ancestor: String, descendant: String) -> Result<bool, String> {
    ensure_is_git_worktree(&repo_path)?;

    let ancestor = ancestor.trim().to_string();
    if ancestor.is_empty() {
        return Err(String::from("ancestor is empty"));
    }

    let descendant = descendant.trim().to_string();
    if descendant.is_empty() {
        return Err(String::from("descendant is empty"));
    }

    let out = git_command_in_repo(&repo_path)
        .args(["merge-base", "--is-ancestor", ancestor.as_str(), descendant.as_str()])
        .output()
        .map_err(|e| format!("Failed to spawn git merge-base: {e}"))?;

    if out.status.success() {
        return Ok(true);
    }

    if out.status.code() == Some(1) {
        return Ok(false);
    }

    let stderr = String::from_utf8_lossy(&out.stderr).trim_end().to_string();
    Err(if !stderr.is_empty() {
        format!("git merge-base failed: {stderr}")
    } else {
        String::from("git merge-base failed.")
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
fn git_create_branch(repo_path: String, branch: String) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;

    let branch = branch.trim().to_string();
    if branch.is_empty() {
        return Err(String::from("branch is empty"));
    }

    run_git(&repo_path, &["branch", branch.as_str()])
}

#[tauri::command]
fn git_delete_branch(repo_path: String, branch: String, force: Option<bool>) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;

    let branch = branch.trim().to_string();
    if branch.is_empty() {
        return Err(String::from("branch is empty"));
    }

    let force = force.unwrap_or(false);
    if force {
        run_git(&repo_path, &["branch", "-D", branch.as_str()])
    } else {
        run_git(&repo_path, &["branch", "-d", branch.as_str()])
    }
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
fn git_reflog(repo_path: String, max_count: Option<u32>) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;

    let max_count = max_count.unwrap_or(30).min(200);
    let max_count_s = max_count.to_string();
    run_git(&repo_path, &["reflog", "-n", max_count_s.as_str()])
}

#[tauri::command]
fn git_cherry_pick(repo_path: String, commits: Vec<String>) -> Result<String, String> {
    ensure_is_git_worktree(&repo_path)?;

    let commits: Vec<String> = commits.into_iter().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
    if commits.is_empty() {
        return Err(String::from("No commits provided."));
    }

    let mut args: Vec<&str> = Vec::new();
    args.push("cherry-pick");
    for c in &commits {
        args.push(c.as_str());
    }
    run_git(&repo_path, args.as_slice())
}

#[tauri::command]
fn git_branches_points_at(repo_path: String, commit: String) -> Result<Vec<String>, String> {
    ensure_is_git_worktree(&repo_path)?;

    let commit = commit.trim().to_string();
    if commit.is_empty() {
        return Err(String::from("commit is empty"));
    }

    let raw = run_git(&repo_path, &["branch", "--format=%(refname:short)", "--points-at", commit.as_str()])?;
    let mut out: Vec<String> = raw
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .map(|l| l.to_string())
        .collect();
    out.sort();
    out.dedup();
    Ok(out)
}

#[tauri::command]
fn open_terminal(repo_path: String) -> Result<(), String> {
    let repo_path = repo_path.trim().to_string();
    if repo_path.is_empty() {
        return Err(String::from("repo_path is empty"));
    }

    #[cfg(target_os = "windows")]
    {
        let candidates: Vec<String> = vec![
            std::env::var("ProgramFiles").ok().map(|p| format!("{p}\\Git\\git-bash.exe")),
            std::env::var("ProgramFiles(x86)").ok().map(|p| format!("{p}\\Git\\git-bash.exe")),
            std::env::var("LocalAppData").ok().map(|p| format!("{p}\\Programs\\Git\\git-bash.exe")),
        ]
        .into_iter()
        .flatten()
        .collect();

        for p in candidates {
            if Path::new(p.as_str()).exists() {
                Command::new("cmd")
                    .current_dir(&repo_path)
                    .args(["/C", "start", "", p.as_str()])
                    .spawn()
                    .map_err(|e| format!("Failed to open Git Bash: {e}"))?;
                return Ok(());
            }
        }

        if Command::new("cmd")
            .current_dir(&repo_path)
            .args(["/C", "start", "", "bash", "--login", "-i"])
            .spawn()
            .is_ok()
        {
            return Ok(());
        }

        Command::new("cmd")
            .current_dir(&repo_path)
            .args(["/C", "start", "", "powershell"])
            .spawn()
            .map_err(|e| format!("Failed to open terminal: {e}"))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-a", "Terminal", repo_path.as_str()])
            .spawn()
            .map_err(|e| format!("Failed to open Terminal: {e}"))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let attempts: Vec<(&str, Vec<&str>)> = vec![
            ("x-terminal-emulator", vec![]),
            ("gnome-terminal", vec!["--working-directory", repo_path.as_str()]),
            ("konsole", vec!["--workdir", repo_path.as_str()]),
            ("xterm", vec!["-e", "bash", "-lc", "pwd; exec bash"]),
        ];

        for (bin, args) in attempts {
            let mut cmd = Command::new(bin);
            if bin == "x-terminal-emulator" {
                cmd.current_dir(&repo_path);
            }
            cmd.args(args);
            if cmd.spawn().is_ok() {
                return Ok(());
            }
        }
        return Err(String::from("Could not open a terminal emulator."));
    }
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
            list_commits_full,
            init_repo,
            open_in_file_explorer,
            git_check_worktree,
            git_trust_repo_global,
            git_trust_repo_session,
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
            git_commit,
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
