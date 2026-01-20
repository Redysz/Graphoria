import type { Dispatch, SetStateAction } from "react";
import type { GitStatusEntry } from "../../types/git";
import { parseUnifiedDiff } from "../../DiffView";
import { fileExtLower, imageMimeFromExt } from "../../utils/filePreview";
import { statusBadge } from "../../utils/text";

type HunkRange = {
  index: number;
  header: string;
  start: number;
  end: number;
};

type Props = {
  activeRepoPath: string;

  diffToolName: string;

  busy: boolean;
  error: string;

  message: string;
  setMessage: (v: string) => void;

  advancedMode: boolean;
  onToggleAdvanced: (next: boolean) => void | Promise<void>;

  statusEntries: GitStatusEntry[];
  selectedPaths: Record<string, boolean>;
  setSelectedPaths: Dispatch<SetStateAction<Record<string, boolean>>>;

  previewPath: string;
  setPreviewPath: (v: string) => void;
  setPreviewStatus: (v: string) => void;

  hunkRanges: HunkRange[];
  hunksByPath: Record<string, number[]>;
  setHunksByPath: Dispatch<SetStateAction<Record<string, number[]>>>;

  previewLoading: boolean;
  previewError: string;
  previewImageBase64: string;
  previewDiff: string;
  previewContent: string;

  joinPath: (base: string, child: string) => string;
  onCopyText: (text: string) => void;
  onRevealInExplorer: (absPath: string) => void;

  onOpenWorkingFileContextMenu: (path: string, status: string, x: number, y: number) => void;
  onDiscard: (path: string, status: string) => void;
  onDelete: (path: string) => void;

  onClose: () => void;
  onStash: () => void;
};

