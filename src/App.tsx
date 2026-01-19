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
import { fileExtLower, imageMimeFromExt, isDocTextPreviewExt, isImageExt } from "./utils/filePreview";
import { normalizeGitPath } from "./utils/gitPath";
import { fnv1a32, md5Hex } from "./utils/hash";
import { parseGitDubiousOwnershipError } from "./utils/gitTrust";
import { authorInitials, shortHash, statusBadge, truncate } from "./utils/text";
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
import { RepositoryMenu } from "./components/menus/RepositoryMenu";
import { NavigateMenu } from "./components/menus/NavigateMenu";
import { ViewMenu } from "./components/menus/ViewMenu";
import { CommandsMenu } from "./components/menus/CommandsMenu";
import { ToolsMenu } from "./components/menus/ToolsMenu";
import { MenubarRight } from "./components/menus/MenubarRight";
import DiffView, { parseUnifiedDiff } from "./DiffView";
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

  function PreviewZoomBadge() {
    return (
      <span
        style={{
          position: "absolute",
          right: 10,
          top: 10,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 30,
          height: 30,
          borderRadius: 10,
          border: "1px solid rgba(15, 15, 15, 0.14)",
          background: "rgba(255, 255, 255, 0.92)",
          boxShadow: "0 10px 30px rgba(0, 0, 0, 0.12)",
          pointerEvents: "none",
        }}
        aria-hidden="true"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M10.5 18.5C14.6421 18.5 18 15.1421 18 11C18 6.85786 14.6421 3.5 10.5 3.5C6.35786 3.5 3 6.85786 3 11C3 15.1421 6.35786 18.5 10.5 18.5Z"
            stroke="rgba(15, 15, 15, 0.7)"
            strokeWidth="2"
          />
          <path d="M16.2 16.2L21 21" stroke="rgba(15, 15, 15, 0.7)" strokeWidth="2" strokeLinecap="round" />
          <path d="M10.5 8V14" stroke="rgba(15, 15, 15, 0.7)" strokeWidth="2" strokeLinecap="round" />
          <path d="M7.5 11H13.5" stroke="rgba(15, 15, 15, 0.7)" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </span>
    );
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

      {commitContextMenu ? (
        <div
          className="menuDropdown"
          ref={commitContextMenuRef}
          style={{
            position: "fixed",
            left: commitContextMenu.x,
            top: commitContextMenu.y,
            zIndex: 200,
            minWidth: 220,
          }}
        >
          <button
            type="button"
            disabled={!activeRepoPath}
            onClick={() => {
              const hash = commitContextMenu.hash;
              setCommitContextMenu(null);
              setShowChangesCommit(hash);
              setShowChangesOpen(true);
              setDetailsTab("changes");
              setSelectedHash(hash);
            }}
          >
            Show changes
          </button>
          <button
            type="button"
            onClick={() => {
              void copyText(commitContextMenu.hash);
              setCommitContextMenu(null);
            }}
          >
            Copy hash
          </button>
          <button
            type="button"
            disabled={!activeRepoPath || loading}
            onClick={() => {
              const hash = commitContextMenu.hash;
              setCommitContextMenu(null);
              void checkoutCommit(hash);
            }}
          >
            Checkout this commit
          </button>

          <button
            type="button"
            disabled={!activeRepoPath || loading}
            onClick={() => {
              const hash = commitContextMenu.hash;
              setCommitContextMenu(null);
              openCreateBranchDialog(hash);
            }}
          >
            Create branch…
          </button>

          <button
            type="button"
            disabled={!activeRepoPath || loading}
            onClick={() => {
              const hash = commitContextMenu.hash;
              setCommitContextMenu(null);
              void runCommitContextReset("soft", hash);
            }}
          >
            git reset --soft here
          </button>
          <button
            type="button"
            disabled={!activeRepoPath || loading}
            onClick={() => {
              const hash = commitContextMenu.hash;
              setCommitContextMenu(null);
              void runCommitContextReset("mixed", hash);
            }}
          >
            git reset --mixed here
          </button>
          <button
            type="button"
            disabled={!activeRepoPath || loading}
            onClick={() => {
              const hash = commitContextMenu.hash;
              setCommitContextMenu(null);
              void runCommitContextReset("hard", hash);
            }}
          >
            git reset --hard here
          </button>

          {isDetached && commitContextBranchesLoading ? (
            <button type="button" disabled title="Checking branches that point at this commit…">
              Checking branches…
            </button>
          ) : null}

          {(() => {
            if (!isDetached) return null;
            if (commitContextBranches.length === 0) return null;
            const b = pickPreferredBranch(commitContextBranches);
            if (!b) return null;

            if (changedCount === 0) {
              return (
                <button
                  type="button"
                  title={`Re-attaches HEAD by checking out '${b}'.`}
                  disabled={!activeRepoPath || loading}
                  onClick={() => {
                    setCommitContextMenu(null);
                    void checkoutBranch(b);
                  }}
                >
                  Checkout this commit and branch
                </button>
              );
            }

            return (
              <button
                type="button"
                title={`Discards local changes (git reset --hard) and re-attaches HEAD by checking out '${b}'.`}
                disabled={!activeRepoPath || loading}
                onClick={() => {
                  setCommitContextMenu(null);
                  void resetHardAndCheckoutBranch(b);
                }}
              >
                Reset hard my changes and checkout this commit
              </button>
            );
          })()}
        </div>
      ) : null}

      {workingFileContextMenu ? (
        <div
          className="menuDropdown"
          ref={workingFileContextMenuRef}
          style={{
            position: "fixed",
            left: workingFileContextMenu.x,
            top: workingFileContextMenu.y,
            zIndex: 200,
            minWidth: 260,
          }}
        >
          <button
            type="button"
            disabled={!activeRepoPath || (workingFileContextMenu.mode === "commit" ? commitBusy : stashBusy)}
            onClick={() => {
              const m = workingFileContextMenu;
              setWorkingFileContextMenu(null);
              if (!m) return;
              void discardWorkingFile(m.mode, m.path, m.status);
            }}
          >
            Reset file / Discard changes…
          </button>
          <button
            type="button"
            disabled={!activeRepoPath || (workingFileContextMenu.mode === "commit" ? commitBusy : stashBusy)}
            onClick={() => {
              const m = workingFileContextMenu;
              setWorkingFileContextMenu(null);
              if (!m) return;
              void deleteWorkingFile(m.mode, m.path);
            }}
          >
            Delete file…
          </button>
          <button
            type="button"
            onClick={() => {
              const m = workingFileContextMenu;
              setWorkingFileContextMenu(null);
              if (!m) return;
              void copyText(m.path);
            }}
          >
            Copy path (relative)
          </button>
          <button
            type="button"
            disabled={!activeRepoPath || (workingFileContextMenu.mode === "commit" ? commitBusy : stashBusy)}
            onClick={() => {
              const m = workingFileContextMenu;
              setWorkingFileContextMenu(null);
              if (!m || !activeRepoPath) return;
              const sep = activeRepoPath.includes("\\") ? "\\" : "/";
              const abs = joinPath(activeRepoPath, m.path.replace(/[\\/]/g, sep));
              void copyText(abs);
            }}
          >
            Copy path (absolute)
          </button>
          <button
            type="button"
            disabled={!activeRepoPath || (workingFileContextMenu.mode === "commit" ? commitBusy : stashBusy)}
            onClick={() => {
              const m = workingFileContextMenu;
              setWorkingFileContextMenu(null);
              if (!m || !activeRepoPath) return;
              const sep = activeRepoPath.includes("\\") ? "\\" : "/";
              const abs = joinPath(activeRepoPath, m.path.replace(/[\\/]/g, sep));
              void invoke<void>("reveal_in_file_explorer", { path: abs });
            }}
          >
            Reveal in File Explorer
          </button>
          <button
            type="button"
            disabled={!activeRepoPath || (workingFileContextMenu.mode === "commit" ? commitBusy : stashBusy)}
            onClick={() => {
              const m = workingFileContextMenu;
              setWorkingFileContextMenu(null);
              if (!m) return;
              void addToGitignore(m.mode, m.path.replace(/\\/g, "/"));
            }}
          >
            Add to .gitignore
          </button>
        </div>
      ) : null}

      {goToOpen ? (
        <div className="modalOverlay" role="dialog" aria-modal="true">
          <div className="modal" style={{ width: "min(560px, 96vw)", maxHeight: "min(84vh, 560px)" }}>
            <div className="modalHeader">
              <div style={{ fontWeight: 900 }}>{goToKind === "commit" ? "Go to commit" : "Go to tag"}</div>
              <button type="button" onClick={() => setGoToOpen(false)}>
                Close
              </button>
            </div>
            <div className="modalBody" style={{ display: "grid", gap: 12 }}>
              {goToError ? <div className="error">{goToError}</div> : null}

              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontWeight: 900, opacity: 0.75 }}>{goToKind === "commit" ? "Commit hash / ref" : "Tag name"}</div>
                <input
                  className="modalInput"
                  value={goToText}
                  onChange={(e) => setGoToText(e.target.value)}
                  placeholder={goToKind === "commit" ? "e.g. a1b2c3d or HEAD~3" : "e.g. v1.2.3"}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setGoToOpen(false);
                      return;
                    }
                    if (e.key === "Enter") {
                      void (async () => {
                        if (!activeRepoPath) return;
                        const ref = goToText.trim();
                        if (!ref) {
                          setGoToError("Enter a value.");
                          return;
                        }
                        setGoToError("");
                        const ok = await goToReference(ref, goToTargetView);
                        if (ok) setGoToOpen(false);
                      })();
                    }
                  }}
                  autoFocus
                />
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontWeight: 900, opacity: 0.75 }}>Target view</div>
                <select value={goToTargetView} onChange={(e) => setGoToTargetView(e.target.value as "graph" | "commits")}>
                  <option value="graph">Graph</option>
                  <option value="commits">Commits</option>
                </select>
              </div>
            </div>
            <div className="modalFooter">
              <button
                type="button"
                onClick={() => {
                  void (async () => {
                    if (!activeRepoPath) return;
                    const ref = goToText.trim();
                    if (!ref) {
                      setGoToError("Enter a value.");
                      return;
                    }
                    setGoToError("");
                    const ok = await goToReference(ref, goToTargetView);
                    if (ok) setGoToOpen(false);
                  })();
                }}
                disabled={!activeRepoPath}
              >
                Go
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {diffToolModalOpen ? (
        <DiffToolModal open={diffToolModalOpen} onClose={() => setDiffToolModalOpen(false)} repos={repos} activeRepoPath={activeRepoPath} />
      ) : null}

      {cleanOldBranchesOpen ? (
        <div className="modalOverlay" role="dialog" aria-modal="true">
          <div className="modal" style={{ width: "min(980px, 96vw)", maxHeight: "min(84vh, 900px)" }}>
            <div className="modalHeader">
              <div style={{ fontWeight: 900 }}>Clean old branches</div>
              <button type="button" onClick={() => setCleanOldBranchesOpen(false)} disabled={cleanOldBranchesDeleting}>
                Close
              </button>
            </div>
            <div className="modalBody" style={{ display: "grid", gap: 12, minHeight: 0 }}>
              {cleanOldBranchesError ? <div className="error">{cleanOldBranchesError}</div> : null}

              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 10, alignItems: "center" }}>
                  <div style={{ fontWeight: 900, opacity: 0.75 }}>Stale if last commit older than</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <input
                      className="modalInput"
                      type="number"
                      min={0}
                      step={1}
                      value={String(cleanOldBranchesDays)}
                      disabled={cleanOldBranchesLoading || cleanOldBranchesDeleting}
                      onChange={(e) => {
                        const n = parseInt(e.target.value, 10);
                        setCleanOldBranchesDays(Number.isFinite(n) ? Math.max(0, n) : 0);
                      }}
                      style={{ width: 140 }}
                    />
                    <div style={{ fontWeight: 800, opacity: 0.75 }}>days</div>
                    {cleanOldBranchesLoading ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, opacity: 0.7 }}>
                        <span className="miniSpinner" />
                        <span>Scanning…</span>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div style={{ opacity: 0.8, fontWeight: 800 }}>
                  This tool only deletes local branches. It does NOT delete anything on remotes.
                </div>
              </div>

              <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--panel)", minHeight: 0 }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "42px 1fr 200px 90px",
                    gap: 10,
                    alignItems: "center",
                    padding: "10px 12px",
                    borderBottom: "1px solid rgba(15, 15, 15, 0.08)",
                    background: "var(--panel)",
                    fontWeight: 900,
                    opacity: 0.8,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={cleanOldBranchesCandidates.length > 0 && cleanOldBranchesSelectedCount === cleanOldBranchesCandidates.length}
                    ref={(el) => {
                      if (!el) return;
                      el.indeterminate =
                        cleanOldBranchesSelectedCount > 0 && cleanOldBranchesSelectedCount < cleanOldBranchesCandidates.length;
                    }}
                    onChange={(e) => {
                      const v = e.target.checked;
                      setCleanOldBranchesSelected(() => {
                        const next: Record<string, boolean> = {};
                        for (const r of cleanOldBranchesCandidates) next[r.name] = v;
                        return next;
                      });
                    }}
                    disabled={cleanOldBranchesLoading || cleanOldBranchesDeleting || cleanOldBranchesCandidates.length === 0}
                    title="Select all"
                  />
                  <div>Branch</div>
                  <div>Last commit</div>
                  <div style={{ textAlign: "right" }}>Age</div>
                </div>

                <div style={{ overflow: "auto", maxHeight: "min(52vh, 520px)" }}>
                  {cleanOldBranchesCandidates.length === 0 ? (
                    <div style={{ padding: 12, opacity: 0.75 }}>
                      {cleanOldBranchesLoading ? "Scanning…" : "No branches match the current criteria."}
                    </div>
                  ) : (
                    cleanOldBranchesCandidates.map((r) => (
                      <div
                        key={r.name}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "42px 1fr 200px 90px",
                          gap: 10,
                          alignItems: "center",
                          padding: "10px 12px",
                          borderBottom: "1px solid rgba(15, 15, 15, 0.06)",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={!!cleanOldBranchesSelected[r.name]}
                          onChange={(e) => setCleanOldBranchesSelected((prev) => ({ ...prev, [r.name]: e.target.checked }))}
                          disabled={cleanOldBranchesLoading || cleanOldBranchesDeleting}
                        />
                        <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12 }}>
                          {r.name}
                        </div>
                        <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12, opacity: 0.85 }}>
                          {r.committer_date}
                        </div>
                        <div style={{ textAlign: "right", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12, opacity: 0.85 }}>
                          {typeof r.daysOld === "number" ? `${r.daysOld}d` : ""}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="modalFooter" style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <button type="button" onClick={() => setCleanOldBranchesOpen(false)} disabled={cleanOldBranchesDeleting}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void runDeleteCleanOldBranches()}
                disabled={cleanOldBranchesLoading || cleanOldBranchesDeleting || cleanOldBranchesSelectedCount === 0}
                title={cleanOldBranchesSelectedCount === 0 ? "No branches selected" : undefined}
              >
                {cleanOldBranchesDeleting ? "Deleting…" : `Delete (${cleanOldBranchesSelectedCount})`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {refBadgeContextMenu ? (
        <div
          className="menuDropdown"
          ref={refBadgeContextMenuRef}
          style={{
            position: "fixed",
            left: refBadgeContextMenu.x,
            top: refBadgeContextMenu.y,
            zIndex: 200,
            minWidth: 220,
          }}
        >
          {refBadgeContextMenu.kind === "branch" ? (
            <button
              type="button"
              disabled={!activeRepoPath || loading}
              onClick={() => {
                const b = refBadgeContextMenu.label;
                setRefBadgeContextMenu(null);
                void checkoutRefBadgeLocalBranch(b);
              }}
            >
              Checkout branch
            </button>
          ) : (
            <button
              type="button"
              disabled={!activeRepoPath || loading}
              onClick={() => {
                const r = refBadgeContextMenu.label;
                setRefBadgeContextMenu(null);
                void checkoutRefBadgeRemoteBranch(r);
              }}
            >
              Checkout remote branch
            </button>
          )}
        </div>
      ) : null}

      {renameBranchOpen ? (
        <div className="modalOverlay" role="dialog" aria-modal="true">
          <div className="modal" style={{ width: "min(640px, 96vw)", maxHeight: "min(60vh, 520px)" }}>
            <div className="modalHeader">
              <div style={{ fontWeight: 900 }}>Rename branch</div>
              <button type="button" onClick={() => setRenameBranchOpen(false)} disabled={renameBranchBusy}>
                Close
              </button>
            </div>
            <div className="modalBody">
              {renameBranchError ? <div className="error">{renameBranchError}</div> : null}
              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 800, opacity: 0.8 }}>Old name</div>
                  <input value={renameBranchOld} className="modalInput" disabled />
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 800, opacity: 0.8 }}>New name</div>
                  <input
                    value={renameBranchNew}
                    onChange={(e) => setRenameBranchNew(e.target.value)}
                    className="modalInput"
                    disabled={renameBranchBusy}
                  />
                </div>
              </div>
            </div>
            <div className="modalFooter" style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <button type="button" onClick={() => setRenameBranchOpen(false)} disabled={renameBranchBusy}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void runRenameBranch()}
                disabled={renameBranchBusy || !activeRepoPath || !renameBranchNew.trim() || renameBranchNew.trim() === renameBranchOld.trim()}
              >
                {renameBranchBusy ? "Renaming…" : "Rename"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {filePreviewOpen ? (
        <div className="modalOverlay" role="dialog" aria-modal="true" style={{ zIndex: 320 }}>
          <div className="modal" style={{ width: "min(1100px, 96vw)", maxHeight: "min(80vh, 900px)" }}>
            <div className="modalHeader">
              <div style={{ fontWeight: 900 }}>File preview</div>
              <button type="button" onClick={() => setFilePreviewOpen(false)} disabled={filePreviewLoading}>
                Close
              </button>
            </div>
            <div className="modalBody">
              <div className="mono" style={{ opacity: 0.85, wordBreak: "break-all", marginBottom: 10 }}>
                {filePreviewPath}
              </div>

              {filePreviewError ? <div className="error">{filePreviewError}</div> : null}
              {filePreviewLoading ? <div style={{ opacity: 0.7 }}>Loading…</div> : null}

              {!filePreviewLoading && !filePreviewError ? (
                diffTool.difftool !== "Graphoria builtin diff" ? (
                  <div style={{ opacity: 0.75 }}>Opened in external diff tool.</div>
                ) : filePreviewImageBase64 ? (
                  <div
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      maxHeight: "min(62vh, 720px)",
                      overflow: "hidden",
                    }}
                  >
                    <img
                      src={`data:${imageMimeFromExt(fileExtLower(filePreviewPath))};base64,${filePreviewImageBase64}`}
                      style={{ width: "100%", height: "100%", maxHeight: "min(62vh, 720px)", objectFit: "contain", display: "block" }}
                    />
                  </div>
                ) : filePreviewDiff ? (
                  <pre className="diffCode" style={{ maxHeight: "min(62vh, 720px)", border: "1px solid var(--border)", borderRadius: 12 }}>
                    {parseUnifiedDiff(filePreviewDiff).map((l, i) => (
                      <div key={i} className={`diffLine diffLine-${l.kind}`}>
                        {l.text}
                      </div>
                    ))}
                  </pre>
                ) : filePreviewContent ? (
                  filePreviewMode === "pullPredict" ? (
                    <div style={{ display: "grid", gap: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 900, opacity: 0.75 }}>Legend:</span>
                        <span className="conflictLegend conflictLegend-ours">ours</span>
                        <span className="conflictLegend conflictLegend-base">base</span>
                        <span className="conflictLegend conflictLegend-theirs">theirs</span>
                      </div>
                      <pre className="diffCode" style={{ maxHeight: "min(62vh, 720px)", border: "1px solid var(--border)", borderRadius: 12 }}>
                        {parsePullPredictConflictPreview(filePreviewContent).map((l, i) => (
                          <div key={i} className={`conflictLine conflictLine-${l.kind}`}>
                            {l.text}
                          </div>
                        ))}
                      </pre>
                    </div>
                  ) : (
                    <pre className="diffCode" style={{ maxHeight: "min(62vh, 720px)", border: "1px solid var(--border)", borderRadius: 12 }}>
                      {filePreviewContent.replace(/\r\n/g, "\n")}
                    </pre>
                  )
                ) : (
                  <div style={{ opacity: 0.75 }}>No preview.</div>
                )
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {switchBranchOpen ? (
        <div className="modalOverlay" role="dialog" aria-modal="true">
          <div className="modal" style={{ width: "min(760px, 96vw)", maxHeight: "min(70vh, 620px)" }}>
            <div className="modalHeader">
              <div style={{ fontWeight: 900 }}>Checkout (Switch) branch</div>
              <button type="button" onClick={() => setSwitchBranchOpen(false)} disabled={switchBranchBusy}>
                Close
              </button>
            </div>
            <div className="modalBody">
              {switchBranchError ? <div className="error">{switchBranchError}</div> : null}
              {switchBranchesError ? <div className="error">{switchBranchesError}</div> : null}

              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                    <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 800 }}>
                      <input
                        type="radio"
                        name="switchMode"
                        checked={switchBranchMode === "local"}
                        onChange={() => {
                          setSwitchBranchMode("local");
                          setSwitchBranchError("");
                        }}
                        disabled={switchBranchBusy}
                      />
                      Local branch
                    </label>
                    <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 800 }}>
                      <input
                        type="radio"
                        name="switchMode"
                        checked={switchBranchMode === "remote"}
                        onChange={() => {
                          setSwitchBranchMode("remote");
                          setSwitchBranchError("");
                        }}
                        disabled={switchBranchBusy}
                      />
                      Remote branch
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => void fetchSwitchBranches()}
                    disabled={switchBranchBusy || switchBranchesLoading || !activeRepoPath}
                    title="Fetch and refresh remote branches"
                  >
                    {switchBranchesLoading ? "Fetching…" : "Fetch"}
                  </button>
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 800, opacity: 0.8 }}>
                    {switchBranchMode === "local" ? "Branch" : "Remote branch"}
                  </div>
                  <input
                    value={switchBranchName}
                    onChange={(e) => setSwitchBranchName(e.target.value)}
                    className="modalInput"
                    disabled={switchBranchBusy}
                    list={switchBranchMode === "local" ? "switchLocalBranches" : "switchRemoteBranches"}
                    placeholder={switchBranchMode === "local" ? "main" : "origin/main"}
                  />
                  <datalist id="switchLocalBranches">
                    {switchBranches
                      .filter((b) => b.kind === "local")
                      .slice()
                      .sort((a, b) => (b.committer_date || "").localeCompare(a.committer_date || ""))
                      .map((b) => (
                        <option key={`l-${b.name}`} value={b.name} />
                      ))}
                  </datalist>
                  <datalist id="switchRemoteBranches">
                    {switchBranches
                      .filter((b) => b.kind === "remote")
                      .slice()
                      .sort((a, b) => (b.committer_date || "").localeCompare(a.committer_date || ""))
                      .map((b) => (
                        <option key={`r-${b.name}`} value={b.name} />
                      ))}
                  </datalist>
                </div>

                {switchBranchMode === "remote" ? (
                  <div style={{ display: "grid", gap: 10 }}>
                    <div style={{ fontWeight: 800, opacity: 0.8 }}>Local branch</div>
                    <label style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <input
                        type="radio"
                        name="remoteLocalMode"
                        checked={switchRemoteLocalMode === "same"}
                        onChange={() => setSwitchRemoteLocalMode("same")}
                        disabled={switchBranchBusy}
                      />
                      <div>
                        <div style={{ fontWeight: 800 }}>Reset/Create local branch with the same name</div>
                        <div style={{ opacity: 0.75, fontSize: 12 }}>
                          Uses <span className="mono">git switch --track -C</span>.
                        </div>
                      </div>
                    </label>
                    <label style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <input
                        type="radio"
                        name="remoteLocalMode"
                        checked={switchRemoteLocalMode === "custom"}
                        onChange={() => setSwitchRemoteLocalMode("custom")}
                        disabled={switchBranchBusy}
                      />
                      <div style={{ display: "grid", gap: 6, flex: 1 }}>
                        <div style={{ fontWeight: 800 }}>Create local branch with name</div>
                        <input
                          value={switchRemoteLocalName}
                          onChange={(e) => setSwitchRemoteLocalName(e.target.value)}
                          className="modalInput"
                          disabled={switchBranchBusy || switchRemoteLocalMode !== "custom"}
                          placeholder="feature/my-local"
                        />
                      </div>
                    </label>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="modalFooter" style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <button type="button" onClick={() => setSwitchBranchOpen(false)} disabled={switchBranchBusy}>
                Cancel
              </button>
              <button type="button" onClick={() => void runSwitchBranch()} disabled={switchBranchBusy || !activeRepoPath || !switchBranchName.trim()}>
                {switchBranchBusy ? "Switching…" : "Switch"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {branchContextMenu ? (
        <div
          className="menuDropdown"
          ref={branchContextMenuRef}
          style={{
            position: "fixed",
            left: branchContextMenu.x,
            top: branchContextMenu.y,
            zIndex: 200,
            minWidth: 220,
          }}
        >
          <button
            type="button"
            disabled={!activeRepoPath || loading}
            onClick={() => {
              if (!activeRepoPath) return;
              const branch = branchContextMenu.branch;
              setBranchContextMenu(null);
              void (async () => {
                try {
                  const hash = await invoke<string>("git_resolve_ref", { repoPath: activeRepoPath, reference: branch });
                  const at = (hash ?? "").trim();
                  if (!at) {
                    setError(`Could not resolve branch '${branch}' to a commit.`);
                    return;
                  }
                  openCreateBranchDialog(at);
                } catch (e) {
                  setError(typeof e === "string" ? e : JSON.stringify(e));
                }
              })();
            }}
          >
            Create branch…
          </button>
        </div>
      ) : null}

      {stashContextMenu ? (
        <div
          className="menuDropdown"
          ref={stashContextMenuRef}
          style={{
            position: "fixed",
            left: stashContextMenu.x,
            top: stashContextMenu.y,
            zIndex: 200,
            minWidth: 220,
          }}
        >
          <button
            type="button"
            disabled={!activeRepoPath}
            onClick={() => {
              if (!activeRepoPath) return;
              const ref = stashContextMenu.stashRef;
              setStashContextMenu(null);
              const list = stashesByRepo[activeRepoPath] ?? [];
              const entry = list.find((s) => s.reference === ref);
              if (!entry) {
                setError(`Stash not found: ${ref}`);
                return;
              }
              void openStashView(entry);
            }}
          >
            View stash
          </button>
          <button
            type="button"
            disabled={!activeRepoPath || loading}
            onClick={() => {
              const ref = stashContextMenu.stashRef;
              setStashContextMenu(null);
              void applyStashByRef(ref);
            }}
          >
            Apply stash
          </button>
          <button
            type="button"
            disabled={!activeRepoPath || loading}
            onClick={() => {
              if (!activeRepoPath) return;
              const ref = stashContextMenu.stashRef;
              const name = stashContextMenu.stashMessage?.trim() ? stashContextMenu.stashMessage.trim() : ref;
              setStashContextMenu(null);
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
          >
            Delete stash
          </button>
        </div>
      ) : null}

      {tagContextMenu ? (
        <div
          className="menuDropdown"
          ref={tagContextMenuRef}
          style={{
            position: "fixed",
            left: tagContextMenu.x,
            top: tagContextMenu.y,
            zIndex: 200,
            minWidth: 220,
          }}
        >
          <button
            type="button"
            onClick={() => {
              const tag = tagContextMenu.tag;
              setTagContextMenu(null);
              void focusTagOnGraph(tag);
            }}
          >
            Focus on graph
          </button>
          <button
            type="button"
            onClick={() => {
              const tag = tagContextMenu.tag;
              setTagContextMenu(null);
              void focusTagOnCommits(tag);
            }}
          >
            Focus on commits
          </button>
        </div>
      ) : null}

      {detachedHelpOpen ? (
        <div className="modalOverlay" role="dialog" aria-modal="true">
          <div className="modal" style={{ width: "min(980px, 96vw)", maxHeight: "min(78vh, 720px)" }}>
            <div className="modalHeader">
              <div style={{ fontWeight: 900 }}>Detached HEAD</div>
              <button type="button" onClick={() => setDetachedHelpOpen(false)} disabled={detachedBusy}>
                Close
              </button>
            </div>
            <div className="modalBody">
              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ opacity: 0.85 }}>
                  Detached HEAD is a normal Git state after checking out a commit directly. If this is intentional (you are
                  inspecting history), you don't need to do anything.
                </div>

                <div style={{ opacity: 0.85 }}>
                  If you don't want to stay in detached HEAD state (or you're not sure how it happened), choose one of the
                  solutions below.
                </div>

                {detachedError ? <div className="error">{detachedError}</div> : null}

                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 900, opacity: 0.8 }}>Target branch</div>
                  <select
                    value={detachedTargetBranch}
                    onChange={(e) => setDetachedTargetBranch(e.target.value)}
                    disabled={detachedBusy || detachedBranchOptions.length <= 1}
                    title={
                      detachedBranchOptions.length === 0
                        ? "No local branch available."
                        : "Select which branch should be checked out to re-attach HEAD."
                    }
                  >
                    {detachedBranchOptions.length === 0 ? <option value="">(none)</option> : null}
                    {detachedBranchOptions.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="recoveryOption">
                  <div>
                    <div className="recoveryOptionTitle">I have no changes, just fix it</div>
                    <div className="recoveryOptionDesc">Checks out the target branch that points at the current commit.</div>
                    <div className="mono" style={{ opacity: 0.9, marginBottom: 10 }}>
                      git checkout &lt;target-branch&gt;
                    </div>
                    <button
                      type="button"
                      onClick={() => void detachedFixSimple()}
                      disabled={detachedBusy || !activeRepoPath || !detachedTargetBranch}
                    >
                      {detachedBusy ? "Working…" : "Fix detached HEAD"}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => togglePreviewZoom("/recovery/detached-fix-simple.svg")}
                    title="Click to zoom"
                    style={{ border: 0, padding: 0, background: "transparent", position: "relative" }}
                  >
                    <PreviewZoomBadge />
                    <img className="recoveryPreview" src="/recovery/detached-fix-simple.svg" alt="Preview" />
                  </button>
                </div>

                <div className="recoveryOption">
                  <div>
                    <div className="recoveryOptionTitle">I have changes, but they are not important. Discard them and fix</div>
                    <div className="recoveryOptionDesc">Discards local changes and checks out the target branch.</div>
                    <div className="mono" style={{ opacity: 0.9, marginBottom: 10 }}>
                      git reset --hard
                      <br />
                      git checkout &lt;target-branch&gt;
                    </div>
                    <button
                      type="button"
                      onClick={() => void detachedFixDiscardChanges()}
                      disabled={detachedBusy || !activeRepoPath || !detachedTargetBranch || changedCount === 0}
                      title={changedCount === 0 ? "No local changes detected." : undefined}
                    >
                      {detachedBusy ? "Working…" : "Discard changes and fix"}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => togglePreviewZoom("/recovery/detached-fix-hard.svg")}
                    title="Click to zoom"
                    style={{ border: 0, padding: 0, background: "transparent", position: "relative" }}
                  >
                    <PreviewZoomBadge />
                    <img className="recoveryPreview" src="/recovery/detached-fix-hard.svg" alt="Preview" />
                  </button>
                </div>

                <div className="recoveryOption">
                  <div>
                    <div className="recoveryOptionTitle">Save changes by creating a branch</div>
                    <div className="recoveryOptionDesc">
                      Commits your current changes, creates a temporary branch, then checks out the target branch. Optionally
                      merges and deletes the temporary branch.
                    </div>

                    <div className="recoveryFields">
                      <div style={{ display: "grid", gap: 6 }}>
                        <div style={{ fontWeight: 900, opacity: 0.8 }}>Commit message</div>
                        <input
                          value={detachedSaveCommitMessage}
                          onChange={(e) => setDetachedSaveCommitMessage(e.target.value)}
                          className="modalInput"
                          disabled={detachedBusy || changedCount === 0}
                          placeholder="Commit message"
                        />
                      </div>

                      <div className="recoveryRow">
                        <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 900, opacity: 0.85 }}>
                          <input
                            type="checkbox"
                            checked={detachedTempBranchRandom}
                            onChange={(e) => setDetachedTempBranchRandom(e.target.checked)}
                            disabled={detachedBusy}
                          />
                          Set random branch name
                        </label>
                        <input
                          value={detachedTempBranchName}
                          onChange={(e) => setDetachedTempBranchName(e.target.value)}
                          className="modalInput"
                          disabled={detachedBusy || detachedTempBranchRandom}
                          placeholder="temporary-branch-name"
                          style={{ width: 320 }}
                        />
                      </div>

                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 900, opacity: 0.85 }}>
                        <input
                          type="checkbox"
                          checked={detachedMergeAfterSave}
                          onChange={(e) => setDetachedMergeAfterSave(e.target.checked)}
                          disabled={detachedBusy}
                        />
                        Merge temporary branch into target branch
                      </label>
                    </div>

                    <button
                      type="button"
                      onClick={() => void detachedSaveByBranch()}
                      disabled={
                        detachedBusy ||
                        !activeRepoPath ||
                        !detachedTargetBranch ||
                        changedCount === 0 ||
                        !detachedSaveCommitMessage.trim() ||
                        !detachedTempBranchName.trim()
                      }
                      title={changedCount === 0 ? "No local changes detected." : undefined}
                    >
                      {detachedBusy ? "Working…" : "Save changes using a branch"}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => togglePreviewZoom("/recovery/detached-fix-branch.svg")}
                    title="Click to zoom"
                    style={{ border: 0, padding: 0, background: "transparent", position: "relative" }}
                  >
                    <PreviewZoomBadge />
                    <img className="recoveryPreview" src="/recovery/detached-fix-branch.svg" alt="Preview" />
                  </button>
                </div>

                <div className="recoveryOption">
                  <div>
                    <div className="recoveryOptionTitle">Save changes by cherry-picks</div>
                    <div className="recoveryOptionDesc">Commits your changes, then shows the steps to cherry-pick onto the target branch.</div>
                    <div className="mono" style={{ opacity: 0.9, marginBottom: 10 }}>
                      git commit -a -m &quot;&lt;message&gt;&quot;
                      <br />
                      git reset --hard
                      <br />
                      git checkout &lt;target-branch&gt;
                      <br />
                      git reflog
                      <br />
                      git cherry-pick &lt;hash&gt;
                    </div>
                    <button
                      type="button"
                      onClick={() => void detachedPrepareCherryPickSteps()}
                      disabled={detachedBusy || !activeRepoPath || !detachedTargetBranch || changedCount === 0}
                      title={changedCount === 0 ? "No local changes detected." : undefined}
                    >
                      {detachedBusy ? "Working…" : "Show cherry-pick steps"}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => togglePreviewZoom("/recovery/detached-fix-cherry.svg")}
                    title="Click to zoom"
                    style={{ border: 0, padding: 0, background: "transparent", position: "relative" }}
                  >
                    <PreviewZoomBadge />
                    <img className="recoveryPreview" src="/recovery/detached-fix-cherry.svg" alt="Preview" />
                  </button>
                </div>

                <div className="recoveryOption">
                  <div>
                    <div className="recoveryOptionTitle">I'll handle it myself — open terminal</div>
                    <div className="recoveryOptionDesc">Opens a terminal in the repository folder (Git Bash on Windows if available).</div>
                    <button type="button" onClick={() => void openTerminalProfile()} disabled={detachedBusy || !activeRepoPath}>
                      Open terminal
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => togglePreviewZoom("/recovery/detached-fix-terminal.svg")}
                    title="Click to zoom"
                    style={{ border: 0, padding: 0, background: "transparent", position: "relative" }}
                  >
                    <PreviewZoomBadge />
                    <img className="recoveryPreview" src="/recovery/detached-fix-terminal.svg" alt="Preview" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {createBranchOpen ? (
        <div className="modalOverlay" role="dialog" aria-modal="true">
          <div className="modal" style={{ width: "min(760px, 96vw)", maxHeight: "min(70vh, 640px)" }}>
            <div className="modalHeader">
              <div style={{ fontWeight: 900 }}>Create branch</div>
              <button type="button" onClick={() => setCreateBranchOpen(false)} disabled={createBranchBusy}>
                Close
              </button>
            </div>
            <div className="modalBody">
              {createBranchError ? <div className="error">{createBranchError}</div> : null}

              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 800, opacity: 0.8 }}>Branch name</div>
                  <input
                    value={createBranchName}
                    onChange={(e) => setCreateBranchName(e.target.value)}
                    className="modalInput"
                    placeholder="feature/my-branch"
                    disabled={createBranchBusy}
                  />
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 800, opacity: 0.8 }}>Create at commit</div>
                  <input
                    value={createBranchAt}
                    onChange={(e) => setCreateBranchAt(e.target.value)}
                    className="modalInput mono"
                    placeholder="HEAD or a commit hash"
                    disabled={createBranchBusy}
                  />
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 800, opacity: 0.8 }}>Commit</div>
                  {createBranchCommitLoading ? <div style={{ opacity: 0.7 }}>Loading…</div> : null}
                  {createBranchCommitError ? <div className="error">{createBranchCommitError}</div> : null}
                  {!createBranchCommitLoading && !createBranchCommitError && createBranchCommitSummary ? (
                    <div
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 12,
                        padding: 10,
                        display: "grid",
                        gap: 4,
                        background: "rgba(0, 0, 0, 0.02)",
                      }}
                    >
                      <div style={{ fontWeight: 800 }}>{truncate(createBranchCommitSummary.subject, 120)}</div>
                      <div style={{ opacity: 0.75, fontSize: 12 }}>
                        {createBranchCommitSummary.author} — {createBranchCommitSummary.date}
                      </div>
                      <div className="mono" style={{ opacity: 0.85, fontSize: 12 }}>
                        {createBranchCommitSummary.hash}
                        {createBranchCommitSummary.refs ? ` — ${createBranchCommitSummary.refs}` : ""}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div style={{ display: "grid", gap: 10 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.9 }}>
                    <input
                      type="checkbox"
                      checked={createBranchCheckout}
                      onChange={(e) => setCreateBranchCheckout(e.target.checked)}
                      disabled={createBranchBusy || createBranchOrphan}
                    />
                    Checkout after create
                  </label>

                  <div style={{ display: "grid", gap: 6 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.9 }}>
                      <input
                        type="checkbox"
                        checked={createBranchOrphan}
                        onChange={(e) => {
                          const next = e.target.checked;
                          setCreateBranchOrphan(next);
                          if (next) {
                            setCreateBranchCheckout(true);
                            setCreateBranchClearWorkingTree(true);
                          } else {
                            setCreateBranchClearWorkingTree(false);
                          }
                        }}
                        disabled={createBranchBusy}
                      />
                      Orphan
                    </label>
                    <div style={{ opacity: 0.75, fontSize: 12 }}>
                      Creates a new, disconnected history (separate tree) using <span className="mono">git switch --orphan</span>.
                    </div>

                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.9 }}>
                      <input
                        type="checkbox"
                        checked={createBranchClearWorkingTree}
                        onChange={(e) => setCreateBranchClearWorkingTree(e.target.checked)}
                        disabled={createBranchBusy || !createBranchOrphan}
                      />
                      Clear working directory and index
                    </label>
                    <div style={{ opacity: 0.75, fontSize: 12 }}>
                      Removes tracked files and cleans untracked files after creating the orphan branch.
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="modalFooter" style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <button type="button" onClick={() => setCreateBranchOpen(false)} disabled={createBranchBusy}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void runCreateBranch()}
                disabled={createBranchBusy || !activeRepoPath || !createBranchName.trim() || !createBranchAt.trim()}
              >
                {createBranchBusy ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {cherryStepsOpen ? (
        <div className="modalOverlay" role="dialog" aria-modal="true">
          <div className="modal" style={{ width: "min(900px, 96vw)", maxHeight: "min(72vh, 680px)" }}>
            <div className="modalHeader">
              <div style={{ fontWeight: 900 }}>Cherry-pick steps</div>
              <button type="button" onClick={() => setCherryStepsOpen(false)} disabled={detachedBusy}>
                Close
              </button>
            </div>
            <div className="modalBody">
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ opacity: 0.85 }}>
                  Apply your detached commit to <span className="mono">{detachedTargetBranch || "<target-branch>"}</span>.
                </div>

                {detachedError ? <div className="error">{detachedError}</div> : null}

                <div>
                  <div style={{ fontWeight: 900, opacity: 0.8, marginBottom: 6 }}>Commit to cherry-pick</div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <div className="mono" style={{ opacity: 0.9 }}>
                      {cherryCommitHash || "(missing)"}
                    </div>
                    <button
                      type="button"
                      disabled={!cherryCommitHash}
                      onClick={() => void copyText(cherryCommitHash)}
                    >
                      Copy hash
                    </button>
                  </div>
                </div>

                <div>
                  <div style={{ fontWeight: 900, opacity: 0.8, marginBottom: 6 }}>Reflog (for reference)</div>
                  <textarea className="modalTextarea" value={cherryReflog} readOnly rows={10} />
                </div>

                <div className="mono" style={{ opacity: 0.9 }}>
                  git reset --hard
                  <br />
                  git checkout {detachedTargetBranch || "<target-branch>"}
                  <br />
                  git cherry-pick {cherryCommitHash || "<hash>"}
                </div>
              </div>
            </div>
            <div className="modalFooter">
              <button
                type="button"
                onClick={() => void detachedApplyCherryPick()}
                disabled={detachedBusy || !activeRepoPath || !detachedTargetBranch || !cherryCommitHash}
              >
                Apply
              </button>
              <button type="button" onClick={() => setCherryStepsOpen(false)} disabled={detachedBusy}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {previewZoomSrc ? (
        <div
          className="modalOverlay"
          role="dialog"
          aria-modal="true"
          onClick={() => setPreviewZoomSrc(null)}
          style={{ zIndex: 500 }}
        >
          <div
            style={{
              width: "min(1100px, 96vw)",
              maxHeight: "min(86vh, 860px)",
              borderRadius: 14,
              border: "1px solid rgba(15, 15, 15, 0.18)",
              background: "var(--panel)",
              boxShadow: "0 24px 90px rgba(0, 0, 0, 0.40)",
              padding: 10,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: 6 }}>
              <div style={{ fontWeight: 900, opacity: 0.8 }}>Preview</div>
              <button type="button" onClick={() => setPreviewZoomSrc(null)}>
                Close
              </button>
            </div>
            <div style={{ overflow: "auto", maxHeight: "calc(min(86vh, 860px) - 58px)" }}>
              <img
                src={previewZoomSrc}
                alt="Preview zoom"
                onClick={() => setPreviewZoomSrc(null)}
                style={{ width: "100%", height: "auto", display: "block", borderRadius: 12, border: "1px solid rgba(15, 15, 15, 0.10)" }}
              />
            </div>
          </div>
        </div>
      ) : null}

      {pullPredictOpen ? (
        <div className="modalOverlay" role="dialog" aria-modal="true">
          <div className="modal" style={{ width: "min(760px, 96vw)", maxHeight: "min(70vh, 640px)" }}>
            <div className="modalHeader">
              <div style={{ fontWeight: 900 }}>Pull predict</div>
              <button type="button" onClick={() => setPullPredictOpen(false)} disabled={pullPredictBusy}>
                Close
              </button>
            </div>
            <div className="modalBody">
              {pullPredictError ? <div className="error">{pullPredictError}</div> : null}
              {pullPredictBusy ? <div style={{ opacity: 0.7 }}>Predicting…</div> : null}

              {pullPredictResult ? (
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontWeight: 800, opacity: 0.8 }}>Upstream</div>
                    <div className="mono" style={{ opacity: 0.9 }}>
                      {pullPredictResult.upstream ?? "(none)"}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <div>
                      <span style={{ fontWeight: 800 }}>Ahead:</span> {pullPredictResult.ahead}
                    </div>
                    <div>
                      <span style={{ fontWeight: 800 }}>Behind:</span> {pullPredictResult.behind}
                    </div>
                    <div>
                      <span style={{ fontWeight: 800 }}>Action:</span> {pullPredictResult.action}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontWeight: 800, opacity: 0.8, marginBottom: 6 }}>Potential conflicts</div>
                    {pullPredictResult.conflict_files?.length ? (
                      <div className="statusList">
                        {pullPredictResult.conflict_files.map((p) => (
                          <div key={p} className="statusRow statusRowSingleCol" onClick={() => openPullPredictConflictPreview(p)} title={p}>
                            <span className="statusPath">{p}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ opacity: 0.75 }}>No conflicts predicted.</div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="modalFooter">
              <button
                type="button"
                onClick={() => {
                  if (pullPredictRebase) {
                    void startPull("rebase");
                  } else {
                    void startPull("merge");
                  }
                  setPullPredictOpen(false);
                }}
                disabled={pullPredictBusy || !pullPredictResult || !activeRepoPath || !remoteUrl || loading || pullBusy}
              >
                Apply
              </button>
              <button type="button" onClick={() => setPullPredictOpen(false)} disabled={pullPredictBusy}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pullConflictOpen ? (
        <div className="modalOverlay" role="dialog" aria-modal="true">
          <div className="modal" style={{ width: "min(760px, 96vw)", maxHeight: "min(70vh, 640px)" }}>
            <div className="modalHeader">
              <div style={{ fontWeight: 900 }}>Conflicts detected</div>
              <button type="button" onClick={() => setPullConflictOpen(false)} disabled={pullBusy}>
                Close
              </button>
            </div>
            <div className="modalBody">
              <div style={{ opacity: 0.8, marginBottom: 10 }}>
                Operation: <span className="mono">{pullConflictOperation}</span>
              </div>
              {pullConflictMessage ? (
                <pre style={{ whiteSpace: "pre-wrap", opacity: 0.8, marginTop: 0 }}>{pullConflictMessage}</pre>
              ) : null}
              <div>
                <div style={{ fontWeight: 800, opacity: 0.8, marginBottom: 6 }}>Conflict files</div>
                {pullConflictFiles.length ? (
                  <div className="statusList">
                    {pullConflictFiles.map((p) => (
                      <div key={p} className="statusRow statusRowSingleCol" onClick={() => openFilePreview(p)} title={p}>
                        <span className="statusPath">{p}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ opacity: 0.75 }}>Could not parse conflict file list.</div>
                )}
              </div>
            </div>
            <div className="modalFooter" style={{ display: "flex", gap: 10, justifyContent: "space-between" }}>
              <button type="button" disabled title="Not implemented yet">
                Fix conflicts…
              </button>
              <div style={{ display: "flex", gap: 10 }}>
                <button type="button" onClick={() => void continueAfterConflicts()} disabled={pullBusy}>
                  Continue
                </button>
                <button type="button" onClick={() => void abortAfterConflicts()} disabled={pullBusy}>
                  Abort
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {stashModalOpen ? (
        <div className="modalOverlay" role="dialog" aria-modal="true">
          <div className="modal" style={{ width: "min(1200px, 96vw)" }}>
            <div className="modalHeader">
              <div style={{ fontWeight: 900 }}>Stash</div>
              <button type="button" onClick={() => setStashModalOpen(false)} disabled={stashBusy}>
                Close
              </button>
            </div>
            <div className="modalBody">
              {stashError ? <div className="error">{stashError}</div> : null}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 2fr) minmax(0, 3fr)",
                  gap: 12,
                  alignItems: "stretch",
                  minHeight: 0,
                  height: "100%",
                }}
              >
                <div style={{ display: "grid", gap: 10, minHeight: 0, minWidth: 0 }}>
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ fontWeight: 800, opacity: 0.8 }}>Message</div>
                    <textarea
                      value={stashMessage}
                      onChange={(e) => setStashMessage(e.target.value)}
                      rows={3}
                      className="modalTextarea"
                      placeholder="Stash message (optional)"
                      disabled={stashBusy}
                    />
                  </div>

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 2 }}>
                    <div style={{ fontWeight: 800, opacity: 0.8 }}>Files</div>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.85 }}>
                        <input
                          type="checkbox"
                          checked={stashAdvancedMode}
                          onChange={async (e) => {
                            const next = e.target.checked;
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
                          disabled={stashBusy}
                        />
                        Advanced
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          const next: Record<string, boolean> = {};
                          for (const e of stashStatusEntries) next[e.path] = true;
                          setStashSelectedPaths(next);
                        }}
                        disabled={stashBusy || stashStatusEntries.length === 0}
                      >
                        Select all
                      </button>
                    </div>
                  </div>

                  {stashStatusEntries.length === 0 ? (
                    <div style={{ opacity: 0.7, marginTop: 8 }}>No changes to stash.</div>
                  ) : (
                    <div className="statusList">
                      {stashStatusEntries.map((e) => (
                        <div
                          key={e.path}
                          className="statusRow"
                          onClick={() => {
                            setStashPreviewPath(e.path);
                            setStashPreviewStatus(e.status);
                          }}
                          onContextMenu={(ev) => {
                            ev.preventDefault();
                            ev.stopPropagation();
                            setStashPreviewPath(e.path);
                            setStashPreviewStatus(e.status);
                            openWorkingFileContextMenu("stash", e.path, e.status, ev.clientX, ev.clientY);
                          }}
                          style={
                            e.path === stashPreviewPath
                              ? { background: "rgba(47, 111, 237, 0.12)", borderColor: "rgba(47, 111, 237, 0.35)" }
                              : undefined
                          }
                        >
                          <input
                            type="checkbox"
                            checked={!!stashSelectedPaths[e.path]}
                            onClick={(ev) => ev.stopPropagation()}
                            onChange={(ev) => setStashSelectedPaths((prev) => ({ ...prev, [e.path]: ev.target.checked }))}
                            disabled={stashBusy}
                          />
                          <span className="statusCode" title={e.status}>
                            {statusBadge(e.status)}
                          </span>
                          <span className="statusPath">{e.path}</span>
                          <span className="statusActions">
                            <button
                              type="button"
                              className="statusActionBtn"
                              title="Reset file / Discard changes"
                              disabled={!activeRepoPath || stashBusy}
                              onClick={(ev) => {
                                ev.stopPropagation();
                                void discardWorkingFile("stash", e.path, e.status);
                              }}
                            >
                              R
                            </button>
                            <button
                              type="button"
                              className="statusActionBtn"
                              title="Delete file"
                              disabled={!activeRepoPath || stashBusy}
                              onClick={(ev) => {
                                ev.stopPropagation();
                                void deleteWorkingFile("stash", e.path);
                              }}
                            >
                              D
                            </button>
                            <button
                              type="button"
                              className="statusActionBtn"
                              title="Copy path (absolute)"
                              onClick={(ev) => {
                                ev.stopPropagation();
                                if (!activeRepoPath) return;
                                const sep = activeRepoPath.includes("\\") ? "\\" : "/";
                                const abs = joinPath(activeRepoPath, e.path.replace(/[\\/]/g, sep));
                                void copyText(abs);
                              }}
                            >
                              C
                            </button>
                            <button
                              type="button"
                              className="statusActionBtn"
                              title="Reveal in File Explorer"
                              disabled={!activeRepoPath || stashBusy}
                              onClick={(ev) => {
                                ev.stopPropagation();
                                if (!activeRepoPath) return;
                                const sep = activeRepoPath.includes("\\") ? "\\" : "/";
                                const abs = joinPath(activeRepoPath, e.path.replace(/[\\/]/g, sep));
                                void invoke<void>("reveal_in_file_explorer", { path: abs });
                              }}
                            >
                              E
                            </button>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0, minWidth: 0, overflow: "hidden" }}>
                  <div style={{ fontWeight: 800, opacity: 0.8 }}>Preview</div>
                  {stashAdvancedMode ? (
                    <div style={{ display: "grid", gap: 8 }}>
                      <div style={{ opacity: 0.75, fontSize: 12 }}>
                        Select hunks for the currently selected file, then stash selected hunks.
                      </div>
                      {stashHunkRanges.length > 0 ? (
                        <div className="statusList" style={{ maxHeight: 160, overflow: "auto" }}>
                          {stashHunkRanges.map((r) => {
                            const sel = new Set(stashHunksByPath[stashPreviewPath] ?? []);
                            const checked = sel.has(r.index);
                            return (
                              <label key={r.index} className="statusRow hunkRow" style={{ cursor: "pointer" }}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(ev) => {
                                    const next = ev.target.checked;
                                    setStashHunksByPath((prev) => {
                                      const cur = new Set(prev[stashPreviewPath] ?? []);
                                      if (next) cur.add(r.index);
                                      else cur.delete(r.index);
                                      return { ...prev, [stashPreviewPath]: Array.from(cur.values()).sort((a, b) => a - b) };
                                    });
                                  }}
                                  disabled={stashBusy || !stashPreviewPath}
                                />
                                <span className="hunkHeader">{r.header}</span>
                              </label>
                            );
                          })}
                        </div>
                      ) : (
                        <div style={{ opacity: 0.75, fontSize: 12 }}>No hunks detected for this file.</div>
                      )}
                    </div>
                  ) : (
                    <div style={{ opacity: 0.75, fontSize: 12 }}>Green: added, red: removed. Yellow/blue: detected moved lines.</div>
                  )}

                  {stashPreviewError ? <div className="error">{stashPreviewError}</div> : null}
                  {stashPreviewLoading ? <div style={{ opacity: 0.7 }}>Loading…</div> : null}

                  {!stashPreviewLoading && !stashPreviewError ? (
                    diffTool.difftool !== "Graphoria builtin diff" ? (
                      <div style={{ opacity: 0.75 }}>Opened in external diff tool.</div>
                    ) : stashPreviewImageBase64 ? (
                      <div
                        style={{
                          border: "1px solid var(--border)",
                          borderRadius: 12,
                          overflow: "hidden",
                          flex: 1,
                          minHeight: 0,
                          minWidth: 0,
                          display: "grid",
                        }}
                      >
                        <img
                          src={`data:${imageMimeFromExt(fileExtLower(stashPreviewPath))};base64,${stashPreviewImageBase64}`}
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "contain",
                            display: "block",
                          }}
                        />
                      </div>
                    ) : stashPreviewDiff ? (
                      <pre
                        className="diffCode"
                        style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "auto", border: "1px solid var(--border)", borderRadius: 12 }}
                      >
                        {parseUnifiedDiff(stashPreviewDiff).map((l, i) => (
                          <div key={i} className={`diffLine diffLine-${l.kind}`}>
                            {l.text}
                          </div>
                        ))}
                      </pre>
                    ) : stashPreviewContent ? (
                      <pre
                        className="diffCode"
                        style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "auto", border: "1px solid var(--border)", borderRadius: 12 }}
                      >
                        {stashPreviewContent.replace(/\r\n/g, "\n")}
                      </pre>
                    ) : (
                      <div style={{ opacity: 0.75 }}>Select a file.</div>
                    )
                  ) : null}
                </div>
              </div>
            </div>
            <div className="modalFooter">
              <button
                type="button"
                onClick={() => void runStash()}
                disabled={
                  stashBusy ||
                  (stashAdvancedMode
                    ? !stashPreviewPath || (stashHunksByPath[stashPreviewPath]?.length ?? 0) === 0
                    : stashStatusEntries.filter((e) => stashSelectedPaths[e.path]).length === 0)
                }
              >
                {stashBusy ? "Stashing…" : "Stash"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {stashViewOpen ? (
        <div className="modalOverlay" role="dialog" aria-modal="true">
          <div className="modal" style={{ width: "min(1100px, 96vw)", maxHeight: "min(84vh, 900px)" }}>
            <div className="modalHeader">
              <div style={{ fontWeight: 900 }}>Stash</div>
              <button type="button" onClick={() => setStashViewOpen(false)} disabled={stashViewLoading}>
                Close
              </button>
            </div>
            <div className="modalBody">
              {stashViewError ? <div className="error">{stashViewError}</div> : null}
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ opacity: 0.8, fontSize: 12 }}>
                  <span className="mono">{stashViewRef}</span>
                  {stashViewMessage ? <span style={{ marginLeft: 10 }}>{stashViewMessage}</span> : null}
                </div>
                {stashViewLoading ? <div style={{ opacity: 0.7 }}>Loading…</div> : null}
                {!stashViewLoading ? (
                  stashViewPatch ? (
                    <pre className="diffCode" style={{ maxHeight: 520, border: "1px solid var(--border)", borderRadius: 12 }}>
                      {parseUnifiedDiff(stashViewPatch).map((l, i) => (
                        <div key={i} className={`diffLine diffLine-${l.kind}`}>
                          {l.text}
                        </div>
                      ))}
                    </pre>
                  ) : (
                    <div style={{ opacity: 0.75 }}>No patch output.</div>
                  )
                ) : null}
              </div>
            </div>
            <div className="modalFooter" style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <button
                type="button"
                onClick={() => {
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
                disabled={stashViewLoading || !stashViewRef}
              >
                Delete
              </button>
              <button type="button" onClick={() => void applyStashFromView()} disabled={stashViewLoading || !stashViewRef}>
                Apply
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmOpen ? (
        <div className="modalOverlay" role="dialog" aria-modal="true">
          <div className="modal" style={{ width: "min(540px, 96vw)" }}>
            <div className="modalHeader">
              <div style={{ fontWeight: 900 }}>{confirmTitle}</div>
            </div>
            <div className="modalBody">
              <pre style={{ margin: 0, whiteSpace: "pre-wrap", opacity: 0.85 }}>{confirmMessage}</pre>
            </div>
            <div className="modalFooter" style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <button type="button" onClick={() => resolveConfirm(false)}>
                {confirmCancelLabel}
              </button>
              <button type="button" onClick={() => resolveConfirm(true)}>
                {confirmOkLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {resetModalOpen ? (
        <div className="modalOverlay" role="dialog" aria-modal="true">
          <div className="modal" style={{ width: "min(760px, 96vw)", maxHeight: "min(70vh, 620px)" }}>
            <div className="modalHeader">
              <div style={{ fontWeight: 900 }}>git reset</div>
              <button type="button" onClick={() => setResetModalOpen(false)} disabled={resetBusy}>
                Close
              </button>
            </div>
            <div className="modalBody">
              {resetError ? <div className="error">{resetError}</div> : null}

              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 800, opacity: 0.8 }}>Target</div>
                  <input
                    value={resetTarget}
                    onChange={(e) => setResetTarget(e.target.value)}
                    className="modalInput"
                    placeholder="HEAD~1 or a commit hash"
                    disabled={resetBusy}
                  />
                  <div style={{ opacity: 0.7, fontSize: 12 }}>
                    Examples: <span className="mono">HEAD~1</span>, <span className="mono">HEAD~5</span>, <span className="mono">a1b2c3d4</span>
                  </div>
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ fontWeight: 800, opacity: 0.8 }}>Mode</div>
                  <div style={{ display: "grid", gap: 8 }}>
                    <label style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <input
                        type="radio"
                        name="resetMode"
                        checked={resetMode === "soft"}
                        onChange={() => setResetMode("soft")}
                        disabled={resetBusy}
                      />
                      <div>
                        <div style={{ fontWeight: 800 }}>soft</div>
                        <div style={{ opacity: 0.75, fontSize: 12 }}>Undo commits; keep changes staged (selected in Commit).</div>
                      </div>
                    </label>
                    <label style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <input
                        type="radio"
                        name="resetMode"
                        checked={resetMode === "mixed"}
                        onChange={() => setResetMode("mixed")}
                        disabled={resetBusy}
                      />
                      <div>
                        <div style={{ fontWeight: 800 }}>mixed</div>
                        <div style={{ opacity: 0.75, fontSize: 12 }}>Undo commits; keep changes unstaged (not selected in Commit).</div>
                      </div>
                    </label>
                    <label style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <input
                        type="radio"
                        name="resetMode"
                        checked={resetMode === "hard"}
                        onChange={() => setResetMode("hard")}
                        disabled={resetBusy}
                      />
                      <div>
                        <div style={{ fontWeight: 800 }}>hard</div>
                        <div style={{ opacity: 0.75, fontSize: 12 }}>
                          Discard commits after target and any uncommitted changes. Recovery is hard (reflog).
                        </div>
                      </div>
                    </label>
                  </div>
                </div>
              </div>
            </div>
            <div className="modalFooter" style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <button type="button" onClick={() => setResetModalOpen(false)} disabled={resetBusy}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void runGitReset(resetMode, resetTarget)}
                disabled={resetBusy || !activeRepoPath || !resetTarget.trim()}
              >
                {resetBusy ? "Resetting…" : "Reset"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {commitModalOpen ? (
        <div className="modalOverlay" role="dialog" aria-modal="true">
          <div className="modal" style={{ width: "min(1200px, 96vw)" }}>
            <div className="modalHeader">
              <div style={{ fontWeight: 900 }}>Commit</div>
              <button type="button" onClick={() => setCommitModalOpen(false)} disabled={commitBusy}>
                Close
              </button>
            </div>
            <div className="modalBody">
              {commitError ? <div className="error">{commitError}</div> : null}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 2fr) minmax(0, 3fr)",
                  gap: 12,
                  alignItems: "stretch",
                  minHeight: 0,
                  height: "100%",
                }}
              >
                <div style={{ display: "grid", gap: 10, minHeight: 0, minWidth: 0 }}>
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ fontWeight: 800, opacity: 0.8 }}>Message</div>
                    <textarea
                      value={commitMessage}
                      onChange={(e) => setCommitMessage(e.target.value)}
                      rows={3}
                      className="modalTextarea"
                      placeholder="Commit message"
                      disabled={commitBusy}
                    />
                  </div>

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 2 }}>
                    <div style={{ fontWeight: 800, opacity: 0.8 }}>Files</div>
                    <button
                      type="button"
                      onClick={() => {
                        const next: Record<string, boolean> = {};
                        for (const e of statusEntries) next[e.path] = true;
                        setSelectedPaths(next);
                      }}
                      disabled={commitBusy || statusEntries.length === 0}
                    >
                      Select all
                    </button>
                  </div>

                  {statusEntries.length === 0 ? (
                    <div style={{ opacity: 0.7, marginTop: 8 }}>No changes to commit.</div>
                  ) : (
                    <div className="statusList">
                      {statusEntries.map((e) => (
                        <div
                          key={e.path}
                          className="statusRow"
                          onClick={() => {
                            setCommitPreviewPath(e.path);
                            setCommitPreviewStatus(e.status);
                          }}
                          onContextMenu={(ev) => {
                            ev.preventDefault();
                            ev.stopPropagation();
                            setCommitPreviewPath(e.path);
                            setCommitPreviewStatus(e.status);
                            openWorkingFileContextMenu("commit", e.path, e.status, ev.clientX, ev.clientY);
                          }}
                          style={
                            e.path === commitPreviewPath
                              ? { background: "rgba(47, 111, 237, 0.12)", borderColor: "rgba(47, 111, 237, 0.35)" }
                              : undefined
                          }
                        >
                          <input
                            type="checkbox"
                            checked={!!selectedPaths[e.path]}
                            onClick={(ev) => ev.stopPropagation()}
                            onChange={(ev) => setSelectedPaths((prev) => ({ ...prev, [e.path]: ev.target.checked }))}
                            disabled={commitBusy}
                          />
                          <span className="statusCode" title={e.status}>
                            {statusBadge(e.status)}
                          </span>
                          <span className="statusPath">{e.path}</span>
                          <span className="statusActions">
                            <button
                              type="button"
                              className="statusActionBtn"
                              title="Reset file / Discard changes"
                              disabled={!activeRepoPath || commitBusy}
                              onClick={(ev) => {
                                ev.stopPropagation();
                                void discardWorkingFile("commit", e.path, e.status);
                              }}
                            >
                              R
                            </button>
                            <button
                              type="button"
                              className="statusActionBtn"
                              title="Delete file"
                              disabled={!activeRepoPath || commitBusy}
                              onClick={(ev) => {
                                ev.stopPropagation();
                                void deleteWorkingFile("commit", e.path);
                              }}
                            >
                              D
                            </button>
                            <button
                              type="button"
                              className="statusActionBtn"
                              title="Copy path (absolute)"
                              onClick={(ev) => {
                                ev.stopPropagation();
                                if (!activeRepoPath) return;
                                const sep = activeRepoPath.includes("\\") ? "\\" : "/";
                                const abs = joinPath(activeRepoPath, e.path.replace(/[\\/]/g, sep));
                                void copyText(abs);
                              }}
                            >
                              C
                            </button>
                            <button
                              type="button"
                              className="statusActionBtn"
                              title="Reveal in File Explorer"
                              disabled={!activeRepoPath || commitBusy}
                              onClick={(ev) => {
                                ev.stopPropagation();
                                if (!activeRepoPath) return;
                                const sep = activeRepoPath.includes("\\") ? "\\" : "/";
                                const abs = joinPath(activeRepoPath, e.path.replace(/[\\/]/g, sep));
                                void invoke<void>("reveal_in_file_explorer", { path: abs });
                              }}
                            >
                              E
                            </button>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 2 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.85 }}>
                      <input
                        type="checkbox"
                        checked={commitAlsoPush}
                        onChange={(e) => setCommitAlsoPush(e.target.checked)}
                        disabled={commitBusy || !remoteUrl}
                      />
                      Push after commit
                    </label>
                    {!remoteUrl ? <div style={{ opacity: 0.7, fontSize: 12 }}>No remote origin.</div> : null}
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0, minWidth: 0, overflow: "hidden" }}>
                  <div style={{ fontWeight: 800, opacity: 0.8 }}>Preview</div>
                  <div style={{ opacity: 0.75, fontSize: 12 }}>
                    Green: added, red: removed. Yellow/blue: detected moved lines.
                  </div>

                  {commitPreviewError ? <div className="error">{commitPreviewError}</div> : null}
                  {commitPreviewLoading ? <div style={{ opacity: 0.7 }}>Loading…</div> : null}

                  {!commitPreviewLoading && !commitPreviewError ? (
                    diffTool.difftool !== "Graphoria builtin diff" ? (
                      <div style={{ opacity: 0.75 }}>Opened in external diff tool.</div>
                    ) : commitPreviewImageBase64 ? (
                      <div
                        style={{
                          border: "1px solid var(--border)",
                          borderRadius: 12,
                          overflow: "hidden",
                          flex: 1,
                          minHeight: 0,
                          minWidth: 0,
                          display: "grid",
                        }}
                      >
                        <img
                          src={`data:${imageMimeFromExt(fileExtLower(commitPreviewPath))};base64,${commitPreviewImageBase64}`}
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "contain",
                            display: "block",
                          }}
                        />
                      </div>
                    ) : commitPreviewDiff ? (
                      <pre
                        className="diffCode"
                        style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "auto", border: "1px solid var(--border)", borderRadius: 12 }}
                      >
                        {parseUnifiedDiff(commitPreviewDiff).map((l, i) => (
                          <div key={i} className={`diffLine diffLine-${l.kind}`}>
                            {l.text}
                          </div>
                        ))}
                      </pre>
                    ) : commitPreviewContent ? (
                      <pre
                        className="diffCode"
                        style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "auto", border: "1px solid var(--border)", borderRadius: 12 }}
                      >
                        {commitPreviewContent.replace(/\r\n/g, "\n")}
                      </pre>
                    ) : (
                      <div style={{ opacity: 0.75 }}>Select a file.</div>
                    )
                  ) : null}
                </div>
              </div>
            </div>
            <div className="modalFooter">
              <button
                type="button"
                onClick={() => void runCommit()}
                disabled={commitBusy || !commitMessage.trim() || statusEntries.filter((e) => selectedPaths[e.path]).length === 0}
              >
                {commitBusy ? "Committing…" : "Commit"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showChangesOpen ? (
        <div className="modalOverlay" role="dialog" aria-modal="true" style={{ zIndex: 300 }}>
          <div className="modal" style={{ width: "min(1200px, 96vw)", maxHeight: "min(80vh, 900px)" }}>
            <div className="modalHeader">
              <div style={{ fontWeight: 900 }}>Changes</div>
              <button type="button" onClick={() => setShowChangesOpen(false)}>
                Close
              </button>
            </div>
            <div className="modalBody" style={{ padding: 12 }}>
              {!activeRepoPath ? (
                <div style={{ opacity: 0.7 }}>No repository selected.</div>
              ) : !showChangesCommit ? (
                <div style={{ opacity: 0.7 }}>No commit selected.</div>
              ) : (
                <DiffView repoPath={activeRepoPath} source={{ kind: "commit", commit: showChangesCommit }} tool={diffTool} height={"min(68vh, 720px)"} />
              )}
            </div>
            <div className="modalFooter">
              <button type="button" onClick={() => setShowChangesOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {remoteModalOpen ? (
        <div className="modalOverlay" role="dialog" aria-modal="true">
          <div className="modal" style={{ width: "min(760px, 96vw)", maxHeight: "min(60vh, 540px)" }}>
            <div className="modalHeader">
              <div style={{ fontWeight: 900 }}>Remote</div>
              <button type="button" onClick={() => setRemoteModalOpen(false)} disabled={remoteBusy}>
                Close
              </button>
            </div>
            <div className="modalBody">
              {remoteError ? <div className="error">{remoteError}</div> : null}

              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontWeight: 800, opacity: 0.8 }}>Origin URL</div>
                <input
                  value={remoteUrlDraft}
                  onChange={(e) => setRemoteUrlDraft(e.target.value)}
                  className="modalInput"
                  placeholder="https://github.com/user/repo.git"
                  disabled={remoteBusy}
                />
                {remoteUrl ? (
                  <div style={{ opacity: 0.7, fontSize: 12, wordBreak: "break-all" }}>
                    Current: {remoteUrl}
                  </div>
                ) : (
                  <div style={{ opacity: 0.7, fontSize: 12 }}>No remote origin configured.</div>
                )}
              </div>
            </div>
            <div className="modalFooter">
              <button type="button" onClick={() => void saveRemote()} disabled={remoteBusy || !remoteUrlDraft.trim()}>
                {remoteBusy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pushModalOpen ? (
        <div className="modalOverlay" role="dialog" aria-modal="true">
          <div className="modal" style={{ width: "min(900px, 96vw)", maxHeight: "min(60vh, 560px)" }}>
            <div className="modalHeader">
              <div style={{ fontWeight: 900 }}>Push</div>
              <button type="button" onClick={() => setPushModalOpen(false)} disabled={pushBusy}>
                Close
              </button>
            </div>
            <div className="modalBody">
              {pushError ? <div className="error">{pushError}</div> : null}

              <div style={{ display: "grid", gap: 10 }}>
                <div>
                  <div style={{ fontWeight: 800, opacity: 0.8 }}>Remote</div>
                  <div style={{ opacity: 0.8, fontSize: 12, wordBreak: "break-all" }}>{remoteUrl || "(none)"}</div>
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontWeight: 800, opacity: 0.8 }}>Local branch</div>
                    <input
                      value={pushLocalBranch}
                      onChange={(e) => setPushLocalBranch(e.target.value)}
                      className="modalInput"
                      placeholder="master"
                      disabled={pushBusy}
                    />
                  </div>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontWeight: 800, opacity: 0.8 }}>Remote branch</div>
                    <input
                      value={pushRemoteBranch}
                      onChange={(e) => setPushRemoteBranch(e.target.value)}
                      className="modalInput"
                      placeholder="main"
                      disabled={pushBusy}
                    />
                  </div>
                  <div style={{ opacity: 0.7, fontSize: 12 }}>
                    Example: local <span className="mono">master</span> to remote <span className="mono">main</span>.
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.85 }}>
                    <input
                      type="checkbox"
                      checked={pushForce}
                      onChange={(e) => setPushForce(e.target.checked)}
                      disabled={pushBusy}
                    />
                    Force push
                  </label>
                  <label
                    style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: pushForce ? 0.85 : 0.5 }}
                    title="With lease is safer: it will refuse to force push if remote changed since last fetch."
                  >
                    <input
                      type="checkbox"
                      checked={pushWithLease}
                      onChange={(e) => setPushWithLease(e.target.checked)}
                      disabled={pushBusy || !pushForce}
                    />
                    With lease
                  </label>
                </div>
                <div style={{ opacity: 0.7, fontSize: 12, marginTop: -6 }}>
                  Force push rewrites history on remote. Use only if you really want to replace remote history.
                </div>
              </div>
            </div>
            <div className="modalFooter">
              <button type="button" onClick={() => void runPush()} disabled={pushBusy || !remoteUrl}>
                {pushBusy ? "Pushing…" : "Push"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {cloneModalOpen ? (
        <div className="modalOverlay" role="dialog" aria-modal="true">
          <div className="modal" style={{ width: "min(980px, 96vw)", maxHeight: "min(80vh, 820px)" }}>
            <div className="modalHeader">
              <div style={{ fontWeight: 900 }}>Clone repository</div>
              <button type="button" onClick={() => setCloneModalOpen(false)} disabled={cloneBusy}>
                Close
              </button>
            </div>
            <div className="modalBody">
              {cloneError ? <div className="error">{cloneError}</div> : null}
              {cloneBusy && cloneProgressMessage ? (
                <div style={{ opacity: 0.75, fontSize: 12, marginBottom: 10 }}>
                  <span className="mono">{cloneProgressMessage}</span>
                </div>
              ) : null}

              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 800, opacity: 0.8 }}>Repository link</div>
                  <input
                    value={cloneRepoUrl}
                    onChange={(e) => {
                      setCloneRepoUrl(e.target.value);
                      setCloneBranches([]);
                      setCloneBranchesError("");
                    }}
                    className="modalInput"
                    placeholder="https://github.com/user/repo.git"
                    disabled={cloneBusy}
                  />
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 800, opacity: 0.8 }}>Destination folder</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      value={cloneDestinationFolder}
                      onChange={(e) => setCloneDestinationFolder(e.target.value)}
                      className="modalInput"
                      placeholder="C:\\Projects"
                      disabled={cloneBusy}
                    />
                    <button type="button" onClick={() => void pickCloneDestinationFolder()} disabled={cloneBusy}>
                      Browse…
                    </button>
                  </div>
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 800, opacity: 0.8 }}>Create subdirectory</div>
                  <div style={{ display: "grid", gap: 8 }}>
                    <input
                      value={cloneSubdirName}
                      onChange={(e) => setCloneSubdirName(e.target.value)}
                      className="modalInput"
                      placeholder="(default: do not create subfolder)"
                      disabled={cloneBusy}
                    />
                    <div style={{ opacity: 0.7, fontSize: 12 }}>
                      Target path: <span className="mono">{cloneTargetPath || "(choose destination folder first)"}</span>
                    </div>
                  </div>
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ fontWeight: 800, opacity: 0.8 }}>Branch to clone</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => void fetchCloneBranches()}
                        disabled={cloneBusy || cloneBranchesBusy || !cloneRepoUrl.trim()}
                        title="Fetch branches from remote (git ls-remote --heads)"
                      >
                        {cloneBranchesBusy ? "Fetching…" : "Fetch"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setCloneBranch("")}
                        disabled={cloneBusy || !cloneBranch.trim()}
                        title="Use default branch"
                      >
                        Default
                      </button>
                    </div>
                  </div>
                  {cloneBranchesError ? <div className="error">{cloneBranchesError}</div> : null}
                  <input
                    value={cloneBranch}
                    onChange={(e) => setCloneBranch(e.target.value)}
                    className="modalInput"
                    placeholder="(default)"
                    list="cloneBranchesList"
                    disabled={cloneBusy}
                  />
                  <datalist id="cloneBranchesList">
                    {cloneBranches.map((b) => (
                      <option key={b} value={b} />
                    ))}
                  </datalist>
                </div>

                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ fontWeight: 800, opacity: 0.8 }}>Options</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.85 }}>
                      <input
                        type="checkbox"
                        checked={cloneInitSubmodules}
                        onChange={(e) => setCloneInitSubmodules(e.target.checked)}
                        disabled={cloneBusy}
                      />
                      Initialize all submodules
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.85 }}>
                      <input
                        type="checkbox"
                        checked={cloneDownloadFullHistory}
                        onChange={(e) => setCloneDownloadFullHistory(e.target.checked)}
                        disabled={cloneBusy}
                      />
                      Download full history
                    </label>
                    <label
                      style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.85 }}
                      title="Bare repository has no working tree (no project files), only Git history. Useful for read-only storage."
                    >
                      <input
                        type="checkbox"
                        checked={cloneBare}
                        onChange={(e) => setCloneBare(e.target.checked)}
                        disabled={cloneBusy}
                      />
                      Bare repository
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.85 }}>
                      <input
                        type="checkbox"
                        checked={cloneSingleBranch}
                        onChange={(e) => setCloneSingleBranch(e.target.checked)}
                        disabled={cloneBusy}
                      />
                      Single-branch
                    </label>
                  </div>
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 800, opacity: 0.8 }}>Origin</div>
                  <input
                    value={cloneOrigin}
                    onChange={(e) => setCloneOrigin(e.target.value)}
                    className="modalInput"
                    placeholder="(default: origin)"
                    disabled={cloneBusy}
                  />
                </div>
              </div>
            </div>
            <div className="modalFooter">
              <button
                type="button"
                onClick={() => void runCloneRepository()}
                disabled={
                  cloneBusy ||
                  !cloneRepoUrl.trim() ||
                  !cloneDestinationFolder.trim() ||
                  !cloneTargetPath
                }
              >
                {cloneBusy ? (cloneProgressPercent !== null ? `Cloning ${cloneProgressPercent}%` : "Cloning…") : "Clone"}
              </button>
              <button type="button" onClick={() => setCloneModalOpen(false)} disabled={cloneBusy}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {gitTrustOpen ? (
        <div className="modalOverlay" role="dialog" aria-modal="true">
          <div className="modal" style={{ width: "min(980px, 96vw)", maxHeight: "min(76vh, 780px)" }}>
            <div className="modalHeader">
              <div style={{ fontWeight: 900 }}>Repository is not trusted by Git</div>
              <button type="button" onClick={() => void closeTrustDialogAndRepoIfOpen()} disabled={gitTrustBusy}>
                Close
              </button>
            </div>
            <div className="modalBody">
              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ opacity: 0.85 }}>
                  Git prevents opening a repository owned by someone else than the current user. You can choose one of the solutions below.
                </div>

                {gitTrustActionError ? <div className="error">{gitTrustActionError}</div> : null}

                <div className="recoveryOption" style={{ gridTemplateColumns: "1fr" }}>
                  <div>
                    <div className="recoveryOptionTitle">Trust this repository globally (recommended)</div>
                    <div className="recoveryOptionDesc">Adds this repository to Git's global safe.directory list.</div>
                    <div style={{ display: "flex", gap: 10, alignItems: "stretch", marginBottom: 10 }}>
                      <pre
                        className="mono"
                        style={{
                          margin: 0,
                          padding: "10px 12px",
                          borderRadius: 12,
                          border: "1px solid var(--border)",
                          background: "var(--panel-2)",
                          opacity: 0.95,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-all",
                          flex: "1 1 auto",
                          minWidth: 0,
                        }}
                      >
                        {gitTrustGlobalCommand}
                      </pre>
                      <button
                        type="button"
                        onClick={() => void copyGitTrustGlobalCommand()}
                        disabled={gitTrustBusy || !gitTrustGlobalCommand || gitTrustCopied}
                        title="Copy command to clipboard"
                        style={
                          gitTrustCopied
                            ? { background: "rgba(0, 140, 0, 0.10)", borderColor: "rgba(0, 140, 0, 0.25)" }
                            : undefined
                        }
                      >
                        {gitTrustCopied ? "Copied!" : "Copy"}
                      </button>
                    </div>
                    <button type="button" onClick={() => void trustRepoGloballyAndOpen()} disabled={gitTrustBusy}>
                      Trust globally
                    </button>
                  </div>
                </div>

                <div className="recoveryOption" style={{ gridTemplateColumns: "1fr" }}>
                  <div>
                    <div className="recoveryOptionTitle">Trust this repository for this session only</div>
                    <div className="recoveryOptionDesc">
                      Graphoria will allow Git operations for this repository during the current app session, without changing your Git configuration.
                    </div>
                    <button type="button" onClick={() => void trustRepoForSessionAndOpen()} disabled={gitTrustBusy}>
                      Trust for session
                    </button>
                  </div>
                </div>

                <div className="recoveryOption" style={{ gridTemplateColumns: "1fr" }}>
                  <div>
                    <div className="recoveryOptionTitle">Change ownership to {currentUsername ? currentUsername : "current user"}</div>
                    <div className="recoveryOptionDesc">Attempts to fix the underlying filesystem ownership/permissions issue.</div>
                    <button type="button" onClick={() => void changeOwnershipAndOpen()} disabled={gitTrustBusy}>
                      Change ownership
                    </button>
                  </div>
                </div>

                <div className="recoveryOption" style={{ gridTemplateColumns: "1fr" }}>
                  <div>
                    <div className="recoveryOptionTitle">Other actions</div>
                    <div className="recoveryOptionDesc">Inspect the folder or run Git manually.</div>
                    <div className="recoveryRow">
                      <button type="button" onClick={() => void revealRepoInExplorerFromTrustDialog()} disabled={gitTrustBusy}>
                        Reveal in Explorer
                      </button>
                      <button type="button" onClick={() => void openTerminalFromTrustDialog()} disabled={gitTrustBusy}>
                        Open terminal (Git Bash)
                      </button>
                      <button type="button" onClick={() => void closeTrustDialogAndRepoIfOpen()} disabled={gitTrustBusy}>
                        Close
                      </button>
                      <button type="button" onClick={() => setGitTrustDetailsOpen((v) => !v)} disabled={gitTrustBusy || !gitTrustDetails}>
                        {gitTrustDetailsOpen ? "Hide details" : "Details"}
                      </button>
                    </div>

                    {gitTrustDetailsOpen && gitTrustDetails ? (
                      <pre style={{ whiteSpace: "pre-wrap", opacity: 0.85, marginTop: 10 }}>{gitTrustDetails}</pre>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <SettingsModal open={settingsOpen} activeRepoPath={activeRepoPath} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

export default App;
