import type { DiffToolSettings } from "../../appSettingsStore";
import DiffView from "../../DiffView";

type Props = {
  activeRepoPath: string;
  commit: string;
  tool: DiffToolSettings;
  onClose: () => void;
};

export function ChangesModal({ activeRepoPath, commit, tool, onClose }: Props) {
  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" style={{ zIndex: 300 }}>
      <div className="modal" style={{ width: "min(1200px, 96vw)", maxHeight: "min(80vh, 900px)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>Changes</div>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modalBody" style={{ padding: 12 }}>
          {!activeRepoPath ? (
            <div style={{ opacity: 0.7 }}>No repository selected.</div>
          ) : !commit ? (
            <div style={{ opacity: 0.7 }}>No commit selected.</div>
          ) : (
            <DiffView repoPath={activeRepoPath} source={{ kind: "commit", commit }} tool={tool} height={"min(68vh, 720px)"} />
          )}
        </div>
        <div className="modalFooter">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
