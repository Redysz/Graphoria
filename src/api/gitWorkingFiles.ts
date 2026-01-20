import { invoke } from "@tauri-apps/api/core";

export function gitLaunchExternalDiffWorking(params: {
  repoPath: string;
  path: string;
  toolPath: string;
  command: string;
}) {
  return invoke<void>("git_launch_external_diff_working", params);
}

export function gitWorkingFileImageBase64(params: { repoPath: string; path: string }) {
  return invoke<string>("git_working_file_image_base64", params);
}

export function gitHeadVsWorkingTextDiff(params: { repoPath: string; path: string; unified: number }) {
  return invoke<string>("git_head_vs_working_text_diff", params);
}

export function gitWorkingFileTextPreview(params: { repoPath: string; path: string }) {
  return invoke<string>("git_working_file_text_preview", params);
}

export function gitWorkingFileDiff(params: { repoPath: string; path: string }) {
  return invoke<string>("git_working_file_diff", params);
}

export function gitWorkingFileDiffUnified(params: { repoPath: string; path: string; unified: number }) {
  return invoke<string>("git_working_file_diff_unified", params);
}

export function gitWorkingFileContent(params: { repoPath: string; path: string }) {
  return invoke<string>("git_working_file_content", params);
}

export function gitHeadFileContent(params: { repoPath: string; path: string }) {
  return invoke<string>("git_head_file_content", params);
}
