import type { DiffToolSettings } from "../appSettingsStore";
import type { GitCommit } from "../types/git";
import DiffView from "../DiffView";

export function DetailsPanel(props: {
  visible: boolean;

  detailsTab: "details" | "changes";
  setDetailsTab: (next: "details" | "changes") => void;

  selectedCommit: GitCommit | undefined;

  activeRepoPath: string;
  loading: boolean;

  copyHash: () => void;
  checkoutSelectedCommit: () => void;

  diffTool: DiffToolSettings;
}) {
  const {
    visible,
    detailsTab,
    setDetailsTab,
    selectedCommit,
    activeRepoPath,
    loading,
    copyHash,
    checkoutSelectedCommit,
    diffTool,
  } = props;

  return (
    <div
      className="details"
      style={
        visible
          ? undefined
          : {
              padding: 0,
              borderTop: "none",
              overflow: "hidden",
              pointerEvents: "none",
            }
      }
    >
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

      <div className="detailsBody">
        {!selectedCommit ? (
          <div style={{ opacity: 0.7 }}>Select a commit to see details.</div>
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
        ) : (
          <div style={{ height: "100%", minHeight: 0 }}>
            {activeRepoPath ? (
              <DiffView repoPath={activeRepoPath} source={{ kind: "commit", commit: selectedCommit.hash }} tool={diffTool} height="100%" />
            ) : (
              <div style={{ opacity: 0.7 }}>No repository selected.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
