import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { GitAheadBehind, GitStatusSummary } from "../../types/git";
import { useAppSettings } from "../../appSettingsStore";
import { gitAheadBehind, gitFetch, gitGetRemoteUrl, gitListRemoteTagTargets, gitListTagTargets, gitStatus, gitStatusSummary } from "../../api/git";
import { compileGraphoriaIgnore, filterGraphoriaIgnoredEntries } from "../../utils/graphoriaIgnore";

export function useRepoIndicators(opts: {
  setIndicatorsUpdatingByRepo: Dispatch<SetStateAction<Record<string, boolean>>>;
  setStatusSummaryByRepo: Dispatch<SetStateAction<Record<string, GitStatusSummary | undefined>>>;
  setRemoteUrlByRepo: Dispatch<SetStateAction<Record<string, string | null | undefined>>>;
  setAheadBehindByRepo: Dispatch<SetStateAction<Record<string, GitAheadBehind | undefined>>>;
  setTagsToPushByRepo: Dispatch<SetStateAction<Record<string, { newTags: string[]; movedTags: string[] } | undefined>>>;
}) {
  const { setIndicatorsUpdatingByRepo, setStatusSummaryByRepo, setRemoteUrlByRepo, setAheadBehindByRepo, setTagsToPushByRepo } = opts;

  const graphoriaIgnore = useAppSettings((s) => s.graphoriaIgnore);

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

  const refreshIndicators = useCallback(
    async (path: string) => {
      if (!path) return;
      setIndicatorsUpdatingByRepo((prev) => ({ ...prev, [path]: true }));
      try {
        const statusSummaryPromise = computeStatusSummary(path)
          .then((statusSummary) => {
            setStatusSummaryByRepo((prev) => ({ ...prev, [path]: statusSummary }));
          })
          .catch(() => undefined);

        const remote = await gitGetRemoteUrl(path, "origin").catch(() => null);
        setRemoteUrlByRepo((prev) => ({ ...prev, [path]: remote }));

        if (remote) {
          const tagsPromise = Promise.all([gitListTagTargets(path), gitListRemoteTagTargets({ repoPath: path, remoteName: "origin" })])
            .then(([local, remoteTags]) => {
              const remoteByName = new Map<string, string>();
              for (const t of remoteTags ?? []) remoteByName.set((t?.name ?? "").trim(), (t?.target ?? "").trim());

              const newTags: string[] = [];
              const movedTags: string[] = [];
              for (const t of local ?? []) {
                const name = (t?.name ?? "").trim();
                const target = (t?.target ?? "").trim();
                if (!name || !target) continue;
                const remoteTarget = remoteByName.get(name);
                if (!remoteTarget) {
                  newTags.push(name);
                } else if (remoteTarget !== target) {
                  movedTags.push(name);
                }
              }
              setTagsToPushByRepo((prev) => ({ ...prev, [path]: { newTags, movedTags } }));
            })
            .catch(() => {
              setTagsToPushByRepo((prev) => ({ ...prev, [path]: undefined }));
            });

          const initialAheadBehind = await gitAheadBehind(path, "origin").catch(() => undefined);
          if (initialAheadBehind) {
            setAheadBehindByRepo((prev) => ({ ...prev, [path]: initialAheadBehind }));
          }

          await gitFetch(path, "origin").catch(() => undefined);

          const updated = await gitAheadBehind(path, "origin").catch(() => initialAheadBehind);
          if (updated) {
            setAheadBehindByRepo((prev) => ({ ...prev, [path]: updated }));
          }

          await tagsPromise;
        } else {
          setTagsToPushByRepo((prev) => ({ ...prev, [path]: undefined }));
        }

        await statusSummaryPromise;
      } catch {
        // ignore
      } finally {
        setIndicatorsUpdatingByRepo((prev) => ({ ...prev, [path]: false }));
      }
    },
    [computeStatusSummary, setAheadBehindByRepo, setIndicatorsUpdatingByRepo, setRemoteUrlByRepo, setStatusSummaryByRepo, setTagsToPushByRepo],
  );

  return { refreshIndicators };
}
