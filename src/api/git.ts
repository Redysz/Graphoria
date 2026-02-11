import { invoke } from "@tauri-apps/api/core";
import type {
  GitAheadBehind,
  GitBranchInfo,
  GitCommit,
  GitCommitSummary,
  GitContinueInfo,
  GitConflictFileVersions,
  GitConflictState,
  GitPatchPredictResult,
  GitPatchPredictGraphResult,
  GitStatusEntry,
  GitStatusSummary,
  GitStashEntry,
  GitTagTarget,
  InteractiveRebaseCommitInfo,
  InteractiveRebaseResult,
  InteractiveRebaseStatusInfo,
  InteractiveRebaseTodoEntry,
  PullPredictGraphResult,
  PullPredictResult,
  PullResult,
  RepoOverview,
} from "../types/git";
import type { GitHistoryOrder } from "../appSettingsStore";

export function gitCheckWorktree(repoPath: string) {
  return invoke<void>("git_check_worktree", { repoPath });
}

export function repoOverview(repoPath: string) {
  return invoke<RepoOverview>("repo_overview", { repoPath });
}

export function gitStatusSummary(repoPath: string) {
  return invoke<GitStatusSummary>("git_status_summary", { repoPath });
}

export function gitGetRemoteUrl(repoPath: string, remoteName: string) {
  return invoke<string | null>("git_get_remote_url", { repoPath, remoteName });
}

export function gitAheadBehind(repoPath: string, remoteName: string) {
  return invoke<GitAheadBehind>("git_ahead_behind", { repoPath, remoteName });
}

export function gitFetch(repoPath: string, remoteName: string) {
  return invoke<string>("git_fetch", { repoPath, remoteName });
}

export function gitStashList(repoPath: string) {
  return invoke<GitStashEntry[]>("git_stash_list", { repoPath });
}

export function listCommits(params: {
  repoPath: string;
  maxCount: number;
  onlyHead: boolean;
  historyOrder: GitHistoryOrder;
}) {
  return invoke<GitCommit[]>("list_commits", params);
}

export function listCommitsFull(params: { repoPath: string; onlyHead: boolean; historyOrder: GitHistoryOrder }) {
  return invoke<GitCommit[]>("list_commits_full", params);
}

export function gitListBranches(params: { repoPath: string; includeRemote: boolean }) {
  return invoke<GitBranchInfo[]>("git_list_branches", params);
}

export function gitSwitch(params: {
  repoPath: string;
  branch: string;
  create: boolean;
  force?: boolean;
  startPoint?: string;
  track?: boolean;
}) {
  return invoke<string>("git_switch", params);
}

export function gitRenameBranch(params: { repoPath: string; oldName: string; newName: string }) {
  return invoke<string>("git_rename_branch", params);
}

export function gitDeleteBranch(params: { repoPath: string; branch: string; force: boolean }) {
  return invoke<string>("git_delete_branch", params);
}

export function gitCreateBranchAdvanced(params: {
  repoPath: string;
  branch: string;
  at?: string;
  checkout: boolean;
  orphan: boolean;
  clearWorkingTree: boolean;
}) {
  return invoke<string>("git_create_branch_advanced", params);
}

export function gitStatus(repoPath: string) {
  return invoke<GitStatusEntry[]>("git_status", { repoPath });
}

export function gitDiscardWorkingPath(params: { repoPath: string; path: string; isUntracked: boolean }) {
  return invoke<void>("git_discard_working_path", params);
}

export function gitDeleteWorkingPath(params: { repoPath: string; path: string }) {
  return invoke<void>("git_delete_working_path", params);
}

export function gitAddToGitignore(params: { repoPath: string; pattern: string }) {
  return invoke<void>("git_add_to_gitignore", params);
}

export function gitStashBaseCommit(params: { repoPath: string; stashRef: string }) {
  return invoke<string>("git_stash_base_commit", params);
}

export function gitReset(params: { repoPath: string; mode: "soft" | "mixed" | "hard"; target: string }) {
  return invoke<string>("git_reset", params);
}

export function gitResetHard(repoPath: string) {
  return invoke<string>("git_reset_hard", { repoPath });
}

export function gitIsAncestor(params: { repoPath: string; ancestor: string; descendant: string }) {
  return invoke<boolean>("git_is_ancestor", params);
}

export function gitCheckoutCommit(params: { repoPath: string; commit: string }) {
  return invoke<string>("git_checkout_commit", params);
}

export function gitCheckoutBranch(params: { repoPath: string; branch: string }) {
  return invoke<string>("git_checkout_branch", params);
}

