use serde::Serialize;

use std::path::Path;

#[tauri::command]
pub(crate) fn git_check_worktree(repo_path: String) -> Result<(), String> {
    crate::ensure_is_git_worktree(repo_path.trim())
}

#[tauri::command]
pub(crate) fn git_trust_repo_global(repo_path: String) -> Result<(), String> {
    let repo_path = repo_path.trim().to_string();
    if repo_path.is_empty() {
        return Err(String::from("repo_path is empty"));
    }

    let normalized = repo_path.replace('\\', "/").trim_end_matches('/').to_string();

    let out = crate::new_command("git")
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
        let stdout = String::from_utf8_lossy(&out.stdout).trim_end().to_string();
        let msg = if !stderr.is_empty() { stderr } else { stdout };
        if !msg.is_empty() {
            return Err(format!("git config failed: {msg}"));
        }
        return Err(String::from("git config failed."));
    }

    Ok(())
}

#[tauri::command]
pub(crate) fn git_trust_repo_session(repo_path: String) -> Result<(), String> {
    let repo_path = repo_path.trim().to_string();
    if repo_path.is_empty() {
        return Err(String::from("repo_path is empty"));
    }
    let normalized = crate::normalize_repo_path(repo_path.as_str());
    let set = crate::session_safe_directories();
    let mut guard = set.lock().map_err(|_| String::from("Failed to lock session safe directories."))?;
    guard.insert(normalized);
    Ok(())
}

#[tauri::command]
pub(crate) fn get_current_username() -> Result<String, String> {
    let u = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| String::from("current user"));
    Ok(u)
}

#[tauri::command]
pub(crate) fn change_repo_ownership_to_current_user(repo_path: String) -> Result<(), String> {
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

        let takeown = crate::new_command("cmd")
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

        let icacls = crate::new_command("cmd")
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
pub(crate) struct RepoOverview {
    head: String,
    head_name: String,
    branches: Vec<String>,
    tags: Vec<String>,
    remotes: Vec<String>,
}

#[tauri::command]
pub(crate) fn repo_overview(repo_path: String) -> Result<RepoOverview, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let head = crate::run_git(&repo_path, &["rev-parse", "HEAD"]).unwrap_or_default();
    let head_name = crate::run_git(&repo_path, &["symbolic-ref", "--quiet", "--short", "HEAD"]).unwrap_or_else(|_| {
        String::from("(detached)")
    });

    let branches_raw = crate::run_git(&repo_path, &["branch", "--format=%(refname:short)"])?;
    let branches = branches_raw
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .map(|l| l.to_string())
        .collect();

    let tags_raw = crate::run_git(&repo_path, &["tag", "--list"])?;
    let mut tags: Vec<String> = tags_raw
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .map(|l| l.to_string())
        .collect();
    tags.reverse();

    let remotes_raw = crate::run_git(&repo_path, &["remote"])?;
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
pub(crate) fn git_resolve_ref(repo_path: String, reference: String) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let reference = reference.trim().to_string();
    if reference.is_empty() {
        return Err(String::from("reference is empty"));
    }

    let hash = crate::run_git(&repo_path, &["rev-list", "-n", "1", reference.as_str()])?;
    let hash = hash.trim().to_string();
    if hash.is_empty() {
        return Err(String::from("Could not resolve reference to a commit."));
    }

    Ok(hash)
}

#[tauri::command]
pub(crate) fn init_repo(repo_path: String) -> Result<String, String> {
    if repo_path.trim().is_empty() {
        return Err(String::from("repo_path is empty"));
    }

    let git_dir = Path::new(&repo_path).join(".git");
    if git_dir.exists() {
        return Err(String::from("Selected path already contains a .git folder."));
    }

    crate::ensure_is_not_git_worktree(&repo_path)?;

    crate::run_git(&repo_path, &["init"])?;
    Ok(repo_path)
}

#[tauri::command]
pub(crate) fn git_ls_remote_heads(repo_url: String) -> Result<Vec<String>, String> {
    let repo_url = repo_url.trim().to_string();
    if repo_url.is_empty() {
        return Err(String::from("repo_url is empty"));
    }

    let out = crate::new_command("git")
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
