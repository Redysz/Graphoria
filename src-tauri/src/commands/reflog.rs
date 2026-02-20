#[tauri::command]
pub(crate) fn git_reflog(repo_path: String, max_count: Option<u32>) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let max_count = max_count.unwrap_or(30).min(200);
    let max_count_s = max_count.to_string();
    crate::run_git(&repo_path, &["reflog", "-n", max_count_s.as_str()])
}

#[tauri::command]
pub(crate) fn git_cherry_pick(repo_path: String, commits: Vec<String>) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let commits: Vec<String> = commits
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if commits.is_empty() {
        return Err(String::from("No commits provided."));
    }

    let mut args: Vec<&str> = Vec::new();
    args.push("cherry-pick");
    for c in &commits {
        args.push(c.as_str());
    }
    crate::run_git(&repo_path, args.as_slice())
}

#[tauri::command]
pub(crate) fn git_cherry_pick_advanced(
    repo_path: String,
    commits: Vec<String>,
    append_origin: bool,
    no_commit: bool,
    conflict_preference: Option<String>,
) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let commits: Vec<String> = commits
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if commits.is_empty() {
        return Err(String::from("No commits provided."));
    }

    let mut args: Vec<&str> = Vec::new();
    args.push("cherry-pick");
    if append_origin {
        args.push("-x");
    }
    if no_commit {
        args.push("--no-commit");
    }
    let pref = conflict_preference
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if !pref.is_empty() {
        if pref != "ours" && pref != "theirs" {
            return Err(String::from("Invalid conflict preference. Use 'ours' or 'theirs'."));
        }
        args.push("-X");
        args.push(pref.as_str());
    }
    for c in &commits {
        args.push(c.as_str());
    }
    crate::run_git(&repo_path, args.as_slice())
}
