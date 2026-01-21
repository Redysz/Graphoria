import type { ThemeName, GitHistoryOrder } from "../../appSettingsStore";
import type { GitCommit } from "../../types/git";

export type CommitLaneRow = {
  hash: string;
  lane: number;
  activeTop: number[];
  activeBottom: number[];
  parentLanes: number[];
  joinLanes: number[];
};

export function laneStrokeColor(lane: number, theme: ThemeName) {
  const hue = (lane * 47) % 360;
  const sat = theme === "dark" ? 72 : 66;
  const light = theme === "dark" ? 62 : 44;
  return `hsl(${hue} ${sat}% ${light}%)`;
}

export function computeCommitLaneRows(commits: GitCommit[], historyOrder: GitHistoryOrder): { rows: CommitLaneRow[]; maxLanes: number } {
  const cols: Array<string | null> = [];
  const rows: CommitLaneRow[] = [];
  let maxLanes = 0;

  const present = new Set(commits.map((c) => c.hash));

  const activeLaneIndices = () => {
    const out: number[] = [];
    for (let i = 0; i < cols.length; i++) {
      if (cols[i] !== null) out.push(i);
    }
    return out;
  };

  const ensureLaneForCommit = (hash: string) => {
    let lane = cols.indexOf(hash);
    if (lane >= 0) return lane;
    lane = cols.indexOf(null);
    if (lane >= 0) {
      cols[lane] = hash;
      return lane;
    }
    cols.push(hash);
    return cols.length - 1;
  };

  const allocLaneAfter = (afterLane: number) => {
    for (let i = afterLane + 1; i < cols.length; i++) {
      if (cols[i] === null) return i;
    }
    cols.push(null);
    return cols.length - 1;
  };

  for (const c of commits) {
    const activeTop = activeLaneIndices();

    const lane = ensureLaneForCommit(c.hash);

    const joinLanes: number[] = [];
    for (let i = 0; i < cols.length; i++) {
      if (i === lane) continue;
      if (cols[i] === c.hash) {
        joinLanes.push(i);
        cols[i] = null;
      }
    }

    const p0 = c.parents[0] ?? null;
    cols[lane] = p0 && present.has(p0) ? p0 : null;

    const parentLanes: number[] = [];
    const parents = historyOrder === "first_parent" ? [] : c.parents;
    for (let i = 1; i < parents.length; i++) {
      const p = parents[i];
      if (!p) continue;
      if (!present.has(p)) continue;
      const existing = cols.indexOf(p);
      if (existing >= 0) {
        parentLanes.push(existing);
        continue;
      }
      const pLane = allocLaneAfter(lane);
      cols[pLane] = p;
      parentLanes.push(pLane);
    }

    while (cols.length > 0 && cols[cols.length - 1] === null) {
      cols.pop();
    }

    maxLanes = Math.max(maxLanes, cols.length);
    const activeBottom = activeLaneIndices();

    rows.push({
      hash: c.hash,
      lane,
      activeTop,
      activeBottom,
      parentLanes,
      joinLanes,
    });
  }

  return { rows, maxLanes };
}

export function computeCompactLaneByHashForGraph(commits: GitCommit[], historyOrder: GitHistoryOrder): Map<string, number> {
  const present = new Set(commits.map((c) => c.hash));
  const cols: string[] = [];
  const laneByHash = new Map<string, number>();

  const removeDuplicatesKeep = (hash: string, keepIdx: number) => {
    for (let i = cols.length - 1; i >= 0; i--) {
      if (i === keepIdx) continue;
      if (cols[i] !== hash) continue;
      cols.splice(i, 1);
      if (i < keepIdx) keepIdx--;
    }
    return keepIdx;
  };

  for (const c of commits) {
    let lane = cols.indexOf(c.hash);
    if (lane < 0) {
      lane = cols.length;
      cols.push(c.hash);
    }
    lane = removeDuplicatesKeep(c.hash, lane);
    laneByHash.set(c.hash, lane);

    const p0 = c.parents[0] ?? null;
    const primary = p0 && present.has(p0) ? p0 : null;

    if (primary) {
      cols[lane] = primary;
    } else {
      cols.splice(lane, 1);
    }

    const insertBase = primary ? lane + 1 : lane;
    let insertAt = Math.min(insertBase, cols.length);

    const parents = historyOrder === "first_parent" ? [] : c.parents;
    for (let i = 1; i < parents.length; i++) {
      const p = parents[i];
      if (!p) continue;
      if (!present.has(p)) continue;
      if (cols.includes(p)) continue;
      cols.splice(insertAt, 0, p);
      insertAt++;
    }
  }

  return laneByHash;
}
