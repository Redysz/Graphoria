import { useCallback } from "react";

export type GoToKind = "commit" | "tag";

export type GoToTargetView = "graph" | "commits";

type Props = {
  kind: GoToKind;
  text: string;
  setText: (v: string) => void;
  targetView: GoToTargetView;
  setTargetView: (v: GoToTargetView) => void;
  error: string;
  setError: (v: string) => void;
  activeRepoPath: string;
  onClose: () => void;
  onGo: (ref: string, targetView: GoToTargetView) => Promise<boolean>;
};

export function GoToModal({
  kind,
  text,
  setText,
  targetView,
  setTargetView,
  error,
  setError,
  activeRepoPath,
  onClose,
  onGo,
}: Props) {
  const handleGo = useCallback(() => {
    void (async () => {
      if (!activeRepoPath) return;
      const ref = text.trim();
      if (!ref) {
        setError("Enter a value.");
        return;
      }
      setError("");
      const ok = await onGo(ref, targetView);
      if (ok) onClose();
    })();
  }, [activeRepoPath, onClose, onGo, setError, targetView, text]);

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ width: "min(560px, 96vw)", maxHeight: "min(84vh, 560px)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>{kind === "commit" ? "Go to commit" : "Go to tag"}</div>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modalBody" style={{ display: "grid", gap: 12 }}>
          {error ? <div className="error">{error}</div> : null}

          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontWeight: 900, opacity: 0.75 }}>{kind === "commit" ? "Commit hash / ref" : "Tag name"}</div>
            <input
              className="modalInput"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={kind === "commit" ? "e.g. a1b2c3d or HEAD~3" : "e.g. v1.2.3"}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  onClose();
                  return;
                }
                if (e.key === "Enter") {
                  handleGo();
                }
              }}
              autoFocus
            />
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontWeight: 900, opacity: 0.75 }}>Target view</div>
            <select value={targetView} onChange={(e) => setTargetView(e.target.value as GoToTargetView)}>
              <option value="graph">Graph</option>
              <option value="commits">Commits</option>
            </select>
          </div>
        </div>
        <div className="modalFooter">
          <button type="button" onClick={handleGo} disabled={!activeRepoPath}>
            Go
          </button>
        </div>
      </div>
    </div>
  );
}
