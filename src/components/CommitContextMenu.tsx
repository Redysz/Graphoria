import type { RefObject } from "react";

export type CommitContextMenuState = {
  x: number;
  y: number;
  hash: string;
};

export function CommitContextMenu(props: {
  menu: CommitContextMenuState | null;
  menuRef: RefObject<HTMLDivElement | null>;

  headHash: string;

  activeRepoPath: string;
  loading: boolean;

  isDetached: boolean;
  commitContextBranchesLoading: boolean;
  commitContextBranches: string[];
  changedCount: number;

  pickPreferredBranch: (branches: string[]) => string | undefined;

  onShowChanges: (hash: string) => void;
  onCopyHash: (hash: string) => void;
  onCheckoutCommit: (hash: string) => void;
  onCreateBranch: (hash: string) => void;
  onCreateTag: (hash: string) => void;
  onCherryPick: (hash: string) => void;
  onExportPatch: (hash: string) => void;
  onApplyPatch: () => void;
  onReset: (mode: "soft" | "mixed" | "hard", hash: string) => void;

  onCheckoutBranch: (branch: string) => void;
  onResetHardAndCheckoutBranch: (branch: string) => void;
}) {
  const {
    menu,
    menuRef,

    headHash,
    activeRepoPath,
    loading,
    isDetached,
    commitContextBranchesLoading,
    commitContextBranches,
    changedCount,
    pickPreferredBranch,
    onShowChanges,
    onCopyHash,
    onCheckoutCommit,
    onCreateBranch,
    onCreateTag,
    onCherryPick,
    onExportPatch,
    onApplyPatch,
    onReset,
    onCheckoutBranch,
    onResetHardAndCheckoutBranch,
  } = props;

  if (!menu) return null;

  const isHead = Boolean((menu.hash ?? "").trim() && (headHash ?? "").trim() && menu.hash.trim() === headHash.trim());

  return (
    <div
      className="menuDropdown"
      ref={menuRef}
      style={{
        position: "fixed",
        left: menu.x,
        top: menu.y,
        zIndex: 200,
        minWidth: 220,
      }}
    >
      <button type="button" disabled={!activeRepoPath} onClick={() => onShowChanges(menu.hash)}>
        Show changes
      </button>
      <button type="button" onClick={() => onCopyHash(menu.hash)}>
        Copy hash
      </button>
      <button type="button" disabled={!activeRepoPath || loading} onClick={() => onCheckoutCommit(menu.hash)}>
        Checkout this commit
      </button>

      <button type="button" disabled={!activeRepoPath || loading} onClick={() => onCreateBranch(menu.hash)}>
        Create branch…
      </button>

      <button type="button" disabled={!activeRepoPath || loading} onClick={() => onCreateTag(menu.hash)}>
        Create tag…
      </button>

      <button type="button" disabled={!activeRepoPath || loading || isHead} onClick={() => onCherryPick(menu.hash)}>
        Cherry-pick…
      </button>

      <button type="button" disabled={!activeRepoPath || loading} onClick={() => onExportPatch(menu.hash)}>
        Export patch…
      </button>

      <button type="button" disabled={!activeRepoPath || loading} onClick={() => onApplyPatch()}>
        Apply patch…
      </button>

      <button type="button" disabled={!activeRepoPath || loading} onClick={() => onReset("soft", menu.hash)}>
        git reset --soft here
      </button>
      <button type="button" disabled={!activeRepoPath || loading} onClick={() => onReset("mixed", menu.hash)}>
        git reset --mixed here
      </button>
      <button type="button" disabled={!activeRepoPath || loading} onClick={() => onReset("hard", menu.hash)}>
        git reset --hard here
      </button>

      {isDetached && commitContextBranchesLoading ? (
        <button type="button" disabled title="Checking branches that point at this commit…">
          Checking branches…
        </button>
      ) : null}

      {(() => {
        if (!isDetached) return null;
        if (commitContextBranches.length === 0) return null;
        const b = pickPreferredBranch(commitContextBranches);
        if (!b) return null;

        if (changedCount === 0) {
          return (
            <button
              type="button"
              title={`Re-attaches HEAD by checking out '${b}'.`}
              disabled={!activeRepoPath || loading}
              onClick={() => onCheckoutBranch(b)}
            >
              Checkout this commit and branch
            </button>
          );
        }

        return (
          <button
            type="button"
            title={`Discards local changes (git reset --hard) and re-attaches HEAD by checking out '${b}'.`}
            disabled={!activeRepoPath || loading}
            onClick={() => onResetHardAndCheckoutBranch(b)}
          >
            Reset hard my changes and checkout this commit
          </button>
        );
      })()}
    </div>
  );
}
