import { useEffect, useMemo, useState } from "react";
import { DiffEditor, Editor } from "@monaco-editor/react";
import type { GitConflictFileEntry } from "../../types/git";
import {
  gitConflictApplyAndStage,
  gitConflictFileVersions,
  gitConflictState,
  gitConflictTakeOurs,
  gitConflictTakeTheirs,
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
  }

  async function takeOurs() {
    if (!selectedPath.trim()) return;
    setApplyBusy(true);
    setApplyError("");
    try {
      await gitConflictTakeOurs({ repoPath, path: selectedPath });
      setEditMode("result");
      await reloadSelectedVersions();
      await refreshStateKeepPath();
    } catch (e) {
      setApplyError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setApplyBusy(false);
    }
  }

  async function takeTheirs() {
    if (!selectedPath.trim()) return;
    setApplyBusy(true);
    setApplyError("");
    try {
      await gitConflictTakeTheirs({ repoPath, path: selectedPath });
      setEditMode("result");
      await reloadSelectedVersions();
      await refreshStateKeepPath();
    } catch (e) {
      setApplyError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setApplyBusy(false);
    }
  }

  async function applyAndStage() {
    if (!selectedPath.trim()) return;
    setApplyBusy(true);
    setApplyError("");
    try {
      await gitConflictApplyAndStage({ repoPath, path: selectedPath, content: resultDraft });
      await reloadSelectedVersions();
      await refreshStateKeepPath();
    } catch (e) {
      setApplyError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setApplyBusy(false);
    }
  }

  if (!open) return null;

  const disabled = busy || loading || versionsLoading || applyBusy;

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
      <div className="modal" style={{ width: "min(1320px, 96vw)", height: "min(92vh, 980px)", maxHeight: "min(92vh, 980px)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>Resolve conflicts</div>
          <button type="button" onClick={onClose} disabled={disabled}>
            Close
          </button>
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
                <span className="conflictLegend conflictLegend-base">base</span>
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
                <button
                  type="button"
                  onClick={() => void applyAndStage()}
                  disabled={disabled || !selectedPath.trim()}
                  title="Write the Result editor content to disk and stage it"
                >
                  Stage result
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
                  <DiffEditor
                    height="100%"
                    theme={monacoTheme}
                    language={lang}
                    original={versions.ours}
                    modified={versions.theirs}
                    onMount={(_, monaco) => {
                      ensureConflictThemes(monaco);
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
                </div>
              ) : (
                <Editor
                  height="100%"
                  theme={monacoTheme}
                  language={lang}
                  value={resultDraft}
                  onChange={(v: string | undefined) => {
                    setResultDraft(v ?? "");
                  }}
                  onMount={(editor, monaco) => {
                    ensureConflictThemes(monaco);
                    const model = editor.getModel();
                    if (!model) return;

                    editor.addAction({
                      id: "graphoria.resolveConflict.takeOurs",
                      label: "Resolve conflict: take ours",
                      contextMenuGroupId: "navigation",
                      contextMenuOrder: 1.5,
                      run: () => {
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
                        return;
                      },
                    });

                    editor.addAction({
                      id: "graphoria.resolveConflict.takeTheirs",
                      label: "Resolve conflict: take theirs",
                      contextMenuGroupId: "navigation",
                      contextMenuOrder: 1.6,
                      run: () => {
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
            <button type="button" onClick={onContinue} disabled={disabled}>
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
