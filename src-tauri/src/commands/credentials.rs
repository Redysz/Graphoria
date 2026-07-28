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
        _ => Err(String::from("Invalid scope. Expected repo, host or global.")),
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
    if scope != "repo" && scope != "host" && scope != "global" {
        return Err(String::from("Invalid scope. Expected repo, host or global."));
    }

    let host = match extract_host_from_url(&url) {
        Some(h) => h,
        None => return Err(String::from("Could not determine remote host from origin URL.")),
    };

    let store_path = store_file_path(&repo_path, &host, &scope)?;
    ensure_parent_dir(&store_path)?;

    // Set the credential helper so git credential approve writes to our store.
    let (config_key, config_scope) = store_config_key(&scope, &host);
    let helper = store_helper_value(&store_path)?;

    let _ = run_git(&repo_path, &["config", config_scope.as_str(), "--replace-all", config_key.as_str(), helper.as_str()]);

    // Approve the credential in the chosen store.
    let stdin = format!("protocol=https\nhost={host}\nusername={username}\npassword={password}\n");
    run_git_with_stdin(&repo_path, &["credential", "approve"], &stdin)?;

    Ok(())
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

    let (config_key, config_scope) = store_config_key(&scope, &host);
    if scope == "global" {
        // For global scope we only remove the helper value if it points to our file.
        // Do not blindly --unset-all because the user may have other credential helpers.
        let _ = run_git(&repo_path, &["config", config_scope.as_str(), "--unset", config_key.as_str()]);
    } else {
        let _ = run_git(&repo_path, &["config", config_scope.as_str(), "--unset-all", config_key.as_str()]);
    }

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
