use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;

#[derive(Debug, Clone, Serialize)]
pub(crate) struct GitConflictFileEntry {
    status: String,
    path: String,
    stages: Vec<u8>,
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

#[tauri::command]
pub(crate) fn git_conflict_state(repo_path: String) -> Result<GitConflictState, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    crate::with_repo_git_lock(&repo_path, || {
        let merge_in_progress = crate::is_merge_in_progress(&repo_path);
        let rebase_in_progress = crate::is_rebase_in_progress(&repo_path);

        let operation = if rebase_in_progress {
            String::from("rebase")
        } else if merge_in_progress {
            String::from("merge")
        } else {
            String::new()
        };

        let in_progress = merge_in_progress || rebase_in_progress;

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

        Ok(GitConflictFileVersions {
            base,
            ours,
            theirs,
            working,
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
        crate::run_git(&repo_path, &["checkout", "--theirs", "--", path.as_str()])?;
        crate::run_git(&repo_path, &["add", "--", path.as_str()])?;
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
