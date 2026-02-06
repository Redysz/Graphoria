use base64::Engine;
use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
pub(crate) struct GitChangeEntry {
    status: String,
    path: String,
    old_path: Option<String>,
}

#[tauri::command]
pub(crate) fn git_commit_changes(repo_path: String, commit: String) -> Result<Vec<GitChangeEntry>, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let commit = commit.trim().to_string();
    if commit.is_empty() {
        return Err(String::from("commit is empty"));
    }

    let parents_line = crate::run_git(
        &repo_path,
        &["rev-list", "--parents", "-n", "1", commit.as_str()],
    )
    .unwrap_or_default();
    let mut parents_it = parents_line.split_whitespace();
    let _self_hash = parents_it.next();
    let first_parent = parents_it.next().map(|s| s.to_string());
    let is_merge_commit = parents_it.next().is_some();

    let out_bytes = if is_merge_commit {
        if let Some(p1) = first_parent.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
            crate::git_command_in_repo(&repo_path)
                .args([
                    "diff",
                    "--name-status",
                    "-z",
                    "-M",
                    p1,
                    commit.as_str(),
                ])
                .output()
                .map_err(|e| format!("Failed to spawn git: {e}"))?
        } else {
            crate::git_command_in_repo(&repo_path)
                .args(["show", "--name-status", "-z", "--pretty=format:", commit.as_str()])
                .output()
                .map_err(|e| format!("Failed to spawn git: {e}"))?
        }
    } else {
        crate::git_command_in_repo(&repo_path)
            .args(["show", "--name-status", "-z", "--pretty=format:", commit.as_str()])
            .output()
            .map_err(|e| format!("Failed to spawn git: {e}"))?
    };

    if !out_bytes.status.success() {
        let stderr = String::from_utf8_lossy(&out_bytes.stderr);
        return Err(format!("git command failed: {stderr}"));
    }

    let mut out: Vec<GitChangeEntry> = Vec::new();
    let mut tokens: Vec<String> = Vec::new();
    for t in out_bytes.stdout.split(|c| *c == 0) {
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
                out.push(GitChangeEntry {
                    status,
                    path: new_path,
                    old_path: if old_path.trim().is_empty() {
                        None
                    } else {
                        Some(old_path)
                    },
                });
            }
        } else {
            if i >= tokens.len() {
                break;
            }
            let path = tokens[i].to_string();
            i += 1;
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
pub(crate) fn git_commit_file_diff(repo_path: String, commit: String, path: String) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let commit = commit.trim().to_string();
    let path = path.trim().to_string();
    if commit.is_empty() {
        return Err(String::from("commit is empty"));
    }

    if path.is_empty() {
        return Err(String::from("path is empty"));
    }

    let parents_line = crate::run_git(
        &repo_path,
        &["rev-list", "--parents", "-n", "1", commit.as_str()],
    )
    .unwrap_or_default();
    let mut parents_it = parents_line.split_whitespace();
    let _self_hash = parents_it.next();
    let first_parent = parents_it.next().map(|s| s.to_string());
    let is_merge_commit = parents_it.next().is_some();

    if is_merge_commit {
        if let Some(p1) = first_parent.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
            return crate::run_git_stdout_raw(
                &repo_path,
                &[
                    "diff",
                    "--no-color",
                    "-M",
                    "--patch",
                    p1,
                    commit.as_str(),
                    "--",
                    path.as_str(),
                ],
            );
        }
    }

    crate::run_git_stdout_raw(
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
pub(crate) fn git_commit_file_content(repo_path: String, commit: String, path: String) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let commit = commit.trim().to_string();
    let path = path.trim().to_string();
    if commit.is_empty() {
        return Err(String::from("commit is empty"));
    }
    if path.is_empty() {
        return Err(String::from("path is empty"));
    }

    let spec = format!("{commit}:{path}");
    crate::run_git_stdout_raw(&repo_path, &["show", spec.as_str()])
}

#[tauri::command]
pub(crate) fn git_working_file_diff(repo_path: String, path: String) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let path = path.trim().to_string();
    if path.is_empty() {
        return Err(String::from("path is empty"));
    }

    crate::run_git(
        &repo_path,
        &["diff", "--no-color", "--unified=3", "HEAD", "--", path.as_str()],
    )
}

#[tauri::command]
pub(crate) fn git_working_file_diff_unified(repo_path: String, path: String, unified: u32) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let path = path.trim().to_string();
    if path.is_empty() {
        return Err(String::from("path is empty"));
    }

    let u = unified.min(50);
    let unified_arg = format!("--unified={u}");
    crate::run_git(
        &repo_path,
        &["diff", "--no-color", unified_arg.as_str(), "HEAD", "--", path.as_str()],
    )
}

