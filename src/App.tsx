import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import cytoscape, { type Core } from "cytoscape";
import dagre from "cytoscape-dagre";
import SettingsModal from "./SettingsModal";
import { getCyPalette, useAppSettings, type ThemeName } from "./appSettingsStore";
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
  const [overviewByRepo, setOverviewByRepo] = useState<Record<string, RepoOverview | undefined>>({});
  const [commitsByRepo, setCommitsByRepo] = useState<Record<string, GitCommit[] | undefined>>({});
  const [remoteUrlByRepo, setRemoteUrlByRepo] = useState<Record<string, string | null | undefined>>({});
  const [statusSummaryByRepo, setStatusSummaryByRepo] = useState<Record<string, GitStatusSummary | undefined>>({});
  const [aheadBehindByRepo, setAheadBehindByRepo] = useState<Record<string, GitAheadBehind | undefined>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [repositoryMenuOpen, setRepositoryMenuOpen] = useState(false);
  const [commandsMenuOpen, setCommandsMenuOpen] = useState(false);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [autoCenterToken, setAutoCenterToken] = useState(0);

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

  const defaultViewMode = useAppSettings((s) => s.viewMode);
  const theme = useAppSettings((s) => s.appearance.theme);
  const setTheme = useAppSettings((s) => s.setTheme);
  const fontFamily = useAppSettings((s) => s.appearance.fontFamily);
  const fontSizePx = useAppSettings((s) => s.appearance.fontSizePx);
  const graphSettings = useAppSettings((s) => s.graph);

  const viewMode = activeRepoPath ? (viewModeByRepo[activeRepoPath] ?? defaultViewMode) : defaultViewMode;

  const setViewMode = (next: "graph" | "commits") => {
    if (!activeRepoPath) return;
    setViewModeByRepo((prev) => ({ ...prev, [activeRepoPath]: next }));
  };

  const [selectedHash, setSelectedHash] = useState<string>("");
  const [commitContextMenu, setCommitContextMenu] = useState<{
    x: number;
    y: number;
    hash: string;
  } | null>(null);
  const commitContextMenuRef = useRef<HTMLDivElement | null>(null);
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
    if (!commitContextMenu) return;

    const onMouseDown = (e: MouseEvent) => {
      const el = commitContextMenuRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setCommitContextMenu(null);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCommitContextMenu(null);
    };

    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [commitContextMenu]);

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
  const overview = overviewByRepo[activeRepoPath];
  const remoteUrl = remoteUrlByRepo[activeRepoPath] ?? null;
  const changedCount = statusSummaryByRepo[activeRepoPath]?.changed ?? 0;
  const aheadCount = aheadBehindByRepo[activeRepoPath]?.ahead ?? 0;
  const behindCount = aheadBehindByRepo[activeRepoPath]?.behind ?? 0;

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

  const headHash = useMemo(() => {
    return overview?.head || commits.find((c) => c.is_head)?.hash || "";
  }, [commits, overview?.head]);

  function openCommitContextMenu(hash: string, x: number, y: number) {
    const menuW = 260;
    const menuH = 110;
    const maxX = Math.max(0, window.innerWidth - menuW);
    const maxY = Math.max(0, window.innerHeight - menuH);
    setCommitContextMenu({
      hash,
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

  function parseRefs(refs: string): Array<{ kind: "head" | "branch" | "tag" | "remote"; label: string }> {
    const parts = refs
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    const out: Array<{ kind: "head" | "branch" | "tag" | "remote"; label: string }> = [];

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
          out.push({ kind: left.includes("/") ? "remote" : "branch", label: left });
        }
        if (right) {
          out.push({ kind: right.includes("/") ? "remote" : "branch", label: right });
        }
        continue;
      }

      if (part === "HEAD") {
        out.push({ kind: "head", label: "HEAD" });
        continue;
      }

      out.push({ kind: part.includes("/") ? "remote" : "branch", label: part });
    }

    return out;
  }

  function applyRefBadges(cy: Core) {
    cy.$("node.refBadge").remove();
    cy.$("edge.refEdge").remove();

    const sideOffsetX = 240;
    const gapY = 30;
    const colGapX = 150;
    const maxPerCol = 6;

    for (const n of cy.nodes().toArray()) {
      if (n.hasClass("refBadge")) continue;
      const refs = (n.data("refs") as string) || "";
      if (!refs.trim()) continue;

      const parsed = parseRefs(refs);
      if (parsed.length === 0) continue;

      const pos = n.position();

      const left = parsed.filter((_, i) => i % 2 === 0);
      const right = parsed.filter((_, i) => i % 2 === 1);

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
      ],
    });

    const cy = cyRef.current;
    if (!cy) return;

    cy.on("tap", "node", (evt) => {
      if ((evt.target as any).hasClass?.("refBadge")) return;
      setSelectedHash(evt.target.id());
    });

    cy.on("cxttap", "node", (evt) => {
      if ((evt.target as any).hasClass?.("refBadge")) return;
      const hash = evt.target.id();
      const oe = (evt as any).originalEvent as MouseEvent | undefined;
      if (!oe) return;
      setSelectedHash(hash);
      openCommitContextMenu(hash, oe.clientX, oe.clientY);
    });

    cy.on("tap", (evt) => {
      if (evt.target === cy) setSelectedHash("");
    });

    cy.on("cxttap", (evt) => {
      if (evt.target === cy) setCommitContextMenu(null);
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

    try {
      const entries = await invoke<GitStatusEntry[]>("git_status", { repoPath: activeRepoPath });
      setStatusEntries(entries);
      const nextSelected: Record<string, boolean> = {};
      for (const e of entries) nextSelected[e.path] = true;
      setSelectedPaths(nextSelected);
      setStatusSummaryByRepo((prev) => ({ ...prev, [activeRepoPath]: { changed: entries.length } }));
    } catch (e) {
      setStatusEntries([]);
      setSelectedPaths({});
      setCommitError(typeof e === "string" ? e : JSON.stringify(e));
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
      const ok = window.confirm(
        "Force push will rewrite history on the remote branch. Continue?",
      );
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
      const [ov, cs, remote, statusSummary, aheadBehind] = await Promise.all([
        invoke<RepoOverview>("repo_overview", { repoPath: path }),
        invoke<GitCommit[]>("list_commits", { repoPath: path, maxCount: 1200 }),
        invoke<string | null>("git_get_remote_url", { repoPath: path, remoteName: "origin" }),
        invoke<GitStatusSummary>("git_status_summary", { repoPath: path }),
        invoke<GitAheadBehind>("git_ahead_behind", { repoPath: path, remoteName: "origin" }),
      ]);

      setOverviewByRepo((prev) => ({ ...prev, [path]: ov }));
      setCommitsByRepo((prev) => ({ ...prev, [path]: cs }));
      setRemoteUrlByRepo((prev) => ({ ...prev, [path]: remote }));
      setStatusSummaryByRepo((prev) => ({ ...prev, [path]: statusSummary }));
      setAheadBehindByRepo((prev) => ({ ...prev, [path]: aheadBehind }));

      const headHash = cs.find((c) => c.is_head)?.hash || ov.head;
      setSelectedHash(headHash || "");
    } catch (e) {
      setOverviewByRepo((prev) => ({ ...prev, [path]: undefined }));
      setCommitsByRepo((prev) => ({ ...prev, [path]: [] }));
      setRemoteUrlByRepo((prev) => ({ ...prev, [path]: undefined }));
      setStatusSummaryByRepo((prev) => ({ ...prev, [path]: undefined }));
      setAheadBehindByRepo((prev) => ({ ...prev, [path]: undefined }));
      setError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setLoading(false);
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
                      void openRemoteDialog();
                    }}
                    disabled={!activeRepoPath || loading}
                  >
                    Remote…
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
                      setSettingsOpen(true);
                    }}
                  >
                    Settings…
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
              Settings
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
          <button type="button" disabled>
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
                <div key={b} className="sidebarItem">
                  {b}
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
              {(overview?.tags ?? []).slice(0, 30).map((t) => (
                <div key={t} className="sidebarItem">
                  {t}
                </div>
              ))}
            </div>
          </div>

          <div className="sidebarSection">
            <div className="sidebarTitle">Other</div>
            <div className="sidebarList">
              <div className="sidebarItem">Submodules</div>
              <div className="sidebarItem">Stashes</div>
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
                  <div className="zoomControls">
                    <div className="zoomIndicator">{zoomPct}%</div>
                    <button type="button" onClick={() => zoomBy(1.2)} disabled={!activeRepoPath}>
                      +
                    </button>
                    <button type="button" onClick={() => zoomBy(1 / 1.2)} disabled={!activeRepoPath}>
                      -
                    </button>
                    <button type="button" onClick={() => focusOnHash(selectedHash || headHash, 1, 0.22)} disabled={!activeRepoPath}>
                      Reset
                    </button>
                    <button type="button" onClick={focusOnHead} disabled={!activeRepoPath || !headHash}>
                      HEAD
                    </button>
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
              <h3>Details</h3>
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
            ) : (
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

      {commitModalOpen ? (
        <div className="modalOverlay" role="dialog" aria-modal="true">
          <div className="modal" style={{ width: "min(900px, 96vw)" }}>
            <div className="modalHeader">
              <div style={{ fontWeight: 900 }}>Commit</div>
              <button type="button" onClick={() => setCommitModalOpen(false)} disabled={commitBusy}>
                Close
              </button>
            </div>
            <div className="modalBody">
              {commitError ? <div className="error">{commitError}</div> : null}

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

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
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
                    <label key={e.path} className="statusRow">
                      <input
                        type="checkbox"
                        checked={!!selectedPaths[e.path]}
                        onChange={(ev) => setSelectedPaths((prev) => ({ ...prev, [e.path]: ev.target.checked }))}
                        disabled={commitBusy}
                      />
                      <span className="statusCode">{e.status}</span>
                      <span className="statusPath">{e.path}</span>
                    </label>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 12 }}>
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

      <SettingsModal
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
        }}
      />
    </div>
  );
}

export default App;
