import { useState } from "react";
import type { GitBranchInfo } from "../../types/git";

type Props = {
  branchToMerge: string;
  setBranchToMerge: (v: string) => void;

  ffMode: "" | "ff" | "no-ff" | "ff-only";
  setFfMode: (v: "" | "ff" | "no-ff" | "ff-only") => void;

  noCommit: boolean;
  setNoCommit: (v: boolean) => void;

  squash: boolean;
  setSquash: (v: boolean) => void;

  allowUnrelatedHistories: boolean;
  setAllowUnrelatedHistories: (v: boolean) => void;

  strategy: string;
  setStrategy: (v: string) => void;

  logMessages: number;
  setLogMessages: (v: number) => void;

  message: string;
  setMessage: (v: string) => void;

  busy: boolean;
  error: string;
  setError: (v: string) => void;

  branchesLoading: boolean;
  branchesError: string;
  branches: GitBranchInfo[];

  currentBranchName: string;
  activeRepoPath: string;

  onClose: () => void;
  onFetch: () => void;
  onMerge: () => void;
};

export function MergeBranchesModal({
  branchToMerge,
  setBranchToMerge,
  ffMode,
  setFfMode,
  noCommit,
  setNoCommit,
  squash,
  setSquash,
  allowUnrelatedHistories,
  setAllowUnrelatedHistories,
  strategy,
  setStrategy,
  logMessages,
  setLogMessages,
  message,
  setMessage,
  busy,
  error,
  setError,
  branchesLoading,
  branchesError,
  branches,
  currentBranchName,
  activeRepoPath,
  onClose,
  onFetch,
  onMerge,
}: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [useStrategy, setUseStrategy] = useState(false);
  const [useLogMessages, setUseLogMessages] = useState(false);
  const [useMessage, setUseMessage] = useState(false);

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ width: "min(860px, 96vw)", maxHeight: "min(76vh, 720px)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>Merge branches</div>
          <button type="button" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>
        <div className="modalBody">
          {error ? <div className="error">{error}</div> : null}
          {branchesError ? <div className="error">{branchesError}</div> : null}

          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
              <div style={{ fontWeight: 800, opacity: 0.85 }}>
                Into current branch: <span className="mono">{currentBranchName?.trim() ? currentBranchName.trim() : "(detached)"}</span>
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
              <div style={{ fontWeight: 800, opacity: 0.8 }}>Branch to merge</div>
              <input
                value={branchToMerge}
                onChange={(e) => {
                  setBranchToMerge(e.target.value);
                  setError("");
                }}
                className="modalInput"
                disabled={busy}
                list="mergeBranchesAll"
                placeholder="feature/my-branch or origin/feature/my-branch"
              />
              <datalist id="mergeBranchesAll">
                {branches
                  .slice()
                  .sort((a, b) => (b.committer_date || "").localeCompare(a.committer_date || ""))
                  .map((b) => (
                    <option key={`${b.kind}-${b.name}`} value={b.name} />
                  ))}
              </datalist>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ fontWeight: 900, opacity: 0.85 }}>Options</div>

              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontWeight: 800, opacity: 0.8 }}>Fast-forward</div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 800 }}>
                    <input
                      type="radio"
                      name="mergeFfMode"
                      checked={ffMode === ""}
                      onChange={() => setFfMode("")}
                      disabled={busy}
                    />
                    <span title="Use Git default behavior for fast-forward.">Default</span>
                  </label>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 800 }}>
                    <input
                      type="radio"
                      name="mergeFfMode"
                      checked={ffMode === "ff"}
                      onChange={() => setFfMode("ff")}
                      disabled={busy}
                    />
                    <span title="Allow fast-forward if possible (no extra merge commit when a fast-forward is possible).">Allow</span>
                  </label>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 800 }}>
                    <input
                      type="radio"
                      name="mergeFfMode"
                      checked={ffMode === "no-ff"}
                      onChange={() => setFfMode("no-ff")}
                      disabled={busy}
                    />
                    <span title="Always create a merge commit (even if fast-forward is possible).">Create a merge commit</span>
                  </label>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 800 }}>
                    <input
                      type="radio"
                      name="mergeFfMode"
                      checked={ffMode === "ff-only"}
                      onChange={() => setFfMode("ff-only")}
                      disabled={busy}
                    />
                    <span title="Only fast-forward. If branches diverged, merge will fail.">Fast-forward only</span>
                  </label>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setAdvancedOpen((v) => !v)}
                disabled={busy}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  alignSelf: "flex-start",
                }}
                title="Show more merge options"
              >
                {advancedOpen ? "Advanced ▲" : "Advanced ▼"}
              </button>

              {advancedOpen ? (
                <div style={{ display: "grid", gap: 10 }}>
                  <label
                    style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 800 }}
                    title="Perform the merge but stop before creating the merge commit."
                  >
                    <input type="checkbox" checked={noCommit} onChange={(e) => setNoCommit(e.target.checked)} disabled={busy} />
                    Do not commit (--no-commit)
                  </label>

                  <label
                    style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 800 }}
                    title="Create a single squashed change instead of keeping individual commits."
                  >
                    <input type="checkbox" checked={squash} onChange={(e) => setSquash(e.target.checked)} disabled={busy} />
                    Squash commits (--squash)
                  </label>

                  <label
                    style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 800 }}
                    title="Allow merging histories that do not share a common ancestor."
                  >
                    <input
                      type="checkbox"
                      checked={allowUnrelatedHistories}
                      onChange={(e) => setAllowUnrelatedHistories(e.target.checked)}
                      disabled={busy}
                    />
                    Allow unrelated histories (--allow-unrelated-histories)
                  </label>

                  <label
                    style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 800 }}
                    title="Choose a merge strategy (advanced)."
                  >
                    <input
                      type="checkbox"
                      checked={useStrategy}
                      onChange={(e) => {
                        const next = e.target.checked;
                        setUseStrategy(next);
                        if (!next) setStrategy("");
                      }}
                      disabled={busy}
                    />
                    Use merge strategy
                  </label>
                  {useStrategy ? (
                    <div style={{ display: "grid", gap: 6 }}>
                      <div style={{ fontWeight: 800, opacity: 0.8 }}>Merge strategy (--strategy)</div>
                      <input
                        value={strategy}
                        onChange={(e) => setStrategy(e.target.value)}
                        className="modalInput"
                        disabled={busy}
                        placeholder="ort"
                        list="mergeStrategies"
                      />
                      <datalist id="mergeStrategies">
                        <option value="ort" />
                        <option value="recursive" />
                        <option value="resolve" />
                        <option value="octopus" />
                        <option value="ours" />
                        <option value="subtree" />
                      </datalist>
                    </div>
                  ) : null}

                  <label
                    style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 800 }}
                    title="Include up to N log messages from commits being merged (advanced)."
                  >
                    <input
                      type="checkbox"
                      checked={useLogMessages}
                      onChange={(e) => {
                        const next = e.target.checked;
                        setUseLogMessages(next);
                        if (!next) setLogMessages(0);
                      }}
                      disabled={busy}
                    />
                    Add log messages
                  </label>
                  {useLogMessages ? (
                    <div style={{ display: "grid", gap: 6 }}>
                      <div style={{ fontWeight: 800, opacity: 0.8 }}>Add log messages (--log=N)</div>
                      <input
                        value={String(logMessages)}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          setLogMessages(Number.isFinite(n) ? Math.max(0, Math.min(9999, Math.floor(n))) : 0);
                        }}
                        className="modalInput"
                        disabled={busy}
                        inputMode="numeric"
                        placeholder="0"
                      />
                    </div>
                  ) : null}

                  <label
                    style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 800 }}
                    title="Set a custom merge commit message."
                  >
                    <input
                      type="checkbox"
                      checked={useMessage}
                      onChange={(e) => {
                        const next = e.target.checked;
                        setUseMessage(next);
                        if (!next) setMessage("");
                      }}
                      disabled={busy}
                    />
                    Set merge message
                  </label>
                  {useMessage ? (
                    <div style={{ display: "grid", gap: 6 }}>
                      <div style={{ fontWeight: 800, opacity: 0.8 }}>Merge message (-m)</div>
                      <input
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        className="modalInput"
                        disabled={busy}
                        placeholder="(optional)"
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <div className="modalFooter" style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onMerge}
            disabled={busy || !activeRepoPath || !branchToMerge.trim() || currentBranchName.trim() === ""}
            title={!currentBranchName.trim() ? "Cannot merge into detached HEAD" : undefined}
          >
            {busy ? "Merging…" : "Merge"}
          </button>
        </div>
      </div>
    </div>
  );
}
