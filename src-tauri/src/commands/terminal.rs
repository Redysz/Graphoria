use std::path::Path;
use std::process::Command;

#[tauri::command]
pub(crate) fn open_terminal_profile(repo_path: String, kind: String, command: String, args: Vec<String>) -> Result<(), String> {
    let repo_path = repo_path.trim().to_string();
    if repo_path.is_empty() {
        return Err(String::from("repo_path is empty"));
    }

    let kind = kind.trim().to_lowercase();
    match kind.as_str() {
        "builtin_default" => open_terminal(repo_path),

        "builtin_git_bash" => {
            #[cfg(target_os = "windows")]
            {
                let candidates: Vec<String> = vec![
                    std::env::var("ProgramFiles").ok().map(|p| format!("{p}\\Git\\git-bash.exe")),
                    std::env::var("ProgramFiles(x86)").ok().map(|p| format!("{p}\\Git\\git-bash.exe")),
                    std::env::var("LocalAppData").ok().map(|p| format!("{p}\\Programs\\Git\\git-bash.exe")),
                ]
                .into_iter()
                .flatten()
                .collect();

                for p in candidates {
                    if Path::new(p.as_str()).exists() {
                        Command::new("cmd")
                            .current_dir(&repo_path)
                            .args(["/C", "start", "", p.as_str()])
                            .spawn()
                            .map_err(|e| format!("Failed to open Git Bash: {e}"))?;
                        return Ok(());
                    }
                }

                if Command::new("cmd")
                    .current_dir(&repo_path)
                    .args(["/C", "start", "", "bash", "--login", "-i"])
                    .spawn()
                    .is_ok()
                {
                    return Ok(());
                }

                return Err(String::from("Git Bash not found."));
            }

            #[cfg(not(target_os = "windows"))]
            {
                return Err(String::from("Git Bash profile is Windows-only."));
            }
        }

        "builtin_cmd" => {
            #[cfg(target_os = "windows")]
            {
                Command::new("cmd")
                    .current_dir(&repo_path)
                    .args(["/C", "start", "", "cmd"])
                    .spawn()
                    .map_err(|e| format!("Failed to open Command Prompt: {e}"))?;
                return Ok(());
            }
            #[cfg(not(target_os = "windows"))]
            {
                return Err(String::from("Command Prompt profile is Windows-only."));
            }
        }

        "builtin_powershell" => {
            #[cfg(target_os = "windows")]
            {
                Command::new("cmd")
                    .current_dir(&repo_path)
                    .args(["/C", "start", "", "powershell"])
                    .spawn()
                    .map_err(|e| format!("Failed to open PowerShell: {e}"))?;
                return Ok(());
            }
            #[cfg(not(target_os = "windows"))]
            {
                return Err(String::from("PowerShell profile is Windows-only."));
            }
        }

        "custom" => {
            let cmd = command.trim().to_string();
            if cmd.is_empty() {
                return Err(String::from("Custom terminal command is empty."));
            }

            #[cfg(target_os = "windows")]
            {
                let mut argv: Vec<String> = vec![String::from("/C"), String::from("start"), String::from(""), cmd];
                argv.extend(args);
                Command::new("cmd")
                    .current_dir(&repo_path)
                    .args(argv)
                    .spawn()
                    .map_err(|e| format!("Failed to open custom terminal: {e}"))?;
                return Ok(());
            }

            #[cfg(not(target_os = "windows"))]
            {
                Command::new(cmd)
                    .current_dir(&repo_path)
                    .args(args)
                    .spawn()
                    .map_err(|e| format!("Failed to open custom terminal: {e}"))?;
                return Ok(());
            }
        }

        _ => Err(format!("Unknown terminal profile kind: {kind}")),
    }
}

#[tauri::command]
pub(crate) fn open_terminal(repo_path: String) -> Result<(), String> {
    let repo_path = repo_path.trim().to_string();
    if repo_path.is_empty() {
        return Err(String::from("repo_path is empty"));
    }

    #[cfg(target_os = "windows")]
    {
        let candidates: Vec<String> = vec![
            std::env::var("ProgramFiles").ok().map(|p| format!("{p}\\Git\\git-bash.exe")),
            std::env::var("ProgramFiles(x86)").ok().map(|p| format!("{p}\\Git\\git-bash.exe")),
            std::env::var("LocalAppData").ok().map(|p| format!("{p}\\Programs\\Git\\git-bash.exe")),
        ]
        .into_iter()
        .flatten()
        .collect();

        for p in candidates {
            if Path::new(p.as_str()).exists() {
                Command::new("cmd")
                    .current_dir(&repo_path)
                    .args(["/C", "start", "", p.as_str()])
                    .spawn()
                    .map_err(|e| format!("Failed to open Git Bash: {e}"))?;
                return Ok(());
            }
        }

        if Command::new("cmd")
            .current_dir(&repo_path)
            .args(["/C", "start", "", "bash", "--login", "-i"])
            .spawn()
            .is_ok()
        {
            return Ok(());
        }

        Command::new("cmd")
            .current_dir(&repo_path)
            .args(["/C", "start", "", "powershell"])
            .spawn()
            .map_err(|e| format!("Failed to open terminal: {e}"))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-a", "Terminal", repo_path.as_str()])
            .spawn()
            .map_err(|e| format!("Failed to open Terminal: {e}"))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let attempts: Vec<(&str, Vec<&str>)> = vec![
            ("x-terminal-emulator", vec![]),
            ("gnome-terminal", vec!["--working-directory", repo_path.as_str()]),
            ("konsole", vec!["--workdir", repo_path.as_str()]),
            ("xterm", vec!["-e", "bash", "-lc", "pwd; exec bash"]),
        ];

        for (bin, args) in attempts {
            let mut cmd = Command::new(bin);
            if bin == "x-terminal-emulator" {
                cmd.current_dir(&repo_path);
            }
            cmd.args(args);
            if cmd.spawn().is_ok() {
                return Ok(());
            }
        }
        return Err(String::from("Could not open a terminal emulator."));
    }
}
