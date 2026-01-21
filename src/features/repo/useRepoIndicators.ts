import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { GitAheadBehind, GitStatusSummary } from "../../types/git";
import { gitAheadBehind, gitFetch, gitGetRemoteUrl, gitStatusSummary } from "../../api/git";

export function useRepoIndicators(opts: {
  setIndicatorsUpdatingByRepo: Dispatch<SetStateAction<Record<string, boolean>>>;
  setStatusSummaryByRepo: Dispatch<SetStateAction<Record<string, GitStatusSummary | undefined>>>;
  setRemoteUrlByRepo: Dispatch<SetStateAction<Record<string, string | null | undefined>>>;
  setAheadBehindByRepo: Dispatch<SetStateAction<Record<string, GitAheadBehind | undefined>>>;
}) {
  const { setIndicatorsUpdatingByRepo, setStatusSummaryByRepo, setRemoteUrlByRepo, setAheadBehindByRepo } = opts;

  const refreshIndicators = useCallback(
    async (path: string) => {
      if (!path) return;
      setIndicatorsUpdatingByRepo((prev) => ({ ...prev, [path]: true }));
      try {
        const statusSummaryPromise = gitStatusSummary(path)
          .then((statusSummary) => {
            setStatusSummaryByRepo((prev) => ({ ...prev, [path]: statusSummary }));
          })
          .catch(() => undefined);

        const remote = await gitGetRemoteUrl(path, "origin").catch(() => null);
        setRemoteUrlByRepo((prev) => ({ ...prev, [path]: remote }));

        if (remote) {
          const initialAheadBehind = await gitAheadBehind(path, "origin").catch(() => undefined);
          if (initialAheadBehind) {
            setAheadBehindByRepo((prev) => ({ ...prev, [path]: initialAheadBehind }));
          }

          await gitFetch(path, "origin").catch(() => undefined);

          const updated = await gitAheadBehind(path, "origin").catch(() => initialAheadBehind);
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
    },
    [setAheadBehindByRepo, setIndicatorsUpdatingByRepo, setRemoteUrlByRepo, setStatusSummaryByRepo],
  );

  return { refreshIndicators };
}
