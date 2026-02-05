import { useState } from "react";
import type { GitCommitSummary } from "../../types/git";
import { truncate } from "../../utils/text";

type Props = {
  targetBranch: string;
  setTargetBranch: (v: string) => void;
  branchOptions: string[];

  commitHash: string;
  setCommitHash: (v: string) => void;

  appendOrigin: boolean;
  setAppendOrigin: (v: boolean) => void;

  noCommit: boolean;
  setNoCommit: (v: boolean) => void;

  busy: boolean;
  error: string;

  commitLoading: boolean;
  commitError: string;
  commitSummary: GitCommitSummary | null;

  activeRepoPath: string;

  onClose: () => void;
  onRun: () => void;
};

export function CherryPickModal({
  targetBranch,
  setTargetBranch,
  branchOptions,
  commitHash,
  setCommitHash,
  appendOrigin,
  setAppendOrigin,
  noCommit,
  setNoCommit,
  busy,
  error,
  commitLoading,
  commitError,
  commitSummary,
  activeRepoPath,
  onClose,
  onRun,
}: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ width: "min(860px, 96vw)", maxHeight: "min(76vh, 720px)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>Cherry-pick</div>
          <button type="button" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>
        <div className="modalBody">
          {error ? <div className="error">{error}</div> : null}

          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800, opacity: 0.8 }}>Target branch</div>
              <input
                value={targetBranch}
                onChange={(e) => setTargetBranch(e.target.value)}
                className="modalInput mono"
                disabled={busy}
                list="cherryPickBranches"
                placeholder="main"
              />
              <datalist id="cherryPickBranches">
                {branchOptions.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800, opacity: 0.8 }}>Commit</div>
              <input
                value={commitHash}
                onChange={(e) => setCommitHash(e.target.value)}
                className="modalInput mono"
                disabled={busy}
                placeholder="a1b2c3d4"
              />
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

            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              disabled={busy}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                alignSelf: "flex-start",
              }}
              title="Show more cherry-pick options"
            >
              {advancedOpen ? "Advanced ▲" : "Advanced ▼"}
            </button>

            {advancedOpen ? (
              <div style={{ display: "grid", gap: 10 }}>
                <label
                  style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 800, opacity: 0.9 }}
                  title="Append a line that indicates the original commit (git cherry-pick -x)."
                >
                  <input type="checkbox" checked={appendOrigin} onChange={(e) => setAppendOrigin(e.target.checked)} disabled={busy} />
                  Append origin (-x)
                </label>

                <label
                  style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 800, opacity: 0.9 }}
                  title="Apply changes but do not create a commit (git cherry-pick --no-commit)."
                >
                  <input type="checkbox" checked={noCommit} onChange={(e) => setNoCommit(e.target.checked)} disabled={busy} />
                  Do not commit (--no-commit)
                </label>
              </div>
            ) : null}
          </div>
        </div>
        <div className="modalFooter" style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onRun}
            disabled={busy || !activeRepoPath || !targetBranch.trim() || !commitHash.trim()}
          >
            {busy ? "Cherry-picking…" : "Cherry-pick"}
          </button>
        </div>
      </div>
    </div>
  );
}
