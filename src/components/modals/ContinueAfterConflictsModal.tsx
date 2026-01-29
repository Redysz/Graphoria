import { useEffect, useMemo, useState } from "react";
import type { GitContinueFileEntry, GitContinueInfo } from "../../types/git";
import { parseUnifiedDiff } from "../../DiffView";
import { statusBadge } from "../../utils/text";
import {
  gitContinueFileDiff,
  gitContinueInfo,
  gitMergeContinueWithMessage,
  gitRebaseContinueWithMessage,
} from "../../api/git";

type Props = {
  open: boolean;
  repoPath: string;
  operation: "merge" | "rebase";
  onClose: () => void;
  onSuccess: () => void | Promise<void>;
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

export function ContinueAfterConflictsModal({ open, repoPath, operation, onClose, onSuccess, onResolveConflicts }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [info, setInfo] = useState<GitContinueInfo | null>(null);
  const [message, setMessage] = useState("");

  const [previewPath, setPreviewPath] = useState("");
  const [previewDiff, setPreviewDiff] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");

  const effectiveOp = (info?.operation?.trim() as "merge" | "rebase" | "") || operation;

  useEffect(() => {
    if (!open) return;
    let alive = true;

    setBusy(false);
    setError("");
    setInfo(null);
    setMessage("");
    setPreviewPath("");
    setPreviewDiff("");
    setPreviewError("");
    setPreviewLoading(false);

    const run = async () => {
      try {
        const st = await gitContinueInfo(repoPath);
        if (!alive) return;
        setInfo(st);
        setMessage(st.message ?? "");

        const first = st.files?.[0]?.path ?? "";
        setPreviewPath(first);
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
      setPreviewError("");
      setPreviewLoading(false);
      return;
    }

    const entry = (info?.files ?? []).find((f) => f.path === previewPath);
    const entryStatus = (entry?.status ?? "").replace(/\s+/g, "");
    if (entryStatus.includes("U")) {
      setPreviewDiff("");
      setPreviewError("");
      setPreviewLoading(false);
      return;
    }

    let alive = true;
    setPreviewLoading(true);
    setPreviewError("");

    const run = async () => {
      try {
        const diff = await gitContinueFileDiff({ repoPath, path: previewPath, unified: 20 });
        if (!alive) return;
        setPreviewDiff(diff ?? "");
      } catch (e) {
        if (!alive) return;
        setPreviewDiff("");
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
  }, [open, repoPath, previewPath, info]);

  const files: GitContinueFileEntry[] = info?.files ?? [];
  const unmergedPaths = useMemo(() => {
    const out: string[] = [];
    for (const f of files) {
      const s = (f.status ?? "").replace(/\s+/g, "");
      if (s.includes("U")) out.push(f.path);
    }
    return out;
  }, [files]);
  const hasUnmerged = useMemo(() => {
    return unmergedPaths.length > 0;
  }, [unmergedPaths]);

  const parsed = useMemo(() => {
    return previewDiff ? parseUnifiedDiff(previewDiff) : [];
  }, [previewDiff]);

  const canContinue = !busy && !hasUnmerged && hasRealCommitMessage(message);

  if (!open) return null;

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
          {error ? <div className="error">{error}</div> : null}
          {hasUnmerged ? (
            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: "10px 12px",
                background: "var(--panel-2)",
                display: "grid",
                gap: 6,
              }}
            >
              <div style={{ fontWeight: 900, opacity: 0.9 }}>Unresolved conflicts detected</div>
              <div style={{ opacity: 0.8, fontSize: 12 }}>
                You still have unmerged files. Resolve conflicts and stage the result, then continue.
              </div>
              {unmergedPaths.length ? (
                <div style={{ opacity: 0.75, fontSize: 12 }}>
                  {unmergedPaths.slice(0, 6).join(", ")}
                  {unmergedPaths.length > 6 ? "…" : ""}
                </div>
              ) : null}
              {onResolveConflicts ? (
                <div>
                  <button type="button" onClick={onResolveConflicts} disabled={busy}>
                    Resolve conflicts
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

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

          <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 12, minHeight: 0, overflow: "hidden" }}>
            <div style={{ minHeight: 0, display: "grid", gridTemplateRows: "auto 1fr", gap: 8 }}>
              <div style={{ fontWeight: 800, opacity: 0.8 }}>Staged changes</div>
              {files.length ? (
                <div className="statusList" style={{ minHeight: 0, overflow: "auto" }}>
                  {files.map((f) => {
                    const selected = f.path === previewPath;
                    return (
                      <div
                        key={f.path}
                        className="statusRow statusRowSingleCol"
                        onClick={() => setPreviewPath(f.path)}
                        title={f.path}
                        style={
                          selected
                            ? { background: "rgba(47, 111, 237, 0.12)", borderColor: "rgba(47, 111, 237, 0.35)" }
                            : undefined
                        }
                      >
                        <span className="statusCode" title={f.status}>
                          {statusBadge(f.status)}
                        </span>
                        <span className="statusPath">{f.path}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ opacity: 0.75 }}>No staged files detected.</div>
              )}
            </div>

            <div style={previewBoxStyle}>
              <div style={{ fontWeight: 800, opacity: 0.8 }}>Preview</div>
              {previewError ? <div className="error">{previewError}</div> : null}
              {previewLoading ? <div style={{ opacity: 0.7 }}>Loading…</div> : null}

              {!previewLoading && !previewError ? (
                (() => {
                  const entry = files.find((f) => f.path === previewPath);
                  const s = (entry?.status ?? "").replace(/\s+/g, "");
                  if (s.includes("U")) {
                    return <div style={{ opacity: 0.75 }}>Preview is available after resolving conflicts and staging the result.</div>;
                  }
                  return previewDiff ? (
                  <pre className="diffCode" style={preStyle}>
                    {parsed.map((l, i) => (
                      <div key={i} className={`diffLine diffLine-${l.kind}`}>
                        {l.text}
                      </div>
                    ))}
                  </pre>
                  ) : previewPath ? (
                    <div style={{ opacity: 0.75 }}>No diff available for this file.</div>
                  ) : (
                    <div style={{ opacity: 0.75 }}>Select a file.</div>
                  );
                })()
              ) : null}
            </div>
          </div>
        </div>

        <div className="modalFooter" style={{ justifyContent: "flex-end" }}>
          <button
            type="button"
            disabled={!canContinue}
            onClick={() => {
              if (!repoPath) return;
              if (hasUnmerged) {
                setError("You still have unresolved/unmerged files. Resolve and stage them, then continue.");
                return;
              }
              setBusy(true);
              setError("");
              const run = async () => {
                try {
                  if (effectiveOp === "rebase") {
                    await gitRebaseContinueWithMessage({ repoPath, message });
                  } else {
                    await gitMergeContinueWithMessage({ repoPath, message });
                  }
                  await onSuccess();
                } catch (e) {
                  setError(typeof e === "string" ? e : JSON.stringify(e));
                } finally {
                  setBusy(false);
                }
              };
              void run();
            }}
          >
            {busy ? "Continuing…" : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
