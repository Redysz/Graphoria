import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { GitContinueInfo, GitStatusEntry } from "../../types/git";
import { parseUnifiedDiff } from "../../DiffView";
import { fileExtLower, isDocTextPreviewExt, isImageExt } from "../../utils/filePreview";
import { statusBadge } from "../../utils/text";
import { useAppSettings } from "../../appSettingsStore";
import {
  gitContinueInfo,
  gitContinueFileDiff,
  gitContinueRenameDiff,
  gitMergeContinueWithMessage,
  gitRebaseContinueWithMessage,
  gitStagePaths,
  gitStatus,
  gitUnstagePaths,
} from "../../api/git";
import {
  gitHeadVsWorkingTextDiff,
  gitWorkingFileContent,
  gitWorkingFileDiffUnified,
  gitWorkingFileImageBase64,
  gitWorkingFileTextPreview,
} from "../../api/gitWorkingFiles";

type Props = {
  open: boolean;
  repoPath: string;
  operation: "merge" | "rebase";
  onClose: () => void;
  onSuccess: () => void | Promise<void>;
  onAbort?: () => void | Promise<void>;
  onResolveConflicts?: () => void;
};

function hasRealCommitMessage(message: string) {
  const lines = message.replace(/\r\n/g, "\n").split("\n");
  for (const l of lines) {
    const t = l.trim();
    if (!t) continue;
    if (t.startsWith("#")) continue;
    return true;
  }
  return false;
}

