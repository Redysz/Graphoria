import { useEffect, useMemo, useRef, useState } from "react";
import { DiffEditor, Editor } from "@monaco-editor/react";
import type { GitConflictFileEntry } from "../../types/git";
import {
  gitConflictApply,
  gitConflictApplyAndStage,
  gitConflictFileVersions,
  gitConflictState,
} from "../../api/git";
import { useAppSettings } from "../../appSettingsStore";

type Props = {
  open: boolean;
  repoPath: string;
  operation: "merge" | "rebase";
  initialFiles?: string[];
  busy: boolean;
  onClose: () => void;
  onContinue: () => void;
  onAbort: () => void;
  onSkipRebase: () => void;
};

type Versions = {
  base: string;
  ours: string;
  theirs: string;
  working: string;
};

let conflictThemesDefined = false;

function normalizeNewlines(s: string) {
  return s.replace(/\r\n/g, "\n");
}

function listConflictBlocksFromText(text: string) {
  const lines = normalizeNewlines(text).split("\n");
  const blocks: Array<{ start: number; mid: number; end: number; oursText: string; theirsText: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const ln = i + 1;
    const t = lines[i] ?? "";
    if (!t.startsWith("<<<<<<<")) continue;

    let mid = -1;
    let end = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const tt = lines[j] ?? "";
      if (tt.startsWith("=======")) {
        mid = j + 1;
        continue;
      }
      if (tt.startsWith(">>>>>>>")) {
        end = j + 1;
        break;
      }
    }
    if (mid < 0 || end < 0) continue;

    const ours = lines.slice(ln, mid - 1).join("\n");
    const theirs = lines.slice(mid, end - 1).join("\n");
    blocks.push({ start: ln, mid, end, oursText: ours, theirsText: theirs });
    i = end - 1;
  }

  return blocks;
}

function applyConflictBlock(text: string, blockIndex: number, replacement: string) {
  const blocks = listConflictBlocksFromText(text);
  const blk = blocks[blockIndex];
  if (!blk) return text;

  const lines = normalizeNewlines(text).split("\n");
  const startIdx = blk.start - 1;
  const endIdx = blk.end - 1;
  const replacementLines = normalizeNewlines(replacement).split("\n");

  const next = [...lines.slice(0, startIdx), ...replacementLines, ...lines.slice(endIdx + 1)];
  return next.join("\n");
}

function buildVariantFromWorking(working: string, choice: "ours" | "theirs") {
  let out = working;
  while (true) {
    const blocks = listConflictBlocksFromText(out);
    if (blocks.length === 0) break;
    out = applyConflictBlock(out, 0, choice === "ours" ? blocks[0]?.oursText ?? "" : blocks[0]?.theirsText ?? "");
  }
  return out;
}

function formatConflictStatus(status: string) {
  const s = (status ?? "").trim();
  if (!s) return "U";
  if (s.includes("U")) return "U";
  return s[0] ?? "U";
}

function ensureConflictThemes(monaco: any) {
  if (conflictThemesDefined) return;
  conflictThemesDefined = true;

  monaco.editor.defineTheme("graphoria-conflict-light", {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "diffEditor.insertedLineBackground": "#fff6df",
      "diffEditor.insertedTextBackground": "#ffe7b3",
      "diffEditor.removedLineBackground": "#e6f6ea",
      "diffEditor.removedTextBackground": "#bfe9c9",
      "diffEditor.border": "#d9dfe9",
    },
  });

  monaco.editor.defineTheme("graphoria-conflict-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "diffEditor.insertedLineBackground": "#3a2f18",
      "diffEditor.insertedTextBackground": "#5a4014",
      "diffEditor.removedLineBackground": "#183020",
      "diffEditor.removedTextBackground": "#245a35",
      "diffEditor.border": "#2b3446",
    },
  });
}

