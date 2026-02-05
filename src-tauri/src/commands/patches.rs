use serde::Serialize;
use std::collections::HashSet;
use std::fs;

#[derive(Debug, Clone, Serialize)]
pub(crate) struct GitPatchPredictResult {
    ok: bool,
    message: String,
    files: Vec<String>,
}

fn parse_touched_files_from_patch_text(text: &str) -> Vec<String> {
    let mut files: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    for line in text.replace("\r\n", "\n").lines() {
        let l = line.trim_end();
        if let Some(rest) = l.strip_prefix("diff --git ") {
            // Example: diff --git a/foo/bar.txt b/foo/bar.txt
            let mut parts = rest.split_whitespace();
            let a = parts.next().unwrap_or_default();
            let b = parts.next().unwrap_or_default();
            let pick = if !b.is_empty() { b } else { a };
            let pick = pick.trim();
            if pick.starts_with("a/") || pick.starts_with("b/") {
                let p = pick[2..].to_string();
                if !p.trim().is_empty() && !seen.contains(&p) {
                    seen.insert(p.clone());
                    files.push(p);
                }
            }
        }
    }

    files
}

fn extract_diff_part_for_apply_check(text: &str) -> String {
    // `git apply` expects a raw diff. `git format-patch` produces an mbox-like
    // patch with headers before the diff. For predict we strip everything
    // before the first diff marker.
    let normalized = text.replace("\r\n", "\n");
    let mut start_idx: Option<usize> = None;
    let bytes = normalized.as_bytes();

    // Find first line starting with "diff --git ".
    let mut i: usize = 0;
    while i < normalized.len() {
        let line_start = i;
        while i < normalized.len() && bytes[i] != b'\n' {
            i += 1;
        }
        let line_end = i;
        let line = &normalized[line_start..line_end];
        if line.starts_with("diff --git ") {
            start_idx = Some(line_start);
            break;
        }
        i += 1; // skip '\n'
    }

    match start_idx {
        Some(idx) => normalized[idx..].to_string(),
        None => normalized,
    }
}

#[tauri::command]
pub(crate) fn git_format_patch_to_file(repo_path: String, commit: String, out_path: String) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let commit = commit.trim().to_string();
    if commit.is_empty() {
        return Err(String::from("commit is empty"));
    }

    let out_path = out_path.trim().to_string();
    if out_path.is_empty() {
        return Err(String::from("out_path is empty"));
    }

    crate::with_repo_git_lock(&repo_path, || {
        let raw = crate::run_git_stdout_raw(&repo_path, &["format-patch", "-1", "--stdout", commit.as_str()])?;
        fs::write(&out_path, raw.as_bytes()).map_err(|e| format!("Failed to write patch file: {e}"))?;
        Ok(String::from("ok"))
    })
}

#[tauri::command]
pub(crate) fn git_predict_patch_file(repo_path: String, patch_path: String, method: String) -> Result<GitPatchPredictResult, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let patch_path = patch_path.trim().to_string();
    if patch_path.is_empty() {
        return Err(String::from("patch_path is empty"));
    }

    let method = method.trim().to_lowercase();
    if method != "apply" && method != "am" {
        return Err(String::from("method must be 'apply' or 'am'"));
    }

    crate::with_repo_git_lock(&repo_path, || {
        let bytes = fs::read(&patch_path).map_err(|e| format!("Failed to read patch file: {e}"))?;
        let text = String::from_utf8_lossy(&bytes).to_string();
        let files = parse_touched_files_from_patch_text(text.as_str());

        let diff_part = if method == "am" {
            extract_diff_part_for_apply_check(text.as_str())
        } else {
            text
        };

        // `git apply --check` returns non-zero when patch doesn't apply.
        // For `am`, we approximate by checking the diff part using `git apply --check`.
        let args: [&str; 4] = ["apply", "--check", "--", "-"];
        let res = crate::run_git_with_stdin(&repo_path, &args, diff_part.as_str());

        match res {
            Ok(msg) => Ok(GitPatchPredictResult {
                ok: true,
                message: if msg.trim().is_empty() { String::from("ok") } else { msg },
                files,
            }),
            Err(e) => Ok(GitPatchPredictResult {
                ok: false,
                message: e,
                files,
            }),
        }
    })
}

#[tauri::command]
pub(crate) fn git_apply_patch_file(repo_path: String, patch_path: String, method: String) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let patch_path = patch_path.trim().to_string();
    if patch_path.is_empty() {
        return Err(String::from("patch_path is empty"));
    }

    let method = method.trim().to_lowercase();
    if method != "apply" && method != "am" {
        return Err(String::from("method must be 'apply' or 'am'"));
    }

    crate::with_repo_git_lock(&repo_path, || {
        if method == "apply" {
            crate::run_git(&repo_path, &["apply", "--", patch_path.as_str()])
        } else {
            // For `am`, we apply the mbox patch file as-is.
            crate::run_git(&repo_path, &["am", "--", patch_path.as_str()])
        }
    })
}
