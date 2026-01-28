import { invoke } from "@tauri-apps/api/core";
import type {
  GitAheadBehind,
  GitBranchInfo,
  GitCommit,
  GitCommitSummary,
  GitConflictFileVersions,
  GitConflictState,
  GitStatusEntry,
  GitStatusSummary,
  GitStashEntry,
  GitTagTarget,
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
  return invoke<string>("git_merge_branch", params);
}

export function gitCherryPick(params: { repoPath: string; commits: string[] }) {
  return invoke<string>("git_cherry_pick", params);
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

export function gitConflictApplyAndStage(params: { repoPath: string; path: string; content: string }) {
  return invoke<string>("git_conflict_apply_and_stage", params);
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
