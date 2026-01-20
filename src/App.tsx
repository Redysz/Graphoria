import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import cytoscape, { type Core } from "cytoscape";
import SettingsModal from "./SettingsModal";
import { getCyPalette, useAppSettings } from "./appSettingsStore";
import {
  detectAppPlatform,
  eventToShortcutSpec,
  formatShortcutSpecForDisplay,
  joinShortcutDisplay,
  type ShortcutActionId,
} from "./shortcuts";
import { copyText } from "./utils/clipboard";
import { computeHunkRanges, buildPatchFromUnselectedHunks } from "./utils/diffPatch";
import { fileExtLower, isDocTextPreviewExt, isImageExt } from "./utils/filePreview";
import { normalizeGitPath } from "./utils/gitPath";
import { fnv1a32, md5Hex } from "./utils/hash";
import { parseGitDubiousOwnershipError } from "./utils/gitTrust";
import { authorInitials, shortHash, truncate } from "./utils/text";
import { CommitLaneSvg } from "./features/commits/CommitLaneSvg";
import {
  computeCommitLaneRows,
  computeCompactLaneByHashForGraph,
  type CommitLaneRow,
} from "./features/commits/lanes";
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
import { SwitchBranchModal } from "./components/modals/SwitchBranchModal";
import { PreviewZoomModal } from "./components/modals/PreviewZoomModal";
import { PullConflictModal } from "./components/modals/PullConflictModal";
import { CherryStepsModal } from "./components/modals/CherryStepsModal";
import { PullPredictModal } from "./components/modals/PullPredictModal";
import { CreateBranchModal } from "./components/modals/CreateBranchModal";
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
  GitCloneProgressEvent,
  GitCommit,
  GitCommitSummary,
  GitStatusEntry,
  GitStatusSummary,
  GitStashEntry,
  PullPredictResult,
  PullResult,
  RepoOverview,
} from "./types/git";

import "./App.css";

type GitResetMode = "soft" | "mixed" | "hard";

