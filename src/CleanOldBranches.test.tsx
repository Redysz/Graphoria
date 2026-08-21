import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { GRAPHORIA_OPEN_REPO_EVENT } from "./testing/backdoor";
import type { GitBranchInfo, RepoOverview } from "./types/git";

const repoPath = "C:/tmp/repo";

function oldDate(daysAgo: number) {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString();
}

const branches: GitBranchInfo[] = [
  { name: "master", kind: "local", target: "aaaa", committer_date: oldDate(1) },
  { name: "fix/team_162", kind: "local", target: "bbbb", committer_date: oldDate(123) },
  { name: "feature/team_494", kind: "local", target: "cccc", committer_date: oldDate(94) },
];

const overview: RepoOverview = {
  head: "aaaa",
  head_name: "master",
  branches: ["master", "fix/team_162", "feature/team_494"],
  tags: [],
  remotes: [],
};

const notFullyMergedError = (b: string) =>
  `git command failed: error: the branch '${b}' is not fully merged\nhint: If you are sure you want to delete it, run 'git branch -D ${b}'\nhint: Disable this message with "git config set advice.forceDeleteBranch false"`;

async function setupApp() {
  const { invoke } = await import("@tauri-apps/api/core");
  const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
  const deleteCalls: Array<{ branch: string; force: boolean }> = [];

  invokeMock.mockImplementation(async (cmd: string, args?: any) => {
    if (cmd === "list_commits") return [];
    if (cmd === "repo_overview") return overview;
    if (cmd === "git_status_summary") return { changed: 0 };
    if (cmd === "git_stash_list") return [];
    if (cmd === "git_get_remote_url") return null;
    if (cmd === "git_list_branches") return branches;
    if (cmd === "git_delete_branch") {
      const branch = String(args?.branch ?? "");
      const force = Boolean(args?.force);
      deleteCalls.push({ branch, force });
      if (!force) throw notFullyMergedError(branch);
      return "";
    }
    return undefined;
  });

  render(<App />);

  act(() => {
    window.dispatchEvent(new CustomEvent(GRAPHORIA_OPEN_REPO_EVENT, { detail: { repoPath, viewMode: "commits" } }));
  });

  return { deleteCalls };
}

function modal(title: string) {
  const heading = screen.getByText(title);
  return heading.closest(".modal") as HTMLElement;
}

async function openCleanOldBranchesModalAndDelete() {
  await userEvent.click(await screen.findByText("Tools"));
  await userEvent.click(await screen.findByText("Clean old branches…"));

  await screen.findByText("Clean old branches");
  const cleanModal = modal("Clean old branches");
  await waitFor(() => expect(within(cleanModal).getByText("fix/team_162")).toBeInTheDocument());

  await userEvent.click(within(cleanModal).getByRole("button", { name: /^Delete \(2\)$/ }));

  const confirm = await screen.findByText("Delete branches");
  await userEvent.click(within(confirm.closest(".modal") as HTMLElement).getByRole("button", { name: "Delete" }));

  return cleanModal;
}

describe("Clean old branches - unmerged branches", () => {
  afterEach(() => cleanup());

  it("asks for confirmation and force-deletes when the user confirms", async () => {
    const { deleteCalls } = await setupApp();
    await openCleanOldBranchesModalAndDelete();

    expect(await screen.findByText("Delete unmerged branches?")).toBeInTheDocument();
    const confirm = modal("Delete unmerged branches?");
    expect(within(confirm).getByText(/2 branch\(es\) are not fully merged/)).toBeInTheDocument();

    await userEvent.click(within(confirm).getByRole("button", { name: "Yes, force delete" }));

    await waitFor(() => expect(deleteCalls.filter((c) => c.force)).toHaveLength(2));
    expect(
      deleteCalls
        .filter((c) => c.force)
        .map((c) => c.branch)
        .sort()
    ).toEqual(["feature/team_494", "fix/team_162"]);
    expect(screen.queryByText(/hint:/)).toBeNull();
  });

  it("skips unmerged branches when the user declines", async () => {
    const { deleteCalls } = await setupApp();
    const cleanModal = await openCleanOldBranchesModalAndDelete();

    await screen.findByText("Delete unmerged branches?");
    await userEvent.click(within(modal("Delete unmerged branches?")).getByRole("button", { name: "No" }));

    await waitFor(() => {
      expect(within(cleanModal).getByText(/skipped: branch is not fully merged/)).toBeInTheDocument();
    });
    expect(deleteCalls.some((c) => c.force)).toBe(false);
    expect(screen.queryByText(/hint:/)).toBeNull();
  });
});
