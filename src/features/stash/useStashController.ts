import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { DiffToolSettings } from "../../appSettingsStore";
import type { GitStatusEntry, GitStatusSummary, GitStashEntry } from "../../types/git";
import { buildPatchFromUnselectedHunks, computeHunkRanges } from "../../utils/diffPatch";
import { fileExtLower, isDocTextPreviewExt, isImageExt } from "../../utils/filePreview";
import {
  gitHasStagedChanges,
  gitStashApply,
  gitStashBaseCommit,
  gitStashClear,
  gitStashDrop,
  gitStashPushPatch,
  gitStashPushPaths,
  gitStashShow,
  gitStatus,
} from "../../api/git";
import {
  gitHeadVsWorkingTextDiff,
  gitLaunchExternalDiffWorking,
  gitWorkingFileContent,
  gitWorkingFileDiffUnified,
  gitWorkingFileImageBase64,
  gitWorkingFileTextPreview,
} from "../../api/gitWorkingFiles";

export function useStashController(opts: {
  activeRepoPath: string;
  stashes: GitStashEntry[];
  viewMode: "graph" | "commits";
  showStashesOnGraph: boolean;
  diffTool: DiffToolSettings;

  loadRepo: (repoPath: string) => Promise<boolean>;
  setLoading: (next: boolean) => void;
  setError: (msg: string) => void;
  setStatusSummaryByRepo: Dispatch<SetStateAction<Record<string, GitStatusSummary | undefined>>>;
}) {
  const { activeRepoPath, stashes, viewMode, showStashesOnGraph, diffTool, loadRepo, setLoading, setError, setStatusSummaryByRepo } = opts;

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

  useEffect(() => {
    if (viewMode !== "graph") return;
    if (!showStashesOnGraph) return;
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
            const base = await gitStashBaseCommit({ repoPath: repo, stashRef: s.reference });
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
  }, [activeRepoPath, showStashesOnGraph, stashes, stashBaseByRepo, viewMode]);

  const stashHunkRanges = useMemo(() => {
    if (!stashPreviewDiff) return [] as Array<{ index: number; header: string; start: number; end: number }>;
    return computeHunkRanges(stashPreviewDiff).ranges;
  }, [stashPreviewDiff]);

  async function refreshStashStatusEntries() {
    if (!activeRepoPath) return;
    setStashError("");
    try {
      const entries = await gitStatus(activeRepoPath);
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
    } catch (e) {
      setStashError(typeof e === "string" ? e : JSON.stringify(e));
    }
  }

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
      const entries = await gitStatus(activeRepoPath);
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

  async function toggleAdvancedMode(next: boolean) {
    if (next && diffTool.difftool !== "Graphoria builtin diff") {
      setStashError("Advanced mode requires Graphoria builtin diff.");
      return;
    }

    if (next && activeRepoPath) {
      try {
        const has = await gitHasStagedChanges(activeRepoPath);
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

    const p = stashPreviewPath.trim();
    const isDirLike = p.endsWith("/") || p.endsWith("\\");
    if (isDirLike) {
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
          await gitLaunchExternalDiffWorking({ repoPath: activeRepoPath, path: stashPreviewPath, toolPath: diffTool.path, command: diffTool.command });
          if (!alive) return;
          setStashPreviewContent("Opened in external diff tool.");
          return;
        }

        const ext = fileExtLower(stashPreviewPath);
        if (isImageExt(ext)) {
          const b64 = await gitWorkingFileImageBase64({ repoPath: activeRepoPath, path: stashPreviewPath });
          if (!alive) return;
          setStashPreviewImageBase64(b64);
          return;
        }

        const st = stashPreviewStatus.trim();

        if (isDocTextPreviewExt(ext)) {
          if (st.startsWith("??")) {
            const content = await gitWorkingFileTextPreview({ repoPath: activeRepoPath, path: stashPreviewPath });
            if (!alive) return;
            setStashPreviewContent(content);
            return;
          }

          const diff = await gitHeadVsWorkingTextDiff({ repoPath: activeRepoPath, path: stashPreviewPath, unified: stashAdvancedMode ? 20 : 3 });
          if (!alive) return;
          if (diff.trim()) {
            setStashPreviewDiff(diff);
            return;
          }

          const content = await gitWorkingFileTextPreview({ repoPath: activeRepoPath, path: stashPreviewPath });
          if (!alive) return;
          setStashPreviewContent(content);
          return;
        }

        if (st.startsWith("??")) {
          const content = await gitWorkingFileContent({ repoPath: activeRepoPath, path: stashPreviewPath });
          if (!alive) return;
          setStashPreviewContent(content);
          return;
        }

        const diff = await gitWorkingFileDiffUnified({ repoPath: activeRepoPath, path: stashPreviewPath, unified: stashAdvancedMode ? 20 : 3 });
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

        await gitStashPushPaths({ repoPath: activeRepoPath, message: stashMessage, paths, includeUntracked });
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
        await gitStashPushPatch({ repoPath: activeRepoPath, message: stashMessage, path: stashPreviewPath, keepPatch });
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
      const patch = await gitStashShow({ repoPath: activeRepoPath, stashRef: entry.reference });
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
      await gitStashApply({ repoPath: activeRepoPath, stashRef });
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
      await gitStashApply({ repoPath: activeRepoPath, stashRef: stashViewRef });
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
      await gitStashDrop({ repoPath: activeRepoPath, stashRef });
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
      await gitStashDrop({ repoPath: activeRepoPath, stashRef: stashViewRef });
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
      await gitStashClear(activeRepoPath);
      await loadRepo(activeRepoPath);
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setLoading(false);
    }
  }

  return {
    stashModalOpen,
    setStashModalOpen,
    stashStatusEntries,
    setStashStatusEntries,
    stashSelectedPaths,
    setStashSelectedPaths,
    stashMessage,
    setStashMessage,
    stashBusy,
    setStashBusy,
    stashError,
    setStashError,

    stashPreviewPath,
    setStashPreviewPath,
    stashPreviewStatus,
    setStashPreviewStatus,
    stashPreviewDiff,
    setStashPreviewDiff,
    stashPreviewContent,
    setStashPreviewContent,
    stashPreviewImageBase64,
    setStashPreviewImageBase64,
    stashPreviewLoading,
    setStashPreviewLoading,
    stashPreviewError,
    setStashPreviewError,

    stashAdvancedMode,
    setStashAdvancedMode,
    stashHunksByPath,
    setStashHunksByPath,
    stashHunkRanges,

    stashViewOpen,
    setStashViewOpen,
    stashViewRef,
    setStashViewRef,
    stashViewMessage,
    setStashViewMessage,
    stashViewPatch,
    setStashViewPatch,
    stashViewLoading,
    setStashViewLoading,
    stashViewError,
    setStashViewError,

    stashBaseByRepo,
    setStashBaseByRepo,

    openStashDialog,
    refreshStashStatusEntries,
    toggleAdvancedMode,
    runStash,
    openStashView,
    applyStashByRef,
    applyStashFromView,
    dropStashByRef,
    dropStashFromView,
    clearAllStashes,
  };
}