export function gitCommitAll(params: { repoPath: string; message: string }) {
  return invoke<string>("git_commit_all", params);
}

export function gitCommitSummary(params: { repoPath: string; commit: string }) {
  return invoke<GitCommitSummary>("git_commit_summary", params);
}

export function gitReflog(params: { repoPath: string; maxCount: number }) {
  return invoke<string>("git_reflog", params);
}

export function gitBranchesPointsAt(params: { repoPath: string; commit: string }) {
  return invoke<string[]>("git_branches_points_at", params);
}

export function gitCreateBranch(params: { repoPath: string; branch: string }) {
  return invoke<string>("git_create_branch", params);
}

export function gitCreateTag(params: {
  repoPath: string;
  tag: string;
  target?: string;
  annotated: boolean;
  message?: string;
  force: boolean;
}) {
  return invoke<string>("git_create_tag", params);
}

export function gitDeleteTag(params: { repoPath: string; tag: string }) {
  return invoke<string>("git_delete_tag", params);
}

export function gitDeleteRemoteTag(params: { repoPath: string; remoteName?: string; tag: string }) {
  return invoke<string>("git_delete_remote_tag", params);
}

export function gitListTagTargets(repoPath: string) {
  return invoke<GitTagTarget[]>("git_list_tag_targets", { repoPath });
}

export function gitListRemoteTagTargets(params: { repoPath: string; remoteName?: string }) {
  return invoke<GitTagTarget[]>("git_list_remote_tag_targets", params);
}

export function gitPushTags(params: { repoPath: string; remoteName?: string; tags: string[]; force?: boolean }) {
  return invoke<string>("git_push_tags", params);
}

export function gitRenameTag(params: {
  repoPath: string;
  oldTag: string;
  newTag: string;
  renameOnRemote?: boolean;
  remoteName?: string;
}) {
  return invoke<string>("git_rename_tag", params);
}

export function gitMergeBranch(params: { repoPath: string; branch: string }) {
  return invoke<PullResult>("git_merge_branch", params);
}

export function gitMergeBranchAdvanced(params: {
  repoPath: string;
  branch: string;
  ffMode?: "" | "ff" | "no-ff" | "ff-only";
  noCommit?: boolean;
  squash?: boolean;
  allowUnrelatedHistories?: boolean;
  autostash?: boolean;
  signoff?: boolean;
  noVerify?: boolean;
  strategy?: string;
  conflictPreference?: "" | "ours" | "theirs";
  logMessages?: number;
  message?: string;
}) {
  return invoke<PullResult>("git_merge_branch_advanced", params);
}

export function gitCherryPick(params: { repoPath: string; commits: string[] }) {
  return invoke<string>("git_cherry_pick", params);
}

export function gitCherryPickAdvanced(params: { repoPath: string; commits: string[]; appendOrigin: boolean; noCommit: boolean }) {
  return invoke<string>("git_cherry_pick_advanced", params);
}

export function gitFormatPatchToFile(params: { repoPath: string; commit: string; outPath: string }) {
  return invoke<string>("git_format_patch_to_file", params);
}

export function gitPredictPatchFile(params: { repoPath: string; patchPath: string; method: string }) {
  return invoke<GitPatchPredictResult>("git_predict_patch_file", params);
}

export function gitPredictPatchGraph(params: { repoPath: string; patchPath: string; method: string; maxCommits?: number }) {
  return invoke<GitPatchPredictGraphResult>("git_predict_patch_graph", params);
}

export function gitApplyPatchFile(params: { repoPath: string; patchPath: string; method: string }) {
  return invoke<string>("git_apply_patch_file", params);
}

export function gitCherryPickAbort(repoPath: string) {
  return invoke<string>("git_cherry_pick_abort", { repoPath });
}

export function gitCherryPickContinueWithMessage(params: { repoPath: string; message: string }) {
  return invoke<string>("git_cherry_pick_continue_with_message", params);
}

export function gitAmAbort(repoPath: string) {
  return invoke<string>("git_am_abort", { repoPath });
}

export function gitAmContinueWithMessage(params: { repoPath: string; message: string }) {
  return invoke<string>("git_am_continue_with_message", params);
}

export function gitResolveRef(params: { repoPath: string; reference: string }) {
  return invoke<string>("git_resolve_ref", params);
}

export function gitPull(params: { repoPath: string; remoteName: string }) {
  return invoke<PullResult>("git_pull", params);
}

