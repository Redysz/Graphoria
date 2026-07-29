use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[derive(Debug, Clone, Serialize)]
pub(crate) struct CredentialHostInfo {
    host: String,
    username: String,
    scope: String,
}

fn normalize_repo_path(p: &str) -> String {
    p.trim().replace('\\', "/").trim_end_matches('/').to_string()
}

fn new_command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn run_git(repo_path: &str, args: &[&str]) -> Result<String, String> {
    let out = new_command("git")
        .arg("-c")
        .arg("core.quotepath=false")
        .args(["-C", repo_path])
        .args(args)
        .output()
        .map_err(|e| format!("Failed to spawn git: {e}"))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(format!("git command failed: {stderr}"));
    }

    Ok(String::from_utf8_lossy(&out.stdout).trim_end().to_string())
}

fn run_git_with_stdin(repo_path: &str, args: &[&str], stdin_data: &str) -> Result<String, String> {
    let mut child = new_command("git")
        .arg("-c")
        .arg("core.quotepath=false")
        .args(["-C", repo_path])
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn git: {e}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(stdin_data.as_bytes())
            .map_err(|e| format!("Failed to write to git stdin: {e}"))?;
    }

    let out = child.wait_with_output().map_err(|e| format!("Failed to wait for git: {e}"))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(format!("git command failed: {stderr}"));
    }

    Ok(String::from_utf8_lossy(&out.stdout).trim_end().to_string())
}

fn app_data_dir() -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").map_err(|_| String::from("APPDATA not set"))?;
        Ok(PathBuf::from(appdata).join("Graphoria"))
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").map_err(|_| String::from("HOME not set"))?;
        Ok(PathBuf::from(home).join("Library").join("Application Support").join("com.graphoria.desktop"))
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let home = std::env::var("HOME").map_err(|_| String::from("HOME not set"))?;
        Ok(PathBuf::from(home).join(".local").join("share").join("graphoria"))
    }
}

fn sanitize_filename(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '_' })
        .collect()
}

fn store_file_path(repo_path: &str, host: &str, scope: &str) -> Result<PathBuf, String> {
    let scope = scope.trim().to_lowercase();
    match scope.as_str() {
        "repo" => {
            let p = Path::new(repo_path).join(".git").join("graphoria-credentials");
            Ok(p)
        }
        "host" => {
            let dir = app_data_dir()?.join("credentials");
            let host_file = sanitize_filename(host);
            Ok(dir.join(format!("{host_file}.credentials")))
        }
        "global" => {
            let dir = app_data_dir()?.join("credentials");
            Ok(dir.join("global.credentials"))
        }
        "session" => {
            // Ephemeral store used for the "do not remember" option: never written to git config
            // and wiped on every app start (see clear_session_credentials).
            let dir = app_data_dir()?.join("credentials").join("session");
            let host_file = sanitize_filename(host);
            Ok(dir.join(format!("{host_file}.credentials")))
        }
        _ => Err(String::from("Invalid scope. Expected repo, host, global or session.")),
    }
}

/// Removes all ephemeral "session" credential stores. Called on app start so tokens saved with the
/// "do not remember" option never survive a restart.
pub(crate) fn clear_session_credentials() {
    if let Ok(dir) = app_data_dir() {
        let _ = fs::remove_dir_all(dir.join("credentials").join("session"));
    }
}

fn store_config_key(scope: &str, host: &str) -> (String, String) {
    let scope = scope.trim().to_lowercase();
    match scope.as_str() {
        "repo" => (String::from("credential.helper"), String::from("--local")),
        "global" => (String::from("credential.helper"), String::from("--global")),
        _ => (format!("credential.https://{host}.helper"), String::from("--global")),
    }
}

fn store_helper_value(store_path: &Path) -> Result<String, String> {
    let path_str = store_path.to_str().ok_or_else(|| String::from("Invalid credential store path"))?;
    let path_unix = path_str.replace('\\', "/");
    Ok(format!("store --file={path_unix}"))
}

/// Matches credential helper entries that Graphoria created (its store files always live under a
/// path containing "graphoria"). Used to clean up our own entries idempotently without touching
/// other helpers the user may rely on (e.g. Git Credential Manager).
const OUR_STORE_HELPER_RE: &str = "^store --file=.*[Gg]raphoria";

