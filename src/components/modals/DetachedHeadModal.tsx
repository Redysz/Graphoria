import type { TerminalProfile } from "../../appSettingsStore";

type Props = {
  busy: boolean;
  error: string;

  activeRepoPath: string;
  changedCount: number;

  targetBranch: string;
  setTargetBranch: (v: string) => void;
  branchOptions: string[];

  saveCommitMessage: string;
  setSaveCommitMessage: (v: string) => void;

  tempBranchName: string;
  setTempBranchName: (v: string) => void;

  tempBranchRandom: boolean;
  setTempBranchRandom: (v: boolean) => void;

  mergeAfterSave: boolean;
  setMergeAfterSave: (v: boolean) => void;

  preferCommitChangesOnConflict: boolean;
  setPreferCommitChangesOnConflict: (v: boolean) => void;

  onClose: () => void;

  onFixSimple: () => void;
  onFixDiscardChanges: () => void;
  onSaveByBranch: () => void;
  onPrepareCherryPickSteps: () => void;

  terminalProfiles: TerminalProfile[];
  onOpenTerminalProfile: (profileId: string) => void;
  onTogglePreviewZoom: (src: string) => void;
};

function PreviewZoomBadge() {
  return (
    <span
      style={{
        position: "absolute",
        right: 10,
        top: 10,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 30,
        height: 30,
        borderRadius: 10,
        border: "1px solid rgba(15, 15, 15, 0.14)",
        background: "rgba(255, 255, 255, 0.92)",
        boxShadow: "0 10px 30px rgba(0, 0, 0, 0.12)",
        pointerEvents: "none",
      }}
      aria-hidden="true"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M10.5 18.5C14.6421 18.5 18 15.1421 18 11C18 6.85786 14.6421 3.5 10.5 3.5C6.35786 3.5 3 6.85786 3 11C3 15.1421 6.35786 18.5 10.5 18.5Z"
          stroke="rgba(15, 15, 15, 0.7)"
          strokeWidth="2"
        />
        <path d="M16.2 16.2L21 21" stroke="rgba(15, 15, 15, 0.7)" strokeWidth="2" strokeLinecap="round" />
        <path d="M10.5 8V14" stroke="rgba(15, 15, 15, 0.7)" strokeWidth="2" strokeLinecap="round" />
        <path d="M7.5 11H13.5" stroke="rgba(15, 15, 15, 0.7)" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export function DetachedHeadModal({
  busy,
  error,
  activeRepoPath,
  changedCount,
  targetBranch,
  setTargetBranch,
  branchOptions,
  saveCommitMessage,
  setSaveCommitMessage,
  tempBranchName,
  setTempBranchName,
  tempBranchRandom,
  setTempBranchRandom,
  mergeAfterSave,
  setMergeAfterSave,
  preferCommitChangesOnConflict,
  setPreferCommitChangesOnConflict,
  onClose,
  onFixSimple,
  onFixDiscardChanges,
  onSaveByBranch,
  onPrepareCherryPickSteps,
  terminalProfiles,
  onOpenTerminalProfile,
  onTogglePreviewZoom,
}: Props) {
  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ width: "min(980px, 96vw)", maxHeight: "min(78vh, 720px)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>Detached HEAD</div>
          <button type="button" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>
        <div className="modalBody">
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ opacity: 0.85 }}>
              Detached HEAD is a normal Git state after checking out a commit directly. If this is intentional (you are inspecting
              history), you don't need to do anything.
            </div>

            <div style={{ opacity: 0.85 }}>
              If you don't want to stay in detached HEAD state (or you're not sure how it happened), choose one of the solutions
              below.
            </div>

            {error ? <div className="error">{error}</div> : null}

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontWeight: 900, opacity: 0.8 }}>Target branch</div>
              <select
                value={targetBranch}
                onChange={(e) => setTargetBranch(e.target.value)}
                disabled={busy || branchOptions.length <= 1}
                title={branchOptions.length === 0 ? "No local branch available." : "Select which branch should be checked out to re-attach HEAD."}
              >
                {branchOptions.length === 0 ? <option value="">(none)</option> : null}
                {branchOptions.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>

            <div className="recoveryOption">
              <div>
                <div className="recoveryOptionTitle">I have no changes, just fix it</div>
                <div className="recoveryOptionDesc">Checks out the target branch that points at the current commit.</div>
                <div className="mono" style={{ opacity: 0.9, marginBottom: 10 }}>
                  git checkout &lt;target-branch&gt;
                </div>
                <button type="button" onClick={onFixSimple} disabled={busy || !activeRepoPath || !targetBranch}>
                  {busy ? "Working…" : "Fix detached HEAD"}
                </button>
              </div>
              <button
                type="button"
                onClick={() => onTogglePreviewZoom("/recovery/detached-fix-simple.svg")}
                title="Click to zoom"
                style={{ border: 0, padding: 0, background: "transparent", position: "relative" }}
              >
                <PreviewZoomBadge />
                <img className="recoveryPreview" src="/recovery/detached-fix-simple.svg" alt="Preview" />
              </button>
            </div>

            <div className="recoveryOption">
              <div>
                <div className="recoveryOptionTitle">I have changes, but they are not important. Discard them and fix</div>
                <div className="recoveryOptionDesc">Discards local changes and checks out the target branch.</div>
                <div className="mono" style={{ opacity: 0.9, marginBottom: 10 }}>
                  git reset --hard
                  <br />
                  git checkout &lt;target-branch&gt;
                </div>
                <button
                  type="button"
                  onClick={onFixDiscardChanges}
                  disabled={busy || !activeRepoPath || !targetBranch || changedCount === 0}
                  title={changedCount === 0 ? "No local changes detected." : undefined}
                >
                  {busy ? "Working…" : "Discard changes and fix"}
                </button>
              </div>
              <button
                type="button"
                onClick={() => onTogglePreviewZoom("/recovery/detached-fix-hard.svg")}
                title="Click to zoom"
                style={{ border: 0, padding: 0, background: "transparent", position: "relative" }}
              >
                <PreviewZoomBadge />
                <img className="recoveryPreview" src="/recovery/detached-fix-hard.svg" alt="Preview" />
              </button>
            </div>

            <div className="recoveryOption">
              <div>
                <div className="recoveryOptionTitle">Save changes by creating a branch</div>
                <div className="recoveryOptionDesc">
                  Commits your current changes, creates a temporary branch, then checks out the target branch. Optionally merges and
                  deletes the temporary branch.
                </div>

                <div className="recoveryFields">
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontWeight: 900, opacity: 0.8 }}>Commit message</div>
                    <input
                      value={saveCommitMessage}
                      onChange={(e) => setSaveCommitMessage(e.target.value)}
                      className="modalInput"
                      disabled={busy || changedCount === 0}
                      placeholder="Commit message"
                    />
                  </div>

                  <div className="recoveryRow">
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 900, opacity: 0.85 }}>
                      <input type="checkbox" checked={tempBranchRandom} onChange={(e) => setTempBranchRandom(e.target.checked)} disabled={busy} />
                      Set random branch name
                    </label>
                    <input
                      value={tempBranchName}
                      onChange={(e) => setTempBranchName(e.target.value)}
                      className="modalInput"
                      disabled={busy || tempBranchRandom}
                      placeholder="temporary-branch-name"
                      style={{ width: 320 }}
                    />
                  </div>

                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 900, opacity: 0.85 }}>
                    <input type="checkbox" checked={mergeAfterSave} onChange={(e) => setMergeAfterSave(e.target.checked)} disabled={busy} />
                    Merge temporary branch into target branch
                  </label>
                </div>

                <button
                  type="button"
                  onClick={onSaveByBranch}
                  disabled={
                    busy ||
                    !activeRepoPath ||
                    !targetBranch ||
                    changedCount === 0 ||
                    !saveCommitMessage.trim() ||
                    !tempBranchName.trim()
                  }
                  title={changedCount === 0 ? "No local changes detected." : undefined}
                >
                  {busy ? "Working…" : "Save changes using a branch"}
                </button>
              </div>
              <button
                type="button"
                onClick={() => onTogglePreviewZoom("/recovery/detached-fix-branch.svg")}
                title="Click to zoom"
                style={{ border: 0, padding: 0, background: "transparent", position: "relative" }}
              >
                <PreviewZoomBadge />
                <img className="recoveryPreview" src="/recovery/detached-fix-branch.svg" alt="Preview" />
              </button>
            </div>

            <div className="recoveryOption">
              <div>
                <div className="recoveryOptionTitle">Save changes by cherry-picks</div>
                <div className="recoveryOptionDesc">Commits your changes, then shows the steps to cherry-pick onto the target branch.</div>
                <label
                  style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 900, opacity: 0.85, margin: "8px 0 10px" }}
                  title="When enabled, overlapping changes are auto-resolved in favor of the detached commit."
                >
                  <input
                    type="checkbox"
                    checked={preferCommitChangesOnConflict}
                    onChange={(e) => setPreferCommitChangesOnConflict(e.target.checked)}
                    disabled={busy}
                  />
                  Prefer detached commit changes on conflict
                </label>
                <div className="mono" style={{ opacity: 0.9, marginBottom: 10 }}>
                  git commit -a -m &quot;&lt;message&gt;&quot;
                  <br />
                  git reset --hard
                  <br />
                  git checkout &lt;target-branch&gt;
                  <br />
                  git reflog
                  <br />
                  git cherry-pick &lt;hash&gt;
                </div>
                <button
                  type="button"
                  onClick={onPrepareCherryPickSteps}
                  disabled={busy || !activeRepoPath || !targetBranch || changedCount === 0}
                  title={changedCount === 0 ? "No local changes detected." : undefined}
                >
                  {busy ? "Working…" : "Show cherry-pick steps"}
                </button>
              </div>
              <button
                type="button"
                onClick={() => onTogglePreviewZoom("/recovery/detached-fix-cherry.svg")}
                title="Click to zoom"
                style={{ border: 0, padding: 0, background: "transparent", position: "relative" }}
              >
                <PreviewZoomBadge />
                <img className="recoveryPreview" src="/recovery/detached-fix-cherry.svg" alt="Preview" />
              </button>
            </div>

            <div className="recoveryOption">
              <div>
                <div className="recoveryOptionTitle">I'll handle it myself — open terminal</div>
                <div className="recoveryOptionDesc">Opens a terminal in the repository folder.</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                  {terminalProfiles.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => onOpenTerminalProfile(p.id)}
                      disabled={busy || !activeRepoPath}
                      title={p.kind === "custom" ? (p.command?.trim() ? p.command.trim() : "Custom") : undefined}
                    >
                      {p.name}
                    </button>
                  ))}
                  {terminalProfiles.length === 0 ? (
                    <div style={{ opacity: 0.6, fontSize: 13 }}>No terminal profiles configured.</div>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onTogglePreviewZoom("/recovery/detached-fix-terminal.svg")}
                title="Click to zoom"
                style={{ border: 0, padding: 0, background: "transparent", position: "relative" }}
              >
                <PreviewZoomBadge />
                <img className="recoveryPreview" src="/recovery/detached-fix-terminal.svg" alt="Preview" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
