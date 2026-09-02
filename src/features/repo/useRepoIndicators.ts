import { useCallback, useRef, type Dispatch, type SetStateAction } from "react";
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

  // Refreshes for the same repository can overlap (tab switches, auto-refresh, an operation
  // finishing). Each run takes a ticket, and only the newest ticket for a path is allowed to write
  // state, so a slow earlier response can no longer overwrite fresher data.
  const refreshGenerationRef = useRef<Map<string, number>>(new Map());

  const refreshIndicators = useCallback(
    async (path: string) => {
      if (!path) return;

      const generation = (refreshGenerationRef.current.get(path) ?? 0) + 1;
      refreshGenerationRef.current.set(path, generation);
      const isCurrent = () => refreshGenerationRef.current.get(path) === generation;

      setIndicatorsUpdatingByRepo((prev) => ({ ...prev, [path]: true }));
      try {
        // Everything except the post-fetch ahead/behind is independent, so all probes start at
        // once and each writes its own slice of state as soon as it lands.
        const statusSummaryPromise = computeStatusSummary(path)
          .then((statusSummary) => {
            if (!isCurrent()) return;
            setStatusSummaryByRepo((prev) => ({ ...prev, [path]: statusSummary }));
          })
          .catch(() => undefined);

        const remotePromise = gitGetRemoteUrl(path, "origin")
          .catch(() => null)
          .then((remote) => {
            if (isCurrent()) {
              setRemoteUrlByRepo((prev) => ({ ...prev, [path]: remote }));
            }
            return remote;
          });

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
            return { newTags, movedTags };
          })
          .catch(() => undefined);

        const initialAheadBehindPromise = gitAheadBehind(path, "origin").catch(() => undefined);

        // Tags are only meaningful against an existing remote, so the write waits for the (fast)
        // remote lookup instead of for the whole refresh.
        const tagsWritePromise = Promise.all([remotePromise, tagsPromise])
          .then(([remote, tags]) => {
            if (!isCurrent()) return;
            setTagsToPushByRepo((prev) => ({ ...prev, [path]: remote ? tags : undefined }));
          })
          .catch(() => undefined);

        const [remote, initialAheadBehind] = await Promise.all([remotePromise, initialAheadBehindPromise]);

        if (remote) {
          if (isCurrent() && initialAheadBehind) {
            setAheadBehindByRepo((prev) => ({ ...prev, [path]: initialAheadBehind }));
          }

          // The second ahead/behind must observe the state left by the fetch, hence sequential.
          await gitFetch(path, "origin").catch(() => undefined);

          const updated = await gitAheadBehind(path, "origin").catch(() => initialAheadBehind);
          if (isCurrent() && updated) {
            setAheadBehindByRepo((prev) => ({ ...prev, [path]: updated }));
          }
        }

        await Promise.allSettled([statusSummaryPromise, tagsWritePromise]);
      } catch {
        // ignore
      } finally {
        if (isCurrent()) {
          setIndicatorsUpdatingByRepo((prev) => ({ ...prev, [path]: false }));
        }
      }
    },
    [computeStatusSummary, setAheadBehindByRepo, setIndicatorsUpdatingByRepo, setRemoteUrlByRepo, setStatusSummaryByRepo, setTagsToPushByRepo],
  );

  return { refreshIndicators };
}
