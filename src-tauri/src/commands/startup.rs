#[tauri::command]
pub(crate) fn get_open_on_startup() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        const RUN_KEY: &str = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
        const VALUE_NAME: &str = "Graphoria";

        let out = crate::new_command("reg")
            .args(["query", RUN_KEY, "/v", VALUE_NAME])
            .output()
            .map_err(|e| format!("Failed to run reg query: {e}"))?;

        if !out.status.success() {
            return Ok(false);
        }

        let stdout = String::from_utf8_lossy(&out.stdout);
        Ok(stdout.to_lowercase().contains(&VALUE_NAME.to_lowercase()))
    }

    #[cfg(target_os = "macos")]
    {
        Ok(launch_agent_plist_path()?.exists())
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Ok(false)
    }
}

#[tauri::command]
pub(crate) fn set_open_on_startup(enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        const RUN_KEY: &str = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
        const VALUE_NAME: &str = "Graphoria";

        if enabled {
            let exe = std::env::current_exe().map_err(|e| format!("Failed to get current exe path: {e}"))?;
            let exe_str = exe
                .to_str()
                .ok_or_else(|| String::from("Failed to convert exe path to string"))?;
            let value = format!("\"{}\"", exe_str);

            let out = crate::new_command("reg")
                .args(["add", RUN_KEY, "/v", VALUE_NAME, "/t", "REG_SZ", "/d", value.as_str(), "/f"])
                .output()
                .map_err(|e| format!("Failed to run reg add: {e}"))?;

            if !out.status.success() {
                let stderr = String::from_utf8_lossy(&out.stderr).trim_end().to_string();
                let stdout = String::from_utf8_lossy(&out.stdout).trim_end().to_string();
                let msg = if !stderr.is_empty() { stderr } else { stdout };
                if !msg.is_empty() {
                    return Err(format!("Failed to enable startup: {msg}"));
                }
                return Err(String::from("Failed to enable startup."));
            }

            return Ok(());
        }

        let out = crate::new_command("reg")
            .args(["delete", RUN_KEY, "/v", VALUE_NAME, "/f"])
            .output()
            .map_err(|e| format!("Failed to run reg delete: {e}"))?;

        if !out.status.success() {
            return Ok(());
        }

        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        use std::fs;
        use std::process::Command;

        let plist_path = launch_agent_plist_path()?;
        let label = "com.graphoria.app";

        if enabled {
            if let Some(parent) = plist_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create LaunchAgents directory: {e}"))?;
            }

            let exe = std::env::current_exe().map_err(|e| format!("Failed to get current exe path: {e}"))?;
            let exe_str = exe
                .to_str()
                .ok_or_else(|| String::from("Failed to convert exe path to string"))?;

            let plist = format!(
                r#"<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">
<plist version=\"1.0\">
<dict>
  <key>Label</key>
  <string>{label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{exe_str}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
"#
            );

            fs::write(&plist_path, plist).map_err(|e| format!("Failed to write LaunchAgent plist: {e}"))?;

            let uid = current_uid_str()?;
            let domain = format!("gui/{uid}");

            let _ = Command::new("launchctl")
                .args(["bootout", domain.as_str(), plist_path.to_str().unwrap_or_default()])
                .output();

            let out = Command::new("launchctl")
                .args(["bootstrap", domain.as_str(), plist_path.to_str().unwrap_or_default()])
                .output()
                .map_err(|e| format!("Failed to run launchctl bootstrap: {e}"))?;

            if !out.status.success() {
                let stderr = String::from_utf8_lossy(&out.stderr).trim_end().to_string();
                let stdout = String::from_utf8_lossy(&out.stdout).trim_end().to_string();
                let msg = if !stderr.is_empty() { stderr } else { stdout };
                if !msg.is_empty() {
                    return Err(format!("launchctl bootstrap failed: {msg}"));
                }
                return Err(String::from("launchctl bootstrap failed"));
            }

            return Ok(());
        }

        if plist_path.exists() {
            let uid = current_uid_str()?;
            let domain = format!("gui/{uid}");
            let _ = Command::new("launchctl")
                .args(["bootout", domain.as_str(), plist_path.to_str().unwrap_or_default()])
                .output();
            let _ = fs::remove_file(&plist_path);
        }

        Ok(())
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = enabled;
        Err(String::from("Open on startup is not supported on this platform."))
    }
}

#[cfg(target_os = "macos")]
fn launch_agent_plist_path() -> Result<std::path::PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| String::from("HOME is not set"))?;
    Ok(std::path::PathBuf::from(home)
        .join("Library")
        .join("LaunchAgents")
        .join("com.graphoria.app.plist"))
}

#[cfg(target_os = "macos")]
fn current_uid_str() -> Result<String, String> {
    use std::process::Command;

    let out = Command::new("id")
        .args(["-u"])
        .output()
        .map_err(|e| format!("Failed to run id -u: {e}"))?;

    if !out.status.success() {
        return Err(String::from("Failed to determine current user id."));
    }

    let uid = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if uid.is_empty() {
        return Err(String::from("Failed to determine current user id."));
    }

    Ok(uid)
}
