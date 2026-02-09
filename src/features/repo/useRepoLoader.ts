import { useCallback, type Dispatch, type SetStateAction } from "react";
import { parseGitDubiousOwnershipError } from "../../utils/gitTrust";
import type { GitCommit, GitStatusSummary, GitStashEntry, RepoOverview } from "../../types/git";
import type { GitHistoryOrder } from "../../appSettingsStore";
import { useAppSettings } from "../../appSettingsStore";
import { gitStashList, gitStatus, gitStatusSummary, listCommits, listCommitsFull, repoOverview } from "../../api/git";
import { compileGraphoriaIgnore, filterGraphoriaIgnoredEntries } from "../../utils/graphoriaIgnore";

export function useRepoLoader(opts: {
  activeRepoPath: string;
  commitsFullByRepo: Record<string, boolean>;
  commitsOnlyHead: boolean;
  commitsHistoryOrder: GitHistoryOrder;

  setLoading: (next: boolean) => void;
  setError: (msg: string) => void;
  setSelectedHash: Dispatch<SetStateAction<string>>;

  setCommitsByRepo: Dispatch<SetStateAction<Record<string, GitCommit[] | undefined>>>;
  setCommitsHasMoreByRepo: Dispatch<SetStateAction<Record<string, boolean | undefined>>>;
  setOverviewByRepo: Dispatch<SetStateAction<Record<string, RepoOverview | undefined>>>;
  setStatusSummaryByRepo: Dispatch<SetStateAction<Record<string, GitStatusSummary | undefined>>>;
  setRemoteUrlByRepo: Dispatch<SetStateAction<Record<string, string | null | undefined>>>;
  setAheadBehindByRepo: Dispatch<SetStateAction<Record<string, { ahead: number; behind: number; upstream?: string | null } | undefined>>>;
  setStashesByRepo: Dispatch<SetStateAction<Record<string, GitStashEntry[] | undefined>>>;

  setGitTrustRepoPath: Dispatch<SetStateAction<string>>;
  setGitTrustDetails: Dispatch<SetStateAction<string>>;
  setGitTrustDetailsOpen: Dispatch<SetStateAction<boolean>>;
  setGitTrustActionError: Dispatch<SetStateAction<string>>;
  setGitTrustOpen: Dispatch<SetStateAction<boolean>>;
}) {
  const graphoriaIgnore = useAppSettings((s) => s.graphoriaIgnore);

  const {
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
  } = opts;

  const computeStatusSummary = useCallback(
    async (repoPath: string): Promise<GitStatusSummary> => {
      const repoText = graphoriaIgnore.repoTextByPath?.[repoPath] ?? "";
      const text = `${graphoriaIgnore.globalText ?? ""}\n${repoText}`;
      const rules = compileGraphoriaIgnore(text);
      if (rules.length === 0) return await gitStatusSummary(repoPath);
      const entriesRaw = await gitStatus(repoPath);
      const entries = filterGraphoriaIgnoredEntries(entriesRaw, rules);
      return { changed: entries.length };
    },
    [graphoriaIgnore.globalText, graphoriaIgnore.repoTextByPath],
  );

  const loadRepo = useCallback(
    async (nextRepoPath?: string, forceFullHistory?: boolean, updateSelection?: boolean): Promise<boolean> => {
      const path = nextRepoPath ?? activeRepoPath;
      if (!path) return false;

      const shouldUpdateSelection = updateSelection !== false;

      const fullHistory = typeof forceFullHistory === "boolean" ? forceFullHistory : Boolean(commitsFullByRepo[path]);

      if (shouldUpdateSelection) {
        setLoading(true);
        setError("");
      }
      try {
        const commitsPromise = fullHistory
          ? listCommitsFull({ repoPath: path, onlyHead: commitsOnlyHead, historyOrder: commitsHistoryOrder })
          : listCommits({ repoPath: path, maxCount: 2001, onlyHead: commitsOnlyHead, historyOrder: commitsHistoryOrder });

        const cs = await commitsPromise;

        if (fullHistory) {
          setCommitsHasMoreByRepo((prev) => ({ ...prev, [path]: false }));
          setCommitsByRepo((prev) => ({ ...prev, [path]: cs }));
        } else {
          const hasMore = cs.length > 2000;
          const trimmed = hasMore ? cs.slice(0, 2000) : cs;
          setCommitsHasMoreByRepo((prev) => ({ ...prev, [path]: hasMore }));
          setCommitsByRepo((prev) => ({ ...prev, [path]: trimmed }));
        }

        if (shouldUpdateSelection) {
          const headHash = cs.find((c) => c.is_head)?.hash || "";
          setSelectedHash(headHash);
          setLoading(false);
        }

        void Promise.allSettled([repoOverview(path), computeStatusSummary(path)]).then(([ovRes, statusSummaryRes]) => {
          if (ovRes.status === "fulfilled") {
            setOverviewByRepo((prev) => ({ ...prev, [path]: ovRes.value }));
          }
          if (statusSummaryRes.status === "fulfilled") {
            setStatusSummaryByRepo((prev) => ({ ...prev, [path]: statusSummaryRes.value }));
          }
        });

        void gitStashList(path)
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
        setCommitsHasMoreByRepo((prev) => ({ ...prev, [path]: undefined }));
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
    },
    [
      activeRepoPath,
      commitsFullByRepo,
      commitsHistoryOrder,
      commitsOnlyHead,
      computeStatusSummary,
      setAheadBehindByRepo,
      setCommitsByRepo,
      setCommitsHasMoreByRepo,
      setError,
      setGitTrustActionError,
      setGitTrustDetails,
      setGitTrustDetailsOpen,
      setGitTrustOpen,
      setGitTrustRepoPath,
      setLoading,
      setOverviewByRepo,
      setRemoteUrlByRepo,
      setSelectedHash,
      setStashesByRepo,
      setStatusSummaryByRepo,
    ],
  );

  return { loadRepo };
}
