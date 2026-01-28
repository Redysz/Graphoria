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

function normalizeNewlines(s: string) {
  return s.replace(/\r\n/g, "\n");
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
    return theme === "dark" ? "vs-dark" : "vs";
  }, [theme]);

  const lang = useMemo(() => pickLanguageByPath(selectedPath), [selectedPath]);

  async function refreshStateAndKeepSelection() {
    const keep = selectedPath;
    const st = await gitConflictState(repoPath);
    const list = st.files ?? [];
    setFiles(list);
    if (!keep.trim()) {
      if (list.length > 0) setSelectedPath(list[0].path);
      return;
    }
    if (list.some((f) => f.path === keep)) {
      setSelectedPath(keep);
    } else {
      setSelectedPath(list[0]?.path ?? "");
    }
  }

  async function takeOurs() {
    if (!selectedPath.trim()) return;
    setApplyBusy(true);
    setApplyError("");
    try {
      await gitConflictTakeOurs({ repoPath, path: selectedPath });
      await refreshStateAndKeepSelection();
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
      await refreshStateAndKeepSelection();
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
      await refreshStateAndKeepSelection();
    } catch (e) {
      setApplyError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setApplyBusy(false);
    }
  }

  if (!open) return null;

  const disabled = busy || loading || versionsLoading || applyBusy;

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
                  void refreshStateAndKeepSelection();
                }}
                disabled={disabled}
                title="Refresh conflict state"
              >
                Refresh
              </button>
            </div>

            {loading ? <div className="diffEmpty">Loading…</div> : null}

            {!loading ? (
              files.length === 0 ? (
                <div className="diffEmpty">No conflicts detected.</div>
              ) : (
                <div className="diffFileList" style={{ padding: 0 }}>
                  {files.map((f) => (
                    <button
                      key={f.path}
                      type="button"
                      className={f.path === selectedPath ? "diffFile diffFileActive" : "diffFile"}
                      onClick={() => setSelectedPath(f.path)}
                      style={{ gridTemplateColumns: "78px 1fr" }}
                      title={f.path}
                    >
                      <span className="diffStatus">{f.status.trim() || "U"}</span>
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
                <button type="button" onClick={() => void takeOurs()} disabled={disabled || !selectedPath.trim()}>
                  Take ours
                </button>
                <button type="button" onClick={() => void takeTheirs()} disabled={disabled || !selectedPath.trim()}>
                  Take theirs
                </button>
                <button type="button" onClick={() => void applyAndStage()} disabled={disabled || !selectedPath.trim()}>
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
                <DiffEditor
                  height="100%"
                  theme={monacoTheme}
                  language={lang}
                  original={versions.ours}
                  modified={versions.theirs}
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
                  onChange={(v: string | undefined) => {
                    setResultDraft(v ?? "");
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
