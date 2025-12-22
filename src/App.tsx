import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import cytoscape, { type Core } from "cytoscape";
import dagre from "cytoscape-dagre";
import "./App.css";

let dagreRegistered = false;

type GitCommit = {
  hash: string;
  parents: string[];
  author: string;
  date: string;
  subject: string;
  refs: string;
  is_head: boolean;
};

type RepoOverview = {
  head: string;
  head_name: string;
  branches: string[];
  tags: string[];
  remotes: string[];
};

type GitStatusEntry = {
  status: string;
  path: string;
};

function shortHash(hash: string) {
  return hash.slice(0, 8);
}

function repoNameFromPath(p: string) {
  const normalized = p.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/");
  return parts.length > 0 ? parts[parts.length - 1] : normalized;
}

function truncate(s: string, max: number) {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function App() {
  const [repos, setRepos] = useState<string[]>([]);
  const [activeRepoPath, setActiveRepoPath] = useState<string>("");
  const [overviewByRepo, setOverviewByRepo] = useState<Record<string, RepoOverview | undefined>>({});
  const [commitsByRepo, setCommitsByRepo] = useState<Record<string, GitCommit[] | undefined>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  const [commitModalOpen, setCommitModalOpen] = useState(false);
  const [statusEntries, setStatusEntries] = useState<GitStatusEntry[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Record<string, boolean>>({});
  const [commitMessage, setCommitMessage] = useState("");
  const [commitBusy, setCommitBusy] = useState(false);
  const [commitError, setCommitError] = useState("");

  const [viewMode, setViewMode] = useState<"graph" | "commits">("graph");
  const [selectedHash, setSelectedHash] = useState<string>("");

  const commits = commitsByRepo[activeRepoPath] ?? [];
  const overview = overviewByRepo[activeRepoPath];

  const graphRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);

  const selectedCommit = useMemo(() => {
    if (!selectedHash) return undefined;
    return commits.find((c) => c.hash === selectedHash);
  }, [commits, selectedHash]);

  const headHash = useMemo(() => {
    return overview?.head || commits.find((c) => c.is_head)?.hash || "";
  }, [commits, overview?.head]);

  function focusOnHash(hash: string, nextZoom?: number) {
    const cy = cyRef.current;
    if (!cy) return;

    const node = cy.$id(hash);
    if (node.length === 0) return;

    if (typeof nextZoom === "number") {
      cy.zoom(nextZoom);
    }

    cy.center(node);
  }

  function focusOnHead() {
    if (!headHash) return;
    focusOnHash(headHash, 1);
  }

  function zoomBy(factor: number) {
    const cy = cyRef.current;
    if (!cy) return;
    const current = cy.zoom();
    const next = Math.min(5, Math.max(0.1, current * factor));
    const renderedCenter = {
      x: cy.width() / 2,
      y: cy.height() / 2,
    };
    cy.zoom({ level: next, renderedPosition: renderedCenter });
  }

  const elements = useMemo(() => {
    const nodes = new Map<string, { data: { id: string; label: string }; classes?: string }>();
    const edges: Array<{ data: { id: string; source: string; target: string } }> = [];

    for (const c of commits) {
      const label = `${shortHash(c.hash)}\n${truncate(c.subject, 100)}`;
      nodes.set(c.hash, {
        data: {
          id: c.hash,
          label,
        },
        classes: c.is_head ? "head" : undefined,
      });
    }

    for (const c of commits) {
      for (const p of c.parents) {
        if (!nodes.has(p)) {
          nodes.set(p, {
            data: {
              id: p,
              label: `${shortHash(p)}\n(older)`,
            },
            classes: "placeholder",
          });
        }

        edges.push({
          data: {
            id: `${c.hash}-${p}`,
            source: c.hash,
            target: p,
          },
        });
      }
    }

    return {
      nodes: Array.from(nodes.values()),
      edges,
    };
  }, [commits]);

  useEffect(() => {
    if (viewMode !== "graph") {
      cyRef.current?.destroy();
      cyRef.current = null;
      return;
    }

    if (!graphRef.current) return;

    if (!dagreRegistered) {
      cytoscape.use(dagre);
      dagreRegistered = true;
    }

    cyRef.current?.destroy();
    cyRef.current = cytoscape({
      container: graphRef.current,
      elements: [...elements.nodes, ...elements.edges],
      minZoom: 0.1,
      maxZoom: 5,
      wheelSensitivity: 0.15,
      layout: { name: "preset" } as any,
      style: [
        {
          selector: "node",
          style: {
            "background-color": "#ffffff",
            "border-color": "rgba(15, 15, 15, 0.20)",
            "border-width": "1px",
            shape: "round-rectangle",
            label: "data(label)",
            color: "#0f0f0f",
            "text-outline-width": "0px",
            "font-size": "12px",
            "text-wrap": "wrap",
            "text-max-width": "220px",
            "text-valign": "center",
            "text-halign": "center",
            width: "260px",
            height: "56px",
          },
        },
        {
          selector: "node.head",
          style: {
            "border-color": "#2f6fed",
            "border-width": "2px",
          },
        },
        {
          selector: "node.selected",
          style: {
            "border-color": "#1f56c6",
            "border-width": "3px",
            "background-color": "rgba(47, 111, 237, 0.10)",
          },
        },
        {
          selector: "node.placeholder",
          style: {
            "background-color": "#f2f4f8",
            "border-color": "rgba(15, 15, 15, 0.18)",
            "border-width": "1px",
            color: "rgba(15, 15, 15, 0.70)",
          },
        },
        {
          selector: "edge",
          style: {
            width: "2px",
            "line-color": "rgba(47, 111, 237, 0.35)",
            "target-arrow-color": "rgba(47, 111, 237, 0.55)",
            "target-arrow-shape": "triangle",
            "target-arrow-fill": "filled",
            "arrow-scale": 1.1,
            "curve-style": "bezier",
          },
        },
      ],
    });

    const cy = cyRef.current;
    if (!cy) return;

    cy.on("tap", "node", (evt) => {
      setSelectedHash(evt.target.id());
    });

    cy.on("tap", (evt) => {
      if (evt.target === cy) setSelectedHash("");
    });

    const layout = (cy as any).layout({
      name: "dagre",
      rankDir: "TB",
      nodeSep: 70,
      rankSep: 90,
      fit: false,
      animate: false,
    });

    (layout as any).one("layoutstop", () => {
      focusOnHead();
    });

    (layout as any).run();

    return () => {
      cyRef.current?.destroy();
      cyRef.current = null;
    };
  }, [elements.edges, elements.nodes, headHash, viewMode]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.$("node").removeClass("selected");
    if (selectedHash) {
      cy.$id(selectedHash).addClass("selected");
    }
    if (!selectedHash && headHash) {
      cy.$id(headHash).addClass("selected");
    }
  }, [selectedHash, headHash, viewMode, elements.nodes.length, elements.edges.length]);

  async function pickRepository() {
    setError("");

    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select a Git repository",
    });

    if (!selected || Array.isArray(selected)) return;
    void openRepository(selected);
  }

  async function initializeProject() {
    setError("");
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select a folder to initialize",
    });

    if (!selected || Array.isArray(selected)) return;

    setLoading(true);
    try {
      await invoke<string>("init_repo", { repoPath: selected });
      await openRepository(selected);
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setLoading(false);
    }
  }

  async function openCommitDialog() {
    if (!activeRepoPath) return;
    setCommitError("");
    setCommitMessage("");
    setCommitModalOpen(true);

    try {
      const entries = await invoke<GitStatusEntry[]>("git_status", { repoPath: activeRepoPath });
      setStatusEntries(entries);
      const nextSelected: Record<string, boolean> = {};
      for (const e of entries) nextSelected[e.path] = true;
      setSelectedPaths(nextSelected);
    } catch (e) {
      setStatusEntries([]);
      setSelectedPaths({});
      setCommitError(typeof e === "string" ? e : JSON.stringify(e));
    }
  }

  async function runCommit() {
    if (!activeRepoPath) return;

    const paths = statusEntries.filter((e) => selectedPaths[e.path]).map((e) => e.path);
    if (paths.length === 0) {
      setCommitError("No files selected.");
      return;
    }

    setCommitBusy(true);
    setCommitError("");
    try {
      await invoke<string>("git_commit", { repoPath: activeRepoPath, message: commitMessage, paths });
      setCommitModalOpen(false);
      await loadRepo(activeRepoPath);
    } catch (e) {
      setCommitError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setCommitBusy(false);
    }
  }

  async function openRepository(path: string) {
    setError("");
    setViewMode("graph");
    setSelectedHash("");

    setRepos((prev) => (prev.includes(path) ? prev : [...prev, path]));
    setActiveRepoPath(path);
    await loadRepo(path);
  }

  async function closeRepository(path: string) {
    setRepos((prev) => prev.filter((p) => p !== path));
    setOverviewByRepo((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
    setCommitsByRepo((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });

    if (activeRepoPath === path) {
      const remaining = repos.filter((p) => p !== path);
      const nextActive = remaining[0] ?? "";
      setActiveRepoPath(nextActive);
      setSelectedHash("");
    }
  }

  async function loadRepo(nextRepoPath?: string) {
    const path = nextRepoPath ?? activeRepoPath;
    if (!path) return;

    setLoading(true);
    setError("");
    try {
      const [ov, cs] = await Promise.all([
        invoke<RepoOverview>("repo_overview", { repoPath: path }),
        invoke<GitCommit[]>("list_commits", { repoPath: path, maxCount: 1200 }),
      ]);

      setOverviewByRepo((prev) => ({ ...prev, [path]: ov }));
      setCommitsByRepo((prev) => ({ ...prev, [path]: cs }));

      const headHash = cs.find((c) => c.is_head)?.hash || ov.head;
      setSelectedHash(headHash || "");
    } catch (e) {
      setOverviewByRepo((prev) => ({ ...prev, [path]: undefined }));
      setCommitsByRepo((prev) => ({ ...prev, [path]: [] }));
      setError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="menubar">
          <div className="menuitem">Repository</div>
          <div className="menuitem">Navigate</div>
          <div className="menuitem">View</div>
          <div className="menuitem">Tools</div>
          <div className="menuitem">Help</div>
        </div>

        <div className="toolbar">
          <button type="button" onClick={pickRepository}>
            Open repository
          </button>
          <button type="button" onClick={initializeProject} disabled={loading}>
            Initialize project
          </button>
          <button type="button" onClick={() => void loadRepo()} disabled={!activeRepoPath || loading}>
            Refresh
          </button>
          <button type="button" onClick={() => void openCommitDialog()} disabled={!activeRepoPath || loading}>
            Commit…
          </button>
          <button type="button" onClick={() => void openPath(activeRepoPath)} disabled={!activeRepoPath}>
            Open folder
          </button>
          <button type="button" disabled>
            Git Bash
          </button>
          {loading ? <div style={{ opacity: 0.7 }}>Loading…</div> : null}
          {error ? <div className="error">{error}</div> : null}
        </div>

        <div className="tabs">
          {repos.length === 0 ? <div style={{ opacity: 0.7, padding: "8px 4px" }}>No repository opened</div> : null}
          {repos.map((p) => (
            <div
              key={p}
              className={`tab ${p === activeRepoPath ? "tabActive" : ""}`}
              onClick={() => {
                setActiveRepoPath(p);
                setSelectedHash("");
              }}
            >
              <div style={{ fontWeight: 900 }}>{repoNameFromPath(p)}</div>
              <button
                type="button"
                className="tabClose"
                onClick={(e) => {
                  e.stopPropagation();
                  void closeRepository(p);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="content">
        <aside className="sidebar">
          <div className="sidebarSection">
            <div className="sidebarTitle">Branches</div>
            <div className="sidebarList">
              {(overview?.branches ?? []).slice(0, 30).map((b) => (
                <div key={b} className="sidebarItem">
                  {b}
                </div>
              ))}
            </div>
          </div>

          <div className="sidebarSection">
            <div className="sidebarTitle">Remotes</div>
            <div className="sidebarList">
              {(overview?.remotes ?? []).slice(0, 30).map((r) => (
                <div key={r} className="sidebarItem">
                  {r}
                </div>
              ))}
            </div>
          </div>

          <div className="sidebarSection">
            <div className="sidebarTitle">Tags</div>
            <div className="sidebarList">
              {(overview?.tags ?? []).slice(0, 30).map((t) => (
                <div key={t} className="sidebarItem">
                  {t}
                </div>
              ))}
            </div>
          </div>

          <div className="sidebarSection">
            <div className="sidebarTitle">Other</div>
            <div className="sidebarList">
              <div className="sidebarItem">Submodules</div>
              <div className="sidebarItem">Stashes</div>
            </div>
          </div>
        </aside>

        <div className="main">
          <div className="mainHeader">
            <div className="repoTitle">
              <div className="repoName">{activeRepoPath ? repoNameFromPath(activeRepoPath) : "Graphoria"}</div>
              <div className="repoPath">
                {activeRepoPath ? activeRepoPath : "Open a repository to start."}
                {overview?.head_name ? ` — ${overview.head_name}` : ""}
              </div>
            </div>

            <div className="segmented">
              <button
                type="button"
                className={viewMode === "graph" ? "active" : ""}
                onClick={() => setViewMode("graph")}
                disabled={!activeRepoPath}
              >
                Graph
              </button>
              <button
                type="button"
                className={viewMode === "commits" ? "active" : ""}
                onClick={() => setViewMode("commits")}
                disabled={!activeRepoPath}
              >
                Commits
              </button>
            </div>
          </div>

          <div className="mainCanvas">
            {viewMode === "graph" ? (
              <>
                <div className="graphCanvas" key={`graph-${activeRepoPath}`}>
                  <div className="cyCanvas" ref={graphRef} />
                  <div className="zoomControls">
                    <button type="button" onClick={() => zoomBy(1.2)} disabled={!activeRepoPath}>
                      +
                    </button>
                    <button type="button" onClick={() => zoomBy(1 / 1.2)} disabled={!activeRepoPath}>
                      -
                    </button>
                    <button type="button" onClick={() => focusOnHash(selectedHash || headHash, 1)} disabled={!activeRepoPath}>
                      Reset
                    </button>
                    <button type="button" onClick={focusOnHead} disabled={!activeRepoPath || !headHash}>
                      HEAD
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="graphCanvas" key={`commits-${activeRepoPath}`} style={{ padding: 12, overflow: "auto" }}>
                {commits.length === 0 ? (
                  <div style={{ opacity: 0.7 }}>No commits loaded.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {commits.map((c) => (
                      <button
                        key={c.hash}
                        type="button"
                        onClick={() => setSelectedHash(c.hash)}
                        style={{
                          textAlign: "left",
                          padding: 10,
                          background: c.hash === selectedHash ? "rgba(47, 111, 237, 0.12)" : "#ffffff",
                        }}
                      >
                        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                          <span
                            style={{
                              fontFamily:
                                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                              opacity: 0.9,
                            }}
                          >
                            {shortHash(c.hash)}
                          </span>
                          <span style={{ fontWeight: 800 }}>{truncate(c.subject, 100)}</span>
                          {c.is_head ? <span style={{ opacity: 0.7 }}>(HEAD)</span> : null}
                        </div>
                        <div style={{ opacity: 0.75, fontSize: 12 }}>
                          {c.author} — {c.date}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="details">
            <div className="detailsTitle">
              <h3>Details</h3>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" disabled={!selectedCommit} onClick={() => void copyText(selectedHash)}>
                  Copy hash
                </button>
                <button type="button" disabled>
                  Checkout…
                </button>
              </div>
            </div>

            {!selectedCommit ? (
              <div style={{ opacity: 0.7 }}>Select a commit to see details.</div>
            ) : (
              <div className="detailsGrid">
                <div className="detailsLabel">Hash</div>
                <div className="detailsValue mono">{selectedCommit.hash}</div>

                <div className="detailsLabel">Subject</div>
                <div className="detailsValue">{selectedCommit.subject}</div>

                <div className="detailsLabel">Author</div>
                <div className="detailsValue">{selectedCommit.author}</div>

                <div className="detailsLabel">Date</div>
                <div className="detailsValue">{selectedCommit.date}</div>

                <div className="detailsLabel">Refs</div>
                <div className="detailsValue mono">{selectedCommit.refs || "(none)"}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {commitModalOpen ? (
        <div className="modalOverlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modalHeader">
              <div style={{ fontWeight: 900 }}>Commit</div>
              <button type="button" onClick={() => setCommitModalOpen(false)} disabled={commitBusy}>
                Close
              </button>
            </div>
            <div className="modalBody">
              {commitError ? <div className="error">{commitError}</div> : null}

              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontWeight: 800, opacity: 0.8 }}>Message</div>
                <textarea
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  rows={3}
                  className="modalTextarea"
                  placeholder="Commit message"
                  disabled={commitBusy}
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
                <div style={{ fontWeight: 800, opacity: 0.8 }}>Files</div>
                <button
                  type="button"
                  onClick={() => {
                    const next: Record<string, boolean> = {};
                    for (const e of statusEntries) next[e.path] = true;
                    setSelectedPaths(next);
                  }}
                  disabled={commitBusy || statusEntries.length === 0}
                >
                  Select all
                </button>
              </div>

              {statusEntries.length === 0 ? (
                <div style={{ opacity: 0.7, marginTop: 8 }}>No changes to commit.</div>
              ) : (
                <div className="statusList">
                  {statusEntries.map((e) => (
                    <label key={e.path} className="statusRow">
                      <input
                        type="checkbox"
                        checked={!!selectedPaths[e.path]}
                        onChange={(ev) => setSelectedPaths((prev) => ({ ...prev, [e.path]: ev.target.checked }))}
                        disabled={commitBusy}
                      />
                      <span className="statusCode">{e.status}</span>
                      <span className="statusPath">{e.path}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="modalFooter">
              <button
                type="button"
                onClick={() => void runCommit()}
                disabled={commitBusy || !commitMessage.trim() || statusEntries.filter((e) => selectedPaths[e.path]).length === 0}
              >
                {commitBusy ? "Committing…" : "Commit"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
