import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { listen } from "@tauri-apps/api/event";
import type { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import SettingsModal from "./SettingsModal";
import GitIgnoreModifierModal from "./GitIgnoreModifierModal";
import { getCyPalette, useAppSettings } from "./appSettingsStore";
import { QuickButtonsModal } from "./components/modals/QuickButtonsModal";
import { installTestBackdoor } from "./testing/backdoor";
import {
  detectAppPlatform,
  formatShortcutSpecForDisplay,
  joinShortcutDisplay,
  type ShortcutActionId,
} from "./shortcuts";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import { copyText } from "./utils/clipboard";
import { fnv1a32, md5Hex } from "./utils/hash";
import { authorInitials, shortHash, truncate } from "./utils/text";
import { CommitLaneSvg } from "./features/commits/CommitLaneSvg";
import {
  computeCommitLaneRows,
  computeCompactLaneByHashForGraph,
  type CommitLaneRow,
} from "./features/commits/lanes";
import { useCommitController } from "./features/commits/useCommitController";
import { useCyGraph } from "./features/graph/useCyGraph";
import { useFilePreviewController } from "./features/filePreview/useFilePreviewController";
import { useRepoIndicators } from "./features/repo/useRepoIndicators";
import { useRepoLoader } from "./features/repo/useRepoLoader";
import { useRepoOpenClose } from "./features/repo/useRepoOpenClose";
import { useStashController } from "./features/stash/useStashController";
import { useGitTrustActions, useGitTrustState } from "./features/gitTrust/useGitTrustController";
import { useSystemHelpers } from "./features/system/useSystemHelpers";
import {
  gitCreateBranchAdvanced,
  gitCreateBranch,
  gitCreateTag,
  gitDeleteTag,
  gitDeleteRemoteTag,
  gitResolveRef,
  gitRenameTag,
  gitPushTags,
  gitListRemoteTagTargets,
  gitCheckoutBranch,
  gitCheckoutCommit,
  gitCherryPick,
  gitCherryPickAdvanced,
  gitCherryPickAbort,
  gitAmAbort,
  gitFormatPatchToFile,
  gitPredictPatchGraph,
  gitApplyPatchFile,
  gitCloneRepo,
  gitCommitAll,
  gitCommitChanges,
  gitCommitFileDiff,
  initRepo,
  gitCommitSummary,
  gitBranchesPointsAt,
  gitDeleteBranch,
  gitDeleteWorkingPath,
  gitDiscardWorkingPath,
  gitAddToGitignore,
  gitFetch,
  gitGetRemoteUrl,
  gitIsAncestor,
  gitListBranches,
  gitLsRemoteHeads,
  gitMergeAbort,
  gitMergeBranch,
  gitMergeBranchAdvanced,
  gitConflictState,
  gitPull,
  gitPullPredict,
  gitPullPredictGraph,
  gitPullRebase,
  gitRebaseAbort,
  gitRebaseSkip,
  gitRenameBranch,
  gitReset,
  gitResetHard,
  gitReflog,
  gitSwitch,
  gitPush,
  gitSetRemoteUrl,
  repoOverview,
} from "./api/git";
import { revealInFileExplorer } from "./api/system";
import { RepoTabs } from "./components/RepoTabs";
import { TopToolbar } from "./components/TopToolbar";
import { MainHeader } from "./components/MainHeader";
import { Sidebar } from "./components/Sidebar";
import { DetailsPanel } from "./components/DetailsPanel";
import { CommitContextMenu } from "./components/CommitContextMenu";
import { WorkingFileContextMenu } from "./components/WorkingFileContextMenu";
import { RefBadgeContextMenu } from "./components/RefBadgeContextMenu";
import { BranchContextMenu } from "./components/BranchContextMenu";
import { StashContextMenu } from "./components/StashContextMenu";
import { TagContextMenu } from "./components/TagContextMenu";
import { RepositoryMenu } from "./components/menus/RepositoryMenu";
import { NavigateMenu } from "./components/menus/NavigateMenu";
import { ViewMenu } from "./components/menus/ViewMenu";
import { CommandsMenu } from "./components/menus/CommandsMenu";
import { ToolsMenu } from "./components/menus/ToolsMenu";
import { MenubarRight } from "./components/menus/MenubarRight";
import { GoToModal } from "./components/modals/GoToModal";
import { ConfirmModal } from "./components/modals/ConfirmModal";
import { ResetModal } from "./components/modals/ResetModal";
import { CleanOldBranchesModal } from "./components/modals/CleanOldBranchesModal";
import { RenameBranchModal } from "./components/modals/RenameBranchModal";
import { RenameTagModal } from "./components/modals/RenameTagModal";
import { SwitchBranchModal } from "./components/modals/SwitchBranchModal";
import { MergeBranchesModal } from "./components/modals/MergeBranchesModal";
import { PreviewZoomModal } from "./components/modals/PreviewZoomModal";
import { PullConflictModal } from "./components/modals/PullConflictModal";
import { ConflictResolverModal } from "./components/modals/ConflictResolverModal";
import { ContinueAfterConflictsModal } from "./components/modals/ContinueAfterConflictsModal";
import { CherryStepsModal } from "./components/modals/CherryStepsModal";
import { PullPredictModal } from "./components/modals/PullPredictModal";
import { CreateBranchModal } from "./components/modals/CreateBranchModal";
import { CreateTagModal } from "./components/modals/CreateTagModal";
import { CherryPickModal } from "./components/modals/CherryPickModal";
import { PatchModal } from "./components/modals/PatchModal";
import { PatchPredictModal } from "./components/modals/PatchPredictModal";
import { FilePreviewModal } from "./components/modals/FilePreviewModal";
import { ChangesModal } from "./components/modals/ChangesModal";
import { RemoteModal } from "./components/modals/RemoteModal";
import { PushModal } from "./components/modals/PushModal";
import { StashModal } from "./components/modals/StashModal";
import { StashViewModal } from "./components/modals/StashViewModal";
import { CommitModal } from "./components/modals/CommitModal";
import { CloneModal } from "./components/modals/CloneModal";
import { GitTrustModal } from "./components/modals/GitTrustModal";
import { DetachedHeadModal } from "./components/modals/DetachedHeadModal";
import DiffToolModal from "./DiffToolModal";
import TooltipLayer from "./TooltipLayer";
import type {
  GitAheadBehind,
  GitBranchInfo,
  GitCommit,
  GitCloneProgressEvent,
  GitCommitSummary,
  GitPatchPredictGraphResult,
  GitStashEntry,
  GitStatusSummary,
  PullPredictGraphResult,
  RepoOverview,
} from "./types/git";

import "./styles/index.css";

type GitResetMode = "soft" | "mixed" | "hard";

function App() {
  const [repos, setRepos] = useState<string[]>([]);
  const [activeRepoPath, setActiveRepoPath] = useState<string>("");
  const [tabDragPath, setTabDragPath] = useState<string>("");
  const [viewModeByRepo, setViewModeByRepo] = useState<Record<string, "graph" | "commits">>({});
  const [tagsExpandedByRepo, setTagsExpandedByRepo] = useState<Record<string, boolean>>({});
  const [overviewByRepo, setOverviewByRepo] = useState<Record<string, RepoOverview | undefined>>({});
  const [commitsByRepo, setCommitsByRepo] = useState<Record<string, GitCommit[] | undefined>>({});
  const [commitsFullByRepo, setCommitsFullByRepo] = useState<Record<string, boolean>>({});
  const [commitsFullLoadingByRepo, setCommitsFullLoadingByRepo] = useState<Record<string, boolean>>({});
  const [commitsHasMoreByRepo, setCommitsHasMoreByRepo] = useState<Record<string, boolean | undefined>>({});
  const [remoteUrlByRepo, setRemoteUrlByRepo] = useState<Record<string, string | null | undefined>>({});
  const [statusSummaryByRepo, setStatusSummaryByRepo] = useState<Record<string, GitStatusSummary | undefined>>({});
  const [aheadBehindByRepo, setAheadBehindByRepo] = useState<Record<string, GitAheadBehind | undefined>>({});
  const [tagsToPushByRepo, setTagsToPushByRepo] = useState<Record<string, { newTags: string[]; movedTags: string[] } | undefined>>({});
  const [indicatorsUpdatingByRepo, setIndicatorsUpdatingByRepo] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string>("");
  const [errorByRepo, setErrorByRepo] = useState<Record<string, string>>({});
  const {
    gitTrustOpen,
    setGitTrustOpen,
    gitTrustRepoPath,
    setGitTrustRepoPath,
    gitTrustDetails,
    setGitTrustDetails,
    gitTrustDetailsOpen,
    setGitTrustDetailsOpen,
    gitTrustBusy,
    setGitTrustBusy,
    gitTrustActionError,
    setGitTrustActionError,
    gitTrustCopied,
    currentUsername,
    gitTrustGlobalCommand,
    copyGitTrustGlobalCommand,
  } = useGitTrustState();
  const [repositoryMenuOpen, setRepositoryMenuOpen] = useState(false);
  const [navigateMenuOpen, setNavigateMenuOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [commandsMenuOpen, setCommandsMenuOpen] = useState(false);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const [diffToolModalOpen, setDiffToolModalOpen] = useState(false);
  const [gitignoreModifierOpen, setGitignoreModifierOpen] = useState(false);
  const [cleanOldBranchesOpen, setCleanOldBranchesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quickButtonsModalOpen, setQuickButtonsModalOpen] = useState(false);
  const [goToOpen, setGoToOpen] = useState(false);
  const [goToKind, setGoToKind] = useState<"commit" | "tag">("commit");
  const [goToText, setGoToText] = useState<string>("");
  const [goToTargetView, setGoToTargetView] = useState<"graph" | "commits">("graph");
  const [goToError, setGoToError] = useState<string>("");

  const [commitSearchOpen, setCommitSearchOpen] = useState(false);
  const [commitSearchText, setCommitSearchText] = useState("");
  const [commitSearchInSubject, setCommitSearchInSubject] = useState(true);
  const [commitSearchInHash, setCommitSearchInHash] = useState(true);
  const [commitSearchInAuthor, setCommitSearchInAuthor] = useState(true);
  const [commitSearchInDiff, setCommitSearchInDiff] = useState(false);
  const [commitSearchAuthorFilter, setCommitSearchAuthorFilter] = useState("");
  const [commitSearchDateFrom, setCommitSearchDateFrom] = useState("");
  const [commitSearchDateTo, setCommitSearchDateTo] = useState("");
  const [commitSearchDiffBusy, setCommitSearchDiffBusy] = useState(false);
  const [commitSearchDiffMatches, setCommitSearchDiffMatches] = useState<Record<string, boolean>>({});
  const commitSearchDiffCacheRef = useRef<Map<string, Map<string, boolean>>>(new Map());
  const commitSearchInputRef = useRef<HTMLInputElement | null>(null);

  const closeCommitSearch = () => {
    setCommitSearchOpen(false);
    setCommitSearchText("");
    setCommitSearchDiffBusy(false);
    setCommitSearchDiffMatches({});
  };

  function openCommitSearch() {
    if (!activeRepoPath) return;
    setViewMode("commits");
    setCommitSearchOpen(true);
  }

  function extractPatchFailurePaths(message: string) {
    const lines = (message ?? "").replace(/\r\n/g, "\n").split("\n");
    const out: string[] = [];
    const seen = new Set<string>();

    const takePathBeforeColon = (s: string) => {
      const r = (s ?? "").trim();
      if (!r) return "";
      if (r.length >= 3 && r[1] === ":" && (r[2] === "\\" || r[2] === "/")) {
        const pos = r.slice(2).indexOf(":");
        if (pos < 0) return "";
        return r.slice(0, pos + 2).trim();
      }
      const pos = r.indexOf(":");
      if (pos < 0) return "";
      return r.slice(0, pos).trim();
    };

    const isCandidatePath = (p: string) => {
      const t = (p ?? "").trim();
      if (!t) return false;
      if (t.toLowerCase() === "patch") return false;
      if (/\s/.test(t)) return false;
      return t.includes(".") || t.includes("/") || t.includes("\\");
    };

    for (const line of lines) {
      let l = (line ?? "").trim();
      if (!l) continue;
      if (l.toLowerCase().startsWith("git command failed:")) {
        l = l.slice("git command failed:".length).trim();
      }

      const patchFailedPrefix = "error: patch failed:";
      if (l.toLowerCase().startsWith(patchFailedPrefix)) {
        const rest = l.slice(patchFailedPrefix.length).trim();
        const p = takePathBeforeColon(rest);
        if (isCandidatePath(p) && !seen.has(p)) {
          seen.add(p);
          out.push(p);
        }
        continue;
      }

      if (l.toLowerCase().startsWith("error:")) {
        const rest = l.slice("error:".length).trim();
        const p = takePathBeforeColon(rest);
        if (isCandidatePath(p) && !seen.has(p)) {
          seen.add(p);
          out.push(p);
        }
      }
    }

    return out;
  }

  function humanizePatchApplyError(raw: string) {
    const msg = (raw ?? "").trim();
    const lower = msg.toLowerCase();
    const paths = extractPatchFailurePaths(msg);
    const hasDoesNotApply = lower.includes("patch does not apply") || lower.includes("patch failed:") || lower.includes("does not apply");
    if (!hasDoesNotApply) return msg;

    const filesLine = paths.length ? `\nPotential conflict files:\n${paths.map((p) => `- ${p}`).join("\n")}` : "";
    if (patchMethod === "apply") {
      return `Conflict detected: this patch cannot be applied cleanly.${filesLine}\n\nDetails:\n${msg}`;
    }
    return `Conflict detected: git am could not apply this patch cleanly.${filesLine}\n\nDetails:\n${msg}`;
  }

  const [graphButtonsVisible, setGraphButtonsVisible] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState("Confirm");
  const [confirmMessage, setConfirmMessage] = useState("");
  const [confirmOkLabel, setConfirmOkLabel] = useState("OK");
  const [confirmCancelLabel, setConfirmCancelLabel] = useState("Cancel");
  const confirmResolveRef = useRef<((v: boolean) => void) | null>(null);

  const tabSuppressClickRef = useRef(false);
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const reposRef = useRef<string[]>([]);
  const tabFlipRectsRef = useRef<Map<string, DOMRect>>(new Map());

  useEffect(() => {
    reposRef.current = repos;
  }, [repos]);

  const captureTabRects = () => {
    const tabsEl = tabsRef.current;
    if (!tabsEl) return;
    const map = tabFlipRectsRef.current;
    map.clear();
    const nodes = tabsEl.querySelectorAll<HTMLElement>(".tab");
    for (const n of nodes) {
      const key = n.getAttribute("data-repo-path") ?? "";
      if (!key) continue;
      map.set(key, n.getBoundingClientRect());
    }
  };

  useLayoutEffect(() => {
    const tabsEl = tabsRef.current;
    if (!tabsEl) return;
    const prev = tabFlipRectsRef.current;
    if (prev.size === 0) return;

    const nodes = tabsEl.querySelectorAll<HTMLElement>(".tab");
    for (const n of nodes) {
      const key = n.getAttribute("data-repo-path") ?? "";
      if (!key) continue;
      const from = prev.get(key);
      if (!from) continue;
      const to = n.getBoundingClientRect();
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if (dx === 0 && dy === 0) continue;
      n.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0px, 0px)" }],
        { duration: 140, easing: "ease-out" }
      );
    }
    prev.clear();
  }, [repos]);

  const [cloneModalOpen, setCloneModalOpen] = useState(false);
  const [cloneRepoUrl, setCloneRepoUrl] = useState("");
  const [cloneDestinationFolder, setCloneDestinationFolder] = useState("");
  const [cloneSubdirName, setCloneSubdirName] = useState("");
  const [cloneBranch, setCloneBranch] = useState("");
  const [cloneInitSubmodules, setCloneInitSubmodules] = useState(true);
  const [cloneDownloadFullHistory, setCloneDownloadFullHistory] = useState(true);
  const [cloneBare, setCloneBare] = useState(false);
  const [cloneOrigin, setCloneOrigin] = useState("");
  const [cloneSingleBranch, setCloneSingleBranch] = useState(false);
  const [cloneBusy, setCloneBusy] = useState(false);
  const [cloneError, setCloneError] = useState("");
  const [cloneProgressMessage, setCloneProgressMessage] = useState<string>("");
  const [cloneProgressPercent, setCloneProgressPercent] = useState<number | null>(null);
  const cloneProgressDestRef = useRef<string>("");
  const [cloneBranchesBusy, setCloneBranchesBusy] = useState(false);
  const [cloneBranchesError, setCloneBranchesError] = useState("");
  const [cloneBranches, setCloneBranches] = useState<string[]>([]);

  const [stashesByRepo, setStashesByRepo] = useState<Record<string, GitStashEntry[] | undefined>>({});

  const [remoteModalOpen, setRemoteModalOpen] = useState(false);
  const [remoteUrlDraft, setRemoteUrlDraft] = useState("");
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [remoteError, setRemoteError] = useState("");

  const [pushModalOpen, setPushModalOpen] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushForce, setPushForce] = useState(false);
  const [pushWithLease, setPushWithLease] = useState(true);
  const [pushError, setPushError] = useState("");
  const [pushLocalBranch, setPushLocalBranch] = useState("");
  const [pushRemoteBranch, setPushRemoteBranch] = useState("");

  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<string>("HEAD~1");
  const [resetMode, setResetMode] = useState<GitResetMode>("mixed");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string>("");

  const [createBranchOpen, setCreateBranchOpen] = useState(false);
  const [createBranchName, setCreateBranchName] = useState<string>("");
  const [createBranchAt, setCreateBranchAt] = useState<string>("");
  const [createBranchCheckout, setCreateBranchCheckout] = useState<boolean>(true);
  const [createBranchOrphan, setCreateBranchOrphan] = useState<boolean>(false);
  const [createBranchClearWorkingTree, setCreateBranchClearWorkingTree] = useState<boolean>(false);
  const [createBranchBusy, setCreateBranchBusy] = useState<boolean>(false);
  const [createBranchError, setCreateBranchError] = useState<string>("");
  const [createBranchCommitLoading, setCreateBranchCommitLoading] = useState<boolean>(false);
  const [createBranchCommitError, setCreateBranchCommitError] = useState<string>("");
  const [createBranchCommitSummary, setCreateBranchCommitSummary] = useState<GitCommitSummary | null>(null);

  const [createTagOpen, setCreateTagOpen] = useState(false);
  const [createTagName, setCreateTagName] = useState<string>("");
  const [createTagAt, setCreateTagAt] = useState<string>("");
  const [createTagAnnotated, setCreateTagAnnotated] = useState<boolean>(false);
  const [createTagMessage, setCreateTagMessage] = useState<string>("");
  const [createTagForce, setCreateTagForce] = useState<boolean>(false);
  const [createTagPushToOrigin, setCreateTagPushToOrigin] = useState<boolean>(false);
  const [createTagBusy, setCreateTagBusy] = useState<boolean>(false);
  const [createTagError, setCreateTagError] = useState<string>("");

  const [renameBranchOpen, setRenameBranchOpen] = useState(false);
  const [renameBranchOld, setRenameBranchOld] = useState<string>("");
  const [renameBranchNew, setRenameBranchNew] = useState<string>("");
  const [renameBranchBusy, setRenameBranchBusy] = useState(false);
  const [renameBranchError, setRenameBranchError] = useState<string>("");

  const [renameTagOpen, setRenameTagOpen] = useState(false);
  const [renameTagOld, setRenameTagOld] = useState<string>("");
  const [renameTagNew, setRenameTagNew] = useState<string>("");
  const [renameTagOnRemote, setRenameTagOnRemote] = useState<boolean>(false);
  const [renameTagBusy, setRenameTagBusy] = useState(false);
  const [renameTagError, setRenameTagError] = useState<string>("");

  const [switchBranchOpen, setSwitchBranchOpen] = useState(false);
  const [switchBranchMode, setSwitchBranchMode] = useState<"local" | "remote">("local");
  const [switchBranchName, setSwitchBranchName] = useState<string>("");
  const [switchRemoteLocalMode, setSwitchRemoteLocalMode] = useState<"same" | "custom">("same");
  const [switchRemoteLocalName, setSwitchRemoteLocalName] = useState<string>("");
  const [switchBranchBusy, setSwitchBranchBusy] = useState(false);
  const [switchBranchError, setSwitchBranchError] = useState<string>("");
  const [switchBranchesLoading, setSwitchBranchesLoading] = useState(false);
  const [switchBranchesError, setSwitchBranchesError] = useState<string>("");
  const [switchBranches, setSwitchBranches] = useState<GitBranchInfo[]>([]);

  const [mergeBranchesOpen, setMergeBranchesOpen] = useState(false);
  const [mergeBranchToMerge, setMergeBranchToMerge] = useState<string>("");
  const [mergeFfMode, setMergeFfMode] = useState<"" | "ff" | "no-ff" | "ff-only">("");
  const [mergeNoCommit, setMergeNoCommit] = useState(false);
  const [mergeSquash, setMergeSquash] = useState(false);
  const [mergeAllowUnrelatedHistories, setMergeAllowUnrelatedHistories] = useState(false);
  const [mergeAutostash, setMergeAutostash] = useState(false);
  const [mergeSignoff, setMergeSignoff] = useState(false);
  const [mergeNoVerify, setMergeNoVerify] = useState(false);
  const [mergeStrategy, setMergeStrategy] = useState<string>("");
  const [mergeConflictPreference, setMergeConflictPreference] = useState<"" | "ours" | "theirs">("");
  const [mergeLogMessages, setMergeLogMessages] = useState<number>(0);
  const [mergeMessage, setMergeMessage] = useState<string>("");
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeError, setMergeError] = useState<string>("");
  const [mergeBranchesLoading, setMergeBranchesLoading] = useState(false);
  const [mergeBranchesError, setMergeBranchesError] = useState<string>("");
  const [mergeBranches, setMergeBranches] = useState<GitBranchInfo[]>([]);

  const [pullMenuOpen, setPullMenuOpen] = useState(false);
  const [pullBusy, setPullBusy] = useState(false);
  const [pullErrorByRepo, setPullErrorByRepo] = useState<Record<string, string>>({});

  const [terminalMenuOpen, setTerminalMenuOpen] = useState(false);
  const terminalMenuRef = useRef<HTMLDivElement | null>(null);
  const [terminalMenuIndex, setTerminalMenuIndex] = useState(0);
  const shortcutRuntimeRef = useRef<any>({});
  const fullscreenRestoreRef = useRef<{ pos: PhysicalPosition; size: PhysicalSize } | null>(null);

  useGlobalShortcuts(shortcutRuntimeRef, fullscreenRestoreRef);

  const [pullConflictOpen, setPullConflictOpen] = useState(false);
  const [pullConflictOperation, setPullConflictOperation] = useState<"merge" | "rebase" | "cherry-pick" | "am">("merge");
  const [pullConflictFiles, setPullConflictFiles] = useState<string[]>([]);
  const [pullConflictMessage, setPullConflictMessage] = useState("");

  const [continueAfterConflictsOpen, setContinueAfterConflictsOpen] = useState(false);
  const [continueAfterConflictsKey, setContinueAfterConflictsKey] = useState(0);

  const [conflictResolverOpen, setConflictResolverOpen] = useState(false);
  const [conflictResolverKey, setConflictResolverKey] = useState(0);

  const [cherryPickOpen, setCherryPickOpen] = useState(false);
  const [cherryPickBusy, setCherryPickBusy] = useState(false);
  const [cherryPickError, setCherryPickError] = useState("");
  const [cherryPickTargetBranch, setCherryPickTargetBranch] = useState("");
  const [cherryPickCommitHash, setCherryPickCommitHash] = useState("");
  const [cherryPickAppendOrigin, setCherryPickAppendOrigin] = useState(false);
  const [cherryPickNoCommit, setCherryPickNoCommit] = useState(false);

  const [cherryPickCommitLoading, setCherryPickCommitLoading] = useState(false);
  const [cherryPickCommitError, setCherryPickCommitError] = useState("");
  const [cherryPickCommitSummary, setCherryPickCommitSummary] = useState<GitCommitSummary | null>(null);

  const [patchOpen, setPatchOpen] = useState(false);
  const [patchMode, setPatchMode] = useState<"export" | "apply">("apply");
  const [patchBusy, setPatchBusy] = useState(false);
  const [patchError, setPatchError] = useState("");
  const [patchStatus, setPatchStatus] = useState("");
  const [patchPath, setPatchPath] = useState("");
  const [patchMethod, setPatchMethod] = useState<"apply" | "am">("am");

  const [patchPredictOpen, setPatchPredictOpen] = useState(false);
  const [patchPredictBusy, setPatchPredictBusy] = useState(false);
  const [patchPredictError, setPatchPredictError] = useState("");
  const [patchPredictResult, setPatchPredictResult] = useState<GitPatchPredictGraphResult | null>(null);

  const [pullPredictOpen, setPullPredictOpen] = useState(false);
  const [pullPredictBusy, setPullPredictBusy] = useState(false);
  const [pullPredictError, setPullPredictError] = useState("");
  const [pullPredictRebase, setPullPredictRebase] = useState(false);
  const [pullPredictResult, setPullPredictResult] = useState<PullPredictGraphResult | null>(null);

  const [detachedHelpOpen, setDetachedHelpOpen] = useState(false);
  const [detachedBusy, setDetachedBusy] = useState(false);
  const [detachedError, setDetachedError] = useState("");
  const [detachedPointsAtBranches, setDetachedPointsAtBranches] = useState<string[]>([]);
  const [detachedTargetBranch, setDetachedTargetBranch] = useState<string>("");
  const [detachedSaveCommitMessage, setDetachedSaveCommitMessage] = useState<string>("WIP: detached HEAD changes");
  const [detachedTempBranchName, setDetachedTempBranchName] = useState<string>("");
  const [detachedTempBranchRandom, setDetachedTempBranchRandom] = useState<boolean>(true);
  const [detachedMergeAfterSave, setDetachedMergeAfterSave] = useState<boolean>(true);

  const [cherryStepsOpen, setCherryStepsOpen] = useState(false);
  const [cherryCommitHash, setCherryCommitHash] = useState<string>("");
  const [cherryReflog, setCherryReflog] = useState<string>("");

  const [previewZoomSrc, setPreviewZoomSrc] = useState<string | null>(null);

  const [cleanOldBranchesDays, setCleanOldBranchesDays] = useState<number>(30);
  const [cleanOldBranchesLoading, setCleanOldBranchesLoading] = useState(false);
  const [cleanOldBranchesDeleting, setCleanOldBranchesDeleting] = useState(false);
  const [cleanOldBranchesError, setCleanOldBranchesError] = useState<string>("");
  const [cleanOldBranchesAll, setCleanOldBranchesAll] = useState<GitBranchInfo[]>([]);
  const [cleanOldBranchesSelected, setCleanOldBranchesSelected] = useState<Record<string, boolean>>({});

  const defaultViewMode = useAppSettings((s) => s.viewMode);
  const theme = useAppSettings((s) => s.appearance.theme);
  const setTheme = useAppSettings((s) => s.setTheme);
  const fontFamily = useAppSettings((s) => s.appearance.fontFamily);
  const fontSizePx = useAppSettings((s) => s.appearance.fontSizePx);
  const modalClosePosition = useAppSettings((s) => s.appearance.modalClosePosition);
  const graphSettings = useAppSettings((s) => s.graph);
  const setGraph = useAppSettings((s) => s.setGraph);
  const layout = useAppSettings((s) => s.layout);
  const setLayout = useAppSettings((s) => s.setLayout);
  const terminalSettings = useAppSettings((s) => s.terminal);
  const setTerminal = useAppSettings((s) => s.setTerminal);
  const resetSettings = useAppSettings((s) => s.resetSettings);
  const setGit = useAppSettings((s) => s.setGit);
  const setGeneral = useAppSettings((s) => s.setGeneral);
  const showOnlineAvatars = useAppSettings((s) => s.git.showOnlineAvatars);
  const commitsOnlyHead = useAppSettings((s) => s.git.commitsOnlyHead);
  const commitsHistoryOrder = useAppSettings((s) => s.git.commitsHistoryOrder);
  const workingFilesView = useAppSettings((s) => s.git.workingFilesView);
  const diffTool = useAppSettings((s) => s.git.diffTool);
  const fetchAfterOpenRepo = useAppSettings((s) => s.git.fetchAfterOpenRepo);
  const autoFetchMinutes = useAppSettings((s) => s.git.autoFetchMinutes);
  const autoRefreshMinutes = useAppSettings((s) => s.git.autoRefreshMinutes);
  const tooltipSettings = useAppSettings((s) => s.general.tooltips);
  const showToolbarShortcutHints = useAppSettings((s) => s.general.showToolbarShortcutHints);
  const shortcutBindings = useAppSettings((s) => s.shortcuts.bindings);
  const quickButtons = useAppSettings((s) => s.quickButtons);
  const setQuickButtons = useAppSettings((s) => s.setQuickButtons);

  useEffect(() => {
    if (!quickButtons.includes("pull")) setPullMenuOpen(false);
    if (!quickButtons.includes("terminal")) setTerminalMenuOpen(false);
  }, [quickButtons]);

  const shortcutPlatform = useMemo(() => detectAppPlatform(), []);

  const shortcutLabel = (id: ShortcutActionId): string => {
    const spec = shortcutBindings[id] ?? "";
    return formatShortcutSpecForDisplay(spec, shortcutPlatform);
  };

  const shortcutPairLabel = (a: ShortcutActionId, b: ShortcutActionId): string => {
    const sa = shortcutBindings[a] ?? "";
    const sb = shortcutBindings[b] ?? "";
    return joinShortcutDisplay(sa, sb, shortcutPlatform);
  };

  const isMacOS = useMemo(() => {
    const ua = (navigator?.userAgent ?? "").toLowerCase();
    const isAppleMobile = ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod");
    return !isAppleMobile && (ua.includes("mac os") || ua.includes("macintosh"));
  }, []);

  const viewMode = activeRepoPath ? (viewModeByRepo[activeRepoPath] ?? defaultViewMode) : defaultViewMode;

  const setViewModeForRepo = (repoPath: string, next: "graph" | "commits") => {
    if (!repoPath) return;
    setViewModeByRepo((prev) => ({ ...prev, [repoPath]: next }));
  };

  const setViewMode = (next: "graph" | "commits") => {
    if (!activeRepoPath) return;
    setViewModeForRepo(activeRepoPath, next);
  };

  const [selectedHash, setSelectedHash] = useState<string>("");
  const [detailsTab, setDetailsTab] = useState<"details" | "changes">("details");
  const [showChangesOpen, setShowChangesOpen] = useState(false);
  const [showChangesCommit, setShowChangesCommit] = useState("");

  const error = activeRepoPath ? ((errorByRepo[activeRepoPath] ?? "") || globalError) : globalError;
  function setError(msg: string) {
    const m = msg ?? "";
    if (activeRepoPath) {
      setErrorByRepo((prev) => ({ ...prev, [activeRepoPath]: m }));
      return;
    }
    setGlobalError(m);
  }

  const { openTerminalProfile, openActiveRepoInExplorer } = useSystemHelpers({
    activeRepoPath,
    terminalSettings,
    setError,
  });

  const pullError = activeRepoPath ? (pullErrorByRepo[activeRepoPath] ?? "") : "";
  function setPullError(msg: string) {
    if (!activeRepoPath) return;
    const m = msg ?? "";
    setPullErrorByRepo((prev) => ({ ...prev, [activeRepoPath]: m }));
  }

  const { loadRepo } = useRepoLoader({
    activeRepoPath,
    commitsFullByRepo,
    commitsOnlyHead,
    commitsHistoryOrder,

    setLoading,
    setError,
    setSelectedHash,

    setCommitsByRepo,
    setCommitsHasMoreByRepo,
    setOverviewByRepo,
    setStatusSummaryByRepo,
    setRemoteUrlByRepo,
    setAheadBehindByRepo,
    setStashesByRepo,

    setGitTrustRepoPath,
    setGitTrustDetails,
    setGitTrustDetailsOpen,
    setGitTrustActionError,
    setGitTrustOpen,
  });

  const {
    commitModalOpen,
    setCommitModalOpen,
    statusEntries,
    selectedPaths,
    setSelectedPaths,
    commitMessage,
    setCommitMessage,
    commitAlsoPush,
    setCommitAlsoPush,
    commitBusy,
    commitError,
    setCommitError,
    commitPreviewPath,
    setCommitPreviewPath,
    setCommitPreviewStatus,
    commitPreviewDiff,
    commitPreviewContent,
    commitPreviewImageBase64,
    commitPreviewLoading,
    commitPreviewError,

    commitAdvancedMode,
    commitHunksByPath,
    setCommitHunksByPath,
    commitHunkRanges,

    refreshCommitStatusEntries,
    openCommitDialog,
    toggleAdvancedMode: toggleCommitAdvancedMode,
    runCommit,
  } = useCommitController({
    activeRepoPath,
    headName: overviewByRepo[activeRepoPath]?.head_name ?? "",
    diffTool,
    loadRepo: async (repoPath) => loadRepo(repoPath),
    setStatusSummaryByRepo,
  });

  const { openRepository, closeRepository } = useRepoOpenClose({
    defaultViewMode,
    repos,
    activeRepoPath,

    setGlobalError,
    setErrorByRepo,
    setPullErrorByRepo,
    setSelectedHash,
    setLoading,

    setViewModeByRepo,
    setRepos,
    setActiveRepoPath,

    setOverviewByRepo,
    setCommitsByRepo,
    setCommitsFullByRepo,
    setCommitsFullLoadingByRepo,
    setCommitsHasMoreByRepo,
    setRemoteUrlByRepo,
    setStatusSummaryByRepo,
    setAheadBehindByRepo,
    setStashesByRepo,

    setGitTrustRepoPath,
    setGitTrustDetails,
    setGitTrustDetailsOpen,
    setGitTrustActionError,
    setGitTrustOpen,

    loadRepo,
  });

  const autoFetchInFlightRef = useRef(false);
  const autoRefreshInFlightRef = useRef(false);

  async function runFetchBackground(repoPath: string) {
    if (!repoPath) return;
    if (autoFetchInFlightRef.current) return;
    autoFetchInFlightRef.current = true;
    try {
      const remote = await gitGetRemoteUrl(repoPath, "origin").catch(() => null);
      if (!remote) return;
      await gitFetch(repoPath, "origin");
      await loadRepo(repoPath, undefined, false);
    } catch (e) {
      const msg = typeof e === "string" ? e : JSON.stringify(e);
      if (repoPath === activeRepoPath) setError(msg);
    } finally {
      autoFetchInFlightRef.current = false;
    }
  }

  async function openRepositoryWithAutoFetch(path: string) {
    await openRepository(path);
    if (fetchAfterOpenRepo) {
      void runFetchBackground(path);
    }
  }

  const closeAllRepositories = useCallback(async () => {
    const list = [...repos];
    for (const p of list) {
      await closeRepository(p);
    }
  }, [closeRepository, repos]);

  useEffect(() => {
    return installTestBackdoor({
      openRepository,
      closeAllRepositories,
      setViewModeForRepo,
      resetSettings,
    });
  }, [closeAllRepositories, openRepository, resetSettings, setViewModeForRepo]);

  const lastSidebarWidthRef = useRef<number>(280);
  const lastDetailsHeightRef = useRef<number>(280);

  function setSidebarVisible(visible: boolean) {
    if (visible) {
      const w = Number.isFinite(lastSidebarWidthRef.current) ? lastSidebarWidthRef.current : 280;
      setLayout({ sidebarWidthPx: Math.max(200, Math.round(w || 280)) });
      return;
    }
    if (layout.sidebarWidthPx > 0) {
      lastSidebarWidthRef.current = layout.sidebarWidthPx;
    }
    setLayout({ sidebarWidthPx: 0 });
  }

  function setDetailsVisible(visible: boolean) {
    if (visible) {
      const h = Number.isFinite(lastDetailsHeightRef.current) ? lastDetailsHeightRef.current : 280;
      setLayout({ detailsHeightPx: Math.max(160, Math.round(h || 280)) });
      return;
    }
    if (layout.detailsHeightPx > 0) {
      lastDetailsHeightRef.current = layout.detailsHeightPx;
    }
    setLayout({ detailsHeightPx: 0 });
  }

  function startSidebarResize(e: ReactMouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = layout.sidebarWidthPx;
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onMove = (ev: MouseEvent) => {
      const min = 200;
      const max = 620;
      const next = Math.max(min, Math.min(max, Math.round(startW + (ev.clientX - startX))));
      setLayout({ sidebarWidthPx: next });
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function startDetailsResize(e: ReactMouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startH = layout.detailsHeightPx;
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "row-resize";

    const onMove = (ev: MouseEvent) => {
      const min = 160;
      const max = Math.max(min, window.innerHeight - 220);
      const next = Math.max(min, Math.min(max, Math.round(startH - (ev.clientY - startY))));
      setLayout({ detailsHeightPx: next });
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }
  const [commitContextMenu, setCommitContextMenu] = useState<{
    x: number;
    y: number;
    hash: string;
  } | null>(null);
  const [commitContextBranches, setCommitContextBranches] = useState<string[]>([]);
  const [commitContextBranchesLoading, setCommitContextBranchesLoading] = useState<boolean>(false);
  const commitContextMenuRef = useRef<HTMLDivElement | null>(null);
  const [stashContextMenu, setStashContextMenu] = useState<{
    x: number;
    y: number;
    stashRef: string;
    stashMessage: string;
  } | null>(null);
  const stashContextMenuRef = useRef<HTMLDivElement | null>(null);
  const [workingFileContextMenu, setWorkingFileContextMenu] = useState<{
    x: number;
    y: number;
    mode: "commit" | "stash";
    path: string;
    status: string;
  } | null>(null);
  const workingFileContextMenuRef = useRef<HTMLDivElement | null>(null);
  const [refBadgeContextMenu, setRefBadgeContextMenu] = useState<{
    x: number;
    y: number;
    kind: "branch" | "remote";
    label: string;
  } | null>(null);
  const refBadgeContextMenuRef = useRef<HTMLDivElement | null>(null);
  const [branchContextMenu, setBranchContextMenu] = useState<{
    x: number;
    y: number;
    branch: string;
  } | null>(null);
  const branchContextMenuRef = useRef<HTMLDivElement | null>(null);
  const [tagContextMenu, setTagContextMenu] = useState<{
    x: number;
    y: number;
    tag: string;
  } | null>(null);
  const tagContextMenuRef = useRef<HTMLDivElement | null>(null);

  const [avatarFailedByEmail, setAvatarFailedByEmail] = useState<Record<string, true>>({});

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.modalClose = modalClosePosition;
    document.documentElement.style.setProperty("--app-font-family", fontFamily);
    document.documentElement.style.setProperty("--app-font-size", `${fontSizePx}px`);
  }, [theme, modalClosePosition, fontFamily, fontSizePx]);

  useEffect(() => {
    if (!activeRepoPath) return;
    void loadRepo(activeRepoPath);
    for (const p of repos) {
      if (!p || p === activeRepoPath) continue;
      void loadRepo(p, undefined, false);
    }
  }, [commitsOnlyHead, commitsHistoryOrder, repos]);

  useEffect(() => {
    if (!terminalMenuOpen) return;
    const profiles = terminalSettings.profiles ?? [];
    const desired = terminalSettings.defaultProfileId;
    const idx = Math.max(0, profiles.findIndex((p) => p.id === desired));
    setTerminalMenuIndex(idx);
  }, [terminalMenuOpen, terminalSettings.defaultProfileId, terminalSettings.profiles]);

  useEffect(() => {
    if (!terminalMenuOpen) return;
    const root = terminalMenuRef.current;
    if (!root) return;

    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>("button[data-terminal-profile-id]"));
    if (buttons.length === 0) return;

    const idx = Math.max(0, Math.min(buttons.length - 1, terminalMenuIndex));
    buttons[idx]?.focus();
  }, [terminalMenuIndex, terminalMenuOpen]);

  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    window.addEventListener("contextmenu", onContextMenu);
    return () => {
      window.removeEventListener("contextmenu", onContextMenu);
    };
  }, []);

  useEffect(() => {
    if (!commitContextMenu && !tagContextMenu && !stashContextMenu && !branchContextMenu && !refBadgeContextMenu && !workingFileContextMenu) return;

    const onMouseDown = (e: MouseEvent) => {
      const commitEl = commitContextMenuRef.current;
      const stashEl = stashContextMenuRef.current;
      const branchEl = branchContextMenuRef.current;
      const tagEl = tagContextMenuRef.current;
      const refBadgeEl = refBadgeContextMenuRef.current;
      const fileEl = workingFileContextMenuRef.current;
      if (e.target instanceof Node) {
        if (commitEl && commitEl.contains(e.target)) return;
        if (stashEl && stashEl.contains(e.target)) return;
        if (branchEl && branchEl.contains(e.target)) return;
        if (tagEl && tagEl.contains(e.target)) return;
        if (refBadgeEl && refBadgeEl.contains(e.target)) return;
        if (fileEl && fileEl.contains(e.target)) return;
      }
      setCommitContextMenu(null);
      setStashContextMenu(null);
      setBranchContextMenu(null);
      setTagContextMenu(null);
      setRefBadgeContextMenu(null);
      setWorkingFileContextMenu(null);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setCommitContextMenu(null);
        setStashContextMenu(null);
        setBranchContextMenu(null);
        setTagContextMenu(null);
        setRefBadgeContextMenu(null);
        setWorkingFileContextMenu(null);
      }
    };

    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [commitContextMenu, tagContextMenu, stashContextMenu, branchContextMenu, refBadgeContextMenu, workingFileContextMenu]);

  useEffect(() => {
    if (!cloneModalOpen) return;

    let alive = true;
    let unlisten: (() => void) | null = null;
    void listen<GitCloneProgressEvent>("git_clone_progress", (event) => {
      const dest = cloneProgressDestRef.current;
      if (!dest) return;
      if (event.payload.destination_path !== dest) return;

      const pct = event.payload.percent;
      setCloneProgressPercent(typeof pct === "number" ? pct : null);
      setCloneProgressMessage(event.payload.message);
    }).then((fn) => {
      if (!alive) {
        fn();
        return;
      }
      unlisten = fn;
    });

    return () => {
      alive = false;
      if (unlisten) unlisten();
    };
  }, [cloneModalOpen]);

  const commitsAll = commitsByRepo[activeRepoPath] ?? [];

  const commitSearchAuthors = useMemo(() => {
    const set = new Set<string>();
    for (const c of commitsAll) {
      const a = (c.author ?? "").trim();
      if (a) set.add(a);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [commitsAll]);

  const commitSearchQuery = useMemo(() => commitSearchText.trim(), [commitSearchText]);
  const commitSearchQueryLower = useMemo(() => commitSearchQuery.toLowerCase(), [commitSearchQuery]);
  const commitSearchActive = commitSearchOpen && commitSearchQueryLower.length >= 3;

  const commitSearchFromTs = useMemo(() => {
    const t = commitSearchDateFrom.trim();
    if (!t) return null;
    const ts = new Date(`${t}T00:00:00.000`).getTime();
    return Number.isFinite(ts) ? ts : null;
  }, [commitSearchDateFrom]);

  const commitSearchToTs = useMemo(() => {
    const t = commitSearchDateTo.trim();
    if (!t) return null;
    const ts = new Date(`${t}T23:59:59.999`).getTime();
    return Number.isFinite(ts) ? ts : null;
  }, [commitSearchDateTo]);

  const commitsForList = useMemo(() => {
    if (!commitSearchActive) return commitsAll;

    const q = commitSearchQueryLower;
    const wantSubject = commitSearchInSubject;
    const wantHash = commitSearchInHash;
    const wantAuthor = commitSearchInAuthor;
    const wantDiff = commitSearchInDiff;
    const authorExact = commitSearchAuthorFilter.trim();
    const fromTs = commitSearchFromTs;
    const toTs = commitSearchToTs;

    const matchesDateAuthorScope = (c: GitCommit) => {
      if (authorExact && (c.author ?? "") !== authorExact) return false;
      if (fromTs !== null || toTs !== null) {
        const ts = Date.parse(c.date);
        if (Number.isFinite(ts)) {
          if (fromTs !== null && ts < fromTs) return false;
          if (toTs !== null && ts > toTs) return false;
        }
      }
      return true;
    };

    const filtered: GitCommit[] = [];
    for (const c of commitsAll) {
      if (!matchesDateAuthorScope(c)) continue;

      let match = false;
      if (wantSubject && (c.subject ?? "").toLowerCase().includes(q)) match = true;
      if (!match && wantHash && (c.hash ?? "").toLowerCase().includes(q)) match = true;
      if (!match && wantAuthor && (c.author ?? "").toLowerCase().includes(q)) match = true;
      if (!match && wantDiff && commitSearchDiffMatches[c.hash]) match = true;

      if (match) filtered.push(c);
    }
    return filtered;
  }, [
    commitSearchActive,
    commitSearchAuthorFilter,
    commitSearchDiffMatches,
    commitSearchFromTs,
    commitSearchInAuthor,
    commitSearchInDiff,
    commitSearchInHash,
    commitSearchInSubject,
    commitSearchQueryLower,
    commitSearchToTs,
    commitsAll,
  ]);

  useEffect(() => {
    if (!commitSearchOpen) return;
    if (activeRepoPath.trim() === "") return;

    const id = window.setTimeout(() => {
      const el = commitSearchInputRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.select();
    }, 0);
    return () => window.clearTimeout(id);
  }, [activeRepoPath, commitSearchOpen, viewMode]);

  useEffect(() => {
    if (!commitSearchOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeCommitSearch();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commitSearchOpen]);

  useEffect(() => {
    if (!commitSearchOpen) return;
    if (!commitSearchInDiff || !commitSearchActive) {
      setCommitSearchDiffBusy(false);
      setCommitSearchDiffMatches({});
      return;
    }

    let alive = true;
    setCommitSearchDiffBusy(true);
    setCommitSearchDiffMatches({});
    const q = commitSearchQueryLower;
    const fromTs = commitSearchFromTs;
    const toTs = commitSearchToTs;
    const authorExact = commitSearchAuthorFilter.trim();

    const candidates = commitsAll.filter((c) => {
      if (authorExact && (c.author ?? "") !== authorExact) return false;
      if (fromTs !== null || toTs !== null) {
        const ts = Date.parse(c.date);
        if (Number.isFinite(ts)) {
          if (fromTs !== null && ts < fromTs) return false;
          if (toTs !== null && ts > toTs) return false;
        }
      }
      return true;
    });

    const run = async () => {
      const cache = commitSearchDiffCacheRef.current;
      for (let idx = 0; idx < candidates.length; idx++) {
        if (!alive) return;

        const c = candidates[idx];
        const byQuery = cache.get(c.hash) ?? new Map<string, boolean>();
        cache.set(c.hash, byQuery);
        const cached = byQuery.get(q);
        if (typeof cached === "boolean") {
          if (cached) {
            setCommitSearchDiffMatches((prev) => (prev[c.hash] ? prev : { ...prev, [c.hash]: true }));
          }
          continue;
        }

        let matched = false;
        try {
          const changes = await gitCommitChanges({ repoPath: activeRepoPath, commit: c.hash });
          if (!alive) return;

          for (const ch of changes) {
            const p = `${ch.path ?? ""} ${ch.old_path ?? ""}`.toLowerCase();
            if (p.includes(q)) {
              matched = true;
              break;
            }
          }

          if (!matched) {
            const limit = 8;
            for (let i = 0; i < Math.min(limit, changes.length); i++) {
              const p = (changes[i]?.path ?? "").trim();
              if (!p) continue;
              const diff = await gitCommitFileDiff({ repoPath: activeRepoPath, commit: c.hash, path: p });
              if (!alive) return;
              if ((diff ?? "").toLowerCase().includes(q)) {
                matched = true;
                break;
              }
            }
          }
        } catch {
          matched = false;
        }

        byQuery.set(q, matched);
        if (matched) {
          setCommitSearchDiffMatches((prev) => (prev[c.hash] ? prev : { ...prev, [c.hash]: true }));
        }

        if (idx % 10 === 0) {
          await new Promise((r) => window.setTimeout(r, 0));
        }
      }
    };

    void run().finally(() => {
      if (!alive) return;
      setCommitSearchDiffBusy(false);
    });

    return () => {
      alive = false;
    };
  }, [
    activeRepoPath,
    commitSearchActive,
    commitSearchAuthorFilter,
    commitSearchFromTs,
    commitSearchInDiff,
    commitSearchOpen,
    commitSearchQueryLower,
    commitSearchToTs,
    commitsAll,
  ]);

  const commitLaneLayout = useMemo(() => {
    if (viewMode !== "commits") return { rows: [] as CommitLaneRow[], maxLanes: 0 };
    if (commitsAll.length === 0) return { rows: [] as CommitLaneRow[], maxLanes: 0 };
    return computeCommitLaneRows(commitsAll, commitsHistoryOrder);
  }, [commitsAll, commitsHistoryOrder, viewMode]);

  const commitLaneRowByHash = useMemo(() => {
    const m = new Map<string, CommitLaneRow>();
    for (const r of commitLaneLayout.rows) m.set(r.hash, r);
    return m;
  }, [commitLaneLayout.rows]);

  function parseRefs(
    refs: string,
    remoteNames: string[],
  ): Array<{ kind: "head" | "branch" | "tag" | "remote"; label: string }> {
    const parts = refs
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    const out: Array<{ kind: "head" | "branch" | "tag" | "remote"; label: string }> = [];

    const remotePrefixes = (remoteNames ?? [])
      .map((r) => r.trim())
      .filter((r) => r.length > 0);

    const isRemoteRef = (label: string) => {
      const t = label.trim();
      if (!t) return false;
      return remotePrefixes.some((r) => t.startsWith(`${r}/`));
    };

    for (const part of parts) {
      if (part.startsWith("tag: ")) {
        const label = part.slice("tag: ".length).trim();
        if (label) out.push({ kind: "tag", label });
        continue;
      }

      if (part.includes(" -> ")) {
        const [leftRaw, rightRaw] = part.split(" -> ", 2);
        const left = leftRaw.trim();
        const right = rightRaw.trim();
        if (left === "HEAD") {
          out.push({ kind: "head", label: "HEAD" });
        } else if (left.endsWith("/HEAD")) {
          out.push({ kind: "remote", label: left });
        } else if (left) {
          out.push({ kind: isRemoteRef(left) ? "remote" : "branch", label: left });
        }
        if (right) {
          out.push({ kind: isRemoteRef(right) ? "remote" : "branch", label: right });
        }
        continue;
      }

      if (part === "HEAD") {
        out.push({ kind: "head", label: "HEAD" });
        continue;
      }

      out.push({ kind: isRemoteRef(part) ? "remote" : "branch", label: part });
    }

    return out;
  }

  const commitLanePalette = useMemo(() => getCyPalette(theme), [theme]);
  const commitLaneNodeBg = commitLanePalette.nodeBg;

  const confirmDialog = (opts: { title: string; message: string; okLabel?: string; cancelLabel?: string }) => {
    const { title, message, okLabel, cancelLabel } = opts;
    setConfirmTitle(title);
    setConfirmMessage(message);
    setConfirmOkLabel(okLabel ?? "OK");
    setConfirmCancelLabel(cancelLabel ?? "Cancel");
    setConfirmOpen(true);
    return new Promise<boolean>((resolve) => {
      confirmResolveRef.current = resolve;
    });
  };

  const resolveConfirm = (v: boolean) => {
    setConfirmOpen(false);
    const r = confirmResolveRef.current;
    confirmResolveRef.current = null;
    if (r) r(v);
  };

  const {
    trustRepoGloballyAndOpen,
    trustRepoForSessionAndOpen,
    changeOwnershipAndOpen,
    revealRepoInExplorerFromTrustDialog,
    openTerminalFromTrustDialog,
    closeTrustDialogAndRepoIfOpen,
  } = useGitTrustActions({
    repos,
    openRepository,
    closeRepository,
    confirmDialog,
    openTerminalProfile,
    gitTrustRepoPath,
    currentUsername,
    setGitTrustOpen,
    setGitTrustBusy,
    setGitTrustActionError,
  });

  const overview = overviewByRepo[activeRepoPath];
  const remoteUrl = remoteUrlByRepo[activeRepoPath] ?? null;
  const changedCount = statusSummaryByRepo[activeRepoPath]?.changed ?? 0;
  const aheadCount = aheadBehindByRepo[activeRepoPath]?.ahead ?? 0;
  const behindCount = aheadBehindByRepo[activeRepoPath]?.behind ?? 0;
  const tagsToPush = tagsToPushByRepo[activeRepoPath];
  const pushTagsCount = (tagsToPush?.newTags?.length ?? 0) + (tagsToPush?.movedTags?.length ?? 0);
  const unsyncedTagNames = useMemo(() => {
    const a = tagsToPush?.newTags ?? [];
    const b = tagsToPush?.movedTags ?? [];
    return [...a, ...b];
  }, [tagsToPush?.movedTags, tagsToPush?.newTags]);
  const indicatorsUpdating = indicatorsUpdatingByRepo[activeRepoPath] ?? false;
  const stashes = stashesByRepo[activeRepoPath] ?? [];

  const {
    stashModalOpen,
    setStashModalOpen,
    stashStatusEntries,
    setStashSelectedPaths,
    stashSelectedPaths,
    stashMessage,
    setStashMessage,
    stashBusy,
    stashError,
    setStashError,

    stashPreviewPath,
    setStashPreviewPath,
    setStashPreviewStatus,
    stashHunkRanges,
    stashHunksByPath,
    setStashHunksByPath,
    stashPreviewLoading,
    stashPreviewError,
    stashPreviewImageBase64,
    stashPreviewDiff,
    stashPreviewContent,

    stashAdvancedMode,
    toggleAdvancedMode,
    runStash,

    stashViewOpen,
    stashViewRef,
    stashViewMessage,
    stashViewPatch,
    stashViewLoading,
    stashViewError,
    setStashViewOpen,
    applyStashFromView,
    dropStashFromView,

    stashBaseByRepo,
    openStashDialog,
    openStashView,
    applyStashByRef,
    dropStashByRef,
    clearAllStashes,
    refreshStashStatusEntries,
  } = useStashController({
    activeRepoPath,
    stashes,
    viewMode,
    showStashesOnGraph: graphSettings.showStashesOnGraph,
    diffTool,
    loadRepo: async (repoPath) => loadRepo(repoPath),
    setLoading,
    setError,
    setStatusSummaryByRepo,
  });

  const {
    filePreviewOpen,
    setFilePreviewOpen,
    filePreviewPath,
    filePreviewMode,
    filePreviewDiff,
    filePreviewContent,
    filePreviewImageBase64,
    filePreviewLoading,
    filePreviewError,
    openFilePreview,
    openPullPredictConflictPreview,
  } = useFilePreviewController({
    activeRepoPath,
    diffTool,
  });

  const headHash = useMemo(() => {
    return overview?.head || commitsAll.find((c) => c.is_head)?.hash || "";
  }, [commitsAll, overview?.head]);

  useEffect(() => {
    shortcutRuntimeRef.current = {
      shortcutBindings,
      activeRepoPath,
      remoteUrl,
      loading,
      pullBusy,
      viewMode,
      selectedHash,
      headHash,
      layout,
      graphSettings,
      showOnlineAvatars,
      commitsOnlyHead,
      tooltipSettings,
      terminalSettings,
      terminalMenuOpen,
      terminalMenuIndex,

      repositoryMenuOpen,
      navigateMenuOpen,
      viewMenuOpen,
      commandsMenuOpen,
      toolsMenuOpen,
      pullMenuOpen,

      gitTrustOpen,
      diffToolModalOpen,
      cleanOldBranchesOpen,
      settingsOpen,
      quickButtonsModalOpen,
      goToOpen,
      confirmOpen,
      cloneModalOpen,
      commitModalOpen,
      stashModalOpen,
      stashViewOpen,
      remoteModalOpen,
      pushModalOpen,
      resetModalOpen,
      createBranchOpen,
      createTagOpen,
      renameBranchOpen,
      renameTagOpen,
      switchBranchOpen,
      pullConflictOpen,
      pullPredictOpen,
      filePreviewOpen,
      detachedHelpOpen,
      cherryStepsOpen,
      previewZoomSrc,

      commitContextMenu,
      stashContextMenu,
      branchContextMenu,
      tagContextMenu,
      refBadgeContextMenu,
      workingFileContextMenu,

      moveActiveRepoBy,
      setSidebarVisible,
      setDetailsVisible,
      setViewMode,
      setTerminalMenuOpen,
      setTerminalMenuIndex,
      setPullMenuOpen,
      setTerminal,
      setDiffToolModalOpen,
      setGraph,
      setGit,
      setGeneral,
      setGraphButtonsVisible,

      setGoToOpen,
      setGoToKind,
      setGoToText,
      setGoToTargetView,
      setGoToError,

      openCommitDialog,
      openPushDialog,
      openStashDialog,
      openSwitchBranchDialog,
      openCreateBranchDialog,
      openCreateTagDialog,
      openResetDialog,
      openCherryPickDialog,
      pickRepository,
      initializeProject,
      loadRepo,
      runFetch,
      openTerminalProfile,
      openCommitSearch,
    };
  }, [
    shortcutBindings,
    activeRepoPath,
    remoteUrl,
    loading,
    pullBusy,
    viewMode,
    selectedHash,
    headHash,
    layout,
    graphSettings,
    showOnlineAvatars,
    commitsOnlyHead,
    tooltipSettings,
    terminalSettings,
    terminalMenuOpen,
    terminalMenuIndex,
    repositoryMenuOpen,
    navigateMenuOpen,
    viewMenuOpen,
    commandsMenuOpen,
    toolsMenuOpen,
    pullMenuOpen,
    gitTrustOpen,
    diffToolModalOpen,
    cleanOldBranchesOpen,
    settingsOpen,
    goToOpen,
    confirmOpen,
    cloneModalOpen,
    commitModalOpen,
    stashModalOpen,
    stashViewOpen,
    remoteModalOpen,
    pushModalOpen,
    resetModalOpen,
    createBranchOpen,
    createTagOpen,
    renameBranchOpen,
    renameTagOpen,
    switchBranchOpen,
    pullConflictOpen,
    pullPredictOpen,
    filePreviewOpen,
    detachedHelpOpen,
    cherryStepsOpen,
    previewZoomSrc,
    commitContextMenu,
    stashContextMenu,
    branchContextMenu,
    tagContextMenu,
    refBadgeContextMenu,
    workingFileContextMenu,
    moveActiveRepoBy,
    setSidebarVisible,
    setDetailsVisible,
    setViewMode,
    setTerminalMenuOpen,
    setTerminalMenuIndex,
    setPullMenuOpen,
    setTerminal,
    setDiffToolModalOpen,
    setGraph,
    setGit,
    setGeneral,
    setGraphButtonsVisible,
    setGoToOpen,
    setGoToKind,
    setGoToText,
    setGoToTargetView,
    setGoToError,
    openCommitDialog,
    openPushDialog,
    openStashDialog,
    openSwitchBranchDialog,
    openCreateBranchDialog,
    openCreateTagDialog,
    openResetDialog,
    openCherryPickDialog,
    pickRepository,
    initializeProject,
    loadRepo,
    runFetch,
    openTerminalProfile,
    openCommitSearch,
  ]);

  const findTopModalOverlayForFocus = () => {
    const dialogs = Array.from(
      document.querySelectorAll<HTMLElement>("[role='dialog'][aria-modal='true'], .modalOverlay[aria-modal='true'], .modalOverlay")
    );
    if (dialogs.length === 0) return null;

    const visible = dialogs.filter((el) => {
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
      return el.getClientRects().length > 0;
    });
    const list = visible.length > 0 ? visible : dialogs;
    return list[list.length - 1] ?? null;
  };

  const anyModalOpenForFocus =
    !!gitTrustOpen ||
    !!diffToolModalOpen ||
    !!cleanOldBranchesOpen ||
    !!settingsOpen ||
    !!quickButtonsModalOpen ||
    !!goToOpen ||
    !!confirmOpen ||
    !!cloneModalOpen ||
    !!commitModalOpen ||
    !!stashModalOpen ||
    !!stashViewOpen ||
    !!remoteModalOpen ||
    !!pushModalOpen ||
    !!resetModalOpen ||
    !!createBranchOpen ||
    !!createTagOpen ||
    !!renameBranchOpen ||
    !!renameTagOpen ||
    !!switchBranchOpen ||
    !!pullConflictOpen ||
    !!pullPredictOpen ||
    !!filePreviewOpen ||
    !!detachedHelpOpen ||
    !!cherryStepsOpen ||
    !!previewZoomSrc;

  useEffect(() => {
    if (!anyModalOpenForFocus) return;
    const id = window.setTimeout(() => {
      const overlay = findTopModalOverlayForFocus();
      if (!overlay) return;

      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (active && overlay.contains(active) && active !== document.body && active !== document.documentElement) return;

      overlay.tabIndex = -1;
      overlay.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(id);
  }, [anyModalOpenForFocus]);

  useEffect(() => {
    const onMouseDownCapture = (ev: MouseEvent) => {
      const overlay = findTopModalOverlayForFocus();
      if (!overlay) return;

      const target = ev.target instanceof HTMLElement ? ev.target : null;
      if (!target) return;
      if (!overlay.contains(target)) return;

      if (target.closest("input,textarea,select,button,a,[tabindex],[contenteditable='true']")) return;

      overlay.tabIndex = -1;
      overlay.focus({ preventScroll: true });
    };

    document.addEventListener("mousedown", onMouseDownCapture, true);
    return () => document.removeEventListener("mousedown", onMouseDownCapture, true);
  }, []);

  const isDetached = overview?.head_name === "(detached)";
  const activeBranchName = !isDetached ? (overview?.head_name ?? "") : "";

  const cherryPickBranchOptions = useMemo(() => {
    return normalizeBranchList(overview?.branches ?? []);
  }, [overview?.branches]);

  const cleanOldBranchesCandidates = useMemo(() => {
    const days = Number.isFinite(cleanOldBranchesDays) ? Math.max(0, Math.floor(cleanOldBranchesDays)) : 0;
    const now = Date.now();

    const rows = (cleanOldBranchesAll ?? [])
      .filter((b) => b.kind === "local")
      .map((b) => {
        const dt = new Date(b.committer_date);
        const time = dt.getTime();
        const valid = Number.isFinite(time);
        const daysOld = valid ? Math.max(0, Math.floor((now - time) / 86_400_000)) : null;
        return {
          name: b.name,
          committer_date: b.committer_date,
          daysOld,
        };
      })
      .filter((r) => r.name.trim() && r.daysOld !== null)
      .filter((r) => normalizeBranchName(r.name) !== normalizeBranchName(activeBranchName))
      .filter((r) => (r.daysOld ?? 0) >= days)
      .sort((a, b) => (b.daysOld ?? 0) - (a.daysOld ?? 0));

    return rows;
  }, [activeBranchName, cleanOldBranchesAll, cleanOldBranchesDays]);

  const cleanOldBranchesSelectedCount = useMemo(() => {
    let n = 0;
    for (const r of cleanOldBranchesCandidates) {
      if (cleanOldBranchesSelected[r.name]) n++;
    }
    return n;
  }, [cleanOldBranchesCandidates, cleanOldBranchesSelected]);

  useEffect(() => {
    if (!cleanOldBranchesOpen) return;

    setCleanOldBranchesSelected((prev) => {
      const next: Record<string, boolean> = {};
      for (const r of cleanOldBranchesCandidates) {
        const k = r.name;
        next[k] = prev[k] ?? true;
      }
      return next;
    });
  }, [cleanOldBranchesCandidates, cleanOldBranchesOpen]);

  useEffect(() => {
    if (!commitContextMenu || !activeRepoPath || !isDetached) {
      setCommitContextBranches([]);
      setCommitContextBranchesLoading(false);
      return;
    }

    let alive = true;
    setCommitContextBranches([]);
    setCommitContextBranchesLoading(true);
    void gitBranchesPointsAt({ repoPath: activeRepoPath, commit: commitContextMenu.hash })
      .then((branches) => {
        if (!alive) return;
        const next = Array.isArray(branches) ? branches : [];
        setCommitContextBranches(normalizeBranchList(next));
        setCommitContextBranchesLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setCommitContextBranches([]);
        setCommitContextBranchesLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [commitContextMenu?.hash, activeRepoPath, isDetached]);

  useEffect(() => {
    if (!createBranchOpen || !activeRepoPath) {
      setCreateBranchCommitSummary(null);
      setCreateBranchCommitError("");
      setCreateBranchCommitLoading(false);
      return;
    }

    const at = createBranchAt.trim();
    if (!at) {
      setCreateBranchCommitSummary(null);
      setCreateBranchCommitError("No commit selected.");
      setCreateBranchCommitLoading(false);
      return;
    }

    let alive = true;
    setCreateBranchCommitSummary(null);
    setCreateBranchCommitError("");
    setCreateBranchCommitLoading(true);

    const timer = window.setTimeout(() => {
      void gitCommitSummary({ repoPath: activeRepoPath, commit: at })
        .then((s) => {
          if (!alive) return;
          setCreateBranchCommitSummary(s);
          setCreateBranchCommitLoading(false);
        })
        .catch((e) => {
          if (!alive) return;
          setCreateBranchCommitSummary(null);
          setCreateBranchCommitError(typeof e === "string" ? e : JSON.stringify(e));
          setCreateBranchCommitLoading(false);
        });
    }, 250);

    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [createBranchOpen, activeRepoPath, createBranchAt]);

  function normalizeBranchName(name: string) {
    let t = name.trim();
    if (t.startsWith("* ")) t = t.slice(2).trim();
    return t;
  }

  function isSelectableTargetBranch(name: string) {
    const t = normalizeBranchName(name);
    if (!t) return false;
    if (t === "(detached)") return false;
    if (t.includes("HEAD detached")) return false;
    if (t.includes("(HEAD detached")) return false;
    if (t.includes("detached at ")) return false;
    if (t.includes("detached from ")) return false;
    if (t.includes("(detached")) return false;
    if (t.startsWith("(") && t.endsWith(")")) return false;
    return true;
  }

  function normalizeBranchList(list: string[]) {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of list) {
      const t = normalizeBranchName(raw);
      if (!isSelectableTargetBranch(t)) continue;
      if (seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
    return out;
  }

  const detachedBranchOptions = useMemo(() => {
    const preferred = normalizeBranchList(detachedPointsAtBranches);
    if (preferred.length > 0) return preferred;
    return normalizeBranchList(overview?.branches ?? []);
  }, [detachedPointsAtBranches, overview?.branches]);

  function togglePreviewZoom(src: string) {
    setPreviewZoomSrc((prev) => (prev === src ? null : src));
  }

  function pickPreferredBranch(branches: string[]) {
    const preferred = ["main", "master", "develop"];
    for (const p of preferred) {
      if (branches.includes(p)) return p;
    }
    return branches[0] ?? "";
  }

  useEffect(() => {
    if (!activeRepoPath || !isDetached || !headHash) {
      setDetachedPointsAtBranches([]);
      setDetachedTargetBranch("");
      return;
    }

    let alive = true;
    void gitBranchesPointsAt({ repoPath: activeRepoPath, commit: headHash })
      .then((branches) => {
        if (!alive) return;
        const next = Array.isArray(branches) ? branches : [];
        setDetachedPointsAtBranches(next);

        const preferred = normalizeBranchList(next);
        const fallback = normalizeBranchList(overview?.branches ?? []);
        const options = preferred.length > 0 ? preferred : fallback;
        setDetachedTargetBranch((prev) => {
          if (prev && options.includes(prev)) return prev;
          return pickPreferredBranch(options);
        });
      })
      .catch((e) => {
        if (!alive) return;
        setDetachedPointsAtBranches([]);
        setDetachedTargetBranch(pickPreferredBranch(normalizeBranchList(overview?.branches ?? [])));
        setDetachedError(typeof e === "string" ? e : JSON.stringify(e));
      });

    return () => {
      alive = false;
    };
  }, [activeRepoPath, isDetached, headHash, overview?.branches]);

  useEffect(() => {
    if (!previewZoomSrc) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreviewZoomSrc(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewZoomSrc]);

  function joinPath(base: string, child: string) {
    const a = base.trim().replace(/[\\/]+$/, "");
    const b = child.trim().replace(/^[\\/]+/, "");
    if (!a) return b;
    if (!b) return a;
    const sep = a.includes("\\") ? "\\" : "/";
    return `${a}${sep}${b}`;
  }

  const cloneTargetPath = useMemo(() => {
    const base = cloneDestinationFolder.trim();
    if (!base) return "";
    const name = cloneSubdirName.trim();
    if (!name) return base;
    return joinPath(base, name);
  }, [cloneDestinationFolder, cloneSubdirName]);

  const selectedCommit = useMemo(() => {
    if (!selectedHash) return undefined;
    return commitsAll.find((c) => c.hash === selectedHash);
  }, [commitsAll, selectedHash]);

  const tagsExpanded = activeRepoPath ? (tagsExpandedByRepo[activeRepoPath] ?? false) : false;
  const stashChangedCount = changedCount;

  function openCommitContextMenu(hash: string, x: number, y: number) {
    const menuW = 260;
    const menuH = 460;
    const maxX = Math.max(0, window.innerWidth - menuW);
    const maxY = Math.max(0, window.innerHeight - menuH);
    setCommitContextMenu({
      hash,
      x: Math.min(Math.max(0, x), maxX),
      y: Math.min(Math.max(0, y), maxY),
    });
  }

  function openRefBadgeContextMenu(kind: "branch" | "remote", label: string, x: number, y: number) {
    const menuW = 260;
    const menuH = 110;
    const maxX = Math.max(0, window.innerWidth - menuW);
    const maxY = Math.max(0, window.innerHeight - menuH);
    setRefBadgeContextMenu({
      kind,
      label,
      x: Math.min(Math.max(0, x), maxX),
      y: Math.min(Math.max(0, y), maxY),
    });
  }

  function openBranchContextMenu(branch: string, x: number, y: number) {
    const menuW = 260;
    const menuH = 150;
    const maxX = Math.max(0, window.innerWidth - menuW);
    const maxY = Math.max(0, window.innerHeight - menuH);
    setBranchContextMenu({
      branch,
      x: Math.min(Math.max(0, x), maxX),
      y: Math.min(Math.max(0, y), maxY),
    });
  }

  function openWorkingFileContextMenu(mode: "commit" | "stash", path: string, status: string, x: number, y: number) {
    const menuW = 320;
    const menuH = 280;
    const maxX = Math.max(0, window.innerWidth - menuW);
    const maxY = Math.max(0, window.innerHeight - menuH);
    setWorkingFileContextMenu({
      mode,
      path,
      status,
      x: Math.min(Math.max(0, x), maxX),
      y: Math.min(Math.max(0, y), maxY),
    });
  }

  async function discardWorkingFile(mode: "commit" | "stash", path: string, status: string) {
    if (!activeRepoPath) return;
    if (mode === "commit" ? commitBusy : stashBusy) return;
    const isUntracked = status.trim().startsWith("??");
    const ok = await confirmDialog({
      title: isUntracked ? "Delete untracked file" : "Discard changes",
      message: isUntracked
        ? `This will delete the untracked file from disk:\n\n${path}\n\nContinue?`
        : `This will discard all changes (and unstage) for:\n\n${path}\n\nContinue?`,
      okLabel: isUntracked ? "Delete" : "Discard",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    try {
      await gitDiscardWorkingPath({ repoPath: activeRepoPath, path, isUntracked });
      if (mode === "commit") await refreshCommitStatusEntries();
      else await refreshStashStatusEntries();
    } catch (e) {
      const msg = typeof e === "string" ? e : JSON.stringify(e);
      if (mode === "commit") setCommitError(msg);
      else setStashError(msg);
    }
  }

  async function pushSingleTagToOrigin(tag: string) {
    if (!activeRepoPath) return;
    const t = tag.trim();
    if (!t) return;

    const currentRemote = await gitGetRemoteUrl(activeRepoPath, "origin").catch(() => null);
    if (!currentRemote) {
      setError("No remote origin set. Configure Remote first.");
      return;
    }

    const info = tagsToPushByRepo[activeRepoPath];
    const isMoved = (info?.movedTags ?? []).some((x) => x.trim() === t);

    let force = false;
    if (isMoved) {
      const ok = await confirmDialog({
        title: "Force push tag",
        message: `Tag '${t}' already exists on origin but points to a different commit.\n\nPush it with --force?`,
        okLabel: "Force push",
        cancelLabel: "Cancel",
      });
      if (!ok) return;
      force = true;
    }

    setLoading(true);
    setError("");
    try {
      await gitPushTags({ repoPath: activeRepoPath, remoteName: "origin", tags: [t], force });
      await loadRepo(activeRepoPath);
      await refreshIndicators(activeRepoPath);
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setLoading(false);
    }
  }

  async function mergeIntoCurrentBranch(reference: string) {
    if (!activeRepoPath) return;
    const ref = reference.trim();
    if (!ref) return;

    setPullBusy(true);
    setPullError("");
    setError("");
    try {
      const res = await gitMergeBranch({ repoPath: activeRepoPath, branch: ref });

      if (res.status === "conflicts") {
        const nextOp = res.operation === "rebase" ? "rebase" : "merge";
        setPullConflictOperation(nextOp);
        setPullConflictFiles(res.conflict_files || []);
        setPullConflictMessage(res.message || "");
        setPullConflictOpen(true);
        return;
      }

      if (res.status === "in_progress") {
        const nextOp = res.operation === "rebase" ? "rebase" : "merge";
        setPullConflictOperation(nextOp);
        setPullConflictFiles(res.conflict_files || []);
        setPullConflictMessage(res.message || "");
        await continueAfterConflicts();
        return;
      }

      await loadRepo(activeRepoPath);
      await refreshIndicators(activeRepoPath);
    } catch (e) {
      setPullError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setPullBusy(false);
    }
  }

  async function runCreateTag() {
    if (!activeRepoPath) return;
    const name = createTagName.trim();
    if (!name) {
      setCreateTagError("Tag name is empty.");
      return;
    }

    const at = createTagAt.trim() || "HEAD";
    const msg = createTagMessage;

    let pushForce = false;
    if (createTagPushToOrigin) {
      const currentRemote = await gitGetRemoteUrl(activeRepoPath, "origin").catch(() => null);
      if (!currentRemote) {
        setCreateTagError("No remote origin set. Configure Remote first.");
        return;
      }

      const resolvedTarget = await gitResolveRef({ repoPath: activeRepoPath, reference: at }).catch(() => "");
      const resolvedTargetTrimmed = resolvedTarget.trim();
      if (!resolvedTargetTrimmed) {
        setCreateTagError(`Cannot resolve target '${at}'.`);
        return;
      }

      const remoteTags = await gitListRemoteTagTargets({ repoPath: activeRepoPath, remoteName: "origin" });
      const remoteTarget = (remoteTags ?? [])
        .find((t) => (t?.name ?? "").trim() === name)
        ?.target?.trim();

      if (remoteTarget && remoteTarget !== resolvedTargetTrimmed) {
        const ok = await confirmDialog({
          title: "Force push tag",
          message: `Tag '${name}' already exists on origin but points to a different commit.\n\nPush it with --force?`,
          okLabel: "Force push",
          cancelLabel: "Cancel",
        });
        if (!ok) return;
        pushForce = true;
      }
    }

    setCreateTagBusy(true);
    setCreateTagError("");
    setError("");
    try {
      await gitCreateTag({
        repoPath: activeRepoPath,
        tag: name,
        target: at,
        annotated: createTagAnnotated,
        message: createTagAnnotated ? msg : undefined,
        force: createTagForce,
      });

      if (createTagPushToOrigin) {
        try {
          await gitPushTags({ repoPath: activeRepoPath, remoteName: "origin", tags: [name], force: pushForce });
        } catch (e) {
          const err = typeof e === "string" ? e : JSON.stringify(e);
          setCreateTagError(`Tag created locally, but push failed: ${err}`);
          await loadRepo(activeRepoPath);
          await refreshIndicators(activeRepoPath);
          return;
        }
      }

      setCreateTagOpen(false);
      await loadRepo(activeRepoPath);
      await refreshIndicators(activeRepoPath);
    } catch (e) {
      setCreateTagError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setCreateTagBusy(false);
    }
  }

  async function deleteWorkingFile(mode: "commit" | "stash", path: string) {
    if (!activeRepoPath) return;
    if (mode === "commit" ? commitBusy : stashBusy) return;
    const ok = await confirmDialog({
      title: "Delete file",
      message: `This will delete the file from disk:\n\n${path}\n\nContinue?`,
      okLabel: "Delete",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    try {
      await gitDeleteWorkingPath({ repoPath: activeRepoPath, path });
      if (mode === "commit") await refreshCommitStatusEntries();
      else await refreshStashStatusEntries();
    } catch (e) {
      const msg = typeof e === "string" ? e : JSON.stringify(e);
      if (mode === "commit") setCommitError(msg);
      else setStashError(msg);
    }
  }

  async function addToGitignore(mode: "commit" | "stash", pattern: string) {
    if (!activeRepoPath) return;
    if (mode === "commit" ? commitBusy : stashBusy) return;
    try {
      await gitAddToGitignore({ repoPath: activeRepoPath, pattern });
      if (mode === "commit") await refreshCommitStatusEntries();
      else await refreshStashStatusEntries();
    } catch (e) {
      const msg = typeof e === "string" ? e : JSON.stringify(e);
      if (mode === "commit") setCommitError(msg);
      else setStashError(msg);
    }
  }

  function openResetDialog() {
    setResetError("");
    setResetBusy(false);
    setResetMode("mixed");
    setResetTarget("HEAD~1");
    setResetModalOpen(true);
  }

  async function openCherryPickDialog() {
    if (!activeRepoPath) return;
    setCherryPickError("");
    setCherryPickBusy(false);
    setCherryPickAppendOrigin(false);
    setCherryPickNoCommit(false);

    setCherryPickTargetBranch(activeBranchName?.trim() ? activeBranchName.trim() : "");
    setCherryPickCommitHash(selectedHash?.trim() ? selectedHash.trim() : "");

    setCherryPickCommitLoading(false);
    setCherryPickCommitError("");
    setCherryPickCommitSummary(null);
    setCherryPickOpen(true);
  }

  async function openExportPatchDialog() {
    if (!activeRepoPath) return;
    const at = (selectedHash.trim() ? selectedHash.trim() : headHash.trim()).trim();
    if (!at) return;

    setPatchMode("export");
    setPatchError("");
    setPatchStatus("");
    setPatchBusy(false);
    setPatchPredictBusy(false);
    setPatchPredictError("");
    setPatchPredictResult(null);
    setPatchMethod("apply");
    setPatchPath("");
    setPatchOpen(true);
  }

  async function openApplyPatchDialog() {
    if (!activeRepoPath) return;
    setPatchMode("apply");
    setPatchError("");
    setPatchStatus("");
    setPatchBusy(false);
    setPatchPredictBusy(false);
    setPatchPredictError("");
    setPatchPredictResult(null);
    setPatchMethod("am");
    setPatchPath("");
    setPatchOpen(true);
  }

  async function pickPatchFile() {
    const selected = await open({ directory: false, multiple: false, title: "Select patch file" });
    if (!selected || Array.isArray(selected)) return;
    setPatchError("");
    setPatchStatus("");
    setPatchPredictError("");
    setPatchPredictResult(null);
    setPatchPath(selected);
  }

  async function pickSavePatchFile() {
    const selected = await save({
      title: "Save patch",
      filters: [{ name: "Patch", extensions: ["patch", "mbox", "txt"] }],
    });
    if (!selected) return;
    setPatchError("");
    setPatchStatus("");
    setPatchPath(selected);
  }

  async function predictPatch() {
    if (!activeRepoPath) return;
    if (patchMode !== "apply") return;
    const p = patchPath.trim();
    if (!p) {
      setPatchPredictError("Select a patch file.");
      return;
    }
    if (patchPredictBusy) return;

    setPatchPredictOpen(true);
    setPatchOpen(false);
    setPatchPredictBusy(true);
    setPatchPredictError("");
    setPatchPredictResult(null);
    try {
      const res = await gitPredictPatchGraph({ repoPath: activeRepoPath, patchPath: p, method: patchMethod, maxCommits: 60 });
      setPatchPredictResult(res);
    } catch (e) {
      setPatchPredictError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setPatchPredictBusy(false);
    }
  }

  async function runPatch() {
    if (!activeRepoPath) return;
    if (patchBusy) return;

    const p = patchPath.trim();
    if (!p) {
      setPatchError(patchMode === "export" ? "Select output file path." : "Select a patch file.");
      return;
    }

    setPatchBusy(true);
    setPatchError("");
    setPatchStatus("");
    setPatchPredictError("");
    setError("");

    try {
      if (patchMode === "export") {
        const at = (selectedHash.trim() ? selectedHash.trim() : headHash.trim()).trim();
        if (!at) {
          setPatchError("No commit selected.");
          return;
        }
        await gitFormatPatchToFile({ repoPath: activeRepoPath, commit: at, outPath: p });
        setPatchStatus("Patch exported.");
        setPatchOpen(false);
      } else {
        await gitApplyPatchFile({ repoPath: activeRepoPath, patchPath: p, method: patchMethod });
        setPatchStatus("Patch applied.");
        setPatchOpen(false);
        setPatchPredictOpen(false);
        await loadRepo(activeRepoPath);
        await refreshIndicators(activeRepoPath);
      }
    } catch (e) {
      const msg = typeof e === "string" ? e : JSON.stringify(e);

      if (patchMode === "apply" && patchMethod === "am") {
        try {
          const st = await gitConflictState(activeRepoPath);
          const op = (st.operation ?? "").trim();
          if (op === "am") {
            setPullConflictOperation("am");
            const stFiles = (st.files ?? []).map((f: any) => f.path).filter(Boolean);
            const parsedFiles = extractPatchFailurePaths(msg);
            const files = Array.from(new Set([...stFiles, ...parsedFiles].map((s) => (s ?? "").trim()).filter(Boolean)));
            setPullConflictFiles(files);
            setPullConflictMessage(humanizePatchApplyError(msg));
            setPullConflictOpen(true);
            setPatchPredictOpen(false);
            setPatchOpen(false);
            return;
          }
        } catch {
          // ignore
        }
      }

      const friendly = humanizePatchApplyError(msg);
      if (patchPredictOpen && patchMode === "apply") {
        setPatchPredictError(friendly);
      } else {
        setPatchError(friendly);
      }
    } finally {
      setPatchBusy(false);
    }
  }

  useEffect(() => {
    if (!cherryPickOpen || !activeRepoPath) {
      setCherryPickCommitSummary(null);
      setCherryPickCommitError("");
      setCherryPickCommitLoading(false);
      return;
    }

    const h = cherryPickCommitHash.trim();
    if (!h) {
      setCherryPickCommitSummary(null);
      setCherryPickCommitError("No commit selected.");
      setCherryPickCommitLoading(false);
      return;
    }

    let alive = true;
    setCherryPickCommitSummary(null);
    setCherryPickCommitError("");
    setCherryPickCommitLoading(true);

    const timer = window.setTimeout(() => {
      void gitCommitSummary({ repoPath: activeRepoPath, commit: h })
        .then((s) => {
          if (!alive) return;
          setCherryPickCommitSummary(s);
          setCherryPickCommitLoading(false);
        })
        .catch((e) => {
          if (!alive) return;
          setCherryPickCommitSummary(null);
          setCherryPickCommitError(typeof e === "string" ? e : JSON.stringify(e));
          setCherryPickCommitLoading(false);
        });
    }, 250);

    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [activeRepoPath, cherryPickCommitHash, cherryPickOpen]);

  async function runCherryPick() {
    if (!activeRepoPath) return;
    if (cherryPickBusy) return;

    const b = cherryPickTargetBranch.trim();
    const h = cherryPickCommitHash.trim();
    if (!b) {
      setCherryPickError("Target branch is empty.");
      return;
    }
    if (!h) {
      setCherryPickError("Commit hash is empty.");
      return;
    }

    setCherryPickBusy(true);
    setCherryPickError("");
    setError("");

    try {
      await gitCheckoutBranch({ repoPath: activeRepoPath, branch: b });

      if (!cherryPickAppendOrigin && !cherryPickNoCommit) {
        await gitCherryPick({ repoPath: activeRepoPath, commits: [h] });
      } else {
        await gitCherryPickAdvanced({ repoPath: activeRepoPath, commits: [h], appendOrigin: cherryPickAppendOrigin, noCommit: cherryPickNoCommit });
      }

      setCherryPickOpen(false);
      await loadRepo(activeRepoPath);
      await refreshIndicators(activeRepoPath);
    } catch (e) {
      const raw = typeof e === "string" ? e : JSON.stringify(e);

      // If cherry-pick entered conflict state, reuse the existing conflict UI.
      try {
        const st = await gitConflictState(activeRepoPath);
        const op = (st.operation ?? "").trim();
        if (op === "cherry-pick") {
          setPullConflictOperation("cherry-pick");
          setPullConflictFiles((st.files ?? []).map((f: any) => f.path).filter(Boolean));
          setPullConflictMessage(raw);
          setPullConflictOpen(true);
          return;
        }
      } catch {
        // ignore
      }

      setCherryPickError(raw);
    } finally {
      setCherryPickBusy(false);
    }
  }

  function openCreateBranchDialog(at: string) {
    setCreateBranchError("");
    setCreateBranchBusy(false);
    setCreateBranchName("");
    setCreateBranchAt(at.trim());
    setCreateBranchCheckout(true);
    setCreateBranchOrphan(false);
    setCreateBranchClearWorkingTree(false);
    setCreateBranchCommitLoading(false);
    setCreateBranchCommitError("");
    setCreateBranchCommitSummary(null);
    setCreateBranchOpen(true);
  }

  function openCreateTagDialog(at: string) {
    setCreateTagError("");
    setCreateTagBusy(false);
    setCreateTagName("");
    setCreateTagAt(at.trim());
    setCreateTagAnnotated(false);
    setCreateTagMessage("");
    setCreateTagForce(false);
    setCreateTagPushToOrigin(false);
    setCreateTagOpen(true);
  }

  async function runGitReset(mode: GitResetMode, target: string) {
    if (!activeRepoPath) return;
    const t = target.trim();
    if (!t) {
      setResetError("Enter a target commit (e.g. HEAD~1 or a commit hash).");
      return;
    }

    if (mode === "hard") {
      const ok = await confirmDialog({
        title: "Reset --hard",
        message:
          "This will discard commits after the target, as well as any uncommitted changes.\n\nRecovering committed changes can be hard (reflog). Uncommitted changes cannot be recovered.\n\nUse only if you know what you are doing. Continue?",
        okLabel: "Reset",
        cancelLabel: "Cancel",
      });
      if (!ok) return;
    }

    setResetBusy(true);
    setResetError("");
    setError("");
    try {
      await gitReset({ repoPath: activeRepoPath, mode, target: t });
      setResetModalOpen(false);
      await loadRepo(activeRepoPath);
    } catch (e) {
      setResetError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setResetBusy(false);
    }
  }

  async function checkoutRefBadgeLocalBranch(branch: string) {
    if (!activeRepoPath) return;
    const b = branch.trim();
    if (!b) return;
    setLoading(true);
    setError("");
    try {
      await gitSwitch({ repoPath: activeRepoPath, branch: b, create: false });
      await loadRepo(activeRepoPath);
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setLoading(false);
    }
  }

  async function checkoutRefBadgeRemoteBranch(remoteRef: string) {
    if (!activeRepoPath) return;
    const r = remoteRef.trim();
    if (!r) return;
    const localName = remoteRefToLocalName(r);
    if (!localName.trim()) return;
    setLoading(true);
    setError("");
    try {
      await gitSwitch({
        repoPath: activeRepoPath,
        branch: localName,
        create: true,
        force: true,
        startPoint: r,
        track: true,
      });
      await loadRepo(activeRepoPath);
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setLoading(false);
    }
  }

  function openRenameBranchDialog(oldName: string) {
    setRenameBranchError("");
    setRenameBranchBusy(false);
    setRenameBranchOld(oldName);
    setRenameBranchNew(oldName);
    setRenameBranchOpen(true);
  }

  async function openSwitchBranchDialog() {
    if (!activeRepoPath) return;
    setSwitchBranchError("");
    setSwitchBranchBusy(false);
    setSwitchBranchesError("");
    setSwitchBranchesLoading(true);
    setSwitchBranches([]);
    setSwitchBranchMode("local");
    setSwitchRemoteLocalMode("same");
    setSwitchRemoteLocalName("");
    setSwitchBranchName(activeBranchName.trim() ? activeBranchName.trim() : "");
    setSwitchBranchOpen(true);

    try {
      const list = await gitListBranches({ repoPath: activeRepoPath, includeRemote: true });
      setSwitchBranches(Array.isArray(list) ? list : []);
    } catch (e) {
      setSwitchBranches([]);
      setSwitchBranchesError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setSwitchBranchesLoading(false);
    }
  }

  async function openMergeBranchesDialog() {
    if (!activeRepoPath) return;
    setMergeError("");
    setMergeBusy(false);
    setMergeBranchesError("");
    setMergeBranchesLoading(true);
    setMergeBranches([]);
    setMergeBranchToMerge("");
    setMergeFfMode("");
    setMergeNoCommit(false);
    setMergeSquash(false);
    setMergeAllowUnrelatedHistories(false);
    setMergeAutostash(false);
    setMergeSignoff(false);
    setMergeNoVerify(false);
    setMergeStrategy("");
    setMergeConflictPreference("");
    setMergeLogMessages(0);
    setMergeMessage("");
    setMergeBranchesOpen(true);

    try {
      const list = await gitListBranches({ repoPath: activeRepoPath, includeRemote: true });
      setMergeBranches(Array.isArray(list) ? list : []);
    } catch (e) {
      setMergeBranches([]);
      setMergeBranchesError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setMergeBranchesLoading(false);
    }
  }

  async function fetchMergeBranches() {
    if (!activeRepoPath) return;
    setMergeBranchesError("");
    setMergeBranchesLoading(true);
    try {
      await gitFetch(activeRepoPath, "origin");
      const list = await gitListBranches({ repoPath: activeRepoPath, includeRemote: true });
      setMergeBranches(Array.isArray(list) ? list : []);
    } catch (e) {
      setMergeBranches([]);
      setMergeBranchesError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setMergeBranchesLoading(false);
    }
  }

  async function runMergeBranches() {
    if (!activeRepoPath) return;
    const b = mergeBranchToMerge.trim();
    if (!b) {
      setMergeError("Select a branch to merge.");
      return;
    }
    if (!activeBranchName.trim()) {
      setMergeError("Cannot merge into detached HEAD.");
      return;
    }

    setMergeBusy(true);
    setMergeError("");
    setPullError("");
    setError("");
    try {
      const res = await gitMergeBranchAdvanced({
        repoPath: activeRepoPath,
        branch: b,
        ffMode: mergeFfMode,
        noCommit: mergeNoCommit,
        squash: mergeSquash,
        allowUnrelatedHistories: mergeAllowUnrelatedHistories,
        autostash: mergeAutostash,
        signoff: mergeSignoff,
        noVerify: mergeNoVerify,
        strategy: mergeStrategy.trim() ? mergeStrategy.trim() : undefined,
        conflictPreference: mergeConflictPreference,
        logMessages: mergeLogMessages > 0 ? mergeLogMessages : undefined,
        message: mergeMessage.trim() ? mergeMessage.trim() : undefined,
      });

      setMergeBranchesOpen(false);

      if (res.status === "conflicts") {
        const nextOp = res.operation === "rebase" ? "rebase" : "merge";
        setPullConflictOperation(nextOp);
        setPullConflictFiles(res.conflict_files || []);
        setPullConflictMessage(res.message || "");
        setPullConflictOpen(true);
        return;
      }

      if (res.status === "in_progress") {
        const nextOp = res.operation === "rebase" ? "rebase" : "merge";
        setPullConflictOperation(nextOp);
        setPullConflictFiles(res.conflict_files || []);
        setPullConflictMessage(res.message || "");
        await continueAfterConflicts();
        return;
      }

      await loadRepo(activeRepoPath);
      await refreshIndicators(activeRepoPath);
    } catch (e) {
      const raw = typeof e === "string" ? e : JSON.stringify(e);
      const normalized = raw
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.toLowerCase().startsWith("hint:"))
        .join("\n");

      const msg = normalized || raw;
      const lower = msg.toLowerCase();
      const isFfOnly = mergeFfMode === "ff-only";
      const looksLikeFfOnlyFail =
        lower.includes("not possible to fast-forward") ||
        lower.includes("cannot fast-forward") ||
        lower.includes("can't be fast-forwarded") ||
        lower.includes("ff-only") ||
        lower.includes("fatal: not possible to fast-forward");

      if (isFfOnly && looksLikeFfOnlyFail) {
        setMergeError(
          "Fast-forward only failed. The branches have diverged, so Git cannot fast-forward.\n\nTry one of:\n- Fast-forward: Allow (default)\n- Fast-forward: Create a merge commit (no-ff)"
        );
      } else {
        setMergeError(msg);
      }
    } finally {
      setMergeBusy(false);
    }
  }

  async function fetchSwitchBranches() {
    if (!activeRepoPath) return;
    setSwitchBranchesError("");
    setSwitchBranchesLoading(true);
    try {
      await gitFetch(activeRepoPath, "origin");
      const list = await gitListBranches({ repoPath: activeRepoPath, includeRemote: true });
      setSwitchBranches(Array.isArray(list) ? list : []);
    } catch (e) {
      setSwitchBranches([]);
      setSwitchBranchesError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setSwitchBranchesLoading(false);
    }
  }

  function remoteRefToLocalName(remoteRef: string) {
    const t = remoteRef.trim();
    const idx = t.indexOf("/");
    if (idx <= 0) return t;
    return t.slice(idx + 1);
  }

  async function runSwitchBranch() {
    if (!activeRepoPath) return;
    const name = switchBranchName.trim();
    if (!name) {
      setSwitchBranchError("Branch name is empty.");
      return;
    }

    setSwitchBranchBusy(true);
    setSwitchBranchError("");
    setError("");
    try {
      if (switchBranchMode === "local") {
        await gitSwitch({ repoPath: activeRepoPath, branch: name, create: false });
      } else {
        const remoteRef = name;
        const localName =
          switchRemoteLocalMode === "same" ? remoteRefToLocalName(remoteRef) : switchRemoteLocalName.trim();
        if (!localName) {
          setSwitchBranchError("Local branch name is empty.");
          return;
        }
        await gitSwitch({
          repoPath: activeRepoPath,
          branch: localName,
          create: true,
          force: switchRemoteLocalMode === "same",
          startPoint: remoteRef,
          track: true,
        });
      }
      setSwitchBranchOpen(false);
      await loadRepo(activeRepoPath);
    } catch (e) {
      setSwitchBranchError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setSwitchBranchBusy(false);
    }
  }

  async function runRenameBranch() {
    if (!activeRepoPath) return;
    const oldName = renameBranchOld.trim();
    const newName = renameBranchNew.trim();
    if (!oldName) {
      setRenameBranchError("Old branch name is empty.");
      return;
    }
    if (!newName) {
      setRenameBranchError("New branch name is empty.");
      return;
    }

    setRenameBranchBusy(true);
    setRenameBranchError("");
    setError("");
    try {
      await gitRenameBranch({ repoPath: activeRepoPath, oldName, newName });
      setRenameBranchOpen(false);
      await loadRepo(activeRepoPath);
    } catch (e) {
      setRenameBranchError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setRenameBranchBusy(false);
    }
  }

  async function runRenameTag() {
    if (!activeRepoPath) return;
    const oldTag = renameTagOld.trim();
    const newTag = renameTagNew.trim();
    if (!oldTag) {
      setRenameTagError("Old tag name is empty.");
      return;
    }
    if (!newTag) {
      setRenameTagError("New tag name is empty.");
      return;
    }

    const onRemote = renameTagOnRemote;
    if (onRemote) {
      const currentRemote = await gitGetRemoteUrl(activeRepoPath, "origin");
      if (!currentRemote) {
        setRenameTagError("No remote origin set. Configure Remote first, or disable rename on origin.");
        return;
      }
    }

    setRenameTagBusy(true);
    setRenameTagError("");
    setError("");
    try {
      await gitRenameTag({ repoPath: activeRepoPath, oldTag, newTag, renameOnRemote: onRemote, remoteName: "origin" });
      setRenameTagOpen(false);
      await loadRepo(activeRepoPath);
      await refreshIndicators(activeRepoPath);
    } catch (e) {
      setRenameTagError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setRenameTagBusy(false);
    }
  }

  async function deleteBranch(branch: string) {
    if (!activeRepoPath) return;
    const b = branch.trim();
    if (!b) return;

    const ok = await confirmDialog({
      title: "Delete branch",
      message: `Delete branch ${b}?`,
      okLabel: "Delete",
      cancelLabel: "Cancel",
    });
    if (!ok) return;

    setLoading(true);
    setError("");
    try {
      await gitDeleteBranch({ repoPath: activeRepoPath, branch: b, force: false });
      await loadRepo(activeRepoPath);
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setLoading(false);
    }
  }

  async function refreshCleanOldBranches() {
    if (!activeRepoPath) return;
    setCleanOldBranchesLoading(true);
    setCleanOldBranchesError("");
    try {
      const list = await gitListBranches({ repoPath: activeRepoPath, includeRemote: false });
      setCleanOldBranchesAll(Array.isArray(list) ? list : []);
    } catch (e) {
      setCleanOldBranchesAll([]);
      setCleanOldBranchesError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setCleanOldBranchesLoading(false);
    }
  }

  async function openCleanOldBranchesDialog() {
    if (!activeRepoPath) return;
    setCleanOldBranchesError("");
    setCleanOldBranchesAll([]);
    setCleanOldBranchesSelected({});
    setCleanOldBranchesLoading(true);
    setCleanOldBranchesDeleting(false);
    setCleanOldBranchesOpen(true);
    await refreshCleanOldBranches();
  }

  async function runDeleteCleanOldBranches() {
    if (!activeRepoPath) return;
    if (cleanOldBranchesDeleting) return;

    const toDelete = cleanOldBranchesCandidates
      .map((r) => r.name)
      .filter((name) => cleanOldBranchesSelected[name])
      .map((s) => s.trim())
      .filter(Boolean);

    if (toDelete.length === 0) return;

    const ok = await confirmDialog({
      title: "Delete branches",
      message: `Delete ${toDelete.length} local branch(es)?\n\nThis only deletes local branches. It does NOT delete anything on remotes.`,
      okLabel: "Delete",
      cancelLabel: "Cancel",
    });
    if (!ok) return;

    setCleanOldBranchesDeleting(true);
    setCleanOldBranchesError("");
    try {
      const failures: Array<{ branch: string; error: string }> = [];
      for (const b of toDelete) {
        try {
          await gitDeleteBranch({ repoPath: activeRepoPath, branch: b, force: false });
        } catch (e) {
          failures.push({ branch: b, error: typeof e === "string" ? e : JSON.stringify(e) });
        }
      }

      await refreshCleanOldBranches();

      try {
        const ov = await repoOverview(activeRepoPath);
        setOverviewByRepo((prev) => ({ ...prev, [activeRepoPath]: ov }));
      } catch {
      }

      if (failures.length > 0) {
        const msg = failures
          .slice(0, 8)
          .map((f) => `${f.branch}: ${f.error}`)
          .join("\n");
        setCleanOldBranchesError(failures.length > 8 ? msg + "\n…" : msg);
      }
    } finally {
      setCleanOldBranchesDeleting(false);
    }
  }

  async function runCreateBranch() {
    if (!activeRepoPath) return;
    const name = createBranchName.trim();
    if (!name) {
      setCreateBranchError("Branch name is empty.");
      return;
    }

    const at = createBranchAt.trim();
    setCreateBranchBusy(true);
    setCreateBranchError("");
    setError("");
    try {
      await gitCreateBranchAdvanced({
        repoPath: activeRepoPath,
        branch: name,
        at: at ? at : undefined,
        checkout: createBranchCheckout,
        orphan: createBranchOrphan,
        clearWorkingTree: createBranchClearWorkingTree,
      });
      setCreateBranchOpen(false);
      await loadRepo(activeRepoPath);
    } catch (e) {
      setCreateBranchError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setCreateBranchBusy(false);
    }
  }

  async function runCommitContextReset(mode: GitResetMode, hash: string) {
    if (!activeRepoPath) return;
    const h = hash.trim();
    if (!h) return;

    const head = headHash.trim();
    let outsideBranch = false;
    if (head) {
      try {
        const isAncestor = await gitIsAncestor({ repoPath: activeRepoPath, ancestor: h, descendant: head });
        outsideBranch = !isAncestor;
      } catch {
        outsideBranch = false;
      }
    }

    const warnOutside = outsideBranch
      ? `\n\nNOTE: This commit is outside the currently checked out branch (${overview?.head_name || ""}).`
      : "";

    const baseMsgSoft = "Moves HEAD to this commit. Commits after it are removed from history, but their changes stay staged.";
    const baseMsgMixed =
      "Moves HEAD to this commit. Commits after it are removed from history, and their changes stay as unstaged (not selected in Commit).";
    const baseMsgHard =
      "Moves HEAD to this commit. Commits after it are discarded, as well as any uncommitted changes.\n\nRecovering committed changes can be hard (reflog). Uncommitted changes cannot be recovered.\n\nUse only if you know what you are doing.";

    const modeTitle = mode === "soft" ? "Reset --soft" : mode === "mixed" ? "Reset --mixed" : "Reset --hard";
    const modeMsg = mode === "soft" ? baseMsgSoft : mode === "mixed" ? baseMsgMixed : baseMsgHard;
    const okLabel = mode === "hard" ? "Reset" : "Reset";

    const ok = await confirmDialog({
      title: modeTitle,
      message: `Reset to ${shortHash(h)}?\n\n${modeMsg}${warnOutside}\n\nContinue?`,
      okLabel,
      cancelLabel: "Cancel",
    });
    if (!ok) return;

    setLoading(true);
    setError("");
    try {
      await gitReset({ repoPath: activeRepoPath, mode, target: h });
      await loadRepo(activeRepoPath);
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setLoading(false);
    }
  }

  function openStashContextMenu(stashRef: string, stashMessage: string, x: number, y: number) {
    const menuW = 260;
    const menuH = 150;
    const maxX = Math.max(0, window.innerWidth - menuW);
    const maxY = Math.max(0, window.innerHeight - menuH);
    setStashContextMenu({
      stashRef,
      stashMessage,
      x: Math.min(Math.max(0, x), maxX),
      y: Math.min(Math.max(0, y), maxY),
    });
  }

  function openTagContextMenu(tag: string, x: number, y: number) {
    const menuW = 260;
    const menuH = 270;
    const maxX = Math.max(0, window.innerWidth - menuW);
    const maxY = Math.max(0, window.innerHeight - menuH);
    setTagContextMenu({
      tag,
      x: Math.min(Math.max(0, x), maxX),
      y: Math.min(Math.max(0, y), maxY),
    });
  }

  function openRenameTagDialog(oldName: string) {
    setRenameTagError("");
    setRenameTagBusy(false);
    setRenameTagOld(oldName);
    setRenameTagNew(oldName);
    setRenameTagOnRemote(false);
    setRenameTagOpen(true);
  }

  async function deleteLocalTag(tag: string) {
    if (!activeRepoPath) return;
    const t = tag.trim();
    if (!t) return;

    const ok = await confirmDialog({
      title: "Delete local tag",
      message: `Delete local tag '${t}'?`,
      okLabel: "Delete",
      cancelLabel: "Cancel",
    });
    if (!ok) return;

    setLoading(true);
    setError("");
    try {
      await gitDeleteTag({ repoPath: activeRepoPath, tag: t });
      await loadRepo(activeRepoPath);
      await refreshIndicators(activeRepoPath);
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setLoading(false);
    }
  }

  async function deleteRemoteTag(tag: string) {
    if (!activeRepoPath) return;
    const t = tag.trim();
    if (!t) return;

    const currentRemote = await gitGetRemoteUrl(activeRepoPath, "origin");
    if (!currentRemote) {
      setError("No remote origin set. Configure Remote first.");
      return;
    }

    const ok = await confirmDialog({
      title: "Delete remote tag",
      message: `Delete tag '${t}' on remote origin?\n\nThis will remove the tag from remote, but it may still exist locally. Continue?`,
      okLabel: "Delete",
      cancelLabel: "Cancel",
    });
    if (!ok) return;

    setLoading(true);
    setError("");
    try {
      await gitDeleteRemoteTag({ repoPath: activeRepoPath, remoteName: "origin", tag: t });
      await loadRepo(activeRepoPath);
      await refreshIndicators(activeRepoPath);
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setLoading(false);
    }
  }

  async function checkoutCommit(hash: string) {
    if (!activeRepoPath) return;
    const commit = hash.trim();
    if (!commit) return;

    setLoading(true);
    setError("");
    try {
      await gitCheckoutCommit({ repoPath: activeRepoPath, commit });
      await loadRepo(activeRepoPath);
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setLoading(false);
    }
  }

  async function checkoutBranch(branch: string) {
    if (!activeRepoPath) return;
    const b = branch.trim();
    if (!b) return;

    setLoading(true);
    setError("");
    try {
      await gitCheckoutBranch({ repoPath: activeRepoPath, branch: b });
      await loadRepo(activeRepoPath);
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setLoading(false);
    }
  }

  async function resetHardAndCheckoutBranch(branch: string) {
    if (!activeRepoPath) return;
    const b = branch.trim();
    if (!b) return;

    const ok = await confirmDialog({
      title: "Reset --hard",
      message: "This will discard your local changes (git reset --hard). Continue?",
      okLabel: "Reset",
      cancelLabel: "Cancel",
    });
    if (!ok) return;

    setLoading(true);
    setError("");
    try {
      await gitResetHard(activeRepoPath);
      await gitCheckoutBranch({ repoPath: activeRepoPath, branch: b });
      await loadRepo(activeRepoPath);
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setLoading(false);
    }
  }


  function generateTempBranchName() {
    const base = headHash ? shortHash(headHash) : "head";
    return `tmp-detached-${base}-${Date.now().toString(36)}`;
  }

  useEffect(() => {
    if (!detachedHelpOpen) return;
    if (!detachedTempBranchRandom) return;
    setDetachedTempBranchName(generateTempBranchName());
  }, [detachedHelpOpen, detachedTempBranchRandom, headHash]);

  async function detachedFixSimple() {
    if (!activeRepoPath) return;
    const b = detachedTargetBranch.trim();
    if (!b) {
      setDetachedError("Select a target branch.");
      return;
    }

    setDetachedBusy(true);
    setDetachedError("");
    setError("");
    try {
      await gitCheckoutBranch({ repoPath: activeRepoPath, branch: b });
      setDetachedHelpOpen(false);
      await loadRepo(activeRepoPath);
    } catch (e) {
      setDetachedError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setDetachedBusy(false);
    }
  }

  async function detachedFixDiscardChanges() {
    if (!activeRepoPath) return;
    const b = detachedTargetBranch.trim();
    if (!b) {
      setDetachedError("Select a target branch.");
      return;
    }

    const ok = await confirmDialog({
      title: "Reset --hard",
      message: "This will discard your local changes (git reset --hard). Continue?",
      okLabel: "Reset",
      cancelLabel: "Cancel",
    });
    if (!ok) return;

    setDetachedBusy(true);
    setDetachedError("");
    setError("");
    try {
      await gitResetHard(activeRepoPath);
      await gitCheckoutBranch({ repoPath: activeRepoPath, branch: b });
      setDetachedHelpOpen(false);
      await loadRepo(activeRepoPath);
    } catch (e) {
      setDetachedError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setDetachedBusy(false);
    }
  }

  async function detachedSaveByBranch() {
    if (!activeRepoPath) return;
    const b = detachedTargetBranch.trim();
    if (!b) {
      setDetachedError("Select a target branch.");
      return;
    }

    const msg = detachedSaveCommitMessage.trim();
    if (!msg) {
      setDetachedError("Commit message is empty.");
      return;
    }

    const tmp = detachedTempBranchName.trim();
    if (!tmp) {
      setDetachedError("Temporary branch name is empty.");
      return;
    }

    setDetachedBusy(true);
    setDetachedError("");
    setError("");
    try {
      await gitCommitAll({ repoPath: activeRepoPath, message: msg });
      await gitCreateBranch({ repoPath: activeRepoPath, branch: tmp });
      await gitCheckoutBranch({ repoPath: activeRepoPath, branch: b });

      if (detachedMergeAfterSave) {
        const res = await gitMergeBranch({ repoPath: activeRepoPath, branch: tmp });
        if (res.status === "conflicts") {
          const nextOp = res.operation === "rebase" ? "rebase" : "merge";
          setPullConflictOperation(nextOp);
          setPullConflictFiles(res.conflict_files || []);
          setPullConflictMessage(res.message || "");
          setPullConflictOpen(true);
          setDetachedHelpOpen(false);
          return;
        }
        if (res.status === "in_progress") {
          const nextOp = res.operation === "rebase" ? "rebase" : "merge";
          setPullConflictOperation(nextOp);
          setPullConflictFiles(res.conflict_files || []);
          setPullConflictMessage(res.message || "");
          setDetachedHelpOpen(false);
          await continueAfterConflicts();
          return;
        }
        await gitDeleteBranch({ repoPath: activeRepoPath, branch: tmp, force: false });
      }

      setDetachedHelpOpen(false);
      await loadRepo(activeRepoPath);
    } catch (e) {
      setDetachedError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setDetachedBusy(false);
    }
  }

  async function detachedPrepareCherryPickSteps() {
    if (!activeRepoPath) return;
    const msg = detachedSaveCommitMessage.trim();
    if (!msg) {
      setDetachedError("Commit message is empty.");
      return;
    }

    setDetachedBusy(true);
    setDetachedError("");
    setCherryCommitHash("");
    setCherryReflog("");
    setError("");
    try {
      const newHash = await gitCommitAll({ repoPath: activeRepoPath, message: msg });
      setCherryCommitHash(newHash.trim());
      const reflog = await gitReflog({ repoPath: activeRepoPath, maxCount: 20 });
      setCherryReflog(reflog);

      setDetachedHelpOpen(false);
      setCherryStepsOpen(true);
    } catch (e) {
      setDetachedError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setDetachedBusy(false);
    }
  }

  async function detachedApplyCherryPick() {
    if (!activeRepoPath) return;
    const b = detachedTargetBranch.trim();
    if (!b) {
      setDetachedError("Select a target branch.");
      return;
    }

    const h = cherryCommitHash.trim();
    if (!h) {
      setDetachedError("Missing commit hash to cherry-pick.");
      return;
    }

    setDetachedBusy(true);
    setDetachedError("");
    setError("");
    try {
      await gitResetHard(activeRepoPath);
      await gitCheckoutBranch({ repoPath: activeRepoPath, branch: b });
      const args: string[] = [];
      if (cherryPickAppendOrigin) args.push("-x");
      if (cherryPickNoCommit) args.push("--no-commit");

      if (args.length === 0) {
        await gitCherryPick({ repoPath: activeRepoPath, commits: [h] });
      } else {
        await gitCherryPickAdvanced({ repoPath: activeRepoPath, commits: [h], appendOrigin: cherryPickAppendOrigin, noCommit: cherryPickNoCommit });
      }

      setCherryStepsOpen(false);
      await loadRepo(activeRepoPath);
    } catch (e) {
      setDetachedError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setDetachedBusy(false);
    }
  }

  async function resolveReferenceToHash(reference: string) {
    if (!activeRepoPath) return "";
    const ref = reference.trim();
    if (!ref) return "";

    setLoading(true);
    setError("");
    try {
      const hash = await gitResolveRef({ repoPath: activeRepoPath, reference: ref });
      return hash;
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
      return "";
    } finally {
      setLoading(false);
    }
  }

  async function focusTagOnGraph(tag: string) {
    const hash = await resolveReferenceToHash(tag);
    if (!hash) return;
    setSelectedHash(hash);
    setViewMode("graph");
    requestAutoCenter();
  }

  async function focusTagOnCommits(tag: string) {
    const hash = await resolveReferenceToHash(tag);
    if (!hash) return;
    setSelectedHash(hash);
    setViewMode("commits");
  }

  function focusHashOnGraph(hash: string) {
    const h = hash.trim();
    if (!h) return;
    setSelectedHash(h);
    setViewMode("graph");
    requestAutoCenter();
  }

  function focusHashOnCommits(hash: string) {
    const h = hash.trim();
    if (!h) return;
    setSelectedHash(h);
    setViewMode("commits");
  }

  async function goToReference(reference: string, targetView: "graph" | "commits") {
    const hash = await resolveReferenceToHash(reference);
    const h = (hash ?? "").trim();
    if (!h) return false;
    if (targetView === "graph") {
      focusHashOnGraph(h);
      return true;
    }
    focusHashOnCommits(h);
    return true;
  }

  function moveActiveRepoBy(delta: number) {
    if (!activeRepoPath) return;
    if (repos.length < 2) return;
    const idx = repos.indexOf(activeRepoPath);
    if (idx < 0) return;
    const next = (idx + delta + repos.length) % repos.length;
    const p = repos[next];
    if (!p) return;
    setActiveRepoPath(p);
    setSelectedHash("");
  }

  function goToParentCommit() {
    const cur = (selectedHash || headHash).trim();
    if (!cur) return;
    const byHash = new Map(commitsAll.map((c) => [c.hash, c] as const));
    const c = byHash.get(cur);
    const p = (c?.parents ?? [])[0] ?? "";
    if (!p) return;
    if (viewMode === "graph") {
      focusHashOnGraph(p);
      return;
    }
    focusHashOnCommits(p);
  }

  function goToChildCommit() {
    const cur = (selectedHash || headHash).trim();
    if (!cur) return;
    const child = commitsAll.find((c) => (c.parents ?? []).includes(cur))?.hash ?? "";
    if (!child) return;
    if (viewMode === "graph") {
      focusHashOnGraph(child);
      return;
    }
    focusHashOnCommits(child);
  }

  function goToFirstCommitInBranch() {
    const start = (selectedHash || headHash).trim();
    if (!start) return;
    const byHash = new Map(commitsAll.map((c) => [c.hash, c] as const));
    let cur = start;
    for (let i = 0; i < 100000; i++) {
      const c = byHash.get(cur);
      const p = (c?.parents ?? [])[0] ?? "";
      if (!p) break;
      if (!byHash.has(p)) break;
      cur = p;
    }
    if (!cur) return;
    if (viewMode === "graph") {
      focusHashOnGraph(cur);
      return;
    }
    focusHashOnCommits(cur);
  }

  function goToFirstCommitInRepo() {
    if (commitsAll.length === 0) return;
    const present = new Set(commitsAll.map((c) => c.hash));
    let root = "";
    for (let i = commitsAll.length - 1; i >= 0; i--) {
      const c = commitsAll[i];
      const parents = c.parents ?? [];
      if (parents.length === 0 || parents.every((p) => !present.has(p))) {
        root = c.hash;
        break;
      }
    }
    if (!root) root = commitsAll[commitsAll.length - 1]?.hash ?? "";
    if (!root) return;
    if (viewMode === "graph") {
      focusHashOnGraph(root);
      return;
    }
    focusHashOnCommits(root);
  }

  async function startPull(op: "merge" | "rebase") {
    if (!activeRepoPath) return;
    setPullBusy(true);
    setPullError("");
    setError("");
    try {
      const res =
        op === "rebase"
          ? await gitPullRebase({ repoPath: activeRepoPath, remoteName: "origin" })
          : await gitPull({ repoPath: activeRepoPath, remoteName: "origin" });

      if (res.status === "conflicts") {
        const nextOp = res.operation === "rebase" ? "rebase" : "merge";
        setPullConflictOperation(nextOp);
        setPullConflictFiles(res.conflict_files || []);
        setPullConflictMessage(res.message || "");
        setPullConflictOpen(true);
        return;
      }

      await loadRepo(activeRepoPath);
    } catch (e) {
      setPullError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setPullBusy(false);
    }
  }

  async function predictPull(rebase: boolean) {
    if (!activeRepoPath) return;
    setPullPredictBusy(true);
    setPullPredictError("");
    setPullPredictResult(null);
    setPullPredictRebase(rebase);
    setPullPredictOpen(true);
    try {
      const res = await gitPullPredictGraph({ repoPath: activeRepoPath, remoteName: "origin", rebase, maxCommits: 60 });
      setPullPredictResult(res);
    } catch (e) {
      setPullPredictError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setPullPredictBusy(false);
    }
  }

  async function pullAutoChoose() {
    if (!activeRepoPath) return;
    setPullBusy(true);
    setPullError("");
    try {
      const pred = await gitPullPredict({ repoPath: activeRepoPath, remoteName: "origin", rebase: true });

      if (pred.conflict_files && pred.conflict_files.length > 0) {
        await startPull("merge");
        return;
      }

      await startPull("rebase");
    } catch (e) {
      setPullError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setPullBusy(false);
    }
  }

  async function continueAfterConflicts() {
    if (!activeRepoPath) return;
    setPullError("");
    setPullConflictOpen(false);
    setConflictResolverOpen(false);
    setContinueAfterConflictsKey((v) => v + 1);
    setContinueAfterConflictsOpen(true);
  }

  async function abortAfterConflicts() {
    if (!activeRepoPath) return;
    setPullBusy(true);
    setPullError("");
    try {
      const st = await gitConflictState(activeRepoPath);
      const op = (st.operation ?? "").trim() as "merge" | "rebase" | "cherry-pick" | "am" | "";
      if (op === "rebase") {
        await gitRebaseAbort(activeRepoPath);
      } else if (op === "merge") {
        await gitMergeAbort(activeRepoPath);
      } else if (op === "cherry-pick") {
        await gitCherryPickAbort(activeRepoPath);
      } else if (op === "am") {
        await gitAmAbort(activeRepoPath);
      } else {
        await gitMergeAbort(activeRepoPath).catch(() => void 0);
        await gitRebaseAbort(activeRepoPath).catch(() => void 0);
      }
      setPullConflictOpen(false);
      setConflictResolverOpen(false);
      await loadRepo(activeRepoPath);
    } catch (e) {
      setPullError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setPullBusy(false);
    }
  }

  async function skipAfterConflicts() {
    if (!activeRepoPath) return;
    setPullBusy(true);
    setPullError("");
    try {
      await gitRebaseSkip(activeRepoPath);
      setConflictResolverKey((v) => v + 1);
    } catch (e) {
      setPullError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setPullBusy(false);
    }
  }

  function focusOnNewest() {
    if (!activeRepoPath) return;
    if (commitsAll.length === 0) return;

    let newestHash = "";
    let newestTs = -Infinity;

    for (const c of commitsAll) {
      const ts = Date.parse(c.date);
      if (!Number.isFinite(ts)) continue;
      if (ts > newestTs) {
        newestTs = ts;
        newestHash = c.hash;
      }
    }

    if (!newestHash) return;
    focusOnHash(newestHash, 1, 0.22);
  }

  async function loadFullHistory() {
    if (!activeRepoPath) return;
    if (commitsFullByRepo[activeRepoPath]) return;
    if (commitsFullLoadingByRepo[activeRepoPath]) return;

    setCommitsFullLoadingByRepo((prev) => ({ ...prev, [activeRepoPath]: true }));
    setError("");
    try {
      const ok = await loadRepo(activeRepoPath, true);
      if (ok) {
        setCommitsFullByRepo((prev) => ({ ...prev, [activeRepoPath]: true }));
      }
    } finally {
      setCommitsFullLoadingByRepo((prev) => ({ ...prev, [activeRepoPath]: false }));
    }
  }

  const elements = useMemo(() => {
    const nodes = new Map<
      string,
      { data: { id: string; label: string; refs: string }; position?: { x: number; y: number }; classes?: string }
    >();
    const edges: Array<{ data: { id: string; source: string; target: string } }> = [];

    const commits = commitsAll;
    const present = new Set(commits.map((c) => c.hash));

    const laneByHash = computeCompactLaneByHashForGraph(commits, commitsHistoryOrder);

    const laneStep = Math.max(300, graphSettings.nodeSep);
    const rowStep = Math.max(90, graphSettings.rankSep);
    const timeStep = graphSettings.rankDir === "LR" ? Math.max(340, rowStep) : rowStep;

    const timeForCommitIndex = (idx: number) => {
      if (graphSettings.rankDir === "LR") {
        return Math.max(0, commits.length - 1 - idx);
      }
      return idx;
    };

    const posFor = (lane: number, time: number) => {
      if (graphSettings.rankDir === "LR") {
        const zigzag = (time % 2 === 0 ? -1 : 1) * 40;
        return { x: time * timeStep, y: lane * laneStep + zigzag };
      }
      return { x: lane * laneStep, y: time * rowStep };
    };

    for (let idx = 0; idx < commits.length; idx++) {
      const c = commits[idx];
      const lane = laneByHash.get(c.hash) ?? 0;
      const time = timeForCommitIndex(idx);
      const label = `${shortHash(c.hash)}\n${truncate(c.subject, 100)}`;
      nodes.set(c.hash, {
        data: {
          id: c.hash,
          label,
          refs: c.refs,
        },
        position: posFor(lane, time),
        classes: c.is_head ? "head" : undefined,
      });
    }

    for (const c of commits) {
      const parents = commitsHistoryOrder === "first_parent" ? (c.parents[0] ? [c.parents[0]] : []) : c.parents;
      for (const p of parents) {
        if (!p) continue;
        if (!present.has(p)) continue;

        const source = graphSettings.edgeDirection === "to_parent" ? c.hash : p;
        const target = graphSettings.edgeDirection === "to_parent" ? p : c.hash;

        edges.push({
          data: {
            id: `${source}-${target}`,
            source,
            target,
          },
        });
      }
    }

    return {
      nodes: Array.from(nodes.values()),
      edges,
    };
  }, [commitsAll, commitsHistoryOrder, graphSettings.edgeDirection, graphSettings.nodeSep, graphSettings.rankDir, graphSettings.rankSep]);

  const { graphRef, zoomPct, requestAutoCenter, focusOnHash, focusOnHead, zoomBy } = useCyGraph({
    viewMode,
    activeRepoPath,
    elements,
    graphSettings,
    theme,
    isMacOS,

    remoteNames: overview?.remotes ?? [],
    stashBaseByRepo,
    stashesByRepo,
    unsyncedTagNames,

    selectedHash,
    headHash,

    setSelectedHash,

    openCommitContextMenu,
    openStashContextMenu,
    openRefBadgeContextMenu,
    openTagContextMenu,

    closeCommitContextMenu: () => setCommitContextMenu(null),
    closeStashContextMenu: () => setStashContextMenu(null),
    closeBranchContextMenu: () => setBranchContextMenu(null),
    closeTagContextMenu: () => setTagContextMenu(null),
    closeRefBadgeContextMenu: () => setRefBadgeContextMenu(null),
  });

  const { refreshIndicators } = useRepoIndicators({
    setIndicatorsUpdatingByRepo,
    setStatusSummaryByRepo,
    setRemoteUrlByRepo,
    setAheadBehindByRepo,
    setTagsToPushByRepo,
  });

  useEffect(() => {
    if (!activeRepoPath) return;
    if (loading) return;
    const t = window.setTimeout(() => {
      void refreshIndicators(activeRepoPath);
    }, 350);
    return () => {
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRepoPath, loading]);

  useEffect(() => {
    if (viewMode !== "commits") return;
    if (!selectedHash) return;
    const el = document.querySelector(`[data-commit-hash="${selectedHash}"]`);
    if (!(el instanceof HTMLElement)) return;
    requestAnimationFrame(() => {
      el.scrollIntoView({ block: "center", inline: "nearest" });
    });
  }, [activeRepoPath, selectedHash, viewMode]);

  function parsePullPredictConflictPreview(text: string): { kind: "common" | "ours" | "base" | "theirs"; text: string }[] {
    const out: { kind: "common" | "ours" | "base" | "theirs"; text: string }[] = [];
    let kind: "common" | "ours" | "base" | "theirs" = "common";
    for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
      const line = raw;
      if (line.startsWith("<<<<<<<")) {
        kind = "ours";
        continue;
      }
      if (line.startsWith("|||||||")) {
        kind = "base";
        continue;
      }
      if (line.startsWith("=======")) {
        kind = "theirs";
        continue;
      }
      if (line.startsWith(">>>>>>>")) {
        kind = "common";
        continue;
      }
      out.push({ kind, text: line });
    }
    return out;
  }

  async function pickRepository() {
    setGlobalError("");

    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select a Git repository",
    });

    if (!selected || Array.isArray(selected)) return;
    void openRepositoryWithAutoFetch(selected);
  }

  async function initializeProject() {
    setGlobalError("");
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select a folder to initialize",
    });

    if (!selected || Array.isArray(selected)) return;

    setLoading(true);
    try {
      await initRepo(selected);
      await openRepositoryWithAutoFetch(selected);
    } catch (e) {
      setGlobalError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setLoading(false);
    }
  }

  function openCloneDialog() {
    setCloneError("");
    setCloneBranchesError("");
    setCloneBranches([]);
    setCloneBusy(false);
    setCloneBranchesBusy(false);
    setCloneProgressMessage("");
    setCloneProgressPercent(null);
    cloneProgressDestRef.current = "";
    setCloneRepoUrl("");
    setCloneDestinationFolder("");
    setCloneSubdirName("");
    setCloneBranch("");
    setCloneInitSubmodules(true);
    setCloneDownloadFullHistory(true);
    setCloneBare(false);
    setCloneOrigin("");
    setCloneSingleBranch(false);
    setCloneModalOpen(true);
  }

  async function pickCloneDestinationFolder() {
    setCloneError("");
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select destination folder",
    });
    if (!selected || Array.isArray(selected)) return;
    setCloneDestinationFolder(selected);
  }

  async function fetchCloneBranches() {
    const url = cloneRepoUrl.trim();
    if (!url) return;
    setCloneBranchesBusy(true);
    setCloneBranchesError("");
    try {
      const branches = await gitLsRemoteHeads(url);
      setCloneBranches(branches);
    } catch (e) {
      setCloneBranches([]);
      setCloneBranchesError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setCloneBranchesBusy(false);
    }
  }

  async function runCloneRepository() {
    const repoUrl = cloneRepoUrl.trim();
    const destinationFolder = cloneDestinationFolder.trim();
    const origin = cloneOrigin.trim();

    if (!repoUrl) {
      setCloneError("Repository link is empty.");
      return;
    }
    if (!destinationFolder) {
      setCloneError("Destination folder is empty.");
      return;
    }
    if (!cloneTargetPath) {
      setCloneError("Destination path is invalid.");
      return;
    }

    cloneProgressDestRef.current = cloneTargetPath;
    setCloneProgressMessage("");
    setCloneProgressPercent(null);

    setCloneBusy(true);
    setCloneError("");
    setError("");
    try {
      await gitCloneRepo({
        repoUrl,
        destinationPath: cloneTargetPath,
        branch: cloneBranch.trim() ? cloneBranch.trim() : undefined,
        initSubmodules: cloneInitSubmodules,
        downloadFullHistory: cloneDownloadFullHistory,
        bare: cloneBare,
        origin: origin ? origin : undefined,
        singleBranch: cloneSingleBranch,
      });
      setCloneModalOpen(false);
      await openRepositoryWithAutoFetch(cloneTargetPath);
    } catch (e) {
      setCloneError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setCloneBusy(false);
      cloneProgressDestRef.current = "";
    }
  }

  async function openRemoteDialog() {
    if (!activeRepoPath) return;
    setRemoteError("");
    setRemoteUrlDraft(remoteUrl ?? "");
    setRemoteModalOpen(true);
  }

  async function saveRemote() {
    if (!activeRepoPath) return;
    const nextUrl = remoteUrlDraft.trim();
    if (!nextUrl) {
      setRemoteError("Remote URL is empty.");
      return;
    }

    setRemoteBusy(true);
    setRemoteError("");
    try {
      await gitSetRemoteUrl({ repoPath: activeRepoPath, remoteName: "origin", url: nextUrl });
      setRemoteModalOpen(false);
      await loadRepo(activeRepoPath);
    } catch (e) {
      setRemoteError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setRemoteBusy(false);
    }
  }

  async function openPushDialog() {
    if (!activeRepoPath) return;
    setPushError("");
    setPushForce(false);
    setPushWithLease(true);
    const headName = overviewByRepo[activeRepoPath]?.head_name ?? "";
    const localBranch = headName && headName !== "(detached)" ? headName : "";
    setPushLocalBranch(localBranch);
    setPushRemoteBranch(localBranch);
    void refreshIndicators(activeRepoPath);
    setPushModalOpen(true);
  }

  const autoFetchGuardsRef = useRef({
    activeRepoPath: "",
    loading: false,
    pullBusy: false,
    commitBusy: false,
    stashBusy: false,
  });

  useEffect(() => {
    autoFetchGuardsRef.current = {
      activeRepoPath,
      loading,
      pullBusy,
      commitBusy,
      stashBusy,
    };
  }, [activeRepoPath, commitBusy, loading, pullBusy, stashBusy]);

  useEffect(() => {
    if (!activeRepoPath) return;
    const minutes = Math.max(0, Math.trunc(Number(autoFetchMinutes) || 0));
    if (minutes <= 0) return;

    const id = window.setInterval(() => {
      const g = autoFetchGuardsRef.current;
      if (!g.activeRepoPath) return;
      if (g.loading || g.pullBusy || g.commitBusy || g.stashBusy) return;
      void runFetchBackground(g.activeRepoPath);
    }, minutes * 60_000);

    return () => window.clearInterval(id);
  }, [activeRepoPath, autoFetchMinutes]);

  useEffect(() => {
    if (!activeRepoPath) return;
    const minutes = Math.max(0, Math.trunc(Number(autoRefreshMinutes) || 0));
    if (minutes <= 0) return;

    const id = window.setInterval(() => {
      const g = autoFetchGuardsRef.current;
      if (!g.activeRepoPath) return;
      if (g.loading || g.pullBusy || g.commitBusy || g.stashBusy) return;
      if (autoRefreshInFlightRef.current) return;

      autoRefreshInFlightRef.current = true;
      void loadRepo(g.activeRepoPath, undefined, false)
        .catch((e) => {
          const msg = typeof e === "string" ? e : JSON.stringify(e);
          if (g.activeRepoPath === activeRepoPath) setError(msg);
        })
        .finally(() => {
          autoRefreshInFlightRef.current = false;
        });
    }, minutes * 60_000);

    return () => window.clearInterval(id);
  }, [activeRepoPath, autoRefreshMinutes, loadRepo]);

  async function runPush() {
    if (!activeRepoPath) return;
    const localBranch = pushLocalBranch.trim();
    const remoteBranch = pushRemoteBranch.trim();
    if (!localBranch) {
      setPushError("Local branch is empty.");
      return;
    }

    const currentRemote = await gitGetRemoteUrl(activeRepoPath, "origin");
    if (!currentRemote) {
      setPushError("No remote origin set. Configure Remote first.");
      return;
    }

    const headName = overviewByRepo[activeRepoPath]?.head_name ?? "";
    if (headName === "(detached)") {
      setPushError("Cannot push from detached HEAD.");
      return;
    }

    if (pushForce) {
      const ok = await confirmDialog({
        title: "Force push",
        message: "Force push will rewrite history on the remote branch. Continue?",
        okLabel: "Force push",
        cancelLabel: "Cancel",
      });
      if (!ok) return;
    }

    setPushBusy(true);
    setPushError("");
    try {
      const refspec = remoteBranch && remoteBranch !== localBranch ? `${localBranch}:${remoteBranch}` : localBranch;
      await gitPush({ repoPath: activeRepoPath, remoteName: "origin", branch: refspec, force: pushForce, withLease: pushWithLease });
      setPushModalOpen(false);
      await loadRepo(activeRepoPath);
    } catch (e) {
      setPushError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setPushBusy(false);
    }
  }

  async function runFetch() {
    if (!activeRepoPath) return;
    setLoading(true);
    setError("");
    try {
      await gitFetch(activeRepoPath, "origin");
      await loadRepo(activeRepoPath);
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setLoading(false);
    }
  }

  async function pushTagsToOrigin() {
    if (!activeRepoPath) return;
    if (!remoteUrl) return;
    const info = tagsToPushByRepo[activeRepoPath];
    const newTags = (info?.newTags ?? []).filter((t) => t.trim());
    const movedTags = (info?.movedTags ?? []).filter((t) => t.trim());
    const tags = [...newTags, ...movedTags];
    if (tags.length === 0) return;

    let force = false;
    if (movedTags.length > 0) {
      const ok = await confirmDialog({
        title: "Force push tags",
        message: `Some tags already exist on origin but point to a different commit:\n\n${movedTags.join("\n")}\n\nPush them with --force?`,
        okLabel: "Force push",
        cancelLabel: "Cancel",
      });
      if (!ok) return;
      force = true;
    }

    setLoading(true);
    setError("");
    try {
      await gitPushTags({ repoPath: activeRepoPath, remoteName: "origin", tags, force });
      await loadRepo(activeRepoPath);
      await refreshIndicators(activeRepoPath);
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setLoading(false);
    }
  }

  const menuToggle = (opts: { label: string; checked: boolean; disabled?: boolean; shortcutText?: string; onChange: (next: boolean) => void }) => {
    const { label, checked, disabled, shortcutText, onChange } = opts;
    return (
      <button
        type="button"
        className={disabled ? "menuToggle menuToggleDisabled" : "menuToggle"}
        onClick={() => {
          if (disabled) return;
          onChange(!checked);
        }}
        disabled={disabled}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
          <span className="menuToggleLabel">{label}</span>
          {shortcutText ? <span className="menuShortcut">{shortcutText}</span> : null}
        </span>
        <label
          className="menuSwitch"
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className="menuSwitchSlider" />
        </label>
      </button>
    );
  };

  const menuItem = (left: ReactNode, shortcutText?: string) => (
    <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, width: "100%" }}>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{left}</span>
      {shortcutText ? <span className="menuShortcut">{shortcutText}</span> : null}
    </span>
  );

  const toolbarItem = (left: ReactNode, shortcutText?: string) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span>{left}</span>
      {showToolbarShortcutHints && shortcutText ? <span className="menuShortcut">{shortcutText}</span> : null}
    </span>
  );

  return (
    <div className="app">
      <TooltipLayer />
      <div className="topbar">
        <div className="menubar">
          <div className="menubarLeft">
            <RepositoryMenu
              repositoryMenuOpen={repositoryMenuOpen}
              setRepositoryMenuOpen={setRepositoryMenuOpen}
              closeOtherMenus={() => {
                setCommandsMenuOpen(false);
                setToolsMenuOpen(false);
                setNavigateMenuOpen(false);
                setViewMenuOpen(false);
              }}
              loading={loading}
              cloneBusy={cloneBusy}
              activeRepoPath={activeRepoPath}
              remoteUrl={remoteUrl}
              openCloneDialog={openCloneDialog}
              pickRepository={pickRepository}
              initializeProject={initializeProject}
              openRemoteDialog={openRemoteDialog}
              loadRepo={loadRepo}
              runFetch={runFetch}
              openActiveRepoInExplorer={openActiveRepoInExplorer}
              menuItem={menuItem}
              shortcutLabel={shortcutLabel}
            />

            <NavigateMenu
              navigateMenuOpen={navigateMenuOpen}
              setNavigateMenuOpen={setNavigateMenuOpen}
              closeOtherMenus={() => {
                setRepositoryMenuOpen(false);
                setCommandsMenuOpen(false);
                setToolsMenuOpen(false);
                setViewMenuOpen(false);
              }}
              repos={repos}
              activeRepoPath={activeRepoPath}
              selectedHash={selectedHash}
              headHash={headHash}
              commitsCount={commitsAll.length}
              moveActiveRepoBy={moveActiveRepoBy}
              setViewMode={setViewMode}
              openGoToCommit={() => {
                setGoToError("");
                setGoToKind("commit");
                setGoToText("");
                setGoToTargetView(viewMode);
                setGoToOpen(true);
              }}
              openGoToTag={() => {
                setGoToError("");
                setGoToKind("tag");
                setGoToText("");
                setGoToTargetView(viewMode);
                setGoToOpen(true);
              }}
              goToChildCommit={goToChildCommit}
              goToParentCommit={goToParentCommit}
              goToFirstCommitInBranch={goToFirstCommitInBranch}
              goToFirstCommitInRepo={goToFirstCommitInRepo}
              menuItem={menuItem}
              shortcutLabel={shortcutLabel}
            />

            <ViewMenu
              viewMenuOpen={viewMenuOpen}
              setViewMenuOpen={setViewMenuOpen}
              closeOtherMenus={() => {
                setRepositoryMenuOpen(false);
                setCommandsMenuOpen(false);
                setToolsMenuOpen(false);
                setNavigateMenuOpen(false);
              }}
              openQuickButtonsModal={() => {
                setQuickButtonsModalOpen(true);
              }}
              menuToggle={menuToggle}
              showStashesOnGraph={graphSettings.showStashesOnGraph}
              showTags={graphSettings.showTags}
              showRemoteBranchesOnGraph={graphSettings.showRemoteBranchesOnGraph}
              detailsVisible={layout.detailsHeightPx > 0}
              sidebarVisible={layout.sidebarWidthPx > 0}
              graphButtonsVisible={graphButtonsVisible}
              showOnlineAvatars={showOnlineAvatars}
              commitsOnlyHead={commitsOnlyHead}
              layoutDirectionTopToBottom={graphSettings.edgeDirection === "to_parent"}
              tooltipsEnabled={tooltipSettings.enabled}
              onChangeShowStashesOnGraph={(v) => setGraph({ showStashesOnGraph: v })}
              onChangeShowTags={(v) => setGraph({ showTags: v })}
              onChangeShowRemoteBranchesOnGraph={(v) => setGraph({ showRemoteBranchesOnGraph: v })}
              onChangeDetailsVisible={(v) => setDetailsVisible(v)}
              onChangeSidebarVisible={(v) => setSidebarVisible(v)}
              onChangeGraphButtonsVisible={(v) => setGraphButtonsVisible(v)}
              onChangeShowOnlineAvatars={(v) => setGit({ showOnlineAvatars: v })}
              onChangeCommitsOnlyHead={(v) => setGit({ commitsOnlyHead: v })}
              onChangeLayoutDirectionTopToBottom={(v) => setGraph({ edgeDirection: v ? "to_parent" : "to_child" })}
              onChangeTooltipsEnabled={(v) => setGeneral({ tooltips: { ...tooltipSettings, enabled: v } })}
              shortcutShowStashesOnGraph={shortcutLabel("view.toggleStashesOnGraph")}
              shortcutShowTags={shortcutLabel("view.toggleTags")}
              shortcutShowRemoteBranches={shortcutLabel("view.toggleRemoteBranches")}
              shortcutDetailsWindow={shortcutPairLabel("panel.details.show", "panel.details.hide")}
              shortcutBranchesWindow={shortcutPairLabel("panel.branches.show", "panel.branches.hide")}
              shortcutGraphButtons={shortcutLabel("view.toggleGraphButtons")}
              shortcutOnlineAvatars={shortcutLabel("view.toggleOnlineAvatars")}
              shortcutCommitsOnlyHead={shortcutLabel("view.toggleCommitsOnlyHead")}
              shortcutLayoutDirection={shortcutLabel("view.toggleLayoutDirection")}
              shortcutTooltips={shortcutLabel("view.toggleTooltips")}
            />

            <CommandsMenu
              commandsMenuOpen={commandsMenuOpen}
              setCommandsMenuOpen={setCommandsMenuOpen}
              closeOtherMenus={() => {
                setRepositoryMenuOpen(false);
                setToolsMenuOpen(false);
                setNavigateMenuOpen(false);
                setViewMenuOpen(false);
              }}
              activeRepoPath={activeRepoPath}
              loading={loading}
              remoteUrl={remoteUrl}
              changedCount={changedCount}
              aheadCount={aheadCount}
              stashChangedCount={stashChangedCount}
              selectedHash={selectedHash}
              headHash={headHash}
              openCommitDialog={openCommitDialog}
              openPushDialog={openPushDialog}
              openStashDialog={openStashDialog}
              openCreateBranchDialog={openCreateBranchDialog}
              openCreateTagDialog={openCreateTagDialog}
              pushTagsCount={pushTagsCount}
              pushTags={pushTagsToOrigin}
              openSwitchBranchDialog={openSwitchBranchDialog}
              openMergeBranchesDialog={openMergeBranchesDialog}
              openResetDialog={openResetDialog}
              openCherryPickDialog={openCherryPickDialog}
              openExportPatchDialog={openExportPatchDialog}
              openApplyPatchDialog={openApplyPatchDialog}
              menuItem={menuItem}
              shortcutLabel={shortcutLabel}
            />

            <ToolsMenu
              toolsMenuOpen={toolsMenuOpen}
              setToolsMenuOpen={setToolsMenuOpen}
              closeOtherMenus={() => {
                setRepositoryMenuOpen(false);
                setCommandsMenuOpen(false);
                setNavigateMenuOpen(false);
                setViewMenuOpen(false);
              }}
              activeRepoPath={activeRepoPath}
              loading={loading}
              stashesCount={stashes.length}
              setTerminalMenuOpen={setTerminalMenuOpen}
              setDiffToolModalOpen={setDiffToolModalOpen}
              setGitignoreModifierOpen={setGitignoreModifierOpen}
              openCommitSearch={openCommitSearch}
              openCleanOldBranchesDialog={openCleanOldBranchesDialog}
              confirmClearAllStashes={async () => {
                const ok = await confirmDialog({
                  title: "Clear all stashes",
                  message: "This will delete all stashes in the current repository. Continue?",
                  okLabel: "Clear",
                  cancelLabel: "Cancel",
                });
                if (!ok) return;
                await clearAllStashes();
              }}
              menuItem={menuItem}
              shortcutLabel={shortcutLabel}
            />

            <div className="menuitem">Help</div>
          </div>

          <MenubarRight theme={theme} setTheme={setTheme} openSettings={() => setSettingsOpen(true)} />
        </div>

        <TopToolbar
          repos={repos}
          activeRepoPath={activeRepoPath}
          loading={loading}
          cloneBusy={cloneBusy}
          remoteUrl={remoteUrl}
          quickButtons={quickButtons}
          changedCount={changedCount}
          aheadCount={aheadCount}
          behindCount={behindCount}
          pullBusy={pullBusy}
          pullMenuOpen={pullMenuOpen}
          setPullMenuOpen={setPullMenuOpen}
          pullPredictBusy={pullPredictBusy}
          startPull={startPull}
          predictPull={predictPull}
          pullAutoChoose={pullAutoChoose}
          openCommitDialog={openCommitDialog}
          openPushDialog={openPushDialog}
          openStashDialog={openStashDialog}
          openCreateTagDialog={() => {
            const at = (selectedHash.trim() ? selectedHash.trim() : headHash.trim()).trim();
            if (!at) return;
            openCreateTagDialog(at);
          }}
          openResetDialog={openResetDialog}
          openCherryPickDialog={openCherryPickDialog}
          openExportPatchDialog={openExportPatchDialog}
          openApplyPatchDialog={openApplyPatchDialog}
          openDiffTool={() => setDiffToolModalOpen(true)}
          openCommitSearch={openCommitSearch}
          openRepoPicker={() => {
            setRepositoryMenuOpen(false);
            setCommandsMenuOpen(false);
            setToolsMenuOpen(false);
            void pickRepository();
          }}
          refreshRepo={() => void loadRepo()}
          runFetch={runFetch}
          showToolbarShortcutHints={showToolbarShortcutHints}
          toolbarItem={toolbarItem}
          shortcutLabel={shortcutLabel}
          terminalMenuOpen={terminalMenuOpen}
          setTerminalMenuOpen={setTerminalMenuOpen}
          terminalMenuRef={terminalMenuRef}
          terminalSettings={terminalSettings}
          chooseTerminalProfile={(id) => {
            setTerminal({ defaultProfileId: id });
          }}
          openTerminalDefault={() => void openTerminalProfile(terminalSettings.defaultProfileId)}
          openTerminalSettings={() => setSettingsOpen(true)}
          indicatorsUpdating={indicatorsUpdating}
          error={error}
          pullError={pullError}
        />

        <RepoTabs
          repos={repos}
          activeRepoPath={activeRepoPath}
          tabDragPath={tabDragPath}
          setActiveRepoPath={setActiveRepoPath}
          setSelectedHash={setSelectedHash}
          setTabDragPath={setTabDragPath}
          closeRepository={closeRepository}
          setRepos={setRepos}
          captureTabRects={captureTabRects}
          tabsRef={tabsRef}
          tabSuppressClickRef={tabSuppressClickRef}
        />

      </div>

        <div
          className="content"
          style={{
            gridTemplateColumns: layout.sidebarWidthPx > 0 ? `${layout.sidebarWidthPx}px 6px 1fr` : `0px 0px 1fr`,
          }}
        >
          <Sidebar
            visible={layout.sidebarWidthPx > 0}
            overview={overview}
            tagsExpanded={tagsExpanded}
            activeRepoPath={activeRepoPath}
            loading={loading}
            isActiveBranch={(b) => normalizeBranchName(b) === normalizeBranchName(activeBranchName)}
            openBranchContextMenu={openBranchContextMenu}
            checkoutBranch={checkoutBranch}
            openRenameBranchDialog={openRenameBranchDialog}
            deleteBranch={deleteBranch}
            openTagContextMenu={openTagContextMenu}
            focusTagOnGraph={focusTagOnGraph}
            openRenameTagDialog={openRenameTagDialog}
            deleteLocalTag={deleteLocalTag}
            expandTags={() => {
              if (!activeRepoPath) return;
              setTagsExpandedByRepo((prev) => ({ ...prev, [activeRepoPath]: true }));
            }}
            stashes={stashes}
            openStashView={openStashView}
            applyStashByRef={applyStashByRef}
            confirmDeleteStash={async (s) => {
              const ok = await confirmDialog({
                title: "Delete stash",
                message: `Delete stash ${s.message?.trim() ? s.message.trim() : s.reference}?`,
                okLabel: "Delete",
                cancelLabel: "Cancel",
              });
              if (!ok) return;
              await dropStashByRef(s.reference);
            }}
          />

        <div
          className="splitterV"
          onMouseDown={startSidebarResize}
          title="Drag to resize sidebar"
          style={layout.sidebarWidthPx > 0 ? undefined : { pointerEvents: "none" }}
        />

        <div
          className="main"
          style={{
            gridTemplateRows: layout.detailsHeightPx > 0 ? `auto 1fr 6px ${layout.detailsHeightPx}px` : `auto 1fr 0px 0px`,
          }}
        >
          <MainHeader activeRepoPath={activeRepoPath} overview={overview} viewMode={viewMode} setViewMode={setViewMode} />

          <div className="mainCanvas">
            {viewMode === "graph" ? (
              <>
                <div
                  className="graphCanvas"
                  key={`graph-${activeRepoPath}`}
                  style={graphSettings.canvasBackground ? { background: graphSettings.canvasBackground } : undefined}
                >
                  <div className="cyCanvas" ref={graphRef} />
                  {isDetached ? (
                    <div className="graphStatusControls">
                      <button
                        type="button"
                        className="statusPill statusPillDanger"
                        onClick={() => {
                          setDetachedError("");
                          setDetachedHelpOpen(true);
                        }}
                        disabled={!activeRepoPath}
                        title="HEAD is detached. Click for recovery options."
                      >
                        Head detached
                      </button>
                    </div>
                  ) : null}
                  {graphButtonsVisible ? (
                    <div className="zoomControls">
                      <div className="zoomIndicator">{zoomPct}%</div>
                      <button
                        type="button"
                        onClick={() => void openRemoteDialog()}
                        disabled={!activeRepoPath}
                        style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
                        title={remoteUrl ? remoteUrl : "No remote origin"}
                      >
                        <span
                          className="statusDot"
                          style={{ backgroundColor: remoteUrl ? "rgba(0, 140, 0, 0.85)" : "rgba(176, 0, 32, 0.85)" }}
                        />
                        Remote
                      </button>
                      <button type="button" onClick={() => zoomBy(1.2)} disabled={!activeRepoPath}>
                        +
                      </button>
                      <button type="button" onClick={() => zoomBy(1 / 1.2)} disabled={!activeRepoPath}>
                        -
                      </button>
                      <button type="button" onClick={() => focusOnHash(selectedHash || headHash, 1, 0.22)} disabled={!activeRepoPath}>
                        Reset focus
                      </button>
                      <button type="button" onClick={focusOnHead} disabled={!activeRepoPath || !headHash}>
                        Focus on HEAD
                      </button>
                      <button type="button" onClick={focusOnNewest} disabled={!activeRepoPath || commitsAll.length === 0}>
                        Focus on newest
                      </button>
                      {!activeRepoPath || commitsFullByRepo[activeRepoPath] || commitsHasMoreByRepo[activeRepoPath] !== true ? null : (
                        <button
                          type="button"
                          onClick={() => void loadFullHistory()}
                          disabled={loading || commitsFullLoadingByRepo[activeRepoPath]}
                          title="Load the full git history (may take a while for large repositories)."
                        >
                          {commitsFullLoadingByRepo[activeRepoPath] ? "Loading full history…" : "Get full history"}
                        </button>
                      )}
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="graphCanvas" key={`commits-${activeRepoPath}`} style={{ padding: 12, overflow: "auto" }}>
                {commitsAll.length === 0 ? (
                  <div style={{ opacity: 0.7 }}>No commits loaded.</div>
                ) : (
                  <div style={{ display: "grid", gap: 10 }}>
                    {commitSearchOpen ? (
                      <div className="commitSearchPanel">
                        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                          <input
                            ref={commitSearchInputRef}
                            className="modalInput"
                            value={commitSearchText}
                            onChange={(e) => setCommitSearchText(e.target.value)}
                            placeholder="Search commits…"
                            style={{ flex: "1 1 320px" }}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") {
                                e.preventDefault();
                                e.stopPropagation();
                                closeCommitSearch();
                              }
                            }}
                          />
                          <button type="button" onClick={closeCommitSearch}>
                            Close
                          </button>
                        </div>

                        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
                          <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.9 }}>
                            <input
                              type="checkbox"
                              checked={commitSearchInSubject}
                              onChange={(e) => setCommitSearchInSubject(e.target.checked)}
                            />
                            Name
                          </label>
                          <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.9 }}>
                            <input type="checkbox" checked={commitSearchInHash} onChange={(e) => setCommitSearchInHash(e.target.checked)} />
                            Hash
                          </label>
                          <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.9 }}>
                            <input
                              type="checkbox"
                              checked={commitSearchInAuthor}
                              onChange={(e) => setCommitSearchInAuthor(e.target.checked)}
                            />
                            Author
                          </label>
                          <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.9 }}>
                            <input type="checkbox" checked={commitSearchInDiff} onChange={(e) => setCommitSearchInDiff(e.target.checked)} />
                            Diff
                            <span style={{ fontSize: 12, opacity: 0.7 }}>(slow)</span>
                            {commitSearchDiffBusy ? <span className="miniSpinner" /> : null}
                          </label>
                        </div>

                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ fontWeight: 900, opacity: 0.75, fontSize: 12 }}>Author</div>
                            <select value={commitSearchAuthorFilter} onChange={(e) => setCommitSearchAuthorFilter(e.target.value)}>
                              <option value="">All</option>
                              {commitSearchAuthors.map((a) => (
                                <option key={a} value={a}>
                                  {a}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ fontWeight: 900, opacity: 0.75, fontSize: 12 }}>From</div>
                            <input type="date" value={commitSearchDateFrom} onChange={(e) => setCommitSearchDateFrom(e.target.value)} />
                          </div>

                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ fontWeight: 900, opacity: 0.75, fontSize: 12 }}>To</div>
                            <input type="date" value={commitSearchDateTo} onChange={(e) => setCommitSearchDateTo(e.target.value)} />
                          </div>
                        </div>

                        <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700 }}>Type at least 3 characters to search.</div>
                      </div>
                    ) : null}

                    {commitSearchActive && commitsForList.length === 0 ? (
                      <div style={{ opacity: 0.7 }}>No matching commits.</div>
                    ) : null}

                    <div className="commitsList">
                      {commitsForList.map((c) => (
                        <button
                          key={c.hash}
                          data-commit-hash={c.hash}
                          type="button"
                          onClick={() => setSelectedHash(c.hash)}
                          onContextMenu={(e) => {
                            if (!activeRepoPath || loading) return;
                            e.preventDefault();
                            e.stopPropagation();
                            openCommitContextMenu(c.hash, e.clientX, e.clientY);
                          }}
                          className={c.hash === selectedHash ? "commitRow commitRowSelected" : "commitRow"}
                        >
                          <div className="commitRowGrid">
                            <div
                              className="commitGraphCell"
                              style={{
                                width:
                                  commitLaneLayout.maxLanes > 0
                                    ? Math.max(28, 20 + Math.min(commitLaneLayout.maxLanes, 10) * 12 + 56)
                                    : 28,
                              }}
                            >
                              {commitLaneLayout.rows.length ? (
                                <CommitLaneSvg
                                  row={commitLaneRowByHash.get(c.hash) ?? {
                                    hash: c.hash,
                                    lane: 0,
                                    activeTop: [],
                                    activeBottom: [],
                                    parentLanes: [],
                                    joinLanes: [],
                                  }}
                                  maxLanes={commitLaneLayout.maxLanes}
                                  theme={theme}
                                  selected={c.hash === selectedHash}
                                  isHead={c.is_head}
                                  showMergeStub={commitsHistoryOrder === "first_parent" && c.parents.length > 1}
                                  mergeParentCount={c.parents.length}
                                  nodeBg={commitLaneNodeBg}
                                  palette={commitLanePalette}
                                  refMarkers={parseRefs(c.refs, overview?.remotes ?? [])}
                                />
                              ) : null}
                            </div>
                            <div
                              className="commitAvatar"
                              style={
                                {
                                  ["--avatar-c1" as any]: `hsl(${fnv1a32(c.author) % 360} 72% ${theme === "dark" ? 58 : 46}%)`,
                                  ["--avatar-c2" as any]: `hsl(${(fnv1a32(c.author + "::2") + 28) % 360} 72% ${theme === "dark" ? 48 : 38}%)`,
                                } as CSSProperties
                              }
                              title={c.author}
                            >
                              {(() => {
                                const email = (c.author_email ?? "").trim().toLowerCase();
                                const canUse = Boolean(showOnlineAvatars && email && !avatarFailedByEmail[email]);
                                const url = canUse ? `https://www.gravatar.com/avatar/${md5Hex(email)}?d=404&s=64` : null;
                                return (
                                  <>
                                    <span className="commitAvatarText">{authorInitials(c.author)}</span>
                                    {url ? (
                                      <img
                                        className="commitAvatarImg"
                                        src={url}
                                        alt={c.author}
                                        loading="lazy"
                                        decoding="async"
                                        referrerPolicy="no-referrer"
                                        draggable={false}
                                        onError={() => {
                                          setAvatarFailedByEmail((prev) => ({ ...prev, [email]: true }));
                                        }}
                                      />
                                    ) : null}
                                  </>
                                );
                              })()}
                            </div>
                            <div className="commitRowMain">
                              <div className="commitRowTop">
                                <span className="commitHash">{shortHash(c.hash)}</span>
                                <span className="commitSubject">{truncate(c.subject, 100)}</span>
                                {c.is_head ? <span className="commitHead">(HEAD)</span> : null}
                              </div>
                              <div className="commitMeta">
                                {c.author} — {c.date}
                              </div>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="splitterH" onMouseDown={startDetailsResize} title="Drag to resize details panel" />

          <DetailsPanel
            visible={layout.detailsHeightPx > 0}
            detailsTab={detailsTab}
            setDetailsTab={setDetailsTab}
            selectedCommit={selectedCommit}
            activeRepoPath={activeRepoPath}
            loading={loading}
            copyHash={() => void copyText(selectedHash)}
            checkoutSelectedCommit={() => void checkoutCommit(selectedHash)}
            diffTool={diffTool}
          />
        </div>
        </div>

      <CommitContextMenu
        menu={commitContextMenu}
        menuRef={commitContextMenuRef}
        headHash={headHash}
        activeRepoPath={activeRepoPath}
        loading={loading}
        isDetached={isDetached}
        commitContextBranchesLoading={commitContextBranchesLoading}
        commitContextBranches={commitContextBranches}
        changedCount={changedCount}
        pickPreferredBranch={pickPreferredBranch}
        onShowChanges={(hash) => {
          setCommitContextMenu(null);
          setShowChangesCommit(hash);
          setShowChangesOpen(true);
          setDetailsTab("changes");
          setSelectedHash(hash);
        }}
        onCopyHash={(hash) => {
          void copyText(hash);
          setCommitContextMenu(null);
        }}
        onCheckoutCommit={(hash) => {
          setCommitContextMenu(null);
          void checkoutCommit(hash);
        }}
        onCreateBranch={(hash) => {
          setCommitContextMenu(null);
          openCreateBranchDialog(hash);
        }}
        onCreateTag={(hash) => {
          setCommitContextMenu(null);
          openCreateTagDialog(hash);
        }}
        onCherryPick={(hash) => {
          setCommitContextMenu(null);
          setSelectedHash(hash);
          void openCherryPickDialog();
        }}
        onExportPatch={(hash) => {
          setCommitContextMenu(null);
          setSelectedHash(hash);
          void openExportPatchDialog();
        }}
        onApplyPatch={() => {
          setCommitContextMenu(null);
          void openApplyPatchDialog();
        }}
        onReset={(mode, hash) => {
          setCommitContextMenu(null);
          void runCommitContextReset(mode, hash);
        }}
        onCheckoutBranch={(branch) => {
          setCommitContextMenu(null);
          void checkoutBranch(branch);
        }}
        onResetHardAndCheckoutBranch={(branch) => {
          setCommitContextMenu(null);
          void resetHardAndCheckoutBranch(branch);
        }}
      />

      <WorkingFileContextMenu
        menu={workingFileContextMenu}
        menuRef={workingFileContextMenuRef}
        activeRepoPath={activeRepoPath}
        commitBusy={commitBusy}
        stashBusy={stashBusy}
        onClose={() => setWorkingFileContextMenu(null)}
        onDiscard={(mode, path, status) => {
          void discardWorkingFile(mode, path, status);
        }}
        onDelete={(mode, path) => {
          void deleteWorkingFile(mode, path);
        }}
        onCopyText={(text) => {
          void copyText(text);
        }}
        joinPath={joinPath}
        onRevealInExplorer={(absPath) => {
          void revealInFileExplorer(absPath);
        }}
        onAddToGitignore={(mode, path) => {
          void addToGitignore(mode, path);
        }}
      />

      {goToOpen ? (
        <GoToModal
          kind={goToKind}
          text={goToText}
          setText={setGoToText}
          targetView={goToTargetView}
          setTargetView={setGoToTargetView}
          error={goToError}
          setError={setGoToError}
          activeRepoPath={activeRepoPath}
          onClose={() => setGoToOpen(false)}
          onGo={goToReference}
        />
      ) : null}

      {cherryPickOpen ? (
        <CherryPickModal
          targetBranch={cherryPickTargetBranch}
          setTargetBranch={setCherryPickTargetBranch}
          branchOptions={cherryPickBranchOptions}
          commitHash={cherryPickCommitHash}
          setCommitHash={setCherryPickCommitHash}
          appendOrigin={cherryPickAppendOrigin}
          setAppendOrigin={setCherryPickAppendOrigin}
          noCommit={cherryPickNoCommit}
          setNoCommit={setCherryPickNoCommit}
          busy={cherryPickBusy}
          error={cherryPickError}
          commitLoading={cherryPickCommitLoading}
          commitError={cherryPickCommitError}
          commitSummary={cherryPickCommitSummary}
          activeRepoPath={activeRepoPath}
          onClose={() => setCherryPickOpen(false)}
          onRun={() => void runCherryPick()}
        />
      ) : null}

      {patchOpen ? (
        <PatchModal
          mode={patchMode}
          open={patchOpen}
          activeRepoPath={activeRepoPath}
          defaultCommit={(selectedHash.trim() ? selectedHash.trim() : headHash.trim()).trim()}
          busy={patchBusy}
          error={patchError}
          status={patchStatus}
          patchPath={patchPath}
          setPatchPath={setPatchPath}
          method={patchMethod}
          setMethod={setPatchMethod}
          predictBusy={patchPredictBusy}
          onPickPatchFile={() => void pickPatchFile()}
          onPickSaveFile={() => void pickSavePatchFile()}
          onPredict={() => void predictPatch()}
          onRun={() => void runPatch()}
          onClose={() => setPatchOpen(false)}
        />
      ) : null}

      {patchPredictOpen ? (
        <PatchPredictModal
          busy={patchPredictBusy}
          error={patchPredictError}
          result={patchPredictResult}
          patchPath={patchPath}
          method={patchMethod}
          applyBusy={patchBusy}
          onClose={() => setPatchPredictOpen(false)}
          onApply={() => {
            setPatchPredictError("");
            void runPatch();
          }}
        />
      ) : null}

      {mergeBranchesOpen ? (
        <MergeBranchesModal
          branchToMerge={mergeBranchToMerge}
          setBranchToMerge={setMergeBranchToMerge}
          ffMode={mergeFfMode}
          setFfMode={setMergeFfMode}
          noCommit={mergeNoCommit}
          setNoCommit={setMergeNoCommit}
          squash={mergeSquash}
          setSquash={setMergeSquash}
          allowUnrelatedHistories={mergeAllowUnrelatedHistories}
          setAllowUnrelatedHistories={setMergeAllowUnrelatedHistories}
          autostash={mergeAutostash}
          setAutostash={setMergeAutostash}
          signoff={mergeSignoff}
          setSignoff={setMergeSignoff}
          noVerify={mergeNoVerify}
          setNoVerify={setMergeNoVerify}
          strategy={mergeStrategy}
          setStrategy={setMergeStrategy}
          conflictPreference={mergeConflictPreference}
          setConflictPreference={setMergeConflictPreference}
          logMessages={mergeLogMessages}
          setLogMessages={setMergeLogMessages}
          message={mergeMessage}
          setMessage={setMergeMessage}
          busy={mergeBusy}
          error={mergeError}
          setError={setMergeError}
          branchesLoading={mergeBranchesLoading}
          branchesError={mergeBranchesError}
          branches={mergeBranches}
          currentBranchName={activeBranchName}
          activeRepoPath={activeRepoPath}
          onClose={() => setMergeBranchesOpen(false)}
          onFetch={() => void fetchMergeBranches()}
          onMerge={() => void runMergeBranches()}
        />
      ) : null}

      {diffToolModalOpen ? (
        <DiffToolModal open={diffToolModalOpen} onClose={() => setDiffToolModalOpen(false)} repos={repos} activeRepoPath={activeRepoPath} />
      ) : null}

      {gitignoreModifierOpen ? (
        <GitIgnoreModifierModal
          open={gitignoreModifierOpen}
          activeRepoPath={activeRepoPath}
          onClose={() => setGitignoreModifierOpen(false)}
        />
      ) : null}

      {cleanOldBranchesOpen ? (
        <CleanOldBranchesModal
          days={cleanOldBranchesDays}
          setDays={setCleanOldBranchesDays}
          loading={cleanOldBranchesLoading}
          deleting={cleanOldBranchesDeleting}
          error={cleanOldBranchesError}
          candidates={cleanOldBranchesCandidates}
          selected={cleanOldBranchesSelected}
          setSelected={setCleanOldBranchesSelected}
          selectedCount={cleanOldBranchesSelectedCount}
          onClose={() => setCleanOldBranchesOpen(false)}
          onDelete={() => void runDeleteCleanOldBranches()}
        />
      ) : null}

      <RefBadgeContextMenu
        menu={refBadgeContextMenu}
        menuRef={refBadgeContextMenuRef}
        activeRepoPath={activeRepoPath}
        loading={loading}
        currentBranchName={activeBranchName}
        onClose={() => setRefBadgeContextMenu(null)}
        checkoutLocalBranch={(branch) => void checkoutRefBadgeLocalBranch(branch)}
        checkoutRemoteBranch={(remoteBranch) => void checkoutRefBadgeRemoteBranch(remoteBranch)}
        mergeIntoCurrentBranch={(ref) => void mergeIntoCurrentBranch(ref)}
      />

      {renameBranchOpen ? (
        <RenameBranchModal
          oldName={renameBranchOld}
          newName={renameBranchNew}
          setNewName={setRenameBranchNew}
          busy={renameBranchBusy}
          error={renameBranchError}
          activeRepoPath={activeRepoPath}
          onClose={() => setRenameBranchOpen(false)}
          onRename={() => void runRenameBranch()}
        />
      ) : null}

      {renameTagOpen ? (
        <RenameTagModal
          oldName={renameTagOld}
          newName={renameTagNew}
          setNewName={setRenameTagNew}
          renameOnRemote={renameTagOnRemote}
          setRenameOnRemote={setRenameTagOnRemote}
          busy={renameTagBusy}
          error={renameTagError}
          activeRepoPath={activeRepoPath}
          onClose={() => setRenameTagOpen(false)}
          onRename={() => void runRenameTag()}
        />
      ) : null}

      {filePreviewOpen ? (
        <FilePreviewModal
          path={filePreviewPath}
          mode={filePreviewMode}
          diffToolName={diffTool.difftool}
          diff={filePreviewDiff}
          content={filePreviewContent}
          imageBase64={filePreviewImageBase64}
          loading={filePreviewLoading}
          error={filePreviewError}
          onClose={() => setFilePreviewOpen(false)}
          parsePullPredictConflictPreview={parsePullPredictConflictPreview}
        />
      ) : null}

      {switchBranchOpen ? (
        <SwitchBranchModal
          mode={switchBranchMode}
          setMode={setSwitchBranchMode}
          branchName={switchBranchName}
          setBranchName={setSwitchBranchName}
          remoteLocalMode={switchRemoteLocalMode}
          setRemoteLocalMode={setSwitchRemoteLocalMode}
          remoteLocalName={switchRemoteLocalName}
          setRemoteLocalName={setSwitchRemoteLocalName}
          busy={switchBranchBusy}
          error={switchBranchError}
          setError={setSwitchBranchError}
          branchesLoading={switchBranchesLoading}
          branchesError={switchBranchesError}
          branches={switchBranches}
          activeRepoPath={activeRepoPath}
          onClose={() => setSwitchBranchOpen(false)}
          onFetch={() => void fetchSwitchBranches()}
          onSwitch={() => void runSwitchBranch()}
        />
      ) : null}

      <BranchContextMenu
        menu={branchContextMenu}
        menuRef={branchContextMenuRef}
        activeRepoPath={activeRepoPath}
        loading={loading}
        currentBranchName={activeBranchName}
        onClose={() => setBranchContextMenu(null)}
        resolveRef={(reference) => gitResolveRef({ repoPath: activeRepoPath, reference })}
        setError={setError}
        openCreateBranchDialog={openCreateBranchDialog}
        mergeIntoCurrentBranch={(branch) => void mergeIntoCurrentBranch(branch)}
      />

      <StashContextMenu
        menu={stashContextMenu}
        menuRef={stashContextMenuRef}
        activeRepoPath={activeRepoPath}
        loading={loading}
        getStashesForActiveRepo={() => stashesByRepo[activeRepoPath] ?? []}
        openStashView={(entry) => void openStashView(entry)}
        applyStashByRef={(ref) => void applyStashByRef(ref)}
        confirmDelete={(ref, name) => {
          void (async () => {
            const ok = await confirmDialog({
              title: "Delete stash",
              message: `Delete stash ${name}?`,
              okLabel: "Delete",
              cancelLabel: "Cancel",
            });
            if (!ok) return;
            await dropStashByRef(ref);
          })();
        }}
        onClose={() => setStashContextMenu(null)}
        setError={setError}
      />

      <TagContextMenu
        menu={tagContextMenu}
        menuRef={tagContextMenuRef}
        onClose={() => setTagContextMenu(null)}
        focusTagOnGraph={(tag) => void focusTagOnGraph(tag)}
        focusTagOnCommits={(tag) => void focusTagOnCommits(tag)}
        renameTag={(tag) => openRenameTagDialog(tag)}
        pushTagToOrigin={(tag) => void pushSingleTagToOrigin(tag)}
        deleteLocalTag={(tag) => void deleteLocalTag(tag)}
        deleteRemoteTag={(tag) => void deleteRemoteTag(tag)}
      />

      {detachedHelpOpen ? (
        <DetachedHeadModal
          busy={detachedBusy}
          error={detachedError}
          activeRepoPath={activeRepoPath}
          changedCount={changedCount}
          targetBranch={detachedTargetBranch}
          setTargetBranch={setDetachedTargetBranch}
          branchOptions={detachedBranchOptions}
          saveCommitMessage={detachedSaveCommitMessage}
          setSaveCommitMessage={setDetachedSaveCommitMessage}
          tempBranchName={detachedTempBranchName}
          setTempBranchName={setDetachedTempBranchName}
          tempBranchRandom={detachedTempBranchRandom}
          setTempBranchRandom={setDetachedTempBranchRandom}
          mergeAfterSave={detachedMergeAfterSave}
          setMergeAfterSave={setDetachedMergeAfterSave}
          onClose={() => setDetachedHelpOpen(false)}
          onFixSimple={() => void detachedFixSimple()}
          onFixDiscardChanges={() => void detachedFixDiscardChanges()}
          onSaveByBranch={() => void detachedSaveByBranch()}
          onPrepareCherryPickSteps={() => void detachedPrepareCherryPickSteps()}
          onOpenTerminal={() => void openTerminalProfile()}
          onTogglePreviewZoom={(src) => togglePreviewZoom(src)}
        />
      ) : null}

      {createBranchOpen ? (
        <CreateBranchModal
          name={createBranchName}
          setName={setCreateBranchName}
          at={createBranchAt}
          setAt={setCreateBranchAt}
          checkout={createBranchCheckout}
          setCheckout={setCreateBranchCheckout}
          orphan={createBranchOrphan}
          setOrphan={setCreateBranchOrphan}
          clearWorkingTree={createBranchClearWorkingTree}
          setClearWorkingTree={setCreateBranchClearWorkingTree}
          busy={createBranchBusy}
          error={createBranchError}
          commitLoading={createBranchCommitLoading}
          commitError={createBranchCommitError}
          commitSummary={createBranchCommitSummary}
          activeRepoPath={activeRepoPath}
          onClose={() => setCreateBranchOpen(false)}
          onCreate={() => void runCreateBranch()}
        />
      ) : null}

      {createTagOpen ? (
        <CreateTagModal
          tag={createTagName}
          setTag={setCreateTagName}
          at={createTagAt}
          annotated={createTagAnnotated}
          setAnnotated={setCreateTagAnnotated}
          message={createTagMessage}
          setMessage={setCreateTagMessage}
          force={createTagForce}
          setForce={setCreateTagForce}
          pushToOrigin={createTagPushToOrigin}
          setPushToOrigin={setCreateTagPushToOrigin}
          busy={createTagBusy}
          error={createTagError}
          activeRepoPath={activeRepoPath}
          onClose={() => setCreateTagOpen(false)}
          onCreate={() => void runCreateTag()}
        />
      ) : null}

      {cherryStepsOpen ? (
        <CherryStepsModal
          targetBranch={detachedTargetBranch}
          error={detachedError}
          commitHash={cherryCommitHash}
          reflog={cherryReflog}
          busy={detachedBusy}
          activeRepoPath={activeRepoPath}
          onClose={() => setCherryStepsOpen(false)}
          onCopyHash={() => void copyText(cherryCommitHash)}
          onApply={() => void detachedApplyCherryPick()}
        />
      ) : null}

      {previewZoomSrc ? (
        <PreviewZoomModal src={previewZoomSrc} onClose={() => setPreviewZoomSrc(null)} />
      ) : null}

      {pullPredictOpen ? (
        <PullPredictModal
          busy={pullPredictBusy}
          error={pullPredictError}
          result={pullPredictResult}
          activeRepoPath={activeRepoPath}
          remoteUrl={remoteUrl}
          loading={loading}
          pullBusy={pullBusy}
          onClose={() => setPullPredictOpen(false)}
          onApply={() => {
            if (pullPredictRebase) {
              void startPull("rebase");
            } else {
              void startPull("merge");
            }
            setPullPredictOpen(false);
          }}
          onOpenConflictPreview={(p) => openPullPredictConflictPreview(p, pullPredictResult?.upstream?.trim() ?? "")}
        />
      ) : null}

      {pullConflictOpen ? (
        <PullConflictModal
          operation={pullConflictOperation}
          message={pullConflictMessage}
          files={pullConflictFiles}
          busy={pullBusy}
          onClose={() => setPullConflictOpen(false)}
          onFixConflicts={() => {
            if (!activeRepoPath) return;
            if (pullConflictOperation === "am") {
              void (async () => {
                try {
                  const st = await gitConflictState(activeRepoPath);
                  const real = (st.files ?? []).map((f: any) => (f?.path ?? "").trim()).filter(Boolean);
                  if (real.length > 0) {
                    setPullConflictFiles((prev) => Array.from(new Set([...real, ...(prev ?? [])].map((s) => (s ?? "").trim()).filter(Boolean))));
                    setPullConflictOpen(false);
                    setConflictResolverOpen(true);
                    setConflictResolverKey((v) => v + 1);
                  } else {
                    await continueAfterConflicts();
                  }
                } catch {
                  await continueAfterConflicts();
                }
              })();
              return;
            }

            setPullConflictOpen(false);
            setConflictResolverOpen(true);
            setConflictResolverKey((v) => v + 1);
          }}
          onContinue={() => void continueAfterConflicts()}
          onAbort={() => void abortAfterConflicts()}
          onOpenFilePreview={(p) => openFilePreview(p)}
        />
      ) : null}

      {continueAfterConflictsOpen && activeRepoPath ? (
        <ContinueAfterConflictsModal
          key={continueAfterConflictsKey}
          open={continueAfterConflictsOpen}
          repoPath={activeRepoPath}
          operation={pullConflictOperation}
          initialFiles={pullConflictFiles}
          onClose={() => setContinueAfterConflictsOpen(false)}
          onAbort={async () => {
            setContinueAfterConflictsOpen(false);
            await abortAfterConflicts();
          }}
          onResolveConflicts={() => {
            setContinueAfterConflictsOpen(false);
            setConflictResolverOpen(true);
            setConflictResolverKey((v) => v + 1);
          }}
          onSuccess={async () => {
            setContinueAfterConflictsOpen(false);
            setPullConflictOpen(false);
            setConflictResolverOpen(false);
            if (pullConflictOperation === "cherry-pick") {
              setCherryPickOpen(false);
            }
            await loadRepo(activeRepoPath);
          }}
        />
      ) : null}

      {conflictResolverOpen && activeRepoPath ? (
        <ConflictResolverModal
          key={conflictResolverKey}
          open={conflictResolverOpen}
          repoPath={activeRepoPath}
          operation={pullConflictOperation}
          initialFiles={pullConflictFiles}
          busy={pullBusy}
          onClose={() => setConflictResolverOpen(false)}
          onContinue={() => void continueAfterConflicts()}
          onAbort={() => void abortAfterConflicts()}
          onSkipRebase={() => void skipAfterConflicts()}
        />
      ) : null}

      {stashModalOpen ? (
        <StashModal
          activeRepoPath={activeRepoPath}
          diffToolName={diffTool.difftool}
          defaultFilesView={workingFilesView}
          busy={stashBusy}
          error={stashError}
          message={stashMessage}
          setMessage={setStashMessage}
          advancedMode={stashAdvancedMode}
          onToggleAdvanced={async (next) => {
            await toggleAdvancedMode(next);
          }}
          statusEntries={stashStatusEntries}
          selectedPaths={stashSelectedPaths}
          setSelectedPaths={setStashSelectedPaths}
          previewPath={stashPreviewPath}
          setPreviewPath={setStashPreviewPath}
          setPreviewStatus={setStashPreviewStatus}
          hunkRanges={stashHunkRanges}
          hunksByPath={stashHunksByPath}
          setHunksByPath={setStashHunksByPath}
          previewLoading={stashPreviewLoading}
          previewError={stashPreviewError}
          previewImageBase64={stashPreviewImageBase64}
          previewDiff={stashPreviewDiff}
          previewContent={stashPreviewContent}
          joinPath={joinPath}
          onCopyText={(text) => {
            void copyText(text);
          }}
          onRevealInExplorer={(absPath) => {
            void revealInFileExplorer(absPath);
          }}
          onOpenWorkingFileContextMenu={(path, status, x, y) => {
            openWorkingFileContextMenu("stash", path, status, x, y);
          }}
          onDiscard={(path, status) => {
            void discardWorkingFile("stash", path, status);
          }}
          onDelete={(path) => {
            void deleteWorkingFile("stash", path);
          }}
          onRefresh={async () => {
            await refreshStashStatusEntries();
          }}
          onClose={() => setStashModalOpen(false)}
          onStash={() => void runStash()}
        />
      ) : null}

      {stashViewOpen ? (
        <StashViewModal
          reference={stashViewRef}
          message={stashViewMessage}
          patch={stashViewPatch}
          loading={stashViewLoading}
          error={stashViewError}
          onClose={() => setStashViewOpen(false)}
          onDelete={() => {
            void (async () => {
              const ok = await confirmDialog({
                title: "Delete stash",
                message: `Delete stash ${stashViewMessage?.trim() ? stashViewMessage.trim() : stashViewRef}?`,
                okLabel: "Delete",
                cancelLabel: "Cancel",
              });
              if (!ok) return;
              await dropStashFromView();
            })();
          }}
          onApply={() => void applyStashFromView()}
          deleteDisabled={stashViewLoading || !stashViewRef}
          applyDisabled={stashViewLoading || !stashViewRef}
        />
      ) : null}

      {confirmOpen ? (
        <ConfirmModal
          title={confirmTitle}
          message={confirmMessage}
          okLabel={confirmOkLabel}
          cancelLabel={confirmCancelLabel}
          onCancel={() => resolveConfirm(false)}
          onOk={() => resolveConfirm(true)}
        />
      ) : null}

      {resetModalOpen ? (
        <ResetModal
          resetTarget={resetTarget}
          setResetTarget={setResetTarget}
          resetMode={resetMode}
          setResetMode={setResetMode}
          resetBusy={resetBusy}
          resetError={resetError}
          activeRepoPath={activeRepoPath}
          onClose={() => setResetModalOpen(false)}
          onReset={(mode, target) => void runGitReset(mode, target)}
        />
      ) : null}

      {commitModalOpen ? (
        <CommitModal
          activeRepoPath={activeRepoPath}
          remoteUrl={remoteUrl}
          diffToolName={diffTool.difftool}
          defaultFilesView={workingFilesView}
          busy={commitBusy}
          error={commitError}
          message={commitMessage}
          setMessage={setCommitMessage}
          advancedMode={commitAdvancedMode}
          onToggleAdvanced={async (next) => {
            await toggleCommitAdvancedMode(next);
          }}
          statusEntries={statusEntries}
          selectedPaths={selectedPaths}
          setSelectedPaths={setSelectedPaths}
          previewPath={commitPreviewPath}
          setPreviewPath={setCommitPreviewPath}
          setPreviewStatus={setCommitPreviewStatus}
          previewLoading={commitPreviewLoading}
          previewError={commitPreviewError}
          previewImageBase64={commitPreviewImageBase64}
          previewDiff={commitPreviewDiff}
          previewContent={commitPreviewContent}
          hunkRanges={commitHunkRanges}
          hunksByPath={commitHunksByPath}
          setHunksByPath={setCommitHunksByPath}
          alsoPush={commitAlsoPush}
          setAlsoPush={setCommitAlsoPush}
          joinPath={joinPath}
          onCopyText={(text) => {
            void copyText(text);
          }}
          onRevealInExplorer={(absPath) => {
            void revealInFileExplorer(absPath);
          }}
          onOpenWorkingFileContextMenu={(path, status, x, y) => {
            openWorkingFileContextMenu("commit", path, status, x, y);
          }}
          onDiscard={(path, status) => {
            void discardWorkingFile("commit", path, status);
          }}
          onDelete={(path) => {
            void deleteWorkingFile("commit", path);
          }}
          onRefresh={async () => {
            await refreshCommitStatusEntries();
          }}
          onClose={() => setCommitModalOpen(false)}
          onCommit={() => void runCommit()}
        />
      ) : null}

      {showChangesOpen ? (
        <ChangesModal
          activeRepoPath={activeRepoPath}
          commit={showChangesCommit}
          tool={diffTool}
          onClose={() => setShowChangesOpen(false)}
        />
      ) : null}

      {remoteModalOpen ? (
        <RemoteModal
          urlDraft={remoteUrlDraft}
          setUrlDraft={setRemoteUrlDraft}
          currentUrl={remoteUrl}
          busy={remoteBusy}
          error={remoteError}
          onClose={() => setRemoteModalOpen(false)}
          onSave={() => void saveRemote()}
        />
      ) : null}

      {pushModalOpen ? (
        <PushModal
          remoteUrl={remoteUrl}
          localBranch={pushLocalBranch}
          setLocalBranch={setPushLocalBranch}
          remoteBranch={pushRemoteBranch}
          setRemoteBranch={setPushRemoteBranch}
          force={pushForce}
          setForce={setPushForce}
          withLease={pushWithLease}
          setWithLease={setPushWithLease}
          busy={pushBusy}
          error={pushError}
          onClose={() => setPushModalOpen(false)}
          onPush={() => void runPush()}
        />
      ) : null}

      {cloneModalOpen ? (
        <CloneModal
          busy={cloneBusy}
          error={cloneError}
          progressMessage={cloneProgressMessage}
          progressPercent={cloneProgressPercent}
          repoUrl={cloneRepoUrl}
          setRepoUrl={setCloneRepoUrl}
          destinationFolder={cloneDestinationFolder}
          setDestinationFolder={setCloneDestinationFolder}
          subdirName={cloneSubdirName}
          setSubdirName={setCloneSubdirName}
          targetPath={cloneTargetPath}
          branch={cloneBranch}
          setBranch={setCloneBranch}
          branchesBusy={cloneBranchesBusy}
          branchesError={cloneBranchesError}
          branches={cloneBranches}
          setBranches={setCloneBranches}
          setBranchesError={setCloneBranchesError}
          initSubmodules={cloneInitSubmodules}
          setInitSubmodules={setCloneInitSubmodules}
          downloadFullHistory={cloneDownloadFullHistory}
          setDownloadFullHistory={setCloneDownloadFullHistory}
          bare={cloneBare}
          setBare={setCloneBare}
          origin={cloneOrigin}
          setOrigin={setCloneOrigin}
          singleBranch={cloneSingleBranch}
          setSingleBranch={setCloneSingleBranch}
          onBrowseDestination={() => void pickCloneDestinationFolder()}
          onFetchBranches={() => void fetchCloneBranches()}
          onClose={() => setCloneModalOpen(false)}
          onClone={() => void runCloneRepository()}
        />
      ) : null}

      {gitTrustOpen ? (
        <GitTrustModal
          busy={gitTrustBusy}
          actionError={gitTrustActionError}
          globalCommand={gitTrustGlobalCommand}
          copied={gitTrustCopied}
          currentUsername={currentUsername}
          detailsOpen={gitTrustDetailsOpen}
          details={gitTrustDetails}
          onClose={() => void closeTrustDialogAndRepoIfOpen()}
          onCopyGlobalCommand={() => void copyGitTrustGlobalCommand()}
          onTrustGlobally={() => void trustRepoGloballyAndOpen()}
          onTrustForSession={() => void trustRepoForSessionAndOpen()}
          onChangeOwnership={() => void changeOwnershipAndOpen()}
          onRevealInExplorer={() => void revealRepoInExplorerFromTrustDialog()}
          onOpenTerminal={() => void openTerminalFromTrustDialog()}
          onToggleDetails={() => setGitTrustDetailsOpen((v) => !v)}
        />
      ) : null}

      <SettingsModal open={settingsOpen} activeRepoPath={activeRepoPath} onClose={() => setSettingsOpen(false)} />

      {quickButtonsModalOpen ? (
        <QuickButtonsModal
          open={quickButtonsModalOpen}
          value={quickButtons}
          onClose={() => setQuickButtonsModalOpen(false)}
          onSave={(next) => setQuickButtons(next)}
        />
      ) : null}
    </div>
  );
}

export default App;
