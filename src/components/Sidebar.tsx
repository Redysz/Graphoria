import type { RepoOverview, GitStashEntry } from "../types/git";

export function Sidebar(props: {
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
    expandTags,
    stashes,
    openStashView,
    applyStashByRef,
    confirmDeleteStash,
  } = props;

  return (
    <aside
      className="sidebar"
      style={
        visible
          ? undefined
          : {
              overflow: "hidden",
              borderRight: "none",
              pointerEvents: "none",
            }
      }
    >
      <div className="sidebarSection">
        <div className="sidebarTitle">Branches</div>
        <div className="sidebarList">
          {(overview?.branches ?? []).slice(0, 30).map((b) => (
            <div key={b} className="sidebarItem branchRow" title={b}>
              <button
                type="button"
                className="branchMain"
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openBranchContextMenu(b, e.clientX, e.clientY);
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
                  disabled={!activeRepoPath || loading}
                >
                  C
                </button>
                <button
                  type="button"
                  className="branchActionBtn"
                  onClick={() => void openRenameBranchDialog(b)}
                  title="Rename branch"
                  disabled={!activeRepoPath || loading}
                >
                  R
                </button>
                <button
                  type="button"
                  className="branchActionBtn"
                  onClick={() => void deleteBranch(b)}
                  title="Delete branch"
                  disabled={!activeRepoPath || loading}
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
          {(overview?.remotes ?? []).slice(0, 30).map((r) => (
            <div key={r} className="sidebarItem">
              {r}
            </div>
          ))}
        </div>
      </div>

      <div className="sidebarSection">
        <div className="sidebarTitle">Tags</div>
        <div className="sidebarList">
          {(tagsExpanded ? overview?.tags ?? [] : (overview?.tags ?? []).slice(0, 10)).map((t) => (
            <div
              key={t}
              className="sidebarItem"
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openTagContextMenu(t, e.clientX, e.clientY);
              }}
            >
              {t}
            </div>
          ))}
          {!tagsExpanded && (overview?.tags ?? []).length > 10 ? (
            <button
              type="button"
              onClick={() => {
                if (!activeRepoPath) return;
                expandTags();
              }}
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
