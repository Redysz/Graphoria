import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import cytoscape, { type Core } from "cytoscape";
import dagre from "cytoscape-dagre";
import SettingsModal from "./SettingsModal";
import { getCyPalette, useAppSettings, type ThemeName } from "./appSettingsStore";
import DiffView, { parseUnifiedDiff } from "./DiffView";
import "./App.css";

let dagreRegistered = false;

type GitCommit = {
  hash: string;
  parents: string[];
  author: string;
  date: string;
  subject: string;
  refs: string;
  is_head: boolean;
};

type RepoOverview = {
  head: string;
  head_name: string;
  branches: string[];
  tags: string[];
  remotes: string[];
};

type GitStatusEntry = {
  status: string;
  path: string;
};

type GitStashEntry = {
  index: number;
  reference: string;
  message: string;
};

type GitStatusSummary = {
  changed: number;
};

type GitAheadBehind = {
  ahead: number;
  behind: number;
  upstream?: string | null;
};

type PullResult = {
  status: string;
  operation: string;
  message: string;
  conflict_files: string[];
};

type PullPredictResult = {
  upstream?: string | null;
  ahead: number;
  behind: number;
  action: string;
  conflict_files: string[];
};

type GitCloneProgressEvent = {
  destination_path: string;
  phase?: string | null;
  percent?: number | null;
  message: string;
};

type GitCommitSummary = {
  hash: string;
  author: string;
  date: string;
  subject: string;
  refs: string;
};

type GitBranchInfo = {
  name: string;
  kind: "local" | "remote" | string;
  target: string;
  committer_date: string;
};

type GitResetMode = "soft" | "mixed" | "hard";

type ViewportState = {
  zoom: number;
  pan: { x: number; y: number };
};

function shortHash(hash: string) {
  return hash.slice(0, 8);
}

function repoNameFromPath(p: string) {
  const normalized = p.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/");
  return parts.length > 0 ? parts[parts.length - 1] : normalized;
}

function truncate(s: string, max: number) {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function parseGitDubiousOwnershipError(raw: string): string | null {
  const prefix = "GIT_DUBIOUS_OWNERSHIP\n";
  if (!raw.startsWith(prefix)) return null;
  return raw.slice(prefix.length).trim();
}

function normalizeGitPath(p: string) {
  return p.replace(/\\/g, "/").replace(/\/+$/g, "");
}

function normalizeLf(s: string) {
  return s.replace(/\r\n/g, "\n");
}

function computeHunkRanges(diffText: string) {
  const lines = normalizeLf(diffText).split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("@@")) starts.push(i);
  }

  const ranges = starts.map((start, idx) => {
    const end = (starts[idx + 1] ?? lines.length) - 1;
    return { index: idx, header: lines[start], start, end };
  });
  const headerEnd = starts[0] ?? lines.length;
  return { lines, ranges, headerEnd };
}

function buildPatchFromSelectedHunks(diffText: string, selected: Set<number>) {
  const { lines, ranges, headerEnd } = computeHunkRanges(diffText);
  if (ranges.length === 0) return "";
  if (selected.size === 0) return "";

  const out: string[] = [];
  out.push(...lines.slice(0, headerEnd));
  for (const r of ranges) {
    if (!selected.has(r.index)) continue;
    out.push(...lines.slice(r.start, r.end + 1));
  }

  const joined = out.join("\n");
  return joined.endsWith("\n") ? joined : `${joined}\n`;
}