/// Adds our credential-store helper to the given git config key so that command-line git uses the
/// stored token. A leading empty value is added first to reset any helpers configured earlier
/// (such as Git Credential Manager, which is what triggers the Atlassian sign-in popup), so that
/// our store takes over instead of prompting. Idempotent: previous Graphoria entries are removed
/// first, and any other helpers are preserved.
fn set_graphoria_helper(repo_path: &str, scope_flag: &str, key: &str, helper: &str) {
    let _ = run_git(repo_path, &["config", scope_flag, "--unset-all", key, OUR_STORE_HELPER_RE]);
    let _ = run_git(repo_path, &["config", scope_flag, "--unset-all", key, "^$"]);
    let _ = run_git(repo_path, &["config", scope_flag, "--add", key, ""]);
    let _ = run_git(repo_path, &["config", scope_flag, "--add", key, helper]);
}

/// Removes the credential-store helper (and the empty reset entry) that Graphoria added for the
/// given git config key, leaving any other helpers intact.
fn unset_graphoria_helper(repo_path: &str, scope_flag: &str, key: &str) {
    let _ = run_git(repo_path, &["config", scope_flag, "--unset-all", key, OUR_STORE_HELPER_RE]);
    let _ = run_git(repo_path, &["config", scope_flag, "--unset-all", key, "^$"]);
}

fn ensure_parent_dir(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create credentials directory: {e}"))?;
    }
    Ok(())
}

fn remote_origin_host(repo_path: &str) -> Result<Option<String>, String> {
    let raw = match run_git(repo_path, &["remote", "get-url", "origin"]) {
        Ok(s) if !s.trim().is_empty() => s,
        _ => return Ok(None),
    };
    Ok(extract_host_from_url(raw.trim()))
}

fn extract_host_from_url(url: &str) -> Option<String> {
    let url = url.trim();
    if url.is_empty() {
        return None;
    }

    if let Some(rest) = url.strip_prefix("https://") {
        return Some(extract_authority_host(rest)?);
    }
    if let Some(rest) = url.strip_prefix("http://") {
        return Some(extract_authority_host(rest)?);
    }
    if url.contains('@') && url.contains(':') {
        // ssh: git@host:path or user@host:path
        let at = url.find('@')?;
        let colon = url[at + 1..].find(':')?;
        return Some(url[at + 1..at + 1 + colon].to_string());
    }
    None
}

fn extract_authority_host(rest: &str) -> Option<String> {
    let end = rest.find(&['/', ':'][..]).unwrap_or(rest.len());
    let authority = &rest[..end];
    // Drop optional user:pass@ prefix; take only the host.
    let host = authority.rsplit('@').next()?;
    if host.is_empty() { return None; }
    Some(host.to_string())
}

fn extract_username_from_url(url: &str) -> Option<String> {
    let url = url.trim();
    let rest = url.strip_prefix("https://").or(url.strip_prefix("http://"))?;
    let end = rest.find(&['/', ':'][..]).unwrap_or(rest.len());
    let authority = &rest[..end];
    if let Some((user, _)) = authority.rsplit_once('@') {
        if user.is_empty() { return None; }
        // userinfo may be "user" or "user:password".
        let user = user.rsplit(':').next().unwrap_or(user);
        if user.is_empty() { return None; }
        return Some(user.to_string());
    }
    None
}

#[tauri::command]
pub(crate) fn git_get_remote_host(repo_path: String) -> Result<String, String> {
    let repo_path = normalize_repo_path(&repo_path);
    match remote_origin_host(&repo_path)? {
        Some(h) => Ok(h),
        None => Err(String::from("Could not determine remote host from origin URL.")),
    }
}

