import type { RepoOverview } from "../types/git";
import { repoNameFromPath } from "../utils/text";

export function MainHeader(props: {
  activeRepoPath: string;
  overview: RepoOverview | undefined;
  viewMode: "graph" | "commits";
  setViewMode: (next: "graph" | "commits") => void;
}) {
  const { activeRepoPath, overview, viewMode, setViewMode } = props;

  return (
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
  );
}