export function gitPullRebase(params: { repoPath: string; remoteName: string }) {
  return invoke<PullResult>("git_pull_rebase", params);
}

export function gitPullPredict(params: { repoPath: string; remoteName: string; rebase: boolean }) {
  return invoke<PullPredictResult>("git_pull_predict", params);
}

export function gitPullPredictGraph(params: { repoPath: string; remoteName: string; rebase: boolean; maxCommits?: number }) {
  return invoke<PullPredictGraphResult>("git_pull_predict_graph", params);
}

export function gitPullPredictConflictPreview(params: { repoPath: string; upstream: string; path: string }) {
  return invoke<string>("git_pull_predict_conflict_preview", params);
}

export function gitRebaseContinue(repoPath: string) {
  return invoke<string>("git_rebase_continue", { repoPath });
}

export function gitRebaseAbort(repoPath: string) {
  return invoke<string>("git_rebase_abort", { repoPath });
}

export function gitRebaseSkip(repoPath: string) {
  return invoke<string>("git_rebase_skip", { repoPath });
}

export function gitConflictState(repoPath: string) {
  return invoke<GitConflictState>("git_conflict_state", { repoPath });
}

export function gitConflictFileVersions(params: { repoPath: string; path: string }) {
  return invoke<GitConflictFileVersions>("git_conflict_file_versions", params);
}

export function gitConflictTakeOurs(params: { repoPath: string; path: string }) {
  return invoke<string>("git_conflict_take_ours", params);
}

export function gitConflictTakeTheirs(params: { repoPath: string; path: string }) {
  return invoke<string>("git_conflict_take_theirs", params);
}

export function gitConflictResolveRename(params: { repoPath: string; path: string; keepName: "ours" | "theirs"; keepContent: "ours" | "theirs" }) {
  return invoke<string>("git_conflict_resolve_rename", params);
}

export function gitConflictResolveRenameWithContent(params: { repoPath: string; path: string; keepName: "ours" | "theirs"; content: string }) {
  return invoke<string>("git_conflict_resolve_rename_with_content", params);
}

export function gitConflictApplyAndStage(params: { repoPath: string; path: string; content: string }) {
  return invoke<string>("git_conflict_apply_and_stage", params);
}

export function gitConflictApply(params: { repoPath: string; path: string; content: string }) {
  return invoke<string>("git_conflict_apply", params);
}

export function gitContinueInfo(repoPath: string) {
  return invoke<GitContinueInfo>("git_continue_info", { repoPath });
}

export function gitContinueFileDiff(params: { repoPath: string; path: string; unified: number }) {
  return invoke<string>("git_continue_file_diff", params);
}

export function gitContinueRenameDiff(params: { repoPath: string; oldPath: string; newPath: string; unified: number }) {
  return invoke<string>("git_continue_rename_diff", params);
}

export function gitMergeContinueWithMessage(params: { repoPath: string; message: string }) {
  return invoke<string>("git_merge_continue_with_message", params);
}

export function gitRebaseContinueWithMessage(params: { repoPath: string; message: string }) {
  return invoke<string>("git_rebase_continue_with_message", params);
}

export function gitMergeContinue(repoPath: string) {
  return invoke<string>("git_merge_continue", { repoPath });
}

export function gitMergeAbort(repoPath: string) {
  return invoke<string>("git_merge_abort", { repoPath });
}

export function gitLsRemoteHeads(repoUrl: string) {
  return invoke<string[]>("git_ls_remote_heads", { repoUrl });
}

export function gitCloneRepo(params: {
  repoUrl: string;
  destinationPath: string;
  branch?: string;
  initSubmodules: boolean;
  downloadFullHistory: boolean;
  bare: boolean;
  origin?: string;
  singleBranch: boolean;
}) {
  return invoke<string>("git_clone_repo", params);
}

export function gitStashPushPaths(params: { repoPath: string; message: string; paths: string[]; includeUntracked: boolean }) {
  return invoke<string>("git_stash_push_paths", params);
}

export function gitStashPushPatch(params: { repoPath: string; message: string; path: string; keepPatch: string }) {
  return invoke<string>("git_stash_push_patch", params);
}

export function gitStashShow(params: { repoPath: string; stashRef: string }) {
  return invoke<string>("git_stash_show", params);
}

export function gitStashApply(params: { repoPath: string; stashRef: string }) {
  return invoke<string>("git_stash_apply", params);
}

export function gitStashDrop(params: { repoPath: string; stashRef: string }) {
  return invoke<string>("git_stash_drop", params);
}

