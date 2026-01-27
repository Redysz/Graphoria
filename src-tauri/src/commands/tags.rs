use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Serialize, Clone)]
pub(crate) struct GitTagTarget {
    pub name: String,
    pub target: String,
}

fn parse_tag_targets_from_lines(lines: &str) -> Vec<GitTagTarget> {
    let mut targets: BTreeMap<String, String> = BTreeMap::new();

    for raw in lines.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }

        let mut parts = line.split_whitespace();
        let hash = parts.next().unwrap_or_default().trim().to_string();
        let reference = parts.next().unwrap_or_default().trim().to_string();
        if hash.is_empty() || reference.is_empty() {
            continue;
        }

        let prefix = "refs/tags/";
        if !reference.starts_with(prefix) {
            continue;
        }

        let name = reference.strip_prefix(prefix).unwrap_or("").to_string();
        if name.is_empty() {
            continue;
        }

        let peeled_suffix = "^{}";
        if name.ends_with(peeled_suffix) {
            let base = name.trim_end_matches(peeled_suffix).to_string();
            if base.is_empty() {
                continue;
            }
            targets.insert(base, hash);
        } else {
            targets.entry(name).or_insert(hash);
        }
    }

    targets
        .into_iter()
        .filter(|(k, v)| !k.trim().is_empty() && !v.trim().is_empty())
        .map(|(name, target)| GitTagTarget { name, target })
        .collect()
}

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

#[tauri::command]
#[allow(dead_code)]
pub(crate) fn git_rename_tag(
    repo_path: String,
    old_tag: String,
    new_tag: String,
    rename_on_remote: Option<bool>,
    remote_name: Option<String>,
) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let old_tag = old_tag.trim().to_string();
    if old_tag.is_empty() {
        return Err(String::from("old_tag is empty"));
    }

    let new_tag = new_tag.trim().to_string();
    if new_tag.is_empty() {
        return Err(String::from("new_tag is empty"));
    }

    if old_tag == new_tag {
        return Err(String::from("new_tag is the same as old_tag"));
    }

    crate::run_git(&repo_path, &["tag", new_tag.as_str(), old_tag.as_str()])?;

    if rename_on_remote.unwrap_or(false) {
        let remote_name = remote_name.unwrap_or_else(|| String::from("origin"));
        let remote_name = remote_name.trim().to_string();
        if remote_name.is_empty() {
            let _ = crate::run_git(&repo_path, &["tag", "-d", new_tag.as_str()]);
            return Err(String::from("remote_name is empty"));
        }

        let remote_new_ref = format!("refs/tags/{}", new_tag);
        let remote_old_ref = format!("refs/tags/{}", old_tag);

        let remote_new_exists = match crate::run_git(
            &repo_path,
            &["ls-remote", "--tags", remote_name.as_str(), remote_new_ref.as_str()],
        ) {
            Ok(v) => v,
            Err(e) => {
                let _ = crate::run_git(&repo_path, &["tag", "-d", new_tag.as_str()]);
                return Err(e);
            }
        };
        if !remote_new_exists.trim().is_empty() {
            let _ = crate::run_git(&repo_path, &["tag", "-d", new_tag.as_str()]);
            return Err(format!("remote tag '{}' already exists", new_tag));
        }

        if let Err(e) = crate::run_git(&repo_path, &["push", remote_name.as_str(), remote_new_ref.as_str()]) {
            let _ = crate::run_git(&repo_path, &["tag", "-d", new_tag.as_str()]);
            return Err(e);
        }

        let remote_old_exists = match crate::run_git(
            &repo_path,
            &["ls-remote", "--tags", remote_name.as_str(), remote_old_ref.as_str()],
        ) {
            Ok(v) => v,
            Err(e) => {
                let _ = crate::run_git(
                    &repo_path,
                    &["push", remote_name.as_str(), "--delete", new_tag.as_str()],
                );
                let _ = crate::run_git(&repo_path, &["tag", "-d", new_tag.as_str()]);
                return Err(e);
            }
        };
        if !remote_old_exists.trim().is_empty() {
            if let Err(e) = crate::run_git(
                &repo_path,
                &["push", remote_name.as_str(), "--delete", old_tag.as_str()],
            ) {
                let _ = crate::run_git(
                    &repo_path,
                    &["push", remote_name.as_str(), "--delete", new_tag.as_str()],
                );
                let _ = crate::run_git(&repo_path, &["tag", "-d", new_tag.as_str()]);
                return Err(e);
            }
        }
    }

    crate::run_git(&repo_path, &["tag", "-d", old_tag.as_str()])
}

#[tauri::command]
#[allow(dead_code)]
pub(crate) fn git_list_tag_targets(repo_path: String) -> Result<Vec<GitTagTarget>, String> {
    crate::ensure_is_git_worktree(&repo_path)?;
    let out = crate::run_git(&repo_path, &["show-ref", "--tags", "-d"])?;
    Ok(parse_tag_targets_from_lines(out.as_str()))
}

#[tauri::command]
#[allow(dead_code)]
pub(crate) fn git_list_remote_tag_targets(
    repo_path: String,
    remote_name: Option<String>,
) -> Result<Vec<GitTagTarget>, String> {
    crate::ensure_is_git_worktree(&repo_path)?;
    let remote_name = remote_name.unwrap_or_else(|| String::from("origin"));
    let remote_name = remote_name.trim().to_string();
    if remote_name.is_empty() {
        return Err(String::from("remote_name is empty"));
    }

    let out = crate::run_git(&repo_path, &["ls-remote", "--tags", remote_name.as_str()])?;
    Ok(parse_tag_targets_from_lines(out.as_str()))
}

#[tauri::command]
#[allow(dead_code)]
pub(crate) fn git_push_tags(
    repo_path: String,
    remote_name: Option<String>,
    tags: Vec<String>,
    force: Option<bool>,
) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let remote_name = remote_name.unwrap_or_else(|| String::from("origin"));
    let remote_name = remote_name.trim().to_string();
    if remote_name.is_empty() {
        return Err(String::from("remote_name is empty"));
    }

    let force = force.unwrap_or(false);
    let tags: Vec<String> = tags
        .into_iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();
    if tags.is_empty() {
        return Err(String::from("tags is empty"));
    }

    let mut args: Vec<String> = Vec::new();
    args.push(String::from("push"));
    if force {
        args.push(String::from("--force"));
    }
    args.push(remote_name);
    for t in tags {
        args.push(format!("refs/tags/{}", t));
    }

    let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    crate::run_git(&repo_path, args_ref.as_slice())
}
