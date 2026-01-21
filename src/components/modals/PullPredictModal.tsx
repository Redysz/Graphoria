import type { PullPredictResult } from "../../types/git";

type Props = {
  busy: boolean;
  error: string;
  result: PullPredictResult | null;
  activeRepoPath: string;
  remoteUrl: string | null | undefined;
  loading: boolean;
  pullBusy: boolean;
  onClose: () => void;
  onApply: () => void;
  onOpenConflictPreview: (path: string) => void;
};

export function PullPredictModal({
  busy,
  error,
  result,
  activeRepoPath,
  remoteUrl,
  loading,
  pullBusy,
  onClose,
  onApply,
  onOpenConflictPreview,
}: Props) {
  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ width: "min(760px, 96vw)", maxHeight: "min(70vh, 640px)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>Pull predict</div>
          <button type="button" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>
        <div className="modalBody">
          {error ? <div className="error">{error}</div> : null}
          {busy ? <div style={{ opacity: 0.7 }}>Predicting…</div> : null}

          {result ? (
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontWeight: 800, opacity: 0.8 }}>Upstream</div>
                <div className="mono" style={{ opacity: 0.9 }}>
                  {result.upstream ?? "(none)"}
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <span style={{ fontWeight: 800 }}>Ahead:</span> {result.ahead}
                </div>
                <div>
                  <span style={{ fontWeight: 800 }}>Behind:</span> {result.behind}
                </div>
                <div>
                  <span style={{ fontWeight: 800 }}>Action:</span> {result.action}
                </div>
              </div>
              <div>
                <div style={{ fontWeight: 800, opacity: 0.8, marginBottom: 6 }}>Potential conflicts</div>
                {result.conflict_files?.length ? (
                  <div className="statusList">
                    {result.conflict_files.map((p) => (
                      <div key={p} className="statusRow statusRowSingleCol" onClick={() => onOpenConflictPreview(p)} title={p}>
                        <span className="statusPath">{p}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ opacity: 0.75 }}>No conflicts predicted.</div>
                )}
              </div>
            </div>
          ) : null}
        </div>
        <div className="modalFooter">
          <button
            type="button"
            onClick={onApply}
            disabled={busy || !result || !activeRepoPath || !remoteUrl || loading || pullBusy}
          >
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
