import { parseUnifiedDiff } from "../../DiffView";
import { fileExtLower, imageMimeFromExt } from "../../utils/filePreview";

export type FilePreviewMode = "normal" | "pullPredict";

type ConflictPreviewLine = { kind: "common" | "ours" | "base" | "theirs"; text: string };

type Props = {
  path: string;
  mode: FilePreviewMode;
  diffToolName: string;

  diff: string;
  content: string;
  imageBase64: string;

  loading: boolean;
  error: string;

  onClose: () => void;
  parsePullPredictConflictPreview: (text: string) => ConflictPreviewLine[];
};

export function FilePreviewModal({
  path,
  mode,
  diffToolName,
  diff,
  content,
  imageBase64,
  loading,
  error,
  onClose,
  parsePullPredictConflictPreview,
}: Props) {
  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" style={{ zIndex: 320 }}>
      <div className="modal" style={{ width: "min(1100px, 96vw)", maxHeight: "min(80vh, 900px)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>File preview</div>
          <button type="button" onClick={onClose} disabled={loading}>
            Close
          </button>
        </div>
        <div className="modalBody">
          <div className="mono" style={{ opacity: 0.85, wordBreak: "break-all", marginBottom: 10 }}>
            {path}
          </div>

          {error ? <div className="error">{error}</div> : null}
          {loading ? <div style={{ opacity: 0.7 }}>Loading…</div> : null}

          {!loading && !error ? (
            diffToolName !== "Graphoria builtin diff" ? (
              <div style={{ opacity: 0.75 }}>Opened in external diff tool.</div>
            ) : imageBase64 ? (
              <div
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  maxHeight: "min(62vh, 720px)",
                  overflow: "hidden",
                }}
              >
                <img
                  src={`data:${imageMimeFromExt(fileExtLower(path))};base64,${imageBase64}`}
                  style={{ width: "100%", height: "100%", maxHeight: "min(62vh, 720px)", objectFit: "contain", display: "block" }}
                />
              </div>
            ) : diff ? (
              <pre className="diffCode" style={{ maxHeight: "min(62vh, 720px)", border: "1px solid var(--border)", borderRadius: 12 }}>
                {parseUnifiedDiff(diff).map((l, i) => (
                  <div key={i} className={`diffLine diffLine-${l.kind}`}>
                    {l.text}
                  </div>
                ))}
              </pre>
            ) : content ? (
              mode === "pullPredict" ? (
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 900, opacity: 0.75 }}>Legend:</span>
                    <span className="conflictLegend conflictLegend-ours">ours</span>
                    <span className="conflictLegend conflictLegend-base">base</span>
                    <span className="conflictLegend conflictLegend-theirs">theirs</span>
                  </div>
                  <pre className="diffCode" style={{ maxHeight: "min(62vh, 720px)", border: "1px solid var(--border)", borderRadius: 12 }}>
                    {parsePullPredictConflictPreview(content).map((l, i) => (
                      <div key={i} className={`conflictLine conflictLine-${l.kind}`}>
                        {l.text}
                      </div>
                    ))}
                  </pre>
                </div>
              ) : (
                <pre className="diffCode" style={{ maxHeight: "min(62vh, 720px)", border: "1px solid var(--border)", borderRadius: 12 }}>
                  {content.replace(/\r\n/g, "\n")}
                </pre>
              )
            ) : (
              <div style={{ opacity: 0.75 }}>No preview.</div>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}