function findConflictBlock(model: any, lineNumber: number) {
  const max = model.getLineCount();
  let start = -1;
  for (let ln = lineNumber; ln >= 1; ln--) {
    const t = model.getLineContent(ln);
    if (t.startsWith("<<<<<<<")) {
      start = ln;
      break;
    }
    if (t.startsWith(">>>>>>>")) {
      return null;
    }
  }
  if (start < 0) return null;

  let mid = -1;
  let end = -1;
  for (let ln = start + 1; ln <= max; ln++) {
    const t = model.getLineContent(ln);
    if (t.startsWith("=======")) {
      mid = ln;
      continue;
    }
    if (t.startsWith(">>>>>>>")) {
      end = ln;
      break;
    }
  }
  if (mid < 0 || end < 0) return null;
  return { start, mid, end };
}

function pickLanguageByPath(path: string) {
  const p = path.toLowerCase();
  if (p.endsWith(".ts") || p.endsWith(".tsx")) return "typescript";
  if (p.endsWith(".js") || p.endsWith(".jsx")) return "javascript";
  if (p.endsWith(".json")) return "json";
  if (p.endsWith(".css")) return "css";
  if (p.endsWith(".html") || p.endsWith(".htm")) return "html";
  if (p.endsWith(".md")) return "markdown";
  if (p.endsWith(".rs")) return "rust";
  if (p.endsWith(".py")) return "python";
  if (p.endsWith(".go")) return "go";
  if (p.endsWith(".java")) return "java";
  if (p.endsWith(".c") || p.endsWith(".h")) return "c";
  if (p.endsWith(".cpp") || p.endsWith(".hpp")) return "cpp";
  if (p.endsWith(".yml") || p.endsWith(".yaml")) return "yaml";
  return "plaintext";
}

