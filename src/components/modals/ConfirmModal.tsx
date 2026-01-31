type Props = {
  title: string;
  message: string;
  okLabel: string;
  cancelLabel: string;
  onCancel: () => void;
  onOk: () => void;
};

export function ConfirmModal({ title, message, okLabel, cancelLabel, onCancel, onOk }: Props) {
  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" style={{ zIndex: 80 }}>
      <div className="modal" style={{ width: "min(540px, 96vw)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>{title}</div>
        </div>
        <div className="modalBody">
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", opacity: 0.85 }}>{message}</pre>
        </div>
        <div className="modalFooter" style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <button type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" onClick={onOk}>
            {okLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
