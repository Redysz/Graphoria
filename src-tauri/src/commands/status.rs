use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub(crate) struct GitStatusEntry {
    status: String,
    path: String,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct GitStatusSummary {
    changed: u32,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct GitAheadBehind {
    ahead: u32,
    behind: u32,
    upstream: Option<String>,
}

#[tauri::command]
pub(crate) fn git_status(repo_path: String) -> Result<Vec<GitStatusEntry>, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let out = crate::git_command_in_repo(&repo_path)
        .args(["status", "--porcelain", "-z", "--untracked-files=all"])
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
pub(crate) fn git_has_staged_changes(repo_path: String) -> Result<bool, String> {
    crate::ensure_is_git_worktree(&repo_path)?;
    crate::has_staged_changes(&repo_path)
}

#[tauri::command]
pub(crate) fn git_status_summary(repo_path: String) -> Result<GitStatusSummary, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let raw = crate::run_git(&repo_path, &["status", "--porcelain", "--untracked-files=all"]).unwrap_or_default();
    let changed = raw
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .count() as u32;

    Ok(GitStatusSummary { changed })
}

#[tauri::command]
pub(crate) fn git_stage_paths(repo_path: String, paths: Vec<String>) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let mut cleaned: Vec<String> = Vec::new();
    for p in paths.into_iter() {
        let p = p.trim().to_string();
        if p.is_empty() {
            continue;
        }
        crate::ensure_rel_path_safe(p.as_str())?;
        cleaned.push(p);
    }

    if cleaned.is_empty() {
        return Ok(String::from("ok"));
    }

    crate::with_repo_git_lock(&repo_path, || {
        let mut args: Vec<&str> = Vec::new();
        args.push("add");
        args.push("-A");
        args.push("--");
        for p in cleaned.iter() {
            args.push(p.as_str());
        }

        let out = crate::git_command_in_repo(&repo_path)
            .args(&args)
            .output()
            .map_err(|e| format!("Failed to spawn git add: {e}"))?;

        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            return Err(format!("git add failed: {stderr}"));
        }
        Ok(String::from("ok"))
    })
}

#[tauri::command]
pub(crate) fn git_unstage_paths(repo_path: String, paths: Vec<String>) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let mut cleaned: Vec<String> = Vec::new();
    for p in paths.into_iter() {
        let p = p.trim().to_string();
        if p.is_empty() {
            continue;
        }
        crate::ensure_rel_path_safe(p.as_str())?;
        cleaned.push(p);
    }

    if cleaned.is_empty() {
        return Ok(String::from("ok"));
    }

    crate::with_repo_git_lock(&repo_path, || {
        let mut args: Vec<&str> = Vec::new();
        args.push("reset");
        args.push("-q");
        args.push("HEAD");
        args.push("--");
        for p in cleaned.iter() {
            args.push(p.as_str());
        }

        let out = crate::git_command_in_repo(&repo_path)
            .args(&args)
            .output()
            .map_err(|e| format!("Failed to spawn git reset: {e}"))?;

        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            return Err(format!("git reset failed: {stderr}"));
        }
        Ok(String::from("ok"))
    })
}

#[tauri::command]
pub(crate) fn git_ahead_behind(repo_path: String, remote_name: Option<String>) -> Result<GitAheadBehind, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let head_name = crate::run_git(&repo_path, &["symbolic-ref", "--quiet", "--short", "HEAD"]).unwrap_or_else(|_| {
        String::from("(detached)")
    });

    if head_name == "(detached)" {
        return Ok(GitAheadBehind {
            ahead: 0,
            behind: 0,
            upstream: None,
        });
    }

    let upstream_out = crate::git_command_in_repo(&repo_path)
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
        let verify_out = crate::git_command_in_repo(&repo_path)
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

    let raw = crate::run_git(
        &repo_path,
        &["rev-list", "--left-right", "--count", &format!("{upstream}...HEAD")],
    )?;
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
pub(crate) fn git_get_remote_url(repo_path: String, remote_name: Option<String>) -> Result<Option<String>, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let remote_name = remote_name.unwrap_or_else(|| String::from("origin"));

    let out = crate::git_command_in_repo(&repo_path)
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
pub(crate) fn git_set_remote_url(repo_path: String, remote_name: Option<String>, url: String) -> Result<(), String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let remote_name = remote_name.unwrap_or_else(|| String::from("origin"));
    let url = url.trim().to_string();
    if url.is_empty() {
        return Err(String::from("Remote URL is empty."));
    }

    let exists_out = crate::git_command_in_repo(&repo_path)
        .args(["remote", "get-url", remote_name.as_str()])
        .output()
        .map_err(|e| format!("Failed to spawn git remote get-url: {e}"))?;

    if exists_out.status.success() {
        crate::run_git(
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
        crate::run_git(
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
