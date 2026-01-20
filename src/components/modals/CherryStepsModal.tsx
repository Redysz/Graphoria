type Props = {
  targetBranch: string;
  error: string;
  commitHash: string;
  reflog: string;
  busy: boolean;
  activeRepoPath: string;
  onClose: () => void;
  onCopyHash: () => void;
  onApply: () => void;
};

export function CherryStepsModal({
  targetBranch,
  error,
  commitHash,
  reflog,
  busy,
  activeRepoPath,
  onClose,
  onCopyHash,
  onApply,
}: Props) {
  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ width: "min(900px, 96vw)", maxHeight: "min(72vh, 680px)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>Cherry-pick steps</div>
          <button type="button" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>
        <div className="modalBody">
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ opacity: 0.85 }}>
              Apply your detached commit to <span className="mono">{targetBranch || "<target-branch>"}</span>.
            </div>

            {error ? <div className="error">{error}</div> : null}

            <div>
              <div style={{ fontWeight: 900, opacity: 0.8, marginBottom: 6 }}>Commit to cherry-pick</div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <div className="mono" style={{ opacity: 0.9 }}>
                  {commitHash || "(missing)"}
                </div>
                <button type="button" disabled={!commitHash} onClick={onCopyHash}>
                  Copy hash
                </button>
              </div>
            </div>

            <div>
              <div style={{ fontWeight: 900, opacity: 0.8, marginBottom: 6 }}>Reflog (for reference)</div>
              <textarea className="modalTextarea" value={reflog} readOnly rows={10} />
            </div>

            <div className="mono" style={{ opacity: 0.9 }}>
              git reset --hard
              <br />
              git checkout {targetBranch || "<target-branch>"}
              <br />
              git cherry-pick {commitHash || "<hash>"}
            </div>
          </div>
        </div>
        <div className="modalFooter">
          <button type="button" onClick={onApply} disabled={busy || !activeRepoPath || !targetBranch || !commitHash}>
            Apply
          </button>
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
