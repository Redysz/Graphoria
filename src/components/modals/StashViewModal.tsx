import { parseUnifiedDiff } from "../../DiffView";

type Props = {
  reference: string;
  message: string;
  patch: string;
  loading: boolean;
  error: string;

  onClose: () => void;
  onDelete: () => void;
  onApply: () => void;

  deleteDisabled: boolean;
  applyDisabled: boolean;
};

export function StashViewModal({
  reference,
  message,
  patch,
  loading,
  error,
  onClose,
  onDelete,
  onApply,
  deleteDisabled,
  applyDisabled,
}: Props) {
  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ width: "min(1100px, 96vw)", maxHeight: "min(84vh, 900px)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>Stash</div>
          <button type="button" onClick={onClose} disabled={loading}>
            Close
          </button>
        </div>
        <div className="modalBody">
          {error ? <div className="error">{error}</div> : null}
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ opacity: 0.8, fontSize: 12 }}>
              <span className="mono">{reference}</span>
              {message ? <span style={{ marginLeft: 10 }}>{message}</span> : null}
            </div>
            {loading ? <div style={{ opacity: 0.7 }}>Loading…</div> : null}
            {!loading ? (
              patch ? (
                <pre className="diffCode" style={{ maxHeight: 520, border: "1px solid var(--border)", borderRadius: 12 }}>
                  {parseUnifiedDiff(patch).map((l, i) => (
                    <div key={i} className={`diffLine diffLine-${l.kind}`}>
                      {l.text}
                    </div>
                  ))}
                </pre>
              ) : (
                <div style={{ opacity: 0.75 }}>No patch output.</div>
              )
            ) : null}
          </div>
        </div>
        <div className="modalFooter" style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <button type="button" onClick={onDelete} disabled={deleteDisabled}>
            Delete
          </button>
          <button type="button" onClick={onApply} disabled={applyDisabled}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
