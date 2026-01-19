import type { RefObject } from "react";
import type { GitStashEntry } from "../types/git";

export type StashContextMenuState = {
  x: number;
  y: number;
  stashRef: string;
  stashMessage: string;
};

export function StashContextMenu(props: {
  menu: StashContextMenuState | null;
  menuRef: RefObject<HTMLDivElement | null>;

  activeRepoPath: string;
  loading: boolean;

  getStashesForActiveRepo: () => GitStashEntry[];
  openStashView: (entry: GitStashEntry) => void;
  applyStashByRef: (ref: string) => void;

  confirmDelete: (ref: string, name: string) => void;

  onClose: () => void;
  setError: (msg: string) => void;
}) {
  const {
    menu,
    menuRef,
    activeRepoPath,
    loading,
    getStashesForActiveRepo,
    openStashView,
    applyStashByRef,
    confirmDelete,
    onClose,
    setError,
  } = props;

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
        disabled={!activeRepoPath}
        onClick={() => {
          if (!activeRepoPath) return;
          const ref = menu.stashRef;
          onClose();
          const list = getStashesForActiveRepo();
          const entry = list.find((s) => s.reference === ref);
          if (!entry) {
            setError(`Stash not found: ${ref}`);
            return;
          }
          openStashView(entry);
        }}
      >
        View stash
      </button>
      <button
        type="button"
        disabled={!activeRepoPath || loading}
        onClick={() => {
          const ref = menu.stashRef;
          onClose();
          applyStashByRef(ref);
        }}
      >
        Apply stash
      </button>
      <button
        type="button"
        disabled={!activeRepoPath || loading}
        onClick={() => {
          if (!activeRepoPath) return;
          const ref = menu.stashRef;
          const name = menu.stashMessage?.trim() ? menu.stashMessage.trim() : ref;
          onClose();
          confirmDelete(ref, name);
        }}
      >
        Delete stash
      </button>
    </div>
  );
}
