use serde::Serialize;
use tauri::{AppHandle, Emitter};

use std::fs;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};

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

#[tauri::command]
pub(crate) fn git_clone_repo(
    app: AppHandle,
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
        crate::ensure_is_not_git_worktree(destination_path.as_str())?;
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
        crate::run_git(
            destination_path.as_str(),
            &["submodule", "update", "--init", "--recursive"],
        )?;
    }

    Ok(destination_path)
}
