import type { RefObject } from "react";
import { useContextMenuFit } from "../hooks/useContextMenuFit";

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
  renameTag: (tag: string) => void;

  pushTagToOrigin: (tag: string) => void;

  deleteLocalTag: (tag: string) => void;
  deleteRemoteTag: (tag: string) => void;
}) {
  const { menu, menuRef, onClose, focusTagOnGraph, focusTagOnCommits, renameTag, pushTagToOrigin, deleteLocalTag, deleteRemoteTag } = props;

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
      <button
        type="button"
        onClick={() => {
          const tag = menu.tag;
          onClose();
          renameTag(tag);
        }}
      >
        Rename tag
      </button>

      <button
        type="button"
        onClick={() => {
          const tag = menu.tag;
          onClose();
          pushTagToOrigin(tag);
        }}
      >
        Push this tag
      </button>
      <button
        type="button"
        onClick={() => {
          const tag = menu.tag;
          onClose();
          deleteLocalTag(tag);
        }}
      >
        Delete local tag
      </button>
      <button
        type="button"
        onClick={() => {
          const tag = menu.tag;
          onClose();
          deleteRemoteTag(tag);
        }}
      >
        Delete tag on remote
      </button>
    </div>
  );
}
