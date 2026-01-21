type Props = {
  urlDraft: string;
  setUrlDraft: (v: string) => void;
  currentUrl: string | null | undefined;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: () => void;
};

export function RemoteModal({ urlDraft, setUrlDraft, currentUrl, busy, error, onClose, onSave }: Props) {
  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ width: "min(760px, 96vw)", maxHeight: "min(60vh, 540px)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>Remote</div>
          <button type="button" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>
        <div className="modalBody">
          {error ? <div className="error">{error}</div> : null}

          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontWeight: 800, opacity: 0.8 }}>Origin URL</div>
            <input
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              className="modalInput"
              placeholder="https://github.com/user/repo.git"
              disabled={busy}
            />
            {currentUrl ? (
              <div style={{ opacity: 0.7, fontSize: 12, wordBreak: "break-all" }}>Current: {currentUrl}</div>
            ) : (
              <div style={{ opacity: 0.7, fontSize: 12 }}>No remote origin configured.</div>
            )}
          </div>
        </div>
        <div className="modalFooter">
          <button type="button" onClick={onSave} disabled={busy || !urlDraft.trim()}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
