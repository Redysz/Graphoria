import { memo, useCallback, useMemo, type MouseEvent } from "react";
import type { RepoOverview, GitStashEntry } from "../types/git";

function SidebarImpl(props: {
  visible: boolean;

  overview: RepoOverview | undefined;
  tagsExpanded: boolean;
  activeRepoPath: string;
  loading: boolean;

  isActiveBranch: (branchName: string) => boolean;
  openBranchContextMenu: (branchName: string, x: number, y: number) => void;
  checkoutBranch: (branchName: string) => void | Promise<void>;
  openRenameBranchDialog: (branchName: string) => void | Promise<void>;
  deleteBranch: (branchName: string) => void | Promise<void>;

  openTagContextMenu: (tagName: string, x: number, y: number) => void;
  focusTagOnGraph: (tagName: string) => void | Promise<void>;
  openRenameTagDialog: (tagName: string) => void | Promise<void>;
  deleteLocalTag: (tagName: string) => void | Promise<void>;
  expandTags: () => void;

  stashes: GitStashEntry[];
  openStashView: (stash: GitStashEntry) => void | Promise<void>;
  applyStashByRef: (ref: string) => void | Promise<void>;
  confirmDeleteStash: (stash: GitStashEntry) => void | Promise<void>;
}) {
  const {
    visible,
    overview,
    tagsExpanded,
    activeRepoPath,
    loading,
    isActiveBranch,
    openBranchContextMenu,
    checkoutBranch,
    openRenameBranchDialog,
    deleteBranch,
    openTagContextMenu,
    focusTagOnGraph,
    openRenameTagDialog,
    deleteLocalTag,
    expandTags,
    stashes,
    openStashView,
    applyStashByRef,
    confirmDeleteStash,
  } = props;

  const branches = useMemo(() => (overview?.branches ?? []).slice(0, 30), [overview?.branches]);
  const remotes = useMemo(() => (overview?.remotes ?? []).slice(0, 30), [overview?.remotes]);
  const allTags = useMemo(() => overview?.tags ?? [], [overview?.tags]);
  const tags = useMemo(() => (tagsExpanded ? allTags : allTags.slice(0, 10)), [allTags, tagsExpanded]);

  const hiddenStyle = useMemo(
    () => ({ overflow: "hidden" as const, borderRight: "none", pointerEvents: "none" as const }),
    [],
  );

  const onBranchContextMenu = useCallback(
    (branchName: string, e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      openBranchContextMenu(branchName, e.clientX, e.clientY);
    },
    [openBranchContextMenu],
  );

  const onTagContextMenu = useCallback(
    (tagName: string, e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      openTagContextMenu(tagName, e.clientX, e.clientY);
    },
    [openTagContextMenu],
  );

  const onExpandTags = useCallback(() => {
    if (!activeRepoPath) return;
    expandTags();
  }, [activeRepoPath, expandTags]);

  const actionsDisabled = !activeRepoPath || loading;

  return (
    <aside className="sidebar" style={visible ? undefined : hiddenStyle}>
      <div className="sidebarSection">
        <div className="sidebarTitle">Branches</div>
        <div className="sidebarList">
          {branches.map((b) => (
            <div key={b} className="sidebarItem branchRow" title={b}>
              <button
                type="button"
                className="branchMain"
                onContextMenu={(e) => {
                  onBranchContextMenu(b, e);
                }}
              >
                <span className="branchLabel" style={isActiveBranch(b) ? { fontWeight: 900 } : undefined}>
                  {b}
                </span>
              </button>

              <span className="branchActions">
                <button
                  type="button"
                  className="branchActionBtn"
                  onClick={() => void checkoutBranch(b)}
                  title="Checkout (Switch) to this branch"
                  disabled={actionsDisabled}
                >
                  C
                </button>
                <button
                  type="button"
                  className="branchActionBtn"
                  onClick={() => void openRenameBranchDialog(b)}
                  title="Rename branch"
                  disabled={actionsDisabled}
                >
                  R
                </button>
                <button
                  type="button"
                  className="branchActionBtn"
                  onClick={() => void deleteBranch(b)}
                  title="Delete branch"
                  disabled={actionsDisabled}
                >
                  D
                </button>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="sidebarSection">
        <div className="sidebarTitle">Remotes</div>
        <div className="sidebarList">
          {remotes.map((r) => (
            <div key={r} className="sidebarItem">
              {r}
            </div>
          ))}
        </div>
      </div>

      <div className="sidebarSection">
        <div className="sidebarTitle">Tags</div>
        <div className="sidebarList">
          {tags.map((t) => (
            <div key={t} className="sidebarItem tagRow" title={t}>
              <button
                type="button"
                className="tagMain"
                onClick={() => void focusTagOnGraph(t)}
                onContextMenu={(e) => {
                  onTagContextMenu(t, e);
                }}
                disabled={actionsDisabled}
              >
                <span className="tagLabel">{t}</span>
              </button>

              <span className="tagActions">
                <button
                  type="button"
                  className="tagActionBtn"
                  onClick={() => void focusTagOnGraph(t)}
                  title="Focus on graph"
                  disabled={actionsDisabled}
                >
                  F
                </button>
                <button
                  type="button"
                  className="tagActionBtn"
                  onClick={() => void openRenameTagDialog(t)}
                  title="Rename tag"
                  disabled={actionsDisabled}
                >
                  R
                </button>
                <button
                  type="button"
                  className="tagActionBtn"
                  onClick={() => void deleteLocalTag(t)}
                  title="Delete local tag"
                  disabled={actionsDisabled}
                >
                  D
                </button>
              </span>
            </div>
          ))}
          {!tagsExpanded && allTags.length > 10 ? (
            <button
              type="button"
              onClick={onExpandTags}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "6px 8px",
                border: "1px solid transparent",
                background: "transparent",
                color: "inherit",
              }}
              className="sidebarItem"
            >
              Show all tags
            </button>
          ) : null}
        </div>
      </div>

      <div className="sidebarSection">
        <div className="sidebarTitle">Other</div>
        <div className="sidebarList">
          <div className="sidebarItem">Submodules</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
            <div className="sidebarTitle" style={{ marginBottom: 0 }}>
              Stashes
            </div>
            {stashes.length === 0 ? (
              <div style={{ opacity: 0.7, fontSize: 12, padding: "0 8px" }}>No stashes.</div>
            ) : (
              <div className="sidebarList" style={{ gap: 4 }}>
                {stashes.map((s) => (
                  <div key={s.reference} className="sidebarItem stashRow" title={s.message || s.reference}>
                    <button type="button" className="stashMain" onClick={() => void openStashView(s)}>
                      <span className="stashLabel">{s.message || s.reference}</span>
                    </button>

                    <span className="stashActions">
                      <button type="button" className="stashActionBtn" onClick={() => void openStashView(s)} title="View">
                        👁
                      </button>
                      <button
                        type="button"
                        className="stashActionBtn"
                        onClick={() => void applyStashByRef(s.reference)}
                        title="Apply"
                      >
                        Apply
                      </button>
                      <button type="button" className="stashActionBtn" onClick={() => void confirmDeleteStash(s)} title="Delete">
                        ×
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

export const Sidebar = memo(SidebarImpl);
