import { useEffect, useMemo, useRef } from "react";
import cytoscape, { type Core } from "cytoscape";
import { getCyPalette, useAppSettings } from "../../appSettingsStore";
import { computeCompactLaneByHashForGraph } from "../../features/commits/lanes";
import { shortHash, truncate } from "../../utils/text";
import type { GitPatchPredictGraphResult } from "../../types/git";

type Props = {
  busy: boolean;
  error: string;
  result: GitPatchPredictGraphResult | null;
  patchPath: string;
  method: "apply" | "am";
  onClose: () => void;
  onApply: () => void;
  applyBusy: boolean;
};

export function PatchPredictModal({ busy, error, result, patchPath, method, onClose, onApply, applyBusy }: Props) {
  const theme = useAppSettings((s) => s.appearance.theme);
  const edgeDirection = useAppSettings((s) => s.graph.edgeDirection);
  const commitsHistoryOrder = useAppSettings((s) => s.git.commitsHistoryOrder);

  const graphRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);

  const miniElements = useMemo(() => {
    const commitsAll = result?.graph_commits ?? [];
    const commits = commitsAll.slice(0, 24);

    const nodes = new Map<
      string,
      { data: { id: string; label: string }; position?: { x: number; y: number }; classes?: string }
    >();
    const edges: Array<{ data: { id: string; source: string; target: string } }> = [];

    const present = new Set(commits.map((c) => c.hash));
    const laneByHash = computeCompactLaneByHashForGraph(commits, commitsHistoryOrder);

    const laneStep = 140;
    const rowStep = 54;

    const posFor = (lane: number, row: number) => {
      return { x: lane * laneStep, y: row * rowStep };
    };

    const predicted = new Set((result?.created_node_ids ?? []).map((s) => s.trim()).filter((s) => s.length > 0));

    for (let idx = 0; idx < commits.length; idx++) {
      const c = commits[idx];
      const lane = laneByHash.get(c.hash) ?? 0;
      const row = idx;
      const msg = truncate(c.subject ?? "", 20);
      const refsLine = c.refs?.trim() ? `\n${truncate(c.refs.trim(), 28)}` : "";
      const label = `${shortHash(c.hash)}\n${msg}${refsLine}`;

      const classes = [c.is_head ? "head" : "", predicted.has(c.hash) ? "predicted" : ""].filter(Boolean).join(" ");
      nodes.set(c.hash, {
        data: {
          id: c.hash,
          label,
        },
        position: posFor(lane, row),
        classes: classes || undefined,
      });
    }

    for (const c of commits) {
      const parents = commitsHistoryOrder === "first_parent" ? (c.parents[0] ? [c.parents[0]] : []) : c.parents;
      for (const p of parents) {
        if (!p) continue;
        if (!present.has(p)) continue;

        const source = edgeDirection === "to_parent" ? c.hash : p;
        const target = edgeDirection === "to_parent" ? p : c.hash;

        edges.push({
          data: {
            id: `${source}-${target}`,
            source,
            target,
          },
        });
      }
    }

    return { nodes: Array.from(nodes.values()), edges };
  }, [commitsHistoryOrder, edgeDirection, result?.created_node_ids, result?.graph_commits]);

  useEffect(() => {
    const el = graphRef.current;
    if (!el) return;

    cyRef.current?.destroy();
    cyRef.current = null;

    if (!result) return;

    const palette = getCyPalette(theme);
    const cy = cytoscape({
      container: el,
      elements: [...miniElements.nodes, ...miniElements.edges] as any,
      minZoom: 0.1,
      maxZoom: 5,
      wheelSensitivity: 0.3,
      layout: { name: "preset" } as any,
      style: [
        {
          selector: "node",
          style: {
            "background-color": palette.nodeBg,
            "border-color": palette.nodeBorder,
            "border-width": "1px",
            shape: "round-rectangle",
            "corner-radius": "8px",
            label: "data(label)",
            color: palette.nodeText,
            "text-outline-width": "0px",
            "font-size": "10px",
            "font-weight": "bold",
            "text-wrap": "wrap",
            "text-max-width": "170px",
            "text-valign": "center",
            "text-halign": "center",
            width: "190px",
            height: "40px",
          },
        },
        {
          selector: "node.head",
          style: {
            "border-color": palette.nodeHeadBorder,
            "border-width": "2px",
          },
        },
        {
          selector: "node.predicted",
          style: {
            "background-color": palette.nodeSelectedBg,
            "border-color": palette.nodeSelectedBorder,
          },
        },
        {
          selector: "edge",
          style: {
            width: "2px",
            "line-color": palette.edgeLine,
            "target-arrow-color": palette.edgeArrow,
            "target-arrow-shape": "triangle",
            "target-arrow-fill": "filled",
            "arrow-scale": 1,
            "curve-style": "bezier",
          },
        },
      ],
    });
    cyRef.current = cy;

    cy.nodes().lock();
    cy.nodes().ungrabify();

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        cy.resize();
        try {
          cy.fit(cy.elements(), 26);
        } catch {}
      });
    });

    return () => {
      cyRef.current?.destroy();
      cyRef.current = null;
    };
  }, [miniElements.edges, miniElements.nodes, result, theme]);

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ width: "min(1080px, 96vw)", maxHeight: "min(70vh, 640px)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>Patch predict</div>
          <button type="button" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>
        <div className="modalBody">
          {error ? <div className="error">{error}</div> : null}
          {busy ? <div style={{ opacity: 0.7 }}>Predicting…</div> : null}

          {result ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 400px", gap: 12, alignItems: "start" }}>
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 800, opacity: 0.8 }}>Patch</div>
                  <div className="mono" style={{ opacity: 0.9, wordBreak: "break-all" }}>
                    {patchPath}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <span style={{ fontWeight: 800 }}>Method:</span> {method}
                  </div>
                  <div>
                    <span style={{ fontWeight: 800 }}>Result:</span> {result.ok ? "ok" : "conflicts"}
                  </div>
                </div>

                <div>
                  <div style={{ fontWeight: 800, opacity: 0.8, marginBottom: 6 }}>Potential conflicts</div>
                  {result.conflict_files?.length ? (
                    <div className="statusList">
                      {result.conflict_files.map((p) => (
                        <div key={p} className="statusRow statusRowSingleCol" title={p}>
                          <span className="statusPath">{p}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ opacity: 0.75 }}>{result.ok ? "No conflicts detected." : "Conflicts detected, but file list is unavailable."}</div>
                  )}
                </div>

                <div>
                  <div style={{ fontWeight: 800, opacity: 0.8, marginBottom: 6 }}>Touched files</div>
                  {result.touched_files?.length ? (
                    <div className="statusList">
                      {result.touched_files.map((p) => (
                        <div key={p} className="statusRow statusRowSingleCol" title={p}>
                          <span className="statusPath">{p}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ opacity: 0.75 }}>No files detected.</div>
                  )}
                </div>

                {result.message?.trim() ? (
                  <details>
                    <summary style={{ cursor: "pointer", opacity: 0.75, fontSize: 12 }}>Details</summary>
                    <pre className="diffCode" style={{ whiteSpace: "pre-wrap", margin: 0, marginTop: 8 }}>
                      {result.message}
                    </pre>
                  </details>
                ) : null}
              </div>

              <div style={{ display: "grid", gap: 8, minHeight: 0 }}>
                <div style={{ fontWeight: 800, opacity: 0.8 }}>Graph preview</div>
                <div
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    minHeight: 320,
                    height: 420,
                    overflow: "hidden",
                    background: "var(--panel-2)",
                  }}
                  ref={graphRef}
                />
              </div>
            </div>
          ) : null}
        </div>

        <div className="modalFooter" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={onApply} disabled={busy || applyBusy || !result} title="Apply patch">
            {applyBusy ? "Applying…" : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}
