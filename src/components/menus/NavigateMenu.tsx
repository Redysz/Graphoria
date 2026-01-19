import type { ReactNode } from "react";
import type { ShortcutActionId } from "../../shortcuts";

export function NavigateMenu(props: {
  navigateMenuOpen: boolean;
  setNavigateMenuOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
  closeOtherMenus: () => void;

  repos: string[];
  activeRepoPath: string;

  selectedHash: string;
  headHash: string;
  commitsCount: number;

  moveActiveRepoBy: (delta: number) => void;
  setViewMode: (next: "graph" | "commits") => void;

  openGoToCommit: () => void;
  openGoToTag: () => void;

  goToChildCommit: () => void;
  goToParentCommit: () => void;
  goToFirstCommitInBranch: () => void;
  goToFirstCommitInRepo: () => void;

  menuItem: (left: ReactNode, shortcutText?: string) => ReactNode;
  shortcutLabel: (id: ShortcutActionId) => string;
}) {
  const {
    navigateMenuOpen,
    setNavigateMenuOpen,
    closeOtherMenus,
    repos,
    activeRepoPath,
    selectedHash,
    headHash,
    commitsCount,
    moveActiveRepoBy,
    setViewMode,
    openGoToCommit,
    openGoToTag,
    goToChildCommit,
    goToParentCommit,
    goToFirstCommitInBranch,
    goToFirstCommitInRepo,
    menuItem,
    shortcutLabel,
  } = props;

  return (
    <div style={{ position: "relative" }}>
      <div
        className="menuitem"
        onClick={() => {
          closeOtherMenus();
          setNavigateMenuOpen((v) => !v);
        }}
        style={{ cursor: "pointer", userSelect: "none" }}
      >
        Navigate
      </div>
      {navigateMenuOpen ? (
        <div className="menuDropdown" style={{ minWidth: 280 }}>
          <button
            type="button"
            onClick={() => {
              setNavigateMenuOpen(false);
              moveActiveRepoBy(1);
            }}
            disabled={repos.length < 2 || !activeRepoPath}
            title={repos.length < 2 ? "Open at least 2 repositories" : undefined}
          >
            {menuItem("Next repository", shortcutLabel("repo.next"))}
          </button>
          <button
            type="button"
            onClick={() => {
              setNavigateMenuOpen(false);
              moveActiveRepoBy(-1);
            }}
            disabled={repos.length < 2 || !activeRepoPath}
            title={repos.length < 2 ? "Open at least 2 repositories" : undefined}
          >
            {menuItem("Previous repository", shortcutLabel("repo.prev"))}
          </button>
          <div style={{ height: 1, background: "var(--border)", margin: "2px 2px" }} />
          <button
            type="button"
            onClick={() => {
              setNavigateMenuOpen(false);
              setViewMode("graph");
            }}
            disabled={!activeRepoPath}
          >
            {menuItem("Go to graph view", shortcutLabel("view.graph"))}
          </button>
          <button
            type="button"
            onClick={() => {
              setNavigateMenuOpen(false);
              setViewMode("commits");
            }}
            disabled={!activeRepoPath}
          >
            {menuItem("Go to commits view", shortcutLabel("view.commits"))}
          </button>
          <div style={{ height: 1, background: "var(--border)", margin: "2px 2px" }} />
          <button
            type="button"
            onClick={() => {
              setNavigateMenuOpen(false);
              openGoToCommit();
            }}
            disabled={!activeRepoPath}
          >
            {menuItem("Go to commit…", shortcutLabel("nav.goToCommit"))}
          </button>
          <button
            type="button"
            onClick={() => {
              setNavigateMenuOpen(false);
              openGoToTag();
            }}
            disabled={!activeRepoPath}
          >
            {menuItem("Go to tag…", shortcutLabel("nav.goToTag"))}
          </button>
          <div style={{ height: 1, background: "var(--border)", margin: "2px 2px" }} />
          <button
            type="button"
            onClick={() => {
              setNavigateMenuOpen(false);
              goToChildCommit();
            }}
            disabled={!activeRepoPath || (!selectedHash.trim() && !headHash.trim())}
            title={!selectedHash.trim() && !headHash.trim() ? "Select a commit" : undefined}
          >
            Go to child commit
          </button>
          <button
            type="button"
            onClick={() => {
              setNavigateMenuOpen(false);
              goToParentCommit();
            }}
            disabled={!activeRepoPath || (!selectedHash.trim() && !headHash.trim())}
            title={!selectedHash.trim() && !headHash.trim() ? "Select a commit" : undefined}
          >
            Go to parent commit
          </button>
          <button
            type="button"
            onClick={() => {
              setNavigateMenuOpen(false);
              goToFirstCommitInBranch();
            }}
            disabled={!activeRepoPath || (!selectedHash.trim() && !headHash.trim())}
            title={!selectedHash.trim() && !headHash.trim() ? "Select a commit" : undefined}
          >
            Go to first commit in branch
          </button>
          <button
            type="button"
            onClick={() => {
              setNavigateMenuOpen(false);
              goToFirstCommitInRepo();
            }}
            disabled={!activeRepoPath || commitsCount === 0}
            title={commitsCount === 0 ? "No commits" : undefined}
          >
            Go to first commit in repo
          </button>
        </div>
      ) : null}
    </div>
  );
}