function extractConflictPathsFromMessage(message: string) {
  const lines = message.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inSection = false;
  for (const raw of lines) {
    const t = raw.trim();
    if (!inSection) {
      if (t === "# Conflicts:" || t === "#Conflicts:") {
        inSection = true;
      }
      continue;
    }

    if (!t.startsWith("#")) break;

    const rest = t.replace(/^#\s*/, "").trim();
    if (!rest) continue;
    if (rest.toLowerCase() === "conflicts:") continue;
    out.push(rest);
  }
  return out;
}

export function ContinueAfterConflictsModal({ open, repoPath, operation, onClose, onSuccess, onAbort, onResolveConflicts }: Props) {
  const layout = useAppSettings((s) => s.layout);
  const setLayout = useAppSettings((s) => s.setLayout);
  const layoutRef = useRef<HTMLDivElement | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [continueErrorRaw, setContinueErrorRaw] = useState("");
  const [continueErrorKind, setContinueErrorKind] = useState<"" | "next_commit_conflicts" | "error">("");

  const [info, setInfo] = useState<GitContinueInfo | null>(null);
  const [message, setMessage] = useState("");

  const [statusEntries, setStatusEntries] = useState<GitStatusEntry[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Record<string, boolean>>({});

  const [previewPath, setPreviewPath] = useState("");
  const [previewStatus, setPreviewStatus] = useState("");
  const [previewDiff, setPreviewDiff] = useState("");
  const [previewContent, setPreviewContent] = useState("");
  const [previewImageBase64, setPreviewImageBase64] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");

  const effectiveOp = (info?.operation?.trim() as "merge" | "rebase" | "") || operation;

  const conflictPathsSourceMessage = info?.message ?? message;

  const derivedEntries = useMemo(() => {
    const real = statusEntries;
    const realSet = new Set(real.map((e) => e.path));
    for (const e of real) {
      const oldp = (e as any).old_path as string | undefined | null;
      if (oldp && oldp.trim()) realSet.add(oldp);
    }
    const paths = extractConflictPathsFromMessage(conflictPathsSourceMessage);
    const uniq = Array.from(new Set(paths)).filter((p) => p.trim().length > 0);
    const virtual = uniq.filter((p) => !realSet.has(p)).map((p) => ({ status: "NC", path: p } as GitStatusEntry));
    return [...real, ...virtual];
  }, [conflictPathsSourceMessage, statusEntries]);

  const hasVirtualEntries = useMemo(() => {
    return derivedEntries.some((e) => (e.status ?? "") === "NC");
  }, [derivedEntries, statusEntries.length]);

  useEffect(() => {
    if (!open) return;
    let alive = true;

    setBusy(false);
    setError("");
    setContinueErrorRaw("");
    setContinueErrorKind("");
    setInfo(null);
    setMessage("");
    setStatusEntries([]);
    setSelectedPaths({});
    setPreviewPath("");
    setPreviewStatus("");
    setPreviewDiff("");
    setPreviewContent("");
    setPreviewImageBase64("");
    setPreviewError("");
    setPreviewLoading(false);

    const run = async () => {
      try {
        const st = await gitContinueInfo(repoPath);
        if (!alive) return;
        setInfo(st);
        setMessage(st.message ?? "");

        const entries = await gitStatus(repoPath);
        if (!alive) return;
        setStatusEntries(entries);
        const nextSelected: Record<string, boolean> = {};
        for (const e of entries) nextSelected[e.path] = true;
        setSelectedPaths(nextSelected);

        const first = entries[0];
        setPreviewPath(first?.path ?? "");
        setPreviewStatus(first?.status ?? "");
      } catch (e) {
        if (!alive) return;
        setError(typeof e === "string" ? e : JSON.stringify(e));
      }
    };

    void run();
    return () => {
      alive = false;
    };
  }, [open, repoPath]);

  useEffect(() => {
    if (!open) return;
    if (!previewPath.trim()) {
      setPreviewDiff("");
      setPreviewContent("");
      setPreviewImageBase64("");
      setPreviewError("");
      setPreviewLoading(false);
      return;
    }

    const st = previewStatus.trim();
    const stCompact = st.replace(/\s+/g, "");
    if (stCompact.includes("U")) {
      setPreviewDiff("");
      setPreviewContent("");
      setPreviewImageBase64("");
      setPreviewError("");
      setPreviewLoading(false);
      return;
    }

    let alive = true;
    setPreviewLoading(true);
    setPreviewError("");
    setPreviewDiff("");
    setPreviewContent("");
    setPreviewImageBase64("");

    const run = async () => {
      try {
        if (st === "NC") {
          const content = await gitWorkingFileContent({ repoPath, path: previewPath });
          if (!alive) return;
          setPreviewContent(content);
          return;
        }

        const statusEntry = statusEntries.find((e) => e.path === previewPath) as any;
        const oldPath = (statusEntry?.old_path as string | undefined | null) ?? null;

        const ext = fileExtLower(previewPath);
        if (isImageExt(ext)) {
          const b64 = await gitWorkingFileImageBase64({ repoPath, path: previewPath });
          if (!alive) return;
          setPreviewImageBase64(b64);
          return;
        }

        const idx = st[0] ?? " ";
        const isStaged = idx !== " " && idx !== "?";
        const isRename = (st.includes("R") || st.includes("C")) && !!(oldPath && oldPath.trim());

        if (isDocTextPreviewExt(ext)) {
          if (st.startsWith("??")) {
            const content = await gitWorkingFileTextPreview({ repoPath, path: previewPath });
            if (!alive) return;
            setPreviewContent(content);
            return;
          }
          const diff = isStaged
            ? isRename
              ? await gitContinueRenameDiff({ repoPath, oldPath: oldPath!, newPath: previewPath, unified: 3 })
              : await gitContinueFileDiff({ repoPath, path: previewPath, unified: 3 })
            : await gitHeadVsWorkingTextDiff({ repoPath, path: previewPath, unified: 3 });
          if (!alive) return;
          if (diff.trim()) {
            setPreviewDiff(diff);
            return;
          }
          const content = await gitWorkingFileTextPreview({ repoPath, path: previewPath });
          if (!alive) return;
          setPreviewContent(content);
          return;
        }

        if (st.startsWith("??")) {
          const content = await gitWorkingFileContent({ repoPath, path: previewPath });
          if (!alive) return;
          setPreviewContent(content);
          return;
        }

        const diff = isStaged
          ? isRename
            ? await gitContinueRenameDiff({ repoPath, oldPath: oldPath!, newPath: previewPath, unified: 20 })
            : await gitContinueFileDiff({ repoPath, path: previewPath, unified: 20 })
          : await gitWorkingFileDiffUnified({ repoPath, path: previewPath, unified: 20 });
        if (!alive) return;
        setPreviewDiff(diff);
      } catch (e) {
        if (!alive) return;
        setPreviewError(typeof e === "string" ? e : JSON.stringify(e));
      } finally {
        if (!alive) return;
        setPreviewLoading(false);
      }
    };

    void run();
    return () => {
      alive = false;
    };
  }, [open, repoPath, previewPath, previewStatus]);

  const unmergedPaths = useMemo(() => {
    const out: string[] = [];
    for (const e of statusEntries) {
      const s = (e.status ?? "").replace(/\s+/g, "");
      if (s.includes("U")) out.push(e.path);
    }
    return out;
  }, [statusEntries]);
  const hasUnmerged = useMemo(() => {
    return unmergedPaths.length > 0;
  }, [unmergedPaths]);

  const parsed = useMemo(() => {
    return previewDiff ? parseUnifiedDiff(previewDiff) : [];
  }, [previewDiff]);

  const canContinue = !busy && !hasUnmerged && hasRealCommitMessage(message);

  useEffect(() => {
    if (!open) return;
    if (statusEntries.length > 0) return;
    if (previewPath.trim()) return;
    if (!hasVirtualEntries) return;
    const first = derivedEntries[0];
    if (!first) return;
    setPreviewPath(first.path);
    setPreviewStatus(first.status);
  }, [derivedEntries, hasVirtualEntries, open, previewPath, statusEntries.length]);

  if (!open) return null;

  const showNextCommitConflictsNote = continueErrorKind === "next_commit_conflicts";
  const visibleError = error || (continueErrorKind === "error" ? continueErrorRaw : "");

  let rebaseProgressLabel = "";
  if (showNextCommitConflictsNote) {
    const m = continueErrorRaw.match(/Rebasing\s*\(\s*(\d+)\s*\/\s*(\d+)\s*\)/i);
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0) {
        rebaseProgressLabel = ` (${a} of ${b})`;
      }
    }
  }

  const preStyle = {
    margin: 0,
    padding: 10,
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--panel-2)",
    overflow: "auto",
    minHeight: 0,
    height: "100%",
  } as const;

  const previewBoxStyle = {
    display: "grid",
    gridTemplateRows: "auto 1fr",
    gap: 8,
    minHeight: 0,
    overflow: "hidden",
  } as const;

  const gridStyle = {
    display: "grid",
    gridTemplateColumns: `${layout.statusFilesWidthPx}px 6px 1fr`,
    gap: 12,
    alignItems: "stretch",
    minHeight: 0,
    height: "100%",
  } as const;

  function startFilesResize(e: ReactMouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = layout.statusFilesWidthPx;

    const containerW = layoutRef.current?.getBoundingClientRect().width ?? window.innerWidth;

    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onMove = (ev: MouseEvent) => {
      const min = 320;
      const minRight = 420;
      const max = Math.max(min, Math.round(containerW - 6 - minRight));
      const next = Math.max(min, Math.min(max, Math.round(startW + (ev.clientX - startX))));
      setLayout({ statusFilesWidthPx: next });
    };

    const onUp = () => {
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ width: "min(1180px, 96vw)", height: "min(86vh, 880px)", maxHeight: "min(86vh, 880px)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>Continue {effectiveOp}</div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            title={busy ? "Operation in progress" : "Close"}
          >
            Close
          </button>
        </div>

        <div className="modalBody" style={{ padding: 12, display: "grid", gap: 12, minHeight: 0, overflow: "hidden" }}>
          {visibleError ? <div className="error">{visibleError}</div> : null}
          {hasUnmerged ? (
            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: "10px 12px",
                background: showNextCommitConflictsNote ? "rgba(255, 180, 0, 0.14)" : "var(--panel-2)",
                borderColor: showNextCommitConflictsNote ? "rgba(255, 180, 0, 0.35)" : "var(--border)",
                display: "grid",
                gap: 6,
              }}
            >
              <div style={{ fontWeight: 900, opacity: 0.9 }}>
                {showNextCommitConflictsNote
                  ? `Unresolved conflicts detected in the next commit${rebaseProgressLabel}`
                  : "Unresolved conflicts detected"}
              </div>
              <div style={{ opacity: 0.8, fontSize: 12 }}>
                {showNextCommitConflictsNote
                  ? "👏 Great job — during a rebase it's normal to resolve conflicts commit by commit. New conflicts were detected in the next commit. Please resolve them in the files below, stage (check) the result, and continue."
                  : "You still have unmerged files. Resolve conflicts and stage the result, then continue."}
              </div>
              {unmergedPaths.length ? (
                <div style={{ opacity: 0.75, fontSize: 12 }}>
                  {unmergedPaths.slice(0, 6).join(", ")}
                  {unmergedPaths.length > 6 ? "…" : ""}
                </div>
              ) : null}
              {onResolveConflicts ? (
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      setError("");
                      setContinueErrorRaw("");
                      setContinueErrorKind("");
                      onResolveConflicts();
                    }}
                    disabled={busy}
                  >
                    Resolve conflicts
                  </button>
                </div>
              ) : null}

              {showNextCommitConflictsNote ? (
                <details style={{ marginTop: 4 }}>
                  <summary style={{ cursor: "pointer", opacity: 0.75, fontSize: 12 }}>Details</summary>
                  <pre className="diffCode" style={{ ...preStyle, marginTop: 8, maxHeight: 220 }}>
                    {continueErrorRaw.replace(/\r\n/g, "\n")}
                  </pre>
                </details>
              ) : null}
            </div>
          ) : null}

          <div ref={layoutRef} style={gridStyle}>
            <div style={{ display: "grid", gap: 10, minHeight: 0, minWidth: 0 }}>
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ opacity: 0.8 }}>
                  Operation: <span className="mono">{effectiveOp}</span>
                </div>
                <textarea
                  className="modalTextarea"
                  rows={7}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Commit message"
                  disabled={busy}
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 2 }}>
                <div style={{ fontWeight: 800, opacity: 0.8 }}>Files</div>
                <button
                  type="button"
                  onClick={() => {
                    if (derivedEntries.length === 0) return;
                    let allSelected = true;
                    for (const e of derivedEntries) {
                      if ((e.status ?? "") === "NC") continue;
                      if (!selectedPaths[e.path]) {
                        allSelected = false;
                        break;
                      }
                    }
                    const next: Record<string, boolean> = {};
                    for (const e of derivedEntries) {
                      if ((e.status ?? "") === "NC") continue;
                      next[e.path] = !allSelected;
                    }
                    setSelectedPaths(next);
                  }}
                  disabled={busy || derivedEntries.length === 0}
                >
                  Toggle all
                </button>
              </div>

              {derivedEntries.length === 0 ? (
                <div style={{ opacity: 0.7, marginTop: 8 }}>No changes detected.</div>
              ) : (
                <div className="statusList" style={{ minHeight: 0, overflow: "auto" }}>
                  {derivedEntries.map((e) => (
                    <div
                      key={e.path}
                      className="statusRow"
                      onClick={() => {
                        setPreviewPath(e.path);
                        setPreviewStatus(e.status);
                      }}
                      style={
                        e.path === previewPath
                          ? { background: "rgba(47, 111, 237, 0.12)", borderColor: "rgba(47, 111, 237, 0.35)" }
                          : undefined
                      }
                    >
                      <input
                        type="checkbox"
                        checked={(e.status ?? "") === "NC" ? true : !!selectedPaths[e.path]}
                        onClick={(ev) => ev.stopPropagation()}
                        onChange={(ev) => {
                          if ((e.status ?? "") === "NC") return;
                          const checked = ev.target.checked;
                          setSelectedPaths((prev) => ({ ...prev, [e.path]: checked }));
                        }}
                        disabled={busy || (e.status ?? "") === "NC"}
                      />
                      <span className="statusCode" title={e.status}>
                        {statusBadge(e.status)}
                      </span>
                      <span className="statusPath">
                        {(e as any).old_path ? (
                          <>
                            {(e as any).old_path}
                            <span style={{ opacity: 0.55, margin: "0 6px" }}>→</span>
                            {e.path}
                          </>
                        ) : (
                          e.path
                        )}
                        {(e.status ?? "") === "NC" ? (
                          <span style={{ opacity: 0.65, marginLeft: 8, fontSize: 12 }}>conflict fixed, no changes</span>
                        ) : null}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="splitterV" onMouseDown={startFilesResize} title="Drag to resize files list" />

            <div style={previewBoxStyle}>
              <div style={{ fontWeight: 800, opacity: 0.8 }}>Preview</div>
              {previewError ? <div className="error">{previewError}</div> : null}
              {previewLoading ? <div style={{ opacity: 0.7 }}>Loading…</div> : null}

              {!previewLoading && !previewError ? (
                (() => {
                  const s = (previewStatus ?? "").replace(/\s+/g, "");
                  if (s.includes("U")) {
                    return <div style={{ opacity: 0.75 }}>Preview is available after resolving conflicts and staging the result.</div>;
                  }
                  return previewImageBase64 ? (
                    <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", minHeight: 0 }}>
                      <img
                        src={`data:image/*;base64,${previewImageBase64}`}
                        style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                      />
                    </div>
                  ) : previewDiff ? (
                    <pre className="diffCode" style={preStyle}>
                      {parsed.map((l, i) => (
                        <div key={i} className={`diffLine diffLine-${l.kind}`}>
                          {l.text}
                        </div>
                      ))}
                    </pre>
                  ) : previewContent ? (
                    <pre className="diffCode" style={preStyle}>
                      {previewContent.replace(/\r\n/g, "\n")}
                    </pre>
                  ) : previewPath ? (
                    <div style={{ opacity: 0.75 }}>No preview available for this file.</div>
                  ) : (
                    <div style={{ opacity: 0.75 }}>Select a file.</div>
                  );
                })()
              ) : null}
            </div>
          </div>
        </div>

        <div className="modalFooter" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            disabled={!canContinue}
            onClick={() => {
              if (!repoPath) return;
              if (hasUnmerged) {
                setError("You still have unresolved/unmerged files. Resolve and stage them, then continue.");
                setContinueErrorRaw("");
                setContinueErrorKind("");
                return;
              }
              setBusy(true);
              setError("");
              setContinueErrorRaw("");
              setContinueErrorKind("");
              const run = async () => {
                try {
                  const realEntries = statusEntries;
                  const selected = realEntries
                    .filter((e) => selectedPaths[e.path])
                    .filter((e) => {
                      const st = (e.status ?? "").trimEnd();
                      if (st.startsWith("??")) return false;
                      const idx = st[0] ?? " ";
                      return idx === " " || idx === "?";
                    })
                    .map((e) => e.path);

                  const toUnstage: string[] = [];
                  for (const e of realEntries) {
                    if (selectedPaths[e.path]) continue;
                    const st = (e.status ?? "").trim();
                    if (st.startsWith("??")) continue;
                    const idx = st[0] ?? " ";
                    if (idx !== " " && idx !== "?") {
                      toUnstage.push(e.path);
                    }
                  }

                  if (selected.length > 0) {
                    await gitStagePaths({ repoPath, paths: selected });
                  }
                  if (toUnstage.length > 0) {
                    await gitUnstagePaths({ repoPath, paths: toUnstage });
                  }

                  if (effectiveOp === "rebase") {
                    await gitRebaseContinueWithMessage({ repoPath, message });
                  } else {
                    await gitMergeContinueWithMessage({ repoPath, message });
                  }
                  await onSuccess();
                } catch (e) {
                  const raw = typeof e === "string" ? e : JSON.stringify(e);

                  let refreshedEntries: GitStatusEntry[] | null = null;
                  try {
                    const st = await gitContinueInfo(repoPath);
                    setInfo(st);
                    setMessage(st.message ?? "");
                  } catch {
                    // ignore
                  }
                  try {
                    const entries = await gitStatus(repoPath);
                    refreshedEntries = entries;
                    setStatusEntries(entries);
                    const nextSelected: Record<string, boolean> = {};
                    for (const ent of entries) nextSelected[ent.path] = true;
                    setSelectedPaths(nextSelected);
                  } catch {
                    // ignore
                  }

                  const hasUnmergedAfter = (() => {
                    if (!refreshedEntries) return false;
                    for (const ent of refreshedEntries) {
                      const s = (ent.status ?? "").replace(/\s+/g, "");
                      if (s.includes("U")) return true;
                    }
                    return false;
                  })();

                  if (effectiveOp === "rebase" && hasUnmergedAfter) {
                    setContinueErrorKind("next_commit_conflicts");
                    setContinueErrorRaw(raw);
                  } else {
                    setContinueErrorKind("error");
                    setContinueErrorRaw(raw);
                  }
                } finally {
                  setBusy(false);
                }
              };
              void run();
            }}
          >
            {busy ? "Continuing…" : "Continue"}
          </button>

          <button
            type="button"
            onClick={() => {
              if (!onAbort) return;
              setBusy(true);
              setError("");
              void (async () => {
                try {
                  await onAbort();
                } catch (e) {
                  setError(typeof e === "string" ? e : JSON.stringify(e));
                } finally {
                  setBusy(false);
                }
              })();
            }}
            disabled={busy || !onAbort}
            title={!onAbort ? "Abort is not available here" : "Abort the operation"}
          >
            Abort
          </button>
        </div>
      </div>
    </div>
  );
}