export function StashModal({
  activeRepoPath,
  diffToolName,
  busy,
  error,
  message,
  setMessage,
  advancedMode,
  onToggleAdvanced,
  statusEntries,
  selectedPaths,
  setSelectedPaths,
  previewPath,
  setPreviewPath,
  setPreviewStatus,
  hunkRanges,
  hunksByPath,
  setHunksByPath,
  previewLoading,
  previewError,
  previewImageBase64,
  previewDiff,
  previewContent,
  joinPath,
  onCopyText,
  onRevealInExplorer,
  onOpenWorkingFileContextMenu,
  onDiscard,
  onDelete,
  onClose,
  onStash,
}: Props) {
  const stashDisabled =
    busy ||
    (advancedMode
      ? !previewPath || (hunksByPath[previewPath]?.length ?? 0) === 0
      : statusEntries.filter((e) => selectedPaths[e.path]).length === 0);

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ width: "min(1200px, 96vw)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>Stash</div>
          <button type="button" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>
        <div className="modalBody">
          {error ? <div className="error">{error}</div> : null}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 2fr) minmax(0, 3fr)",
              gap: 12,
              alignItems: "stretch",
              minHeight: 0,
              height: "100%",
            }}
          >
            <div style={{ display: "grid", gap: 10, minHeight: 0, minWidth: 0 }}>
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontWeight: 800, opacity: 0.8 }}>Message</div>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={3}
                  className="modalTextarea"
                  placeholder="Stash message (optional)"
                  disabled={busy}
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 2 }}>
                <div style={{ fontWeight: 800, opacity: 0.8 }}>Files</div>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.85 }}>
                    <input
                      type="checkbox"
                      checked={advancedMode}
                      onChange={(e) => void onToggleAdvanced(e.target.checked)}
                      disabled={busy}
                    />
                    Advanced
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const next: Record<string, boolean> = {};
                      for (const e of statusEntries) next[e.path] = true;
                      setSelectedPaths(next);
                    }}
                    disabled={busy || statusEntries.length === 0}
                  >
                    Select all
                  </button>
                </div>
              </div>

              {statusEntries.length === 0 ? (
                <div style={{ opacity: 0.7, marginTop: 8 }}>No changes to stash.</div>
              ) : (
                <div className="statusList">
                  {statusEntries.map((e) => (
                    <div
                      key={e.path}
                      className="statusRow"
                      onClick={() => {
                        setPreviewPath(e.path);
                        setPreviewStatus(e.status);
                      }}
                      onContextMenu={(ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                        setPreviewPath(e.path);
                        setPreviewStatus(e.status);
                        onOpenWorkingFileContextMenu(e.path, e.status, ev.clientX, ev.clientY);
                      }}
                      style={
                        e.path === previewPath
                          ? { background: "rgba(47, 111, 237, 0.12)", borderColor: "rgba(47, 111, 237, 0.35)" }
                          : undefined
                      }
                    >
                      <input
                        type="checkbox"
                        checked={!!selectedPaths[e.path]}
                        onClick={(ev) => ev.stopPropagation()}
                        onChange={(ev) => setSelectedPaths((prev) => ({ ...prev, [e.path]: ev.target.checked }))}
                        disabled={busy}
                      />
                      <span className="statusCode" title={e.status}>
                        {statusBadge(e.status)}
                      </span>
                      <span className="statusPath">{e.path}</span>
                      <span className="statusActions">
                        <button
                          type="button"
                          className="statusActionBtn"
                          title="Reset file / Discard changes"
                          disabled={!activeRepoPath || busy}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            onDiscard(e.path, e.status);
                          }}
                        >
                          R
                        </button>
                        <button
                          type="button"
                          className="statusActionBtn"
                          title="Delete file"
                          disabled={!activeRepoPath || busy}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            onDelete(e.path);
                          }}
                        >
                          D
                        </button>
                        <button
                          type="button"
                          className="statusActionBtn"
                          title="Copy path (absolute)"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            if (!activeRepoPath) return;
                            const sep = activeRepoPath.includes("\\") ? "\\" : "/";
                            const abs = joinPath(activeRepoPath, e.path.replace(/[\\/]/g, sep));
                            onCopyText(abs);
                          }}
                        >
                          C
                        </button>
                        <button
                          type="button"
                          className="statusActionBtn"
                          title="Reveal in File Explorer"
                          disabled={!activeRepoPath || busy}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            if (!activeRepoPath) return;
                            const sep = activeRepoPath.includes("\\") ? "\\" : "/";
                            const abs = joinPath(activeRepoPath, e.path.replace(/[\\/]/g, sep));
                            onRevealInExplorer(abs);
                          }}
                        >
                          E
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0, minWidth: 0, overflow: "hidden" }}>
              <div style={{ fontWeight: 800, opacity: 0.8 }}>Preview</div>
              {advancedMode ? (
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ opacity: 0.75, fontSize: 12 }}>Select hunks for the currently selected file, then stash selected hunks.</div>
                  {hunkRanges.length > 0 ? (
                    <div className="statusList" style={{ maxHeight: 160, overflow: "auto" }}>
                      {hunkRanges.map((r) => {
                        const sel = new Set(hunksByPath[previewPath] ?? []);
                        const checked = sel.has(r.index);
                        return (
                          <label key={r.index} className="statusRow hunkRow" style={{ cursor: "pointer" }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(ev) => {
                                const next = ev.target.checked;
                                setHunksByPath((prev) => {
                                  const cur = new Set(prev[previewPath] ?? []);
                                  if (next) cur.add(r.index);
                                  else cur.delete(r.index);
                                  return { ...prev, [previewPath]: Array.from(cur.values()).sort((a, b) => a - b) };
                                });
                              }}
                              disabled={busy || !previewPath}
                            />
                            <span className="hunkHeader">{r.header}</span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ opacity: 0.75, fontSize: 12 }}>No hunks detected for this file.</div>
                  )}
                </div>
              ) : (
                <div style={{ opacity: 0.75, fontSize: 12 }}>Green: added, red: removed. Yellow/blue: detected moved lines.</div>
              )}

              {previewError ? <div className="error">{previewError}</div> : null}
              {previewLoading ? <div style={{ opacity: 0.7 }}>Loading…</div> : null}

              {!previewLoading && !previewError ? (
                diffToolName !== "Graphoria builtin diff" ? (
                  <div style={{ opacity: 0.75 }}>Opened in external diff tool.</div>
                ) : previewImageBase64 ? (
                  <div
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      overflow: "hidden",
                      flex: 1,
                      minHeight: 0,
                      minWidth: 0,
                      display: "grid",
                    }}
                  >
                    <img
                      src={`data:${imageMimeFromExt(fileExtLower(previewPath))};base64,${previewImageBase64}`}
                      style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                    />
                  </div>
                ) : previewDiff ? (
                  <pre
                    className="diffCode"
                    style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "auto", border: "1px solid var(--border)", borderRadius: 12 }}
                  >
                    {parseUnifiedDiff(previewDiff).map((l, i) => (
                      <div key={i} className={`diffLine diffLine-${l.kind}`}>
                        {l.text}
                      </div>
                    ))}
                  </pre>
                ) : previewContent ? (
                  <pre
                    className="diffCode"
                    style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "auto", border: "1px solid var(--border)", borderRadius: 12 }}
                  >
                    {previewContent.replace(/\r\n/g, "\n")}
                  </pre>
                ) : (
                  <div style={{ opacity: 0.75 }}>Select a file.</div>
                )
              ) : null}
            </div>
          </div>
        </div>
        <div className="modalFooter">
          <button type="button" onClick={onStash} disabled={stashDisabled}>
            {busy ? "Stashing…" : "Stash"}
          </button>
        </div>
      </div>
    </div>
  );
}
