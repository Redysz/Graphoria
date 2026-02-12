import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { DiffToolSettings } from "../../appSettingsStore";
import { useAppSettings } from "../../appSettingsStore";
import { gitCommit, gitCommitPatch, gitGetRemoteUrl, gitPush, gitStatus } from "../../api/git";
import {
  gitHeadVsWorkingTextDiff,
  gitLaunchExternalDiffWorking,
  gitWorkingFileContent,
  gitWorkingFileDiff,
  gitWorkingFileDiffUnified,
  gitWorkingFileImageBase64,
  gitWorkingFileTextPreview,
} from "../../api/gitWorkingFiles";
import type { GitStatusEntry, GitStatusSummary } from "../../types/git";
import { buildPatchFromSelectedHunks, computeHunkRanges } from "../../utils/diffPatch";
import { fileExtLower, isDocTextPreviewExt, isImageExt } from "../../utils/filePreview";
import { compileGraphoriaIgnore, filterGraphoriaIgnoredEntries } from "../../utils/graphoriaIgnore";

export function useCommitController(opts: {
  activeRepoPath: string;
  headName: string;
  diffTool: DiffToolSettings;
  loadRepo: (repoPath: string) => Promise<boolean>;
  setStatusSummaryByRepo: Dispatch<SetStateAction<Record<string, GitStatusSummary | undefined>>>;
}) {
  const { activeRepoPath, headName, diffTool, loadRepo, setStatusSummaryByRepo } = opts;

  const graphoriaIgnore = useAppSettings((s) => s.graphoriaIgnore);

  const ignoreRules = useMemo(() => {
    const repoText = graphoriaIgnore.repoTextByPath?.[activeRepoPath] ?? "";
    const text = `${graphoriaIgnore.globalText ?? ""}\n${repoText}`;
    return compileGraphoriaIgnore(text);
  }, [activeRepoPath, graphoriaIgnore.globalText, graphoriaIgnore.repoTextByPath]);

  function errorToString(e: unknown) {
    if (typeof e === "string") return e;
    if (e instanceof Error) return e.message || String(e);
    try {
      const j = JSON.stringify(e);
      if (j && j !== "{}") return j;
    } catch {
      // ignore
    }
    return String(e);
  }

  const [commitModalOpen, setCommitModalOpen] = useState(false);
  const [statusEntries, setStatusEntries] = useState<GitStatusEntry[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Record<string, boolean>>({});
  const [commitMessage, setCommitMessage] = useState("");
  const [commitAlsoPush, setCommitAlsoPush] = useState(false);
  const [commitBusy, setCommitBusy] = useState(false);
  const [commitError, setCommitError] = useState("");

  const [commitPreviewPath, setCommitPreviewPath] = useState("");
  const [commitPreviewStatus, setCommitPreviewStatus] = useState("");
  const [commitPreviewDiff, setCommitPreviewDiff] = useState("");
  const [commitPreviewContent, setCommitPreviewContent] = useState("");
  const [commitPreviewImageBase64, setCommitPreviewImageBase64] = useState("");
  const [commitPreviewLoading, setCommitPreviewLoading] = useState(false);
  const [commitPreviewError, setCommitPreviewError] = useState("");

  const [commitAdvancedMode, setCommitAdvancedMode] = useState(false);
  const [commitHunksByPath, setCommitHunksByPath] = useState<Record<string, number[]>>({});

  const commitHunkRanges = useMemo(() => {
    if (!commitPreviewDiff) return [] as Array<{ index: number; header: string; start: number; end: number }>;
    return computeHunkRanges(commitPreviewDiff).ranges;
  }, [commitPreviewDiff]);

  async function refreshCommitStatusEntries() {
    if (!activeRepoPath) return;
    setCommitError("");
    try {
      const entriesRaw = await gitStatus(activeRepoPath);
      const entries = filterGraphoriaIgnoredEntries(entriesRaw, ignoreRules);
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
    } catch (e) {
      setCommitError(errorToString(e));
    }
  }

  async function openCommitDialog() {
    if (!activeRepoPath) return;
    setCommitError("");
    setCommitMessage("");
    setCommitAlsoPush(false);
    setCommitModalOpen(true);
    setCommitAdvancedMode(false);
    setCommitHunksByPath({});
    setCommitPreviewPath("");
    setCommitPreviewStatus("");
    setCommitPreviewDiff("");
    setCommitPreviewContent("");
    setCommitPreviewError("");

    try {
      const entriesRaw = await gitStatus(activeRepoPath);
      const entries = filterGraphoriaIgnoredEntries(entriesRaw, ignoreRules);
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
      setCommitError(errorToString(e));
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

    const p = commitPreviewPath.trim();
    const isDirLike = p.endsWith("/") || p.endsWith("\\");
    if (isDirLike) {
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
          await gitLaunchExternalDiffWorking({
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
          const b64 = await gitWorkingFileImageBase64({ repoPath: activeRepoPath, path: commitPreviewPath });
          if (!alive) return;
          setCommitPreviewImageBase64(b64);
          return;
        }

        const st = commitPreviewStatus.trim();

        const isNewOrRenamed = st.startsWith("??") || st.startsWith("R");

        if (isDocTextPreviewExt(ext)) {
          if (isNewOrRenamed) {
            const content = await gitWorkingFileTextPreview({ repoPath: activeRepoPath, path: commitPreviewPath });
            if (!alive) return;
            setCommitPreviewContent(content);
            return;
          }

          const diff = await gitHeadVsWorkingTextDiff({ repoPath: activeRepoPath, path: commitPreviewPath, unified: 3 });
          if (!alive) return;
          if (diff.trim()) {
            setCommitPreviewDiff(diff);
            return;
          }

          const content = await gitWorkingFileTextPreview({ repoPath: activeRepoPath, path: commitPreviewPath });
          if (!alive) return;
          setCommitPreviewContent(content);
          return;
        }

        if (isNewOrRenamed) {
          const content = await gitWorkingFileContent({ repoPath: activeRepoPath, path: commitPreviewPath });
          if (!alive) return;
          setCommitPreviewContent(content);
          return;
        }

        const diff = commitAdvancedMode
          ? await gitWorkingFileDiffUnified({ repoPath: activeRepoPath, path: commitPreviewPath, unified: 20 })
          : await gitWorkingFileDiff({ repoPath: activeRepoPath, path: commitPreviewPath });
        if (!alive) return;
        setCommitPreviewDiff(diff);
      } catch (e) {
        if (!alive) return;
        setCommitPreviewError(errorToString(e));
      } finally {
        if (!alive) return;
        setCommitPreviewLoading(false);
      }
    };

    void run();
    return () => {
      alive = false;
    };
  }, [
    activeRepoPath,
    commitModalOpen,
    commitPreviewPath,
    commitPreviewStatus,
    commitAdvancedMode,
    diffTool.command,
    diffTool.difftool,
    diffTool.path,
  ]);

  async function toggleAdvancedMode(next: boolean) {
    if (next && diffTool.difftool !== "Graphoria builtin diff") {
      setCommitError("Advanced mode requires Graphoria builtin diff.");
      return;
    }
    setCommitError("");
    setCommitAdvancedMode(next);
  }

  async function runCommit() {
    if (!activeRepoPath) return;

    if (!commitAdvancedMode) {
      const paths = statusEntries.filter((e) => selectedPaths[e.path]).flatMap((e) => e.old_path ? [e.path, e.old_path] : [e.path]);
      if (paths.length === 0) {
        setCommitError("No files selected.");
        return;
      }

      setCommitBusy(true);
      setCommitError("");
      try {
        await gitCommit({ repoPath: activeRepoPath, message: commitMessage, paths });

        if (commitAlsoPush) {
          const currentRemote = await gitGetRemoteUrl(activeRepoPath, "origin");

          if (!currentRemote) {
            setCommitError("No remote origin set. Configure Remote first.");
            return;
          }

          if (headName === "(detached)") {
            setCommitError("Cannot push from detached HEAD.");
            return;
          }

          await gitPush({ repoPath: activeRepoPath, remoteName: "origin", force: false });
        }

        setCommitModalOpen(false);
        await loadRepo(activeRepoPath);
      } catch (e) {
        setCommitError(errorToString(e));
      } finally {
        setCommitBusy(false);
      }
      return;
    }

    if (diffTool.difftool !== "Graphoria builtin diff") {
      setCommitError("Advanced mode requires Graphoria builtin diff.");
      return;
    }

    const picked: Array<{ path: string; indices: number[] }> = [];
    for (const [p, indices] of Object.entries(commitHunksByPath)) {
      if (!selectedPaths[p]) continue;
      if (!indices || indices.length === 0) continue;
      picked.push({ path: p, indices });
    }
    if (picked.length === 0) {
      setCommitError("No hunks selected.");
      return;
    }

    setCommitBusy(true);
    setCommitError("");
    try {
      const patches: Array<{ path: string; patch: string }> = [];

      for (const item of picked) {
        const st = statusEntries.find((e) => e.path === item.path)?.status?.trim() ?? "";
        if (st.startsWith("??")) {
          throw new Error("Partial commit is not supported for untracked files.");
        }

        const ext = fileExtLower(item.path);
        if (isImageExt(ext) || isDocTextPreviewExt(ext)) {
          throw new Error("Partial commit is not supported for this file type.");
        }

        const diffText = await gitWorkingFileDiffUnified({ repoPath: activeRepoPath, path: item.path, unified: 20 });
        const patch = buildPatchFromSelectedHunks(diffText, new Set(item.indices));
        if (patch.trim()) {
          patches.push({ path: item.path, patch });
        }
      }

      if (patches.length === 0) {
        setCommitError("No hunks selected.");
        return;
      }

      await gitCommitPatch({ repoPath: activeRepoPath, message: commitMessage, patches });

      if (commitAlsoPush) {
        const currentRemote = await gitGetRemoteUrl(activeRepoPath, "origin");

        if (!currentRemote) {
          setCommitError("No remote origin set. Configure Remote first.");
          return;
        }

        if (headName === "(detached)") {
          setCommitError("Cannot push from detached HEAD.");
          return;
        }

        await gitPush({ repoPath: activeRepoPath, remoteName: "origin", force: false });
      }

      setCommitModalOpen(false);
      await loadRepo(activeRepoPath);
    } catch (e) {
      setCommitError(errorToString(e));
    } finally {
      setCommitBusy(false);
    }
  }

  return {
    commitModalOpen,
    setCommitModalOpen,
    statusEntries,
    setStatusEntries,
    selectedPaths,
    setSelectedPaths,
    commitMessage,
    setCommitMessage,
    commitAlsoPush,
    setCommitAlsoPush,
    commitBusy,
    setCommitBusy,
    commitError,
    setCommitError,

    commitPreviewPath,
    setCommitPreviewPath,
    commitPreviewStatus,
    setCommitPreviewStatus,
    commitPreviewDiff,
    commitPreviewContent,
    commitPreviewImageBase64,
    commitPreviewLoading,
    commitPreviewError,

    commitAdvancedMode,
    setCommitAdvancedMode,
    commitHunksByPath,
    setCommitHunksByPath,
    commitHunkRanges,

    refreshCommitStatusEntries,
    openCommitDialog,
    toggleAdvancedMode,
    runCommit,
  };
}
