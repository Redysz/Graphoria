import type { DiffToolSettings } from "../../appSettingsStore";
import type { GitCommit } from "../../types/git";
import DiffView from "../../DiffView";

type Props = {
  activeRepoPath: string;
  selectedCommit: GitCommit | undefined;
  detailsTab: "details" | "changes";
  setDetailsTab: (next: "details" | "changes") => void;
  copyHash: () => void;
  checkoutSelectedCommit: () => void;
  loading: boolean;
  tool: DiffToolSettings;
  onClose: () => void;
};

export function ChangesModal({
  activeRepoPath,
  selectedCommit,
  detailsTab,
  setDetailsTab,
  copyHash,
  checkoutSelectedCommit,
  loading,
  tool,
  onClose,
}: Props) {
  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" style={{ zIndex: 300 }}>
      <div className="modal" style={{ width: "min(1200px, 96vw)", maxHeight: "min(80vh, 900px)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>Commit</div>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modalBody" style={{ padding: 12, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div className="detailsTitle">
            <div className="segmented small">
              <button type="button" className={detailsTab === "details" ? "active" : ""} onClick={() => setDetailsTab("details")}>
                Details
              </button>
              <button type="button" className={detailsTab === "changes" ? "active" : ""} onClick={() => setDetailsTab("changes")}>
                Changes
              </button>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" disabled={!selectedCommit} onClick={() => copyHash()}>
                Copy hash
              </button>
              <button type="button" disabled={!selectedCommit || !activeRepoPath || loading} onClick={() => checkoutSelectedCommit()}>
                Checkout…
              </button>
            </div>
          </div>

          <div className="detailsBody" style={{ flex: 1, minHeight: 0, overflow: detailsTab === "changes" ? "hidden" : "auto" }}>
            {!selectedCommit ? (
              <div style={{ opacity: 0.7 }}>No commit selected.</div>
            ) : detailsTab === "details" ? (
              <div className="detailsGrid">
                <div className="detailsLabel">Hash</div>
                <div className="detailsValue mono">{selectedCommit.hash}</div>

                <div className="detailsLabel">Subject</div>
                <div className="detailsValue">{selectedCommit.subject}</div>

                <div className="detailsLabel">Author</div>
                <div className="detailsValue">
                  {selectedCommit.author_email?.trim()
                    ? `${selectedCommit.author} (${selectedCommit.author_email.trim()})`
                    : selectedCommit.author}
                </div>

                <div className="detailsLabel">Date</div>
                <div className="detailsValue">{selectedCommit.date}</div>

                <div className="detailsLabel">Refs</div>
                <div className="detailsValue mono">{selectedCommit.refs || "(none)"}</div>
              </div>
            ) : !activeRepoPath ? (
              <div style={{ opacity: 0.7 }}>No repository selected.</div>
            ) : (
              <DiffView repoPath={activeRepoPath} source={{ kind: "commit", commit: selectedCommit.hash }} tool={tool} height={"100%"} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
