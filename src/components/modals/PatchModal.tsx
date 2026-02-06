type PatchMode = "export" | "apply";
type PatchMethod = "apply" | "am";

type Props = {
  mode: PatchMode;
  open: boolean;

  activeRepoPath: string;
  defaultCommit: string;

  busy: boolean;
  error: string;
  status: string;

  patchPath: string;
  setPatchPath: (v: string) => void;

  method: PatchMethod;
  setMethod: (v: PatchMethod) => void;

  predictBusy: boolean;

  onPickPatchFile: () => void;
  onPickSaveFile: () => void;

  onPredict: () => void;
  onRun: () => void;
  onClose: () => void;
};

export function PatchModal({
  mode,
  open,
  activeRepoPath,
  defaultCommit,
  busy,
  error,
  status,
  patchPath,
  setPatchPath,
  method,
  setMethod,
  predictBusy,
  onPickPatchFile,
  onPickSaveFile,
  onPredict,
  onRun,
  onClose,
}: Props) {
  if (!open) return null;

  const isExport = mode === "export";

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ width: "min(860px, 96vw)", maxHeight: "min(76vh, 720px)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>{isExport ? "Export patch" : "Apply patch"}</div>
          <button type="button" onClick={onClose} disabled={busy || predictBusy}>
            Close
          </button>
        </div>
        <div className="modalBody">
          {error ? <div className="error">{error}</div> : null}
          {status ? <div style={{ opacity: 0.75, marginBottom: 10, whiteSpace: "pre-wrap" }}>{status}</div> : null}

          <div style={{ display: "grid", gap: 12 }}>
            {isExport ? (
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontWeight: 800, opacity: 0.8 }}>Commit</div>
                <input value={defaultCommit} className="modalInput mono" disabled={true} />
                <div style={{ opacity: 0.7, fontSize: 12 }}>Exports a single-commit patch using git format-patch.</div>
              </div>
            ) : null}

            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800, opacity: 0.8 }}>{isExport ? "Save to" : "Patch file"}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center" }}>
                <input
                  value={patchPath}
                  onChange={(e) => setPatchPath(e.target.value)}
                  className="modalInput mono"
                  disabled={busy || predictBusy}
                  placeholder={isExport ? "C:\\path\\commit.patch" : "C:\\path\\patch.patch"}
                />
                <button type="button" onClick={isExport ? onPickSaveFile : onPickPatchFile} disabled={busy || predictBusy}>
                  Browse
                </button>
              </div>
            </div>

            {!isExport ? (
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontWeight: 800, opacity: 0.8 }}>Method</div>
                <select
                  className="modalSelect"
                  value={method}
                  onChange={(e) => setMethod(e.target.value as PatchMethod)}
                  disabled={busy || predictBusy}
                >
                  <option value="am">git am (creates commits)</option>
                  <option value="apply">git apply (no commits)</option>
                </select>
              </div>
            ) : null}

            {!isExport ? (
              <div style={{ opacity: 0.7, fontSize: 12 }}>
                Predict shows a mini graph preview and a list of potential conflicts.
              </div>
            ) : null}
          </div>
        </div>
        <div className="modalFooter" style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <button type="button" onClick={onClose} disabled={busy || predictBusy}>
            Cancel
          </button>
          <div style={{ display: "flex", gap: 10 }}>
            {!isExport ? (
              <button type="button" onClick={onPredict} disabled={busy || predictBusy || !activeRepoPath || !patchPath.trim()}>
                {predictBusy ? "Predicting…" : "Predict"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onRun}
              disabled={busy || predictBusy || !activeRepoPath || !patchPath.trim() || (isExport && !defaultCommit.trim())}
            >
              {busy ? (isExport ? "Exporting…" : "Applying…") : isExport ? "Export" : "Apply"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
