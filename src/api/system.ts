import { invoke } from "@tauri-apps/api/core";
import type { TerminalProfileKind } from "../appSettingsStore";

export function getCurrentUsername() {
  return invoke<string>("get_current_username");
}

export function openTerminalProfile(params: { repoPath: string; kind: TerminalProfileKind; command?: string; args?: string[] }) {
  return invoke<void>("open_terminal_profile", params);
}

export function openInFileExplorer(path: string) {
  return invoke<void>("open_in_file_explorer", { path });
}

export function revealInFileExplorer(path: string) {
  return invoke<void>("reveal_in_file_explorer", { path });
}

export function readTextFile(path: string) {
  return invoke<string>("read_text_file", { path });
}

export function writeTextFile(path: string, content: string) {
  return invoke<void>("write_text_file", { path, content });
}

export function getOpenOnStartup() {
  return invoke<boolean>("get_open_on_startup");
}

export function setOpenOnStartup(enabled: boolean) {
  return invoke<void>("set_open_on_startup", { enabled });
}