export function ConflictResolverModal({ open, repoPath, operation, initialFiles, busy, onClose, onContinue, onAbort, onSkipRebase }: Props) {
  const theme = useAppSettings((s) => s.appearance.theme);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [files, setFiles] = useState<GitConflictFileEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>("");

  const [versions, setVersions] = useState<Versions | null>(null);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState("");

  const [editMode, setEditMode] = useState<"diff" | "result">("diff");
  const [resultDraft, setResultDraft] = useState<string>("");
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyError, setApplyError] = useState("");

  const [diffOurs, setDiffOurs] = useState<string>("");
  const [diffTheirs, setDiffTheirs] = useState<string>("");

  const initialWorkingByPathRef = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;

    let alive = true;
    setLoading(true);
    setError("");
    setFiles([]);
    setSelectedPath("");
    setVersions(null);
    setVersionsError("");
    setVersionsLoading(false);
    setApplyError("");
    setApplyBusy(false);
    setEditMode("diff");
    setResultDraft("");
    setDiffOurs("");
    setDiffTheirs("");

    initialWorkingByPathRef.current = {};

    void (async () => {
      try {
        const st = await gitConflictState(repoPath);
        if (!alive) return;

        let list = st.files ?? [];
        if (initialFiles && initialFiles.length > 0) {
          const wanted = new Set(initialFiles);
          const filtered = list.filter((f) => wanted.has(f.path));
          if (filtered.length > 0) list = filtered;
        }

        setFiles(list);
        if (list.length > 0) {
          setSelectedPath(list[0].path);
        }
      } catch (e) {
        if (!alive) return;
        setError(typeof e === "string" ? e : JSON.stringify(e));
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [open, repoPath, initialFiles]);

  useEffect(() => {
    if (!open) return;
    if (!selectedPath.trim()) {
      setVersions(null);
      setVersionsError("");
      setVersionsLoading(false);
      setResultDraft("");
      setDiffOurs("");
      setDiffTheirs("");
      return;
    }

    let alive = true;
    setVersions(null);
    setVersionsLoading(true);
    setVersionsError("");
    setApplyError("");
    setApplyBusy(false);

    void (async () => {
      try {
        const res = await gitConflictFileVersions({ repoPath, path: selectedPath });
        if (!alive) return;

        const next: Versions = {
          base: normalizeNewlines(res.base ?? ""),
          ours: normalizeNewlines(res.ours ?? ""),
          theirs: normalizeNewlines(res.theirs ?? ""),
          working: normalizeNewlines(res.working ?? ""),
        };

        setVersions(next);
        setResultDraft(next.working);
        setDiffOurs(buildVariantFromWorking(next.working, "ours"));
        setDiffTheirs(buildVariantFromWorking(next.working, "theirs"));

        if (!initialWorkingByPathRef.current[selectedPath]) {
          initialWorkingByPathRef.current[selectedPath] = next.working;
        }
      } catch (e) {
        if (!alive) return;
        setVersionsError(typeof e === "string" ? e : JSON.stringify(e));
      } finally {
        if (!alive) return;
        setVersionsLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [open, repoPath, selectedPath]);

  const monacoTheme = useMemo(() => {
    return theme === "dark" ? "graphoria-conflict-dark" : "graphoria-conflict-light";
  }, [theme]);

  const lang = useMemo(() => pickLanguageByPath(selectedPath), [selectedPath]);

  const resultDraftRef = useRef<string>("");
  useEffect(() => {
    resultDraftRef.current = resultDraft;
  }, [resultDraft]);

  const hasUnmergedFiles = useMemo(() => {
    for (const f of files) {
      const s = (f.status ?? "").replace(/\s+/g, "");
      if (s.includes("U")) return true;
    }
    return false;
  }, [files]);

  async function refreshStateKeepPath() {
    const st = await gitConflictState(repoPath);
    const list = st.files ?? [];
    setFiles(list);
    if (!selectedPath.trim() && list.length > 0) {
      setSelectedPath(list[0].path);
    }
  }

  async function reloadSelectedVersions() {
    const p = selectedPath.trim();
    if (!p) return;
    const res = await gitConflictFileVersions({ repoPath, path: p });
    const next: Versions = {
      base: normalizeNewlines(res.base ?? ""),
      ours: normalizeNewlines(res.ours ?? ""),
      theirs: normalizeNewlines(res.theirs ?? ""),
      working: normalizeNewlines(res.working ?? ""),
    };
    setVersions(next);
    setResultDraft(next.working);
    setDiffOurs(buildVariantFromWorking(next.working, "ours"));
    setDiffTheirs(buildVariantFromWorking(next.working, "theirs"));

    if (!initialWorkingByPathRef.current[p]) {
      initialWorkingByPathRef.current[p] = next.working;
    }
  }

  async function takeOurs() {
    if (!selectedPath.trim()) return;
    const current = resultDraftRef.current;
    const blocks = listConflictBlocksFromText(current);
    if (blocks.length === 0) {
      await applyAndStageContent(current);
      return;
    }

    let next = current;
    while (true) {
      const bs = listConflictBlocksFromText(next);
      if (bs.length === 0) break;
      next = applyConflictBlock(next, 0, bs[0]?.oursText ?? "");
    }
    setResultDraft(next);
    await applyAndStageContent(next);
  }

  async function applyAndStageContent(content: string) {
    if (!selectedPath.trim()) return;
    setApplyBusy(true);
    setApplyError("");
    try {
      await gitConflictApplyAndStage({ repoPath, path: selectedPath, content });
      await reloadSelectedVersions();
      await refreshStateKeepPath();
    } catch (e) {
      setApplyError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setApplyBusy(false);
    }
  }

  async function applyContent(content: string) {
    if (!selectedPath.trim()) return;
    setApplyBusy(true);
    setApplyError("");
    try {
      await gitConflictApply({ repoPath, path: selectedPath, content });
    } catch (e) {
      setApplyError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setApplyBusy(false);
    }
  }

  const selectedIsUnmerged = useMemo(() => {
    const p = selectedPath.trim();
    if (!p) return false;
    const f = files.find((x) => x.path === p);
    if (!f) return false;
    return (f.status ?? "").replace(/\s+/g, "").includes("U");
  }, [files, selectedPath]);

  async function resetCurrentFile() {
    const p = selectedPath.trim();
    if (!p) return;
    if (!selectedIsUnmerged) return;
    const initial = initialWorkingByPathRef.current[p];
    if (typeof initial !== "string") return;

    setResultDraft(initial);
    setDiffOurs(buildVariantFromWorking(initial, "ours"));
    setDiffTheirs(buildVariantFromWorking(initial, "theirs"));
    await applyContent(initial);
    await refreshStateKeepPath();
  }

  async function resetAllFiles() {
    setApplyBusy(true);
    setApplyError("");
    try {
      for (const f of files) {
        const s = (f.status ?? "").replace(/\s+/g, "");
        if (!s.includes("U")) continue;
        const initial = initialWorkingByPathRef.current[f.path];
        if (typeof initial !== "string") continue;
        await gitConflictApply({ repoPath, path: f.path, content: initial });
      }
      await refreshStateKeepPath();
      await reloadSelectedVersions();
    } catch (e) {
      setApplyError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setApplyBusy(false);
    }
  }

  async function takeTheirs() {
    if (!selectedPath.trim()) return;
    const current = resultDraftRef.current;
    const blocks = listConflictBlocksFromText(current);
    if (blocks.length === 0) {
      await applyAndStageContent(current);
      return;
    }

    let next = current;
    while (true) {
      const bs = listConflictBlocksFromText(next);
      if (bs.length === 0) break;
      next = applyConflictBlock(next, 0, bs[0]?.theirsText ?? "");
    }
    setResultDraft(next);
    await applyAndStageContent(next);
  }

  if (!open) return null;

  const disabled = loading || busy || applyBusy;
  const continueDisabled = disabled || hasUnmergedFiles;

  const displayFiles = useMemo(() => {
    const list = files.slice();
    const p = selectedPath.trim();
    if (p && !list.some((f) => f.path === p)) {
      list.unshift({ path: p, status: "", stages: [] });
    }
    return list;
  }, [files, selectedPath]);

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modal conflictResolverModal" style={{ width: "min(1320px, 96vw)", height: "min(92vh, 980px)", maxHeight: "min(92vh, 980px)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>Resolve conflicts</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              onClick={() => void resetAllFiles()}
              disabled={disabled || files.length === 0}
              title="Restore all conflict files to the state from when you started resolving"
            >
              Reset conflicts
            </button>
            <button
              type="button"
              onClick={() => void resetCurrentFile()}
              disabled={disabled || !selectedPath.trim() || !selectedIsUnmerged}
              title={!selectedIsUnmerged ? "Available only for files that are still unmerged" : "Restore this file to the initial conflict state"}
            >
              Reset file
            </button>
            <button type="button" onClick={onClose} disabled={disabled}>
              Close
            </button>
          </div>
        </div>

        <div className="modalBody" style={{ padding: 12, display: "grid", gridTemplateColumns: "340px 1fr", gap: 12, minHeight: 0, overflow: "hidden" }}>
          <div style={{ minHeight: 0, display: "grid", gridTemplateRows: "auto auto 1fr", gap: 10 }}>
            {error ? <div className="error">{error}</div> : null}

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ opacity: 0.8, fontWeight: 800 }}>
                Operation: <span className="mono">{operation}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  void refreshStateKeepPath();
                }}
                disabled={disabled}
                title="Refresh conflict state"
              >
                Refresh
              </button>
            </div>

            {loading ? <div className="diffEmpty">Loading…</div> : null}

            {!loading ? (
              displayFiles.length === 0 ? (
                <div className="diffEmpty">No conflicts detected.</div>
              ) : (
                <div className="diffFileList" style={{ padding: 0 }}>
                  {displayFiles.map((f) => (
                    <button
                      key={f.path}
                      type="button"
                      className={f.path === selectedPath ? "diffFile diffFileActive" : "diffFile"}
                      onClick={() => setSelectedPath(f.path)}
                      style={{ gridTemplateColumns: "78px 1fr" }}
                      title={f.path}
                    >
                      <span className="diffStatus">{formatConflictStatus(f.status)}</span>
                      <span className="diffPath">{f.path}</span>
                    </button>
                  ))}
                </div>
              )
            ) : null}
          </div>

          <div style={{ minHeight: 0, display: "grid", gridTemplateRows: "auto 1fr", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div className="segmented small" style={{ flex: "0 0 auto" }}>
                <button type="button" className={editMode === "diff" ? "active" : ""} onClick={() => setEditMode("diff")}>
                  Diff
                </button>
                <button type="button" className={editMode === "result" ? "active" : ""} onClick={() => setEditMode("result")}>
                  Result
                </button>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span className="conflictLegend conflictLegend-ours">ours</span>
                <span className="conflictLegend conflictLegend-theirs">theirs</span>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => void takeOurs()}
                  disabled={disabled || !selectedPath.trim()}
                  title="Take only our version for the whole file and stage it"
                >
                  Take ours
                </button>
                <button
                  type="button"
                  onClick={() => void takeTheirs()}
                  disabled={disabled || !selectedPath.trim()}
                  title="Take only their version for the whole file and stage it"
                >
                  Take theirs
                </button>
              </div>
            </div>

            {applyError ? <div className="error">{applyError}</div> : null}
            {versionsError ? <div className="error">{versionsError}</div> : null}

            <div style={{ minHeight: 0, border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
              {versionsLoading ? (
                <div className="diffEmpty">Loading…</div>
              ) : !versions ? (
                <div className="diffEmpty">Select a file.</div>
              ) : editMode === "diff" ? (
                <div style={{ height: "100%", display: "grid", gridTemplateRows: "auto 1fr", minHeight: 0 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, borderBottom: "1px solid var(--border)" }}>
                    <div style={{ padding: "6px 10px", fontWeight: 900, opacity: 0.75 }}>
                      <span className="conflictLegend conflictLegend-ours">ours</span>
                    </div>
                    <div style={{ padding: "6px 10px", fontWeight: 900, opacity: 0.75, textAlign: "right" }}>
                      <span className="conflictLegend conflictLegend-theirs">theirs</span>
                    </div>
                  </div>
                  {versions.ours.trim() && versions.theirs.trim() ? (
                    <DiffEditor
                      height="100%"
                      theme={monacoTheme}
                      language={lang}
                      original={diffOurs}
                      modified={diffTheirs}
                      beforeMount={(monaco) => {
                        ensureConflictThemes(monaco);
                      }}
                      onMount={(diffEditor, monaco) => {
                        ensureConflictThemes(monaco);

                        const originalEditor = diffEditor.getOriginalEditor();
                        const modifiedEditor = diffEditor.getModifiedEditor();

                        const origKey = originalEditor.createContextKey<boolean>("graphoriaConflictUseThisVersion", false);
                        const modKey = modifiedEditor.createContextKey<boolean>("graphoriaConflictUseThisVersion", false);

                        function findChangeIndex(isOriginal: boolean, lineNumber: number) {
                          const changes = diffEditor.getLineChanges() ?? [];
                          for (let idx = 0; idx < changes.length; idx++) {
                            const c = changes[idx];
                            if (isOriginal) {
                              const a = c.originalStartLineNumber;
                              const b = c.originalEndLineNumber;
                              if (a === 0 && b === 0) continue;
                              if (lineNumber >= a && lineNumber <= b) return idx;
                            } else {
                              const a = c.modifiedStartLineNumber;
                              const b = c.modifiedEndLineNumber;
                              if (a === 0 && b === 0) continue;
                              if (lineNumber >= a && lineNumber <= b) return idx;
                            }
                          }
                          return -1;
                        }

                        function normalizeComparable(s: string) {
                          return normalizeNewlines(s).replace(/\s+$/g, "").trim();
                        }

                        function getBlocksNow() {
                          return listConflictBlocksFromText(resultDraftRef.current);
                        }

                        function findConflictBlockIndexFromChange(isOriginal: boolean, changeIndex: number) {
                          const changes = diffEditor.getLineChanges() ?? [];
                          const c = changes[changeIndex];
                          if (!c) return -1;

                          const model = isOriginal ? originalEditor.getModel() : modifiedEditor.getModel();
                          if (!model) return -1;

                          const start = isOriginal ? c.originalStartLineNumber : c.modifiedStartLineNumber;
                          const end = isOriginal ? c.originalEndLineNumber : c.modifiedEndLineNumber;
                          if (!start || !end || start === 0 || end === 0) return -1;

                          const chunk = normalizeComparable(model.getValueInRange({
                            startLineNumber: start,
                            startColumn: 1,
                            endLineNumber: end,
                            endColumn: model.getLineMaxColumn(end),
                          }));
                          if (!chunk) return -1;

                          const blocksNow = getBlocksNow();
                          for (let i = 0; i < blocksNow.length; i++) {
                            const b = blocksNow[i];
                            const candidate = normalizeComparable(isOriginal ? b.oursText : b.theirsText);
                            if (!candidate) continue;
                            if (chunk === candidate) return i;
                          }

                          for (let i = 0; i < blocksNow.length; i++) {
                            const b = blocksNow[i];
                            const candidate = normalizeComparable(isOriginal ? b.oursText : b.theirsText);
                            if (!candidate) continue;
                            if (chunk.includes(candidate) || candidate.includes(chunk)) return i;
                          }

                          return -1;
                        }

                        function updateKeys() {
                          const op = originalEditor.getPosition();
                          const mp = modifiedEditor.getPosition();
                          const oChangeIdx = op ? findChangeIndex(true, op.lineNumber) : -1;
                          const mChangeIdx = mp ? findChangeIndex(false, mp.lineNumber) : -1;
                          const oBlkIdx = oChangeIdx >= 0 ? findConflictBlockIndexFromChange(true, oChangeIdx) : -1;
                          const mBlkIdx = mChangeIdx >= 0 ? findConflictBlockIndexFromChange(false, mChangeIdx) : -1;

                          origKey.set(oBlkIdx >= 0);
                          modKey.set(mBlkIdx >= 0);
                        }

                        updateKeys();
                        originalEditor.onDidChangeCursorPosition(updateKeys);
                        modifiedEditor.onDidChangeCursorPosition(updateKeys);
                        diffEditor.onDidUpdateDiff(updateKeys);

                        originalEditor.addAction({
                          id: "graphoria.conflict.useThisVersion.original",
                          label: "Use this version",
                          contextMenuGroupId: "navigation",
                          contextMenuOrder: 1.2,
                          precondition: "graphoriaConflictUseThisVersion",
                          run: async () => {
                            const pos = originalEditor.getPosition();
                            if (!pos) return;
                            const changeIdx = findChangeIndex(true, pos.lineNumber);
                            if (changeIdx < 0) return;
                            const blkIdx = findConflictBlockIndexFromChange(true, changeIdx);
                            if (blkIdx < 0) return;
                            const blocksNow = getBlocksNow();
                            const next = applyConflictBlock(resultDraftRef.current, blkIdx, blocksNow[blkIdx]?.oursText ?? "");
                            setResultDraft(next);
                            await applyContent(next);
                            setDiffOurs(buildVariantFromWorking(next, "ours"));
                            setDiffTheirs(buildVariantFromWorking(next, "theirs"));
                            if (listConflictBlocksFromText(next).length === 0) {
                              await applyAndStageContent(next);
                            }
                          },
                        });

                        modifiedEditor.addAction({
                          id: "graphoria.conflict.useThisVersion.modified",
                          label: "Use this version",
                          contextMenuGroupId: "navigation",
                          contextMenuOrder: 1.2,
                          precondition: "graphoriaConflictUseThisVersion",
                          run: async () => {
                            const pos = modifiedEditor.getPosition();
                            if (!pos) return;
                            const changeIdx = findChangeIndex(false, pos.lineNumber);
                            if (changeIdx < 0) return;
                            const blkIdx = findConflictBlockIndexFromChange(false, changeIdx);
                            if (blkIdx < 0) return;
                            const blocksNow = getBlocksNow();
                            const next = applyConflictBlock(resultDraftRef.current, blkIdx, blocksNow[blkIdx]?.theirsText ?? "");
                            setResultDraft(next);
                            await applyContent(next);
                            setDiffOurs(buildVariantFromWorking(next, "ours"));
                            setDiffTheirs(buildVariantFromWorking(next, "theirs"));
                            if (listConflictBlocksFromText(next).length === 0) {
                              await applyAndStageContent(next);
                            }
                          },
                        });
                      }}
                      options={{
                        readOnly: true,
                        renderSideBySide: true,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        wordWrap: "on",
                        fontSize: 12,
                      }}
                    />
                  ) : (
                    <Editor
                      height="100%"
                      theme={monacoTheme}
                      language={lang}
                      value={resultDraft}
                      beforeMount={(monaco) => {
                        ensureConflictThemes(monaco);
                      }}
                      options={{
                        readOnly: true,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        wordWrap: "on",
                        fontSize: 12,
                      }}
                      onMount={(_, monaco) => {
                        ensureConflictThemes(monaco);
                      }}
                    />
                  )}
                </div>
              ) : (
                <Editor
                  height="100%"
                  theme={monacoTheme}
                  language={lang}
                  value={resultDraft}
                  beforeMount={(monaco) => {
                    ensureConflictThemes(monaco);
                  }}
                  onChange={(v: string | undefined) => {
                    setResultDraft(v ?? "");
                  }}
                  onMount={(editor, monaco) => {
                    ensureConflictThemes(monaco);
                    const model = editor.getModel();
                    if (!model) return;

                    const key = editor.createContextKey<boolean>("graphoriaHasConflictAtCursor", false);
                    const updateKey = () => {
                      const pos = editor.getPosition();
                      if (!pos) {
                        key.set(false);
                        return;
                      }
                      const blk = findConflictBlock(model, pos.lineNumber);
                      key.set(!!blk);
                    };
                    updateKey();
                    editor.onDidChangeCursorPosition(updateKey);

                    editor.addAction({
                      id: "graphoria.resolveConflict.takeOurs",
                      label: "Resolve conflict: take ours",
                      contextMenuGroupId: "navigation",
                      contextMenuOrder: 1.5,
                      precondition: "graphoriaHasConflictAtCursor",
                      run: async () => {
                        const pos = editor.getPosition();
                        if (!pos) return;
                        const blk = findConflictBlock(model, pos.lineNumber);
                        if (!blk) return;

                        const oursLines: string[] = [];
                        for (let ln = blk.start + 1; ln <= blk.mid - 1; ln++) {
                          oursLines.push(model.getLineContent(ln));
                        }

                        const range = new monaco.Range(
                          blk.start,
                          1,
                          blk.end,
                          model.getLineMaxColumn(blk.end)
                        );
                        model.applyEdits([{ range, text: oursLines.join("\n") }]);
                        const next = model.getValue();
                        setResultDraft(next);
                        await applyContent(next);
                        setDiffOurs(buildVariantFromWorking(next, "ours"));
                        setDiffTheirs(buildVariantFromWorking(next, "theirs"));
                        if (listConflictBlocksFromText(next).length === 0) {
                          await applyAndStageContent(next);
                        }
                        return;
                      },
                    });

                    editor.addAction({
                      id: "graphoria.resolveConflict.takeTheirs",
                      label: "Resolve conflict: take theirs",
                      contextMenuGroupId: "navigation",
                      contextMenuOrder: 1.6,
                      precondition: "graphoriaHasConflictAtCursor",
                      run: async () => {
                        const pos = editor.getPosition();
                        if (!pos) return;
                        const blk = findConflictBlock(model, pos.lineNumber);
                        if (!blk) return;

                        const theirLines: string[] = [];
                        for (let ln = blk.mid + 1; ln <= blk.end - 1; ln++) {
                          theirLines.push(model.getLineContent(ln));
                        }

                        const range = new monaco.Range(
                          blk.start,
                          1,
                          blk.end,
                          model.getLineMaxColumn(blk.end)
                        );
                        model.applyEdits([{ range, text: theirLines.join("\n") }]);
                        const next = model.getValue();
                        setResultDraft(next);
                        await applyContent(next);
                        setDiffOurs(buildVariantFromWorking(next, "ours"));
                        setDiffTheirs(buildVariantFromWorking(next, "theirs"));
                        if (listConflictBlocksFromText(next).length === 0) {
                          await applyAndStageContent(next);
                        }
                        return;
                      },
                    });
                  }}
                  options={{
                    readOnly: false,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    wordWrap: "on",
                    fontSize: 12,
                  }}
                />
              )}
            </div>
          </div>
        </div>

        <div className="modalFooter" style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "flex", gap: 8 }}>
            {operation === "rebase" ? (
              <button type="button" onClick={onSkipRebase} disabled={disabled}>
                Skip
              </button>
            ) : null}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={onContinue} disabled={continueDisabled}>
              Continue
            </button>
            <button type="button" onClick={onAbort} disabled={disabled}>
              Abort
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
