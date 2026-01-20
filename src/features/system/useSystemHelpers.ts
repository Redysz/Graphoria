import { useCallback } from "react";
import type { TerminalSettings } from "../../appSettingsStore";
import { openInFileExplorer, openTerminalProfile as openTerminalProfileApi } from "../../api/system";

export function useSystemHelpers(opts: { activeRepoPath: string; terminalSettings: TerminalSettings; setError: (msg: string) => void }) {
  const { activeRepoPath, terminalSettings, setError } = opts;

  const openTerminalProfile = useCallback(
    async (profileId?: string, repoPathOverride?: string) => {
      const repoPath = repoPathOverride ?? activeRepoPath;
      if (!repoPath) return;

      const profiles = terminalSettings.profiles ?? [];
      const selected = (profileId ? profiles.find((p) => p.id === profileId) : null) ??
        profiles.find((p) => p.id === terminalSettings.defaultProfileId) ??
        profiles[0];
      if (!selected) {
        setError("No terminal profiles configured.");
        return;
      }

      setError("");
      try {
        await openTerminalProfileApi({ repoPath, kind: selected.kind, command: selected.command, args: selected.args });
      } catch (e) {
        setError(typeof e === "string" ? e : JSON.stringify(e));
      }
    },
    [activeRepoPath, setError, terminalSettings.defaultProfileId, terminalSettings.profiles],
  );

  const openActiveRepoInExplorer = useCallback(async () => {
    if (!activeRepoPath) return;

    setError("");
    try {
      await openInFileExplorer(activeRepoPath);
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
    }
  }, [activeRepoPath, setError]);

  return { openTerminalProfile, openActiveRepoInExplorer };
}
