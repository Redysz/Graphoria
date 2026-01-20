type ResetMode = "soft" | "mixed" | "hard";

type Props = {
  resetTarget: string;
  setResetTarget: (v: string) => void;
  resetMode: ResetMode;
  setResetMode: (v: ResetMode) => void;
  resetBusy: boolean;
  resetError: string;
  activeRepoPath: string;
  onClose: () => void;
  onReset: (mode: ResetMode, target: string) => void;
};

export function ResetModal({
  resetTarget,
  setResetTarget,
  resetMode,
  setResetMode,
  resetBusy,
  resetError,
  activeRepoPath,
  onClose,
  onReset,
}: Props) {
  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ width: "min(760px, 96vw)", maxHeight: "min(70vh, 620px)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>git reset</div>
          <button type="button" onClick={onClose} disabled={resetBusy}>
            Close
          </button>
        </div>
        <div className="modalBody">
          {resetError ? <div className="error">{resetError}</div> : null}

          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800, opacity: 0.8 }}>Target</div>
              <input
                value={resetTarget}
                onChange={(e) => setResetTarget(e.target.value)}
                className="modalInput"
                placeholder="HEAD~1 or a commit hash"
                disabled={resetBusy}
              />
              <div style={{ opacity: 0.7, fontSize: 12 }}>
                Examples: <span className="mono">HEAD~1</span>, <span className="mono">HEAD~5</span>, <span className="mono">a1b2c3d4</span>
              </div>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ fontWeight: 800, opacity: 0.8 }}>Mode</div>
              <div style={{ display: "grid", gap: 8 }}>
                <label style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <input
                    type="radio"
                    name="resetMode"
                    checked={resetMode === "soft"}
                    onChange={() => setResetMode("soft")}
                    disabled={resetBusy}
                  />
                  <div>
                    <div style={{ fontWeight: 800 }}>soft</div>
                    <div style={{ opacity: 0.75, fontSize: 12 }}>Undo commits; keep changes staged (selected in Commit).</div>
                  </div>
                </label>
                <label style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <input
                    type="radio"
                    name="resetMode"
                    checked={resetMode === "mixed"}
                    onChange={() => setResetMode("mixed")}
                    disabled={resetBusy}
                  />
                  <div>
                    <div style={{ fontWeight: 800 }}>mixed</div>
                    <div style={{ opacity: 0.75, fontSize: 12 }}>Undo commits; keep changes unstaged (not selected in Commit).</div>
                  </div>
                </label>
                <label style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <input
                    type="radio"
                    name="resetMode"
                    checked={resetMode === "hard"}
                    onChange={() => setResetMode("hard")}
                    disabled={resetBusy}
                  />
                  <div>
                    <div style={{ fontWeight: 800 }}>hard</div>
                    <div style={{ opacity: 0.75, fontSize: 12 }}>
                      Discard commits after target and any uncommitted changes. Recovery is hard (reflog).
                    </div>
                  </div>
                </label>
              </div>
            </div>
          </div>
        </div>
        <div className="modalFooter" style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <button type="button" onClick={onClose} disabled={resetBusy}>
            Cancel
          </button>
          <button type="button" onClick={() => onReset(resetMode, resetTarget)} disabled={resetBusy || !activeRepoPath || !resetTarget.trim()}>
            {resetBusy ? "Resetting…" : "Reset"}
          </button>
        </div>
      </div>
    </div>
  );
}
