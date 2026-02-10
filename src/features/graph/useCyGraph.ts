import { useEffect, useRef, useState } from "react";
import cytoscape, { type Core } from "cytoscape";
import { getCyPalette, type GraphSettings, type ThemeName } from "../../appSettingsStore";
import type { GitStashEntry } from "../../types/git";
import { generateAvatarDataUrl, getGravatarCircleUrl, loadGravatarCircle } from "../../utils/avatarCanvas";
import { md5Hex } from "../../utils/hash";

type ViewportState = {
  zoom: number;
  pan: { x: number; y: number };
};

export type UseCyGraphParams = {
  viewMode: "graph" | "commits";
  activeRepoPath: string;

  elements: { nodes: any[]; edges: any[] };
  graphSettings: GraphSettings;
  theme: ThemeName;
  isMacOS: boolean;

  showOnlineAvatars: boolean;

  remoteNames: string[];
  stashBaseByRepo: Record<string, Record<string, string>>;
  stashesByRepo: Record<string, GitStashEntry[] | undefined>;
  unsyncedTagNames: string[];

  selectedHash: string;
  headHash: string;

  setSelectedHash: (hash: string) => void;

  openCommitContextMenu: (hash: string, x: number, y: number) => void;
  openStashContextMenu: (stashRef: string, stashMessage: string, x: number, y: number) => void;
  openRefBadgeContextMenu: (kind: "remote" | "branch", label: string, x: number, y: number) => void;
  openTagContextMenu: (tag: string, x: number, y: number) => void;

  closeCommitContextMenu: () => void;
  closeStashContextMenu: () => void;
  closeBranchContextMenu: () => void;
  closeTagContextMenu: () => void;
  closeRefBadgeContextMenu: () => void;
};