#[tauri::command]
pub(crate) fn git_store_credential(
    repo_path: String,
    username: String,
    password: String,
    scope: String,
    apply_to_git: bool,
) -> Result<(), String> {
    let repo_path = normalize_repo_path(&repo_path);
    let mut username = username.trim().to_string();
    let password = password.trim().to_string();
    let scope = scope.trim().to_lowercase();

    let url = match run_git(&repo_path, &["remote", "get-url", "origin"]) {
        Ok(s) if !s.trim().is_empty() => s.trim().to_string(),
        _ => return Err(String::from("Could not read remote origin URL.")),
    };

    if username.is_empty() {
        if let Some(u) = extract_username_from_url(&url) {
            username = u;
        }
    }

    if username.is_empty() {
        return Err(String::from("Username is empty."));
    }
    if password.is_empty() {
        return Err(String::from("Password/token is empty."));
    }
    if scope != "repo" && scope != "host" && scope != "global" && scope != "session" {
        return Err(String::from("Invalid scope. Expected repo, host, global or session."));
    }

    let host = match extract_host_from_url(&url) {
        Some(h) => h,
        None => return Err(String::from("Could not determine remote host from origin URL.")),
    };

    let store_path = store_file_path(&repo_path, &host, &scope)?;
    ensure_parent_dir(&store_path)?;

    let helper = store_helper_value(&store_path)?;

    // Set the credential helper in git config only when the user wants command-line git to use it too.
    // Never write config for the ephemeral "session" store.
    if apply_to_git && scope != "session" {
        // Scope-specific config: repo-local, per-host (global) or the generic global helper.
        let (config_key, config_scope) = store_config_key(&scope, &host);
        set_graphoria_helper(&repo_path, config_scope.as_str(), config_key.as_str(), &helper);

        // Always set a repo-local credential.helper as well so that a terminal opened inside this
        // repository uses our store first, regardless of global helpers like Git Credential Manager.
        set_graphoria_helper(&repo_path, "--local", "credential.helper", &helper);
    }

    // Write the credential into Graphoria's own store file for the chosen scope. The explicit
    // helpers (empty reset + our store) make sure the token is written to our file only, regardless
    // of whatever helper git is otherwise configured to use.
    let helper_arg = format!("credential.helper={helper}");

    // First erase any credential we previously stored for this host. `git credential-store` returns
    // the *first* matching line for a host, so a stale/incorrect entry (e.g. a wrong username) would
    // keep being sent even after the user re-enters the correct one. Erasing by host only clears our
    // own store file (thanks to the explicit helpers) without touching other helpers like GCM.
    let reject_stdin = format!("protocol=https\nhost={host}\n");
    let _ = run_git_with_stdin(
        &repo_path,
        &["-c", "credential.helper=", "-c", helper_arg.as_str(), "credential", "reject"],
        &reject_stdin,
    );

    let stdin = format!("protocol=https\nhost={host}\nusername={username}\npassword={password}\n");
    run_git_with_stdin(
        &repo_path,
        &["-c", "credential.helper=", "-c", helper_arg.as_str(), "credential", "approve"],
        &stdin,
    )?;

    Ok(())
}

/// Returns `-c credential.helper=...` arguments for every Graphoria credential store that exists
/// for this repository, ordered from most specific (repo) to least specific (global).
/// This lets Graphoria use the stored credentials without having to write to git's config.
pub(crate) fn graphoria_credential_helper_args(repo_path: &str) -> Vec<String> {
    let repo_path = normalize_repo_path(repo_path);
    let host = remote_origin_host(&repo_path).ok().flatten();

    let mut out = Vec::new();

    // Ephemeral "session" store first: it holds tokens the user chose not to remember, and must
    // take precedence for the current app session.
    if let Some(h) = host.as_ref() {
        if let Ok(path) = store_file_path(&repo_path, h, "session") {
            if path.exists() {
                if let Ok(helper) = store_helper_value(&path) {
                    out.push(format!("credential.helper={helper}"));
                }
            }
        }
    }

    if let Ok(path) = store_file_path(&repo_path, "", "repo") {
        if path.exists() {
            if let Ok(helper) = store_helper_value(&path) {
                out.push(format!("credential.helper={helper}"));
            }
        }
    }

    if let Some(h) = host.as_ref() {
        if let Ok(path) = store_file_path(&repo_path, h, "host") {
            if path.exists() {
                if let Ok(helper) = store_helper_value(&path) {
                    out.push(format!("credential.helper={helper}"));
                }
            }
        }
    }

    if let Ok(path) = store_file_path(&repo_path, host.as_deref().unwrap_or(""), "global") {
        if path.exists() {
            if let Ok(helper) = store_helper_value(&path) {
                out.push(format!("credential.helper={helper}"));
            }
        }
    }

    out
}

