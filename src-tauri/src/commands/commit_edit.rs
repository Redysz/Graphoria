use serde::Serialize;
use std::collections::HashMap;
use std::io::Write;
use std::process::Stdio;

#[derive(Debug, Clone, Serialize)]
pub(crate) struct CommitEditInfo {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub author_name: String,
    pub author_email: String,
    pub author_date: String,
    pub is_head: bool,
    pub is_merge: bool,
    pub reachable_from_head: bool,
    pub rewritten_descendants: u32,
    pub pushed_to: Vec<String>,
    pub other_local_branches: Vec<String>,
    pub current_branch: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct CommitEditResult {
    pub new_hash: String,
    pub new_head: String,
    pub rewritten: u32,
}

struct RawCommit {
    hash: String,
    tree: String,
    parents: Vec<String>,
    author_name: String,
    author_email: String,
    author_date: String,
    committer_name: String,
    committer_email: String,
    committer_date: String,
    message: String,
}

fn read_commits(repo_path: &str, selection: &[&str]) -> Result<Vec<RawCommit>, String> {
    let mut args = vec![
        "--no-pager",
        "log",
        "--no-show-signature",
        "--date=raw",
        "--format=%H%x1f%T%x1f%P%x1f%an%x1f%ae%x1f%ad%x1f%cn%x1f%ce%x1f%cd%x1f%B%x1e",
    ];
    args.extend_from_slice(selection);
    let out = crate::run_git(repo_path, &args)?;

    let mut commits = Vec::new();
    for record in out.split('\x1e') {
        let record = record.trim_start_matches(['\n', '\r']);
        if record.trim().is_empty() {
            continue;
        }
        let p: Vec<&str> = record.splitn(10, '\x1f').collect();
        if p.len() < 10 {
            return Err(String::from("Unexpected git log output."));
        }
        commits.push(RawCommit {
            hash: p[0].to_string(),
            tree: p[1].to_string(),
            parents: p[2].split_whitespace().map(|s| s.to_string()).collect(),
            author_name: p[3].to_string(),
            author_email: p[4].to_string(),
            author_date: p[5].to_string(),
            committer_name: p[6].to_string(),
            committer_email: p[7].to_string(),
            committer_date: p[8].to_string(),
            message: p[9].to_string(),
        });
    }
    Ok(commits)
}

fn resolve_commit(repo_path: &str, rev: &str) -> Result<String, String> {
    let spec = format!("{}^{{commit}}", rev.trim());
    crate::run_git(repo_path, &["rev-parse", "--verify", "--quiet", spec.as_str()])
        .map(|s| s.trim().to_string())
        .map_err(|_| format!("Commit '{}' was not found.", rev.trim()))
}

fn is_ancestor(repo_path: &str, ancestor: &str, descendant: &str) -> bool {
    crate::git_command_in_repo(repo_path)
        .args(["merge-base", "--is-ancestor", ancestor, descendant])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn current_branch(repo_path: &str) -> Option<String> {
    crate::run_git(repo_path, &["symbolic-ref", "--short", "-q", "HEAD"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn refs_containing(repo_path: &str, hash: &str, namespace: &str, format: &str) -> Vec<String> {
    crate::run_git(
        repo_path,
        &["for-each-ref", "--contains", hash, format, namespace],
    )
    .unwrap_or_default()
    .lines()
    .map(|l| l.trim().to_string())
    .filter(|l| !l.is_empty())
    .collect()
}

pub(crate) fn commit_edit_info_impl(repo_path: &str, rev: &str) -> Result<CommitEditInfo, String> {
    crate::ensure_is_git_worktree(repo_path)?;

    let hash = resolve_commit(repo_path, rev)?;
    let head = crate::run_git(repo_path, &["rev-parse", "--verify", "HEAD"])
        .map(|s| s.trim().to_string())
        .unwrap_or_default();

    let commit = read_commits(repo_path, &["-1", hash.as_str()])?
        .into_iter()
        .next()
        .ok_or_else(|| String::from("Commit not found."))?;

    let reachable_from_head = !head.is_empty() && is_ancestor(repo_path, &hash, &head);
    let rewritten_descendants = if reachable_from_head && hash != head {
        let range = format!("{}..{}", hash, head);
        crate::run_git(repo_path, &["rev-list", "--count", "--ancestry-path", range.as_str()])
            .ok()
            .and_then(|s| s.trim().parse::<u32>().ok())
            .unwrap_or(0)
    } else {
        0
    };

    let pushed_to = refs_containing(repo_path, &hash, "refs/remotes", "--format=%(refname)")
        .into_iter()
        .filter(|r| !r.ends_with("/HEAD"))
        .map(|r| r.trim_start_matches("refs/remotes/").to_string())
        .collect();

    let branch = current_branch(repo_path);
    let other_local_branches = refs_containing(repo_path, &hash, "refs/heads", "--format=%(refname:short)")
        .into_iter()
        .filter(|b| Some(b) != branch.as_ref())
        .collect();

    let author_date = crate::run_git(
        repo_path,
        &["log", "-1", "--no-show-signature", "--date=iso-strict", "--format=%ad", hash.as_str()],
    )
    .unwrap_or_default();

    Ok(CommitEditInfo {
        short_hash: hash.chars().take(8).collect(),
        is_head: hash == head,
        is_merge: commit.parents.len() > 1,
        reachable_from_head,
        rewritten_descendants,
        pushed_to,
        other_local_branches,
        current_branch: branch,
        message: commit.message.trim_end().to_string(),
        author_name: commit.author_name,
        author_email: commit.author_email,
        author_date: author_date.trim().to_string(),
        hash,
    })
}

fn commit_tree(
    repo_path: &str,
    commit: &RawCommit,
    parents: &[String],
    message: &str,
    author: (&str, &str, Option<&str>),
    keep_committer: bool,
) -> Result<String, String> {
    let mut cmd = crate::git_command_in_repo(repo_path);
    cmd.args(["commit-tree", commit.tree.as_str()]);
    for p in parents {
        cmd.args(["-p", p.as_str()]);
    }
    cmd.env("GIT_AUTHOR_NAME", author.0);
    cmd.env("GIT_AUTHOR_EMAIL", author.1);
    match author.2 {
        Some(d) => cmd.env("GIT_AUTHOR_DATE", d),
        None => cmd.env_remove("GIT_AUTHOR_DATE"),
    };
    if keep_committer {
        cmd.env("GIT_COMMITTER_NAME", &commit.committer_name);
        cmd.env("GIT_COMMITTER_EMAIL", &commit.committer_email);
        cmd.env("GIT_COMMITTER_DATE", &commit.committer_date);
    }
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn git commit-tree: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(message.as_bytes())
            .map_err(|e| format!("Failed to write commit message: {e}"))?;
    }
    let out = child.wait_with_output().map_err(|e| format!("git commit-tree failed: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "git commit-tree failed: {}",
            String::from_utf8_lossy(&out.stderr).trim_end()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn clean_identity(label: &str, value: Option<String>, original: &str) -> Result<String, String> {
    let v = match value {
        Some(v) if !v.trim().is_empty() => v.trim().to_string(),
        _ => original.to_string(),
    };
    if v.is_empty() {
        return Err(format!("Author {label} is empty."));
    }
    if v.contains(['<', '>', '\n', '\r']) {
        return Err(format!("Author {label} contains invalid characters."));
    }
    Ok(v)
}

/// Rewrites `rev` (and every newer commit on the current branch) with a new message and/or
/// author without touching the index or the working tree: trees are reused as-is, so the
/// operation can never conflict, and the branch ref is only moved once the whole chain exists.
pub(crate) fn edit_commit_impl(
    repo_path: &str,
    rev: &str,
    message: Option<String>,
    author_name: Option<String>,
    author_email: Option<String>,
    reset_author_date: bool,
) -> Result<CommitEditResult, String> {
    crate::ensure_is_git_worktree(repo_path)?;

    if crate::is_rebase_in_progress(repo_path) {
        return Err(String::from("A rebase is in progress. Finish or abort it first."));
    }
    if crate::is_merge_in_progress(repo_path) {
        return Err(String::from("A merge is in progress. Resolve it first."));
    }

    crate::with_repo_git_lock(repo_path, || {
        let target = resolve_commit(repo_path, rev)?;
        let head = resolve_commit(repo_path, "HEAD")?;
        if !is_ancestor(repo_path, &target, &head) {
            return Err(String::from("This commit is not part of the currently checked out history."));
        }

        let orig = read_commits(repo_path, &["-1", target.as_str()])?
            .into_iter()
            .next()
            .ok_or_else(|| String::from("Commit not found."))?;

        let new_message = match message {
            Some(m) => {
                let m = m.replace("\r\n", "\n");
                let m = m.trim_end();
                if m.trim().is_empty() {
                    return Err(String::from("Commit message cannot be empty."));
                }
                format!("{m}\n")
            }
            None => orig.message.clone(),
        };
        let name = clean_identity("name", author_name, &orig.author_name)?;
        let email = clean_identity("email", author_email, &orig.author_email)?;

        if new_message.trim_end() == orig.message.trim_end()
            && name == orig.author_name
            && email == orig.author_email
            && !reset_author_date
        {
            return Err(String::from("Nothing to change."));
        }

        let descendants = if target == head {
            Vec::new()
        } else {
            let range = format!("{target}..{head}");
            read_commits(
                repo_path,
                &["--reverse", "--topo-order", "--ancestry-path", range.as_str()],
            )?
        };

        let mut mapping: HashMap<String, String> = HashMap::new();
        let new_target = commit_tree(
            repo_path,
            &orig,
            &orig.parents,
            &new_message,
            (&name, &email, if reset_author_date { None } else { Some(orig.author_date.as_str()) }),
            false,
        )?;
        mapping.insert(target.clone(), new_target.clone());

        for d in &descendants {
            let parents: Vec<String> = d
                .parents
                .iter()
                .map(|p| mapping.get(p).cloned().unwrap_or_else(|| p.clone()))
                .collect();
            let rewritten = commit_tree(
                repo_path,
                d,
                &parents,
                &d.message,
                (&d.author_name, &d.author_email, Some(d.author_date.as_str())),
                true,
            )?;
            mapping.insert(d.hash.clone(), rewritten);
        }

        let new_head = mapping
            .get(&head)
            .cloned()
            .ok_or_else(|| String::from("Failed to rebuild the commit chain."))?;
        let reflog_msg = format!("graphoria: edit commit {}", &target[..target.len().min(8)]);
        crate::run_git(
            repo_path,
            &["update-ref", "-m", reflog_msg.as_str(), "HEAD", new_head.as_str(), head.as_str()],
        )?;

        Ok(CommitEditResult {
            new_hash: new_target,
            new_head,
            rewritten: mapping.len() as u32,
        })
    })
}

#[tauri::command]
pub(crate) async fn git_commit_edit_info(repo_path: String, hash: String) -> Result<CommitEditInfo, String> {
    crate::repo_read(repo_path.clone(), move || commit_edit_info_impl(&repo_path, &hash)).await
}

#[tauri::command]
pub(crate) async fn git_edit_commit(
    repo_path: String,
    hash: String,
    message: Option<String>,
    author_name: Option<String>,
    author_email: Option<String>,
    reset_author_date: Option<bool>,
) -> Result<CommitEditResult, String> {
    crate::repo_write(repo_path.clone(), move || {
        edit_commit_impl(
            &repo_path,
            &hash,
            message,
            author_name,
            author_email,
            reset_author_date.unwrap_or(false),
        )
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;
    use std::process::Command;
    use tempfile::TempDir;

    fn git(dir: &Path, args: &[&str]) -> String {
        let out = Command::new("git").current_dir(dir).args(args).output().unwrap();
        assert!(
            out.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8_lossy(&out.stdout).trim_end().to_string()
    }

    fn init(dir: &Path) {
        git(dir, &["init", "-q", "-b", "main"]);
        git(dir, &["config", "user.name", "Tester"]);
        git(dir, &["config", "user.email", "tester@example.com"]);
    }

    fn commit(dir: &Path, file: &str, content: &str, msg: &str) -> String {
        fs::write(dir.join(file), content).unwrap();
        git(dir, &["add", "--", file]);
        git(dir, &["commit", "-q", "-m", msg, "--author=Alice <alice@example.com>"]);
        git(dir, &["rev-parse", "HEAD"])
    }

    fn p(dir: &Path) -> String {
        dir.to_string_lossy().to_string()
    }

    #[test]
    fn edits_head_message_and_keeps_tree() {
        let td = TempDir::new().unwrap();
        init(td.path());
        commit(td.path(), "a.txt", "1", "first");
        let head = commit(td.path(), "a.txt", "2", "second");
        let tree = git(td.path(), &["rev-parse", "HEAD^{tree}"]);

        let res = edit_commit_impl(&p(td.path()), &head, Some("renamed\n\nbody".into()), None, None, false).unwrap();

        assert_ne!(res.new_hash, head);
        assert_eq!(git(td.path(), &["rev-parse", "HEAD"]), res.new_head);
        assert_eq!(git(td.path(), &["rev-parse", "HEAD^{tree}"]), tree);
        assert_eq!(git(td.path(), &["log", "-1", "--format=%B"]), "renamed\n\nbody");
        assert_eq!(git(td.path(), &["log", "-1", "--format=%an <%ae>"]), "Alice <alice@example.com>");
        assert_eq!(git(td.path(), &["status", "--porcelain"]), "");
    }

    #[test]
    fn edits_older_commit_and_rewrites_descendants() {
        let td = TempDir::new().unwrap();
        init(td.path());
        commit(td.path(), "a.txt", "1", "first");
        let middle = commit(td.path(), "b.txt", "2", "middle");
        commit(td.path(), "c.txt", "3", "last");
        let tree = git(td.path(), &["rev-parse", "HEAD^{tree}"]);
        let last_date = git(td.path(), &["log", "-1", "--format=%ad", "--date=raw"]);

        fs::write(td.path().join("b.txt"), "dirty").unwrap();
        fs::write(td.path().join("staged.txt"), "s").unwrap();
        git(td.path(), &["add", "staged.txt"]);

        let res = edit_commit_impl(
            &p(td.path()),
            &middle,
            Some("better".into()),
            Some("Bob".into()),
            Some("bob@example.com".into()),
            false,
        )
        .unwrap();

        assert_eq!(res.rewritten, 2);
        assert_eq!(git(td.path(), &["rev-parse", "HEAD^{tree}"]), tree);
        assert_eq!(git(td.path(), &["log", "--format=%s", "-n", "3"]), "last\nbetter\nfirst");
        assert_eq!(git(td.path(), &["log", "-1", "--format=%an", "HEAD~1"]), "Bob");
        assert_eq!(git(td.path(), &["log", "-1", "--format=%ae", "HEAD~1"]), "bob@example.com");
        assert_eq!(git(td.path(), &["log", "-1", "--format=%an"]), "Alice");
        assert_eq!(git(td.path(), &["log", "-1", "--format=%ad", "--date=raw"]), last_date);
        assert_eq!(fs::read_to_string(td.path().join("b.txt")).unwrap(), "dirty");
        assert_eq!(git(td.path(), &["diff", "--cached", "--name-only"]), "staged.txt");
    }

    #[test]
    fn edits_root_commit() {
        let td = TempDir::new().unwrap();
        init(td.path());
        let root = commit(td.path(), "a.txt", "1", "root");
        commit(td.path(), "a.txt", "2", "next");

        edit_commit_impl(&p(td.path()), &root, Some("new root".into()), None, None, false).unwrap();

        assert_eq!(git(td.path(), &["log", "--format=%s", "--reverse"]), "new root\nnext");
        assert_eq!(git(td.path(), &["rev-list", "--max-parents=0", "HEAD", "--count"]), "1");
    }

    #[test]
    fn keeps_merge_structure() {
        let td = TempDir::new().unwrap();
        init(td.path());
        let base = commit(td.path(), "a.txt", "1", "base");
        git(td.path(), &["checkout", "-q", "-b", "side"]);
        let side = commit(td.path(), "side.txt", "s", "side work");
        git(td.path(), &["checkout", "-q", "main"]);
        commit(td.path(), "main.txt", "m", "main work");
        git(td.path(), &["merge", "-q", "--no-ff", "-m", "merge side", "side"]);

        edit_commit_impl(&p(td.path()), &base, Some("base renamed".into()), None, None, false).unwrap();

        assert_eq!(git(td.path(), &["rev-list", "--parents", "-n", "1", "HEAD"]).split_whitespace().count(), 3);
        assert_eq!(git(td.path(), &["log", "--format=%s", "--reverse", "--max-parents=0"]), "base renamed");
        assert_eq!(git(td.path(), &["log", "-1", "--format=%s", "HEAD^2"]), "side work");
        assert_eq!(git(td.path(), &["rev-parse", "HEAD^2~1"]), git(td.path(), &["rev-parse", "HEAD^1~1"]));
        assert_ne!(git(td.path(), &["rev-parse", "HEAD^2"]), side);
        assert_eq!(git(td.path(), &["rev-parse", "side"]), side);
    }

    #[test]
    fn rejects_noop_empty_and_foreign_commits() {
        let td = TempDir::new().unwrap();
        init(td.path());
        let first = commit(td.path(), "a.txt", "1", "first");
        git(td.path(), &["checkout", "-q", "-b", "other"]);
        let other = commit(td.path(), "b.txt", "2", "other");
        git(td.path(), &["checkout", "-q", "main"]);

        let repo = p(td.path());
        assert!(edit_commit_impl(&repo, &first, Some("first".into()), None, None, false).is_err());
        assert!(edit_commit_impl(&repo, &first, Some("  ".into()), None, None, false).is_err());
        assert!(edit_commit_impl(&repo, &first, None, Some("a<b".into()), None, false).is_err());
        assert!(edit_commit_impl(&repo, &other, Some("x".into()), None, None, false).is_err());
    }

    #[test]
    fn info_reports_pushed_and_other_branches() {
        let td = TempDir::new().unwrap();
        let remote = td.path().join("remote.git");
        fs::create_dir_all(&remote).unwrap();
        git(&remote, &["init", "-q", "--bare"]);

        let work = td.path().join("work");
        fs::create_dir_all(&work).unwrap();
        init(&work);
        let first = commit(&work, "a.txt", "1", "first");
        git(&work, &["remote", "add", "origin", remote.to_str().unwrap()]);
        git(&work, &["push", "-q", "origin", "main"]);
        git(&work, &["branch", "keep", "main"]);
        let second = commit(&work, "a.txt", "2", "second");

        let repo = p(&work);
        let info = commit_edit_info_impl(&repo, &first).unwrap();
        assert_eq!(info.pushed_to, vec!["origin/main".to_string()]);
        assert_eq!(info.other_local_branches, vec!["keep".to_string()]);
        assert_eq!(info.rewritten_descendants, 1);
        assert!(!info.is_head);
        assert!(info.reachable_from_head);
        assert_eq!(info.message, "first");

        let info = commit_edit_info_impl(&repo, &second).unwrap();
        assert!(info.pushed_to.is_empty());
        assert!(info.is_head);
        assert_eq!(info.current_branch.as_deref(), Some("main"));
    }
}
