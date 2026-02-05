import { useEffect, useState } from "react";
import type { GitPatchPredictResult } from "../../types/git";

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
  predictError: string;
  predictResult: GitPatchPredictResult | null;

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
  predictError,
  predictResult,
  onPickPatchFile,
  onPickSaveFile,
  onPredict,
  onRun,
  onClose,
}: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      setAdvancedOpen(false);
    }
  }, [open]);

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
              <button
                type="button"
                onClick={() => setAdvancedOpen((v) => !v)}
                disabled={busy || predictBusy}
                style={{ display: "inline-flex", alignItems: "center", gap: 8, alignSelf: "flex-start" }}
                title="Show prediction output"
              >
                {advancedOpen ? "Predict ▲" : "Predict ▼"}
              </button>
            ) : null}

            {!isExport && advancedOpen ? (
              <div style={{ display: "grid", gap: 10 }}>
                {predictError ? <div className="error">{predictError}</div> : null}
                {predictBusy ? <div style={{ opacity: 0.7 }}>Predicting…</div> : null}
                {predictResult ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ opacity: 0.85 }}>
                      Result: <span className="mono">{predictResult.ok ? "ok" : "conflicts"}</span>
                    </div>
                    {predictResult.message ? (
                      <pre style={{ margin: 0, whiteSpace: "pre-wrap", opacity: 0.8 }}>{predictResult.message}</pre>
                    ) : null}
                    <div>
                      <div style={{ fontWeight: 800, opacity: 0.8, marginBottom: 6 }}>Touched files</div>
                      {predictResult.files?.length ? (
                        <div className="statusList">
                          {predictResult.files.map((p) => (
                            <div key={p} className="statusRow statusRowSingleCol" title={p}>
                              <span className="statusPath">{p}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ opacity: 0.75 }}>No files detected.</div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {!isExport && !advancedOpen ? (
              <div style={{ opacity: 0.7, fontSize: 12 }}>
                Predict uses <span className="mono">git apply --check</span>. For <span className="mono">git am</span>, it checks the diff section of the patch.
              </div>
            ) : null}

            {!isExport ? (
              <div style={{ display: "flex", gap: 10 }}>
                <button type="button" onClick={onPredict} disabled={busy || predictBusy || !activeRepoPath || !patchPath.trim()}>
                  {predictBusy ? "Predicting…" : "Predict"}
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <div className="modalFooter" style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <button type="button" onClick={onClose} disabled={busy || predictBusy}>
            Cancel
          </button>
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
  );
}
