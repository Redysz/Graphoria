import type { RefObject } from "react";

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

  onClose: () => void;
  checkoutLocalBranch: (branch: string) => void;
  checkoutRemoteBranch: (remoteBranch: string) => void;
}) {
  const { menu, menuRef, activeRepoPath, loading, onClose, checkoutLocalBranch, checkoutRemoteBranch } = props;

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
    </div>
  );
}
