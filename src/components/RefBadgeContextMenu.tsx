import type { RefObject } from "react";
import { useContextMenuFit } from "../hooks/useContextMenuFit";

export type RefBadgeContextMenuState = {
  x: number;
  y: number;
  kind: "branch" | "remote";
  label: string;
};

export function RefBadgeContextMenu(props: {
  menu: RefBadgeContextMenuState | null;
  menuRef: RefObject<HTMLDivElement | null>;

  activeRepoPath: string;
  loading: boolean;
  currentBranchName: string;

  onClose: () => void;
  checkoutLocalBranch: (branch: string) => void;
  checkoutRemoteBranch: (remoteBranch: string) => void;
  mergeIntoCurrentBranch: (ref: string) => void | Promise<void>;
  onRebaseHere: (ref: string) => void;
}) {
  const {
    menu,
    menuRef,
    activeRepoPath,
    loading,
    currentBranchName,
    onClose,
    checkoutLocalBranch,
    checkoutRemoteBranch,
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
        disabled={!activeRepoPath || loading || menu.label.trim() === currentBranchName.trim()}
        onClick={() => {
          if (!activeRepoPath) return;
          const ref = menu.label;
          onClose();
          void mergeIntoCurrentBranch(ref);
        }}
      >
        Merge into current branch
      </button>

      {menu.kind === "branch" ? (
        <button
          type="button"
          disabled={!activeRepoPath || loading}
          onClick={() => {
            const b = menu.label;
            onClose();
            checkoutLocalBranch(b);
          }}
        >
          Checkout branch
        </button>
      ) : (
        <button
          type="button"
          disabled={!activeRepoPath || loading}
          onClick={() => {
            const r = menu.label;
            onClose();
            checkoutRemoteBranch(r);
          }}
        >
          Checkout remote branch
        </button>
      )}

      <button
        type="button"
        disabled={!activeRepoPath || loading || !currentBranchName.trim() || menu.label.trim() === currentBranchName.trim()}
        title={!currentBranchName.trim() ? "Cannot rebase from detached HEAD" : `Rebase current branch onto '${menu.label}'`}
        onClick={() => {
          if (!activeRepoPath) return;
          const ref = menu.label;
          onClose();
          onRebaseHere(ref);
        }}
      >
        Rebase current branch here
      </button>
    </div>
  );
}
