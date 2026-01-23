import os from "os";
import path from "path";
import fs from "fs/promises";
import { spawnSync } from "child_process";

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
  const max = process.platform === "win32" ? 50 : 10;
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

async function setupBareRemoteWithBehindClone() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "graphoria-e2e-pull-"));

  const remoteBare = path.join(root, "remote.git");
  const seed = path.join(root, "seed");
  const clone1 = path.join(root, "clone1");
  const clone2 = path.join(root, "clone2");

  await fs.mkdir(remoteBare, { recursive: true });

  run("git", ["init", "--bare"], remoteBare);

  await fs.mkdir(seed, { recursive: true });
  run("git", ["init"], seed);
  run("git", ["config", "user.name", "Alice"], seed);
  run("git", ["config", "user.email", "alice@example.com"], seed);

  await fs.writeFile(path.join(seed, "a.txt"), "one\n", "utf-8");
  run("git", ["add", "."], seed);
  run("git", ["commit", "-m", "Initial"], seed);
  run("git", ["branch", "-M", "master"], seed);

  run("git", ["remote", "add", "origin", remoteBare], seed);
  run("git", ["push", "-u", "origin", "master"], seed);

  run("git", ["clone", remoteBare, clone1], root);
  run("git", ["clone", remoteBare, clone2], root);

  const headBefore = run("git", ["rev-parse", "HEAD"], clone1);

  run("git", ["config", "user.name", "Bob"], clone2);
  run("git", ["config", "user.email", "bob@example.com"], clone2);

  await fs.writeFile(path.join(clone2, "b.txt"), "two\n", "utf-8");
  run("git", ["add", "."], clone2);
  run("git", ["commit", "-m", "Upstream"], clone2);
  run("git", ["push"], clone2);

  const headAfter = run("git", ["rev-parse", "HEAD"], clone2);

  return { root, clone1, headBefore, headAfter };
}

describe("Graphoria pull", () => {
  let env;

  before(async () => {
    env = await setupBareRemoteWithBehindClone();
  });

  after(async () => {
    if (env?.root) {
      await wait(500);
      await rmWithRetry(env.root);
    }
  });

  it("pull updates the repository to the latest commit", async () => {
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
    }, env.clone1);

    const commitsList = await $(".commitsList");
    await commitsList.waitForExist({ timeout: 60000 });

    const beforeRow = await $(`[data-commit-hash="${env.headBefore}"]`);
    await beforeRow.waitForExist({ timeout: 60000 });

    const pullButton = await $(".toolbar button[title=\"git pull (merge)\"]");
    await pullButton.waitForExist({ timeout: 60000 });
    await pullButton.waitForEnabled({ timeout: 60000 });
    await pullButton.click();

    await browser.waitUntil(
      async () => {
        const el = await $(`[data-commit-hash="${env.headAfter}"]`);
        return el.isExisting();
      },
      { timeout: 90000, interval: 500 }
    );
  });
});