type ViewportState = {
  zoom: number;
  pan: { x: number; y: number };
};

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
  const [remoteUrlByRepo, setRemoteUrlByRepo] = useState<Record<string, string | null | undefined>>({});
  const [statusSummaryByRepo, setStatusSummaryByRepo] = useState<Record<string, GitStatusSummary | undefined>>({});
  const [aheadBehindByRepo, setAheadBehindByRepo] = useState<Record<string, GitAheadBehind | undefined>>({});
  const [indicatorsUpdatingByRepo, setIndicatorsUpdatingByRepo] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string>("");
  const [errorByRepo, setErrorByRepo] = useState<Record<string, string>>({});
  const [gitTrustOpen, setGitTrustOpen] = useState(false);
  const [gitTrustRepoPath, setGitTrustRepoPath] = useState<string>("");
  const [gitTrustDetails, setGitTrustDetails] = useState<string>("");
  const [gitTrustDetailsOpen, setGitTrustDetailsOpen] = useState(false);
  const [gitTrustBusy, setGitTrustBusy] = useState(false);
  const [gitTrustActionError, setGitTrustActionError] = useState<string>("");
  const [gitTrustCopied, setGitTrustCopied] = useState(false);
  const [currentUsername, setCurrentUsername] = useState<string>("");
  const [repositoryMenuOpen, setRepositoryMenuOpen] = useState(false);
  const [navigateMenuOpen, setNavigateMenuOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [commandsMenuOpen, setCommandsMenuOpen] = useState(false);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const [diffToolModalOpen, setDiffToolModalOpen] = useState(false);
  const [cleanOldBranchesOpen, setCleanOldBranchesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [goToOpen, setGoToOpen] = useState(false);
  const [goToKind, setGoToKind] = useState<"commit" | "tag">("commit");
  const [goToText, setGoToText] = useState<string>("");
  const [goToTargetView, setGoToTargetView] = useState<"graph" | "commits">("graph");
  const [goToError, setGoToError] = useState<string>("");
  const [graphButtonsVisible, setGraphButtonsVisible] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState("Confirm");
  const [confirmMessage, setConfirmMessage] = useState("");
  const [confirmOkLabel, setConfirmOkLabel] = useState("OK");
  const [confirmCancelLabel, setConfirmCancelLabel] = useState("Cancel");
  const confirmResolveRef = useRef<((v: boolean) => void) | null>(null);
  const [autoCenterToken, setAutoCenterToken] = useState(0);

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

  const gitTrustCopyTimeoutRef = useRef<number | null>(null);

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

  const [commitModalOpen, setCommitModalOpen] = useState(false);
  const [statusEntries, setStatusEntries] = useState<GitStatusEntry[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Record<string, boolean>>({});
  const [commitMessage, setCommitMessage] = useState("");
  const [commitAlsoPush, setCommitAlsoPush] = useState(false);
  const [commitBusy, setCommitBusy] = useState(false);
  const [commitError, setCommitError] = useState("");

  const [stashesByRepo, setStashesByRepo] = useState<Record<string, GitStashEntry[] | undefined>>({});

  const [stashModalOpen, setStashModalOpen] = useState(false);
  const [stashStatusEntries, setStashStatusEntries] = useState<GitStatusEntry[]>([]);
  const [stashSelectedPaths, setStashSelectedPaths] = useState<Record<string, boolean>>({});
  const [stashMessage, setStashMessage] = useState("");
  const [stashBusy, setStashBusy] = useState(false);
  const [stashError, setStashError] = useState("");

  const [stashPreviewPath, setStashPreviewPath] = useState("");
  const [stashPreviewStatus, setStashPreviewStatus] = useState("");
  const [stashPreviewDiff, setStashPreviewDiff] = useState("");
  const [stashPreviewContent, setStashPreviewContent] = useState("");
  const [stashPreviewImageBase64, setStashPreviewImageBase64] = useState("");
  const [stashPreviewLoading, setStashPreviewLoading] = useState(false);
  const [stashPreviewError, setStashPreviewError] = useState("");

  const [stashAdvancedMode, setStashAdvancedMode] = useState(false);
  const [stashHunksByPath, setStashHunksByPath] = useState<Record<string, number[]>>({});

  const [stashViewOpen, setStashViewOpen] = useState(false);
  const [stashViewRef, setStashViewRef] = useState<string>("");
  const [stashViewMessage, setStashViewMessage] = useState<string>("");
  const [stashViewPatch, setStashViewPatch] = useState<string>("");
  const [stashViewLoading, setStashViewLoading] = useState(false);
  const [stashViewError, setStashViewError] = useState<string>("");

  const [stashBaseByRepo, setStashBaseByRepo] = useState<Record<string, Record<string, string>>>({});

  const [commitPreviewPath, setCommitPreviewPath] = useState("");
  const [commitPreviewStatus, setCommitPreviewStatus] = useState("");
  const [commitPreviewDiff, setCommitPreviewDiff] = useState("");
  const [commitPreviewContent, setCommitPreviewContent] = useState("");
  const [commitPreviewImageBase64, setCommitPreviewImageBase64] = useState("");
  const [commitPreviewLoading, setCommitPreviewLoading] = useState(false);
  const [commitPreviewError, setCommitPreviewError] = useState("");

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

  const [renameBranchOpen, setRenameBranchOpen] = useState(false);
  const [renameBranchOld, setRenameBranchOld] = useState<string>("");
  const [renameBranchNew, setRenameBranchNew] = useState<string>("");
  const [renameBranchBusy, setRenameBranchBusy] = useState(false);
  const [renameBranchError, setRenameBranchError] = useState<string>("");

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

  const [pullMenuOpen, setPullMenuOpen] = useState(false);
  const [pullBusy, setPullBusy] = useState(false);
  const [pullErrorByRepo, setPullErrorByRepo] = useState<Record<string, string>>({});

  const [terminalMenuOpen, setTerminalMenuOpen] = useState(false);
  const terminalMenuRef = useRef<HTMLDivElement | null>(null);
  const [terminalMenuIndex, setTerminalMenuIndex] = useState(0);
  const shortcutRuntimeRef = useRef<any>({});
  const fullscreenRestoreRef = useRef<{ pos: PhysicalPosition; size: PhysicalSize } | null>(null);

  const [pullConflictOpen, setPullConflictOpen] = useState(false);
  const [pullConflictOperation, setPullConflictOperation] = useState<"merge" | "rebase">("merge");
  const [pullConflictFiles, setPullConflictFiles] = useState<string[]>([]);
  const [pullConflictMessage, setPullConflictMessage] = useState("");

  const [pullPredictOpen, setPullPredictOpen] = useState(false);
  const [pullPredictBusy, setPullPredictBusy] = useState(false);
  const [pullPredictError, setPullPredictError] = useState("");
  const [pullPredictRebase, setPullPredictRebase] = useState(false);
  const [pullPredictResult, setPullPredictResult] = useState<PullPredictResult | null>(null);

  const [filePreviewOpen, setFilePreviewOpen] = useState(false);
  const [filePreviewPath, setFilePreviewPath] = useState("");
  const [filePreviewUpstream, setFilePreviewUpstream] = useState("");
  const [filePreviewMode, setFilePreviewMode] = useState<"normal" | "pullPredict">("normal");
  const [filePreviewDiff, setFilePreviewDiff] = useState("");
  const [filePreviewContent, setFilePreviewContent] = useState("");
  const [filePreviewImageBase64, setFilePreviewImageBase64] = useState("");
  const [filePreviewLoading, setFilePreviewLoading] = useState(false);
  const [filePreviewError, setFilePreviewError] = useState("");

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
  const diffTool = useAppSettings((s) => s.git.diffTool);
  const commitsOnlyHead = useAppSettings((s) => s.git.commitsOnlyHead);
  const commitsHistoryOrder = useAppSettings((s) => s.git.commitsHistoryOrder);
  const showOnlineAvatars = useAppSettings((s) => s.git.showOnlineAvatars);
  const setGit = useAppSettings((s) => s.setGit);
  const tooltipSettings = useAppSettings((s) => s.general.tooltips);
  const showToolbarShortcutHints = useAppSettings((s) => s.general.showToolbarShortcutHints);
  const setGeneral = useAppSettings((s) => s.setGeneral);
  const layout = useAppSettings((s) => s.layout);
  const setLayout = useAppSettings((s) => s.setLayout);
  const terminalSettings = useAppSettings((s) => s.terminal);
  const setTerminal = useAppSettings((s) => s.setTerminal);
  const shortcutBindings = useAppSettings((s) => s.shortcuts.bindings);

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

  const setViewMode = (next: "graph" | "commits") => {
    if (!activeRepoPath) return;
    setViewModeByRepo((prev) => ({ ...prev, [activeRepoPath]: next }));
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

  const pullError = activeRepoPath ? (pullErrorByRepo[activeRepoPath] ?? "") : "";
  function setPullError(msg: string) {
    if (!activeRepoPath) return;
    const m = msg ?? "";
    setPullErrorByRepo((prev) => ({ ...prev, [activeRepoPath]: m }));
  }

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
  const [zoomPct, setZoomPct] = useState<number>(100);

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
  const overview = overviewByRepo[activeRepoPath];
  const remoteUrl = remoteUrlByRepo[activeRepoPath] ?? null;
  const changedCount = statusSummaryByRepo[activeRepoPath]?.changed ?? 0;
  const aheadCount = aheadBehindByRepo[activeRepoPath]?.ahead ?? 0;
  const behindCount = aheadBehindByRepo[activeRepoPath]?.behind ?? 0;
  const indicatorsUpdating = indicatorsUpdatingByRepo[activeRepoPath] ?? false;
  const stashes = stashesByRepo[activeRepoPath] ?? [];

  useEffect(() => {
    if (viewMode !== "graph") return;
    if (!graphSettings.showStashesOnGraph) return;
    if (!activeRepoPath) return;
    if (stashes.length === 0) return;

    let alive = true;
    const repo = activeRepoPath;

    void (async () => {
      const current = stashBaseByRepo[repo] ?? {};
      const missing = stashes.filter((s) => !current[s.reference]);
      if (missing.length === 0) return;

      const results = await Promise.all(
        missing.map(async (s) => {
          try {
            const base = await invoke<string>("git_stash_base_commit", { repoPath: repo, stashRef: s.reference });
            const t = (base ?? "").trim();
            if (!t) return null;
            return [s.reference, t] as const;
          } catch {
            return null;
          }
        }),
      );

      if (!alive) return;
      const patch: Record<string, string> = {};
      for (const r of results) {
        if (!r) continue;
        patch[r[0]] = r[1];
      }
      if (Object.keys(patch).length === 0) return;

      setStashBaseByRepo((prev) => ({
        ...prev,
        [repo]: {
          ...(prev[repo] ?? {}),
          ...patch,
        },
      }));
    })();

    return () => {
      alive = false;
    };
  }, [activeRepoPath, graphSettings.showStashesOnGraph, stashes, stashBaseByRepo, viewMode]);

  const stashHunkRanges = useMemo(() => {
    if (!stashPreviewDiff) return [] as Array<{ index: number; header: string; start: number; end: number }>;
    return computeHunkRanges(stashPreviewDiff).ranges;
  }, [stashPreviewDiff]);

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
      renameBranchOpen,
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
      openResetDialog,
      pickRepository,
      initializeProject,
      loadRepo,
      runFetch,
      openTerminalProfile,
    };
  });

  useEffect(() => {
    const isTextEntryTarget = (t: EventTarget | null) => {
      const el = t instanceof HTMLElement ? t : null;
      if (!el) return false;
      if (el.isContentEditable) return true;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      return !!el.closest("input,textarea,select,[contenteditable='true']");
    };

    const isShortcutCaptureTarget = (t: EventTarget | null) => {
      const el = t instanceof HTMLElement ? t : null;
      if (!el) return false;
      return !!el.closest("[data-shortcut-capture='true']");
    };

    const isBrowserShortcut = (e: KeyboardEvent) => {
      const key = (e.key || "").toLowerCase();
      const primary = e.ctrlKey || e.metaKey;

      if (e.key === "F5") return true;
      if (e.key === "F11") return true;
      if (primary && !e.altKey && (key === "r" || key === "p" || key === "f" || key === "g")) return true;
      if (primary && !e.altKey && (key === "t" || key === "n" || key === "w" || key === "o" || key === "s")) return true;
      if (primary && !e.altKey && (key === "l" || key === "k" || key === "u")) return true;
      if (primary && e.shiftKey && !e.altKey && (key === "i" || key === "j" || key === "c")) return true;
      return false;
    };

    const toggleFullscreen = async () => {
      const win = getCurrentWindow();
      const isFs = await win.isFullscreen();
      if (!isFs) {
        const pos = await win.outerPosition();
        const size = await win.outerSize();
        fullscreenRestoreRef.current = { pos, size };
        await win.setFullscreen(true);
        return;
      }

      await win.setFullscreen(false);
      const restore = fullscreenRestoreRef.current;
      if (!restore) return;
      await win.setSize(new PhysicalSize(restore.size.width, restore.size.height)).catch(() => undefined);
      await win.setPosition(new PhysicalPosition(restore.pos.x, restore.pos.y)).catch(() => undefined);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const s = shortcutRuntimeRef.current;

      const inShortcutCapture = isShortcutCaptureTarget(e.target) || isShortcutCaptureTarget(document.activeElement);
      if (inShortcutCapture) return;

      if (e.key === "F12") {
        e.preventDefault();
        e.stopPropagation();
        void toggleFullscreen();
        return;
      }

      const inTextEntry = isTextEntryTarget(e.target) || isTextEntryTarget(document.activeElement);
      const blockedByBrowser = isBrowserShortcut(e);
      if (blockedByBrowser) {
        e.preventDefault();
        e.stopPropagation();
      }

      const anyModalOpen =
        !!s.gitTrustOpen ||
        !!s.diffToolModalOpen ||
        !!s.cleanOldBranchesOpen ||
        !!s.settingsOpen ||
        !!s.goToOpen ||
        !!s.confirmOpen ||
        !!s.cloneModalOpen ||
        !!s.commitModalOpen ||
        !!s.stashModalOpen ||
        !!s.stashViewOpen ||
        !!s.remoteModalOpen ||
        !!s.pushModalOpen ||
        !!s.resetModalOpen ||
        !!s.createBranchOpen ||
        !!s.renameBranchOpen ||
        !!s.switchBranchOpen ||
        !!s.pullConflictOpen ||
        !!s.pullPredictOpen ||
        !!s.filePreviewOpen ||
        !!s.detachedHelpOpen ||
        !!s.cherryStepsOpen ||
        !!s.previewZoomSrc;

      if (s.terminalMenuOpen) {
        const profiles = (s.terminalSettings?.profiles ?? []) as Array<{ id: string }>;
        const max = profiles.length;

        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          s.setTerminalMenuOpen(false);
          return;
        }
        if (max > 0 && e.key === "ArrowDown") {
          e.preventDefault();
          e.stopPropagation();
          s.setTerminalMenuIndex((i: number) => Math.min(max - 1, i + 1));
          return;
        }
        if (max > 0 && e.key === "ArrowUp") {
          e.preventDefault();
          e.stopPropagation();
          s.setTerminalMenuIndex((i: number) => Math.max(0, i - 1));
          return;
        }
        if (max > 0 && e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          const p = profiles[Math.max(0, Math.min(max - 1, s.terminalMenuIndex))];
          if (!p) return;
          s.setTerminalMenuOpen(false);
          s.setTerminal({ defaultProfileId: p.id });
          s.openTerminalProfile(p.id);
          return;
        }
      }

      if (anyModalOpen) return;
      if (inTextEntry) return;

      const spec = eventToShortcutSpec(e);
      if (!spec) return;

      let actionId: ShortcutActionId | null = null;
      for (const [k, v] of Object.entries(s.shortcutBindings ?? ({} as Record<string, unknown>))) {
        const vv = typeof v === "string" ? v : "";
        if (vv.trim() === spec) {
          actionId = k as ShortcutActionId;
          break;
        }
      }
      if (!actionId) return;

      e.preventDefault();
      e.stopPropagation();

      if (actionId === "cmd.terminalMenu" && !s.activeRepoPath) return;
      if (actionId === "cmd.pullMenu" && !s.activeRepoPath) return;
      if (actionId === "repo.fetch" && !s.activeRepoPath) return;
      if (actionId === "cmd.commit" && !s.activeRepoPath) return;
      if (actionId === "cmd.push" && !s.activeRepoPath) return;
      if (actionId === "cmd.stash" && !s.activeRepoPath) return;
      if (actionId === "cmd.checkoutBranch" && !s.activeRepoPath) return;
      if (actionId === "cmd.reset" && !s.activeRepoPath) return;

      switch (actionId) {
        case "repo.prev":
          s.moveActiveRepoBy(-1);
          return;
        case "repo.next":
          s.moveActiveRepoBy(1);
          return;
        case "panel.branches.show":
          s.setSidebarVisible(true);
          return;
        case "panel.branches.hide":
          s.setSidebarVisible(false);
          return;
        case "panel.details.show":
          s.setDetailsVisible(true);
          return;
        case "panel.details.hide":
          s.setDetailsVisible(false);
          return;
        case "view.graph":
          s.setViewMode("graph");
          return;
        case "view.commits":
          s.setViewMode("commits");
          return;
        case "nav.goToCommit":
          s.setGoToError("");
          s.setGoToKind("commit");
          s.setGoToText("");
          s.setGoToTargetView(s.viewMode);
          s.setGoToOpen(true);
          return;
        case "nav.goToTag":
          s.setGoToError("");
          s.setGoToKind("tag");
          s.setGoToText("");
          s.setGoToTargetView(s.viewMode);
          s.setGoToOpen(true);
          return;
        case "cmd.commit":
          s.openCommitDialog();
          return;
        case "cmd.push":
          s.openPushDialog();
          return;
        case "cmd.stash":
          s.openStashDialog();
          return;
        case "cmd.createBranch": {
          const at = (s.selectedHash?.trim() ? s.selectedHash.trim() : s.headHash?.trim()).trim();
          if (!at) return;
          s.openCreateBranchDialog(at);
          return;
        }
        case "cmd.checkoutBranch":
          s.openSwitchBranchDialog();
          return;
        case "cmd.reset":
          s.openResetDialog();
          return;
        case "repo.open":
          s.pickRepository();
          return;
        case "repo.refresh":
          s.loadRepo();
          return;
        case "repo.initialize":
          s.initializeProject();
          return;
        case "cmd.terminalMenu":
          s.setTerminalMenuOpen((v: boolean) => !v);
          return;
        case "cmd.pullMenu":
          if (!s.activeRepoPath || s.loading || s.pullBusy || !s.remoteUrl) return;
          s.setPullMenuOpen((v: boolean) => !v);
          return;
        case "repo.fetch":
          s.runFetch();
          return;
        case "tool.diffTool":
          s.setDiffToolModalOpen(true);
          return;
        case "view.toggleStashesOnGraph":
          s.setGraph({ showStashesOnGraph: !s.graphSettings.showStashesOnGraph });
          return;
        case "view.toggleTags":
          s.setGraph({ showTags: !s.graphSettings.showTags });
          return;
        case "view.toggleRemoteBranches":
          s.setGraph({ showRemoteBranchesOnGraph: !s.graphSettings.showRemoteBranchesOnGraph });
          return;
        case "view.toggleDetailsWindow":
          s.setDetailsVisible(!(s.layout.detailsHeightPx > 0));
          return;
        case "view.toggleBranchesWindow":
          s.setSidebarVisible(!(s.layout.sidebarWidthPx > 0));
          return;
        case "view.toggleGraphButtons":
          setGraphButtonsVisible((v) => !v);
          return;
        case "view.toggleOnlineAvatars":
          s.setGit({ showOnlineAvatars: !s.showOnlineAvatars });
          return;
        case "view.toggleCommitsOnlyHead":
          s.setGit({ commitsOnlyHead: !s.commitsOnlyHead });
          return;
        case "view.toggleLayoutDirection":
          s.setGraph({ edgeDirection: s.graphSettings.edgeDirection === "to_parent" ? "to_child" : "to_parent" });
          return;
        case "view.toggleTooltips":
          s.setGeneral({ tooltips: { ...s.tooltipSettings, enabled: !s.tooltipSettings.enabled } });
          return;
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  const isDetached = overview?.head_name === "(detached)";
  const activeBranchName = !isDetached ? (overview?.head_name ?? "") : "";

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
    void invoke<string[]>("git_branches_points_at", { repoPath: activeRepoPath, commit: commitContextMenu.hash })
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
      void invoke<GitCommitSummary>("git_commit_summary", { repoPath: activeRepoPath, commit: at })
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

  useEffect(() => {
    if (!gitTrustOpen) return;
    if (currentUsername) return;
    void invoke<string>("get_current_username")
      .then((u) => {
        setCurrentUsername(typeof u === "string" ? u : "");
      })
      .catch(() => {
        setCurrentUsername("");
      });
  }, [gitTrustOpen, currentUsername]);

  useEffect(() => {
    if (gitTrustCopyTimeoutRef.current) {
      window.clearTimeout(gitTrustCopyTimeoutRef.current);
      gitTrustCopyTimeoutRef.current = null;
    }
    setGitTrustCopied(false);
  }, [gitTrustOpen, gitTrustRepoPath]);

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
    void invoke<string[]>("git_branches_points_at", { repoPath: activeRepoPath, commit: headHash })
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

  const graphRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const viewportByRepoRef = useRef<Record<string, ViewportState | undefined>>({});
  const pendingAutoCenterByRepoRef = useRef<Record<string, boolean | undefined>>({});
  const viewportRafRef = useRef<number | null>(null);

  const selectedCommit = useMemo(() => {
    if (!selectedHash) return undefined;
    return commitsAll.find((c) => c.hash === selectedHash);
  }, [commitsAll, selectedHash]);

  const tagsExpanded = activeRepoPath ? (tagsExpandedByRepo[activeRepoPath] ?? false) : false;

  function openCommitContextMenu(hash: string, x: number, y: number) {
    const menuW = 260;
    const menuH = 420;
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

  async function refreshCommitStatusEntries() {
    if (!activeRepoPath) return;
    const entries = await invoke<GitStatusEntry[]>("git_status", { repoPath: activeRepoPath });
    setStatusEntries(entries);
    setSelectedPaths((prev) => {
      const next: Record<string, boolean> = {};
      for (const e of entries) next[e.path] = prev[e.path] ?? true;
      return next;
    });
    const keep = commitPreviewPath && entries.some((e) => e.path === commitPreviewPath) ? commitPreviewPath : (entries[0]?.path ?? "");
    const keepStatus = entries.find((e) => e.path === keep)?.status ?? "";
    setCommitPreviewPath(keep);
    setCommitPreviewStatus(keepStatus);
    setStatusSummaryByRepo((prev) => ({ ...prev, [activeRepoPath]: { changed: entries.length } }));
  }

  async function refreshStashStatusEntries() {
    if (!activeRepoPath) return;
    const entries = await invoke<GitStatusEntry[]>("git_status", { repoPath: activeRepoPath });
    setStashStatusEntries(entries);
    setStashSelectedPaths((prev) => {
      const next: Record<string, boolean> = {};
      for (const e of entries) next[e.path] = prev[e.path] ?? true;
      return next;
    });
    const keep = stashPreviewPath && entries.some((e) => e.path === stashPreviewPath) ? stashPreviewPath : (entries[0]?.path ?? "");
    const keepStatus = entries.find((e) => e.path === keep)?.status ?? "";
    setStashPreviewPath(keep);
    setStashPreviewStatus(keepStatus);
    setStatusSummaryByRepo((prev) => ({ ...prev, [activeRepoPath]: { changed: entries.length } }));
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
      await invoke<void>("git_discard_working_path", { repoPath: activeRepoPath, path, isUntracked });
      if (mode === "commit") await refreshCommitStatusEntries();
      else await refreshStashStatusEntries();
    } catch (e) {
      const msg = typeof e === "string" ? e : JSON.stringify(e);
      if (mode === "commit") setCommitError(msg);
      else setStashError(msg);
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
      await invoke<void>("git_delete_working_path", { repoPath: activeRepoPath, path });
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
      await invoke<void>("git_add_to_gitignore", { repoPath: activeRepoPath, pattern });
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
      await invoke<string>("git_reset", { repoPath: activeRepoPath, mode, target: t });
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
      await invoke<string>("git_switch", { repoPath: activeRepoPath, branch: b, create: false });
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
      await invoke<string>("git_switch", {
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
      const list = await invoke<GitBranchInfo[]>("git_list_branches", { repoPath: activeRepoPath, includeRemote: true });
      setSwitchBranches(Array.isArray(list) ? list : []);
    } catch (e) {
      setSwitchBranches([]);
      setSwitchBranchesError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setSwitchBranchesLoading(false);
    }
  }

  async function fetchSwitchBranches() {
    if (!activeRepoPath) return;
    setSwitchBranchesError("");
    setSwitchBranchesLoading(true);
    try {
      await invoke<string>("git_fetch", { repoPath: activeRepoPath, remoteName: "origin" });
      const list = await invoke<GitBranchInfo[]>("git_list_branches", { repoPath: activeRepoPath, includeRemote: true });
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
        await invoke<string>("git_switch", { repoPath: activeRepoPath, branch: name, create: false });
      } else {
        const remoteRef = name;
        const localName =
          switchRemoteLocalMode === "same" ? remoteRefToLocalName(remoteRef) : switchRemoteLocalName.trim();
        if (!localName) {
          setSwitchBranchError("Local branch name is empty.");
          return;
        }
        await invoke<string>("git_switch", {
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
      await invoke<string>("git_rename_branch", { repoPath: activeRepoPath, oldName, newName });
      setRenameBranchOpen(false);
      await loadRepo(activeRepoPath);
    } catch (e) {
      setRenameBranchError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setRenameBranchBusy(false);
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
      await invoke<string>("git_delete_branch", { repoPath: activeRepoPath, branch: b, force: false });
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
      const list = await invoke<GitBranchInfo[]>("git_list_branches", { repoPath: activeRepoPath, includeRemote: false });
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
          await invoke<string>("git_delete_branch", { repoPath: activeRepoPath, branch: b, force: false });
        } catch (e) {
          failures.push({ branch: b, error: typeof e === "string" ? e : JSON.stringify(e) });
        }
      }

      await refreshCleanOldBranches();

      try {
        const ov = await invoke<RepoOverview>("repo_overview", { repoPath: activeRepoPath });
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
      await invoke<string>("git_create_branch_advanced", {
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
        const isAncestor = await invoke<boolean>("git_is_ancestor", {
          repoPath: activeRepoPath,
          ancestor: h,
          descendant: head,
        });
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
      await invoke<string>("git_reset", { repoPath: activeRepoPath, mode, target: h });
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
    const menuH = 110;
    const maxX = Math.max(0, window.innerWidth - menuW);
    const maxY = Math.max(0, window.innerHeight - menuH);
    setTagContextMenu({
      tag,
      x: Math.min(Math.max(0, x), maxX),
      y: Math.min(Math.max(0, y), maxY),
    });
  }

  async function checkoutCommit(hash: string) {
    if (!activeRepoPath) return;
    const commit = hash.trim();
    if (!commit) return;

    setLoading(true);
    setError("");
    try {
      await invoke<string>("git_checkout_commit", { repoPath: activeRepoPath, commit });
      await loadRepo(activeRepoPath);
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (viewMode !== "graph") return;
    const cy = cyRef.current;
    if (!cy) return;
    applyRefBadges(cy);
  }, [
    activeRepoPath,
    graphSettings.showStashesOnGraph,
    graphSettings.showRemoteBranchesOnGraph,
    stashBaseByRepo,
    stashesByRepo,
    theme,
    viewMode,
    overview?.remotes,
  ]);

  async function checkoutBranch(branch: string) {
    if (!activeRepoPath) return;
    const b = branch.trim();
    if (!b) return;

    setLoading(true);
    setError("");
    try {
      await invoke<string>("git_checkout_branch", { repoPath: activeRepoPath, branch: b });
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
      await invoke<string>("git_reset_hard", { repoPath: activeRepoPath });
      await invoke<string>("git_checkout_branch", { repoPath: activeRepoPath, branch: b });
      await loadRepo(activeRepoPath);
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setLoading(false);
    }
  }

  async function openTerminalProfile(profileId?: string, repoPathOverride?: string) {
    const repoPath = repoPathOverride ?? activeRepoPath;
    if (!repoPath) return;

    const profiles = terminalSettings.profiles ?? [];
    const selected = (profileId ? profiles.find((p) => p.id === profileId) : null) ??
      profiles.find((p) => p.id === terminalSettings.defaultProfileId) ??
      profiles[0];
    if (!selected) {
      setError("No terminal profiles configured.");
      return;
    }

    setError("");
    try {
      await invoke<void>("open_terminal_profile", {
        repoPath,
        kind: selected.kind,
        command: selected.command,
        args: selected.args,
      });
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
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
      await invoke<string>("git_checkout_branch", { repoPath: activeRepoPath, branch: b });
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
      await invoke<string>("git_reset_hard", { repoPath: activeRepoPath });
      await invoke<string>("git_checkout_branch", { repoPath: activeRepoPath, branch: b });
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
      await invoke<string>("git_commit_all", { repoPath: activeRepoPath, message: msg });
      await invoke<string>("git_create_branch", { repoPath: activeRepoPath, branch: tmp });
      await invoke<string>("git_checkout_branch", { repoPath: activeRepoPath, branch: b });

      if (detachedMergeAfterSave) {
        await invoke<string>("git_merge_branch", { repoPath: activeRepoPath, branch: tmp });
        await invoke<string>("git_delete_branch", { repoPath: activeRepoPath, branch: tmp, force: false });
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
      const newHash = await invoke<string>("git_commit_all", { repoPath: activeRepoPath, message: msg });
      setCherryCommitHash(newHash.trim());
      const reflog = await invoke<string>("git_reflog", { repoPath: activeRepoPath, maxCount: 20 });
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
      await invoke<string>("git_reset_hard", { repoPath: activeRepoPath });
      await invoke<string>("git_checkout_branch", { repoPath: activeRepoPath, branch: b });
      await invoke<string>("git_cherry_pick", { repoPath: activeRepoPath, commits: [h] });

      setCherryStepsOpen(false);
      await loadRepo(activeRepoPath);
    } catch (e) {
      setDetachedError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setDetachedBusy(false);
    }
  }

  async function openActiveRepoInExplorer() {
    if (!activeRepoPath) return;

    setError("");
    try {
      await invoke<void>("open_in_file_explorer", { path: activeRepoPath });
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
    }
  }

  async function resolveReferenceToHash(reference: string) {
    if (!activeRepoPath) return "";
    const ref = reference.trim();
    if (!ref) return "";

    setLoading(true);
    setError("");
    try {
      const hash = await invoke<string>("git_resolve_ref", { repoPath: activeRepoPath, reference: ref });
      return hash;
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
      return "";
    } finally {
      setLoading(false);
    }
  }

  function requestAutoCenter() {
    if (!activeRepoPath) return;
    pendingAutoCenterByRepoRef.current[activeRepoPath] = true;
    setAutoCenterToken((t) => t + 1);
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

  function focusOnHash(hash: string, nextZoom?: number, yRatio?: number, attempt = 0) {
    const cy = cyRef.current;
    if (!cy) return;

    cy.resize();

    const node = cy.$id(hash);
    if (node.length === 0) return;

    if (typeof nextZoom === "number") {
      cy.zoom(nextZoom);
    }

    const container = graphRef.current;
    const cyW = cy.width() || 0;
    const cyH = cy.height() || 0;
    const h = cyH || container?.clientHeight || 0;
    if ((cyW <= 0 || cyH <= 0) && attempt < 10) {
      requestAnimationFrame(() => focusOnHash(hash, nextZoom, yRatio, attempt + 1));
      return;
    }

    cy.center(node);

    if (typeof yRatio === "number") {
      const pan = cy.pan();
      const desiredY = h * yRatio;
      const currentY = h / 2;
      cy.pan({ x: pan.x, y: pan.y + (desiredY - currentY) });
    }
  }

  async function startPull(op: "merge" | "rebase") {
    if (!activeRepoPath) return;
    setPullBusy(true);
    setPullError("");
    setError("");
    try {
      const res = await invoke<PullResult>(op === "rebase" ? "git_pull_rebase" : "git_pull", {
        repoPath: activeRepoPath,
        remoteName: "origin",
      });

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

  function openFilePreview(path: string) {
    const p = path.trim();
    if (!p) return;
    setFilePreviewMode("normal");
    setFilePreviewUpstream("");
    setFilePreviewOpen(true);
    setFilePreviewPath(p);
  }

  function openPullPredictConflictPreview(path: string) {
    const p = path.trim();
    if (!p) return;
    const upstream = pullPredictResult?.upstream?.trim() ?? "";
    setFilePreviewMode(upstream ? "pullPredict" : "normal");
    setFilePreviewUpstream(upstream);
    setFilePreviewOpen(true);
    setFilePreviewPath(p);
  }

  useEffect(() => {
    if (!filePreviewOpen || !activeRepoPath || !filePreviewPath) {
      setFilePreviewDiff("");
      setFilePreviewContent("");
      setFilePreviewImageBase64("");
      setFilePreviewError("");
      setFilePreviewLoading(false);
      return;
    }

    let alive = true;
    setFilePreviewLoading(true);
    setFilePreviewError("");
    setFilePreviewDiff("");
    setFilePreviewContent("");
    setFilePreviewImageBase64("");

    const run = async () => {
      try {
        if (filePreviewMode === "pullPredict" && filePreviewUpstream.trim()) {
          const content = await invoke<string>("git_pull_predict_conflict_preview", {
            repoPath: activeRepoPath,
            upstream: filePreviewUpstream,
            path: filePreviewPath,
          });
          if (!alive) return;
          setFilePreviewContent(content);
          return;
        }

        const useExternal = diffTool.difftool !== "Graphoria builtin diff";
        if (useExternal) {
          await invoke<void>("git_launch_external_diff_working", {
            repoPath: activeRepoPath,
            path: filePreviewPath,
            toolPath: diffTool.path,
            command: diffTool.command,
          });
          if (!alive) return;
          setFilePreviewContent("Opened in external diff tool.");
          return;
        }

        const ext = fileExtLower(filePreviewPath);
        if (isImageExt(ext)) {
          const b64 = await invoke<string>("git_working_file_image_base64", {
            repoPath: activeRepoPath,
            path: filePreviewPath,
          });
          if (!alive) return;
          setFilePreviewImageBase64(b64);
          return;
        }

        if (isDocTextPreviewExt(ext)) {
          const diff = await invoke<string>("git_head_vs_working_text_diff", {
            repoPath: activeRepoPath,
            path: filePreviewPath,
            unified: 3,
          });
          if (!alive) return;
          if (diff.trim()) {
            setFilePreviewDiff(diff);
            return;
          }

          const content = await invoke<string>("git_working_file_text_preview", {
            repoPath: activeRepoPath,
            path: filePreviewPath,
          });
          if (!alive) return;
          setFilePreviewContent(content);
          return;
        }

        const diff = await invoke<string>("git_working_file_diff", {
          repoPath: activeRepoPath,
          path: filePreviewPath,
        });
        if (!alive) return;
        if (diff.trim()) {
          setFilePreviewDiff(diff);
          return;
        }

        const content = await invoke<string>("git_working_file_content", {
          repoPath: activeRepoPath,
          path: filePreviewPath,
        });
        if (!alive) return;
        setFilePreviewContent(content);
      } catch (e) {
        if (!alive) return;
        setFilePreviewError(typeof e === "string" ? e : JSON.stringify(e));
      } finally {
        if (!alive) return;
        setFilePreviewLoading(false);
      }
    };

    void run();
    return () => {
      alive = false;
    };
  }, [
    activeRepoPath,
    diffTool.command,
    diffTool.difftool,
    diffTool.path,
    filePreviewMode,
    filePreviewOpen,
    filePreviewPath,
    filePreviewUpstream,
  ]);

  async function predictPull(rebase: boolean) {
    if (!activeRepoPath) return;
    setPullPredictBusy(true);
    setPullPredictError("");
    setPullPredictResult(null);
    setPullPredictRebase(rebase);
    setPullPredictOpen(true);
    try {
      const res = await invoke<PullPredictResult>("git_pull_predict", {
        repoPath: activeRepoPath,
        remoteName: "origin",
        rebase,
      });
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
      const pred = await invoke<PullPredictResult>("git_pull_predict", {
        repoPath: activeRepoPath,
        remoteName: "origin",
        rebase: true,
      });

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
    setPullBusy(true);
    setPullError("");
    try {
      if (pullConflictOperation === "rebase") {
        await invoke<string>("git_rebase_continue", { repoPath: activeRepoPath });
      } else {
        await invoke<string>("git_merge_continue", { repoPath: activeRepoPath });
      }
      setPullConflictOpen(false);
      await loadRepo(activeRepoPath);
    } catch (e) {
      setPullError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setPullBusy(false);
    }
  }

  async function abortAfterConflicts() {
    if (!activeRepoPath) return;
    setPullBusy(true);
    setPullError("");
    try {
      if (pullConflictOperation === "rebase") {
        await invoke<string>("git_rebase_abort", { repoPath: activeRepoPath });
      } else {
        await invoke<string>("git_merge_abort", { repoPath: activeRepoPath });
      }
      setPullConflictOpen(false);
      await loadRepo(activeRepoPath);
    } catch (e) {
      setPullError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setPullBusy(false);
    }
  }

  function focusOnHead() {
    if (!headHash) return;
    focusOnHash(headHash, 1, 0.22);
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

  function zoomBy(factor: number) {
    const cy = cyRef.current;
    if (!cy) return;
    const current = cy.zoom();
    const next = Math.min(5, Math.max(0.1, current * factor));
    const renderedCenter = {
      x: cy.width() / 2,
      y: cy.height() / 2,
    };
    cy.zoom({ level: next, renderedPosition: renderedCenter });
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

    const rowForCommitIndex = (idx: number) => {
      return idx;
    };

    const posFor = (lane: number, row: number) => {
      return { x: lane * laneStep, y: row * rowStep };
    };

    for (let idx = 0; idx < commits.length; idx++) {
      const c = commits[idx];
      const lane = laneByHash.get(c.hash) ?? 0;
      const row = rowForCommitIndex(idx);
      const label = `${shortHash(c.hash)}\n${truncate(c.subject, 100)}`;
      nodes.set(c.hash, {
        data: {
          id: c.hash,
          label,
          refs: c.refs,
        },
        position: posFor(lane, row),
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
  }, [commitsAll, commitsHistoryOrder, graphSettings.edgeDirection, graphSettings.nodeSep, graphSettings.rankSep]);

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

  function applyRefBadges(cy: Core) {
    cy.$("node.refBadge").remove();
    cy.$("edge.refEdge").remove();
    cy.$("node.stashBadge").remove();
    cy.$("edge.stashEdge").remove();

    const sideOffsetX = 240;
    const gapY = 30;
    const colGapX = 150;
    const maxPerCol = 6;

    const edgeSegs = cy
      .edges()
      .toArray()
      .filter((e) => !e.hasClass("refEdge") && !e.hasClass("stashEdge"))
      .map((e) => {
        const s = (e.source() as any).position();
        const t = (e.target() as any).position();
        const x1 = Number(s?.x ?? 0);
        const y1 = Number(s?.y ?? 0);
        const x2 = Number(t?.x ?? 0);
        const y2 = Number(t?.y ?? 0);
        const minX = Math.min(x1, x2);
        const maxX = Math.max(x1, x2);
        const minY = Math.min(y1, y2);
        const maxY = Math.max(y1, y2);
        return { x1, y1, x2, y2, minX, maxX, minY, maxY };
      });

    const segIntersectsRect = (seg: { x1: number; y1: number; x2: number; y2: number }, r: any) => {
      const x1 = seg.x1;
      const y1 = seg.y1;
      const x2 = seg.x2;
      const y2 = seg.y2;

      const inside = (x: number, y: number) => x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2;
      if (inside(x1, y1) || inside(x2, y2)) return true;

      const dx = x2 - x1;
      const dy = y2 - y1;
      let t0 = 0;
      let t1 = 1;

      const clip = (p: number, q: number) => {
        if (p === 0) return q >= 0;
        const r0 = q / p;
        if (p < 0) {
          if (r0 > t1) return false;
          if (r0 > t0) t0 = r0;
        } else {
          if (r0 < t0) return false;
          if (r0 < t1) t1 = r0;
        }
        return true;
      };

      if (!clip(-dx, x1 - r.x1)) return false;
      if (!clip(dx, r.x2 - x1)) return false;
      if (!clip(-dy, y1 - r.y1)) return false;
      if (!clip(dy, r.y2 - y1)) return false;

      return t0 <= t1;
    };

    const bboxIntersectsAnyEdge = (b: any) => {
      for (const seg of edgeSegs) {
        if (seg.minY > b.y2) continue;
        if (seg.maxY < b.y1) continue;
        if (seg.minX > b.x2) continue;
        if (seg.maxX < b.x1) continue;
        if (segIntersectsRect(seg, b)) return true;
      }
      return false;
    };

    const pushNodeAwayFromEdges = (nodeId: string, side: -1 | 1) => {
      const n = cy.$id(nodeId);
      if (n.length === 0) return;
      const step = 40;
      const maxIter = 35;
      for (let i = 0; i < maxIter; i++) {
        const bb0 = n.boundingBox({ includeLabels: true, includeOverlays: false } as any);
        const bb = {
          x1: bb0.x1 - 10,
          y1: bb0.y1 - 6,
          x2: bb0.x2 + 10,
          y2: bb0.y2 + 6,
        };
        if (!bboxIntersectsAnyEdge(bb)) break;
        const pos = n.position();
        n.unlock();
        n.position({ x: pos.x + side * step, y: pos.y });
        n.lock();
      }
    };

    for (const n of cy.nodes().toArray()) {
      if (n.hasClass("refBadge")) continue;
      const refs = (n.data("refs") as string) || "";
      if (!refs.trim()) continue;

      const parsed = parseRefs(refs, overview?.remotes ?? []);
      if (parsed.length === 0) continue;

      let filtered = parsed;
      if (!graphSettings.showRemoteBranchesOnGraph) {
        filtered = filtered.filter((r) => r.kind !== "remote");
      }
      if (!graphSettings.showTags) {
        filtered = filtered.filter((r) => r.kind !== "tag");
      }
      if (filtered.length === 0) continue;

      const pos = n.position();

      const left = filtered.filter((_, i) => i % 2 === 0);
      const right = filtered.filter((_, i) => i % 2 === 1);

      const placeSide = (items: Array<{ kind: "head" | "branch" | "tag" | "remote"; label: string }>, side: -1 | 1) => {
        const visibleCount = Math.min(items.length, maxPerCol);
        const baseY = pos.y - ((visibleCount - 1) * gapY) / 2;

        for (let i = 0; i < items.length; i++) {
          const r = items[i];
          const col = Math.floor(i / maxPerCol);
          const row = i % maxPerCol;
          const id = `ref:${n.id()}:${r.kind}:${r.label}`;
          if (cy.$id(id).length > 0) continue;

          cy.add({
            group: "nodes",
            data: { id, label: r.label, kind: r.kind },
            position: {
              x: pos.x + side * (sideOffsetX + col * colGapX),
              y: baseY + row * gapY,
            },
            classes: `refBadge ref-${r.kind}`,
            locked: true,
            grabbable: false,
            selectable: false,
          } as any);

          cy.add({
            group: "edges",
            data: { id: `refedge:${id}`, source: id, target: n.id() },
            classes: "refEdge",
            selectable: false,
          } as any);
        }
      };

      if (left.length > 0) placeSide(left, -1);
      if (right.length > 0) placeSide(right, 1);
    }

    for (const b of cy.$("node.refBadge").toArray()) {
      const badge = b as any;
      const id = badge.id();
      const parts = id.split(":");
      if (parts.length < 3) continue;
      const targetId = parts[1];
      const target = cy.$id(targetId);
      if (target.length === 0) continue;
      const side: -1 | 1 = badge.position().x < (target as any).position().x ? -1 : 1;
      pushNodeAwayFromEdges(id, side);
    }

    if (!graphSettings.showStashesOnGraph || !activeRepoPath) return;
    const baseMap = stashBaseByRepo[activeRepoPath] ?? {};
    const list = stashesByRepo[activeRepoPath] ?? [];
    if (list.length === 0) return;

    const byBase = new Map<string, GitStashEntry[]>();
    for (const s of list) {
      const base = baseMap[s.reference];
      if (!base) continue;
      const arr = byBase.get(base) ?? [];
      arr.push(s);
      byBase.set(base, arr);
    }

    const stashLine = "rgba(184, 92, 255, 0.75)";
    const stashBg = "rgba(184, 92, 255, 0.16)";
    const stashText = theme === "dark" ? "#f2f4f8" : "#0f0f0f";

    for (const [base, arr] of byBase.entries()) {
      const baseNode = cy.$id(base);
      if (baseNode.length === 0) continue;
      const pos = baseNode.position();

      const maxPerCol = 8;
      const gapY = 28;
      const colGapX = 210;
      const baseX = pos.x - 360;
      const baseY = pos.y + 140;

      for (let i = 0; i < arr.length; i++) {
        const s = arr[i];
        const col = Math.floor(i / maxPerCol);
        const row = i % maxPerCol;
        const safeRef = s.reference.replace(/[^a-zA-Z0-9:_-]/g, "_");
        const id = `stash:${base}:${safeRef}`;
        if (cy.$id(id).length > 0) continue;

        cy.add({
          group: "nodes",
          data: {
            id,
            label: s.message?.trim() ? s.message.trim() : s.reference,
            kind: "stash",
            stashRef: s.reference,
            stashMessage: s.message,
          },
          position: {
            x: baseX - col * colGapX,
            y: baseY + row * gapY,
          },
          classes: "stashBadge",
          locked: true,
          grabbable: false,
          selectable: false,
        } as any);

        cy.add({
          group: "edges",
          data: { id: `stashedge:${id}`, source: id, target: base, label: "stash edge" },
          classes: "stashEdge",
          selectable: false,
        } as any);

        const node = cy.$id(id);
        if (node.length > 0) {
          node.style({
            "border-color": stashLine,
            "background-color": stashBg,
            color: stashText,
          } as any);
          pushNodeAwayFromEdges(id, -1);
        }
      }
    }
  }

  useEffect(() => {
    if (viewMode !== "graph") {
      if (cyRef.current && activeRepoPath) {
        if (!pendingAutoCenterByRepoRef.current[activeRepoPath]) {
          viewportByRepoRef.current[activeRepoPath] = {
            zoom: cyRef.current.zoom(),
            pan: cyRef.current.pan(),
          };
        }
      }
      cyRef.current?.destroy();
      cyRef.current = null;
      return;
    }

    if (!graphRef.current) return;

    cyRef.current?.destroy();

    const palette = getCyPalette(theme);
    cyRef.current = cytoscape({
      container: graphRef.current,
      elements: [...elements.nodes, ...elements.edges],
      minZoom: 0.1,
      maxZoom: 5,
      wheelSensitivity: isMacOS ? 0.14 : 0.6,
      layout: { name: "preset" } as any,
      style: [
        {
          selector: "node",
          style: {
            "background-color": palette.nodeBg,
            "border-color": palette.nodeBorder,
            "border-width": "1px",
            shape: "round-rectangle",
            "corner-radius": `${Math.max(0, graphSettings.nodeCornerRadius)}px`,
            label: "data(label)",
            color: palette.nodeText,
            "text-outline-width": "0px",
            "font-size": "12px",
            "font-weight": "bold",
            "text-wrap": "wrap",
            "text-max-width": "220px",
            "text-valign": "center",
            "text-halign": "center",
            width: "260px",
            height: "56px",
          },
        },
        {
          selector: "node.head",
          style: {
            "border-color": palette.nodeHeadBorder,
            "border-width": "2px",
          },
        },
        {
          selector: "node.selected",
          style: {
            "border-color": palette.nodeSelectedBorder,
            "border-width": "3px",
            "background-color": palette.nodeSelectedBg,
          },
        },
        {
          selector: "node.placeholder",
          style: {
            "background-color": palette.placeholderBg,
            "border-color": palette.placeholderBorder,
            "border-width": "1px",
            color: palette.placeholderText,
          },
        },
        {
          selector: "edge",
          style: {
            width: "3px",
            "line-color": palette.edgeLine,
            "target-arrow-color": palette.edgeArrow,
            "target-arrow-shape": "triangle",
            "target-arrow-fill": "filled",
            "arrow-scale": 1.25,
            "curve-style": "bezier",
          },
        },
        {
          selector: "node.refBadge",
          style: {
            shape: "round-rectangle",
            width: "label",
            height: "24px",
            padding: "6px",
            "background-color": palette.refBadgeBg,
            "border-color": palette.refBadgeBorder,
            "border-width": "1px",
            label: "data(label)",
            color: palette.refBadgeText,
            "font-size": "12px",
            "font-weight": "bold",
            "text-valign": "center",
            "text-halign": "center",
            "text-wrap": "none",
          },
        },
        {
          selector: "node.refBadge.ref-head",
          style: {
            "background-color": palette.refHeadBg,
            "border-color": palette.refHeadBorder,
          },
        },
        {
          selector: "node.refBadge.ref-tag",
          style: {
            "background-color": palette.refTagBg,
            "border-color": palette.refTagBorder,
          },
        },
        {
          selector: "node.refBadge.ref-branch",
          style: {
            "background-color": palette.refBranchBg,
            "border-color": palette.refBranchBorder,
          },
        },
        {
          selector: "node.refBadge.ref-remote",
          style: {
            "background-color": theme === "dark" ? "rgba(235, 246, 255, 0.98)" : palette.refRemoteBg,
            "border-color": palette.refRemoteBorder,
            color: palette.refRemoteText,
            opacity: theme === "dark" ? 0.6 : 0.4,
          },
        },
        {
          selector: "edge.refEdge",
          style: {
            width: "2px",
            "line-style": "dotted",
            "line-color": palette.refEdgeLine,
            "target-arrow-shape": "none",
            "curve-style": "straight",
          },
        },
        {
          selector: "node.stashBadge",
          style: {
            shape: "round-rectangle",
            width: "label",
            height: "22px",
            padding: "6px",
            "border-width": "2px",
            label: "data(label)",
            "font-size": "12px",
            "font-weight": "bold",
            "text-valign": "center",
            "text-halign": "center",
            "text-wrap": "none",
          },
        },
        {
          selector: "edge.stashEdge",
          style: {
            width: "2px",
            "line-style": "dotted",
            "target-arrow-shape": "none",
            "curve-style": "straight",
            label: "data(label)",
            "font-size": "11px",
            "text-rotation": "autorotate",
            color: theme === "dark" ? "rgba(242, 244, 248, 0.85)" : undefined,
            "text-background-color": theme === "dark" ? "rgba(15, 15, 15, 0.80)" : "rgba(255, 255, 255, 0.70)",
            "text-background-opacity": 1,
            "text-background-padding": "2px",
            "text-background-shape": "roundrectangle",
          },
        },
      ],
    });

    const cy = cyRef.current;
    if (!cy) return;

    cy.on("tap", "node", (evt) => {
      if ((evt.target as any).hasClass?.("refBadge")) return;
      if ((evt.target as any).hasClass?.("stashBadge")) return;
      setSelectedHash(evt.target.id());
    });

    cy.on("cxttap", "node", (evt) => {
      if ((evt.target as any).hasClass?.("refBadge")) {
        const oe = (evt as any).originalEvent as MouseEvent | undefined;
        if (!oe) return;
        const kind = (((evt.target as any).data?.("kind") as string) || "").toLowerCase();
        const label = (((evt.target as any).data?.("label") as string) || "").trim();
        if (!label) return;

        setCommitContextMenu(null);
        setStashContextMenu(null);
        setBranchContextMenu(null);
        setTagContextMenu(null);

        if (kind === "remote" || kind === "branch") {
          setRefBadgeContextMenu(null);
          openRefBadgeContextMenu(kind as "remote" | "branch", label, oe.clientX, oe.clientY);
        }
        return;
      }
      if ((evt.target as any).hasClass?.("stashBadge")) {
        const oe = (evt as any).originalEvent as MouseEvent | undefined;
        if (!oe) return;
        const stashRef = ((evt.target as any).data?.("stashRef") as string) || "";
        const stashMessage = ((evt.target as any).data?.("stashMessage") as string) || "";
        if (!stashRef.trim()) return;
        setCommitContextMenu(null);
        setTagContextMenu(null);
        openStashContextMenu(stashRef, stashMessage, oe.clientX, oe.clientY);
        return;
      }
      const hash = evt.target.id();
      const oe = (evt as any).originalEvent as MouseEvent | undefined;
      if (!oe) return;
      setSelectedHash(hash);
      openCommitContextMenu(hash, oe.clientX, oe.clientY);
    });

    cy.on("tap", (evt) => {
      if ((evt.target as any).hasClass?.("stashEdge")) return;
      if (evt.target === cy) setSelectedHash("");
    });

    cy.on("cxttap", (evt) => {
      if (evt.target === cy) {
        setCommitContextMenu(null);
        setStashContextMenu(null);
        setBranchContextMenu(null);
        setTagContextMenu(null);
        setRefBadgeContextMenu(null);
      }
    });

    const scheduleViewportUpdate = () => {
      if (!activeRepoPath) return;
      if (viewportRafRef.current) return;
      viewportRafRef.current = requestAnimationFrame(() => {
        viewportRafRef.current = null;
        if (!pendingAutoCenterByRepoRef.current[activeRepoPath]) {
          viewportByRepoRef.current[activeRepoPath] = {
            zoom: cy.zoom(),
            pan: cy.pan(),
          };
        }
        setZoomPct(Math.round(cy.zoom() * 100));
      });
    };
    cy.on("zoom pan", scheduleViewportUpdate);
    setZoomPct(Math.round(cy.zoom() * 100));

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        cy.resize();
        const saved = activeRepoPath ? viewportByRepoRef.current[activeRepoPath] : undefined;
        if (saved) {
          cy.zoom(saved.zoom);
          cy.pan(saved.pan);
          setZoomPct(Math.round(cy.zoom() * 100));
          applyRefBadges(cy);
        } else {
          focusOnHead();
          scheduleViewportUpdate();
          applyRefBadges(cy);
          if (activeRepoPath) {
            pendingAutoCenterByRepoRef.current[activeRepoPath] = true;
            setAutoCenterToken((t) => t + 1);
          }
        }
      });
    });

    return () => {
      if (viewportRafRef.current) {
        cancelAnimationFrame(viewportRafRef.current);
        viewportRafRef.current = null;
      }
      cyRef.current?.destroy();
      cyRef.current = null;
    };
  }, [
    activeRepoPath,
    elements.edges,
    elements.nodes,
    graphSettings.nodeCornerRadius,
    graphSettings.padding,
    headHash,
    theme,
    viewMode,
  ]);

  useEffect(() => {
    if (viewMode !== "graph") return;

    const el = graphRef.current;
    if (!el) return;

    let attemptTimer: number | null = null;
    let clearPendingTimer: number | null = null;

    const attemptAutoCenter = () => {
      const cy = cyRef.current;
      if (!cy) return;

      if (!activeRepoPath) return;
      if (!pendingAutoCenterByRepoRef.current[activeRepoPath]) return;

      const hash = selectedHash || headHash;
      if (!hash) return;

      cy.resize();

      const cyW = cy.width() || 0;
      const cyH = cy.height() || 0;
      if (cyW <= 0 || cyH <= 0) return;

      const node = cy.$id(hash);
      if (node.length === 0) return;

      focusOnHash(hash, 1, 0.22);

      if (clearPendingTimer) window.clearTimeout(clearPendingTimer);
      clearPendingTimer = window.setTimeout(() => {
        if (!activeRepoPath) return;
        const c = cyRef.current;
        if (c) {
          viewportByRepoRef.current[activeRepoPath] = {
            zoom: c.zoom(),
            pan: c.pan(),
          };
          setZoomPct(Math.round(c.zoom() * 100));
        }
        pendingAutoCenterByRepoRef.current[activeRepoPath] = false;
      }, 350);
    };

    const scheduleAttempt = (delayMs: number) => {
      if (attemptTimer) window.clearTimeout(attemptTimer);
      attemptTimer = window.setTimeout(attemptAutoCenter, delayMs);
    };

    const ro = new ResizeObserver(() => {
      const cy = cyRef.current;
      if (!cy) return;
      cy.resize();

      if (clearPendingTimer) {
        window.clearTimeout(clearPendingTimer);
        clearPendingTimer = null;
      }
      scheduleAttempt(80);
    });

    ro.observe(el);

    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scheduleAttempt(0);
      });
    });

    const t0 = window.setTimeout(() => scheduleAttempt(0), 0);
    const t1 = window.setTimeout(() => scheduleAttempt(0), 150);
    const t2 = window.setTimeout(() => scheduleAttempt(0), 400);
    const t3 = window.setTimeout(() => scheduleAttempt(0), 1000);
    const t4 = window.setTimeout(() => scheduleAttempt(0), 2000);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t0);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.clearTimeout(t4);

      if (attemptTimer) window.clearTimeout(attemptTimer);
      if (clearPendingTimer) window.clearTimeout(clearPendingTimer);
      ro.disconnect();
    };
  }, [activeRepoPath, autoCenterToken, headHash, selectedHash, viewMode]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.$("node").removeClass("selected");
    if (selectedHash) {
      cy.$id(selectedHash).addClass("selected");
    }
    if (!selectedHash && headHash) {
      cy.$id(headHash).addClass("selected");
    }
  }, [selectedHash, headHash, viewMode, elements.nodes.length, elements.edges.length]);

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

  async function refreshIndicators(path: string) {
    if (!path) return;
    setIndicatorsUpdatingByRepo((prev) => ({ ...prev, [path]: true }));
    try {
      const statusSummaryPromise = invoke<GitStatusSummary>("git_status_summary", { repoPath: path })
        .then((statusSummary) => {
          setStatusSummaryByRepo((prev) => ({ ...prev, [path]: statusSummary }));
        })
        .catch(() => undefined);

      const remote = await invoke<string | null>("git_get_remote_url", { repoPath: path, remoteName: "origin" }).catch(() => null);
      setRemoteUrlByRepo((prev) => ({ ...prev, [path]: remote }));

      if (remote) {
        const initialAheadBehind = await invoke<GitAheadBehind>("git_ahead_behind", { repoPath: path, remoteName: "origin" }).catch(
          () => undefined,
        );
        if (initialAheadBehind) {
          setAheadBehindByRepo((prev) => ({ ...prev, [path]: initialAheadBehind }));
        }

        await invoke<string>("git_fetch", { repoPath: path, remoteName: "origin" }).catch(() => undefined);

        const updated = await invoke<GitAheadBehind>("git_ahead_behind", { repoPath: path, remoteName: "origin" }).catch(
          () => initialAheadBehind,
        );
        if (updated) {
          setAheadBehindByRepo((prev) => ({ ...prev, [path]: updated }));
        }
      }

      await statusSummaryPromise;
    } catch {
      // ignore
    } finally {
      setIndicatorsUpdatingByRepo((prev) => ({ ...prev, [path]: false }));
    }
  }

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
    void openRepository(selected);
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
      await invoke<string>("init_repo", { repoPath: selected });
      await openRepository(selected);
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
      const branches = await invoke<string[]>("git_ls_remote_heads", { repoUrl: url });
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
      await invoke<string>("git_clone_repo", {
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
      await openRepository(cloneTargetPath);
    } catch (e) {
      setCloneError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setCloneBusy(false);
      cloneProgressDestRef.current = "";
    }
  }

  async function openCommitDialog() {
    if (!activeRepoPath) return;
    setCommitError("");
    setCommitMessage("");
    setCommitAlsoPush(false);
    setCommitModalOpen(true);
    setCommitPreviewPath("");
    setCommitPreviewStatus("");
    setCommitPreviewDiff("");
    setCommitPreviewContent("");
    setCommitPreviewError("");

    try {
      const entries = await invoke<GitStatusEntry[]>("git_status", { repoPath: activeRepoPath });
      setStatusEntries(entries);
      const nextSelected: Record<string, boolean> = {};
      for (const e of entries) nextSelected[e.path] = true;
      setSelectedPaths(nextSelected);
      const first = entries[0];
      setCommitPreviewPath(first?.path ?? "");
      setCommitPreviewStatus(first?.status ?? "");
      setStatusSummaryByRepo((prev) => ({ ...prev, [activeRepoPath]: { changed: entries.length } }));
    } catch (e) {
      setStatusEntries([]);
      setSelectedPaths({});
      setCommitError(typeof e === "string" ? e : JSON.stringify(e));
    }
  }

  useEffect(() => {
    if (!commitModalOpen || !activeRepoPath || !commitPreviewPath) {
      setCommitPreviewDiff("");
      setCommitPreviewContent("");
      setCommitPreviewImageBase64("");
      setCommitPreviewError("");
      setCommitPreviewLoading(false);
      return;
    }

    let alive = true;
    setCommitPreviewLoading(true);
    setCommitPreviewError("");
    setCommitPreviewDiff("");
    setCommitPreviewContent("");
    setCommitPreviewImageBase64("");

    const run = async () => {
      try {
        const useExternal = diffTool.difftool !== "Graphoria builtin diff";
        if (useExternal) {
          await invoke<void>("git_launch_external_diff_working", {
            repoPath: activeRepoPath,
            path: commitPreviewPath,
            toolPath: diffTool.path,
            command: diffTool.command,
          });
          if (!alive) return;
          setCommitPreviewContent("Opened in external diff tool.");
          return;
        }

        const ext = fileExtLower(commitPreviewPath);
        if (isImageExt(ext)) {
          const b64 = await invoke<string>("git_working_file_image_base64", {
            repoPath: activeRepoPath,
            path: commitPreviewPath,
          });
          if (!alive) return;
          setCommitPreviewImageBase64(b64);
          return;
        }

        const st = commitPreviewStatus.trim();

        if (isDocTextPreviewExt(ext)) {
          if (st.startsWith("??")) {
            const content = await invoke<string>("git_working_file_text_preview", {
              repoPath: activeRepoPath,
              path: commitPreviewPath,
            });
            if (!alive) return;
            setCommitPreviewContent(content);
            return;
          }

          const diff = await invoke<string>("git_head_vs_working_text_diff", {
            repoPath: activeRepoPath,
            path: commitPreviewPath,
            unified: 3,
          });
          if (!alive) return;
          if (diff.trim()) {
            setCommitPreviewDiff(diff);
            return;
          }

          const content = await invoke<string>("git_working_file_text_preview", {
            repoPath: activeRepoPath,
            path: commitPreviewPath,
          });
          if (!alive) return;
          setCommitPreviewContent(content);
          return;
        }

        if (st.startsWith("??")) {
          const content = await invoke<string>("git_working_file_content", {
            repoPath: activeRepoPath,
            path: commitPreviewPath,
          });
          if (!alive) return;
          setCommitPreviewContent(content);
          return;
        }

        const diff = await invoke<string>("git_working_file_diff", {
          repoPath: activeRepoPath,
          path: commitPreviewPath,
        });
        if (!alive) return;
        setCommitPreviewDiff(diff);
      } catch (e) {
        if (!alive) return;
        setCommitPreviewError(typeof e === "string" ? e : JSON.stringify(e));
      } finally {
        if (!alive) return;
        setCommitPreviewLoading(false);
      }
    };

    void run();
    return () => {
      alive = false;
    };
  }, [activeRepoPath, commitModalOpen, commitPreviewPath, commitPreviewStatus, diffTool.command, diffTool.difftool, diffTool.path]);

  async function openStashDialog() {
    if (!activeRepoPath) return;
    setStashError("");
    setStashMessage("");
    setStashModalOpen(true);
    setStashAdvancedMode(false);
    setStashHunksByPath({});
    setStashPreviewPath("");
    setStashPreviewStatus("");
    setStashPreviewDiff("");
    setStashPreviewContent("");
    setStashPreviewError("");

    try {
      const entries = await invoke<GitStatusEntry[]>("git_status", { repoPath: activeRepoPath });
      setStashStatusEntries(entries);
      const nextSelected: Record<string, boolean> = {};
      for (const e of entries) nextSelected[e.path] = true;
      setStashSelectedPaths(nextSelected);
      const first = entries[0];
      setStashPreviewPath(first?.path ?? "");
      setStashPreviewStatus(first?.status ?? "");
      setStatusSummaryByRepo((prev) => ({ ...prev, [activeRepoPath]: { changed: entries.length } }));
    } catch (e) {
      setStashStatusEntries([]);
      setStashSelectedPaths({});
      setStashError(typeof e === "string" ? e : JSON.stringify(e));
    }
  }

  useEffect(() => {
    if (!stashModalOpen || !activeRepoPath || !stashPreviewPath) {
      setStashPreviewDiff("");
      setStashPreviewContent("");
      setStashPreviewImageBase64("");
      setStashPreviewError("");
      setStashPreviewLoading(false);
      return;
    }

    let alive = true;
    setStashPreviewLoading(true);
    setStashPreviewError("");
    setStashPreviewDiff("");
    setStashPreviewContent("");
    setStashPreviewImageBase64("");

    const run = async () => {
      try {
        const useExternal = diffTool.difftool !== "Graphoria builtin diff";
        if (useExternal) {
          await invoke<void>("git_launch_external_diff_working", {
            repoPath: activeRepoPath,
            path: stashPreviewPath,
            toolPath: diffTool.path,
            command: diffTool.command,
          });
          if (!alive) return;
          setStashPreviewContent("Opened in external diff tool.");
          return;
        }

        const ext = fileExtLower(stashPreviewPath);
        if (isImageExt(ext)) {
          const b64 = await invoke<string>("git_working_file_image_base64", {
            repoPath: activeRepoPath,
            path: stashPreviewPath,
          });
          if (!alive) return;
          setStashPreviewImageBase64(b64);
          return;
        }

        const st = stashPreviewStatus.trim();

        if (isDocTextPreviewExt(ext)) {
          if (st.startsWith("??")) {
            const content = await invoke<string>("git_working_file_text_preview", {
              repoPath: activeRepoPath,
              path: stashPreviewPath,
            });
            if (!alive) return;
            setStashPreviewContent(content);
            return;
          }

          const diff = await invoke<string>("git_head_vs_working_text_diff", {
            repoPath: activeRepoPath,
            path: stashPreviewPath,
            unified: stashAdvancedMode ? 20 : 3,
          });
          if (!alive) return;
          if (diff.trim()) {
            setStashPreviewDiff(diff);
            return;
          }

          const content = await invoke<string>("git_working_file_text_preview", {
            repoPath: activeRepoPath,
            path: stashPreviewPath,
          });
          if (!alive) return;
          setStashPreviewContent(content);
          return;
        }

        if (st.startsWith("??")) {
          const content = await invoke<string>("git_working_file_content", {
            repoPath: activeRepoPath,
            path: stashPreviewPath,
          });
          if (!alive) return;
          setStashPreviewContent(content);
          return;
        }

        const diff = await invoke<string>("git_working_file_diff_unified", {
          repoPath: activeRepoPath,
          path: stashPreviewPath,
          unified: stashAdvancedMode ? 20 : 3,
        });
        if (!alive) return;
        setStashPreviewDiff(diff);
      } catch (e) {
        if (!alive) return;
        setStashPreviewError(typeof e === "string" ? e : JSON.stringify(e));
      } finally {
        if (!alive) return;
        setStashPreviewLoading(false);
      }
    };

    void run();
    return () => {
      alive = false;
    };
  }, [activeRepoPath, stashModalOpen, stashPreviewPath, stashPreviewStatus, stashAdvancedMode, diffTool.command, diffTool.difftool, diffTool.path]);

  async function runStash() {
    if (!activeRepoPath) return;

    setStashBusy(true);
    setStashError("");
    try {
      if (!stashAdvancedMode) {
        const paths = stashStatusEntries.filter((e) => stashSelectedPaths[e.path]).map((e) => e.path);
        if (paths.length === 0) {
          setStashError("No files selected.");
          return;
        }

        const includeUntracked = stashStatusEntries.some((e) => {
          if (!stashSelectedPaths[e.path]) return false;
          return e.status.trim().startsWith("??");
        });

        await invoke<string>("git_stash_push_paths", {
          repoPath: activeRepoPath,
          message: stashMessage,
          paths,
          includeUntracked,
        });
      } else {
        if (!stashPreviewPath) {
          setStashError("Select a file.");
          return;
        }

        const ext = fileExtLower(stashPreviewPath);
        if (isImageExt(ext) || isDocTextPreviewExt(ext)) {
          setStashError("Partial stash is not supported for this file type.");
          return;
        }

        const selected = new Set(stashHunksByPath[stashPreviewPath] ?? []);
        if (selected.size === 0) {
          setStashError("No hunks selected.");
          return;
        }

        if (!stashPreviewDiff.trim()) {
          setStashError("No diff available for the selected file.");
          return;
        }

        const keepPatch = buildPatchFromUnselectedHunks(stashPreviewDiff, selected);
        await invoke<string>("git_stash_push_patch", {
          repoPath: activeRepoPath,
          message: stashMessage,
          path: stashPreviewPath,
          keepPatch,
        });
      }

      setStashModalOpen(false);
      await loadRepo(activeRepoPath);
    } catch (e) {
      setStashError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setStashBusy(false);
    }
  }

  async function openStashView(entry: GitStashEntry) {
    if (!activeRepoPath) return;
    setStashViewOpen(true);
    setStashViewRef(entry.reference);
    setStashViewMessage(entry.message);
    setStashViewPatch("");
    setStashViewError("");
    setStashViewLoading(true);
    try {
      const patch = await invoke<string>("git_stash_show", { repoPath: activeRepoPath, stashRef: entry.reference });
      setStashViewPatch(patch);
    } catch (e) {
      setStashViewError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setStashViewLoading(false);
    }
  }

  async function applyStashByRef(stashRef: string) {
    if (!activeRepoPath || !stashRef.trim()) return;
    setLoading(true);
    setError("");
    try {
      await invoke<string>("git_stash_apply", { repoPath: activeRepoPath, stashRef });
      await loadRepo(activeRepoPath);
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setLoading(false);
    }
  }

  async function applyStashFromView() {
    if (!activeRepoPath || !stashViewRef) return;
    setStashViewLoading(true);
    setStashViewError("");
    try {
      await invoke<string>("git_stash_apply", { repoPath: activeRepoPath, stashRef: stashViewRef });
      setStashViewOpen(false);
      await loadRepo(activeRepoPath);
    } catch (e) {
      setStashViewError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setStashViewLoading(false);
    }
  }

  async function dropStashByRef(stashRef: string) {
    if (!activeRepoPath || !stashRef.trim()) return;
    setLoading(true);
    setError("");
    try {
      await invoke<string>("git_stash_drop", { repoPath: activeRepoPath, stashRef });
      await loadRepo(activeRepoPath);
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setLoading(false);
    }
  }

  async function dropStashFromView() {
    if (!activeRepoPath || !stashViewRef) return;
    setStashViewLoading(true);
    setStashViewError("");
    try {
      await invoke<string>("git_stash_drop", { repoPath: activeRepoPath, stashRef: stashViewRef });
      setStashViewOpen(false);
      await loadRepo(activeRepoPath);
    } catch (e) {
      setStashViewError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setStashViewLoading(false);
    }
  }

  async function clearAllStashes() {
    if (!activeRepoPath) return;
    setLoading(true);
    setError("");
    try {
      await invoke<string>("git_stash_clear", { repoPath: activeRepoPath });
      await loadRepo(activeRepoPath);
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setLoading(false);
    }
  }

  async function runCommit() {
    if (!activeRepoPath) return;

    const paths = statusEntries.filter((e) => selectedPaths[e.path]).map((e) => e.path);
    if (paths.length === 0) {
      setCommitError("No files selected.");
      return;
    }

    setCommitBusy(true);
    setCommitError("");
    try {
      await invoke<string>("git_commit", { repoPath: activeRepoPath, message: commitMessage, paths });

      if (commitAlsoPush) {
        const currentRemote = await invoke<string | null>("git_get_remote_url", {
          repoPath: activeRepoPath,
          remoteName: "origin",
        });

        if (!currentRemote) {
          setCommitError("No remote origin set. Configure Remote first.");
          return;
        }

        const headName = overviewByRepo[activeRepoPath]?.head_name ?? "";
        if (headName === "(detached)") {
          setCommitError("Cannot push from detached HEAD.");
          return;
        }

        await invoke<string>("git_push", { repoPath: activeRepoPath, remoteName: "origin", force: false });
      }

      setCommitModalOpen(false);
      await loadRepo(activeRepoPath);
    } catch (e) {
      setCommitError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setCommitBusy(false);
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
      await invoke<void>("git_set_remote_url", {
        repoPath: activeRepoPath,
        remoteName: "origin",
        url: nextUrl,
      });
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

  async function runPush() {
    if (!activeRepoPath) return;
    const localBranch = pushLocalBranch.trim();
    const remoteBranch = pushRemoteBranch.trim();
    if (!localBranch) {
      setPushError("Local branch is empty.");
      return;
    }

    const currentRemote = await invoke<string | null>("git_get_remote_url", {
      repoPath: activeRepoPath,
      remoteName: "origin",
    });
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
      await invoke<string>("git_push", {
        repoPath: activeRepoPath,
        remoteName: "origin",
        branch: refspec,
        force: pushForce,
        withLease: pushWithLease,
      });
      setPushModalOpen(false);
      await loadRepo(activeRepoPath);
    } catch (e) {
      setPushError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setPushBusy(false);
    }
  }

  async function openRepository(path: string) {
    setGlobalError("");
    setErrorByRepo((prev) => ({ ...prev, [path]: "" }));
    setPullErrorByRepo((prev) => ({ ...prev, [path]: "" }));
    setSelectedHash("");
    setLoading(true);

    try {
      await invoke<void>("git_check_worktree", { repoPath: path });
    } catch (e) {
      const msg = typeof e === "string" ? e : JSON.stringify(e);
      const details = parseGitDubiousOwnershipError(msg);
      if (details !== null) {
        setGitTrustRepoPath(path);
        setGitTrustDetails(details);
        setGitTrustDetailsOpen(false);
        setGitTrustActionError("");
        setGitTrustOpen(true);
        setLoading(false);
        return;
      }
      setGlobalError(msg);
      setLoading(false);
      return;
    }

    setViewModeByRepo((prev) => (prev[path] ? prev : { ...prev, [path]: defaultViewMode }));
    setRepos((prev) => (prev.includes(path) ? prev : [...prev, path]));
    setActiveRepoPath(path);
    await loadRepo(path);
  }

  async function closeRepository(path: string) {
    setRepos((prev) => prev.filter((p) => p !== path));
    setViewModeByRepo((prev) => {
      const { [path]: _, ...rest } = prev;
      return rest;
    });
    setOverviewByRepo((prev) => {
      const { [path]: _, ...rest } = prev;
      return rest;
    });
    setCommitsByRepo((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
    setCommitsFullByRepo((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
    setCommitsFullLoadingByRepo((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
    setRemoteUrlByRepo((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
    setStatusSummaryByRepo((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
    setAheadBehindByRepo((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });

    setErrorByRepo((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
    setPullErrorByRepo((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });

    setStashesByRepo((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });

    if (activeRepoPath === path) {
      const remaining = repos.filter((p) => p !== path);
      const nextActive = remaining[0] ?? "";
      setActiveRepoPath(nextActive);
      setSelectedHash("");
    }
  }

  async function loadRepo(nextRepoPath?: string, forceFullHistory?: boolean, updateSelection?: boolean): Promise<boolean> {
    const path = nextRepoPath ?? activeRepoPath;
    if (!path) return false;

    const shouldUpdateSelection = updateSelection !== false;

    const fullHistory =
      typeof forceFullHistory === "boolean" ? forceFullHistory : Boolean(commitsFullByRepo[path]);

    if (shouldUpdateSelection) {
      setLoading(true);
      setError("");
    }
    try {
      const commitsPromise = fullHistory
        ? invoke<GitCommit[]>("list_commits_full", { repoPath: path, onlyHead: commitsOnlyHead, historyOrder: commitsHistoryOrder })
        : invoke<GitCommit[]>("list_commits", { repoPath: path, maxCount: 1200, onlyHead: commitsOnlyHead, historyOrder: commitsHistoryOrder });

      const cs = await commitsPromise;
      setCommitsByRepo((prev) => ({ ...prev, [path]: cs }));

      if (shouldUpdateSelection) {
        const headHash = cs.find((c) => c.is_head)?.hash || "";
        setSelectedHash(headHash);
        setLoading(false);
      }

      void Promise.allSettled([
        invoke<RepoOverview>("repo_overview", { repoPath: path }),
        invoke<GitStatusSummary>("git_status_summary", { repoPath: path }),
      ]).then(([ovRes, statusSummaryRes]) => {
        if (ovRes.status === "fulfilled") {
          setOverviewByRepo((prev) => ({ ...prev, [path]: ovRes.value }));
        }
        if (statusSummaryRes.status === "fulfilled") {
          setStatusSummaryByRepo((prev) => ({ ...prev, [path]: statusSummaryRes.value }));
        }
      });

      void invoke<GitStashEntry[]>("git_stash_list", { repoPath: path })
        .then((stashes) => {
          setStashesByRepo((prev) => ({ ...prev, [path]: stashes }));
        })
        .catch(() => undefined);

      if (shouldUpdateSelection) {
        // selection already updated above (after commits), keep it stable
      }
      return true;
    } catch (e) {
      setOverviewByRepo((prev) => ({ ...prev, [path]: undefined }));
      setCommitsByRepo((prev) => ({ ...prev, [path]: [] }));
      setRemoteUrlByRepo((prev) => ({ ...prev, [path]: undefined }));
      setStatusSummaryByRepo((prev) => ({ ...prev, [path]: undefined }));
      setAheadBehindByRepo((prev) => ({ ...prev, [path]: undefined }));
      setStashesByRepo((prev) => ({ ...prev, [path]: [] }));

      const msg = typeof e === "string" ? e : JSON.stringify(e);
      const details = parseGitDubiousOwnershipError(msg);
      if (details !== null) {
        setGitTrustRepoPath(path);
        setGitTrustDetails(details);
        setGitTrustDetailsOpen(false);
        setGitTrustActionError("");
        setGitTrustOpen(true);
        setError("");
        return false;
      }

      if (shouldUpdateSelection) {
        setError(msg);
      }
      return false;
    } finally {
      if (shouldUpdateSelection) {
        setLoading(false);
      }
    }
  }

  async function trustRepoGloballyAndOpen() {
    if (!gitTrustRepoPath) return;
    setGitTrustBusy(true);
    setGitTrustActionError("");
    try {
      await invoke<void>("git_trust_repo_global", { repoPath: gitTrustRepoPath });
      setGitTrustOpen(false);
      await openRepository(gitTrustRepoPath);
    } catch (e) {
      setGitTrustActionError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setGitTrustBusy(false);
    }
  }

  async function trustRepoForSessionAndOpen() {
    if (!gitTrustRepoPath) return;
    setGitTrustBusy(true);
    setGitTrustActionError("");
    try {
      await invoke<void>("git_trust_repo_session", { repoPath: gitTrustRepoPath });
      setGitTrustOpen(false);
      await openRepository(gitTrustRepoPath);
    } catch (e) {
      setGitTrustActionError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setGitTrustBusy(false);
    }
  }

  async function changeOwnershipAndOpen() {
    if (!gitTrustRepoPath) return;
    const who = currentUsername ? currentUsername : "current user";
    const ok = await confirmDialog({
      title: "Change ownership",
      message: `This will attempt to change ownership of the repository folder to ${who}.\n\nUse this only if you know what you are doing. Continue?`,
      okLabel: "Continue",
      cancelLabel: "Cancel",
    });
    if (!ok) return;

    setGitTrustBusy(true);
    setGitTrustActionError("");
    try {
      await invoke<void>("change_repo_ownership_to_current_user", { repoPath: gitTrustRepoPath });
      setGitTrustOpen(false);
      await openRepository(gitTrustRepoPath);
    } catch (e) {
      setGitTrustActionError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setGitTrustBusy(false);
    }
  }

  async function revealRepoInExplorerFromTrustDialog() {
    if (!gitTrustRepoPath) return;
    setGitTrustBusy(true);
    setGitTrustActionError("");
    try {
      await invoke<void>("open_in_file_explorer", { path: gitTrustRepoPath });
      setGitTrustOpen(false);
    } catch (e) {
      setGitTrustActionError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setGitTrustBusy(false);
    }
  }

  async function openTerminalFromTrustDialog() {
    if (!gitTrustRepoPath) return;
    setGitTrustBusy(true);
    setGitTrustActionError("");
    try {
      await openTerminalProfile(undefined, gitTrustRepoPath);
    } catch (e) {
      setGitTrustActionError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setGitTrustBusy(false);
    }
  }

  async function closeTrustDialogAndRepoIfOpen() {
    const p = gitTrustRepoPath;
    setGitTrustOpen(false);
    setGitTrustActionError("");
    if (!p) return;
    if (repos.includes(p)) {
      await closeRepository(p);
    }
  }

  async function runFetch() {
    if (!activeRepoPath) return;
    setLoading(true);
    setError("");
    try {
      await invoke<string>("git_fetch", { repoPath: activeRepoPath, remoteName: "origin" });
      await loadRepo(activeRepoPath);
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setLoading(false);
    }
  }

  const gitTrustGlobalCommand = gitTrustRepoPath
    ? `git config --global --add safe.directory ${normalizeGitPath(gitTrustRepoPath)}`
    : "";

  async function copyGitTrustGlobalCommand() {
    if (!gitTrustGlobalCommand) return;
    try {
      await copyText(gitTrustGlobalCommand);
      setGitTrustCopied(true);
      if (gitTrustCopyTimeoutRef.current) {
        window.clearTimeout(gitTrustCopyTimeoutRef.current);
      }
      gitTrustCopyTimeoutRef.current = window.setTimeout(() => {
        setGitTrustCopied(false);
        gitTrustCopyTimeoutRef.current = null;
      }, 1200);
    } catch (e) {
      setGitTrustActionError(typeof e === "string" ? e : JSON.stringify(e));
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
              stashesCount={stashes.length}
              selectedHash={selectedHash}
              headHash={headHash}
              openCommitDialog={openCommitDialog}
              openPushDialog={openPushDialog}
              openStashDialog={openStashDialog}
              openCreateBranchDialog={openCreateBranchDialog}
              openSwitchBranchDialog={openSwitchBranchDialog}
              openResetDialog={openResetDialog}
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
            return openTerminalProfile(id);
          }}
          openTerminalDefault={openTerminalProfile}
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
                      {!activeRepoPath || commitsFullByRepo[activeRepoPath] ? null : (
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
                  <div className="commitsList">
                    {commitsAll.map((c) => (
                      <button
                        key={c.hash}
                        data-commit-hash={c.hash}
                        type="button"
                        onClick={() => setSelectedHash(c.hash)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setSelectedHash(c.hash);
                          openCommitContextMenu(c.hash, e.clientX, e.clientY);
                        }}
                        className={
                          c.hash === selectedHash ? "commitRow commitRowSelected" : "commitRow"
                        }
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
          void invoke<void>("reveal_in_file_explorer", { path: absPath });
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

      {diffToolModalOpen ? (
        <DiffToolModal open={diffToolModalOpen} onClose={() => setDiffToolModalOpen(false)} repos={repos} activeRepoPath={activeRepoPath} />
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
        onClose={() => setRefBadgeContextMenu(null)}
        checkoutLocalBranch={(branch) => void checkoutRefBadgeLocalBranch(branch)}
        checkoutRemoteBranch={(remoteBranch) => void checkoutRefBadgeRemoteBranch(remoteBranch)}
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
        onClose={() => setBranchContextMenu(null)}
        resolveRef={(reference) => invoke<string>("git_resolve_ref", { repoPath: activeRepoPath, reference })}
        setError={setError}
        openCreateBranchDialog={openCreateBranchDialog}
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
          onOpenConflictPreview={(p) => openPullPredictConflictPreview(p)}
        />
      ) : null}

      {pullConflictOpen ? (
        <PullConflictModal
          operation={pullConflictOperation}
          message={pullConflictMessage}
          files={pullConflictFiles}
          busy={pullBusy}
          onClose={() => setPullConflictOpen(false)}
          onContinue={() => void continueAfterConflicts()}
          onAbort={() => void abortAfterConflicts()}
          onOpenFilePreview={(p) => openFilePreview(p)}
        />
      ) : null}

      {stashModalOpen ? (
        <StashModal
          activeRepoPath={activeRepoPath}
          diffToolName={diffTool.difftool}
          busy={stashBusy}
          error={stashError}
          message={stashMessage}
          setMessage={setStashMessage}
          advancedMode={stashAdvancedMode}
          onToggleAdvanced={async (next) => {
            if (next && diffTool.difftool !== "Graphoria builtin diff") {
              setStashError("Advanced mode requires Graphoria builtin diff.");
              return;
            }

            if (next && activeRepoPath) {
              try {
                const has = await invoke<boolean>("git_has_staged_changes", { repoPath: activeRepoPath });
                if (has) {
                  setStashError("Index has staged changes. Unstage/commit them before using advanced mode.");
                  return;
                }
              } catch (err) {
                setStashError(typeof err === "string" ? err : JSON.stringify(err));
                return;
              }
            }

            setStashError("");
            setStashAdvancedMode(next);
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
            void invoke<void>("reveal_in_file_explorer", { path: absPath });
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
          busy={commitBusy}
          error={commitError}
          message={commitMessage}
          setMessage={setCommitMessage}
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
          alsoPush={commitAlsoPush}
          setAlsoPush={setCommitAlsoPush}
          joinPath={joinPath}
          onCopyText={(text) => {
            void copyText(text);
          }}
          onRevealInExplorer={(absPath) => {
            void invoke<void>("reveal_in_file_explorer", { path: absPath });
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
    </div>
  );
}

export default App;
