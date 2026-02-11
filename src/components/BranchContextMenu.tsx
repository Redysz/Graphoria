import type { RefObject } from "react";
import { useContextMenuFit } from "../hooks/useContextMenuFit";

export type BranchContextMenuState = {
  x: number;
  y: number;
  branch: string;
};

export function BranchContextMenu(props: {
  menu: BranchContextMenuState | null;
  menuRef: RefObject<HTMLDivElement | null>;

  activeRepoPath: string;
  loading: boolean;
  currentBranchName: string;

  onClose: () => void;
  resolveRef: (reference: string) => Promise<string>;
  setError: (msg: string) => void;
  openCreateBranchDialog: (at: string) => void;
  mergeIntoCurrentBranch: (branch: string) => void | Promise<void>;
  onRebaseHere: (branch: string) => void;
}) {
  const {
    menu,
    menuRef,
    activeRepoPath,
    loading,
    currentBranchName,
    onClose,
    resolveRef,
    setError,
    openCreateBranchDialog,
    mergeIntoCurrentBranch,
    onRebaseHere,
  } = props;

  useContextMenuFit(menuRef, menu);

  if (!menu) return null;

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
      <button
        type="button"
        disabled={!activeRepoPath || loading || menu.branch.trim() === currentBranchName.trim()}
        onClick={() => {
          if (!activeRepoPath) return;
          const branch = menu.branch;
          onClose();
          void mergeIntoCurrentBranch(branch);
        }}
      >
        Merge into current branch
      </button>

      <button
        type="button"
        disabled={!activeRepoPath || loading}
        onClick={() => {
          if (!activeRepoPath) return;
          const branch = menu.branch;
          onClose();
          void (async () => {
            try {
              const hash = await resolveRef(branch);
              const at = (hash ?? "").trim();
              if (!at) {
                setError(`Could not resolve branch '${branch}' to a commit.`);
                return;
              }
              openCreateBranchDialog(at);
            } catch (e) {
              setError(typeof e === "string" ? e : JSON.stringify(e));
            }
          })();
        }}
      >
        Create branch…
      </button>

      <button
        type="button"
        disabled={!activeRepoPath || loading || !currentBranchName.trim() || menu.branch.trim() === currentBranchName.trim()}
        title={!currentBranchName.trim() ? "Cannot rebase from detached HEAD" : `Rebase current branch onto '${menu.branch}'`}
        onClick={() => {
          if (!activeRepoPath) return;
          const branch = menu.branch;
          onClose();
          onRebaseHere(branch);
        }}
      >
        Rebase current branch here
      </button>
    </div>
  );
}
