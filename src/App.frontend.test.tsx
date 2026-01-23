import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import App from "./App";
import { GRAPHORIA_OPEN_REPO_EVENT } from "./testing/backdoor";
import type { GitCommit, RepoOverview } from "./types/git";

function makeCommit(partial: Partial<GitCommit>): GitCommit {
  return {
    hash: partial.hash ?? "0000000",
    parents: partial.parents ?? [],
    author: partial.author ?? "",
    author_email: partial.author_email ?? "",
    date: partial.date ?? "2026-01-01T00:00:00Z",
    subject: partial.subject ?? "",
    refs: partial.refs ?? "",
    is_head: partial.is_head ?? false,
  };
}

describe("Graphoria frontend flow", () => {
  it("auto-open repo -> shows commits -> click commit -> Details shows Author and Refs", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

    const repoPath = "C:/tmp/repo";

    const commits: GitCommit[] = [
      makeCommit({
        hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        author: "Alice",
        author_email: "alice@example.com",
        subject: "Initial commit",
        refs: "HEAD -> master, tag: v1.0.0",
        is_head: true,
      }),
      makeCommit({
        hash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        author: "Bob",
        author_email: "bob@example.com",
        subject: "Second commit",
        refs: "origin/master",
        is_head: false,
      }),
    ];

    const overview: RepoOverview = {
      head: commits[0]!.hash,
      head_name: "master",
      branches: ["master"],
      tags: ["v1.0.0"],
      remotes: ["origin"],
    };

    invokeMock.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "git_check_worktree") return;

      if (cmd === "list_commits") {
        expect(args?.repoPath).toBe(repoPath);
        return commits;
      }

      if (cmd === "repo_overview") {
        return overview;
      }

      if (cmd === "git_status_summary") {
        return { changed: 0 };
      }

      if (cmd === "git_stash_list") {
        return [];
      }

      if (cmd === "git_get_remote_url") {
        return null;
      }

      return undefined;
    });

    render(<App />);

    act(() => {
      window.dispatchEvent(new CustomEvent(GRAPHORIA_OPEN_REPO_EVENT, { detail: { repoPath, viewMode: "commits" } }));
    });

    await waitFor(() => {
      expect(document.querySelector(".commitsList")).toBeTruthy();
      expect(document.querySelector(`[data-commit-hash="${commits[0]!.hash}"]`)).toBeTruthy();
    });

    const initialRow = document.querySelector(`[data-commit-hash="${commits[0]!.hash}"]`) as HTMLElement | null;
    expect(initialRow).toBeTruthy();

    await userEvent.click(initialRow!);

    expect(await screen.findByText("Author")).toBeInTheDocument();
    expect(screen.getByText("Alice (alice@example.com)")).toBeInTheDocument();
    expect(screen.getByText("Refs")).toBeInTheDocument();

    const refsValue = screen.getByText(/HEAD -> master/i);
    expect(refsValue).toBeInTheDocument();

    const allRows = document.querySelectorAll(".commitRow");
    expect(allRows.length).toBeGreaterThanOrEqual(2);

    const selected = document.querySelector(".commitRowSelected");
    expect(selected).toBeTruthy();

    expect(invokeMock).toHaveBeenCalled();
  });
});
