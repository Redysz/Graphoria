import type { CyPalette, ThemeName } from "../../appSettingsStore";
import { laneStrokeColor, type CommitLaneRow } from "./lanes";

export function CommitLaneSvg(props: {
  row: CommitLaneRow;
  maxLanes: number;
  theme: ThemeName;
  selected: boolean;
  isHead: boolean;
  showMergeStub: boolean;
  mergeParentCount: number;
  nodeBg: string;
  palette: CyPalette;
  refMarkers: Array<{ kind: "head" | "branch" | "tag" | "remote"; label: string }>;
}) {
  const { row, maxLanes, theme, selected, isHead, showMergeStub, mergeParentCount, nodeBg, palette, refMarkers } = props;

  const laneStep = 12;
  const lanePad = 10;
  const h = 64;
  const yMid = h / 2;
  const yTop = 0;
  const yBottom = h;

  const extraW = 56;
  const w = Math.max(28, lanePad * 2 + Math.max(1, Math.min(maxLanes, 10)) * laneStep + extraW);

  const xForLane = (lane: number) => lanePad + lane * laneStep;

  const strokeWidth = selected ? 2.25 : 2;

  const paths: Array<{ d: string; color: string }> = [];
  const joinPaths: Array<{ d: string; color: string }> = [];

  const parentLaneSet = new Set(row.parentLanes);
  const joinLaneSet = new Set(row.joinLanes);
  const activeTopSet = new Set(row.activeTop);

  for (const lane of row.parentLanes) {
    const x0 = xForLane(row.lane);
    const x1 = xForLane(lane);
    const c0y = yMid + 18;
    const d = `M ${x0} ${yMid} C ${x0} ${c0y}, ${x1} ${c0y}, ${x1} ${yBottom}`;
    paths.push({ d, color: laneStrokeColor(lane, theme) });
  }

  for (const lane of row.joinLanes) {
    const x0 = xForLane(lane);
    const x1 = xForLane(row.lane);
    const c0y = yMid - 18;
    const d = `M ${x0} ${yTop} C ${x0} ${c0y}, ${x1} ${c0y}, ${x1} ${yMid}`;
    joinPaths.push({ d, color: laneStrokeColor(lane, theme) });
  }

  const nodeX = xForLane(row.lane);
  const nodeColor = laneStrokeColor(row.lane, theme);

  const markerSize = 10;
  const markerGap = 4;
  const maxMarkers = 3;
  const markersShown = refMarkers.slice(0, maxMarkers);
  const markersX0 = nodeX + 12;
  const markersY0 = yMid - markerSize / 2;

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ display: "block" }}
      aria-hidden="true"
      focusable={false}
    >
      {row.activeTop.map((lane) => {
        if (joinLaneSet.has(lane)) return null;
        const x = xForLane(lane);
        const color = laneStrokeColor(lane, theme);
        return <line key={`t-${lane}`} x1={x} y1={yTop} x2={x} y2={yMid} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />;
      })}
      {row.activeBottom.map((lane) => {
        if (parentLaneSet.has(lane) && (!activeTopSet.has(lane) || joinLaneSet.has(lane))) return null;
        const x = xForLane(lane);
        const color = laneStrokeColor(lane, theme);
        return <line key={`b-${lane}`} x1={x} y1={yMid} x2={x} y2={yBottom} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />;
      })}
      {paths.map((p, idx) => (
        <path key={`p-${idx}`} d={p.d} fill="none" stroke={p.color} strokeWidth={strokeWidth} strokeLinecap="round" />
      ))}
      {joinPaths.map((p, idx) => (
        <path key={`j-${idx}`} d={p.d} fill="none" stroke={p.color} strokeWidth={strokeWidth} strokeLinecap="round" />
      ))}
      <circle
        cx={nodeX}
        cy={yMid}
        r={selected ? 6 : 5.4}
        fill={isHead ? nodeColor : nodeBg}
        stroke={nodeColor}
        strokeWidth={selected ? 2.6 : isHead ? 2.3 : 2}
      />
      {showMergeStub ? (
        <g>
          <title>{`Merge commit (${mergeParentCount} parents)`}</title>
          <path
            d={`M ${nodeX + 10} ${yMid - 7} L ${nodeX + 5} ${yMid} L ${nodeX + 10} ${yMid + 7}`}
            fill="none"
            stroke={nodeColor}
            strokeWidth={selected ? 2.2 : 2}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.9}
          />
        </g>
      ) : null}
      {markersShown.map((m, idx) => {
        const x = markersX0 + idx * (markerSize + markerGap);
        const y = markersY0;
        const fill =
          m.kind === "head"
            ? palette.refHeadBg
            : m.kind === "tag"
              ? palette.refTagBg
              : m.kind === "remote"
                ? palette.refRemoteBg
                : palette.refBranchBg;
        const stroke =
          m.kind === "head"
            ? palette.refHeadBorder
            : m.kind === "tag"
              ? palette.refTagBorder
              : m.kind === "remote"
                ? palette.refRemoteBorder
                : palette.refBranchBorder;

        if (m.kind === "remote") {
          const isRemoteHead = /\/HEAD$/.test(m.label);
          const remoteFill = isRemoteHead ? palette.refHeadBg : fill;
          const remoteStroke = isRemoteHead ? palette.refHeadBorder : stroke;
          return (
            <g key={`m-${idx}`}>
              <title>{m.label}</title>
              <circle cx={x + markerSize / 2} cy={y + markerSize / 2} r={markerSize / 2} fill={remoteFill} stroke={remoteStroke} strokeWidth={1} />
              <circle cx={x + markerSize / 2} cy={y + markerSize / 2} r={2} fill={palette.refRemoteText} opacity={0.7} />
            </g>
          );
        }

        if (m.kind === "tag") {
          const p1 = `${x + markerSize / 2} ${y}`;
          const p2 = `${x + markerSize} ${y + markerSize}`;
          const p3 = `${x} ${y + markerSize}`;
          return (
            <g key={`m-${idx}`}>
              <title>{m.label}</title>
              <polygon points={`${p1}, ${p2}, ${p3}`} fill={fill} stroke={stroke} strokeWidth={1} />
            </g>
          );
        }

        if (m.kind === "head") {
          return (
            <g key={`m-${idx}`}>
              <title>{m.label}</title>
              <rect x={x} y={y} width={markerSize} height={markerSize} rx={3} fill={fill} stroke={stroke} strokeWidth={1} />
              <path
                d={`M ${x + 5} ${y + 2} L ${x + 7} ${y + 6} L ${x + 11} ${y + 6} L ${x + 8} ${y + 8} L ${x + 9} ${y + 12} L ${x + 5} ${y + 10} L ${x + 1} ${y + 12} L ${x + 2} ${y + 8} L ${x - 1} ${y + 6} L ${x + 3} ${y + 6} Z`}
                fill={stroke}
                opacity={0.55}
              />
            </g>
          );
        }

        return (
          <g key={`m-${idx}`}>
            <title>{m.label}</title>
            <rect x={x} y={y} width={markerSize} height={markerSize} rx={3} fill={fill} stroke={stroke} strokeWidth={1} />
          </g>
        );
      })}
      {refMarkers.length > maxMarkers ? (
        <text
          x={markersX0 + maxMarkers * (markerSize + markerGap)}
          y={yMid + 4}
          fontSize={10}
          fill={theme === "dark" ? "rgba(242, 244, 248, 0.75)" : "rgba(15, 15, 15, 0.65)"}
        >
          +{refMarkers.length - maxMarkers}
        </text>
      ) : null}
    </svg>
  );
}
