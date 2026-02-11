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
  gitInteractiveRebaseEditFiles,
  gitReadWorkingFile,
  gitWriteWorkingFile,
  gitRenameWorkingFile,
  gitDeleteWorkingFile,
  gitRestoreWorkingFile,
} from "../../api/git";
import type { EditStopFileEntry } from "../../api/git";

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
  squash: "Fold into the nearest older non-squash/fixup commit",
  fixup: "Fold into the nearest older non-squash/fixup commit (discard message)",
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
  const [originalOldestHash, setOriginalOldestHash] = useState("");
  const [allCommits, setAllCommits] = useState<InteractiveRebaseCommitInfo[]>([]);
  const [includePushed, setIncludePushed] = useState(false);

  // Confirmation dialog
  const [showConfirmation, setShowConfirmation] = useState(false);

  // Autocomplete for base ref
  const [showSuggestions, setShowSuggestions] = useState(false);
  const baseRefWrapperRef = useRef<HTMLDivElement>(null);

  // Running/edit state
  const [result, setResult] = useState<InteractiveRebaseResult | null>(null);
  const [editMessage, setEditMessage] = useState("");
  const [editAuthorName, setEditAuthorName] = useState("");
  const [editAuthorEmail, setEditAuthorEmail] = useState("");
  const [editStatusEntries, setEditStatusEntries] = useState<GitStatusEntry[]>([]);
  const [editStatusLoading, setEditStatusLoading] = useState(false);

  // Edit-stop file management
  const [commitFiles, setCommitFiles] = useState<EditStopFileEntry[]>([]);
  const [commitFilesLoading, setCommitFilesLoading] = useState(false);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [fileContentLoading, setFileContentLoading] = useState(false);
  const [fileContentDirty, setFileContentDirty] = useState(false);
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Drag state (pointer events, like QuickButtonsModal)
  const [drag, setDrag] = useState<{ idx: number; pointerId: number } | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [hoverPos, setHoverPos] = useState<"before" | "after">("before");

  // Custom dropdown state
  const [openDropdown, setOpenDropdown] = useState<number | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (openDropdown === null) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener("pointerdown", handler, true);
    return () => document.removeEventListener("pointerdown", handler, true);
  }, [openDropdown]);

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

  // Load files changed in the stopped commit
  const loadCommitFiles = useCallback(async () => {
    if (!repoPath) return;
    setCommitFilesLoading(true);
    try {
      const files = await gitInteractiveRebaseEditFiles(repoPath);
      setCommitFiles(files);
    } catch {
      setCommitFiles([]);
    } finally {
      setCommitFilesLoading(false);
    }
  }, [repoPath]);

  // Open file in inline editor
  const openFileEditor = useCallback(async (path: string) => {
    if (!repoPath) return;
    if (expandedFile === path) {
      setExpandedFile(null);
      return;
    }
    setFileContentLoading(true);
    setExpandedFile(path);
    setFileContentDirty(false);
    try {
      const content = await gitReadWorkingFile({ repoPath, path });
      setFileContent(content);
    } catch (e) {
      setFileContent(`/* Error reading file: ${typeof e === "string" ? e : JSON.stringify(e)} */`);
    } finally {
      setFileContentLoading(false);
    }
  }, [repoPath, expandedFile]);

  // Save file content
  const saveFileContent = useCallback(async (path: string) => {
    if (!repoPath) return;
    try {
      await gitWriteWorkingFile({ repoPath, path, content: fileContent });
      await gitStagePaths({ repoPath, paths: [path] });
      setFileContentDirty(false);
      await refreshEditStatus();
    } catch { /* ignore */ }
  }, [repoPath, fileContent, refreshEditStatus]);

  // Discard file changes (restore from HEAD)
  const restoreFile = useCallback(async (path: string) => {
    if (!repoPath) return;
    try {
      await gitRestoreWorkingFile({ repoPath, path });
      await refreshEditStatus();
      // Reload content if expanded
      if (expandedFile === path) {
        const content = await gitReadWorkingFile({ repoPath, path });
        setFileContent(content);
        setFileContentDirty(false);
      }
    } catch { /* ignore */ }
  }, [repoPath, expandedFile, refreshEditStatus]);

  // Delete file
  const deleteFile = useCallback(async (path: string) => {
    if (!repoPath) return;
    try {
      await gitDeleteWorkingFile({ repoPath, path });
      if (expandedFile === path) setExpandedFile(null);
      await refreshEditStatus();
      await loadCommitFiles();
    } catch { /* ignore */ }
  }, [repoPath, expandedFile, refreshEditStatus, loadCommitFiles]);

  // Rename file
  const renameFile = useCallback(async (oldPath: string, newPath: string) => {
    if (!repoPath || !newPath.trim() || newPath === oldPath) return;
    try {
      await gitRenameWorkingFile({ repoPath, oldPath, newPath: newPath.trim() });
      setRenamingFile(null);
      if (expandedFile === oldPath) setExpandedFile(newPath.trim());
      await refreshEditStatus();
      await loadCommitFiles();
    } catch { /* ignore */ }
  }, [repoPath, expandedFile, refreshEditStatus, loadCommitFiles]);

  // Build todoRows from a commit list (newest-first)
  const buildTodoRows = useCallback((newestFirst: InteractiveRebaseCommitInfo[]) => {
    // Find oldest commit (last in newest-first list) for base computation
    if (newestFirst.length > 0) {
      setOriginalOldestHash(newestFirst[newestFirst.length - 1].hash);
    }
    setCommits(newestFirst);
    setTodoRows(
      newestFirst.map((c, i) => ({
        id: `${c.hash}_${i}`,
        commit: c,
        action: "pick" as RebaseAction,
        newMessage: c.subject,
        newAuthorName: c.author_name,
        newAuthorEmail: c.author_email,
        expanded: false,
      })),
    );
  }, []);

  // Load commits on open or when baseRef changes
  const loadCommits = useCallback(async () => {
    if (!repoPath) return;
    setLoadingCommits(true);
    setError("");
    try {
      const base = baseRef.trim() || undefined;
      const res = await gitInteractiveRebaseCommits({ repoPath, base });
      // Display newest-first (reverse backend's oldest-first order)
      const reversed = [...res].reverse();
      setAllCommits(reversed);
      // Apply pushed filter
      const filtered = includePushed ? reversed : reversed.filter((c) => !c.is_pushed);
      buildTodoRows(filtered.length > 0 ? filtered : reversed);
      // If all are pushed, show all anyway (nothing to filter)
      if (!includePushed && filtered.length === 0 && reversed.length > 0) {
        setIncludePushed(true);
      }
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setLoadingCommits(false);
    }
  }, [repoPath, baseRef, includePushed, buildTodoRows]);

  // Toggle pushed commits visibility
  const toggleIncludePushed = useCallback(() => {
    setIncludePushed((prev) => {
      const next = !prev;
      const filtered = next ? allCommits : allCommits.filter((c) => !c.is_pushed);
      buildTodoRows(filtered.length > 0 ? filtered : allCommits);
      return next;
    });
  }, [allCommits, buildTodoRows]);

  useEffect(() => {
    if (!open) return;
    // Reset state when modal opens
    setPhase("planning");
    setError("");
    setResult(null);
    setShowConfirmation(false);
    setCommitFiles([]);
    setExpandedFile(null);
    setFileContentDirty(false);
    setEditStatusEntries([]);
    // Set default base to selected hash if available, otherwise let backend determine
    if (selectedHash) {
      setBaseRef(selectedHash);
    } else {
      setBaseRef("");
    }
    void loadCommits();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Autocomplete suggestions for base ref input
  const baseRefSuggestions = useMemo(() => {
    const q = baseRef.trim().toLowerCase();
    if (q.length < 3 || allCommits.length === 0) return [];
    return allCommits.filter(
      (c) =>
        c.hash.toLowerCase().startsWith(q) ||
        c.short_hash.toLowerCase().startsWith(q) ||
        c.subject.toLowerCase().includes(q),
    ).slice(0, 12);
  }, [baseRef, allCommits]);

  // Close suggestions on outside click
  useEffect(() => {
    if (!showSuggestions) return;
    const handler = (e: MouseEvent) => {
      if (baseRefWrapperRef.current && !baseRefWrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("pointerdown", handler, true);
    return () => document.removeEventListener("pointerdown", handler, true);
  }, [showSuggestions]);

  // Reload when baseRef changes manually
  const handleBaseRefChange = useCallback(
    (val: string) => {
      setBaseRef(val);
      if (val.trim().length >= 3) setShowSuggestions(true);
      else setShowSuggestions(false);
    },
    [],
  );

  const handleSelectSuggestion = useCallback((hash: string) => {
    setBaseRef(hash);
    setShowSuggestions(false);
  }, []);

  const handleLoadCommits = useCallback(() => {
    setShowSuggestions(false);
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

      // When squash is selected, auto-expand the target commit and pre-fill
      // with the combined commit messages (like standard git squash behaviour).
      if (action === "squash") {
        // Find target: nearest older non-squash/fixup/drop (below in display)
        let targetIdx = -1;
        for (let j = idx + 1; j < next.length; j++) {
          const a = next[j].action;
          if (a !== "squash" && a !== "fixup" && a !== "drop") {
            targetIdx = j;
            break;
          }
        }
        if (targetIdx >= 0) {
          const target = next[targetIdx];
          // Only pre-fill if target's message hasn't been manually edited
          if (target.newMessage === target.commit.subject) {
            // Collect messages: target (oldest) first, then squash commits
            // oldest-to-newest (= reverse display order from targetIdx-1 down to 0)
            const msgs: string[] = [target.commit.subject];
            for (let j = targetIdx - 1; j >= 0; j--) {
              const a = next[j].action;
              if (a === "squash") {
                msgs.push(next[j].commit.subject);
              } else if (a === "fixup" || a === "drop") {
                // fixup discards message; drop is omitted — skip
              } else {
                break; // reached a different group
              }
            }
            next[targetIdx] = {
              ...next[targetIdx],
              expanded: true,
              newMessage: msgs.join("\n\n"),
            };
          }
        }
      }

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

  // Drag & drop (pointer events)
  const clearDrag = useCallback(() => {
    setDrag(null);
    setHoverIdx(null);
  }, []);

  const onPointerDownRow = useCallback(
    (e: React.PointerEvent, idx: number) => {
      if (e.button !== 0) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t?.closest("button") || t?.closest("select") || t?.closest("input") || t?.closest("textarea") || t?.closest(".irActionDropdown")) return;
      const el = e.currentTarget as HTMLElement;
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      setDrag({ idx, pointerId: e.pointerId });
      setHoverIdx(idx);
      setHoverPos("before");
      e.preventDefault();
    },
    [],
  );

  const onPointerMoveRow = useCallback(
    (e: React.PointerEvent) => {
      if (!drag) return;
      if (e.pointerId !== drag.pointerId) return;
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      if (!el) { setHoverIdx(null); return; }
      const listEl = el.closest("[data-ir-list]") as HTMLElement | null;
      if (!listEl) { setHoverIdx(null); return; }
      const items = Array.from(listEl.querySelectorAll("[data-ir-idx]")) as HTMLElement[];
      for (const it of items) {
        const raw = it.getAttribute("data-ir-idx");
        if (raw === null) continue;
        const i = parseInt(raw, 10);
        if (isNaN(i)) continue;
        const r = it.getBoundingClientRect();
        const mid = r.top + r.height / 2;
        if (e.clientY < mid) {
          setHoverIdx(i);
          setHoverPos("before");
          e.preventDefault();
          return;
        }
      }
      // Past last item
      setHoverIdx(items.length > 0 ? parseInt(items[items.length - 1].getAttribute("data-ir-idx") ?? "0", 10) : null);
      setHoverPos("after");
      e.preventDefault();
    },
    [drag],
  );

  const onPointerUpRow = useCallback(
    (e: React.PointerEvent) => {
      if (!drag) return;
      if (e.pointerId !== drag.pointerId) return;
      const fromIdx = drag.idx;
      const toIdx = hoverIdx;
      clearDrag();
      if (toIdx === null || fromIdx === toIdx) return;
      setTodoRows((prev) => {
        const next = [...prev];
        const [removed] = next.splice(fromIdx, 1);
        let insertAt = toIdx;
        if (hoverPos === "after") insertAt += 1;
        if (fromIdx < insertAt) insertAt -= 1;
        next.splice(Math.max(0, Math.min(next.length, insertAt)), 0, removed);
        return next;
      });
    },
    [drag, hoverIdx, hoverPos, clearDrag],
  );

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

  // Confirmation warnings
  const pushedCount = useMemo(() => todoRows.filter((r) => r.commit.is_pushed).length, [todoRows]);
  const hiddenPushedCount = useMemo(() => {
    if (includePushed) return 0;
    return allCommits.filter((c) => c.is_pushed).length;
  }, [allCommits, includePushed]);

  const confirmationWarnings = useMemo(() => {
    const warnings: string[] = [];
    if (todoRows.length > 5) {
      warnings.push(
        `You are about to perform ${todoRows.length} interactive rebase steps. Consider limiting the number of commits using the "Base commit / ref" input field.`,
      );
    }
    if (pushedCount > 0) {
      warnings.push(
        `You are about to rebase ${pushedCount} commit${pushedCount > 1 ? "s" : ""} that ${pushedCount > 1 ? "have" : "has"} already been pushed. This will rewrite published history and may cause issues for collaborators.`,
      );
    }
    return warnings;
  }, [todoRows.length, pushedCount]);

  // Actually execute the rebase
  const executeRebase = useCallback(async () => {
    if (!repoPath || todoRows.length === 0) return;
    setShowConfirmation(false);
    setBusy(true);
    setError("");
    setPhase("running");

    try {
      // Determine effective base: user-specified or parent of oldest commit
      let base = baseRef.trim();
      if (!base) {
        const oldestHash = originalOldestHash || todoRows[todoRows.length - 1]?.commit.hash;
        if (oldestHash) {
          base = `${oldestHash}^`;
        } else {
          setError("Please specify a base commit/ref or load commits first.");
          setPhase("planning");
          setBusy(false);
          return;
        }
      }

      // Validate: the oldest non-drop commit (last in display, first in todo) cannot be squash/fixup
      const oldestNonDrop = [...todoRows].reverse().find((r) => r.action !== "drop");
      if (oldestNonDrop && (oldestNonDrop.action === "squash" || oldestNonDrop.action === "fixup")) {
        setError("The oldest commit cannot be squash or fixup — there is no preceding commit to fold into.");
        setPhase("planning");
        setBusy(false);
        return;
      }

      // Reverse todoRows back to oldest-first for the backend
      const orderedRows = [...todoRows].reverse();

      const entries: InteractiveRebaseTodoEntry[] = orderedRows.map((row) => {
        const msgChanged = row.newMessage !== row.commit.subject;
        const origAuthor = `${row.commit.author_name} <${row.commit.author_email}>`;
        const newAuthor = `${row.newAuthorName} <${row.newAuthorEmail}>`;
        const authorChanged = newAuthor !== origAuthor;

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
  }, [repoPath, baseRef, todoRows, originalOldestHash]); // eslint-disable-line react-hooks/exhaustive-deps

  // Start rebase — show confirmation if needed, otherwise execute directly
  const startRebase = useCallback(() => {
    if (confirmationWarnings.length > 0) {
      setShowConfirmation(true);
    } else {
      void executeRebase();
    }
  }, [confirmationWarnings, executeRebase]);

  const handleRebaseResult = useCallback(
    (res: InteractiveRebaseResult) => {
      switch (res.status) {
        case "completed":
          setPhase("completed");
          break;
        case "stopped_at_edit":
          setPhase("edit_stop");
          setEditMessage(res.stopped_commit_message ?? "");
          setEditAuthorName(res.stopped_commit_author_name ?? "");
          setEditAuthorEmail(res.stopped_commit_author_email ?? "");
          setEditStatusEntries([]);
          setExpandedFile(null);
          setFileContentDirty(false);
          void refreshEditStatus();
          void loadCommitFiles();
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
          minHeight: 420,
          maxHeight: "min(88vh, 900px)",
          position: "relative",
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
                  <div ref={baseRefWrapperRef} style={{ flex: 1, position: "relative" }}>
                    <input
                      value={baseRef}
                      onChange={(e) => handleBaseRefChange(e.target.value)}
                      onFocus={() => { if (baseRef.trim().length >= 3) setShowSuggestions(true); }}
                      className="modalInput mono"
                      disabled={busy || loadingCommits}
                      placeholder="e.g. origin/main, HEAD~5, abc1234, or commit message"
                      style={{ width: "100%" }}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setShowSuggestions(false);
                        if (e.key === "Enter") { setShowSuggestions(false); handleLoadCommits(); }
                      }}
                    />
                    {showSuggestions && baseRefSuggestions.length > 0 ? (
                      <div
                        style={{
                          position: "absolute",
                          top: "100%",
                          left: 0,
                          right: 0,
                          zIndex: 999,
                          marginTop: 2,
                          borderRadius: 8,
                          border: "1px solid var(--border)",
                          background: "var(--panel)",
                          boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
                          padding: "4px 0",
                          maxHeight: 240,
                          overflowY: "auto",
                        }}
                      >
                        {baseRefSuggestions.map((c) => (
                          <div
                            key={c.hash}
                            onClick={() => handleSelectSuggestion(c.hash)}
                            style={{
                              padding: "5px 10px",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              fontSize: 12,
                              color: "var(--fg)",
                              transition: "background 0.1s",
                            }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--accent-bg, rgba(47,111,237,0.08))"; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                          >
                            <span className="mono" style={{ opacity: 0.6, flexShrink: 0, fontSize: 11 }}>
                              {c.short_hash}
                            </span>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                              {c.subject}
                            </span>
                            {c.is_pushed ? (
                              <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(244,67,54,0.8)", flexShrink: 0 }}>
                                PUSHED
                              </span>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={handleLoadCommits}
                    disabled={busy || loadingCommits}
                    title={baseRef.trim() ? "Load commits from this base" : "Load all rebaseable commits"}
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
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {hiddenPushedCount > 0 ? (
                        <button
                          type="button"
                          onClick={toggleIncludePushed}
                          disabled={busy}
                          title="Show pushed commits in the list"
                        >
                          + {hiddenPushedCount} pushed
                        </button>
                      ) : null}
                      {includePushed && allCommits.some((c) => c.is_pushed) ? (
                        <button
                          type="button"
                          onClick={toggleIncludePushed}
                          disabled={busy}
                          title="Hide pushed commits from the list"
                        >
                          Hide pushed
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={resetAllToPick}
                        disabled={busy}
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
                    data-ir-list="commits"
                    className="irRebaseList"
                    style={{
                      maxHeight: todoRows.length > 5 ? "min(50vh, 480px)" : undefined,
                      overflowY: todoRows.length > 5 ? "auto" : "visible",
                      border: "1px solid var(--border)",
                      borderRadius: 10,
                    }}
                  >
                    {todoRows.map((row, idx) => {
                      const isDragging = drag?.idx === idx;
                      const isHoverTarget = hoverIdx === idx;
                      const insertionShadow =
                        isHoverTarget && drag
                          ? hoverPos === "before"
                            ? "0 2px 0 0 rgba(80, 160, 255, 0.95) inset"
                            : "0 -2px 0 0 rgba(80, 160, 255, 0.95) inset"
                          : undefined;
                      return (
                      <div
                        key={row.id}
                        data-ir-idx={idx}
                        className="irRebaseRow"
                        onPointerDown={(e) => onPointerDownRow(e, idx)}
                        onPointerMove={onPointerMoveRow}
                        onPointerUp={onPointerUpRow}
                        onPointerCancel={(e) => { if (drag && e.pointerId === drag.pointerId) clearDrag(); }}
                        onLostPointerCapture={() => { if (drag) clearDrag(); }}
                        style={{
                          borderLeft: `4px solid ${ACTION_COLORS[row.action]}`,
                          opacity: isDragging ? 0.4 : 1,
                          boxShadow: insertionShadow,
                          cursor: drag ? (isDragging ? "grabbing" : "grab") : undefined,
                          userSelect: drag ? "none" : undefined,
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

                          {/* Action selector (custom dropdown) */}
                          <div style={{ position: "relative" }} ref={openDropdown === idx ? dropdownRef : undefined}>
                            <button
                              type="button"
                              onClick={() => { if (!busy) setOpenDropdown(openDropdown === idx ? null : idx); }}
                              disabled={busy}
                              className="irActionSelect"
                              style={{
                                background: ACTION_COLORS[row.action],
                                color: "#fff",
                                fontWeight: 700,
                                border: "none",
                                borderRadius: 6,
                                padding: "3px 8px",
                                fontSize: 12,
                                cursor: "pointer",
                                minWidth: 80,
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                              }}
                              title={ACTION_DESCRIPTIONS[row.action]}
                            >
                              {ACTION_LABELS[row.action]}
                              <span style={{ fontSize: 9, opacity: 0.7 }}>▾</span>
                            </button>
                            {openDropdown === idx ? (
                              <div
                                className="irActionDropdown"
                                style={{
                                  position: "absolute",
                                  top: "100%",
                                  left: 0,
                                  zIndex: 999,
                                  minWidth: 260,
                                  whiteSpace: "nowrap",
                                  marginTop: 2,
                                  borderRadius: 8,
                                  border: "1px solid var(--border)",
                                  background: "var(--panel)",
                                  boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
                                  padding: "4px 0",
                                  overflow: "hidden",
                                }}
                              >
                                {(Object.keys(ACTION_LABELS) as RebaseAction[]).map((a) => {
                                  const disabled = (a === "squash" || a === "fixup") && idx === todoRows.length - 1;
                                  const selected = a === row.action;
                                  return (
                                    <div
                                      key={a}
                                      onClick={() => { if (!disabled) { setRowAction(idx, a); setOpenDropdown(null); } }}
                                      style={{
                                        padding: "5px 10px",
                                        cursor: disabled ? "not-allowed" : "pointer",
                                        opacity: disabled ? 0.35 : 1,
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 8,
                                        background: selected ? "var(--accent-bg, rgba(47,111,237,0.08))" : "transparent",
                                        fontWeight: selected ? 700 : 500,
                                        fontSize: 12,
                                        color: "var(--fg)",
                                        transition: "background 0.1s",
                                      }}
                                      onMouseEnter={(e) => { if (!disabled) (e.currentTarget as HTMLElement).style.background = "var(--accent-bg, rgba(47,111,237,0.08))"; }}
                                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = selected ? "var(--accent-bg, rgba(47,111,237,0.08))" : "transparent"; }}
                                    >
                                      <span
                                        style={{
                                          width: 10,
                                          height: 10,
                                          borderRadius: 3,
                                          background: ACTION_COLORS[a],
                                          flexShrink: 0,
                                        }}
                                      />
                                      <span style={{ fontWeight: 700 }}>{ACTION_LABELS[a]}</span>
                                      <span style={{ opacity: 0.5, fontSize: 11, flex: 1, textAlign: "right" }}>
                                        {ACTION_DESCRIPTIONS[a]}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>

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
                              {(row.action === "squash" || row.action === "fixup") && idx < todoRows.length - 1 ? (
                                <span style={{ marginLeft: 8, fontStyle: "italic", opacity: 0.7 }}>
                                  → folds into{" "}
                                  {(() => {
                                    for (let j = idx + 1; j < todoRows.length; j++) {
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
                      );
                    })}
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
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ fontWeight: 800, opacity: 0.8, fontSize: 14 }}>
                  Rebase stopped for editing
                </div>
                {result?.current_step != null && result?.total_steps != null ? (
                  <span style={{ fontSize: 12, opacity: 0.5 }}>
                    Step {result.current_step} of {result.total_steps}
                  </span>
                ) : null}
                {result?.stopped_commit_hash ? (
                  <span className="mono" style={{ fontSize: 11, opacity: 0.5 }}>
                    {result.stopped_commit_hash.substring(0, 10)}
                  </span>
                ) : null}
                {result?.stopped_commit_message ? (
                  <span style={{ fontSize: 11, opacity: 0.45, fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 300 }}>
                    {result.stopped_commit_message}
                  </span>
                ) : null}
              </div>

              <div style={{ display: "grid", gap: 4 }}>
                <label style={{ fontSize: 12, fontWeight: 700, opacity: 0.7 }}>
                  Commit message
                </label>
                <textarea
                  value={editMessage}
                  onChange={(e) => setEditMessage(e.target.value)}
                  disabled={busy}
                  className="modalTextarea mono"
                  rows={3}
                  style={{ fontSize: 12 }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div style={{ display: "grid", gap: 4 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, opacity: 0.7 }}>Author name</label>
                  <input
                    value={editAuthorName}
                    onChange={(e) => setEditAuthorName(e.target.value)}
                    disabled={busy}
                    className="modalInput"
                    style={{ fontSize: 12 }}
                  />
                </div>
                <div style={{ display: "grid", gap: 4 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, opacity: 0.7 }}>Author email</label>
                  <input
                    value={editAuthorEmail}
                    onChange={(e) => setEditAuthorEmail(e.target.value)}
                    disabled={busy}
                    className="modalInput"
                    style={{ fontSize: 12 }}
                  />
                </div>
              </div>

              {/* Files in this commit */}
              <div style={{ display: "grid", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, opacity: 0.7 }}>
                    Files in this commit
                  </label>
                  {commitFilesLoading ? <span className="miniSpinner" /> : null}
                </div>
                {commitFiles.length > 0 ? (
                  <div
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  >
                    {commitFiles.map((cf) => {
                      const isExpanded = expandedFile === cf.path;
                      const isRenaming = renamingFile === cf.path;
                      const statusColor =
                        cf.status === "A" ? "rgba(76,175,80,0.8)" :
                        cf.status === "D" ? "rgba(244,67,54,0.8)" :
                        cf.status === "R" ? "rgba(33,150,243,0.8)" :
                        "rgba(255,152,0,0.8)";
                      return (
                        <div key={cf.path}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "5px 8px",
                              borderBottom: "1px solid var(--border)",
                            }}
                          >
                            <span
                              className="mono"
                              style={{ fontSize: 11, fontWeight: 700, width: 16, textAlign: "center", color: statusColor, flexShrink: 0 }}
                            >
                              {cf.status}
                            </span>
                            {isRenaming ? (
                              <input
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") void renameFile(cf.path, renameValue);
                                  if (e.key === "Escape") setRenamingFile(null);
                                }}
                                autoFocus
                                className="modalInput mono"
                                style={{ flex: 1, fontSize: 11, padding: "2px 6px" }}
                              />
                            ) : (
                              <span
                                className="mono"
                                style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, cursor: cf.status !== "D" ? "pointer" : undefined, textDecoration: cf.status !== "D" ? "underline dotted" : undefined }}
                                onClick={() => { if (cf.status !== "D") void openFileEditor(cf.path); }}
                                title={cf.status !== "D" ? "Click to edit this file" : "File was deleted"}
                              >
                                {cf.path}
                              </span>
                            )}
                            {cf.old_path ? (
                              <span style={{ fontSize: 10, opacity: 0.5, flexShrink: 0 }}>
                                ← {cf.old_path}
                              </span>
                            ) : null}
                            <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                              {cf.status !== "D" && !isRenaming ? (
                                <button
                                  type="button"
                                  onClick={() => void openFileEditor(cf.path)}
                                  disabled={busy}
                                  style={{ fontSize: 11, padding: "2px 8px" }}
                                  title="Edit file content"
                                >
                                  {isExpanded ? "Close" : "Edit"}
                                </button>
                              ) : null}
                              {isRenaming ? (
                                <>
                                  <button type="button" onClick={() => void renameFile(cf.path, renameValue)} disabled={busy} style={{ fontSize: 11, padding: "2px 8px" }}>OK</button>
                                  <button type="button" onClick={() => setRenamingFile(null)} style={{ fontSize: 11, padding: "2px 8px" }}>Cancel</button>
                                </>
                              ) : (
                                <>
                                  {cf.status !== "D" ? (
                                    <button
                                      type="button"
                                      onClick={() => { setRenamingFile(cf.path); setRenameValue(cf.path); }}
                                      disabled={busy}
                                      style={{ fontSize: 11, padding: "2px 8px" }}
                                      title="Rename this file"
                                    >
                                      Rename
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    onClick={() => void restoreFile(cf.path)}
                                    disabled={busy}
                                    style={{ fontSize: 11, padding: "2px 8px" }}
                                    title="Discard changes and restore from commit"
                                  >
                                    Discard
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void deleteFile(cf.path)}
                                    disabled={busy}
                                    style={{ fontSize: 11, padding: "2px 8px", color: "rgba(244,67,54,0.8)" }}
                                    title="Delete this file"
                                  >
                                    Delete
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                          {/* Inline editor */}
                          {isExpanded ? (
                            <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)", background: "var(--panel-2, rgba(0,0,0,0.02))" }}>
                              {fileContentLoading ? (
                                <div style={{ textAlign: "center", padding: 12, opacity: 0.5 }}><span className="miniSpinner" /></div>
                              ) : (
                                <>
                                  <textarea
                                    value={fileContent}
                                    onChange={(e) => { setFileContent(e.target.value); setFileContentDirty(true); }}
                                    disabled={busy}
                                    className="modalTextarea mono"
                                    rows={12}
                                    style={{ fontSize: 11, width: "100%", resize: "vertical" }}
                                  />
                                  <div style={{ display: "flex", gap: 6, marginTop: 4, justifyContent: "flex-end" }}>
                                    {fileContentDirty ? (
                                      <span style={{ fontSize: 10, opacity: 0.6, fontStyle: "italic", alignSelf: "center", marginRight: "auto" }}>
                                        Unsaved changes
                                      </span>
                                    ) : null}
                                    <button
                                      type="button"
                                      onClick={() => void saveFileContent(cf.path)}
                                      disabled={busy || !fileContentDirty}
                                      style={{ fontSize: 10, padding: "2px 8px" }}
                                      title="Save changes and stage the file"
                                    >
                                      Save &amp; Stage
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : !commitFilesLoading ? (
                  <div style={{ fontSize: 11, opacity: 0.5, fontStyle: "italic" }}>
                    No files changed in this commit.
                  </div>
                ) : null}
              </div>

              {/* Working tree changes (external modifications) */}
              <div style={{ display: "grid", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, opacity: 0.7 }}>
                    Working tree changes
                  </label>
                  <button
                    type="button"
                    onClick={() => { void refreshEditStatus(); void loadCommitFiles(); }}
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
                      maxHeight: 140,
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
                    No additional working tree changes. You can edit files above, or modify files externally and click Refresh.
                  </div>
                )}
              </div>

              <div style={{ fontSize: 11, opacity: 0.5 }}>
                Edit commit files above, or modify files externally and click Refresh. Click "Amend &amp; Continue" to apply changes, or "Skip" to continue without modifications.
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
                disabled={busy || todoRows.length === 0 || (!hasChanges && !isReordered)}
                title={
                  todoRows.length === 0
                    ? "Load commits first"
                    : !hasChanges && !isReordered
                      ? "No changes to apply. Modify at least one commit action, message, author, or reorder commits."
                      : `Start interactive rebase (${todoRows.length} commit${todoRows.length !== 1 ? "s" : ""})`
                }
              >
                Start rebase ({todoRows.length} commit{todoRows.length !== 1 ? "s" : ""})
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

      {/* Confirmation dialog overlay */}
      {showConfirmation ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            borderRadius: "inherit",
          }}
        >
          <div
            style={{
              background: "var(--panel, #fff)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: "20px 24px",
              maxWidth: 480,
              width: "90%",
              boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
              display: "grid",
              gap: 16,
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 15 }}>Confirm rebase</div>
            {confirmationWarnings.map((w, i) => (
              <div
                key={i}
                style={{
                  fontSize: 13,
                  padding: "10px 14px",
                  background: "rgba(255, 152, 0, 0.1)",
                  border: "1px solid rgba(255, 152, 0, 0.3)",
                  borderRadius: 8,
                  color: "var(--fg)",
                  lineHeight: 1.45,
                }}
              >
                ⚠ {w}
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
              <button type="button" onClick={() => setShowConfirmation(false)}>
                Back
              </button>
              <button
                type="button"
                onClick={() => void executeRebase()}
                style={{ fontWeight: 700 }}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
