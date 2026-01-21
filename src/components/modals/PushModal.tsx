type Props = {
  remoteUrl: string | null | undefined;

  localBranch: string;
  setLocalBranch: (v: string) => void;

  remoteBranch: string;
  setRemoteBranch: (v: string) => void;

  force: boolean;
  setForce: (v: boolean) => void;

  withLease: boolean;
  setWithLease: (v: boolean) => void;

  busy: boolean;
  error: string;

  onClose: () => void;
  onPush: () => void;
};

export function PushModal({
  remoteUrl,
  localBranch,
  setLocalBranch,
  remoteBranch,
  setRemoteBranch,
  force,
  setForce,
  withLease,
  setWithLease,
  busy,
  error,
  onClose,
  onPush,
}: Props) {
  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ width: "min(900px, 96vw)", maxHeight: "min(60vh, 560px)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>Push</div>
          <button type="button" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>
        <div className="modalBody">
          {error ? <div className="error">{error}</div> : null}

          <div style={{ display: "grid", gap: 10 }}>
            <div>
              <div style={{ fontWeight: 800, opacity: 0.8 }}>Remote</div>
              <div style={{ opacity: 0.8, fontSize: 12, wordBreak: "break-all" }}>{remoteUrl || "(none)"}</div>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontWeight: 800, opacity: 0.8 }}>Local branch</div>
                <input
                  value={localBranch}
                  onChange={(e) => setLocalBranch(e.target.value)}
                  className="modalInput"
                  placeholder="master"
                  disabled={busy}
                />
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontWeight: 800, opacity: 0.8 }}>Remote branch</div>
                <input
                  value={remoteBranch}
                  onChange={(e) => setRemoteBranch(e.target.value)}
                  className="modalInput"
                  placeholder="main"
                  disabled={busy}
                />
              </div>
              <div style={{ opacity: 0.7, fontSize: 12 }}>
                Example: local <span className="mono">master</span> to remote <span className="mono">main</span>.
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.85 }}>
                <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} disabled={busy} />
                Force push
              </label>
              <label
                style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: force ? 0.85 : 0.5 }}
                title="With lease is safer: it will refuse to force push if remote changed since last fetch."
              >
                <input
                  type="checkbox"
                  checked={withLease}
                  onChange={(e) => setWithLease(e.target.checked)}
                  disabled={busy || !force}
                />
                With lease
              </label>
            </div>
            <div style={{ opacity: 0.7, fontSize: 12, marginTop: -6 }}>
              Force push rewrites history on remote. Use only if you really want to replace remote history.
            </div>
          </div>
        </div>
        <div className="modalFooter">
          <button type="button" onClick={onPush} disabled={busy || !remoteUrl}>
            {busy ? "Pushing…" : "Push"}
          </button>
        </div>
      </div>
    </div>
  );
}
