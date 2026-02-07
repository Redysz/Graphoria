import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import DiffToolModal from "./DiffToolModal";

describe("DiffToolModal clipboard diff", () => {
  it("aligns repeated lines correctly (a/100%/b/c vs b/102%/b/c)", async () => {
    const user = userEvent.setup();

    const { container } = render(
      <DiffToolModal open onClose={() => undefined} repos={[]} activeRepoPath="" />,
    );

    await user.click(screen.getByRole("button", { name: "Clipboard" }));

    const textareas = Array.from(container.querySelectorAll("textarea"));
    expect(textareas.length).toBeGreaterThanOrEqual(2);

    await user.clear(textareas[0]!);
    await user.type(textareas[0]!, "a\n100%\nb\nc");

    await user.clear(textareas[1]!);
    await user.type(textareas[1]!, "b\n102%\nb\nc");

    const compareBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Compare");
    expect(compareBtn).toBeTruthy();
    await user.click(compareBtn!);

    await waitFor(() => {
      const rightPane = container.querySelector(".splitDiffPaneRight");
      expect(rightPane).toBeTruthy();
      expect(rightPane!.textContent).toContain("102%");
    });

    const rightPane = container.querySelector(".splitDiffPaneRight") as HTMLElement;
    const added = Array.from(rightPane.querySelectorAll(".diffLine-add"));
    expect(added.length).toBeGreaterThanOrEqual(2);
    expect(added[0]?.textContent?.trim()).toBe("b");
    expect(added.some((el) => el.textContent?.trim() === "102%")).toBe(true);
  });
});
