type Props = {
  busy: boolean;
  actionError: string;

  globalCommand: string;
  copied: boolean;

  currentUsername: string;

  detailsOpen: boolean;
  details: string;

  onClose: () => void;
  onCopyGlobalCommand: () => void;
  onTrustGlobally: () => void;
  onTrustForSession: () => void;
  onChangeOwnership: () => void;
  onRevealInExplorer: () => void;
  onOpenTerminal: () => void;
  onToggleDetails: () => void;
};

export function GitTrustModal({
  busy,
  actionError,
  globalCommand,
  copied,
  currentUsername,
  detailsOpen,
  details,
  onClose,
  onCopyGlobalCommand,
  onTrustGlobally,
  onTrustForSession,
  onChangeOwnership,
  onRevealInExplorer,
  onOpenTerminal,
  onToggleDetails,
}: Props) {
  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ width: "min(980px, 96vw)", maxHeight: "min(76vh, 780px)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>Repository is not trusted by Git</div>
          <button type="button" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>
        <div className="modalBody">
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ opacity: 0.85 }}>
              Git prevents opening a repository owned by someone else than the current user. You can choose one of the solutions below.
            </div>

            {actionError ? <div className="error">{actionError}</div> : null}

            <div className="recoveryOption" style={{ gridTemplateColumns: "1fr" }}>
              <div>
                <div className="recoveryOptionTitle">Trust this repository globally (recommended)</div>
                <div className="recoveryOptionDesc">Adds this repository to Git's global safe.directory list.</div>
                <div style={{ display: "flex", gap: 10, alignItems: "stretch", marginBottom: 10 }}>
                  <pre
                    className="mono"
                    style={{
                      margin: 0,
                      padding: "10px 12px",
                      borderRadius: 12,
                      border: "1px solid var(--border)",
                      background: "var(--panel-2)",
                      opacity: 0.95,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                      flex: "1 1 auto",
                      minWidth: 0,
                    }}
                  >
                    {globalCommand}
                  </pre>
                  <button
                    type="button"
                    onClick={onCopyGlobalCommand}
                    disabled={busy || !globalCommand || copied}
                    title="Copy command to clipboard"
                    style={copied ? { background: "rgba(0, 140, 0, 0.10)", borderColor: "rgba(0, 140, 0, 0.25)" } : undefined}
                  >
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
                <button type="button" onClick={onTrustGlobally} disabled={busy}>
                  Trust globally
                </button>
              </div>
            </div>

            <div className="recoveryOption" style={{ gridTemplateColumns: "1fr" }}>
              <div>
                <div className="recoveryOptionTitle">Trust this repository for this session only</div>
                <div className="recoveryOptionDesc">
                  Graphoria will allow Git operations for this repository during the current app session, without changing your Git configuration.
                </div>
                <button type="button" onClick={onTrustForSession} disabled={busy}>
                  Trust for session
                </button>
              </div>
            </div>

            <div className="recoveryOption" style={{ gridTemplateColumns: "1fr" }}>
              <div>
                <div className="recoveryOptionTitle">Change ownership to {currentUsername ? currentUsername : "current user"}</div>
                <div className="recoveryOptionDesc">Attempts to fix the underlying filesystem ownership/permissions issue.</div>
                <button type="button" onClick={onChangeOwnership} disabled={busy}>
                  Change ownership
                </button>
              </div>
            </div>

            <div className="recoveryOption" style={{ gridTemplateColumns: "1fr" }}>
              <div>
                <div className="recoveryOptionTitle">Other actions</div>
                <div className="recoveryOptionDesc">Inspect the folder or run Git manually.</div>
                <div className="recoveryRow">
                  <button type="button" onClick={onRevealInExplorer} disabled={busy}>
                    Reveal in Explorer
                  </button>
                  <button type="button" onClick={onOpenTerminal} disabled={busy}>
                    Open terminal (Git Bash)
                  </button>
                  <button type="button" onClick={onClose} disabled={busy}>
                    Close
                  </button>
                  <button type="button" onClick={onToggleDetails} disabled={busy || !details}>
                    {detailsOpen ? "Hide details" : "Details"}
                  </button>
                </div>

                {detailsOpen && details ? <pre style={{ whiteSpace: "pre-wrap", opacity: 0.85, marginTop: 10 }}>{details}</pre> : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
