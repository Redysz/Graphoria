import { useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import type { GitStatusEntry } from "../../types/git";
import { parseUnifiedDiff } from "../../DiffView";
import { fileExtLower, imageMimeFromExt } from "../../utils/filePreview";
import { statusBadge } from "../../utils/text";

type FilesViewMode = "flat" | "tree";

type TreeNode = {
  kind: "folder" | "file";
  name: string;
  key: string;
  children?: TreeNode[];
  file?: GitStatusEntry;
  leafPaths: string[];
};

type Props = {
  activeRepoPath: string;
  remoteUrl: string | null | undefined;
  diffToolName: string;

  busy: boolean;
  error: string;

  message: string;
  setMessage: (v: string) => void;

  statusEntries: GitStatusEntry[];
  selectedPaths: Record<string, boolean>;
  setSelectedPaths: Dispatch<SetStateAction<Record<string, boolean>>>;

  previewPath: string;
  setPreviewPath: (v: string) => void;
  setPreviewStatus: (v: string) => void;

  previewLoading: boolean;
  previewError: string;
  previewImageBase64: string;
  previewDiff: string;
  previewContent: string;

  alsoPush: boolean;
  setAlsoPush: (v: boolean) => void;

  joinPath: (base: string, child: string) => string;
  onCopyText: (text: string) => void;
  onRevealInExplorer: (absPath: string) => void;

  onOpenWorkingFileContextMenu: (path: string, status: string, x: number, y: number) => void;
  onDiscard: (path: string, status: string) => void;
  onDelete: (path: string) => void;

  onClose: () => void;
  onCommit: () => void;
};

export function CommitModal({
  activeRepoPath,
  remoteUrl,
  diffToolName,
  busy,
  error,
  message,
  setMessage,
  statusEntries,
  selectedPaths,
  setSelectedPaths,
  previewPath,
  setPreviewPath,
  setPreviewStatus,
  previewLoading,
  previewError,
  previewImageBase64,
  previewDiff,
  previewContent,
  alsoPush,
  setAlsoPush,
  joinPath,
  onCopyText,
  onRevealInExplorer,
  onOpenWorkingFileContextMenu,
  onDiscard,
  onDelete,
  onClose,
  onCommit,
}: Props) {
  const commitDisabled = busy || !message.trim() || statusEntries.filter((e) => selectedPaths[e.path]).length === 0;

  const [filesView, setFilesView] = useState<FilesViewMode>("flat");
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});

  const allSelected = useMemo(() => {
    if (statusEntries.length === 0) return false;
    for (const e of statusEntries) {
      if (!selectedPaths[e.path]) return false;
    }
    return true;
  }, [selectedPaths, statusEntries]);

  const treeRoots = useMemo<TreeNode[]>(() => {
    const root = { children: new Map<string, any>(), leafPaths: [] as string[] };

    for (const entry of statusEntries) {
      const norm = entry.path.replace(/\\/g, "/");
      const parts = norm.split("/").filter(Boolean);
      let cursor = root;
      let prefix = "";
      for (let i = 0; i < parts.length; i += 1) {
        const part = parts[i] ?? "";
        const isLeaf = i === parts.length - 1;
        if (isLeaf) {
          cursor.leafPaths.push(entry.path);
          cursor.children.set(`file:${norm}`, {
            kind: "file",
            name: part,
            key: `file:${norm}`,
            file: entry,
            leafPaths: [entry.path],
          } satisfies TreeNode);
        } else {
          prefix = prefix ? `${prefix}/${part}` : part;
          const key = `dir:${prefix}`;
          if (!cursor.children.has(key)) {
            cursor.children.set(key, {
              kind: "folder",
              name: part,
              key,
              children: new Map<string, any>(),
              leafPaths: [],
            });
          }
          cursor.leafPaths.push(entry.path);
          cursor = cursor.children.get(key);
        }
      }
    }

    function toSortedNodes(m: Map<string, any>): TreeNode[] {
      const nodes: TreeNode[] = [];
      for (const v of m.values()) {
        if (v.kind === "folder") {
          nodes.push({
            kind: "folder",
            name: v.name,
            key: v.key,
            leafPaths: v.leafPaths,
            children: toSortedNodes(v.children),
          });
        } else {
          nodes.push(v as TreeNode);
        }
      }
      nodes.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      return nodes;
    }

    return toSortedNodes(root.children);
  }, [statusEntries]);

  function setAllSelected(nextChecked: boolean) {
    const next: Record<string, boolean> = {};
    for (const e of statusEntries) next[e.path] = nextChecked;
    setSelectedPaths(next);
  }

  function folderSelectionState(leafPaths: string[]) {
    let selected = 0;
    for (const p of leafPaths) if (selectedPaths[p]) selected += 1;
    return {
      all: leafPaths.length > 0 && selected === leafPaths.length,
      none: selected === 0,
      some: selected > 0 && selected < leafPaths.length,
    };
  }

  const gridStyle = {
    display: "grid",
    gridTemplateColumns: "minmax(0, 2fr) minmax(0, 3fr)",
    gap: 12,
    alignItems: "stretch",
    minHeight: 0,
    height: "100%",
  } as const;

  const previewBoxStyle = {
    border: "1px solid var(--border)",
    borderRadius: 12,
    overflow: "hidden",
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    display: "grid",
  } as const;

  const preStyle = {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    overflow: "auto",
    border: "1px solid var(--border)",
    borderRadius: 12,
  } as const;

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ width: "min(1200px, 96vw)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>Commit</div>
          <button type="button" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>
        <div className="modalBody">
          {error ? <div className="error">{error}</div> : null}

          <div style={gridStyle}>
            <div style={{ display: "grid", gap: 10, minHeight: 0, minWidth: 0 }}>
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontWeight: 800, opacity: 0.8 }}>Message</div>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={3}
                  className="modalTextarea"
                  placeholder="Commit message"
                  disabled={busy}
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 2 }}>
                <div style={{ fontWeight: 800, opacity: 0.8 }}>Files</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button type="button" onClick={() => setAllSelected(!allSelected)} disabled={busy || statusEntries.length === 0}>
                    {allSelected ? "Deselect all" : "Select all"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilesView((prev) => (prev === "flat" ? "tree" : "flat"))}
                    disabled={busy || statusEntries.length === 0}
                  >
                    {filesView === "flat" ? "Tree view" : "Flat view"}
                  </button>
                </div>
              </div>

              {statusEntries.length === 0 ? (
                <div style={{ opacity: 0.7, marginTop: 8 }}>No changes to commit.</div>
              ) : (
                <div className="statusList">
                  {filesView === "flat"
                    ? statusEntries.map((e) => (
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
                      ))
                    : (() => {
                        const rows: ReactNode[] = [];
                        const renderNodes = (nodes: TreeNode[], depth: number) => {
                          for (const n of nodes) {
                            if (n.kind === "folder") {
                              const s = folderSelectionState(n.leafPaths);
                              const expanded = expandedFolders[n.key] ?? true;

                              rows.push(
                                <div
                                  key={n.key}
                                  className="statusRow"
                                  onClick={() =>
                                    setExpandedFolders((prev) => ({
                                      ...prev,
                                      [n.key]: !(prev[n.key] ?? true),
                                    }))
                                  }
                                  style={{ paddingLeft: 8 + depth * 16 }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={s.all}
                                    ref={(el) => {
                                      if (!el) return;
                                      el.indeterminate = s.some;
                                    }}
                                    onClick={(ev) => ev.stopPropagation()}
                                    onChange={(ev) => {
                                      const checked = ev.target.checked;
                                      setSelectedPaths((prev) => {
                                        const next = { ...prev };
                                        for (const p of n.leafPaths) next[p] = checked;
                                        return next;
                                      });
                                    }}
                                    disabled={busy}
                                  />
                                  <span className="statusCode" title="folder">
                                    {expanded ? "v" : ">"}
                                  </span>
                                  <span className="statusPath" style={{ fontWeight: 800, opacity: 0.9 }}>
                                    {n.name}
                                  </span>
                                  <span className="statusActions" />
                                </div>
                              );

                              if (expanded && n.children && n.children.length > 0) {
                                renderNodes(n.children, depth + 1);
                              }
                              continue;
                            }

                            const e = n.file;
                            if (!e) continue;
                            rows.push(
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
                                    ? {
                                        background: "rgba(47, 111, 237, 0.12)",
                                        borderColor: "rgba(47, 111, 237, 0.35)",
                                        paddingLeft: 8 + depth * 16,
                                      }
                                    : { paddingLeft: 8 + depth * 16 }
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
                                <span className="statusPath">{n.name}</span>
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
                            );
                          }
                        };

                        renderNodes(treeRoots, 0);
                        return rows;
                      })()}
                </div>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0, minWidth: 0, overflow: "hidden" }}>
              <div style={{ fontWeight: 800, opacity: 0.8 }}>Preview</div>
              <div style={{ opacity: 0.75, fontSize: 12 }}>Green: added, red: removed. Yellow/blue: detected moved lines.</div>

              {previewError ? <div className="error">{previewError}</div> : null}
              {previewLoading ? <div style={{ opacity: 0.7 }}>Loading…</div> : null}

              {!previewLoading && !previewError ? (
                diffToolName !== "Graphoria builtin diff" ? (
                  <div style={{ opacity: 0.75 }}>Opened in external diff tool.</div>
                ) : previewImageBase64 ? (
                  <div style={previewBoxStyle}>
                    <img
                      src={`data:${imageMimeFromExt(fileExtLower(previewPath))};base64,${previewImageBase64}`}
                      style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                    />
                  </div>
                ) : previewDiff ? (
                  <pre className="diffCode" style={preStyle}>
                    {parseUnifiedDiff(previewDiff).map((l, i) => (
                      <div key={i} className={`diffLine diffLine-${l.kind}`}>
                        {l.text}
                      </div>
                    ))}
                  </pre>
                ) : previewContent ? (
                  <pre className="diffCode" style={preStyle}>
                    {previewContent.replace(/\r\n/g, "\n")}
                  </pre>
                ) : (
                  <div style={{ opacity: 0.75 }}>Select a file.</div>
                )
              ) : null}
            </div>
          </div>
        </div>
        <div className="modalFooter" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.85, whiteSpace: "nowrap" }}>
              <input type="checkbox" checked={alsoPush} onChange={(e) => setAlsoPush(e.target.checked)} disabled={busy || !remoteUrl} />
              Push after commit
            </label>
            {!remoteUrl ? <div style={{ opacity: 0.7, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis" }}>No remote origin.</div> : null}
          </div>
          <button type="button" onClick={onCommit} disabled={commitDisabled}>
            {busy ? "Committing…" : "Commit"}
          </button>
        </div>
      </div>
    </div>
  );
}
