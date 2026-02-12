#[tauri::command]
pub(crate) fn git_checkout_commit(repo_path: String, commit: String) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let commit = commit.trim().to_string();
    if commit.is_empty() {
        return Err(String::from("commit is empty"));
    }

    crate::run_git(&repo_path, &["checkout", commit.as_str()])
}

#[tauri::command]
pub(crate) fn git_checkout_branch(repo_path: String, branch: String) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let branch = branch.trim().to_string();
    if branch.is_empty() {
        return Err(String::from("branch is empty"));
    }

    crate::run_git(&repo_path, &["checkout", branch.as_str()])
}

#[tauri::command]
pub(crate) fn git_list_branches(
    repo_path: String,
    include_remote: Option<bool>,
) -> Result<Vec<crate::GitBranchInfo>, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let format = "%(refname:short)\x1f%(objectname)\x1f%(committerdate:iso-strict)";
    let local_raw = crate::run_git(&repo_path, &["for-each-ref", "--format", format, "refs/heads"])?;
    let mut out = crate::parse_for_each_ref(local_raw.as_str(), "local");

    if include_remote.unwrap_or(true) {
        let remote_raw = crate::run_git(&repo_path, &["for-each-ref", "--format", format, "refs/remotes"])?;
        out.extend(crate::parse_for_each_ref(remote_raw.as_str(), "remote"));
    }

    Ok(out)
}

#[tauri::command]
pub(crate) fn git_switch(
    repo_path: String,
    branch: String,
    create: Option<bool>,
    force: Option<bool>,
    start_point: Option<String>,
    track: Option<bool>,
) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

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
        return crate::run_git(&repo_path, args.as_slice());
    }

    crate::run_git(&repo_path, &["switch", branch.as_str()])
}

#[tauri::command]
pub(crate) fn git_rename_branch(
    repo_path: String,
    old_name: String,
    new_name: String,
) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let old_name = old_name.trim().to_string();
    let new_name = new_name.trim().to_string();
    if old_name.is_empty() {
        return Err(String::from("old_name is empty"));
    }
    if new_name.is_empty() {
        return Err(String::from("new_name is empty"));
    }

    crate::run_git(&repo_path, &["branch", "-m", old_name.as_str(), new_name.as_str()])
}

#[tauri::command]
pub(crate) fn git_create_branch_advanced(
    repo_path: String,
    branch: String,
    at: Option<String>,
    checkout: Option<bool>,
    orphan: Option<bool>,
    clear_working_tree: Option<bool>,
) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

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
        let mut msg = crate::run_git(&repo_path, args.as_slice())?;

        if clear_working_tree {
            let rm_out = crate::run_git(&repo_path, &["rm", "-rf", "--ignore-unmatch", "."])?;
            if !rm_out.trim().is_empty() {
                if !msg.trim().is_empty() {
                    msg.push('\n');
                }
                msg.push_str(rm_out.trim_end());
            }

            let clean_out = crate::run_git(&repo_path, &["clean", "-fd"])?;
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
            return crate::run_git(&repo_path, &["switch", "-c", branch.as_str()]);
        }
        return crate::run_git(&repo_path, &["switch", "-c", branch.as_str(), at.as_str()]);
    }

    if at.is_empty() {
        crate::run_git(&repo_path, &["branch", branch.as_str()])
    } else {
        crate::run_git(&repo_path, &["branch", branch.as_str(), at.as_str()])
    }
}

#[tauri::command]
pub(crate) fn git_reset_hard(repo_path: String) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;
    crate::run_git(&repo_path, &["reset", "--hard"])
}

#[tauri::command]
pub(crate) fn git_reset(repo_path: String, mode: String, target: String) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

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

    crate::run_git(&repo_path, &["reset", flag, target.as_str()])
}

#[tauri::command]
pub(crate) fn git_is_ancestor(
    repo_path: String,
    ancestor: String,
    descendant: String,
) -> Result<bool, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let ancestor = ancestor.trim().to_string();
    if ancestor.is_empty() {
        return Err(String::from("ancestor is empty"));
    }

    let descendant = descendant.trim().to_string();
    if descendant.is_empty() {
        return Err(String::from("descendant is empty"));
    }

    let out = crate::git_command_in_repo(&repo_path)
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
pub(crate) fn git_create_branch(repo_path: String, branch: String) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let branch = branch.trim().to_string();
    if branch.is_empty() {
        return Err(String::from("branch is empty"));
    }

    crate::run_git(&repo_path, &["branch", branch.as_str()])
}

#[tauri::command]
pub(crate) fn git_delete_branch(
    repo_path: String,
    branch: String,
    force: Option<bool>,
) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let branch = branch.trim().to_string();
    if branch.is_empty() {
        return Err(String::from("branch is empty"));
    }

    let force = force.unwrap_or(false);
    if force {
        crate::run_git(&repo_path, &["branch", "-D", branch.as_str()])
    } else {
        crate::run_git(&repo_path, &["branch", "-d", branch.as_str()])
    }
}

#[tauri::command]
pub(crate) fn git_branches_points_at(repo_path: String, commit: String) -> Result<Vec<String>, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let commit = commit.trim().to_string();
    if commit.is_empty() {
        return Err(String::from("commit is empty"));
    }

    let raw = crate::run_git(
        &repo_path,
        &[
            "branch",
            "--format=%(refname:short)",
            "--points-at",
            commit.as_str(),
        ],
    )?;
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
pub(crate) fn git_branches_contains(repo_path: String, commit: String) -> Result<Vec<String>, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let commit = commit.trim().to_string();
    if commit.is_empty() {
        return Err(String::from("commit is empty"));
    }

    let raw = crate::run_git(
        &repo_path,
        &[
            "branch",
            "--format=%(refname:short)",
            "--contains",
            commit.as_str(),
        ],
    )?;
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
