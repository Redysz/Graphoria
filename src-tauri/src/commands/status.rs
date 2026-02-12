use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub(crate) struct GitStatusEntry {
    status: String,
    path: String,
    old_path: Option<String>,
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
        .args(["status", "--porcelain", "-z", "--find-renames", "--untracked-files=all"])
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
            let first_path = String::from_utf8_lossy(path_bytes).to_string();

            let start2 = i;
            while i < b.len() && b[i] != 0 {
                i += 1;
            }
            let new_path_bytes = &b[start2..i];
            i += 1;

            let second_path = String::from_utf8_lossy(new_path_bytes).to_string();

            // In practice (especially during conflict resolution and after staging), Git may report
            // rename/copy paths in the order: <new_path> NUL <old_path> NUL.
            // We normalize here so that `path` is always the *new/current* path and `old_path` is the previous path.
            let new_path = first_path;
            let old_path = second_path;

            if !new_path.trim().is_empty() {
                entries.push(GitStatusEntry {
                    status,
                    path: new_path,
                    old_path: if !old_path.trim().is_empty() { Some(old_path) } else { None },
                });
            } else if !old_path.trim().is_empty() {
                entries.push(GitStatusEntry {
                    status,
                    path: old_path,
                    old_path: None,
                });
            }
        } else {
            let path = String::from_utf8_lossy(path_bytes).to_string();
            if !path.trim().is_empty() {
                entries.push(GitStatusEntry { status, path, old_path: None });
            }
        }
    }

    detect_unstaged_renames(&repo_path, &mut entries);

    Ok(entries)
}

/// Post-process status entries: detect renames among unstaged D + (??/A) pairs
/// by comparing blob hashes (HEAD version vs working-tree file).
fn detect_unstaged_renames(repo_path: &str, entries: &mut Vec<GitStatusEntry>) {
    use std::collections::HashMap;

    let mut del_indices: Vec<usize> = Vec::new();
    let mut add_indices: Vec<usize> = Vec::new();

    for (i, e) in entries.iter().enumerate() {
        let sb = e.status.as_bytes();
        let x = sb.first().copied().unwrap_or(b' ');
        let y = sb.get(1).copied().unwrap_or(b' ');

        // Skip entries that are already renames/copies
        if x == b'R' || y == b'R' || x == b'C' || y == b'C' {
            continue;
        }

        if x == b'D' || y == b'D' {
            del_indices.push(i);
        }
        if e.status == "??" || x == b'A' || y == b'A' {
            add_indices.push(i);
        }
    }

    if del_indices.is_empty() || add_indices.is_empty() {
        return;
    }

    // Get HEAD blob hashes for deleted files via `git ls-tree HEAD -- <paths>`
    let mut head_hash_by_del_idx: HashMap<usize, String> = HashMap::new();
    {
        let del_paths: Vec<&str> = del_indices.iter().map(|&i| entries[i].path.as_str()).collect();
        let mut args: Vec<&str> = vec!["ls-tree", "HEAD", "--"];
        args.extend(&del_paths);
        if let Ok(out) = crate::git_command_in_repo(repo_path).args(&args).output() {
            if out.status.success() {
                let text = String::from_utf8_lossy(&out.stdout);
                for line in text.lines() {
                    // Format: <mode> <type> <hash>\t<path>
                    if let Some(tab_pos) = line.find('\t') {
                        let meta = &line[..tab_pos];
                        let path = &line[tab_pos + 1..];
                        let parts: Vec<&str> = meta.split_whitespace().collect();
                        if parts.len() >= 3 {
                            let hash = parts[2];
                            for &idx in &del_indices {
                                if entries[idx].path == path {
                                    head_hash_by_del_idx.insert(idx, hash.to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if head_hash_by_del_idx.is_empty() {
        return;
    }

    // Get working-tree blob hashes for added/untracked files via `git hash-object -- <paths>`
    let mut work_hash_by_add_idx: HashMap<usize, String> = HashMap::new();
    {
        let add_paths: Vec<&str> = add_indices.iter().map(|&i| entries[i].path.as_str()).collect();
        let mut args: Vec<&str> = vec!["hash-object", "--"];
        args.extend(&add_paths);
        if let Ok(out) = crate::git_command_in_repo(repo_path).args(&args).output() {
            if out.status.success() {
                let text = String::from_utf8_lossy(&out.stdout);
                for (i, line) in text.lines().enumerate() {
                    if i < add_indices.len() {
                        let hash = line.trim().to_string();
                        if !hash.is_empty() {
                            work_hash_by_add_idx.insert(add_indices[i], hash);
                        }
                    }
                }
            }
        }
    }

    // Build reverse map: head_hash -> del_idx
    let mut hash_to_del: HashMap<String, usize> = HashMap::new();
    for (&idx, hash) in &head_hash_by_del_idx {
        hash_to_del.entry(hash.clone()).or_insert(idx);
    }

    // Match add entries to delete entries by identical blob hash
    let mut matched_del: Vec<usize> = Vec::new();
    let mut rename_pairs: Vec<(usize, usize)> = Vec::new(); // (add_idx, del_idx)

    for (&add_idx, hash) in &work_hash_by_add_idx {
        if let Some(&del_idx) = hash_to_del.get(hash) {
            if !matched_del.contains(&del_idx) {
                matched_del.push(del_idx);
                rename_pairs.push((add_idx, del_idx));
            }
        }
    }

    if rename_pairs.is_empty() {
        return;
    }

    // Update add entries to become rename entries
    for &(add_idx, del_idx) in &rename_pairs {
        entries[add_idx].status = "R ".to_string();
        entries[add_idx].old_path = Some(entries[del_idx].path.clone());
    }

    // Remove matched delete entries (reverse sorted order to preserve indices)
    matched_del.sort_unstable();
    matched_del.dedup();
    for &idx in matched_del.iter().rev() {
        entries.remove(idx);
    }
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
