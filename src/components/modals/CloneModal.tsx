import type { Dispatch, SetStateAction } from "react";

type Props = {
  busy: boolean;
  error: string;
  progressMessage: string;
  progressPercent: number | null;

  repoUrl: string;
  setRepoUrl: Dispatch<SetStateAction<string>>;

  destinationFolder: string;
  setDestinationFolder: Dispatch<SetStateAction<string>>;

  subdirName: string;
  setSubdirName: Dispatch<SetStateAction<string>>;

  targetPath: string;

  branch: string;
  setBranch: Dispatch<SetStateAction<string>>;

  branchesBusy: boolean;
  branchesError: string;
  branches: string[];
  setBranches: Dispatch<SetStateAction<string[]>>;
  setBranchesError: Dispatch<SetStateAction<string>>;

  initSubmodules: boolean;
  setInitSubmodules: Dispatch<SetStateAction<boolean>>;

  downloadFullHistory: boolean;
  setDownloadFullHistory: Dispatch<SetStateAction<boolean>>;

  bare: boolean;
  setBare: Dispatch<SetStateAction<boolean>>;

  origin: string;
  setOrigin: Dispatch<SetStateAction<string>>;

  singleBranch: boolean;
  setSingleBranch: Dispatch<SetStateAction<boolean>>;

  onBrowseDestination: () => void;
  onFetchBranches: () => void;

  onClose: () => void;
  onClone: () => void;
};

export function CloneModal({
  busy,
  error,
  progressMessage,
  progressPercent,
  repoUrl,
  setRepoUrl,
  destinationFolder,
  setDestinationFolder,
  subdirName,
  setSubdirName,
  targetPath,
  branch,
  setBranch,
  branchesBusy,
  branchesError,
  branches,
  setBranches,
  setBranchesError,
  initSubmodules,
  setInitSubmodules,
  downloadFullHistory,
  setDownloadFullHistory,
  bare,
  setBare,
  origin,
  setOrigin,
  singleBranch,
  setSingleBranch,
  onBrowseDestination,
  onFetchBranches,
  onClose,
  onClone,
}: Props) {
  const cloneDisabled = busy || !repoUrl.trim() || !destinationFolder.trim() || !targetPath;

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ width: "min(980px, 96vw)", maxHeight: "min(80vh, 820px)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>Clone repository</div>
          <button type="button" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>
        <div className="modalBody">
          {error ? <div className="error">{error}</div> : null}
          {busy && progressMessage ? (
            <div style={{ opacity: 0.75, fontSize: 12, marginBottom: 10 }}>
              <span className="mono">{progressMessage}</span>
            </div>
          ) : null}

          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800, opacity: 0.8 }}>Repository link</div>
              <input
                value={repoUrl}
                onChange={(e) => {
                  setRepoUrl(e.target.value);
                  setBranches([]);
                  setBranchesError("");
                }}
                className="modalInput"
                placeholder="https://github.com/user/repo.git"
                disabled={busy}
              />
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800, opacity: 0.8 }}>Destination folder</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  value={destinationFolder}
                  onChange={(e) => setDestinationFolder(e.target.value)}
                  className="modalInput"
                  placeholder="C:\\Projects"
                  disabled={busy}
                />
                <button type="button" onClick={onBrowseDestination} disabled={busy}>
                  Browse…
                </button>
              </div>
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800, opacity: 0.8 }}>Create subdirectory</div>
              <div style={{ display: "grid", gap: 8 }}>
                <input
                  value={subdirName}
                  onChange={(e) => setSubdirName(e.target.value)}
                  className="modalInput"
                  placeholder="(default: do not create subfolder)"
                  disabled={busy}
                />
                <div style={{ opacity: 0.7, fontSize: 12 }}>
                  Target path: <span className="mono">{targetPath || "(choose destination folder first)"}</span>
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontWeight: 800, opacity: 0.8 }}>Branch to clone</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    onClick={onFetchBranches}
                    disabled={busy || branchesBusy || !repoUrl.trim()}
                    title="Fetch branches from remote (git ls-remote --heads)"
                  >
                    {branchesBusy ? "Fetching…" : "Fetch"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setBranch("")}
                    disabled={busy || !branch.trim()}
                    title="Use default branch"
                  >
                    Default
                  </button>
                </div>
              </div>
              {branchesError ? <div className="error">{branchesError}</div> : null}
              <input
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className="modalInput"
                placeholder="(default)"
                list="cloneBranchesList"
                disabled={busy}
              />
              <datalist id="cloneBranchesList">
                {branches.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ fontWeight: 800, opacity: 0.8 }}>Options</div>
              <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.85 }}>
                  <input type="checkbox" checked={initSubmodules} onChange={(e) => setInitSubmodules(e.target.checked)} disabled={busy} />
                  Initialize all submodules
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.85 }}>
                  <input
                    type="checkbox"
                    checked={downloadFullHistory}
                    onChange={(e) => setDownloadFullHistory(e.target.checked)}
                    disabled={busy}
                  />
                  Download full history
                </label>
                <label
                  style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.85 }}
                  title="Bare repository has no working tree (no project files), only Git history. Useful for read-only storage."
                >
                  <input type="checkbox" checked={bare} onChange={(e) => setBare(e.target.checked)} disabled={busy} />
                  Bare repository
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.85 }}>
                  <input type="checkbox" checked={singleBranch} onChange={(e) => setSingleBranch(e.target.checked)} disabled={busy} />
                  Single-branch
                </label>
              </div>
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800, opacity: 0.8 }}>Origin</div>
              <input
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                className="modalInput"
                placeholder="(default: origin)"
                disabled={busy}
              />
            </div>
          </div>
        </div>
        <div className="modalFooter">
          <button type="button" onClick={onClone} disabled={cloneDisabled}>
            {busy ? (progressPercent !== null ? `Cloning ${progressPercent}%` : "Cloning…") : "Clone"}
          </button>
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
