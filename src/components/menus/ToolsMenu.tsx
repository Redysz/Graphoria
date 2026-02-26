import type { ReactNode } from "react";
import type { ShortcutActionId } from "../../shortcuts";

export function ToolsMenu(props: {
  toolsMenuOpen: boolean;
  anyTopMenuOpen: boolean;
  setToolsMenuOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
  closeOtherMenus: () => void;

  activeRepoPath: string;
  loading: boolean;
  stashesCount: number;

  setTerminalMenuOpen: (next: boolean) => void;
  setDiffToolModalOpen: (next: boolean) => void;
  setGitignoreModifierOpen: (next: boolean) => void;
  openCommitSearch: () => void;
  openCleanOldBranchesDialog: () => void | Promise<void>;

  confirmClearAllStashes: () => void | Promise<void>;

  menuItem: (left: ReactNode, shortcutText?: string) => ReactNode;
  shortcutLabel: (id: ShortcutActionId) => string;
}) {
  const {
    toolsMenuOpen,
    anyTopMenuOpen,
    setToolsMenuOpen,
    closeOtherMenus,
    activeRepoPath,
    loading,
    stashesCount,
    setTerminalMenuOpen,
    setDiffToolModalOpen,
    setGitignoreModifierOpen,
    openCommitSearch,
    openCleanOldBranchesDialog,
    confirmClearAllStashes,
    menuItem,
    shortcutLabel,
  } = props;

  return (
    <div style={{ position: "relative" }}>
      <div
        className="menuitem"
        onClick={() => {
          closeOtherMenus();
          setToolsMenuOpen((v) => !v);
        }}
        onMouseEnter={() => {
          if (!anyTopMenuOpen || toolsMenuOpen) return;
          closeOtherMenus();
          setToolsMenuOpen(true);
        }}
        style={{ cursor: "pointer", userSelect: "none" }}
      >
        Tools
      </div>
      {toolsMenuOpen ? (
        <div className="menuDropdown">
          <button
            type="button"
            onClick={() => {
              setToolsMenuOpen(false);
              setTerminalMenuOpen(true);
            }}
            disabled={!activeRepoPath}
            title={!activeRepoPath ? "No repository" : "Open terminal profiles"}
          >
            {menuItem("Terminal…", shortcutLabel("cmd.terminalMenu"))}
          </button>
          <button
            type="button"
            onClick={() => {
              setToolsMenuOpen(false);
              setDiffToolModalOpen(true);
            }}
          >
            {menuItem("Diff tool…", shortcutLabel("tool.diffTool"))}
          </button>
          <button
            type="button"
            onClick={() => {
              setToolsMenuOpen(false);
              setGitignoreModifierOpen(true);
            }}
            disabled={!activeRepoPath}
            title={!activeRepoPath ? "No repository" : "Edit .gitignore"}
          >
            Gitignore modifier…
          </button>
          <button
            type="button"
            onClick={() => {
              setToolsMenuOpen(false);
              openCommitSearch();
            }}
            disabled={!activeRepoPath}
            title={!activeRepoPath ? "No repository" : "Search commits"}
          >
            {menuItem("Commit search…", shortcutLabel("tool.commitSearch"))}
          </button>
          <button
            type="button"
            onClick={() => {
              setToolsMenuOpen(false);
              void openCleanOldBranchesDialog();
            }}
            disabled={!activeRepoPath || loading}
            title={!activeRepoPath ? "No repository" : undefined}
          >
            Clean old branches…
          </button>
          <button
            type="button"
            onClick={() => {
              setToolsMenuOpen(false);
              void confirmClearAllStashes();
            }}
            disabled={!activeRepoPath || loading || stashesCount === 0}
            title={!activeRepoPath ? "No repository" : stashesCount === 0 ? "No stashes" : undefined}
          >
            Clear all stashes
          </button>
        </div>
      ) : null}
    </div>
  );
}
