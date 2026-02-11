use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub(crate) struct InteractiveRebaseTodoEntry {
    pub action: String, // pick | reword | edit | squash | fixup | drop
    pub hash: String,
    pub short_hash: Option<String>,
    pub original_message: Option<String>,
    pub new_message: Option<String>,
    pub new_author: Option<String>, // "Name <email>"
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct InteractiveRebaseCommitInfo {
    pub hash: String,
    pub short_hash: String,
    pub subject: String,
    pub body: String,
    pub author_name: String,
    pub author_email: String,
    pub author_date: String,
    pub is_pushed: bool,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct InteractiveRebaseResult {
    pub status: String, // "completed" | "stopped_at_edit" | "conflicts" | "error"
    pub message: String,
    pub current_step: Option<u32>,
    pub total_steps: Option<u32>,
    pub stopped_commit_hash: Option<String>,
    pub stopped_commit_message: Option<String>,
    pub stopped_commit_author_name: Option<String>,
    pub stopped_commit_author_email: Option<String>,
    pub conflict_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct InteractiveRebaseStatusInfo {
    pub in_progress: bool,
    pub current_step: Option<u32>,
    pub total_steps: Option<u32>,
    pub stopped_commit_hash: Option<String>,
    pub stopped_commit_message: Option<String>,
    pub conflict_files: Vec<String>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn resolve_git_path(repo_path: &str, git_path: &str) -> Result<Option<PathBuf>, String> {
    let full = crate::run_git(repo_path, &["rev-parse", "--git-path", git_path]).unwrap_or_default();
    let full = full.trim();
    if full.is_empty() {
        return Ok(None);
    }
    let p = PathBuf::from(full);
    if p.is_absolute() {
        Ok(Some(p))
    } else {
        Ok(Some(Path::new(repo_path).join(p)))
    }
}

fn rebase_merge_dir(repo_path: &str) -> Option<PathBuf> {
    resolve_git_path(repo_path, "rebase-merge").ok().flatten().filter(|p| p.exists())
}

fn read_rebase_file(repo_path: &str, name: &str) -> Option<String> {
    let dir = rebase_merge_dir(repo_path)?;
    fs::read_to_string(dir.join(name)).ok()
}

type RewordMap = std::collections::HashMap<String, (Option<String>, Option<String>)>;

fn graphoria_reword_map_path(repo_path: &str) -> Option<PathBuf> {
    let git_dir = crate::run_git(repo_path, &["rev-parse", "--git-dir"]).ok()?;
    let git_dir = git_dir.trim();
    if git_dir.is_empty() { return None; }
    let p = PathBuf::from(git_dir);
    let p = if p.is_absolute() { p } else { Path::new(repo_path).join(p) };
    Some(p.join("graphoria-reword-map.json"))
}

fn save_reword_map(repo_path: &str, map: &RewordMap) {
    if let Some(path) = graphoria_reword_map_path(repo_path) {
        let _ = fs::write(&path, serde_json::to_string(map).unwrap_or_default());
    }
}

fn load_reword_map(repo_path: &str) -> RewordMap {
    graphoria_reword_map_path(repo_path)
        .and_then(|p| fs::read_to_string(&p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn cleanup_reword_map(repo_path: &str) {
    if let Some(path) = graphoria_reword_map_path(repo_path) {
        let _ = fs::remove_file(&path);
    }
}

fn no_editor_env(cmd: &mut std::process::Command) {
    #[cfg(target_os = "windows")]
    {
        let ps = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command \"exit 0 #\"";
        cmd.env("GIT_EDITOR", ps);
        cmd.env("EDITOR", ps);
        cmd.env("VISUAL", ps);
    }

    #[cfg(not(target_os = "windows"))]
    {
        cmd.env("GIT_EDITOR", "true");
        cmd.env("EDITOR", "true");
        cmd.env("VISUAL", "true");
    }
}

/// Fetch author name and email from HEAD commit.
fn get_head_author(repo_path: &str) -> (Option<String>, Option<String>) {
    let out = crate::git_command_in_repo(repo_path)
        .args(["--no-pager", "log", "-1", "--pretty=format:%an\x1f%ae", "HEAD"])
        .output();
    match out {
        Ok(o) if o.status.success() => {
            let s = String::from_utf8_lossy(&o.stdout);
            let parts: Vec<&str> = s.trim().splitn(2, '\x1f').collect();
            let name = parts.first().map(|s| s.to_string()).filter(|s| !s.is_empty());
            let email = parts.get(1).map(|s| s.to_string()).filter(|s| !s.is_empty());
            (name, email)
        }
        _ => (None, None),
    }
}

fn detect_rebase_state(repo_path: &str) -> InteractiveRebaseResult {
    let in_progress = crate::is_rebase_in_progress(repo_path);
    if !in_progress {
        // Check if rebase-merge dir still exists (rebase might be paused at edit without REBASE_HEAD)
        let dir_exists = rebase_merge_dir(repo_path).is_some();
        if !dir_exists {
            return InteractiveRebaseResult {
                status: String::from("completed"),
                message: String::from("Rebase completed successfully."),
                current_step: None,
                total_steps: None,
                stopped_commit_hash: None,
                stopped_commit_message: None,
                stopped_commit_author_name: None,
                stopped_commit_author_email: None,
                conflict_files: Vec::new(),
            };
        }
    }

    let current_step = read_rebase_file(repo_path, "msgnum")
        .and_then(|s| s.trim().parse::<u32>().ok());
    let total_steps = read_rebase_file(repo_path, "end")
        .and_then(|s| s.trim().parse::<u32>().ok());

    let stopped_sha = read_rebase_file(repo_path, "stopped-sha")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let stopped_message = read_rebase_file(repo_path, "message")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let (author_name, author_email) = get_head_author(repo_path);

    let conflict_files = crate::list_unmerged_files(repo_path);

    if !conflict_files.is_empty() {
        return InteractiveRebaseResult {
            status: String::from("conflicts"),
            message: String::from("Rebase stopped due to conflicts."),
            current_step,
            total_steps,
            stopped_commit_hash: stopped_sha,
            stopped_commit_message: stopped_message,
            stopped_commit_author_name: author_name,
            stopped_commit_author_email: author_email,
            conflict_files,
        };
    }

    InteractiveRebaseResult {
        status: String::from("stopped_at_edit"),
        message: String::from("Rebase stopped for editing."),
        current_step,
        total_steps,
        stopped_commit_hash: stopped_sha,
        stopped_commit_message: stopped_message,
        stopped_commit_author_name: author_name,
        stopped_commit_author_email: author_email,
        conflict_files: Vec::new(),
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Lists commits eligible for interactive rebase.
/// If `base` is empty/None, tries to use @{upstream}; falls back to --root.
/// Returns commits in oldest-first order (bottom = newest).
#[tauri::command]
pub(crate) fn git_interactive_rebase_commits(
    repo_path: String,
    base: Option<String>,
) -> Result<Vec<InteractiveRebaseCommitInfo>, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let base_ref = match base.as_deref().map(|s| s.trim()) {
        Some(b) if !b.is_empty() => b.to_string(),
        _ => {
            // Try upstream
            let upstream = crate::run_git(&repo_path, &["rev-parse", "--abbrev-ref", "@{upstream}"])
                .unwrap_or_default()
                .trim()
                .to_string();
            if upstream.is_empty() {
                // Use root: list all commits on HEAD
                String::new()
            } else {
                upstream
            }
        }
    };

    let range = if base_ref.is_empty() {
        String::from("HEAD")
    } else {
        format!("{}..HEAD", base_ref)
    };

    // Get commit details
    let format_str = "%H\x1f%h\x1f%s\x1f%b\x1f%an\x1f%ae\x1f%ad\x1e";
    let pretty = format!("--pretty=format:{}", format_str);

    let output = crate::git_command_in_repo(&repo_path)
        .args(["--no-pager", "log", "--reverse", "--date=iso-strict", &pretty, &range])
        .output()
        .map_err(|e| format!("Failed to spawn git log: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let lower = stderr.to_lowercase();
        if lower.contains("unknown revision") || lower.contains("does not have any commits") {
            return Ok(Vec::new());
        }
        return Err(format!("git log failed: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);

    // Determine which commits are pushed (exist on any remote)
    let pushed_set = get_pushed_commits(&repo_path, &base_ref);

    let mut commits = Vec::new();
    for record in stdout.split('\x1e') {
        let record = record.trim();
        if record.is_empty() {
            continue;
        }

        let parts: Vec<&str> = record.splitn(7, '\x1f').collect();
        let hash = parts.first().unwrap_or(&"").trim().to_string();
        let short_hash = parts.get(1).unwrap_or(&"").trim().to_string();
        let subject = parts.get(2).unwrap_or(&"").trim().to_string();
        let body = parts.get(3).unwrap_or(&"").trim().to_string();
        let author_name = parts.get(4).unwrap_or(&"").trim().to_string();
        let author_email = parts.get(5).unwrap_or(&"").trim().to_string();
        let author_date = parts.get(6).unwrap_or(&"").trim().to_string();

        if hash.is_empty() {
            continue;
        }

        let is_pushed = pushed_set.contains(&hash);

        commits.push(InteractiveRebaseCommitInfo {
            hash,
            short_hash,
            subject,
            body,
            author_name,
            author_email,
            author_date,
            is_pushed,
        });
    }

    Ok(commits)
}

fn get_pushed_commits(repo_path: &str, base_ref: &str) -> std::collections::HashSet<String> {
    let mut set = std::collections::HashSet::new();

    // Get all remote refs
    let remote_refs = crate::run_git(repo_path, &["for-each-ref", "--format=%(objectname)", "refs/remotes/"])
        .unwrap_or_default();

    for line in remote_refs.lines() {
        let h = line.trim();
        if !h.is_empty() {
            set.insert(h.to_string());
        }
    }

    // Also check merge-base: commits reachable from remotes
    if !base_ref.is_empty() {
        let mb = crate::run_git(repo_path, &["merge-base", "HEAD", base_ref]).unwrap_or_default();
        let mb = mb.trim();
        if !mb.is_empty() {
            set.insert(mb.to_string());
        }
    }

    // For more accuracy: check which commits are ancestors of remote branches
    // Use rev-list to find commits reachable from remotes but in our range
    let remote_check = crate::git_command_in_repo(repo_path)
        .args(["rev-list", "--remotes"])
        .output()
        .ok();

    if let Some(out) = remote_check {
        if out.status.success() {
            let stdout = String::from_utf8_lossy(&out.stdout);
            for line in stdout.lines() {
                let h = line.trim();
                if !h.is_empty() {
                    set.insert(h.to_string());
                }
            }
        }
    }

    set
}

/// Starts an interactive rebase with the given todo list.
/// `base` is the commit to rebase onto (exclusive).
/// `todo_entries` is the list of commits with their desired actions.
///
/// The function handles `reword` entries by converting them to `edit` and
/// auto-amending with the new message. It returns when the rebase either
/// completes, stops at a real `edit`, or hits conflicts.
#[tauri::command]
pub(crate) fn git_interactive_rebase_start(
    repo_path: String,
    base: String,
    todo_entries: Vec<InteractiveRebaseTodoEntry>,
) -> Result<InteractiveRebaseResult, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    if todo_entries.is_empty() {
        return Err(String::from("No commits selected for rebase."));
    }

    // Check that no rebase/merge is already in progress
    if crate::is_rebase_in_progress(&repo_path) {
        return Err(String::from("A rebase is already in progress."));
    }
    if crate::is_merge_in_progress(&repo_path) {
        return Err(String::from("A merge is in progress. Resolve it first."));
    }

    crate::with_repo_git_lock(&repo_path, || {
        // Build the todo content.
        // Convert `reword` → `edit` so we can auto-amend with the new message.
        // Keep track of which entries are actually reword/author-change so we can auto-handle them.
        let mut todo_lines = Vec::new();
        let mut reword_map: std::collections::HashMap<String, (Option<String>, Option<String>)> =
            std::collections::HashMap::new();

        for entry in &todo_entries {
            let action = entry.action.trim().to_lowercase();
            let hash = entry.hash.trim();

            if hash.is_empty() {
                continue;
            }

            match action.as_str() {
                "drop" => {
                    // Omit from todo = drop
                    continue;
                }
                "reword" => {
                    // Convert to edit so we can amend with new message
                    let msg = entry.original_message.as_deref().unwrap_or("");
                    todo_lines.push(format!("edit {} {}", hash, msg));
                    reword_map.insert(
                        hash.to_string(),
                        (entry.new_message.clone(), entry.new_author.clone()),
                    );
                }
                "edit" => {
                    let msg = entry.original_message.as_deref().unwrap_or("");
                    todo_lines.push(format!("edit {} {}", hash, msg));
                    // If author change requested, store it
                    if entry.new_author.is_some() || entry.new_message.is_some() {
                        reword_map.insert(
                            hash.to_string(),
                            (entry.new_message.clone(), entry.new_author.clone()),
                        );
                    }
                }
                "squash" => {
                    let msg = entry.original_message.as_deref().unwrap_or("");
                    todo_lines.push(format!("fixup {} {}", hash, msg));
                }
                "fixup" => {
                    let msg = entry.original_message.as_deref().unwrap_or("");
                    todo_lines.push(format!("fixup {} {}", hash, msg));
                }
                _ => {
                    // pick (default)
                    let msg = entry.original_message.as_deref().unwrap_or("");
                    todo_lines.push(format!("pick {} {}", hash, msg));
                    // If only author change requested on a pick
                    if entry.new_author.is_some() {
                        todo_lines.pop();
                        todo_lines.push(format!("edit {} {}", hash, msg));
                        reword_map.insert(
                            hash.to_string(),
                            (None, entry.new_author.clone()),
                        );
                    }
                }
            }
        }

        if todo_lines.is_empty() {
            // All commits dropped — reset branch to the base commit
            let out = crate::git_command_in_repo(&repo_path)
                .args(["reset", "--hard", base.trim()])
                .output()
                .map_err(|e| format!("Failed to reset to base: {e}"))?;
            if !out.status.success() {
                let stderr = String::from_utf8_lossy(&out.stderr).trim_end().to_string();
                return Err(format!("Failed to drop commits: {stderr}"));
            }
            return Ok(InteractiveRebaseResult {
                status: String::from("completed"),
                message: String::from("All selected commits were dropped."),
                current_step: None,
                total_steps: None,
                stopped_commit_hash: None,
                stopped_commit_message: None,
                stopped_commit_author_name: None,
                stopped_commit_author_email: None,
                conflict_files: Vec::new(),
            });
        }

        let todo_content = todo_lines.join("\n") + "\n";

        // Write a shell script that overwrites git's todo file ($1) with our
        // custom content using a heredoc.  This is more robust on Windows than
        // the previous `cp` approach because it avoids path-translation and
        // file-locking edge cases in MSYS2.
        let temp_dir = std::env::temp_dir().join(format!("graphoria_rebase_{}", std::process::id()));
        fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp dir: {e}"))?;

        let mut script = String::from("#!/bin/sh\ncat > \"$1\" << 'GRAPHORIA_REBASE_TODO_EOF'\n");
        script.push_str(&todo_content);
        if !script.ends_with('\n') {
            script.push('\n');
        }
        script.push_str("GRAPHORIA_REBASE_TODO_EOF\n");

        let script_file = temp_dir.join("seq_editor.sh");
        fs::write(&script_file, script.as_bytes())
            .map_err(|e| format!("Failed to write seq editor script: {e}"))?;

        // Persist reword map to .git/ so continue can use it later
        save_reword_map(&repo_path, &reword_map);

        let script_path_str = script_file.to_string_lossy().replace('\\', "/");
        let seq_editor = format!("sh '{}'", script_path_str.replace('\'', "'\\''"));

        eprintln!("[graphoria rebase] base={} todo_lines={} seq_editor={}", base.trim(), todo_lines.len(), &seq_editor);
        eprintln!("[graphoria rebase] todo:\n{}", &todo_content);

        // Start the rebase
        let mut cmd = crate::git_command_in_repo(&repo_path);
        no_editor_env(&mut cmd);
        cmd.env("GIT_SEQUENCE_EDITOR", &seq_editor);

        let out = cmd
            .args(["rebase", "-i", "--autostash", base.trim()])
            .output()
            .map_err(|e| format!("Failed to start interactive rebase: {e}"))?;

        let stdout = String::from_utf8_lossy(&out.stdout).trim_end().to_string();
        let stderr = String::from_utf8_lossy(&out.stderr).trim_end().to_string();

        eprintln!("[graphoria rebase] exit={} stdout={:?} stderr={:?}", out.status, &stdout, &stderr);

        // Clean up temp dir
        let _ = fs::remove_dir_all(&temp_dir);

        // Some git versions exit 0 even when stopping at an `edit` action.
        // Always check if the rebase is still in progress before declaring completion.
        let still_in_progress = rebase_merge_dir(&repo_path).is_some()
            || crate::is_rebase_in_progress(&repo_path);

        if out.status.success() && !still_in_progress {
            cleanup_reword_map(&repo_path);
            return Ok(InteractiveRebaseResult {
                status: String::from("completed"),
                message: if !stdout.is_empty() { stdout } else { stderr },
                current_step: None,
                total_steps: None,
                stopped_commit_hash: None,
                stopped_commit_message: None,
                stopped_commit_author_name: None,
                stopped_commit_author_email: None,
                conflict_files: Vec::new(),
            });
        }

        // Rebase stopped - could be edit stop or conflicts
        let state = detect_rebase_state(&repo_path);

        if state.status == "stopped_at_edit" {
            // Try auto-amending if this is a reword entry
            return auto_amend_reword_loop(&repo_path);
        }

        Ok(state)
    })
}

/// Auto-amend loop: when rebase stops at an `edit`, check if it's a reword
/// (we have a message/author to apply). If so, amend and continue. Repeat
/// until rebase completes, hits a real edit, or hits conflicts.
fn auto_amend_reword_loop(
    repo_path: &str,
) -> Result<InteractiveRebaseResult, String> {
    let reword_map = load_reword_map(repo_path);
    loop {
        // Check if rebase-merge dir exists (rebase in progress or paused at edit)
        let dir = rebase_merge_dir(repo_path);
        if dir.is_none() {
            return Ok(InteractiveRebaseResult {
                status: String::from("completed"),
                message: String::from("Rebase completed successfully."),
                current_step: None,
                total_steps: None,
                stopped_commit_hash: None,
                stopped_commit_message: None,
                stopped_commit_author_name: None,
                stopped_commit_author_email: None,
                conflict_files: Vec::new(),
            });
        }

        let stopped_sha = read_rebase_file(repo_path, "stopped-sha")
            .map(|s| s.trim().to_string())
            .unwrap_or_default();

        // Check if this stopped commit has a reword entry
        let reword_entry = if !stopped_sha.is_empty() {
            // Try matching by prefix (stopped-sha may be short or full)
            reword_map.iter().find(|(k, _)| {
                k.starts_with(&stopped_sha) || stopped_sha.starts_with(k.as_str())
            }).map(|(_, v)| v.clone())
        } else {
            None
        };

        match reword_entry {
            Some((new_message, new_author)) => {
                // This is a reword/author-change: auto-amend and continue
                let mut amend_args: Vec<String> = vec![
                    String::from("commit"),
                    String::from("--amend"),
                    String::from("--no-verify"),
                ];

                if let Some(ref msg) = new_message {
                    if !msg.trim().is_empty() {
                        amend_args.push(String::from("-m"));
                        amend_args.push(msg.clone());
                    } else {
                        amend_args.push(String::from("--no-edit"));
                    }
                } else {
                    amend_args.push(String::from("--no-edit"));
                }

                if let Some(ref author) = new_author {
                    if !author.trim().is_empty() {
                        amend_args.push(String::from("--author"));
                        amend_args.push(author.clone());
                    }
                }

                let amend_args_ref: Vec<&str> = amend_args.iter().map(|s| s.as_str()).collect();
                let mut cmd = crate::git_command_in_repo(repo_path);
                no_editor_env(&mut cmd);
                let amend_out = cmd
                    .args(&amend_args_ref)
                    .output()
                    .map_err(|e| format!("Failed to amend commit: {e}"))?;

                if !amend_out.status.success() {
                    let stderr = String::from_utf8_lossy(&amend_out.stderr).trim_end().to_string();
                    return Err(format!("Failed to amend commit: {stderr}"));
                }

                // Continue rebase
                let mut cont_cmd = crate::git_command_in_repo(repo_path);
                no_editor_env(&mut cont_cmd);
                let cont_out = cont_cmd
                    .args(["rebase", "--continue"])
                    .output()
                    .map_err(|e| format!("Failed to continue rebase: {e}"))?;

                if cont_out.status.success() {
                    // Check if rebase is done
                    let dir = rebase_merge_dir(repo_path);
                    if dir.is_none() && !crate::is_rebase_in_progress(repo_path) {
                        cleanup_reword_map(repo_path);
                        return Ok(InteractiveRebaseResult {
                            status: String::from("completed"),
                            message: String::from("Rebase completed successfully."),
                            current_step: None,
                            total_steps: None,
                            stopped_commit_hash: None,
                            stopped_commit_message: None,
                            stopped_commit_author_name: None,
                            stopped_commit_author_email: None,
                            conflict_files: Vec::new(),
                        });
                    }
                    // Loop to handle next stop
                    continue;
                }

                // Continue failed - check for conflicts or next edit
                let state = detect_rebase_state(repo_path);
                if state.status == "stopped_at_edit" {
                    // Loop again to check if next stop is also a reword
                    continue;
                }
                return Ok(state);
            }
            None => {
                // This is a real edit stop - return to frontend
                return Ok(detect_rebase_state(repo_path));
            }
        }
    }
}

/// Amend the currently stopped commit during an interactive rebase edit.
#[tauri::command]
pub(crate) fn git_interactive_rebase_amend(
    repo_path: String,
    message: Option<String>,
    author: Option<String>,
) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    // Verify we're in a rebase
    let dir = rebase_merge_dir(&repo_path);
    if dir.is_none() {
        return Err(String::from("No interactive rebase in progress."));
    }

    let mut args: Vec<String> = vec![
        String::from("commit"),
        String::from("--amend"),
        String::from("--no-verify"),
    ];

    if let Some(ref msg) = message {
        if !msg.trim().is_empty() {
            args.push(String::from("-m"));
            args.push(msg.clone());
        } else {
            args.push(String::from("--no-edit"));
        }
    } else {
        args.push(String::from("--no-edit"));
    }

    if let Some(ref a) = author {
        if !a.trim().is_empty() {
            args.push(String::from("--author"));
            args.push(a.clone());
        }
    }

    let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let mut cmd = crate::git_command_in_repo(&repo_path);
    no_editor_env(&mut cmd);
    let out = cmd
        .args(&args_ref)
        .output()
        .map_err(|e| format!("Failed to amend: {e}"))?;

    let stdout = String::from_utf8_lossy(&out.stdout).trim_end().to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).trim_end().to_string();

    if out.status.success() {
        Ok(if !stdout.is_empty() { stdout } else { stderr })
    } else {
        Err(if !stderr.is_empty() { stderr } else { stdout })
    }
}

/// Continue interactive rebase after an edit stop.
/// Auto-handles subsequent reword stops.
#[tauri::command]
pub(crate) fn git_interactive_rebase_continue(
    repo_path: String,
) -> Result<InteractiveRebaseResult, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    crate::with_repo_git_lock(&repo_path, || {
        let mut cmd = crate::git_command_in_repo(&repo_path);
        no_editor_env(&mut cmd);

        let out = cmd
            .args(["rebase", "--continue"])
            .output()
            .map_err(|e| format!("Failed to continue rebase: {e}"))?;

        if out.status.success() {
            let dir = rebase_merge_dir(&repo_path);
            if dir.is_none() && !crate::is_rebase_in_progress(&repo_path) {
                cleanup_reword_map(&repo_path);
                return Ok(InteractiveRebaseResult {
                    status: String::from("completed"),
                    message: String::from("Rebase completed successfully."),
                    current_step: None,
                    total_steps: None,
                    stopped_commit_hash: None,
                    stopped_commit_message: None,
                    stopped_commit_author_name: None,
                    stopped_commit_author_email: None,
                    conflict_files: Vec::new(),
                });
            }
        }

        // Check if stopped at edit - try auto-amending rewords
        let state = detect_rebase_state(&repo_path);
        if state.status == "stopped_at_edit" {
            return auto_amend_reword_loop(&repo_path);
        }
        Ok(state)
    })
}

/// Get current interactive rebase status.
#[tauri::command]
pub(crate) fn git_interactive_rebase_status(
    repo_path: String,
) -> Result<InteractiveRebaseStatusInfo, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let dir = rebase_merge_dir(&repo_path);
    let in_progress = dir.is_some() || crate::is_rebase_in_progress(&repo_path);

    if !in_progress {
        return Ok(InteractiveRebaseStatusInfo {
            in_progress: false,
            current_step: None,
            total_steps: None,
            stopped_commit_hash: None,
            stopped_commit_message: None,
            conflict_files: Vec::new(),
        });
    }

    let current_step = read_rebase_file(&repo_path, "msgnum")
        .and_then(|s| s.trim().parse::<u32>().ok());
    let total_steps = read_rebase_file(&repo_path, "end")
        .and_then(|s| s.trim().parse::<u32>().ok());
    let stopped_sha = read_rebase_file(&repo_path, "stopped-sha")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let stopped_message = read_rebase_file(&repo_path, "message")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let conflict_files = crate::list_unmerged_files(&repo_path);

    Ok(InteractiveRebaseStatusInfo {
        in_progress,
        current_step,
        total_steps,
        stopped_commit_hash: stopped_sha,
        stopped_commit_message: stopped_message,
        conflict_files,
    })
}

// ---------------------------------------------------------------------------
// Edit-stop file operations
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub(crate) struct EditStopFileEntry {
    pub status: String,   // "A", "M", "D", "R", "C", etc.
    pub path: String,
    pub old_path: Option<String>, // for renames
}

/// List files changed in the currently stopped commit (HEAD vs HEAD^).
#[tauri::command]
pub(crate) fn git_interactive_rebase_edit_files(
    repo_path: String,
) -> Result<Vec<EditStopFileEntry>, String> {
    crate::ensure_is_git_worktree(&repo_path)?;

    let out = crate::git_command_in_repo(&repo_path)
        .args(["diff-tree", "--no-commit-id", "-r", "--name-status", "HEAD"])
        .output()
        .map_err(|e| format!("Failed to list commit files: {e}"))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim_end().to_string();
        return Err(format!("git diff-tree failed: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut entries = Vec::new();
    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() { continue; }
        let parts: Vec<&str> = line.splitn(3, '\t').collect();
        if parts.len() < 2 { continue; }
        let status_raw = parts[0].to_string();
        // For renames/copies: status is like R100, path is "old\tnew"
        let (status, path, old_path) = if status_raw.starts_with('R') || status_raw.starts_with('C') {
            let old = parts.get(1).unwrap_or(&"").to_string();
            let new = parts.get(2).unwrap_or(&"").to_string();
            (status_raw.chars().next().unwrap_or('R').to_string(), new, Some(old))
        } else {
            (status_raw, parts[1].to_string(), None)
        };
        entries.push(EditStopFileEntry { status, path, old_path });
    }
    Ok(entries)
}

/// Read a file from the working tree.
#[tauri::command]
pub(crate) fn git_read_working_file(
    repo_path: String,
    path: String,
) -> Result<String, String> {
    crate::ensure_is_git_worktree(&repo_path)?;
    let full = std::path::Path::new(&repo_path).join(&path);
    std::fs::read_to_string(&full)
        .map_err(|e| format!("Failed to read {}: {e}", path))
}

/// Write content to a file in the working tree.
#[tauri::command]
pub(crate) fn git_write_working_file(
    repo_path: String,
    path: String,
    content: String,
) -> Result<(), String> {
    crate::ensure_is_git_worktree(&repo_path)?;
    let full = std::path::Path::new(&repo_path).join(&path);
    // Ensure parent dir exists
    if let Some(parent) = full.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(&full, content.as_bytes())
        .map_err(|e| format!("Failed to write {}: {e}", path))
}

/// Rename a file in the working tree using git mv.
#[tauri::command]
pub(crate) fn git_rename_working_file(
    repo_path: String,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    crate::ensure_is_git_worktree(&repo_path)?;
    crate::run_git(&repo_path, &["mv", &old_path, &new_path])?;
    Ok(())
}

/// Delete a file from the working tree using git rm.
#[tauri::command]
pub(crate) fn git_delete_working_file(
    repo_path: String,
    path: String,
) -> Result<(), String> {
    crate::ensure_is_git_worktree(&repo_path)?;
    crate::run_git(&repo_path, &["rm", "-f", &path])?;
    Ok(())
}

/// Discard changes to a file during edit stop (restore from HEAD).
#[tauri::command]
pub(crate) fn git_restore_working_file(
    repo_path: String,
    path: String,
) -> Result<(), String> {
    crate::ensure_is_git_worktree(&repo_path)?;
    crate::run_git(&repo_path, &["checkout", "HEAD", "--", &path])?;
    Ok(())
}