export function useCyGraph({
  viewMode,
  activeRepoPath,
  elements,
  graphSettings,
  theme,
  isMacOS,
  showOnlineAvatars,
  remoteNames,
  stashBaseByRepo,
  stashesByRepo,
  unsyncedTagNames,
  selectedHash,
  headHash,
  setSelectedHash,
  openCommitContextMenu,
  openStashContextMenu,
  openRefBadgeContextMenu,
  openTagContextMenu,
  closeCommitContextMenu,
  closeStashContextMenu,
  closeBranchContextMenu,
  closeTagContextMenu,
  closeRefBadgeContextMenu,
}: UseCyGraphParams) {
  const graphRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const viewportByRepoRef = useRef<Record<string, ViewportState | undefined>>({});
  const pendingAutoCenterByRepoRef = useRef<Record<string, boolean | undefined>>({});
  const initializingByRepoRef = useRef<Record<string, boolean | undefined>>({});
  const viewportRafRef = useRef<number | null>(null);

  const [zoomPct, setZoomPct] = useState<number>(100);
  const [autoCenterToken, setAutoCenterToken] = useState(0);

  function requestAutoCenter() {
    if (!activeRepoPath) return;
    pendingAutoCenterByRepoRef.current[activeRepoPath] = true;
    setAutoCenterToken((t) => t + 1);
  }

  function parseRefs(refs: string, remoteNamesList: string[]): Array<{ kind: "head" | "branch" | "tag" | "remote"; label: string }> {
    const parts = refs
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    const out: Array<{ kind: "head" | "branch" | "tag" | "remote"; label: string }> = [];

    const remotePrefixes = (remoteNamesList ?? [])
      .map((r) => r.trim())
      .filter((r) => r.length > 0);

    const isRemoteRef = (label: string) => {
      const t = label.trim();
      if (!t) return false;
      return remotePrefixes.some((r) => t.startsWith(`${r}/`));
    };

    for (const part of parts) {
      if (part.startsWith("tag: ")) {
        const label = part.slice("tag: ".length).trim();
        if (label) out.push({ kind: "tag", label });
        continue;
      }

      if (part.includes(" -> ")) {
        const [leftRaw, rightRaw] = part.split(" -> ", 2);
        const left = leftRaw.trim();
        const right = rightRaw.trim();
        if (left === "HEAD") {
          out.push({ kind: "head", label: "HEAD" });
        } else if (left.endsWith("/HEAD")) {
          out.push({ kind: "remote", label: left });
        } else if (left) {
          out.push({ kind: isRemoteRef(left) ? "remote" : "branch", label: left });
        }
        if (right) {
          out.push({ kind: isRemoteRef(right) ? "remote" : "branch", label: right });
        }
        continue;
      }

      if (part === "HEAD") {
        out.push({ kind: "head", label: "HEAD" });
        continue;
      }

      out.push({ kind: isRemoteRef(part) ? "remote" : "branch", label: part });
    }

    return out;
  }

  function applyRefBadges(cy: Core) {
    cy.$("node.refBadge").remove();
    cy.$("edge.refEdge").remove();
    cy.$("node.stashBadge").remove();
    cy.$("edge.stashEdge").remove();

    const unsyncedTagSet = new Set(
      (unsyncedTagNames ?? [])
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
    );

    const sideOffsetX = 240;
    const gapY = 30;
    const colGapX = 150;
    const maxPerCol = 6;

    const edgeSegs = cy
      .edges()
      .toArray()
      .filter((e) => !e.hasClass("refEdge") && !e.hasClass("stashEdge"))
      .map((e) => {
        const s = (e.source() as any).position();
        const t = (e.target() as any).position();
        const x1 = Number(s?.x ?? 0);
        const y1 = Number(s?.y ?? 0);
        const x2 = Number(t?.x ?? 0);
        const y2 = Number(t?.y ?? 0);
        const minX = Math.min(x1, x2);
        const maxX = Math.max(x1, x2);
        const minY = Math.min(y1, y2);
        const maxY = Math.max(y1, y2);
        return { x1, y1, x2, y2, minX, maxX, minY, maxY };
      });

    const segIntersectsRect = (seg: { x1: number; y1: number; x2: number; y2: number }, r: any) => {
      const x1 = seg.x1;
      const y1 = seg.y1;
      const x2 = seg.x2;
      const y2 = seg.y2;

      const inside = (x: number, y: number) => x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2;
      if (inside(x1, y1) || inside(x2, y2)) return true;

      const dx = x2 - x1;
      const dy = y2 - y1;
      let t0 = 0;
      let t1 = 1;

      const clip = (p: number, q: number) => {
        if (p === 0) return q >= 0;
        const r0 = q / p;
        if (p < 0) {
          if (r0 > t1) return false;
          if (r0 > t0) t0 = r0;
        } else {
          if (r0 < t0) return false;
          if (r0 < t1) t1 = r0;
        }
        return true;
      };

      if (!clip(-dx, x1 - r.x1)) return false;
      if (!clip(dx, r.x2 - x1)) return false;
      if (!clip(-dy, y1 - r.y1)) return false;
      if (!clip(dy, r.y2 - y1)) return false;

      return t0 <= t1;
    };

    const bboxIntersectsAnyEdge = (b: any) => {
      for (const seg of edgeSegs) {
        if (seg.minY > b.y2) continue;
        if (seg.maxY < b.y1) continue;
        if (seg.minX > b.x2) continue;
        if (seg.maxX < b.x1) continue;
        if (segIntersectsRect(seg, b)) return true;
      }
      return false;
    };

    const pushNodeAwayFromEdges = (nodeId: string, side: -1 | 1) => {
      const n = cy.$id(nodeId);
      if (n.length === 0) return;
      const step = 40;
      const maxIter = 35;
      for (let i = 0; i < maxIter; i++) {
        const bb0 = n.boundingBox({ includeLabels: true, includeOverlays: false } as any);
        const bb = {
          x1: bb0.x1 - 10,
          y1: bb0.y1 - 6,
          x2: bb0.x2 + 10,
          y2: bb0.y2 + 6,
        };
        if (!bboxIntersectsAnyEdge(bb)) break;
        const pos = n.position();
        n.unlock();
        if (graphSettings.rankDir === "LR") {
          n.position({ x: pos.x, y: pos.y + side * step });
        } else {
          n.position({ x: pos.x + side * step, y: pos.y });
        }
        n.lock();
      }
    };

    for (const n of cy.nodes().toArray()) {
      if (n.hasClass("refBadge")) continue;
      const refs = (n.data("refs") as string) || "";
      if (!refs.trim()) continue;

      const parsed = parseRefs(refs, remoteNames);
      if (parsed.length === 0) continue;

      let filtered = parsed;
      if (!graphSettings.showRemoteBranchesOnGraph) {
        filtered = filtered.filter((r) => r.kind !== "remote");
      }
      if (!graphSettings.showTags) {
        filtered = filtered.filter((r) => r.kind !== "tag");
      }
      if (filtered.length === 0) continue;

      const pos = n.position();

      const a = filtered.filter((_, i) => i % 2 === 0);
      const b = filtered.filter((_, i) => i % 2 === 1);

      const placeSide = (items: Array<{ kind: "head" | "branch" | "tag" | "remote"; label: string }>, side: -1 | 1) => {
        const visibleCount = Math.min(items.length, maxPerCol);

        if (graphSettings.rankDir === "LR") {
          const baseX = pos.x - ((visibleCount - 1) * gapY) / 2;
          for (let i = 0; i < items.length; i++) {
            const r = items[i];
            const col = Math.floor(i / maxPerCol);
            const row = i % maxPerCol;
            const id = `ref:${n.id()}:${r.kind}:${r.label}`;
            if (cy.$id(id).length > 0) continue;

            cy.add({
              group: "nodes",
              data: { id, label: r.label, kind: r.kind },
              position: {
                x: baseX + row * gapY,
                y: pos.y + side * (sideOffsetX + col * colGapX),
              },
              classes: `refBadge ref-${r.kind}${r.kind === "tag" && unsyncedTagSet.has(r.label) ? " ref-tag-unsynced" : ""}`,
              locked: true,
              grabbable: false,
              selectable: false,
            } as any);

            cy.add({
              group: "edges",
              data: { id: `refedge:${id}`, source: id, target: n.id() },
              classes: "refEdge",
              selectable: false,
            } as any);
          }
          return;
        }

        const baseY = pos.y - ((visibleCount - 1) * gapY) / 2;
        for (let i = 0; i < items.length; i++) {
          const r = items[i];
          const col = Math.floor(i / maxPerCol);
          const row = i % maxPerCol;
          const id = `ref:${n.id()}:${r.kind}:${r.label}`;
          if (cy.$id(id).length > 0) continue;

          cy.add({
            group: "nodes",
            data: { id, label: r.label, kind: r.kind },
            position: {
              x: pos.x + side * (sideOffsetX + col * colGapX),
              y: baseY + row * gapY,
            },
            classes: `refBadge ref-${r.kind}${r.kind === "tag" && unsyncedTagSet.has(r.label) ? " ref-tag-unsynced" : ""}`,
            locked: true,
            grabbable: false,
            selectable: false,
          } as any);

          cy.add({
            group: "edges",
            data: { id: `refedge:${id}`, source: id, target: n.id() },
            classes: "refEdge",
            selectable: false,
          } as any);
        }
      };

      if (a.length > 0) placeSide(a, -1);
      if (b.length > 0) placeSide(b, 1);
    }

    for (const b of cy.$("node.refBadge").toArray()) {
      const badge = b as any;
      const id = badge.id();
      const parts = id.split(":");
      if (parts.length < 3) continue;
      const targetId = parts[1];
      const target = cy.$id(targetId);
      if (target.length === 0) continue;
      const side: -1 | 1 =
        graphSettings.rankDir === "LR"
          ? badge.position().y < (target as any).position().y
            ? -1
            : 1
          : badge.position().x < (target as any).position().x
            ? -1
            : 1;
      pushNodeAwayFromEdges(id, side);
    }

    if (!graphSettings.showStashesOnGraph || !activeRepoPath) return;
    const baseMap = stashBaseByRepo[activeRepoPath] ?? {};
    const list = stashesByRepo[activeRepoPath] ?? [];
    if (list.length === 0) return;

    const byBase = new Map<string, GitStashEntry[]>();
    for (const s of list) {
      const base = baseMap[s.reference];
      if (!base) continue;
      const arr = byBase.get(base) ?? [];
      arr.push(s);
      byBase.set(base, arr);
    }

    const stashLine = "rgba(184, 92, 255, 0.75)";
    const stashBg = "rgba(184, 92, 255, 0.16)";
    const stashText = theme === "dark" ? "#f2f4f8" : "#0f0f0f";

    for (const [base, arr] of byBase.entries()) {
      const baseNode = cy.$id(base);
      if (baseNode.length === 0) continue;
      const pos = baseNode.position();

      const maxPerCol = 8;
      const gapY = 28;
      const colGapX = 210;
      const baseX = pos.x - 360;
      const baseY = pos.y + 140;

      for (let i = 0; i < arr.length; i++) {
        const s = arr[i];
        const col = Math.floor(i / maxPerCol);
        const row = i % maxPerCol;
        const safeRef = s.reference.replace(/[^a-zA-Z0-9:_-]/g, "_");
        const id = `stash:${base}:${safeRef}`;
        if (cy.$id(id).length > 0) continue;

        cy.add({
          group: "nodes",
          data: {
            id,
            label: s.message?.trim() ? s.message.trim() : s.reference,
            kind: "stash",
            stashRef: s.reference,
            stashMessage: s.message,
          },
          position: {
            x: baseX - col * colGapX,
            y: baseY + row * gapY,
          },
          classes: "stashBadge",
          locked: true,
          grabbable: false,
          selectable: false,
        } as any);

        cy.add({
          group: "edges",
          data: { id: `stashedge:${id}`, source: id, target: base, label: "stash edge" },
          classes: "stashEdge",
          selectable: false,
        } as any);

        const node = cy.$id(id);
        if (node.length > 0) {
          node.style({
            "border-color": stashLine,
            "background-color": stashBg,
            color: stashText,
          } as any);
          pushNodeAwayFromEdges(id, -1);
        }
      }
    }
  }

  function applyAvatars(cy: Core) {
    if (!graphSettings.showAvatarsOnGraph) {
      for (const n of cy.nodes().toArray()) {
        if (n.hasClass("refBadge") || n.hasClass("stashBadge")) continue;
        n.style("background-image" as any, "none");
      }
      return;
    }

    const avatarSize = 26;
    const pos = graphSettings.graphAvatarPosition;
    const posX = pos === "top-right" ? "100%" : "0%";
    const posY = "0%";

    for (const n of cy.nodes().toArray()) {
      if (n.hasClass("refBadge") || n.hasClass("stashBadge")) continue;
      const author = (n.data("author") as string) || "";
      if (!author) continue;

      const email = ((n.data("authorEmail") as string) || "").trim().toLowerCase();
      const gravatarUrl = email && showOnlineAvatars ? getGravatarCircleUrl(email, avatarSize) : null;
      const url = gravatarUrl || generateAvatarDataUrl(author, theme, avatarSize);

      n.style({
        "background-image": url,
        "background-width": `${avatarSize}px`,
        "background-height": `${avatarSize}px`,
        "background-position-x": posX,
        "background-position-y": posY,
        "background-fit": "none",
        "background-clip": "none",
        "background-image-containment": "over",
        "background-image-opacity": 1,
      } as any);

      if (email && showOnlineAvatars && !gravatarUrl) {
        const hash = n.id();
        loadGravatarCircle(email, md5Hex(email), avatarSize, () => {
          const c = cyRef.current;
          if (!c) return;
          const node = c.$id(hash);
          if (node.length === 0) return;
          const loaded = getGravatarCircleUrl(email, avatarSize);
          if (loaded) {
            node.style("background-image" as any, loaded);
          }
        });
      }
    }
  }

  function focusOnHash(hash: string, nextZoom?: number, yRatio?: number, attempt = 0) {
    const cy = cyRef.current;
    if (!cy) return;

    cy.resize();

    const node = cy.$id(hash);
    if (node.length === 0) return;

    if (typeof nextZoom === "number") {
      cy.zoom(nextZoom);
    }

    const container = graphRef.current;
    const cyW = cy.width() || 0;
    const cyH = cy.height() || 0;
    const h = cyH || container?.clientHeight || 0;
    if ((cyW <= 0 || cyH <= 0) && attempt < 10) {
      requestAnimationFrame(() => focusOnHash(hash, nextZoom, yRatio, attempt + 1));
      return;
    }

    cy.center(node);

    if (typeof yRatio === "number") {
      const pan = cy.pan();
      const desiredY = h * yRatio;
      const currentY = h / 2;
      cy.pan({ x: pan.x, y: pan.y + (desiredY - currentY) });
    }
  }

  function focusOnHead() {
    if (!headHash) return;
    focusOnHash(headHash, 1, 0.22);
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

  useEffect(() => {
    if (viewMode !== "graph") return;
    const cy = cyRef.current;
    if (!cy) return;
    applyRefBadges(cy);
  }, [
    activeRepoPath,
    graphSettings.showStashesOnGraph,
    graphSettings.showRemoteBranchesOnGraph,
    stashBaseByRepo,
    stashesByRepo,
    unsyncedTagNames,
    theme,
    viewMode,
    remoteNames,
  ]);

  useEffect(() => {
    if (viewMode !== "graph") return;
    const cy = cyRef.current;
    if (!cy) return;
    applyAvatars(cy);
  }, [
    graphSettings.showAvatarsOnGraph,
    graphSettings.graphAvatarPosition,
    showOnlineAvatars,
    theme,
    viewMode,
  ]);

  useEffect(() => {
    if (viewMode !== "graph") {
      if (cyRef.current && activeRepoPath) {
        if (!pendingAutoCenterByRepoRef.current[activeRepoPath]) {
          viewportByRepoRef.current[activeRepoPath] = {
            zoom: cyRef.current.zoom(),
            pan: cyRef.current.pan(),
          };
        }
      }
      cyRef.current?.destroy();
      cyRef.current = null;
      return;
    }

    if (!graphRef.current) return;

    cyRef.current?.destroy();

    const palette = getCyPalette(theme);
    cyRef.current = cytoscape({
      container: graphRef.current,
      elements: [...elements.nodes, ...elements.edges],
      minZoom: 0.1,
      maxZoom: 5,
      wheelSensitivity: isMacOS ? 0.14 : 0.6,
      layout: { name: "preset" } as any,
      style: [
        {
          selector: "node",
          style: {
            "background-color": palette.nodeBg,
            "border-color": palette.nodeBorder,
            "border-width": "1px",
            shape: "round-rectangle",
            "corner-radius": `${Math.max(0, graphSettings.nodeCornerRadius)}px`,
            label: "data(label)",
            color: palette.nodeText,
            "text-outline-width": "0px",
            "font-size": "12px",
            "font-weight": "bold",
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
            "border-color": palette.nodeHeadBorder,
            "border-width": "2px",
          },
        },
        {
          selector: "node.selected",
          style: {
            "border-color": palette.nodeSelectedBorder,
            "border-width": "3px",
            "background-color": palette.nodeSelectedBg,
          },
        },
        {
          selector: "node.placeholder",
          style: {
            "background-color": palette.placeholderBg,
            "border-color": palette.placeholderBorder,
            "border-width": "1px",
            color: palette.placeholderText,
          },
        },
        {
          selector: "edge",
          style: {
            width: "3px",
            "line-color": palette.edgeLine,
            "target-arrow-color": palette.edgeArrow,
            "target-arrow-shape": "triangle",
            "target-arrow-fill": "filled",
            "arrow-scale": 1.25,
            "curve-style": "bezier",
          },
        },
        {
          selector: "node.refBadge",
          style: {
            shape: "round-rectangle",
            width: "label",
            height: "24px",
            padding: "6px",
            "background-color": palette.refBadgeBg,
            "border-color": palette.refBadgeBorder,
            "border-width": "1px",
            label: "data(label)",
            color: palette.refBadgeText,
            "font-size": "12px",
            "font-weight": "bold",
            "text-valign": "center",
            "text-halign": "center",
            "text-wrap": "none",
          },
        },
        {
          selector: "node.refBadge.ref-head",
          style: {
            "background-color": palette.refHeadBg,
            "border-color": palette.refHeadBorder,
          },
        },
        {
          selector: "node.refBadge.ref-tag",
          style: {
            "background-color": palette.refTagBg,
            "border-color": palette.refTagBorder,
          },
        },
        {
          selector: "node.refBadge.ref-tag-unsynced",
          style: {
            "border-style": "dashed",
            "border-width": "2px",
          },
        },
        {
          selector: "node.refBadge.ref-branch",
          style: {
            "background-color": palette.refBranchBg,
            "border-color": palette.refBranchBorder,
          },
        },
        {
          selector: "node.refBadge.ref-remote",
          style: {
            "background-color": theme === "dark" ? "rgba(235, 246, 255, 0.98)" : palette.refRemoteBg,
            "border-color": palette.refRemoteBorder,
            color: palette.refRemoteText,
            opacity: theme === "dark" ? 0.6 : 0.4,
          },
        },
        {
          selector: "edge.refEdge",
          style: {
            width: "2px",
            "line-style": "dotted",
            "line-color": palette.refEdgeLine,
            "target-arrow-shape": "none",
            "curve-style": "straight",
          },
        },
        {
          selector: "node.stashBadge",
          style: {
            shape: "round-rectangle",
            width: "label",
            height: "22px",
            padding: "6px",
            "border-width": "2px",
            label: "data(label)",
            "font-size": "12px",
            "font-weight": "bold",
            "text-valign": "center",
            "text-halign": "center",
            "text-wrap": "none",
          },
        },
        {
          selector: "edge.stashEdge",
          style: {
            width: "2px",
            "line-style": "dotted",
            "target-arrow-shape": "none",
            "curve-style": "straight",
            label: "data(label)",
            "font-size": "11px",
            "text-rotation": "autorotate",
            color: theme === "dark" ? "rgba(242, 244, 248, 0.85)" : undefined,
            "text-background-color": theme === "dark" ? "rgba(15, 15, 15, 0.80)" : "rgba(255, 255, 255, 0.70)",
            "text-background-opacity": 1,
            "text-background-padding": "2px",
            "text-background-shape": "roundrectangle",
          },
        },
      ],
    });

    const cy = cyRef.current;
    if (!cy) return;

    const saved = activeRepoPath ? viewportByRepoRef.current[activeRepoPath] : undefined;
    if (activeRepoPath) {
      initializingByRepoRef.current[activeRepoPath] = true;
      if (saved) {
        cy.zoom(saved.zoom);
        cy.pan(saved.pan);
        setZoomPct(Math.round(cy.zoom() * 100));
      } else {
        cy.zoom(1);
        setZoomPct(100);
        pendingAutoCenterByRepoRef.current[activeRepoPath] = true;
        setAutoCenterToken((t) => t + 1);
      }
    }

    cy.on("tap", "node", (evt) => {
      if ((evt.target as any).hasClass?.("refBadge")) return;
      if ((evt.target as any).hasClass?.("stashBadge")) return;
      setSelectedHash(evt.target.id());
    });

    cy.on("cxttap", "node", (evt) => {
      if ((evt.target as any).hasClass?.("refBadge")) {
        const oe = (evt as any).originalEvent as MouseEvent | undefined;
        if (!oe) return;
        const kind = (((evt.target as any).data?.("kind") as string) || "").toLowerCase();
        const label = (((evt.target as any).data?.("label") as string) || "").trim();
        if (!label) return;

        closeCommitContextMenu();
        closeStashContextMenu();
        closeBranchContextMenu();
        closeTagContextMenu();

        if (kind === "remote" || kind === "branch") {
          closeRefBadgeContextMenu();
          openRefBadgeContextMenu(kind as "remote" | "branch", label, oe.clientX, oe.clientY);
        } else if (kind === "tag") {
          closeRefBadgeContextMenu();
          openTagContextMenu(label, oe.clientX, oe.clientY);
        }
        return;
      }
      if ((evt.target as any).hasClass?.("stashBadge")) {
        const oe = (evt as any).originalEvent as MouseEvent | undefined;
        if (!oe) return;
        const stashRef = ((evt.target as any).data?.("stashRef") as string) || "";
        const stashMessage = ((evt.target as any).data?.("stashMessage") as string) || "";
        if (!stashRef.trim()) return;
        closeCommitContextMenu();
        closeTagContextMenu();
        openStashContextMenu(stashRef, stashMessage, oe.clientX, oe.clientY);
        return;
      }
      const hash = evt.target.id();
      const oe = (evt as any).originalEvent as MouseEvent | undefined;
      if (!oe) return;
      setSelectedHash(hash);
      openCommitContextMenu(hash, oe.clientX, oe.clientY);
    });

    cy.on("tap", (evt) => {
      if ((evt.target as any).hasClass?.("stashEdge")) return;
      if (evt.target === cy) setSelectedHash("");
    });

    cy.on("cxttap", (evt) => {
      if (evt.target === cy) {
        closeCommitContextMenu();
        closeStashContextMenu();
        closeBranchContextMenu();
        closeTagContextMenu();
        closeRefBadgeContextMenu();
      }
    });

    const scheduleViewportUpdate = () => {
      if (!activeRepoPath) return;
      if (viewportRafRef.current) return;
      viewportRafRef.current = requestAnimationFrame(() => {
        viewportRafRef.current = null;
        const initializing = !!initializingByRepoRef.current[activeRepoPath];
        if (!initializing && !pendingAutoCenterByRepoRef.current[activeRepoPath]) {
          viewportByRepoRef.current[activeRepoPath] = {
            zoom: cy.zoom(),
            pan: cy.pan(),
          };
        }
        setZoomPct(Math.round(cy.zoom() * 100));
      });
    };
    cy.on("zoom pan", scheduleViewportUpdate);
    setZoomPct(Math.round(cy.zoom() * 100));

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        cy.resize();
        if (saved) {
          applyRefBadges(cy);
          applyAvatars(cy);
          if (activeRepoPath) initializingByRepoRef.current[activeRepoPath] = false;
          return;
        }

        focusOnHead();
        applyRefBadges(cy);
        applyAvatars(cy);
        if (activeRepoPath) {
          initializingByRepoRef.current[activeRepoPath] = false;
        }
        scheduleViewportUpdate();
      });
    });

    return () => {
      if (viewportRafRef.current) {
        cancelAnimationFrame(viewportRafRef.current);
        viewportRafRef.current = null;
      }
      cyRef.current?.destroy();
      cyRef.current = null;
    };
  }, [
    activeRepoPath,
    elements.edges,
    elements.nodes,
    graphSettings.nodeCornerRadius,
    graphSettings.padding,
    headHash,
    isMacOS,
    theme,
    viewMode,
  ]);

  useEffect(() => {
    if (viewMode !== "graph") return;

    const el = graphRef.current;
    if (!el) return;

    let attemptTimer: number | null = null;
    let clearPendingTimer: number | null = null;

    const attemptAutoCenter = () => {
      const cy = cyRef.current;
      if (!cy) return;

      if (!activeRepoPath) return;
      if (!pendingAutoCenterByRepoRef.current[activeRepoPath]) return;

      const hash = selectedHash || headHash;
      if (!hash) return;

      cy.resize();

      const cyW = cy.width() || 0;
      const cyH = cy.height() || 0;
      if (cyW <= 0 || cyH <= 0) return;

      const node = cy.$id(hash);
      if (node.length === 0) return;

      focusOnHash(hash, 1, 0.22);

      if (clearPendingTimer) window.clearTimeout(clearPendingTimer);
      clearPendingTimer = window.setTimeout(() => {
        if (!activeRepoPath) return;
        const c = cyRef.current;
        if (c) {
          viewportByRepoRef.current[activeRepoPath] = {
            zoom: c.zoom(),
            pan: c.pan(),
          };
          setZoomPct(Math.round(c.zoom() * 100));
        }
        pendingAutoCenterByRepoRef.current[activeRepoPath] = false;
      }, 350);
    };

    const scheduleAttempt = (delayMs: number) => {
      if (attemptTimer) window.clearTimeout(attemptTimer);
      attemptTimer = window.setTimeout(attemptAutoCenter, delayMs);
    };

    const ro = new ResizeObserver(() => {
      const cy = cyRef.current;
      if (!cy) return;
      cy.resize();

      if (clearPendingTimer) {
        window.clearTimeout(clearPendingTimer);
        clearPendingTimer = null;
      }
      scheduleAttempt(80);
    });

    ro.observe(el);

    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scheduleAttempt(0);
      });
    });

    const t0 = window.setTimeout(() => scheduleAttempt(0), 0);
    const t1 = window.setTimeout(() => scheduleAttempt(0), 150);
    const t2 = window.setTimeout(() => scheduleAttempt(0), 400);
    const t3 = window.setTimeout(() => scheduleAttempt(0), 1000);
    const t4 = window.setTimeout(() => scheduleAttempt(0), 2000);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t0);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.clearTimeout(t4);

      if (attemptTimer) window.clearTimeout(attemptTimer);
      if (clearPendingTimer) window.clearTimeout(clearPendingTimer);
      ro.disconnect();
    };
  }, [activeRepoPath, autoCenterToken, headHash, selectedHash, viewMode]);

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

  return {
    graphRef,
    zoomPct,
    requestAutoCenter,
    focusOnHash,
    focusOnHead,
    zoomBy,
  };
}
