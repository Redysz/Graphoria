import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  GitStatusEntry,
  InteractiveRebaseCommitInfo,
  InteractiveRebaseTodoEntry,
  InteractiveRebaseResult,
} from "../../types/git";
import {
  gitInteractiveRebaseCommits,
  gitInteractiveRebaseStart,
  gitInteractiveRebaseAmend,
  gitInteractiveRebaseContinue,
  gitRebaseAbort,
  gitStatus,
  gitStagePaths,
  gitUnstagePaths,
} from "../../api/git";

type RebaseAction = "pick" | "reword" | "edit" | "squash" | "fixup" | "drop";

const ACTION_LABELS: Record<RebaseAction, string> = {
  pick: "Pick",
  reword: "Reword",
  edit: "Edit",
  squash: "Squash",
  fixup: "Fixup",
  drop: "Drop",
};

const ACTION_DESCRIPTIONS: Record<RebaseAction, string> = {
  pick: "Use commit as-is",
  reword: "Change commit message / author",
  edit: "Stop to amend files, message, or author",
  squash: "Fold into preceding non-squash/fixup commit (discard this message)",
  fixup: "Fold into preceding non-squash/fixup commit (discard this message)",
  drop: "Remove this commit entirely",
};

const ACTION_COLORS: Record<RebaseAction, string> = {
  pick: "rgba(76, 175, 80, 0.75)",
  reword: "rgba(33, 150, 243, 0.75)",
  edit: "rgba(255, 152, 0, 0.75)",
  squash: "rgba(156, 39, 176, 0.75)",
  fixup: "rgba(121, 85, 72, 0.75)",
  drop: "rgba(244, 67, 54, 0.75)",
};

type TodoRow = {
  id: string;
  commit: InteractiveRebaseCommitInfo;
  action: RebaseAction;
  newMessage: string;
  newAuthorName: string;
  newAuthorEmail: string;
  expanded: boolean;
};

type Phase = "planning" | "running" | "edit_stop" | "conflicts" | "completed" | "error";

type Props = {
  open: boolean;
  repoPath: string;
  selectedHash?: string;
  onClose: () => void;
  onComplete: () => void | Promise<void>;
  onConflicts: (files: string[], operation: "rebase") => void;
};

