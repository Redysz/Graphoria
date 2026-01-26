import os from "os";
import path from "path";
import fs from "fs/promises";
import { spawnSync } from "child_process";
import assert from "node:assert/strict";

function run(cmd, args, cwd) {
  const out = spawnSync(cmd, args, { cwd, encoding: "utf-8" });
  if (out.error) {
    throw out.error;
  }
  if (typeof out.status === "number" && out.status !== 0) {
    const stderr = (out.stderr ?? "").trim();
    throw new Error(`${cmd} ${args.join(" ")} failed: ${stderr}`);
  }
  return (out.stdout ?? "").trim();
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rmWithRetry(p) {
  const max = process.platform === "win32" ? 30 : 10;
  for (let i = 0; i < max; i++) {
    try {
      await fs.rm(p, { recursive: true, force: true });
      return;
    } catch (e) {
      const code = e?.code;
      if (code === "EBUSY" || code === "EPERM" || code === "ENOTEMPTY") {
        await wait(100 * (i + 1));
        continue;
      }
      throw e;
    }
  }
  try {
    await fs.rm(p, { recursive: true, force: true });
  } catch {}
}

async function createMiniRepo() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "graphoria-e2e-"));

  run("git", ["init"], dir);
  run("git", ["config", "user.name", "Alice"], dir);
  run("git", ["config", "user.email", "alice@example.com"], dir);

  await fs.writeFile(path.join(dir, "a.txt"), "one\n", "utf-8");
  run("git", ["add", "."], dir);
  run("git", ["commit", "-m", "Initial"], dir);
  run("git", ["tag", "v1.0"], dir);

  await fs.writeFile(path.join(dir, "a.txt"), "two\n", "utf-8");
  run("git", ["add", "."], dir);
  run("git", ["commit", "-m", "Second"], dir);

  const commitHashes = run("git", ["rev-list", "--max-count=2", "HEAD"], dir)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  return { dir, commitHashes };
}

describe("Graphoria", () => {
  let repo;

  before(async () => {
    repo = await createMiniRepo();
  });

  after(async () => {
    if (repo?.dir) {
      await rmWithRetry(repo.dir);
    }
  });

  it("opens repo, shows commits and details, renders graph", async () => {
    await browser.waitUntil(
      async () => {
        const installed = await browser.execute(() => Boolean(window.__graphoria_test_backdoor_installed));
        return installed;
      },
      { timeout: 60000, interval: 200 }
    );

    await browser.execute(() => {
      window.dispatchEvent(new CustomEvent("graphoria-reset-settings"));
    });

    await browser.execute((repoPath) => {
      window.dispatchEvent(new CustomEvent("graphoria-open-repo", { detail: { repoPath, viewMode: "commits" } }));
    }, repo.dir);

    const commitsList = await $(".commitsList");
    await commitsList.waitForExist({ timeout: 60000 });

    const firstHash = repo.commitHashes[0];
    const firstRow = await $(`[data-commit-hash="${firstHash}"]`);
    await firstRow.waitForExist({ timeout: 60000 });
    await firstRow.click();

    const details = await $(".details");
    await details.waitForExist({ timeout: 60000 });

    const detailsText = await details.getText();
    assert.ok(detailsText.includes("Author"));
    assert.ok(detailsText.includes("Alice (alice@example.com)"));
    assert.ok(detailsText.includes("Refs"));
    assert.ok(/HEAD\s*->\s*(master|main)/i.test(detailsText));

    const graphButton = await $(".mainHeader").$("button=Graph");
    await graphButton.click();

    const cyCanvas = await $(".cyCanvas");
    await cyCanvas.waitForExist({ timeout: 60000 });

    await browser.waitUntil(
      async () => {
        const n = await browser.execute(() => document.querySelectorAll(".cyCanvas canvas").length);
        return n > 0;
      },
      { timeout: 60000, interval: 250 }
    );

    const zoomControls = await $(".zoomControls");
    await zoomControls.waitForExist({ timeout: 60000 });
  });
});