#[tauri::command]
pub(crate) fn git_remove_credential(repo_path: String, scope: String) -> Result<(), String> {
    let repo_path = normalize_repo_path(&repo_path);
    let scope = scope.trim().to_lowercase();
    if scope != "repo" && scope != "host" && scope != "global" {
        return Err(String::from("Invalid scope. Expected repo, host or global."));
    }

    let host = match remote_origin_host(&repo_path) {
        Ok(Some(h)) => h,
        _ => String::new(),
    };

    let store_path = match store_file_path(&repo_path, &host, &scope) {
        Ok(p) => p,
        Err(_) => return Ok(()),
    };
    if store_path.exists() {
        let _ = fs::remove_file(&store_path);
    }

    // Remove only the entries Graphoria added, both from the scope-specific key and from the
    // repo-local helper, leaving any other helpers (e.g. Git Credential Manager) untouched.
    let (config_key, config_scope) = store_config_key(&scope, &host);
    unset_graphoria_helper(&repo_path, config_scope.as_str(), config_key.as_str());
    unset_graphoria_helper(&repo_path, "--local", "credential.helper");

    Ok(())
}

#[tauri::command]
pub(crate) fn git_has_credential(repo_path: String) -> Result<bool, String> {
    let repo_path = normalize_repo_path(&repo_path);
    let host = match remote_origin_host(&repo_path)? {
        Some(h) => h,
        None => return Ok(false),
    };

    for scope in ["repo", "host", "global"] {
        if let Ok(path) = store_file_path(&repo_path, &host, scope) {
            if path.exists() {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

#[tauri::command]
pub(crate) fn git_list_credential_scopes(repo_path: String) -> Result<Vec<String>, String> {
    let repo_path = normalize_repo_path(&repo_path);
    let host = match remote_origin_host(&repo_path)? {
        Some(h) => h,
        None => String::new(),
    };

    let mut out = Vec::new();
    for scope in ["repo", "host", "global"] {
        if let Ok(path) = store_file_path(&repo_path, &host, scope) {
            if path.exists() {
                out.push(scope.to_string());
            }
        }
    }
    Ok(out)
}

#[tauri::command]
pub(crate) fn git_list_credential_hosts(_repo_path: String) -> Result<Vec<CredentialHostInfo>, String> {
    let mut out = Vec::new();
    let base = match app_data_dir() {
        Ok(d) => d.join("credentials"),
        Err(_) => return Ok(out),
    };

    if let Ok(entries) = fs::read_dir(&base) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(ext) = path.extension() {
                if ext == "credentials" {
                    let name = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
                    if name != "global" {
                        out.push(CredentialHostInfo {
                            host: name.replace('_', "."),
                            username: String::new(),
                            scope: String::from("host"),
                        });
                    }
                }
            }
        }
    }

    Ok(out)
}

/// Extracts the username from a `git credential-store` line (`https://user:token@host`).
fn username_from_store_line(line: &str, host: &str) -> Option<String> {
    let rest = line
        .trim()
        .strip_prefix("https://")
        .or_else(|| line.trim().strip_prefix("http://"))?;
    let at = rest.rfind('@')?;
    let (userinfo, hostpart) = (&rest[..at], &rest[at + 1..]);
    if !host.is_empty() && !hostpart.starts_with(host) {
        return None;
    }
    let user = userinfo.split(':').next().unwrap_or(userinfo);
    if user.is_empty() {
        return None;
    }
    Some(user.to_string())
}

/// Reads the username Graphoria previously stored for `host` from any of its own store files.
fn stored_username_for_host(repo_path: &str, host: &str) -> Option<String> {
    for scope in ["session", "repo", "host", "global"] {
        if let Ok(path) = store_file_path(repo_path, host, scope) {
            if let Ok(content) = fs::read_to_string(&path) {
                for line in content.lines() {
                    if let Some(u) = username_from_store_line(line, host) {
                        return Some(u);
                    }
                }
            }
        }
    }
    None
}

/// Best-effort suggestion for the username field, mirroring what Git Credential Manager pre-fills.
/// Tries, in order: the remote URL userinfo, Graphoria's own stored credentials, git's
/// `credential.*.username` config, and finally `user.name` (only when it has no whitespace, so a
/// full display name like "Jan Kowalski" is never suggested as a login). Returns "" when unknown.
#[tauri::command]
pub(crate) fn git_get_suggested_username(repo_path: String) -> Result<String, String> {
    let repo_path = normalize_repo_path(&repo_path);
    let url = run_git(&repo_path, &["remote", "get-url", "origin"]).unwrap_or_default();
    let url = url.trim();

    if let Some(u) = extract_username_from_url(url) {
        return Ok(u);
    }

    let host = extract_host_from_url(url).unwrap_or_default();
    if !host.is_empty() {
        if let Some(u) = stored_username_for_host(&repo_path, &host) {
            return Ok(u);
        }
        let key = format!("credential.https://{host}.username");
        if let Ok(u) = run_git(&repo_path, &["config", "--get", &key]) {
            if !u.trim().is_empty() {
                return Ok(u.trim().to_string());
            }
        }
    }

    if let Ok(u) = run_git(&repo_path, &["config", "--get", "credential.username"]) {
        if !u.trim().is_empty() {
            return Ok(u.trim().to_string());
        }
    }

    if let Ok(u) = run_git(&repo_path, &["config", "--get", "user.name"]) {
        let u = u.trim();
        if !u.is_empty() && !u.chars().any(char::is_whitespace) {
            return Ok(u.to_string());
        }
    }

    Ok(String::new())
}

/// Finds the user's real credential helper (e.g. Git Credential Manager) by scanning the merged git
/// config and skipping empty resets and Graphoria's own store helpers. Falls back to "manager".
fn detect_default_helper(repo_path: &str) -> String {
    if let Ok(all) = run_git(repo_path, &["config", "--get-all", "credential.helper"]) {
        for line in all.lines() {
            let v = line.trim();
            if v.is_empty() || v.starts_with("store --file=") {
                continue;
            }
            return v.to_string();
        }
    }
    String::from("manager")
}

/// Fallback that forces the host's *default* credential UI (e.g. the Atlassian sign-in window) to
/// appear, for cases where Graphoria's own dialog cannot handle a new authentication scheme. It
/// resets the helper list and runs only the detected default helper, with interactive prompts
/// allowed (unlike Graphoria's normal git invocations). The default helper caches the result, so a
/// subsequent fetch/pull/push succeeds without prompting again.
#[tauri::command]
pub(crate) fn git_open_default_login(repo_path: String, username: Option<String>) -> Result<(), String> {
    let repo_path = normalize_repo_path(&repo_path);
    let url = run_git(&repo_path, &["remote", "get-url", "origin"]).unwrap_or_default();
    let host = match extract_host_from_url(url.trim()) {
        Some(h) => h,
        None => return Err(String::from("Could not determine remote host from origin URL.")),
    };

    let helper = detect_default_helper(&repo_path);
    let helper_arg = format!("credential.helper={helper}");

    let mut stdin = format!("protocol=https\nhost={host}\n");
    if let Some(u) = username.as_ref() {
        let u = u.trim();
        if !u.is_empty() {
            stdin.push_str(&format!("username={u}\n"));
        }
    }
    stdin.push('\n');

    let mut cmd = new_command("git");
    cmd.args(["-C", repo_path.as_str()])
        .args(["-c", "credential.helper="])
        .args(["-c", helper_arg.as_str()])
        .args(["credential", "fill"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn git: {e}"))?;
    if let Some(mut si) = child.stdin.take() {
        si.write_all(stdin.as_bytes()).map_err(|e| format!("Failed to write to git stdin: {e}"))?;
    }

    let out = child.wait_with_output().map_err(|e| format!("Failed to wait for git: {e}"))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(format!("Default login was cancelled or failed: {stderr}"));
    }

    Ok(())
}
