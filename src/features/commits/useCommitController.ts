import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { DiffToolSettings } from "../../appSettingsStore";
import { gitCommit, gitGetRemoteUrl, gitPush, gitStatus } from "../../api/git";
import {
  gitHeadVsWorkingTextDiff,
  gitLaunchExternalDiffWorking,
  gitWorkingFileContent,
  gitWorkingFileDiff,
  gitWorkingFileImageBase64,
  gitWorkingFileTextPreview,
} from "../../api/gitWorkingFiles";
import type { GitStatusEntry, GitStatusSummary } from "../../types/git";
import { fileExtLower, isDocTextPreviewExt, isImageExt } from "../../utils/filePreview";

export function useCommitController(opts: {
  activeRepoPath: string;
  headName: string;
  diffTool: DiffToolSettings;
  loadRepo: (repoPath: string) => Promise<boolean>;
  setStatusSummaryByRepo: Dispatch<SetStateAction<Record<string, GitStatusSummary | undefined>>>;
}) {
  const { activeRepoPath, headName, diffTool, loadRepo, setStatusSummaryByRepo } = opts;

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

  async function refreshCommitStatusEntries() {
    if (!activeRepoPath) return;
    const entries = await gitStatus(activeRepoPath);
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
      const entries = await gitStatus(activeRepoPath);
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

        if (isDocTextPreviewExt(ext)) {
          if (st.startsWith("??")) {
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

        if (st.startsWith("??")) {
          const content = await gitWorkingFileContent({ repoPath: activeRepoPath, path: commitPreviewPath });
          if (!alive) return;
          setCommitPreviewContent(content);
          return;
        }

        const diff = await gitWorkingFileDiff({ repoPath: activeRepoPath, path: commitPreviewPath });
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
      setCommitError(typeof e === "string" ? e : JSON.stringify(e));
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

    refreshCommitStatusEntries,
    openCommitDialog,
    runCommit,
  };
}
