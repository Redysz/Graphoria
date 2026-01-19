import type { RefObject } from "react";

export type TagContextMenuState = {
  x: number;
  y: number;
  tag: string;
};

export function TagContextMenu(props: {
  menu: TagContextMenuState | null;
  menuRef: RefObject<HTMLDivElement | null>;

  onClose: () => void;
  focusTagOnGraph: (tag: string) => void;
  focusTagOnCommits: (tag: string) => void;
}) {
  const { menu, menuRef, onClose, focusTagOnGraph, focusTagOnCommits } = props;

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
        onClick={() => {
          const tag = menu.tag;
          onClose();
          focusTagOnGraph(tag);
        }}
      >
        Focus on graph
      </button>
      <button
        type="button"
        onClick={() => {
          const tag = menu.tag;
          onClose();
          focusTagOnCommits(tag);
        }}
      >
        Focus on commits
      </button>
    </div>
  );
}