function buildPatchFromUnselectedHunks(diffText: string, selected: Set<number>) {
  const { ranges } = computeHunkRanges(diffText);
  if (ranges.length === 0) return "";

  const keep = new Set<number>();
  for (const r of ranges) {
    if (!selected.has(r.index)) keep.add(r.index);
  }
  return buildPatchFromSelectedHunks(diffText, keep);
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function App() {
  const [repos, setRepos] = useState<string[]>([]);
  const [activeRepoPath, setActiveRepoPath] = useState<string>("");
  const [viewModeByRepo, setViewModeByRepo] = useState<Record<string, "graph" | "commits">>({});
  const [tagsExpandedByRepo, setTagsExpandedByRepo] = useState<Record<string, boolean>>({});
  const [overviewByRepo, setOverviewByRepo] = useState<Record<string, RepoOverview | undefined>>({});
  const [commitsByRepo, setCommitsByRepo] = useState<Record<string, GitCommit[] | undefined>>({});
  const [remoteUrlByRepo, setRemoteUrlByRepo] = useState<Record<string, string | null | undefined>>({});
  const [statusSummaryByRepo, setStatusSummaryByRepo] = useState<Record<string, GitStatusSummary | undefined>>({});
  const [aheadBehindByRepo, setAheadBehindByRepo] = useState<Record<string, GitAheadBehind | undefined>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [gitTrustOpen, setGitTrustOpen] = useState(false);
  const [gitTrustRepoPath, setGitTrustRepoPath] = useState<string>("");
  const [gitTrustDetails, setGitTrustDetails] = useState<string>("");
  const [gitTrustDetailsOpen, setGitTrustDetailsOpen] = useState(false);
  const [gitTrustBusy, setGitTrustBusy] = useState(false);
  const [gitTrustActionError, setGitTrustActionError] = useState<string>("");
  const [gitTrustCopied, setGitTrustCopied] = useState(false);
  const [currentUsername, setCurrentUsername] = useState<string>("");
  const [repositoryMenuOpen, setRepositoryMenuOpen] = useState(false);
  const [commandsMenuOpen, setCommandsMenuOpen] = useState(false);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState("Confirm");
  const [confirmMessage, setConfirmMessage] = useState("");
  const [confirmOkLabel, setConfirmOkLabel] = useState("OK");
  const [confirmCancelLabel, setConfirmCancelLabel] = useState("Cancel");
  const confirmResolveRef = useRef<((v: boolean) => void) | null>(null);
  const [autoCenterToken, setAutoCenterToken] = useState(0);

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
  const [pullError, setPullError] = useState("");

  const [pullConflictOpen, setPullConflictOpen] = useState(false);
  const [pullConflictOperation, setPullConflictOperation] = useState<"merge" | "rebase">("merge");
  const [pullConflictFiles, setPullConflictFiles] = useState<string[]>([]);
  const [pullConflictMessage, setPullConflictMessage] = useState("");

  const [pullPredictOpen, setPullPredictOpen] = useState(false);
  const [pullPredictBusy, setPullPredictBusy] = useState(false);
  const [pullPredictError, setPullPredictError] = useState("");
  const [pullPredictRebase, setPullPredictRebase] = useState(false);
  const [pullPredictResult, setPullPredictResult] = useState<PullPredictResult | null>(null);

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

  const defaultViewMode = useAppSettings((s) => s.viewMode);
  const theme = useAppSettings((s) => s.appearance.theme);
  const setTheme = useAppSettings((s) => s.setTheme);
  const fontFamily = useAppSettings((s) => s.appearance.fontFamily);
  const fontSizePx = useAppSettings((s) => s.appearance.fontSizePx);
  const graphSettings = useAppSettings((s) => s.graph);
  const diffTool = useAppSettings((s) => s.git.diffTool);

  const viewMode = activeRepoPath ? (viewModeByRepo[activeRepoPath] ?? defaultViewMode) : defaultViewMode;

  const setViewMode = (next: "graph" | "commits") => {
    if (!activeRepoPath) return;
    setViewModeByRepo((prev) => ({ ...prev, [activeRepoPath]: next }));
  };

  const [selectedHash, setSelectedHash] = useState<string>("");
  const [detailsTab, setDetailsTab] = useState<"details" | "changes">("details");
  const [showChangesOpen, setShowChangesOpen] = useState(false);
  const [showChangesCommit, setShowChangesCommit] = useState("");
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

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.setProperty("--app-font-family", fontFamily);
    document.documentElement.style.setProperty("--app-font-size", `${fontSizePx}px`);
  }, [theme, fontFamily, fontSizePx]);

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
    if (!commitContextMenu && !tagContextMenu && !stashContextMenu && !branchContextMenu && !refBadgeContextMenu) return;

    const onMouseDown = (e: MouseEvent) => {
      const commitEl = commitContextMenuRef.current;
      const stashEl = stashContextMenuRef.current;
      const branchEl = branchContextMenuRef.current;
      const tagEl = tagContextMenuRef.current;
      const refBadgeEl = refBadgeContextMenuRef.current;
      if (e.target instanceof Node) {
        if (commitEl && commitEl.contains(e.target)) return;
        if (stashEl && stashEl.contains(e.target)) return;
        if (branchEl && branchEl.contains(e.target)) return;
        if (tagEl && tagEl.contains(e.target)) return;
        if (refBadgeEl && refBadgeEl.contains(e.target)) return;
      }
      setCommitContextMenu(null);
      setStashContextMenu(null);
      setBranchContextMenu(null);
      setTagContextMenu(null);
      setRefBadgeContextMenu(null);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setCommitContextMenu(null);
        setStashContextMenu(null);
        setBranchContextMenu(null);
        setTagContextMenu(null);
        setRefBadgeContextMenu(null);
      }
    };

    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [commitContextMenu, tagContextMenu, stashContextMenu, branchContextMenu, refBadgeContextMenu]);

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

  const commits = commitsByRepo[activeRepoPath] ?? [];

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
    return overview?.head || commits.find((c) => c.is_head)?.hash || "";
  }, [commits, overview?.head]);

  const isDetached = overview?.head_name === "(detached)";
  const activeBranchName = !isDetached ? (overview?.head_name ?? "") : "";

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
    return commits.find((c) => c.hash === selectedHash);
  }, [commits, selectedHash]);

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

  async function openTerminal() {
    if (!activeRepoPath) return;
    setError("");
    try {
      await invoke<void>("open_terminal", { repoPath: activeRepoPath });
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
        setPullConflictOperation(op);
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
    if (commits.length === 0) return;

    let newestHash = "";
    let newestTs = -Infinity;

    for (const c of commits) {
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
    const nodes = new Map<string, { data: { id: string; label: string; refs: string }; classes?: string }>();
    const edges: Array<{ data: { id: string; source: string; target: string } }> = [];

    for (const c of commits) {
      const label = `${shortHash(c.hash)}\n${truncate(c.subject, 100)}`;
      nodes.set(c.hash, {
        data: {
          id: c.hash,
          label,
          refs: c.refs,
        },
        classes: c.is_head ? "head" : undefined,
      });
    }

    for (const c of commits) {
      for (const p of c.parents) {
        if (!nodes.has(p)) {
          nodes.set(p, {
            data: {
              id: p,
              label: `${shortHash(p)}\n(older)`,
              refs: "",
            },
            classes: "placeholder",
          });
        }

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
  }, [commits, graphSettings.edgeDirection]);

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

    for (const n of cy.nodes().toArray()) {
      if (n.hasClass("refBadge")) continue;
      const refs = (n.data("refs") as string) || "";
      if (!refs.trim()) continue;

      const parsed = parseRefs(refs, overview?.remotes ?? []);
      if (parsed.length === 0) continue;

      const filtered = graphSettings.showRemoteBranchesOnGraph ? parsed : parsed.filter((r) => r.kind !== "remote");
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

    if (!dagreRegistered) {
      cytoscape.use(dagre);
      dagreRegistered = true;
    }

    cyRef.current?.destroy();

    const palette = getCyPalette(theme);
    cyRef.current = cytoscape({
      container: graphRef.current,
      elements: [...elements.nodes, ...elements.edges],
      minZoom: 0.1,
      maxZoom: 5,
      wheelSensitivity: 0.6,
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
            "background-color": palette.refRemoteBg,
            "border-color": palette.refRemoteBorder,
            color: palette.refRemoteText,
            opacity: 0.4,
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
            "text-background-color": theme === "dark" ? "rgba(15, 15, 15, 0.55)" : "rgba(255, 255, 255, 0.70)",
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

    const layout = (cy as any).layout({
      name: "dagre",
      rankDir: graphSettings.rankDir,
      nodeSep: graphSettings.nodeSep,
      rankSep: graphSettings.rankSep,
      padding: graphSettings.padding,
      fit: false,
      animate: false,
    });

    (layout as any).one("layoutstop", () => {
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
    });

    (layout as any).run();

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
    graphSettings.nodeSep,
    graphSettings.padding,
    graphSettings.rankDir,
    graphSettings.rankSep,
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
    void refreshIndicators(activeRepoPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRepoPath]);

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
    try {
      const [statusSummary, aheadBehind] = await Promise.all([
        invoke<GitStatusSummary>("git_status_summary", { repoPath: path }),
        invoke<GitAheadBehind>("git_ahead_behind", { repoPath: path, remoteName: "origin" }),
      ]);
      setStatusSummaryByRepo((prev) => ({ ...prev, [path]: statusSummary }));
      setAheadBehindByRepo((prev) => ({ ...prev, [path]: aheadBehind }));
    } catch {
      // ignore
    }
  }

  async function pickRepository() {
    setError("");

    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select a Git repository",
    });

    if (!selected || Array.isArray(selected)) return;
    void openRepository(selected);
  }

  async function initializeProject() {
    setError("");
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
      setError(typeof e === "string" ? e : JSON.stringify(e));
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
      setCommitPreviewError("");
      setCommitPreviewLoading(false);
      return;
    }

    let alive = true;
    setCommitPreviewLoading(true);
    setCommitPreviewError("");
    setCommitPreviewDiff("");
    setCommitPreviewContent("");

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

        const st = commitPreviewStatus.trim();
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
      setStashPreviewError("");
      setStashPreviewLoading(false);
      return;
    }

    let alive = true;
    setStashPreviewLoading(true);
    setStashPreviewError("");
    setStashPreviewDiff("");
    setStashPreviewContent("");

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

        const st = stashPreviewStatus.trim();
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
    setError("");
    setSelectedHash("");

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
        return;
      }
      setError(msg);
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

  async function loadRepo(nextRepoPath?: string) {
    const path = nextRepoPath ?? activeRepoPath;
    if (!path) return;

    setLoading(true);
    setError("");
    try {
      const [ov, cs, remote, statusSummary, aheadBehind, stashes] = await Promise.all([
        invoke<RepoOverview>("repo_overview", { repoPath: path }),
        invoke<GitCommit[]>("list_commits", { repoPath: path, maxCount: 1200 }),
        invoke<string | null>("git_get_remote_url", { repoPath: path, remoteName: "origin" }),
        invoke<GitStatusSummary>("git_status_summary", { repoPath: path }),
        invoke<GitAheadBehind>("git_ahead_behind", { repoPath: path, remoteName: "origin" }),
        invoke<GitStashEntry[]>("git_stash_list", { repoPath: path }),
      ]);

      setOverviewByRepo((prev) => ({ ...prev, [path]: ov }));
      setCommitsByRepo((prev) => ({ ...prev, [path]: cs }));
      setRemoteUrlByRepo((prev) => ({ ...prev, [path]: remote }));
      setStatusSummaryByRepo((prev) => ({ ...prev, [path]: statusSummary }));
      setAheadBehindByRepo((prev) => ({ ...prev, [path]: aheadBehind }));
      setStashesByRepo((prev) => ({ ...prev, [path]: stashes }));

      const headHash = cs.find((c) => c.is_head)?.hash || ov.head;
      setSelectedHash(headHash || "");
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
        return;
      }

      setError(msg);
    } finally {
      setLoading(false);
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
      await invoke<void>("open_terminal", { repoPath: gitTrustRepoPath });
      setGitTrustOpen(false);
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

  return (
    <div className="app">
      <div className="topbar">
        <div className="menubar">
          <div className="menubarLeft">
            <div style={{ position: "relative" }}>
              <div
                className="menuitem"
                onClick={() => {
                  setCommandsMenuOpen(false);
                  setToolsMenuOpen(false);
                  setRepositoryMenuOpen((v) => !v);
                }}
                style={{ cursor: "pointer", userSelect: "none" }}
              >
                Repository
              </div>
              {repositoryMenuOpen ? (
                <div className="menuDropdown">
                  <button
                    type="button"
                    onClick={() => {
                      setRepositoryMenuOpen(false);
                      openCloneDialog();
                    }}
                    disabled={loading || cloneBusy}
                  >
                    Clone repository…
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRepositoryMenuOpen(false);
                      void pickRepository();
                    }}
                    disabled={loading || cloneBusy}
                  >
                    Open repository…
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRepositoryMenuOpen(false);
                      void initializeProject();
                    }}
                    disabled={loading || cloneBusy}
                  >
                    Initialize project…
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRepositoryMenuOpen(false);
                      void openRemoteDialog();
                    }}
                    disabled={!activeRepoPath || loading}
                    title={!activeRepoPath ? "No repository" : undefined}
                  >
                    Remote…
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRepositoryMenuOpen(false);
                      void loadRepo(activeRepoPath);
                    }}
                    disabled={!activeRepoPath || loading}
                  >
                    Refresh
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRepositoryMenuOpen(false);
                      void openActiveRepoInExplorer();
                    }}
                    disabled={!activeRepoPath}
                  >
                    Open in file explorer
                  </button>
                </div>
              ) : null}
            </div>
            <div className="menuitem">Navigate</div>
            <div className="menuitem">View</div>
            <div style={{ position: "relative" }}>
              <div
                className="menuitem"
                onClick={() => {
                  setRepositoryMenuOpen(false);
                  setToolsMenuOpen(false);
                  setCommandsMenuOpen((v) => !v);
                }}
                style={{ cursor: "pointer", userSelect: "none" }}
              >
                Commands
              </div>
              {commandsMenuOpen ? (
                <div className="menuDropdown">
                  <button
                    type="button"
                    onClick={() => {
                      setCommandsMenuOpen(false);
                      void openCommitDialog();
                    }}
                    disabled={!activeRepoPath || loading}
                  >
                    <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, width: "100%" }}>
                      <span>Commit…</span>
                      {changedCount > 0 ? <span className="badge">{changedCount}</span> : null}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCommandsMenuOpen(false);
                      void openPushDialog();
                    }}
                    disabled={!activeRepoPath || loading || !remoteUrl}
                    title={!remoteUrl ? "No remote origin" : undefined}
                  >
                    <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, width: "100%" }}>
                      <span>Push…</span>
                      {aheadCount > 0 ? <span className="badge">↑{aheadCount}</span> : null}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setCommandsMenuOpen(false);
                      void openStashDialog();
                    }}
                    disabled={!activeRepoPath || loading}
                  >
                    <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, width: "100%" }}>
                      <span>Stash…</span>
                      {stashes.length > 0 ? <span className="badge">{stashes.length}</span> : null}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const at = selectedHash.trim() ? selectedHash.trim() : headHash.trim();
                      setCommandsMenuOpen(false);
                      if (!at) return;
                      openCreateBranchDialog(at);
                    }}
                    disabled={!activeRepoPath || loading || (!selectedHash.trim() && !headHash.trim())}
                    title={!activeRepoPath ? "No repository" : "Create a new branch"}
                  >
                    Create branch…
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setCommandsMenuOpen(false);
                      void openSwitchBranchDialog();
                    }}
                    disabled={!activeRepoPath || loading}
                    title={!activeRepoPath ? "No repository" : "Switch branches (git switch)"}
                  >
                    Checkout branch…
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setCommandsMenuOpen(false);
                      openResetDialog();
                    }}
                    disabled={!activeRepoPath || loading}
                    title={!activeRepoPath ? "No repository" : "Reset (soft/hard)"}
                  >
                    Reset (soft/hard)…
                  </button>
                </div>
              ) : null}
            </div>

            <div style={{ position: "relative" }}>
              <div
                className="menuitem"
                onClick={() => {
                  setRepositoryMenuOpen(false);
                  setCommandsMenuOpen(false);
                  setToolsMenuOpen((v) => !v);
                }}
                style={{ cursor: "pointer", userSelect: "none" }}
              >
                Tools
              </div>
              {toolsMenuOpen ? (
                <div className="menuDropdown">
                  <button
                    type="button"
                    onClick={() => {
                      setToolsMenuOpen(false);
                      void (async () => {
                        const ok = await confirmDialog({
                          title: "Clear all stashes",
                          message: "This will delete all stashes in the current repository. Continue?",
                          okLabel: "Clear",
                          cancelLabel: "Cancel",
                        });
                        if (!ok) return;
                        await clearAllStashes();
                      })();
                    }}
                    disabled={!activeRepoPath || loading || stashes.length === 0}
                    title={!activeRepoPath ? "No repository" : stashes.length === 0 ? "No stashes" : undefined}
                  >
                    Clear all stashes
                  </button>
                </div>
              ) : null}
            </div>

            <div className="menuitem">Help</div>
          </div>

          <div className="menubarRight">
            <select value={theme} onChange={(e) => setTheme(e.target.value as ThemeName)} title="Theme">
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="blue">Blue</option>
              <option value="sepia">Sepia</option>
            </select>

            <button type="button" onClick={() => setSettingsOpen(true)} title="Settings">
              ⚙️Settings
            </button>
          </div>
        </div>

        <div className="toolbar">
          {repos.length === 0 ? (
            <button
              type="button"
              onClick={() => {
                setRepositoryMenuOpen(false);
                setCommandsMenuOpen(false);
                setToolsMenuOpen(false);
                void pickRepository();
              }}
              disabled={loading || cloneBusy}
              title="Open repository"
            >
              Open
            </button>
          ) : null}
          <button type="button" onClick={() => void loadRepo()} disabled={!activeRepoPath || loading}>
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void runFetch()}
            disabled={!activeRepoPath || loading || !remoteUrl}
            title={!remoteUrl ? "No remote origin" : "git fetch origin"}
          >
            Fetch
          </button>
          <div style={{ position: "relative", display: "flex", alignItems: "stretch" }}>
            <button
              type="button"
              onClick={() => void startPull("merge")}
              disabled={!activeRepoPath || loading || pullBusy || !remoteUrl}
              title={!remoteUrl ? "No remote origin" : "git pull (merge)"}
              style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span>Pull</span>
                {behindCount > 0 ? <span className="badge">↓{behindCount}</span> : null}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setPullMenuOpen((v) => !v)}
              disabled={!activeRepoPath || loading || pullBusy || !remoteUrl}
              title="More pull options"
              style={{
                borderTopLeftRadius: 0,
                borderBottomLeftRadius: 0,
                borderLeft: "0",
                paddingLeft: 8,
                paddingRight: 8,
              }}
            >
              ▾
            </button>

            {pullMenuOpen ? (
              <div className="menuDropdown" style={{ left: 0, top: "calc(100% + 6px)", minWidth: 260 }}>
                <button
                  type="button"
                  onClick={() => {
                    setPullMenuOpen(false);
                    void startPull("merge");
                  }}
                  disabled={!activeRepoPath || loading || pullBusy || !remoteUrl}
                  title="git pull (merge)"
                >
                  Git pull
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPullMenuOpen(false);
                    void startPull("rebase");
                  }}
                  disabled={!activeRepoPath || loading || pullBusy || !remoteUrl}
                  title="git pull --rebase"
                >
                  Git pull --rebase
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPullMenuOpen(false);
                    void predictPull(false);
                  }}
                  disabled={!activeRepoPath || loading || pullPredictBusy || !remoteUrl}
                  title="Predict if git pull will create merge commit and whether there may be conflicts"
                >
                  Pull predict
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPullMenuOpen(false);
                    void predictPull(true);
                  }}
                  disabled={!activeRepoPath || loading || pullPredictBusy || !remoteUrl}
                  title="Predict if git pull --rebase will have conflicts"
                >
                  Pull --rebase predict
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPullMenuOpen(false);
                    void pullAutoChoose();
                  }}
                  disabled={!activeRepoPath || loading || pullBusy || pullPredictBusy || !remoteUrl}
                  title="Tries pull --rebase; if conflicts predicted, falls back to normal pull (merge)."
                >
                  Pull rebase/merge autochoose
                </button>
              </div>
            ) : null}
          </div>
          <button type="button" onClick={() => void openCommitDialog()} disabled={!activeRepoPath || loading}>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span>Commit…</span>
              {changedCount > 0 ? <span className="badge">{changedCount}</span> : null}
            </span>
          </button>
          <button
            type="button"
            onClick={() => void openPushDialog()}
            disabled={!activeRepoPath || loading || !remoteUrl}
            title={!remoteUrl ? "No remote origin" : undefined}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span>Push…</span>
              {aheadCount > 0 ? <span className="badge">↑{aheadCount}</span> : null}
            </span>
          </button>
          <button type="button" onClick={() => void openTerminal()} disabled={!activeRepoPath} title="Open terminal in repository">
            Git Bash
          </button>
          {loading ? <div style={{ opacity: 0.7 }}>Loading…</div> : null}
          {error ? <div className="error">{error}</div> : null}
          {pullError ? <div className="error">{pullError}</div> : null}
        </div>

        <div className="tabs">
          {repos.length === 0 ? <div style={{ opacity: 0.7, padding: "8px 4px" }}>No repository opened</div> : null}
          {repos.map((p) => (
            <div
              key={p}
              className={`tab ${p === activeRepoPath ? "tabActive" : ""}`}
              onClick={() => {
                setActiveRepoPath(p);
                setSelectedHash("");
              }}
            >
              <div style={{ fontWeight: 900 }}>{repoNameFromPath(p)}</div>
              <button
                type="button"
                className="tabClose"
                onClick={(e) => {
                  e.stopPropagation();
                  void closeRepository(p);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="content">
        <aside className="sidebar">
          <div className="sidebarSection">
            <div className="sidebarTitle">Branches</div>
            <div className="sidebarList">
              {(overview?.branches ?? []).slice(0, 30).map((b) => (
                <div key={b} className="sidebarItem branchRow" title={b}>
                  <button
                    type="button"
                    className="branchMain"
                    style={{ border: 0, background: "transparent", padding: 0, color: "inherit", textAlign: "left" }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      openBranchContextMenu(b, e.clientX, e.clientY);
                    }}
                  >
                    <span
                      className="branchLabel"
                      style={normalizeBranchName(b) === normalizeBranchName(activeBranchName) ? { fontWeight: 900 } : undefined}
                    >
                      {b}
                    </span>
                  </button>

                  <span className="branchActions">
                    <button
                      type="button"
                      className="branchActionBtn"
                      onClick={() => void checkoutBranch(b)}
                      title="Checkout (Switch) to this branch"
                      disabled={!activeRepoPath || loading}
                    >
                      C
                    </button>
                    <button
                      type="button"
                      className="branchActionBtn"
                      onClick={() => openRenameBranchDialog(b)}
                      title="Rename branch"
                      disabled={!activeRepoPath || loading}
                    >
                      R
                    </button>
                    <button
                      type="button"
                      className="branchActionBtn"
                      onClick={() => void deleteBranch(b)}
                      title="Delete branch"
                      disabled={!activeRepoPath || loading}
                    >
                      D
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="sidebarSection">
            <div className="sidebarTitle">Remotes</div>
            <div className="sidebarList">
              {(overview?.remotes ?? []).slice(0, 30).map((r) => (
                <div key={r} className="sidebarItem">
                  {r}
                </div>
              ))}
            </div>
          </div>

          <div className="sidebarSection">
            <div className="sidebarTitle">Tags</div>
            <div className="sidebarList">
              {(tagsExpanded ? overview?.tags ?? [] : (overview?.tags ?? []).slice(0, 10)).map((t) => (
                <div
                  key={t}
                  className="sidebarItem"
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openTagContextMenu(t, e.clientX, e.clientY);
                  }}
                >
                  {t}
                </div>
              ))}
              {!tagsExpanded && (overview?.tags ?? []).length > 10 ? (
                <button
                  type="button"
                  onClick={() => {
                    if (!activeRepoPath) return;
                    setTagsExpandedByRepo((prev) => ({ ...prev, [activeRepoPath]: true }));
                  }}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "6px 8px",
                    border: "1px solid transparent",
                    background: "transparent",
                    color: "inherit",
                  }}
                  className="sidebarItem"
                >
                  Show all tags
                </button>
              ) : null}
            </div>
          </div>

          <div className="sidebarSection">
            <div className="sidebarTitle">Other</div>
            <div className="sidebarList">
              <div className="sidebarItem">Submodules</div>
              <div style={{ display: "grid", gap: 6 }}>
                <div className="sidebarTitle" style={{ marginBottom: 0 }}>
                  Stashes
                </div>
                {stashes.length === 0 ? (
                  <div style={{ opacity: 0.7, fontSize: 12, padding: "0 8px" }}>No stashes.</div>
                ) : (
                  <div className="sidebarList" style={{ gap: 4 }}>
                    {stashes.map((s) => (
                      <div key={s.reference} className="sidebarItem stashRow" title={s.message || s.reference}>
                        <button
                          type="button"
                          className="stashMain"
                          onClick={() => void openStashView(s)}
                          style={{ border: 0, background: "transparent", padding: 0, color: "inherit", textAlign: "left" }}
                        >
                          <span className="stashLabel">{truncate(s.message || s.reference, 38)}</span>
                        </button>

                        <span className="stashActions">
                          <button type="button" className="stashActionBtn" onClick={() => void openStashView(s)} title="View">
                            👁
                          </button>
                          <button
                            type="button"
                            className="stashActionBtn"
                            onClick={() => void applyStashByRef(s.reference)}
                            title="Apply"
                          >
                            Apply
                          </button>
                          <button
                            type="button"
                            className="stashActionBtn"
                            onClick={() => {
                              void (async () => {
                                const ok = await confirmDialog({
                                  title: "Delete stash",
                                  message: `Delete stash ${s.message?.trim() ? s.message.trim() : s.reference}?`,
                                  okLabel: "Delete",
                                  cancelLabel: "Cancel",
                                });
                                if (!ok) return;
                                await dropStashByRef(s.reference);
                              })();
                            }}
                            title="Delete"
                          >
                            ×
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </aside>

        <div className="main">
          <div className="mainHeader">
            <div className="repoTitle">
              <div className="repoName">{activeRepoPath ? repoNameFromPath(activeRepoPath) : "Graphoria"}</div>
              <div className="repoPath">
                {activeRepoPath ? activeRepoPath : "Open a repository to start."}
                {overview?.head_name ? ` — ${overview.head_name}` : ""}
              </div>
            </div>

            <div className="segmented">
              <button
                type="button"
                className={viewMode === "graph" ? "active" : ""}
                onClick={() => setViewMode("graph")}
                disabled={!activeRepoPath}
              >
                Graph
              </button>
              <button
                type="button"
                className={viewMode === "commits" ? "active" : ""}
                onClick={() => setViewMode("commits")}
                disabled={!activeRepoPath}
              >
                Commits
              </button>
            </div>
          </div>

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
                    <button type="button" onClick={focusOnNewest} disabled={!activeRepoPath || commits.length === 0}>
                      Focus on newest
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="graphCanvas" key={`commits-${activeRepoPath}`} style={{ padding: 12, overflow: "auto" }}>
                {commits.length === 0 ? (
                  <div style={{ opacity: 0.7 }}>No commits loaded.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {commits.map((c) => (
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
                        style={{
                          textAlign: "left",
                          padding: 10,
                          background: c.hash === selectedHash ? "rgba(47, 111, 237, 0.12)" : "#ffffff",
                        }}
                      >
                        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                          <span
                            style={{
                              fontFamily:
                                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                              opacity: 0.9,
                            }}
                          >
                            {shortHash(c.hash)}
                          </span>
                          <span style={{ fontWeight: 800 }}>{truncate(c.subject, 100)}</span>
                          {c.is_head ? <span style={{ opacity: 0.7 }}>(HEAD)</span> : null}
                        </div>
                        <div style={{ opacity: 0.75, fontSize: 12 }}>
                          {c.author} — {c.date}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="details">
            <div className="detailsTitle">
              <div className="segmented small">
                <button type="button" className={detailsTab === "details" ? "active" : ""} onClick={() => setDetailsTab("details")}> 
                  Details
                </button>
                <button type="button" className={detailsTab === "changes" ? "active" : ""} onClick={() => setDetailsTab("changes")}> 
                  Changes
                </button>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" disabled={!selectedCommit} onClick={() => void copyText(selectedHash)}>
                  Copy hash
                </button>
                <button
                  type="button"
                  disabled={!selectedCommit || !activeRepoPath || loading}
                  onClick={() => void checkoutCommit(selectedHash)}
                >
                  Checkout…
                </button>
              </div>
            </div>

            {!selectedCommit ? (
              <div style={{ opacity: 0.7 }}>Select a commit to see details.</div>
            ) : detailsTab === "details" ? (
              <div className="detailsGrid">
                <div className="detailsLabel">Hash</div>
                <div className="detailsValue mono">{selectedCommit.hash}</div>

                <div className="detailsLabel">Subject</div>
                <div className="detailsValue">{selectedCommit.subject}</div>

                <div className="detailsLabel">Author</div>
                <div className="detailsValue">{selectedCommit.author}</div>

                <div className="detailsLabel">Date</div>
                <div className="detailsValue">{selectedCommit.date}</div>

                <div className="detailsLabel">Refs</div>
                <div className="detailsValue mono">{selectedCommit.refs || "(none)"}</div>
              </div>
            ) : (
              <div style={{ height: 180, minHeight: 0 }}>
                {activeRepoPath ? (
                  <DiffView
                    repoPath={activeRepoPath}
                    source={{ kind: "commit", commit: selectedCommit.hash }}
                    tool={diffTool}
                    height={180}
                  />
                ) : (
                  <div style={{ opacity: 0.7 }}>No repository selected.</div>
                )}
              </div>
            )}
          </div>
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
                    <button type="button" onClick={() => void openTerminal()} disabled={detachedBusy || !activeRepoPath}>
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
                          <div key={p} className="statusRow">
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
                      <div key={p} className="statusRow">
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

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "start" }}>
                <div style={{ display: "grid", gap: 10, minHeight: 0 }}>
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
                          <span className="statusCode">{e.status}</span>
                          <span className="statusPath">{e.path}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ display: "grid", gap: 8, minHeight: 0 }}>
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
                    ) : stashPreviewDiff ? (
                      <pre className="diffCode" style={{ maxHeight: 360, border: "1px solid var(--border)", borderRadius: 12 }}>
                        {parseUnifiedDiff(stashPreviewDiff).map((l, i) => (
                          <div key={i} className={`diffLine diffLine-${l.kind}`}>
                            {l.text}
                          </div>
                        ))}
                      </pre>
                    ) : stashPreviewContent ? (
                      <pre className="diffCode" style={{ maxHeight: 360, border: "1px solid var(--border)", borderRadius: 12 }}>
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

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "start" }}>
                <div style={{ display: "grid", gap: 10, minHeight: 0 }}>
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
                          <span className="statusCode">{e.status}</span>
                          <span className="statusPath">{e.path}</span>
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

                <div style={{ display: "grid", gap: 8, minHeight: 0 }}>
                  <div style={{ fontWeight: 800, opacity: 0.8 }}>Preview</div>
                  <div style={{ opacity: 0.75, fontSize: 12 }}>
                    Green: added, red: removed. Yellow/blue: detected moved lines.
                  </div>

                  {commitPreviewError ? <div className="error">{commitPreviewError}</div> : null}
                  {commitPreviewLoading ? <div style={{ opacity: 0.7 }}>Loading…</div> : null}

                  {!commitPreviewLoading && !commitPreviewError ? (
                    diffTool.difftool !== "Graphoria builtin diff" ? (
                      <div style={{ opacity: 0.75 }}>Opened in external diff tool.</div>
                    ) : commitPreviewDiff ? (
                      <pre className="diffCode" style={{ maxHeight: 360, border: "1px solid var(--border)", borderRadius: 12 }}>
                        {parseUnifiedDiff(commitPreviewDiff).map((l, i) => (
                          <div key={i} className={`diffLine diffLine-${l.kind}`}>
                            {l.text}
                          </div>
                        ))}
                      </pre>
                    ) : commitPreviewContent ? (
                      <pre className="diffCode" style={{ maxHeight: 360, border: "1px solid var(--border)", borderRadius: 12 }}>
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

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

export default App;
