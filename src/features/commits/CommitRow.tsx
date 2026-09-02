import { memo, useMemo, type CSSProperties } from "react";
import type { CyPalette, ThemeName } from "../../appSettingsStore";
import type { GitCommit } from "../../types/git";
import { fnv1a32 } from "../../utils/hash";
import { authorInitials, shortHash, truncate } from "../../utils/text";
import { CommitLaneSvg } from "./CommitLaneSvg";
import { parseRefs } from "./refs";
import type { CommitLaneRow } from "./lanes";

const EMPTY_LANE_ROW: Omit<CommitLaneRow, "hash"> = {
  lane: 0,
  activeTop: [],
  activeBottom: [],
  parentLanes: [],
  joinLanes: [],
};

export type CommitRowProps = {
  commit: GitCommit;
  selected: boolean;
  laneRow: CommitLaneRow | undefined;
  hasLanes: boolean;
  maxLanes: number;
  theme: ThemeName;
  palette: CyPalette;
  nodeBg: string;
  firstParentOrder: boolean;
  remotes: string[];
  /** Resolved by the parent so a gravatar arriving only re-renders the rows it belongs to. */
  avatarUrl: string | null;
  interactionsEnabled: boolean;
  onSelect: (hash: string) => void;
  onOpenDetails: (hash: string) => void;
  onContextMenu: (hash: string, x: number, y: number) => void;
};

/**
 * A single row of the commit list.
 *
 * Memoized because the list renders up to 2000 rows and each one draws an SVG lane graph. Without
 * this, merely moving the selection re-rendered every row, which is what made highlighting feel
 * sluggish. Keep every prop stable in the parent, or the memoization is worthless.
 */
export const CommitRow = memo(function CommitRow({
  commit,
  selected,
  laneRow,
  hasLanes,
  maxLanes,
  theme,
  palette,
  nodeBg,
  firstParentOrder,
  remotes,
  avatarUrl,
  interactionsEnabled,
  onSelect,
  onOpenDetails,
  onContextMenu,
}: CommitRowProps) {
  const refMarkers = useMemo(() => parseRefs(commit.refs, remotes), [commit.refs, remotes]);

  const row = useMemo<CommitLaneRow>(
    () => laneRow ?? { hash: commit.hash, ...EMPTY_LANE_ROW },
    [laneRow, commit.hash],
  );

  const avatarStyle = useMemo(
    () =>
      ({
        ["--avatar-c1" as any]: `hsl(${fnv1a32(commit.author) % 360} 72% ${theme === "dark" ? 58 : 46}%)`,
        ["--avatar-c2" as any]: `hsl(${(fnv1a32(commit.author + "::2") + 28) % 360} 72% ${theme === "dark" ? 48 : 38}%)`,
      }) as CSSProperties,
    [commit.author, theme],
  );

  return (
    <button
      data-commit-hash={commit.hash}
      type="button"
      onClick={() => onSelect(commit.hash)}
      onDoubleClick={() => onOpenDetails(commit.hash)}
      onContextMenu={(e) => {
        if (!interactionsEnabled) return;
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(commit.hash, e.clientX, e.clientY);
      }}
      className={selected ? "commitRow commitRowSelected" : "commitRow"}
    >
      <div className="commitRowGrid">
        <div
          className="commitGraphCell"
          style={{
            width: maxLanes > 0 ? Math.max(28, 20 + Math.min(maxLanes, 10) * 12 + 56) : 28,
          }}
        >
          {hasLanes ? (
            <CommitLaneSvg
              row={row}
              maxLanes={maxLanes}
              theme={theme}
              selected={selected}
              isHead={commit.is_head}
              showMergeStub={firstParentOrder && commit.parents.length > 1}
              mergeParentCount={commit.parents.length}
              nodeBg={nodeBg}
              palette={palette}
              refMarkers={refMarkers}
            />
          ) : null}
        </div>
        <div className="commitAvatar" style={avatarStyle} title={commit.author}>
          <span className="commitAvatarText">{authorInitials(commit.author)}</span>
          {avatarUrl ? (
            <img
              className="commitAvatarImg"
              src={avatarUrl}
              alt={commit.author}
              decoding="async"
              referrerPolicy="no-referrer"
              draggable={false}
            />
          ) : null}
        </div>
        <div className="commitRowMain">
          <div className="commitRowTop">
            <span className="commitHash">{shortHash(commit.hash)}</span>
            <span className="commitSubject">{truncate(commit.subject, 100)}</span>
            {commit.is_head ? <span className="commitHead">(HEAD)</span> : null}
          </div>
          <div className="commitMeta">
            {commit.author} — {commit.date}
          </div>
        </div>
      </div>
    </button>
  );
});
