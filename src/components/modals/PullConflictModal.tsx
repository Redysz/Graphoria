type Props = {
  operation: string;
  message: string;
  files: string[];
  busy: boolean;
  onClose: () => void;
  onContinue: () => void;
  onAbort: () => void;
  onOpenFilePreview: (path: string) => void;
};

export function PullConflictModal({ operation, message, files, busy, onClose, onContinue, onAbort, onOpenFilePreview }: Props) {
  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ width: "min(760px, 96vw)", maxHeight: "min(70vh, 640px)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>Conflicts detected</div>
          <button type="button" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>
        <div className="modalBody">
          <div style={{ opacity: 0.8, marginBottom: 10 }}>
            Operation: <span className="mono">{operation}</span>
          </div>
          {message ? <pre style={{ whiteSpace: "pre-wrap", opacity: 0.8, marginTop: 0 }}>{message}</pre> : null}
          <div>
            <div style={{ fontWeight: 800, opacity: 0.8, marginBottom: 6 }}>Conflict files</div>
            {files.length ? (
              <div className="statusList">
                {files.map((p) => (
                  <div key={p} className="statusRow statusRowSingleCol" onClick={() => onOpenFilePreview(p)} title={p}>
                    <span className="statusPath">{p}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ opacity: 0.75 }}>Could not parse conflict file list.</div>
            )}
          </div>
        </div>
        <div className="modalFooter" style={{ display: "flex", gap: 10, justifyContent: "space-between" }}>
          <button type="button" disabled title="Not implemented yet">
            Fix conflicts…
          </button>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" onClick={onContinue} disabled={busy}>
              Continue
            </button>
            <button type="button" onClick={onAbort} disabled={busy}>
              Abort
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
