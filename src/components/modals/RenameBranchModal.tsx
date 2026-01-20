type Props = {
  oldName: string;
  newName: string;
  setNewName: (v: string) => void;
  busy: boolean;
  error: string;
  activeRepoPath: string;
  onClose: () => void;
  onRename: () => void;
};

export function RenameBranchModal({ oldName, newName, setNewName, busy, error, activeRepoPath, onClose, onRename }: Props) {
  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ width: "min(640px, 96vw)", maxHeight: "min(60vh, 520px)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>Rename branch</div>
          <button type="button" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>
        <div className="modalBody">
          {error ? <div className="error">{error}</div> : null}
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800, opacity: 0.8 }}>Old name</div>
              <input value={oldName} className="modalInput" disabled />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800, opacity: 0.8 }}>New name</div>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} className="modalInput" disabled={busy} />
            </div>
          </div>
        </div>
        <div className="modalFooter" style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onRename}
            disabled={busy || !activeRepoPath || !newName.trim() || newName.trim() === oldName.trim()}
          >
            {busy ? "Renaming…" : "Rename"}
          </button>
        </div>
      </div>
    </div>
  );
}