export function InteractiveRebaseModal({
  open,
  repoPath,
  selectedHash,
  onClose,
  onComplete,
  onConflicts,
}: Props) {
  const [phase, setPhase] = useState<Phase>("planning");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Planning state
  const [baseRef, setBaseRef] = useState("");
  const [commits, setCommits] = useState<InteractiveRebaseCommitInfo[]>([]);
  const [todoRows, setTodoRows] = useState<TodoRow[]>([]);
  const [loadingCommits, setLoadingCommits] = useState(false);

  // Running/edit state
  const [result, setResult] = useState<InteractiveRebaseResult | null>(null);
  const [editMessage, setEditMessage] = useState("");
  const [editAuthorName, setEditAuthorName] = useState("");
  const [editAuthorEmail, setEditAuthorEmail] = useState("");
  const [editStatusEntries, setEditStatusEntries] = useState<GitStatusEntry[]>([]);
  const [editStatusLoading, setEditStatusLoading] = useState(false);

  // Drag state
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const listRef = useRef<HTMLDivElement>(null);

  const refreshEditStatus = useCallback(async () => {
    if (!repoPath) return;
    setEditStatusLoading(true);
    try {
      const entries = await gitStatus(repoPath);
      setEditStatusEntries(entries);
    } catch {
      setEditStatusEntries([]);
    } finally {
      setEditStatusLoading(false);
    }
  }, [repoPath]);

  const stageFile = useCallback(async (path: string) => {
    if (!repoPath) return;
    try {
      await gitStagePaths({ repoPath, paths: [path] });
      await refreshEditStatus();
    } catch { /* ignore */ }
  }, [repoPath, refreshEditStatus]);

  const unstageFile = useCallback(async (path: string) => {
    if (!repoPath) return;
    try {
      await gitUnstagePaths({ repoPath, paths: [path] });
      await refreshEditStatus();
    } catch { /* ignore */ }
  }, [repoPath, refreshEditStatus]);

  // Load commits on open or when baseRef changes
  const loadCommits = useCallback(async () => {
    if (!repoPath) return;
    setLoadingCommits(true);
    setError("");
    try {
      const base = baseRef.trim() || undefined;
      const res = await gitInteractiveRebaseCommits({ repoPath, base });
      setCommits(res);
      setTodoRows(
        res.map((c, i) => ({
          id: `${c.hash}_${i}`,
          commit: c,
          action: "pick" as RebaseAction,
          newMessage: c.subject,
          newAuthorName: c.author_name,
          newAuthorEmail: c.author_email,
          expanded: false,
        })),
      );
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setLoadingCommits(false);
    }
  }, [repoPath, baseRef]);

  useEffect(() => {
    if (!open) return;
    // Set default base to selected hash if available, otherwise let backend determine
    if (selectedHash && !baseRef) {
      setBaseRef(selectedHash);
    }
    void loadCommits();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload when baseRef changes manually
  const handleBaseRefChange = useCallback(
    (val: string) => {
      setBaseRef(val);
    },
    [],
  );

  const handleLoadCommits = useCallback(() => {
    void loadCommits();
  }, [loadCommits]);

  // Row action change
  const setRowAction = useCallback((idx: number, action: RebaseAction) => {
    setTodoRows((prev) => {
      const next = [...prev];
      const row = { ...next[idx] };
      row.action = action;
      // If switching to reword, expand
      if (action === "reword") row.expanded = true;
      next[idx] = row;
      return next;
    });
  }, []);

  const setRowExpanded = useCallback((idx: number, expanded: boolean) => {
    setTodoRows((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], expanded };
      return next;
    });
  }, []);

  const setRowNewMessage = useCallback((idx: number, msg: string) => {
    setTodoRows((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], newMessage: msg };
      return next;
    });
  }, []);

  const setRowAuthorName = useCallback((idx: number, name: string) => {
    setTodoRows((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], newAuthorName: name };
      return next;
    });
  }, []);

  const setRowAuthorEmail = useCallback((idx: number, email: string) => {
    setTodoRows((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], newAuthorEmail: email };
      return next;
    });
  }, []);

  // Drag & drop
  const handleDragStart = useCallback((idx: number) => {
    setDragIdx(idx);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIdx(idx);
  }, []);

  const handleDrop = useCallback(
    (dropIdx: number) => {
      if (dragIdx === null || dragIdx === dropIdx) {
        setDragIdx(null);
        setDragOverIdx(null);
        return;
      }
      setTodoRows((prev) => {
        const next = [...prev];
        const [removed] = next.splice(dragIdx, 1);
        next.splice(dropIdx, 0, removed);
        return next;
      });
      setDragIdx(null);
      setDragOverIdx(null);
    },
    [dragIdx],
  );

  const handleDragEnd = useCallback(() => {
    setDragIdx(null);
    setDragOverIdx(null);
  }, []);

  // Move row up/down
  const moveRow = useCallback((idx: number, direction: -1 | 1) => {
    setTodoRows((prev) => {
      const newIdx = idx + direction;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      return next;
    });
  }, []);

  // Set all to pick
  const resetAllToPick = useCallback(() => {
    setTodoRows((prev) =>
      prev.map((r) => ({ ...r, action: "pick" as RebaseAction, expanded: false })),
    );
  }, []);

  // Start rebase
  const startRebase = useCallback(async () => {
    if (!repoPath || todoRows.length === 0) return;
    setBusy(true);
    setError("");
    setPhase("running");

    try {
      const base = baseRef.trim();
      if (!base) {
        setError("Please specify a base commit/ref.");
        setPhase("planning");
        setBusy(false);
        return;
      }

      // Validate: first non-drop commit cannot be squash/fixup
      const firstNonDrop = todoRows.find((r) => r.action !== "drop");
      if (firstNonDrop && (firstNonDrop.action === "squash" || firstNonDrop.action === "fixup")) {
        setError("The first commit cannot be squash or fixup — there is no preceding commit to fold into.");
        setPhase("planning");
        setBusy(false);
        return;
      }

      const entries: InteractiveRebaseTodoEntry[] = todoRows.map((row) => {
        const msgChanged = row.newMessage !== row.commit.subject;
        const origAuthor = `${row.commit.author_name} <${row.commit.author_email}>`;
        const newAuthor = `${row.newAuthorName} <${row.newAuthorEmail}>`;
        const authorChanged = newAuthor !== origAuthor;

        // Auto-upgrade pick to reword if message or author was changed
        let effectiveAction = row.action;
        if (effectiveAction === "pick" && (msgChanged || authorChanged)) {
          effectiveAction = "reword";
        }

        const entry: InteractiveRebaseTodoEntry = {
          action: effectiveAction,
          hash: row.commit.hash,
          short_hash: row.commit.short_hash,
          original_message: row.commit.subject,
        };

        if (effectiveAction === "reword" || effectiveAction === "edit") {
          if (msgChanged) {
            entry.new_message = row.newMessage;
          }
          if (authorChanged) {
            entry.new_author = newAuthor;
          }
        }

        return entry;
      });

      const res = await gitInteractiveRebaseStart({
        repoPath,
        base,
        todoEntries: entries,
      });

      setResult(res);
      handleRebaseResult(res);
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
      setPhase("error");
    } finally {
      setBusy(false);
    }
  }, [repoPath, baseRef, todoRows]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRebaseResult = useCallback(
    (res: InteractiveRebaseResult) => {
      switch (res.status) {
        case "completed":
          setPhase("completed");
          break;
        case "stopped_at_edit":
          setPhase("edit_stop");
          setEditMessage(res.stopped_commit_message ?? "");
          setEditAuthorName("");
          setEditAuthorEmail("");
          setEditStatusEntries([]);
          void refreshEditStatus();
          break;
        case "conflicts":
          setPhase("conflicts");
          onConflicts(res.conflict_files, "rebase");
          break;
        default:
          setPhase("error");
          setError(res.message);
          break;
      }
    },
    [onConflicts, refreshEditStatus],
  );

  // Amend and continue during edit stop
  const handleAmendAndContinue = useCallback(async () => {
    if (!repoPath) return;
    setBusy(true);
    setError("");
    try {
      const author =
        editAuthorName.trim() && editAuthorEmail.trim()
          ? `${editAuthorName.trim()} <${editAuthorEmail.trim()}>`
          : undefined;

      await gitInteractiveRebaseAmend({
        repoPath,
        message: editMessage.trim() || undefined,
        author,
      });

      const res = await gitInteractiveRebaseContinue(repoPath);
      setResult(res);
      handleRebaseResult(res);
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setBusy(false);
    }
  }, [repoPath, editMessage, editAuthorName, editAuthorEmail, handleRebaseResult]);

  // Skip (continue without amending)
  const handleSkipEdit = useCallback(async () => {
    if (!repoPath) return;
    setBusy(true);
    setError("");
    try {
      const res = await gitInteractiveRebaseContinue(repoPath);
      setResult(res);
      handleRebaseResult(res);
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setBusy(false);
    }
  }, [repoPath, handleRebaseResult]);

  // Abort
  const handleAbort = useCallback(async () => {
    if (!repoPath) return;
    setBusy(true);
    setError("");
    try {
      await gitRebaseAbort(repoPath);
      setPhase("planning");
      void loadCommits();
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setBusy(false);
    }
  }, [repoPath, loadCommits]);

  // Summary stats
  const stats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of todoRows) {
      counts[r.action] = (counts[r.action] || 0) + 1;
    }
    return counts;
  }, [todoRows]);

  const hasChanges = useMemo(() => {
    return todoRows.some(
      (r) =>
        r.action !== "pick" ||
        r.newMessage !== r.commit.subject ||
        r.newAuthorName !== r.commit.author_name ||
        r.newAuthorEmail !== r.commit.author_email,
    );
  }, [todoRows]);

  const isReordered = useMemo(() => {
    if (todoRows.length !== commits.length) return true;
    return todoRows.some((r, i) => r.commit.hash !== commits[i]?.hash);
  }, [todoRows, commits]);

  if (!open) return null;

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div
        className="modal"
        style={{
          width: "min(1000px, 96vw)",
          maxHeight: "min(88vh, 900px)",
        }}
      >
        {/* Header */}
        <div className="modalHeader">
          <div style={{ fontWeight: 900, display: "flex", alignItems: "center", gap: 10 }}>
            Interactive Rebase
            {phase === "running" ? <span className="miniSpinner" /> : null}
            {phase === "completed" ? (
              <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(76, 175, 80, 0.9)" }}>
                Completed
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => {
              if (phase === "completed") {
                void onComplete();
              }
              onClose();
            }}
            disabled={busy}
          >
            Close
          </button>
        </div>

        {/* Body */}
        <div className="modalBody" style={{ display: "grid", gap: 12 }}>
          {error ? (
            <div className="error" style={{ whiteSpace: "pre-wrap", maxHeight: 120, overflow: "auto" }}>
              {error}
            </div>
          ) : null}

          {/* ── PLANNING PHASE ────────────────────────────────────── */}
          {phase === "planning" ? (
            <>
              {/* Base ref input */}
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontWeight: 800, opacity: 0.8, fontSize: 13 }}>
                  Base commit / ref{" "}
                  <span style={{ fontWeight: 400, opacity: 0.6 }}>
                    (rebase commits after this point)
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    value={baseRef}
                    onChange={(e) => handleBaseRefChange(e.target.value)}
                    className="modalInput mono"
                    disabled={busy || loadingCommits}
                    placeholder="e.g. origin/main, HEAD~5, abc1234"
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    onClick={handleLoadCommits}
                    disabled={busy || loadingCommits || !baseRef.trim()}
                    title="Load commits from this base"
                  >
                    {loadingCommits ? <span className="miniSpinner" /> : "Load"}
                  </button>
                </div>
              </div>

              {/* Commit list */}
              {todoRows.length > 0 ? (
                <>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <div style={{ fontWeight: 800, opacity: 0.8, fontSize: 13 }}>
                      Commits ({todoRows.length})
                      {isReordered ? (
                        <span
                          style={{
                            marginLeft: 8,
                            fontSize: 11,
                            fontWeight: 600,
                            color: "rgba(255, 152, 0, 0.9)",
                          }}
                        >
                          reordered
                        </span>
                      ) : null}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        onClick={resetAllToPick}
                        disabled={busy}
                        style={{ fontSize: 11, padding: "3px 8px" }}
                        title="Reset all actions to Pick"
                      >
                        Reset all
                      </button>
                    </div>
                  </div>

                  {/* Stats bar */}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 11 }}>
                    {Object.entries(stats).map(([action, count]) => (
                      <span
                        key={action}
                        style={{
                          padding: "2px 8px",
                          borderRadius: 6,
                          background: ACTION_COLORS[action as RebaseAction] ?? "rgba(128,128,128,0.3)",
                          color: "#fff",
                          fontWeight: 700,
                        }}
                      >
                        {ACTION_LABELS[action as RebaseAction] ?? action}: {count}
                      </span>
                    ))}
                  </div>

                  {/* Scrollable commit list */}
                  <div
                    ref={listRef}
                    className="irRebaseList"
                    style={{
                      maxHeight: "min(50vh, 480px)",
                      overflowY: "auto",
                      border: "1px solid var(--border)",
                      borderRadius: 10,
                    }}
                  >
                    {todoRows.map((row, idx) => (
                      <div
                        key={row.id}
                        className={`irRebaseRow ${dragIdx === idx ? "irDragging" : ""} ${dragOverIdx === idx ? "irDragOver" : ""}`}
                        draggable
                        onDragStart={() => handleDragStart(idx)}
                        onDragOver={(e) => handleDragOver(e, idx)}
                        onDrop={() => handleDrop(idx)}
                        onDragEnd={handleDragEnd}
                        style={{
                          borderLeft: `4px solid ${ACTION_COLORS[row.action]}`,
                        }}
                      >
                        {/* Main row */}
                        <div className="irRebaseRowMain">
                          {/* Drag handle */}
                          <div
                            className="irDragHandle"
                            title="Drag to reorder"
                            style={{ cursor: "grab", opacity: 0.4, fontSize: 16, userSelect: "none" }}
                          >
                            ⠿
                          </div>

                          {/* Move buttons */}
                          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                            <button
                              type="button"
                              onClick={() => moveRow(idx, -1)}
                              disabled={idx === 0 || busy}
                              style={{ fontSize: 10, padding: "0 4px", lineHeight: "14px" }}
                              title="Move up"
                            >
                              ▲
                            </button>
                            <button
                              type="button"
                              onClick={() => moveRow(idx, 1)}
                              disabled={idx === todoRows.length - 1 || busy}
                              style={{ fontSize: 10, padding: "0 4px", lineHeight: "14px" }}
                              title="Move down"
                            >
                              ▼
                            </button>
                          </div>

                          {/* Action selector */}
                          <select
                            value={row.action}
                            onChange={(e) => setRowAction(idx, e.target.value as RebaseAction)}
                            disabled={busy}
                            className="irActionSelect"
                            style={{
                              background: ACTION_COLORS[row.action],
                              color: "#fff",
                              fontWeight: 700,
                              border: "none",
                              borderRadius: 6,
                              padding: "3px 6px",
                              fontSize: 12,
                              cursor: "pointer",
                              minWidth: 80,
                            }}
                            title={ACTION_DESCRIPTIONS[row.action]}
                          >
                            {(Object.keys(ACTION_LABELS) as RebaseAction[]).map((a) => (
                              <option
                                key={a}
                                value={a}
                                disabled={(a === "squash" || a === "fixup") && idx === 0}
                              >
                                {ACTION_LABELS[a]}
                              </option>
                            ))}
                          </select>

                          {/* Commit info */}
                          <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 2 }}>
                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                              <span
                                className="mono"
                                style={{ fontSize: 12, opacity: 0.6, flexShrink: 0 }}
                              >
                                {row.commit.short_hash}
                              </span>
                              <span
                                style={{
                                  fontSize: 13,
                                  fontWeight: 600,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {row.action === "reword" && row.newMessage !== row.commit.subject
                                  ? row.newMessage
                                  : row.commit.subject}
                              </span>
                              {row.commit.is_pushed ? (
                                <span
                                  style={{
                                    fontSize: 10,
                                    fontWeight: 700,
                                    color: "rgba(244, 67, 54, 0.8)",
                                    flexShrink: 0,
                                  }}
                                  title="This commit exists on a remote. Rewriting it may cause issues for collaborators."
                                >
                                  PUSHED
                                </span>
                              ) : null}
                            </div>
                            <div style={{ fontSize: 11, opacity: 0.55 }}>
                              {row.commit.author_name} &lt;{row.commit.author_email}&gt;
                              {(row.action === "squash" || row.action === "fixup") && idx > 0 ? (
                                <span style={{ marginLeft: 8, fontStyle: "italic", opacity: 0.7 }}>
                                  → folds into{" "}
                                  {(() => {
                                    for (let j = idx - 1; j >= 0; j--) {
                                      if (todoRows[j].action !== "squash" && todoRows[j].action !== "fixup" && todoRows[j].action !== "drop") {
                                        return todoRows[j].commit.short_hash;
                                      }
                                    }
                                    return "?";
                                  })()}
                                </span>
                              ) : null}
                            </div>
                          </div>

                          {/* Expand button */}
                          <button
                            type="button"
                            onClick={() => setRowExpanded(idx, !row.expanded)}
                            disabled={busy}
                            style={{ fontSize: 11, padding: "3px 8px", flexShrink: 0 }}
                            title={row.expanded ? "Collapse" : "Edit details"}
                          >
                            {row.expanded ? "▾" : "▸"}
                          </button>
                        </div>

                        {/* Expanded editing area */}
                        {row.expanded ? (
                          <div className="irRebaseRowExpanded">
                            <div style={{ display: "grid", gap: 8 }}>
                              <div style={{ display: "grid", gap: 4 }}>
                                <label style={{ fontSize: 12, fontWeight: 700, opacity: 0.7 }}>
                                  Commit message
                                </label>
                                <textarea
                                  value={row.newMessage}
                                  onChange={(e) => setRowNewMessage(idx, e.target.value)}
                                  disabled={busy}
                                  className="modalTextarea mono"
                                  rows={3}
                                  style={{ fontSize: 12 }}
                                />
                              </div>

                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                <div style={{ display: "grid", gap: 4 }}>
                                  <label style={{ fontSize: 12, fontWeight: 700, opacity: 0.7 }}>
                                    Author name
                                  </label>
                                  <input
                                    value={row.newAuthorName}
                                    onChange={(e) => setRowAuthorName(idx, e.target.value)}
                                    disabled={busy}
                                    className="modalInput"
                                    style={{ fontSize: 12 }}
                                  />
                                </div>
                                <div style={{ display: "grid", gap: 4 }}>
                                  <label style={{ fontSize: 12, fontWeight: 700, opacity: 0.7 }}>
                                    Author email
                                  </label>
                                  <input
                                    value={row.newAuthorEmail}
                                    onChange={(e) => setRowAuthorEmail(idx, e.target.value)}
                                    disabled={busy}
                                    className="modalInput"
                                    style={{ fontSize: 12 }}
                                  />
                                </div>
                              </div>

                              {row.newMessage !== row.commit.subject ||
                              row.newAuthorName !== row.commit.author_name ||
                              row.newAuthorEmail !== row.commit.author_email ? (
                                <div style={{ fontSize: 11, opacity: 0.6, fontStyle: "italic" }}>
                                  Modified from original
                                  {row.action === "pick" ? (
                                    <span>
                                      {" "}
                                      — action will be automatically upgraded to{" "}
                                      <strong>reword</strong>
                                    </span>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>

                  {/* Pushed commits warning */}
                  {todoRows.some((r) => r.commit.is_pushed && r.action !== "pick") ? (
                    <div
                      style={{
                        fontSize: 12,
                        padding: "8px 12px",
                        background: "rgba(244, 67, 54, 0.1)",
                        border: "1px solid rgba(244, 67, 54, 0.3)",
                        borderRadius: 8,
                        color: "rgba(244, 67, 54, 0.9)",
                        fontWeight: 600,
                      }}
                    >
                      Warning: Some commits marked for modification have already been pushed to a
                      remote. This will rewrite history and may cause issues for collaborators.
                    </div>
                  ) : null}
                </>
              ) : loadingCommits ? (
                <div style={{ textAlign: "center", padding: 20, opacity: 0.6 }}>
                  <span className="miniSpinner" style={{ marginRight: 8 }} />
                  Loading commits…
                </div>
              ) : (
                <div style={{ textAlign: "center", padding: 20, opacity: 0.6 }}>
                  Enter a base ref above and click Load to see commits.
                </div>
              )}
            </>
          ) : null}

          {/* ── EDIT STOP PHASE ────────────────────────────────── */}
          {phase === "edit_stop" ? (
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ fontWeight: 800, opacity: 0.8, fontSize: 14 }}>
                Rebase stopped for editing
              </div>
              {result?.current_step != null && result?.total_steps != null ? (
                <div style={{ fontSize: 12, opacity: 0.6 }}>
                  Step {result.current_step} of {result.total_steps}
                </div>
              ) : null}
              {result?.stopped_commit_hash ? (
                <div style={{ fontSize: 12, opacity: 0.6 }}>
                  Commit:{" "}
                  <span className="mono">{result.stopped_commit_hash.substring(0, 10)}</span>
                </div>
              ) : null}

              <div style={{ display: "grid", gap: 4 }}>
                <label style={{ fontSize: 12, fontWeight: 700, opacity: 0.7 }}>
                  Commit message
                </label>
                <textarea
                  value={editMessage}
                  onChange={(e) => setEditMessage(e.target.value)}
                  disabled={busy}
                  className="modalTextarea mono"
                  rows={5}
                  style={{ fontSize: 12 }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div style={{ display: "grid", gap: 4 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, opacity: 0.7 }}>
                    Author name{" "}
                    <span style={{ fontWeight: 400, opacity: 0.5 }}>(leave empty to keep)</span>
                  </label>
                  <input
                    value={editAuthorName}
                    onChange={(e) => setEditAuthorName(e.target.value)}
                    disabled={busy}
                    className="modalInput"
                    style={{ fontSize: 12 }}
                  />
                </div>
                <div style={{ display: "grid", gap: 4 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, opacity: 0.7 }}>
                    Author email{" "}
                    <span style={{ fontWeight: 400, opacity: 0.5 }}>(leave empty to keep)</span>
                  </label>
                  <input
                    value={editAuthorEmail}
                    onChange={(e) => setEditAuthorEmail(e.target.value)}
                    disabled={busy}
                    className="modalInput"
                    style={{ fontSize: 12 }}
                  />
                </div>
              </div>

              {/* Changed files list */}
              <div style={{ display: "grid", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, opacity: 0.7 }}>
                    Working tree changes
                  </label>
                  <button
                    type="button"
                    onClick={() => void refreshEditStatus()}
                    disabled={busy || editStatusLoading}
                    style={{ fontSize: 10, padding: "2px 6px" }}
                    title="Refresh file status"
                  >
                    {editStatusLoading ? <span className="miniSpinner" /> : "Refresh"}
                  </button>
                </div>
                {editStatusEntries.length > 0 ? (
                  <div
                    style={{
                      maxHeight: 160,
                      overflowY: "auto",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  >
                    {editStatusEntries.map((entry) => {
                      const st = (entry.status ?? "").trim();
                      const isStaged = st.length >= 2 && st[0] !== "?" && st[0] !== " ";
                      const isUnstaged = st.length >= 2 && (st[1] !== " " || st[0] === "?");
                      return (
                        <div
                          key={entry.path}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "4px 8px",
                            borderBottom: "1px solid var(--border)",
                          }}
                        >
                          <span
                            className="mono"
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              width: 22,
                              textAlign: "center",
                              color: st.startsWith("?") ? "rgba(255,152,0,0.8)" : "rgba(76,175,80,0.8)",
                              flexShrink: 0,
                            }}
                          >
                            {st}
                          </span>
                          <span
                            className="mono"
                            style={{
                              flex: 1,
                              minWidth: 0,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              fontSize: 11,
                            }}
                          >
                            {entry.path}
                          </span>
                          {isUnstaged && !isStaged ? (
                            <button
                              type="button"
                              onClick={() => void stageFile(entry.path)}
                              disabled={busy}
                              style={{ fontSize: 10, padding: "1px 6px", flexShrink: 0 }}
                              title="Stage this file"
                            >
                              Stage
                            </button>
                          ) : null}
                          {isStaged ? (
                            <button
                              type="button"
                              onClick={() => void unstageFile(entry.path)}
                              disabled={busy}
                              style={{ fontSize: 10, padding: "1px 6px", flexShrink: 0 }}
                              title="Unstage this file"
                            >
                              Unstage
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ fontSize: 11, opacity: 0.5, fontStyle: "italic" }}>
                    No changes detected. Modify files externally, then click Refresh.
                  </div>
                )}
              </div>

              <div style={{ fontSize: 12, opacity: 0.6 }}>
                Modify working tree files externally, stage them above, then click "Amend &amp;
                Continue". Or click "Skip" to continue without changes.
              </div>
            </div>
          ) : null}

          {/* ── CONFLICTS PHASE ───────────────────────────────── */}
          {phase === "conflicts" ? (
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ fontWeight: 800, opacity: 0.8, fontSize: 14, color: "rgba(244, 67, 54, 0.9)" }}>
                Rebase stopped due to conflicts
              </div>
              <div style={{ fontSize: 12, opacity: 0.6 }}>
                Resolve the conflicts using the conflict resolver, then return here to continue.
              </div>
              {(result?.conflict_files ?? []).length > 0 ? (
                <div style={{ fontSize: 12 }}>
                  <div style={{ fontWeight: 700, opacity: 0.7, marginBottom: 4 }}>Conflict files:</div>
                  {(result?.conflict_files ?? []).map((f) => (
                    <div key={f} className="mono" style={{ fontSize: 11, opacity: 0.7, padding: "2px 0" }}>
                      {f}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* ── COMPLETED PHASE ───────────────────────────────── */}
          {phase === "completed" ? (
            <div style={{ textAlign: "center", padding: 24 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: "rgba(76, 175, 80, 0.9)", marginBottom: 8 }}>
                Interactive rebase completed successfully
              </div>
              <div style={{ fontSize: 13, opacity: 0.6 }}>
                {result?.message || "All commits have been rebased."}
              </div>
            </div>
          ) : null}

          {/* ── RUNNING PHASE ─────────────────────────────────── */}
          {phase === "running" ? (
            <div style={{ textAlign: "center", padding: 24 }}>
              <span className="miniSpinner" style={{ marginRight: 8 }} />
              <span style={{ fontSize: 14, opacity: 0.7 }}>Rebase in progress…</span>
            </div>
          ) : null}

          {/* ── ERROR PHASE ───────────────────────────────────── */}
          {phase === "error" ? (
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ fontWeight: 800, opacity: 0.8, fontSize: 14, color: "rgba(244, 67, 54, 0.9)" }}>
                Rebase failed
              </div>
              <div style={{ fontSize: 13, opacity: 0.7 }}>{result?.message || error}</div>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="modalFooter" style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "flex", gap: 8 }}>
            {(phase === "edit_stop" || phase === "conflicts" || phase === "running" || phase === "error") ? (
              <button type="button" onClick={handleAbort} disabled={busy} title="Abort the rebase and restore the original state">
                Abort rebase
              </button>
            ) : null}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            {phase === "planning" ? (
              <button
                type="button"
                onClick={startRebase}
                disabled={busy || todoRows.length === 0 || !baseRef.trim() || (!hasChanges && !isReordered)}
                title={
                  !hasChanges && !isReordered
                    ? "No changes to apply. Modify at least one commit action, message, author, or reorder commits."
                    : "Start interactive rebase"
                }
              >
                Start rebase
              </button>
            ) : null}

            {phase === "edit_stop" ? (
              <>
                <button type="button" onClick={handleSkipEdit} disabled={busy} title="Continue without amending this commit">
                  Skip
                </button>
                <button type="button" onClick={handleAmendAndContinue} disabled={busy} title="Amend this commit and continue rebase">
                  Amend &amp; Continue
                </button>
              </>
            ) : null}

            {phase === "completed" ? (
              <button
                type="button"
                onClick={() => {
                  void onComplete();
                  onClose();
                }}
              >
                Done
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
