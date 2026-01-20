import { useEffect, useState } from "react";
import type { DiffToolSettings } from "../../appSettingsStore";
import { gitPullPredictConflictPreview } from "../../api/git";
import {
  gitHeadVsWorkingTextDiff,
  gitLaunchExternalDiffWorking,
  gitWorkingFileContent,
  gitWorkingFileDiff,
  gitWorkingFileImageBase64,
  gitWorkingFileTextPreview,
} from "../../api/gitWorkingFiles";
import { fileExtLower, isDocTextPreviewExt, isImageExt } from "../../utils/filePreview";

export function useFilePreviewController(opts: {
  activeRepoPath: string;
  diffTool: DiffToolSettings;
}) {
  const { activeRepoPath, diffTool } = opts;

  const [filePreviewOpen, setFilePreviewOpen] = useState(false);
  const [filePreviewPath, setFilePreviewPath] = useState("");
  const [filePreviewUpstream, setFilePreviewUpstream] = useState("");
  const [filePreviewMode, setFilePreviewMode] = useState<"normal" | "pullPredict">("normal");
  const [filePreviewDiff, setFilePreviewDiff] = useState("");
  const [filePreviewContent, setFilePreviewContent] = useState("");
  const [filePreviewImageBase64, setFilePreviewImageBase64] = useState("");
  const [filePreviewLoading, setFilePreviewLoading] = useState(false);
  const [filePreviewError, setFilePreviewError] = useState("");

  function openFilePreview(path: string) {
    const p = path.trim();
    if (!p) return;
    setFilePreviewMode("normal");
    setFilePreviewUpstream("");
    setFilePreviewOpen(true);
    setFilePreviewPath(p);
  }

  function openPullPredictConflictPreview(path: string, upstream: string) {
    const p = path.trim();
    if (!p) return;
    const u = (upstream ?? "").trim();
    setFilePreviewMode(u ? "pullPredict" : "normal");
    setFilePreviewUpstream(u);
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
          const content = await gitPullPredictConflictPreview({
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
          await gitLaunchExternalDiffWorking({
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
          const b64 = await gitWorkingFileImageBase64({ repoPath: activeRepoPath, path: filePreviewPath });
          if (!alive) return;
          setFilePreviewImageBase64(b64);
          return;
        }

        if (isDocTextPreviewExt(ext)) {
          const diff = await gitHeadVsWorkingTextDiff({ repoPath: activeRepoPath, path: filePreviewPath, unified: 3 });
          if (!alive) return;
          if (diff.trim()) {
            setFilePreviewDiff(diff);
            return;
          }

          const content = await gitWorkingFileTextPreview({ repoPath: activeRepoPath, path: filePreviewPath });
          if (!alive) return;
          setFilePreviewContent(content);
          return;
        }

        const diff = await gitWorkingFileDiff({ repoPath: activeRepoPath, path: filePreviewPath });
        if (!alive) return;
        if (diff.trim()) {
          setFilePreviewDiff(diff);
          return;
        }

        const content = await gitWorkingFileContent({ repoPath: activeRepoPath, path: filePreviewPath });
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

  return {
    filePreviewOpen,
    setFilePreviewOpen,
    filePreviewPath,
    filePreviewUpstream,
    filePreviewMode,
    filePreviewDiff,
    filePreviewContent,
    filePreviewImageBase64,
    filePreviewLoading,
    filePreviewError,
    openFilePreview,
    openPullPredictConflictPreview,
  };
}
