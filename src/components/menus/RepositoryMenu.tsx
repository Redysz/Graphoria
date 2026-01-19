import type { ReactNode } from "react";
import type { ShortcutActionId } from "../../shortcuts";

export function RepositoryMenu(props: {
  repositoryMenuOpen: boolean;
  setRepositoryMenuOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
  closeOtherMenus: () => void;

  loading: boolean;
  cloneBusy: boolean;
  activeRepoPath: string;
  remoteUrl: string | null | undefined;

  openCloneDialog: () => void;
  pickRepository: () => void | Promise<void>;
  initializeProject: () => void | Promise<void>;
  openRemoteDialog: () => void | Promise<void>;
  loadRepo: (repoPath: string) => void | Promise<unknown>;
  runFetch: () => void | Promise<void>;
  openActiveRepoInExplorer: () => void | Promise<void>;

  menuItem: (left: ReactNode, shortcutText?: string) => ReactNode;
  shortcutLabel: (id: ShortcutActionId) => string;
}) {
  const {
    repositoryMenuOpen,
    setRepositoryMenuOpen,
    closeOtherMenus,
    loading,
    cloneBusy,
    activeRepoPath,
    remoteUrl,
    openCloneDialog,
    pickRepository,
    initializeProject,
    openRemoteDialog,
    loadRepo,
    runFetch,
    openActiveRepoInExplorer,
    menuItem,
    shortcutLabel,
  } = props;

  return (
    <div style={{ position: "relative" }}>
      <div
        className="menuitem"
        onClick={() => {
          closeOtherMenus();
          setRepositoryMenuOpen((v) => !v);
        }}
        style={{ cursor: "pointer", userSelect: "none" }}
      >
        Repository
      </div>
      {repositoryMenuOpen ? (
        <div className="menuDropdown">
          <button
            type="button"
            onClick={() => {
              setRepositoryMenuOpen(false);
              openCloneDialog();
            }}
            disabled={loading || cloneBusy}
          >
            Clone repository…
          </button>
          <button
            type="button"
            onClick={() => {
              setRepositoryMenuOpen(false);
              void pickRepository();
            }}
            disabled={loading || cloneBusy}
          >
            {menuItem("Open repository…", shortcutLabel("repo.open"))}
          </button>
          <button
            type="button"
            onClick={() => {
              setRepositoryMenuOpen(false);
              void initializeProject();
            }}
            disabled={loading || cloneBusy}
          >
            {menuItem("Initialize project…", shortcutLabel("repo.initialize"))}
          </button>
          <button
            type="button"
            onClick={() => {
              setRepositoryMenuOpen(false);
              void openRemoteDialog();
            }}
            disabled={!activeRepoPath || loading}
            title={!activeRepoPath ? "No repository" : undefined}
          >
            Remote…
          </button>
          <button
            type="button"
            onClick={() => {
              setRepositoryMenuOpen(false);
              void loadRepo(activeRepoPath);
            }}
            disabled={!activeRepoPath || loading}
          >
            {menuItem("Refresh", shortcutLabel("repo.refresh"))}
          </button>

          <button
            type="button"
            onClick={() => {
              setRepositoryMenuOpen(false);
              void runFetch();
            }}
            disabled={!activeRepoPath || loading || !remoteUrl}
            title={!remoteUrl ? "No remote origin" : "git fetch origin"}
          >
            {menuItem("Fetch", shortcutLabel("repo.fetch"))}
          </button>
          <button
            type="button"
            onClick={() => {
              setRepositoryMenuOpen(false);
              void openActiveRepoInExplorer();
            }}
            disabled={!activeRepoPath}
          >
            Open in file explorer
          </button>
        </div>
      ) : null}
    </div>
  );
}
