import type { RefObject } from "react";
import { useContextMenuFit } from "../hooks/useContextMenuFit";

export type WorkingFileContextMenuState = {
  x: number;
  y: number;
  mode: "commit" | "stash";
  path: string;
  status: string;
};

export function WorkingFileContextMenu(props: {
  menu: WorkingFileContextMenuState | null;
  menuRef: RefObject<HTMLDivElement | null>;

  activeRepoPath: string;
  commitBusy: boolean;
  stashBusy: boolean;

  onClose: () => void;
  onDiscard: (mode: "commit" | "stash", path: string, status: string) => void;
  onDelete: (mode: "commit" | "stash", path: string) => void;
  onCopyText: (text: string) => void;
  joinPath: (a: string, b: string) => string;
  onRevealInExplorer: (absPath: string) => void;
  onAddToGitignore: (mode: "commit" | "stash", path: string) => void;
}) {
  const {
    menu,
    menuRef,
    activeRepoPath,
    commitBusy,
    stashBusy,
    onClose,
    onDiscard,
    onDelete,
    onCopyText,
    joinPath,
    onRevealInExplorer,
    onAddToGitignore,
  } = props;

  useContextMenuFit(menuRef, menu);

  if (!menu) return null;

  const busy = menu.mode === "commit" ? commitBusy : stashBusy;

  return (
    <div
      className="menuDropdown"
      ref={menuRef}
      style={{
        position: "fixed",
        left: menu.x,
        top: menu.y,
        zIndex: 200,
        minWidth: 260,
      }}
    >
      <button
        type="button"
        disabled={!activeRepoPath || busy}
        onClick={() => {
          const m = menu;
          onClose();
          onDiscard(m.mode, m.path, m.status);
        }}
      >
        Reset file / Discard changes…
      </button>
      <button
        type="button"
        disabled={!activeRepoPath || busy}
        onClick={() => {
          const m = menu;
          onClose();
          onDelete(m.mode, m.path);
        }}
      >
        Delete file…
      </button>
      <button
        type="button"
        onClick={() => {
          const m = menu;
          onClose();
          onCopyText(m.path);
        }}
      >
        Copy path (relative)
      </button>
      <button
        type="button"
        disabled={!activeRepoPath || busy}
        onClick={() => {
          const m = menu;
          onClose();
          if (!activeRepoPath) return;
          const sep = activeRepoPath.includes("\\") ? "\\" : "/";
          const abs = joinPath(activeRepoPath, m.path.replace(/[\\/]/g, sep));
          onCopyText(abs);
        }}
      >
        Copy path (absolute)
      </button>
      <button
        type="button"
        disabled={!activeRepoPath || busy}
        onClick={() => {
          const m = menu;
          onClose();
          if (!activeRepoPath) return;
          const sep = activeRepoPath.includes("\\") ? "\\" : "/";
          const abs = joinPath(activeRepoPath, m.path.replace(/[\\/]/g, sep));
          onRevealInExplorer(abs);
        }}
      >
        Reveal in File Explorer
      </button>
      <button
        type="button"
        disabled={!activeRepoPath || busy}
        onClick={() => {
          const m = menu;
          onClose();
          onAddToGitignore(m.mode, m.path.replace(/\\/g, "/"));
        }}
      >
        Add to .gitignore
      </button>
    </div>
  );
}
