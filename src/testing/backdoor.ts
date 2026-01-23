export const GRAPHORIA_OPEN_REPO_EVENT = "graphoria-open-repo";
export const GRAPHORIA_RESET_SETTINGS_EVENT = "graphoria-reset-settings";

export function installTestBackdoor(opts: {
  openRepository: (repoPath: string) => void | Promise<void>;
  setViewModeForRepo: (repoPath: string, mode: "graph" | "commits") => void;
  resetSettings?: () => void;
}) {
  const { openRepository, setViewModeForRepo, resetSettings } = opts;

  const openRepoHandler = (ev: Event) => {
    const ce = ev as CustomEvent<{ repoPath?: string; viewMode?: "graph" | "commits" } | undefined>;
    const repoPath = (ce.detail?.repoPath ?? "").trim();
    if (!repoPath) return;
    const viewMode = ce.detail?.viewMode;

    if (viewMode === "graph" || viewMode === "commits") {
      setViewModeForRepo(repoPath, viewMode);
    }
    void openRepository(repoPath);
  };

  const resetHandler = () => {
    resetSettings?.();
  };

  window.addEventListener(GRAPHORIA_OPEN_REPO_EVENT, openRepoHandler);
  window.addEventListener(GRAPHORIA_RESET_SETTINGS_EVENT, resetHandler);

  const envRepoPath = (import.meta as any).env?.VITE_E2E_REPO_PATH as string | undefined;
  if (typeof envRepoPath === "string" && envRepoPath.trim()) {
    const p = envRepoPath.trim();
    queueMicrotask(() => {
      setViewModeForRepo(p, "commits");
      void openRepository(p);
    });
  }

  (window as any).__graphoria_test_backdoor_installed = true;

  return () => {
    window.removeEventListener(GRAPHORIA_OPEN_REPO_EVENT, openRepoHandler);
    window.removeEventListener(GRAPHORIA_RESET_SETTINGS_EVENT, resetHandler);
    (window as any).__graphoria_test_backdoor_installed = false;
  };
}
