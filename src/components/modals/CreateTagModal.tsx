type Props = {
  tag: string;
  setTag: (v: string) => void;

  at: string;

  annotated: boolean;
  setAnnotated: (v: boolean) => void;

  message: string;
  setMessage: (v: string) => void;

  force: boolean;
  setForce: (v: boolean) => void;

  pushToOrigin: boolean;
  setPushToOrigin: (v: boolean) => void;

  busy: boolean;
  error: string;

  activeRepoPath: string;

  onClose: () => void;
  onCreate: () => void;
};

export function CreateTagModal({
  tag,
  setTag,
  at,
  annotated,
  setAnnotated,
  message,
  setMessage,
  force,
  setForce,
  pushToOrigin,
  setPushToOrigin,
  busy,
  error,
  activeRepoPath,
  onClose,
  onCreate,
}: Props) {
  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ width: "min(760px, 96vw)", maxHeight: "min(70vh, 640px)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>Create tag</div>
          <button type="button" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>
        <div className="modalBody">
          {error ? <div className="error">{error}</div> : null}

          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800, opacity: 0.8 }}>Tag name</div>
              <input
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                className="modalInput"
                placeholder="v1.2.3"
                disabled={busy}
              />
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800, opacity: 0.8 }}>Target commit</div>
              <div className="mono" style={{ opacity: 0.85, fontSize: 12 }}>
                {at}
              </div>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.9 }}>
                <input
                  type="checkbox"
                  checked={annotated}
                  onChange={(e) => setAnnotated(e.target.checked)}
                  disabled={busy}
                />
                Annotated tag (git tag -a)
              </label>

              {annotated ? (
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 800, opacity: 0.8 }}>Message</div>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={3}
                    className="modalTextarea"
                    placeholder="Release notes"
                    disabled={busy}
                  />
                </div>
              ) : null}

              <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.9 }}>
                <input
                  type="checkbox"
                  checked={force}
                  onChange={(e) => setForce(e.target.checked)}
                  disabled={busy}
                  title="Overwrite an existing tag with the same name (git tag -f)"
                />
                Force (overwrite tag with the same name)
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.9 }}>
                <input
                  type="checkbox"
                  checked={pushToOrigin}
                  onChange={(e) => setPushToOrigin(e.target.checked)}
                  disabled={busy}
                />
                Push tag to origin
              </label>
            </div>
          </div>
        </div>
        <div className="modalFooter" style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onCreate}
            disabled={
              busy ||
              !activeRepoPath ||
              !tag.trim() ||
              (annotated && !message.trim())
            }
          >
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
