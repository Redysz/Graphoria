import type { GitBranchInfo } from "../../types/git";

type SwitchMode = "local" | "remote";

type RemoteLocalMode = "same" | "custom";

type Props = {
  mode: SwitchMode;
  setMode: (v: SwitchMode) => void;

  branchName: string;
  setBranchName: (v: string) => void;

  remoteLocalMode: RemoteLocalMode;
  setRemoteLocalMode: (v: RemoteLocalMode) => void;

  remoteLocalName: string;
  setRemoteLocalName: (v: string) => void;

  busy: boolean;
  error: string;
  setError: (v: string) => void;

  branchesLoading: boolean;
  branchesError: string;
  branches: GitBranchInfo[];

  activeRepoPath: string;

  onClose: () => void;
  onFetch: () => void;
  onSwitch: () => void;
};

export function SwitchBranchModal({
  mode,
  setMode,
  branchName,
  setBranchName,
  remoteLocalMode,
  setRemoteLocalMode,
  remoteLocalName,
  setRemoteLocalName,
  busy,
  error,
  setError,
  branchesLoading,
  branchesError,
  branches,
  activeRepoPath,
  onClose,
  onFetch,
  onSwitch,
}: Props) {
  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ width: "min(760px, 96vw)", maxHeight: "min(70vh, 620px)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>Checkout (Switch) branch</div>
          <button type="button" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>
        <div className="modalBody">
          {error ? <div className="error">{error}</div> : null}
          {branchesError ? <div className="error">{branchesError}</div> : null}

          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 800 }}>
                  <input
                    type="radio"
                    name="switchMode"
                    checked={mode === "local"}
                    onChange={() => {
                      setMode("local");
                      setError("");
                    }}
                    disabled={busy}
                  />
                  Local branch
                </label>
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 800 }}>
                  <input
                    type="radio"
                    name="switchMode"
                    checked={mode === "remote"}
                    onChange={() => {
                      setMode("remote");
                      setError("");
                    }}
                    disabled={busy}
                  />
                  Remote branch
                </label>
              </div>
              <button
                type="button"
                onClick={onFetch}
                disabled={busy || branchesLoading || !activeRepoPath}
                title="Fetch and refresh remote branches"
              >
                {branchesLoading ? "Fetching…" : "Fetch"}
              </button>
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800, opacity: 0.8 }}>{mode === "local" ? "Branch" : "Remote branch"}</div>
              <input
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
                className="modalInput"
                disabled={busy}
                list={mode === "local" ? "switchLocalBranches" : "switchRemoteBranches"}
                placeholder={mode === "local" ? "main" : "origin/main"}
              />
              <datalist id="switchLocalBranches">
                {branches
                  .filter((b) => b.kind === "local")
                  .slice()
                  .sort((a, b) => (b.committer_date || "").localeCompare(a.committer_date || ""))
                  .map((b) => (
                    <option key={`l-${b.name}`} value={b.name} />
                  ))}
              </datalist>
              <datalist id="switchRemoteBranches">
                {branches
                  .filter((b) => b.kind === "remote")
                  .slice()
                  .sort((a, b) => (b.committer_date || "").localeCompare(a.committer_date || ""))
                  .map((b) => (
                    <option key={`r-${b.name}`} value={b.name} />
                  ))}
              </datalist>
            </div>

            {mode === "remote" ? (
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ fontWeight: 800, opacity: 0.8 }}>Local branch</div>
                <label style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <input
                    type="radio"
                    name="remoteLocalMode"
                    checked={remoteLocalMode === "same"}
                    onChange={() => setRemoteLocalMode("same")}
                    disabled={busy}
                  />
                  <div>
                    <div style={{ fontWeight: 800 }}>Reset/Create local branch with the same name</div>
                    <div style={{ opacity: 0.75, fontSize: 12 }}>
                      Uses <span className="mono">git switch --track -C</span>.
                    </div>
                  </div>
                </label>
                <label style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <input
                    type="radio"
                    name="remoteLocalMode"
                    checked={remoteLocalMode === "custom"}
                    onChange={() => setRemoteLocalMode("custom")}
                    disabled={busy}
                  />
                  <div style={{ display: "grid", gap: 6, flex: 1 }}>
                    <div style={{ fontWeight: 800 }}>Create local branch with name</div>
                    <input
                      value={remoteLocalName}
                      onChange={(e) => setRemoteLocalName(e.target.value)}
                      className="modalInput"
                      disabled={busy || remoteLocalMode !== "custom"}
                      placeholder="feature/my-local"
                    />
                  </div>
                </label>
              </div>
            ) : null}
          </div>
        </div>
        <div className="modalFooter" style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" onClick={onSwitch} disabled={busy || !activeRepoPath || !branchName.trim()}>
            {busy ? "Switching…" : "Switch"}
          </button>
        </div>
      </div>
    </div>
  );
}
