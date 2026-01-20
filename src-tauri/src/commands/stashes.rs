use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub(crate) struct GitStashEntry {
    index: u32,
    reference: String,
    message: String,
}

#[tauri::command]
pub(crate) fn git_stash_list(repo_path: String) -> Result<Vec<GitStashEntry>, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let raw = crate::run_git(&repo_path, &["stash", "list"]).unwrap_or_default();
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
pub(crate) fn git_stash_show(repo_path: String, stash_ref: String) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let stash_ref = stash_ref.trim().to_string();
    if stash_ref.is_empty() {
        return Err(String::from("stash_ref is empty"));
    }

    crate::run_git_stdout_raw(
        &repo_path,
        &["stash", "show", "--no-color", "-p", stash_ref.as_str()],
    )
}

#[tauri::command]
pub(crate) fn git_stash_base_commit(repo_path: String, stash_ref: String) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let stash_ref = stash_ref.trim().to_string();
    if stash_ref.is_empty() {
        return Err(String::from("stash_ref is empty"));
    }

    let spec = format!("{stash_ref}^1");
    crate::run_git(&repo_path, &["rev-parse", spec.as_str()])
}

#[tauri::command]
pub(crate) fn git_stash_apply(repo_path: String, stash_ref: String) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let stash_ref = stash_ref.trim().to_string();
    if stash_ref.is_empty() {
        return Err(String::from("stash_ref is empty"));
    }

    crate::run_git(&repo_path, &["stash", "apply", stash_ref.as_str()])
}

#[tauri::command]
pub(crate) fn git_stash_drop(repo_path: String, stash_ref: String) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let stash_ref = stash_ref.trim().to_string();
    if stash_ref.is_empty() {
        return Err(String::from("stash_ref is empty"));
    }

    crate::run_git(&repo_path, &["stash", "drop", stash_ref.as_str()])
}

#[tauri::command]
pub(crate) fn git_stash_clear(repo_path: String) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;
    crate::run_git(&repo_path, &["stash", "clear"])
}

#[tauri::command]
pub(crate) fn git_stash_push_paths(
    repo_path: String,
    message: String,
    paths: Vec<String>,
    include_untracked: Option<bool>,
) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

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

    let out = crate::git_command_in_repo(&repo_path)
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
pub(crate) fn git_stash_push_patch(
    repo_path: String,
    message: String,
    path: String,
    keep_patch: String,
) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let path = path.trim().to_string();
    if path.is_empty() {
        return Err(String::from("path is empty"));
    }

    let mut keep_patch = keep_patch.replace("\r\n", "\n");
    if !keep_patch.is_empty() && !keep_patch.ends_with('\n') {
        keep_patch.push('\n');
    }

    if crate::has_staged_changes(&repo_path)? {
        return Err(String::from(
            "Index has staged changes. Unstage/commit them before using partial stash.",
        ));
    }

    let mut keep_patch_reversed = false;
    if !keep_patch.is_empty() {
        if let Err(e) = crate::run_git_with_stdin(
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
            crate::run_git_with_stdin(
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

    let stash_out = crate::git_command_in_repo(&repo_path)
        .args(["stash", "push", "-m", message.as_str(), "--", path.as_str()])
        .output()
        .map_err(|e| format!("Failed to spawn git stash push: {e}"))?;

    if !stash_out.status.success() {
        if keep_patch_reversed {
            let _ = crate::run_git_with_stdin(
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
        if let Err(e) = crate::run_git_with_stdin(
            &repo_path,
            &[
                "apply",
                "--whitespace=nowarn",
                "--unidiff-zero",
                "--ignore-space-change",
            ],
            keep_patch.as_str(),
        ) {
            crate::run_git_with_stdin(
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