#[tauri::command]
pub(crate) fn git_working_file_content(repo_path: String, path: String) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let full = crate::safe_repo_join(&repo_path, path.as_str()).map_err(|e| format!("Invalid path: {e}"))?;

    if full.is_dir() {
        return Err(String::from("Path is a directory."));
    }

    let bytes = match fs::read(full) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(String::from("File does not exist in working tree."));
        }
        Err(e) => {
            return Err(format!("Failed to read file: {e}"));
        }
    };
    if bytes.iter().any(|b| *b == 0) {
        return Err(String::from("Binary file preview is not supported."));
    }
    Ok(String::from_utf8_lossy(bytes.as_slice()).to_string())
}

#[tauri::command]
pub(crate) fn git_working_file_text_preview(repo_path: String, path: String) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let path = path.trim().to_string();
    if path.is_empty() {
        return Err(String::from("path is empty"));
    }

    let full = crate::safe_repo_join(&repo_path, path.as_str()).map_err(|e| format!("Invalid path: {e}"))?;

    if full.is_dir() {
        return Err(String::from("Path is a directory."));
    }
    let bytes = match fs::read(full) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(String::from("File does not exist in working tree."));
        }
        Err(e) => {
            return Err(format!("Failed to read file: {e}"));
        }
    };
    crate::extract_text_preview(path.as_str(), bytes.as_slice())
}

#[tauri::command]
pub(crate) fn git_head_file_text_preview(repo_path: String, path: String) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let path = path.trim().to_string();
    if path.is_empty() {
        return Err(String::from("path is empty"));
    }

    let _ = crate::safe_repo_join(&repo_path, path.as_str()).map_err(|e| format!("Invalid path: {e}"))?;

    let spec = format!("HEAD:{path}");
    let out = match crate::git_command_in_repo(&repo_path)
        .args(["show", spec.as_str()])
        .output()
    {
        Ok(o) if o.status.success() => o.stdout,
        _ => Vec::new(),
    };

    if out.is_empty() {
        return Ok(String::new());
    }

    crate::extract_text_preview(path.as_str(), out.as_slice())
}

#[tauri::command]
pub(crate) fn git_head_vs_working_text_diff(repo_path: String, path: String, unified: u32) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let path = path.trim().to_string();
    if path.is_empty() {
        return Err(String::from("path is empty"));
    }

    let full = crate::safe_repo_join(&repo_path, path.as_str()).map_err(|e| format!("Invalid path: {e}"))?;

    if full.is_dir() {
        return Err(String::from("Path is a directory."));
    }

    let head_spec = format!("HEAD:{path}");
    let head_bytes = match crate::git_command_in_repo(&repo_path)
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

    let head_text = crate::extract_text_preview(path.as_str(), head_bytes.as_slice()).unwrap_or_default();
    let working_text = crate::extract_text_preview(path.as_str(), working_bytes.as_slice()).unwrap_or_default();

    let dir = crate::make_temp_diff_dir()?;
    let safe = crate::sanitize_filename(path.as_str());
    let left = crate::write_temp_file(&dir, format!("HEAD_{safe}.txt").as_str(), head_text.as_str())?;
    let right = crate::write_temp_file(&dir, format!("WORK_{safe}.txt").as_str(), working_text.as_str())?;

    let u = unified.min(50);
    let unified_arg = format!("--unified={u}");
    let out = crate::new_command("git")
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
pub(crate) fn git_working_file_image_base64(repo_path: String, path: String) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let path = path.trim().to_string();
    if path.is_empty() {
        return Err(String::from("path is empty"));
    }

    let full = crate::safe_repo_join(&repo_path, path.as_str()).map_err(|e| format!("Invalid path: {e}"))?;

    if full.is_dir() {
        return Err(String::from("Path is a directory."));
    }
    let bytes = match fs::read(full) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(String::from("File does not exist in working tree."));
        }
        Err(e) => {
            return Err(format!("Failed to read file: {e}"));
        }
    };
    if bytes.len() > 10_000_000 {
        return Err(String::from("Image is too large to preview."));
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes.as_slice()))
}

