import { useCallback, type Dispatch, type SetStateAction } from "react";
import { parseGitDubiousOwnershipError } from "../../utils/gitTrust";
import type { GitAheadBehind, GitCommit, GitStatusSummary, GitStashEntry, RepoOverview } from "../../types/git";
import { gitCheckWorktree } from "../../api/git";

export function useRepoOpenClose(opts: {
  defaultViewMode: "graph" | "commits";
  repos: string[];
  activeRepoPath: string;

  setGlobalError: Dispatch<SetStateAction<string>>;
  setErrorByRepo: Dispatch<SetStateAction<Record<string, string>>>;
  setPullErrorByRepo: Dispatch<SetStateAction<Record<string, string>>>;
  setSelectedHash: Dispatch<SetStateAction<string>>;
  setLoading: Dispatch<SetStateAction<boolean>>;

  setViewModeByRepo: Dispatch<SetStateAction<Record<string, "graph" | "commits">>>;
  setRepos: Dispatch<SetStateAction<string[]>>;
  setActiveRepoPath: Dispatch<SetStateAction<string>>;

  setOverviewByRepo: Dispatch<SetStateAction<Record<string, RepoOverview | undefined>>>;
  setCommitsByRepo: Dispatch<SetStateAction<Record<string, GitCommit[] | undefined>>>;
  setCommitsFullByRepo: Dispatch<SetStateAction<Record<string, boolean>>>;
  setCommitsFullLoadingByRepo: Dispatch<SetStateAction<Record<string, boolean>>>;
  setRemoteUrlByRepo: Dispatch<SetStateAction<Record<string, string | null | undefined>>>;
  setStatusSummaryByRepo: Dispatch<SetStateAction<Record<string, GitStatusSummary | undefined>>>;
  setAheadBehindByRepo: Dispatch<SetStateAction<Record<string, GitAheadBehind | undefined>>>;
  setStashesByRepo: Dispatch<SetStateAction<Record<string, GitStashEntry[] | undefined>>>;

  setGitTrustRepoPath: Dispatch<SetStateAction<string>>;
  setGitTrustDetails: Dispatch<SetStateAction<string>>;
  setGitTrustDetailsOpen: Dispatch<SetStateAction<boolean>>;
  setGitTrustActionError: Dispatch<SetStateAction<string>>;
  setGitTrustOpen: Dispatch<SetStateAction<boolean>>;

  loadRepo: (repoPath: string) => Promise<boolean>;
}) {
  const {
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
  } = opts;

  const openRepository = useCallback(
    async (path: string) => {
      setGlobalError("");
      setErrorByRepo((prev) => ({ ...prev, [path]: "" }));
      setPullErrorByRepo((prev) => ({ ...prev, [path]: "" }));
      setSelectedHash("");
      setLoading(true);

      try {
        await gitCheckWorktree(path);
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
    },
    [
      defaultViewMode,
      loadRepo,
      setActiveRepoPath,
      setErrorByRepo,
      setGitTrustActionError,
      setGitTrustDetails,
      setGitTrustDetailsOpen,
      setGitTrustOpen,
      setGitTrustRepoPath,
      setGlobalError,
      setLoading,
      setPullErrorByRepo,
      setRepos,
      setSelectedHash,
      setViewModeByRepo,
    ],
  );

  const closeRepository = useCallback(
    async (path: string) => {
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
    },
    [
      activeRepoPath,
      repos,
      setActiveRepoPath,
      setAheadBehindByRepo,
      setCommitsByRepo,
      setCommitsFullByRepo,
      setCommitsFullLoadingByRepo,
      setErrorByRepo,
      setPullErrorByRepo,
      setOverviewByRepo,
      setRemoteUrlByRepo,
      setRepos,
      setSelectedHash,
      setStashesByRepo,
      setStatusSummaryByRepo,
      setViewModeByRepo,
    ],
  );

  return { openRepository, closeRepository };
}
