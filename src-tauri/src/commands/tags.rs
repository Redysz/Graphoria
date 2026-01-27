#[tauri::command]
#[allow(dead_code)]
pub(crate) fn git_create_tag(
    repo_path: String,
    tag: String,
    target: Option<String>,
    annotated: Option<bool>,
    message: Option<String>,
    force: Option<bool>,
) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let tag = tag.trim().to_string();
    if tag.is_empty() {
        return Err(String::from("tag is empty"));
    }

    let target = target.unwrap_or_else(|| String::from("HEAD")).trim().to_string();
    let annotated = annotated.unwrap_or(false);
    let message = message.unwrap_or_default().trim().to_string();
    let force = force.unwrap_or(false);

    if annotated && message.is_empty() {
        return Err(String::from("message is empty"));
    }

    let mut args: Vec<&str> = Vec::new();
    args.push("tag");

    if force {
        args.push("-f");
    }

    if annotated {
        args.push("-a");
        args.push(tag.as_str());
        args.push("-m");
        args.push(message.as_str());
        if !target.is_empty() {
            args.push(target.as_str());
        }
        return crate::run_git(&repo_path, args.as_slice());
    }

    args.push(tag.as_str());
    if !target.is_empty() {
        args.push(target.as_str());
    }

    crate::run_git(&repo_path, args.as_slice())
}

#[tauri::command]
#[allow(dead_code)]
pub(crate) fn git_delete_tag(repo_path: String, tag: String) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let tag = tag.trim().to_string();
    if tag.is_empty() {
        return Err(String::from("tag is empty"));
    }

    crate::run_git(&repo_path, &["tag", "-d", tag.as_str()])
}

#[tauri::command]
#[allow(dead_code)]
pub(crate) fn git_delete_remote_tag(
    repo_path: String,
    remote_name: Option<String>,
    tag: String,
) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let remote_name = remote_name.unwrap_or_else(|| String::from("origin"));
    let remote_name = remote_name.trim().to_string();
    if remote_name.is_empty() {
        return Err(String::from("remote_name is empty"));
    }

    let tag = tag.trim().to_string();
    if tag.is_empty() {
        return Err(String::from("tag is empty"));
    }

    crate::run_git(
        &repo_path,
        &["push", remote_name.as_str(), "--delete", tag.as_str()],
    )
}
