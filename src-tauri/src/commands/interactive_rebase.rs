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

    let conflict_files = crate::list_unmerged_files(repo_path);

    if !conflict_files.is_empty() {
        return InteractiveRebaseResult {
            status: String::from("conflicts"),
            message: String::from("Rebase stopped due to conflicts."),
            current_step,
            total_steps,
            stopped_commit_hash: stopped_sha,
            stopped_commit_message: stopped_message,
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
                    // We use fixup to avoid editor. If user wants combined message,
                    // we handle it by amending the target commit.
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
            return Err(String::from("All commits were dropped. Nothing to rebase."));
        }

        let todo_content = todo_lines.join("\n") + "\n";

        // Write todo to a temp file
        let temp_dir = std::env::temp_dir().join(format!("graphoria_rebase_{}", std::process::id()));
        fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp dir: {e}"))?;

        let todo_file = temp_dir.join("todo.txt");
        fs::write(&todo_file, &todo_content)
            .map_err(|e| format!("Failed to write todo file: {e}"))?;

        // Persist reword map to .git/ so continue can use it later
        save_reword_map(&repo_path, &reword_map);

        // Build the sequence editor command that copies our todo file
        let todo_path_str = todo_file.to_string_lossy().to_string();

        #[cfg(target_os = "windows")]
        let seq_editor = format!(
            "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command \"Copy-Item -Path '{}' -Destination $args[0] -Force\"",
            todo_path_str.replace('\'', "''")
        );

        #[cfg(not(target_os = "windows"))]
        let seq_editor = format!("cp '{}' \"$1\"", todo_path_str.replace('\'', "'\\''"));

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

        // Clean up temp dir
        let _ = fs::remove_dir_all(&temp_dir);

        if out.status.success() {
            cleanup_reword_map(&repo_path);
            return Ok(InteractiveRebaseResult {
                status: String::from("completed"),
                message: if !stdout.is_empty() { stdout } else { stderr },
                current_step: None,
                total_steps: None,
                stopped_commit_hash: None,
                stopped_commit_message: None,
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