#[tauri::command]
pub(crate) fn git_head_vs_working_diff(repo_path: String, path: String, unified: u32) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let path = path.trim().to_string();
    if path.is_empty() {
        return Err(String::from("path is empty"));
    }

    let full = crate::safe_repo_join(&repo_path, path.as_str()).map_err(|e| format!("Invalid path: {e}"))?;

    if full.is_dir() {
        return Err(String::from("Path is a directory."));
    }

    let head_spec = format!("HEAD:{path}");
    let head_bytes = match crate::git_command_in_repo(&repo_path)
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

    let dir = crate::make_temp_diff_dir()?;
    let safe = crate::sanitize_filename(path.as_str());
    let left = dir.join(format!("HEAD_{safe}"));
    let right = dir.join(format!("WORK_{safe}"));
    fs::write(&left, head_bytes.as_slice()).map_err(|e| format!("Failed to write temp file: {e}"))?;
    fs::write(&right, working_bytes.as_slice()).map_err(|e| format!("Failed to write temp file: {e}"))?;

    let u = unified.min(50);
    let unified_arg = format!("--unified={u}");
    let out = crate::new_command("git")
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
pub(crate) fn git_diff_no_index(left_path: String, right_path: String, unified: u32) -> Result<String, String> {
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
    let out = crate::new_command("git")
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
pub(crate) fn git_head_file_content(repo_path: String, path: String) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let path = path.trim().to_string();
    if path.is_empty() {
        return Err(String::from("path is empty"));
    }

    let _ = crate::safe_repo_join(&repo_path, path.as_str()).map_err(|e| format!("Invalid path: {e}"))?;

    let spec = format!("HEAD:{path}");
    let out = crate::git_command_in_repo(&repo_path)
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
pub(crate) fn read_text_file(path: String) -> Result<String, String> {
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
pub(crate) fn git_launch_external_diff_working(
    repo_path: String,
    path: String,
    tool_path: Option<String>,
    command: Option<String>,
) -> Result<(), String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let path = path.trim().to_string();
    if path.is_empty() {
        return Err(String::from("path is empty"));
    }

    let tool_path = tool_path.unwrap_or_default();
    let command = command.unwrap_or_default();

    let head_content = match crate::run_git_stdout_raw(&repo_path, &["show", format!("HEAD:{path}").as_str()]) {
        Ok(s) => s,
        Err(_) => String::new(),
    };

    let working_content = match git_working_file_content(repo_path.clone(), path.clone()) {
        Ok(s) => s,
        Err(_) => String::new(),
    };

    let dir = crate::make_temp_diff_dir()?;
    let safe = crate::sanitize_filename(path.as_str());
    let local = crate::write_temp_file(&dir, format!("LOCAL_{safe}").as_str(), head_content.as_str())?;
    let remote = crate::write_temp_file(&dir, format!("REMOTE_{safe}").as_str(), working_content.as_str())?;
    let base = crate::write_temp_file(&dir, format!("BASE_{safe}").as_str(), "")?;

    let expanded = crate::expand_external_diff_command(
        tool_path.as_str(),
        command.as_str(),
        local.as_path(),
        remote.as_path(),
        base.as_path(),
    )?;
    crate::spawn_external_command(repo_path.as_str(), expanded.as_str())
}

#[tauri::command]
pub(crate) fn git_launch_external_diff_commit(
    repo_path: String,
    commit: String,
    path: String,
    old_path: Option<String>,
    tool_path: Option<String>,
    command: Option<String>,
) -> Result<(), String> {
    crate::ensure_is_git_worktree(&repo_path)?;

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

    let parent = crate::run_git(&repo_path, &["rev-parse", format!("{commit}^").as_str()]).ok();
    let local_content = match parent {
        Some(p) if !p.trim().is_empty() => crate::run_git_stdout_raw(&repo_path, &["show", format!("{p}:{old_path}").as_str()]).unwrap_or_default(),
        _ => String::new(),
    };

    let remote_content = crate::run_git_stdout_raw(&repo_path, &["show", format!("{commit}:{path}").as_str()]).unwrap_or_default();

    let dir = crate::make_temp_diff_dir()?;
    let safe = crate::sanitize_filename(path.as_str());
    let local = crate::write_temp_file(&dir, format!("LOCAL_{safe}").as_str(), local_content.as_str())?;
    let remote = crate::write_temp_file(&dir, format!("REMOTE_{safe}").as_str(), remote_content.as_str())?;
    let base = crate::write_temp_file(&dir, format!("BASE_{safe}").as_str(), "")?;

    let expanded = crate::expand_external_diff_command(
        tool_path.as_str(),
        command.as_str(),
        local.as_path(),
        remote.as_path(),
        base.as_path(),
    )?;
    crate::spawn_external_command(repo_path.as_str(), expanded.as_str())
}