export function gitStashClear(repoPath: string) {
  return invoke<string>("git_stash_clear", { repoPath });
}

export function gitHasStagedChanges(repoPath: string) {
  return invoke<boolean>("git_has_staged_changes", { repoPath });
}

export function gitStagePaths(params: { repoPath: string; paths: string[] }) {
  return invoke<string>("git_stage_paths", params);
}

export function gitUnstagePaths(params: { repoPath: string; paths: string[] }) {
  return invoke<string>("git_unstage_paths", params);
}

export function gitCommit(params: { repoPath: string; message: string; paths: string[] }) {
  return invoke<string>("git_commit", params);
}

 export function gitCommitPatch(params: { repoPath: string; message: string; patches: Array<{ path: string; patch: string }> }) {
   return invoke<string>("git_commit_patch", params);
 }

export function gitPush(params: { repoPath: string; remoteName: string; branch?: string; force: boolean; withLease?: boolean }) {
  return invoke<string>("git_push", params);
}

export function gitSetRemoteUrl(params: { repoPath: string; remoteName: string; url: string }) {
  return invoke<void>("git_set_remote_url", params);
}

export function gitTrustRepoGlobal(repoPath: string) {
  return invoke<void>("git_trust_repo_global", { repoPath });
}

export function gitTrustRepoSession(repoPath: string) {
  return invoke<void>("git_trust_repo_session", { repoPath });
}

export function changeRepoOwnershipToCurrentUser(repoPath: string) {
  return invoke<void>("change_repo_ownership_to_current_user", { repoPath });
}

export function initRepo(repoPath: string) {
  return invoke<string>("init_repo", { repoPath });
}

export function gitCommitChanges(params: { repoPath: string; commit: string }) {
  return invoke<Array<{ status: string; path: string; old_path?: string | null }>>("git_commit_changes", params);
}

export function gitCommitFileContent(params: { repoPath: string; commit: string; path: string }) {
  return invoke<string>("git_commit_file_content", params);
}

export function gitCommitFileDiff(params: { repoPath: string; commit: string; path: string }) {
  return invoke<string>("git_commit_file_diff", params);
}

export function gitLaunchExternalDiffCommit(params: {
  repoPath: string;
  commit: string;
  path: string;
  oldPath?: string | null;
  toolPath: string;
  command: string;
}) {
  return invoke<void>("git_launch_external_diff_commit", params);
}

export function gitSetUserIdentity(params: { scope: "repo" | "global"; userName: string; userEmail: string; repoPath?: string }) {
  return invoke<void>("git_set_user_identity", params);
}

export function gitInteractiveRebaseCommits(params: { repoPath: string; base?: string }) {
  return invoke<InteractiveRebaseCommitInfo[]>("git_interactive_rebase_commits", params);
}

export function gitInteractiveRebaseStart(params: { repoPath: string; base: string; todoEntries: InteractiveRebaseTodoEntry[] }) {
  return invoke<InteractiveRebaseResult>("git_interactive_rebase_start", params);
}

export function gitInteractiveRebaseAmend(params: { repoPath: string; message?: string; author?: string }) {
  return invoke<string>("git_interactive_rebase_amend", params);
}

export function gitInteractiveRebaseContinue(repoPath: string) {
  return invoke<InteractiveRebaseResult>("git_interactive_rebase_continue", { repoPath });
}

export function gitInteractiveRebaseStatus(repoPath: string) {
  return invoke<InteractiveRebaseStatusInfo>("git_interactive_rebase_status", { repoPath });
}

export type EditStopFileEntry = {
  status: string;
  path: string;
  old_path: string | null;
};

export function gitInteractiveRebaseEditFiles(repoPath: string) {
  return invoke<EditStopFileEntry[]>("git_interactive_rebase_edit_files", { repoPath });
}

export function gitReadWorkingFile(params: { repoPath: string; path: string }) {
  return invoke<string>("git_read_working_file", params);
}

export function gitWriteWorkingFile(params: { repoPath: string; path: string; content: string }) {
  return invoke<void>("git_write_working_file", params);
}

export function gitRenameWorkingFile(params: { repoPath: string; oldPath: string; newPath: string }) {
  return invoke<void>("git_rename_working_file", params);
}

export function gitDeleteWorkingFile(params: { repoPath: string; path: string }) {
  return invoke<void>("git_delete_working_file", params);
}

export function gitRestoreWorkingFile(params: { repoPath: string; path: string }) {
  return invoke<void>("git_restore_working_file", params);
}
