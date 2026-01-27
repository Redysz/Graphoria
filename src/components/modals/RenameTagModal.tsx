type Props = {
  oldName: string;
  newName: string;
  setNewName: (v: string) => void;
  renameOnRemote: boolean;
  setRenameOnRemote: (v: boolean) => void;
  busy: boolean;
  error: string;
  activeRepoPath: string;
  onClose: () => void;
  onRename: () => void;
};

export function RenameTagModal({
  oldName,
  newName,
  setNewName,
  renameOnRemote,
  setRenameOnRemote,
  busy,
  error,
  activeRepoPath,
  onClose,
  onRename,
}: Props) {
  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ width: "min(640px, 96vw)", maxHeight: "min(60vh, 540px)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>Rename tag</div>
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

            <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.9 }}>
              <input
                type="checkbox"
                checked={renameOnRemote}
                onChange={(e) => setRenameOnRemote(e.target.checked)}
                disabled={busy}
              />
              Also rename on remote origin
            </label>
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
