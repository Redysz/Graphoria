type Props = {
  src: string;
  onClose: () => void;
};

export function PreviewZoomModal({ src, onClose }: Props) {
  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" onClick={onClose} style={{ zIndex: 500 }}>
      <div
        style={{
          width: "min(1100px, 96vw)",
          maxHeight: "min(86vh, 860px)",
          borderRadius: 14,
          border: "1px solid rgba(15, 15, 15, 0.18)",
          background: "var(--panel)",
          boxShadow: "0 24px 90px rgba(0, 0, 0, 0.40)",
          padding: 10,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: 6 }}>
          <div style={{ fontWeight: 900, opacity: 0.8 }}>Preview</div>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div style={{ overflow: "auto", maxHeight: "calc(min(86vh, 860px) - 58px)" }}>
          <img
            src={src}
            alt="Preview zoom"
            onClick={onClose}
            style={{
              width: "100%",
              height: "auto",
              display: "block",
              borderRadius: 12,
              border: "1px solid rgba(15, 15, 15, 0.10)",
            }}
          />
        </div>
      </div>
    </div>
  );
}
