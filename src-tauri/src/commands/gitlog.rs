use serde::Deserialize;
use crate::{ensure_is_git_worktree, git_command_in_repo, run_git, GitCommit};

#[derive(Debug, Deserialize)]
pub struct GitLogSearchParams {
    pub authors: Option<Vec<String>>,
    pub since: Option<String>,
    pub until: Option<String>,
    pub grep: Option<String>,
    pub grep_all_match: Option<bool>,
    pub invert_grep: Option<bool>,
    pub paths: Option<Vec<String>>,
    pub max_count: Option<u32>,
    pub skip: Option<u32>,
    pub merges_only: Option<bool>,
    pub no_merges: Option<bool>,
    pub first_parent: Option<bool>,
    pub all: Option<bool>,
    pub reverse: Option<bool>,
    pub diff_filter: Option<String>,
    pub min_parents: Option<u32>,
    pub max_parents: Option<u32>,
    pub branches: Option<String>,
    pub tags: Option<String>,
    pub remotes: Option<bool>,
    pub follow: Option<bool>,
    pub regexp_ignore_case: Option<bool>,
    pub fixed_strings: Option<bool>,
    pub ancestry_path: Option<bool>,
    pub simplify_by_decoration: Option<bool>,
}

#[tauri::command]
pub fn git_log_search(repo_path: String, params: GitLogSearchParams) -> Result<Vec<GitCommit>, String> {
    ensure_is_git_worktree(&repo_path)?;

    let format = "%H\x1f%P\x1f%an\x1f%ae\x1f%ad\x1f%s\x1f%D\x1e";
    let pretty = format!("--pretty=format:{format}");

    let mut args: Vec<String> = vec![
        String::from("--no-pager"),
        String::from("log"),
    ];

    if params.all.unwrap_or(false) {
        args.push(String::from("--all"));
    }

    if let Some(ref authors) = params.authors {
        for a in authors {
            let a = a.trim();
            if !a.is_empty() {
                args.push(format!("--author={a}"));
            }
        }
    }

    if let Some(ref since) = params.since {
        let s = since.trim();
        if !s.is_empty() {
            args.push(format!("--since={s}"));
        }
    }

    if let Some(ref until) = params.until {
        let u = until.trim();
        if !u.is_empty() {
            args.push(format!("--until={u}"));
        }
    }

    if let Some(ref grep) = params.grep {
        let g = grep.trim();
        if !g.is_empty() {
            args.push(format!("--grep={g}"));
        }
    }

    if params.grep_all_match.unwrap_or(false) {
        args.push(String::from("--all-match"));
    }

    if params.invert_grep.unwrap_or(false) {
        args.push(String::from("--invert-grep"));
    }

    if params.regexp_ignore_case.unwrap_or(false) {
        args.push(String::from("--regexp-ignore-case"));
    }

    if params.fixed_strings.unwrap_or(false) {
        args.push(String::from("--fixed-strings"));
    }

    if params.merges_only.unwrap_or(false) {
        args.push(String::from("--merges"));
    }

    if params.no_merges.unwrap_or(false) {
        args.push(String::from("--no-merges"));
    }

    if params.first_parent.unwrap_or(false) {
        args.push(String::from("--first-parent"));
    }

    if params.ancestry_path.unwrap_or(false) {
        args.push(String::from("--ancestry-path"));
    }

    if params.simplify_by_decoration.unwrap_or(false) {
        args.push(String::from("--simplify-by-decoration"));
    }

    if let Some(min) = params.min_parents {
        args.push(format!("--min-parents={min}"));
    }

    if let Some(max) = params.max_parents {
        args.push(format!("--max-parents={max}"));
    }

    if let Some(ref diff_filter) = params.diff_filter {
        let d = diff_filter.trim();
        if !d.is_empty() {
            args.push(format!("--diff-filter={d}"));
        }
    }

    if let Some(ref branches) = params.branches {
        let b = branches.trim();
        if !b.is_empty() {
            args.push(format!("--branches={b}"));
        } else {
            args.push(String::from("--branches"));
        }
    }

    if let Some(ref tags) = params.tags {
        let t = tags.trim();
        if !t.is_empty() {
            args.push(format!("--tags={t}"));
        } else {
            args.push(String::from("--tags"));
        }
    }

    if params.remotes.unwrap_or(false) {
        args.push(String::from("--remotes"));
    }

    if params.reverse.unwrap_or(false) {
        args.push(String::from("--reverse"));
    } else {
        args.push(String::from("--topo-order"));
    }

    args.push(String::from("--date=iso-strict"));
    args.push(pretty);

    if let Some(n) = params.max_count {
        if n > 0 {
            args.push(String::from("-n"));
            args.push(n.to_string());
        }
    }

    if let Some(s) = params.skip {
        if s > 0 {
            args.push(format!("--skip={s}"));
        }
    }

    if params.follow.unwrap_or(false) {
        args.push(String::from("--follow"));
    }

    let has_path_args = params.paths.as_ref().map_or(false, |p| p.iter().any(|s| !s.trim().is_empty()));

    if !has_path_args {
        args.push(String::from("HEAD"));
    }

    if has_path_args {
        args.push(String::from("--"));
        for p in params.paths.unwrap_or_default() {
            let p = p.trim().to_string();
            if !p.is_empty() {
                args.push(p);
            }
        }
    }

    let output = git_command_in_repo(&repo_path)
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to spawn git log: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stderr_lower = stderr.to_lowercase();
        if stderr_lower.contains("does not have any commits yet")
            || stderr_lower.contains("does not have any commits")
            || stderr_lower.contains("your current branch")
            || stderr_lower.contains("unknown revision")
        {
            return Ok(Vec::new());
        }
        return Err(format!("git log failed: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);

    let head = run_git(&repo_path, &["rev-parse", "HEAD"]).unwrap_or_default();
    let head = head.trim().to_string();

    let mut commits = Vec::new();
    for record in stdout.split('\x1e') {
        let record = record.trim();
        if record.is_empty() {
            continue;
        }

        let mut parts = record.split('\x1f');
        let hash = parts.next().unwrap_or_default().to_string();
        let parents_raw = parts.next().unwrap_or_default();
        let author = parts.next().unwrap_or_default().to_string();
        let author_email = parts.next().unwrap_or_default().to_string();
        let date = parts.next().unwrap_or_default().to_string();
        let subject = parts.next().unwrap_or_default().to_string();
        let decorations = parts.next().unwrap_or_default().trim().to_string();

        if hash.is_empty() {
            continue;
        }

        let parents = parents_raw
            .split_whitespace()
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect();

        commits.push(GitCommit {
            hash: hash.clone(),
            parents,
            author,
            author_email,
            date,
            subject,
            refs: decorations,
            is_head: head == hash,
        });
    }

    // Resolve branch names for commits without decorations via git name-rev
    let needs_resolve: Vec<usize> = commits.iter().enumerate()
        .filter(|(_, c)| c.refs.is_empty())
        .map(|(i, _)| i)
        .collect();

    if !needs_resolve.is_empty() {
        let hashes: Vec<&str> = needs_resolve.iter()
            .map(|&i| commits[i].hash.as_str())
            .collect();

        let mut nr_args: Vec<&str> = vec!["name-rev", "--refs=refs/heads/*", "--name-only"];
        nr_args.extend(hashes.iter());

        if let Ok(nr_out) = run_git(&repo_path, &nr_args) {
            let names: Vec<&str> = nr_out.lines().collect();
            for (idx, &ci) in needs_resolve.iter().enumerate() {
                if let Some(name) = names.get(idx) {
                    let name = name.trim();
                    if !name.is_empty() && name != "undefined" {
                        // Strip ~N or ^N suffixes to get just the branch name
                        let branch = name.split(&['~', '^'][..]).next().unwrap_or(name);
                        commits[ci].refs = branch.to_string();
                    }
                }
            }
        }
    }

    Ok(commits)
}
