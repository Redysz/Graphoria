type Props = {
  title?: string;
  summary: string;
  details: string;
  canIgnore?: boolean;
  busy?: boolean;
  onClose: () => void;
  onIgnore?: () => void;
};

export function ErrorDetailsModal({
  title = "Error details",
  summary,
  details,
  canIgnore,
  busy,
  onClose,
  onIgnore,
}: Props) {
  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ width: "min(840px, 96vw)", maxHeight: "min(86vh, 900px)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>{title}</div>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", padding: "2px 6px", lineHeight: 1 }}
          >
            ✕
          </button>
        </div>

        <div className="modalBody" style={{ display: "grid", gap: 10 }}>
          {summary ? (
            <div>
              <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.75, marginBottom: 6 }}>Summary</div>
              <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{summary}</div>
            </div>
          ) : null}

          <div>
            <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.75, marginBottom: 6 }}>Details</div>
            <pre
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: 10,
                background: "var(--panel-2)",
                maxHeight: "46vh",
                overflow: "auto",
              }}
            >
              {details}
            </pre>
          </div>
        </div>

        <div className="modalFooter" style={{ justifyContent: "space-between" }}>
          <div>
            {canIgnore && onIgnore ? (
              <button type="button" onClick={onIgnore} disabled={!!busy}>
                {busy ? "Ignoring…" : "Ignore and continue"}
              </button>
            ) : null}
          </div>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
