import type { ReactNode } from "react";
import type { ShortcutActionId } from "../../shortcuts";

export function CommandsMenu(props: {
  commandsMenuOpen: boolean;
  setCommandsMenuOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
  closeOtherMenus: () => void;

  activeRepoPath: string;
  loading: boolean;
  remoteUrl: string | null | undefined;

  changedCount: number;
  aheadCount: number;
  stashesCount: number;

  selectedHash: string;
  headHash: string;

  openCommitDialog: () => void | Promise<void>;
  openPushDialog: () => void | Promise<void>;
  openStashDialog: () => void | Promise<void>;
  openCreateBranchDialog: (at: string) => void;
  openSwitchBranchDialog: () => void | Promise<void>;
  openResetDialog: () => void;

  menuItem: (left: ReactNode, shortcutText?: string) => ReactNode;
  shortcutLabel: (id: ShortcutActionId) => string;
}) {
  const {
    commandsMenuOpen,
    setCommandsMenuOpen,
    closeOtherMenus,
    activeRepoPath,
    loading,
    remoteUrl,
    changedCount,
    aheadCount,
    stashesCount,
    selectedHash,
    headHash,
    openCommitDialog,
    openPushDialog,
    openStashDialog,
    openCreateBranchDialog,
    openSwitchBranchDialog,
    openResetDialog,
    menuItem,
    shortcutLabel,
  } = props;

  return (
    <div style={{ position: "relative" }}>
      <div
        className="menuitem"
        onClick={() => {
          closeOtherMenus();
          setCommandsMenuOpen((v) => !v);
        }}
        style={{ cursor: "pointer", userSelect: "none" }}
      >
        Commands
      </div>
      {commandsMenuOpen ? (
        <div className="menuDropdown">
          <button
            type="button"
            onClick={() => {
              setCommandsMenuOpen(false);
              void openCommitDialog();
            }}
            disabled={!activeRepoPath || loading}
          >
            {menuItem(
              <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, width: "100%" }}>
                <span>Commit…</span>
                {changedCount > 0 ? <span className="badge">{changedCount}</span> : null}
              </span>,
              shortcutLabel("cmd.commit"),
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setCommandsMenuOpen(false);
              void openPushDialog();
            }}
            disabled={!activeRepoPath || loading || !remoteUrl}
            title={!remoteUrl ? "No remote origin" : undefined}
          >
            {menuItem(
              <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, width: "100%" }}>
                <span>Push…</span>
                {aheadCount > 0 ? <span className="badge">↑{aheadCount}</span> : null}
              </span>,
              shortcutLabel("cmd.push"),
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setCommandsMenuOpen(false);
              void openStashDialog();
            }}
            disabled={!activeRepoPath || loading}
          >
            {menuItem(
              <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, width: "100%" }}>
                <span>Stash…</span>
                {stashesCount > 0 ? <span className="badge">{stashesCount}</span> : null}
              </span>,
              shortcutLabel("cmd.stash"),
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              const at = selectedHash.trim() ? selectedHash.trim() : headHash.trim();
              setCommandsMenuOpen(false);
              if (!at) return;
              openCreateBranchDialog(at);
            }}
            disabled={!activeRepoPath || loading || (!selectedHash.trim() && !headHash.trim())}
            title={!activeRepoPath ? "No repository" : "Create a new branch"}
          >
            {menuItem("Create branch…", shortcutLabel("cmd.createBranch"))}
          </button>

          <button
            type="button"
            onClick={() => {
              setCommandsMenuOpen(false);
              void openSwitchBranchDialog();
            }}
            disabled={!activeRepoPath || loading}
            title={!activeRepoPath ? "No repository" : "Switch branches (git switch)"}
          >
            {menuItem("Checkout branch…", shortcutLabel("cmd.checkoutBranch"))}
          </button>

          <button
            type="button"
            onClick={() => {
              setCommandsMenuOpen(false);
              openResetDialog();
            }}
            disabled={!activeRepoPath || loading}
            title={!activeRepoPath ? "No repository" : "Reset (soft/hard)"}
          >
            {menuItem("Reset (soft/hard)…", shortcutLabel("cmd.reset"))}
          </button>
        </div>
      ) : null}
    </div>
  );
}
