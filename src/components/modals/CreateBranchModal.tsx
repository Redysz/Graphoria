import type { GitCommitSummary } from "../../types/git";
import { truncate } from "../../utils/text";

type Props = {
  name: string;
  setName: (v: string) => void;

  at: string;
  setAt: (v: string) => void;

  checkout: boolean;
  setCheckout: (v: boolean) => void;

  orphan: boolean;
  setOrphan: (v: boolean) => void;

  clearWorkingTree: boolean;
  setClearWorkingTree: (v: boolean) => void;

  busy: boolean;
  error: string;

  commitLoading: boolean;
  commitError: string;
  commitSummary: GitCommitSummary | null;

  activeRepoPath: string;

  onClose: () => void;
  onCreate: () => void;
};

export function CreateBranchModal({
  name,
  setName,
  at,
  setAt,
  checkout,
  setCheckout,
  orphan,
  setOrphan,
  clearWorkingTree,
  setClearWorkingTree,
  busy,
  error,
  commitLoading,
  commitError,
  commitSummary,
  activeRepoPath,
  onClose,
  onCreate,
}: Props) {
  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ width: "min(760px, 96vw)", maxHeight: "min(70vh, 640px)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>Create branch</div>
          <button type="button" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>
        <div className="modalBody">
          {error ? <div className="error">{error}</div> : null}

          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800, opacity: 0.8 }}>Branch name</div>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="modalInput"
                placeholder="feature/my-branch"
                disabled={busy}
              />
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800, opacity: 0.8 }}>Create at commit</div>
              <input
                value={at}
                onChange={(e) => setAt(e.target.value)}
                className="modalInput mono"
                placeholder="HEAD or a commit hash"
                disabled={busy}
              />
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800, opacity: 0.8 }}>Commit</div>
              {commitLoading ? <div style={{ opacity: 0.7 }}>Loading…</div> : null}
              {commitError ? <div className="error">{commitError}</div> : null}
              {!commitLoading && !commitError && commitSummary ? (
                <div
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    padding: 10,
                    display: "grid",
                    gap: 4,
                    background: "rgba(0, 0, 0, 0.02)",
                  }}
                >
                  <div style={{ fontWeight: 800 }}>{truncate(commitSummary.subject, 120)}</div>
                  <div style={{ opacity: 0.75, fontSize: 12 }}>
                    {commitSummary.author} — {commitSummary.date}
                  </div>
                  <div className="mono" style={{ opacity: 0.85, fontSize: 12 }}>
                    {commitSummary.hash}
                    {commitSummary.refs ? ` — ${commitSummary.refs}` : ""}
                  </div>
                </div>
              ) : null}
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.9 }}>
                <input
                  type="checkbox"
                  checked={checkout}
                  onChange={(e) => setCheckout(e.target.checked)}
                  disabled={busy || orphan}
                />
                Checkout after create
              </label>

              <div style={{ display: "grid", gap: 6 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.9 }}>
                  <input
                    type="checkbox"
                    checked={orphan}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setOrphan(next);
                      if (next) {
                        setCheckout(true);
                        setClearWorkingTree(true);
                      } else {
                        setClearWorkingTree(false);
                      }
                    }}
                    disabled={busy}
                  />
                  Orphan
                </label>
                <div style={{ opacity: 0.75, fontSize: 12 }}>
                  Creates a new, disconnected history (separate tree) using <span className="mono">git switch --orphan</span>.
                </div>

                <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.9 }}>
                  <input
                    type="checkbox"
                    checked={clearWorkingTree}
                    onChange={(e) => setClearWorkingTree(e.target.checked)}
                    disabled={busy || !orphan}
                  />
                  Clear working directory and index
                </label>
                <div style={{ opacity: 0.75, fontSize: 12 }}>
                  Removes tracked files and cleans untracked files after creating the orphan branch.
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="modalFooter" style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" onClick={onCreate} disabled={busy || !activeRepoPath || !name.trim() || !at.trim()}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
