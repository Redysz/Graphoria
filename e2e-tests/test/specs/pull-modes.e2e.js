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

async function setupTwoUserRepo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "graphoria-e2e-pull-modes-"));

  const remoteBare = path.join(root, "remote.git");
  const seed = path.join(root, "seed");
  const bob = path.join(root, "bob");
  const alice = path.join(root, "alice");

  await fs.mkdir(remoteBare, { recursive: true });
  run("git", ["init", "--bare"], remoteBare);

  await fs.mkdir(seed, { recursive: true });
  run("git", ["init"], seed);
  run("git", ["branch", "-M", "master"], seed);
  run("git", ["config", "user.name", "Seeder"], seed);
  run("git", ["config", "user.email", "seeder@example.com"], seed);

  await fs.writeFile(path.join(seed, "readme.md"), "seed\n", "utf-8");
  run("git", ["add", "."], seed);
  run("git", ["commit", "-m", "Seed"], seed);

  run("git", ["remote", "add", "origin", remoteBare], seed);
  run("git", ["push", "-u", "origin", "master"], seed);

  run("git", ["clone", remoteBare, bob], root);
  run("git", ["clone", remoteBare, alice], root);

  return { root, remoteBare, seed, bob, alice, branch: "master" };
}

async function waitForBackdoor() {
  await browser.waitUntil(
    async () => {
      const installed = await browser.execute(() => Boolean(window.__graphoria_test_backdoor_installed));
      return installed;
    },
    { timeout: 60000, interval: 200 }
  );
}

async function closeAllReposAndWait() {
  await browser.execute(() => {
    window.dispatchEvent(new CustomEvent("graphoria-close-all-repos"));
  });

  const tabs = await $(".tabs");
  await tabs.waitForExist({ timeout: 60000 });

  await browser.waitUntil(
    async () => {
      const t = await tabs.getText();
      return t.includes("No repository opened");
    },
    { timeout: 60000, interval: 250 }
  );
}

async function dismissAnyModal() {
  const overlay = await $(".modalOverlay");
  if (!(await overlay.isExisting())) return;

  const header = await $(".modalHeader");
  const closeBtn = await header.$("button=Close");
  if (await closeBtn.isExisting()) {
    await closeBtn.waitForEnabled({ timeout: 60000 });
    await closeBtn.click();
  } else {
    const footer = await $(".modalFooter");
    const cancelBtn = await footer.$("button=Cancel");
    if (await cancelBtn.isExisting()) {
      await cancelBtn.waitForEnabled({ timeout: 60000 });
      await cancelBtn.click();
    } else {
      await browser.keys(["Escape"]);
    }
  }

  await browser.waitUntil(
    async () => {
      const anyModal = await $(".modalOverlay");
      return !(await anyModal.isExisting());
    },
    { timeout: 60000, interval: 250 }
  );
}

async function tauriInvoke(command, payload) {
  return await browser.execute(
    async (cmd, args) => {
      const w = window;
      if (typeof w.__graphoria_invoke !== "function") {
        throw new Error("Graphoria test invoke bridge is not available (window.__graphoria_invoke). Ensure installTestBackdoor is active.");
      }
      return await w.__graphoria_invoke(cmd, args);
    },
    command,
    payload
  );
}

async function setRepoIdentity(repoPath, userName, userEmail) {
  await tauriInvoke("git_set_user_identity", { scope: "repo", userName, userEmail, repoPath });
}

async function commitAndPush(repoPath, relPath, content, message, branch = "master") {
  const abs = path.join(repoPath, relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf-8");

  await tauriInvoke("git_commit", { repoPath, message, paths: [relPath] });
  await tauriInvoke("git_push", { repoPath, remoteName: "origin", branch, force: false, withLease: true });
}

async function syncToOriginBranch(repoPath, branch = "master") {
  await tauriInvoke("git_fetch", { repoPath, remoteName: "origin" });
  run("git", ["checkout", branch], repoPath);
  run("git", ["reset", "--hard", `origin/${branch}`], repoPath);
}

async function resolveHead(repoPath) {
  return await tauriInvoke("git_resolve_ref", { repoPath, reference: "HEAD" });
}

function headParents(repoPath) {
  const raw = run("git", ["rev-list", "--parents", "-n", "1", "HEAD"], repoPath);
  return raw.split(/\s+/).filter(Boolean);
}

async function openRepoInCommitsView(repoPath) {
  await dismissAnyModal();
  await closeAllReposAndWait();
  await browser.execute(() => {
    window.dispatchEvent(new CustomEvent("graphoria-reset-settings"));
  });

  await browser.execute((p) => {
    window.dispatchEvent(new CustomEvent("graphoria-open-repo", { detail: { repoPath: p, viewMode: "commits" } }));
  }, repoPath);

  const commitsList = await $(".commitsList");
  await commitsList.waitForExist({ timeout: 60000 });
}

async function openPullMenu() {
  await dismissAnyModal();
  const more = await $("[data-testid=\"pull-menu\"]");
  await more.waitForExist({ timeout: 60000 });
  await more.waitForEnabled({ timeout: 60000 });
  await more.click();

  const menu = await $(".menuDropdown");
  await menu.waitForExist({ timeout: 60000 });
}

async function expectBehindBadge(count) {
  const pullButton = await $("[data-testid=\"pull-merge\"]");
  await pullButton.waitForExist({ timeout: 60000 });

  if (count > 0) {
    const badge = await pullButton.$(".badge");
    await badge.waitForExist({ timeout: 60000 });
    const txt = await badge.getText();
    assert.ok(txt.includes(`↓${count}`));
  } else {
    await browser.waitUntil(
      async () => {
        const badge = await pullButton.$(".badge");
        return !(await badge.isExisting());
      },
      { timeout: 60000, interval: 250 }
    );
  }
}

describe("Graphoria pull modes", () => {
  let env;

  beforeEach(async () => {
    env = await setupTwoUserRepo();
  });

  afterEach(async () => {
    if (env?.root) {
      try {
        await dismissAnyModal();
        await closeAllReposAndWait();
      } catch {}
      await wait(500);
      await rmWithRetry(env.root);
    }
  });

  it("pull --merge: updates commits list and clears behind badge when no conflicts", async () => {
    await waitForBackdoor();

    await setRepoIdentity(env.alice, "Alice", "alice@example.com");
    await setRepoIdentity(env.bob, "Bob", "bob@example.com");

    await commitAndPush(env.alice, "alice.txt", "alice-1\n", "Upstream", env.branch);
    const upstreamHead = await resolveHead(env.alice);

    await openRepoInCommitsView(env.bob);

    await expectBehindBadge(1);

    const pullButton = await $("[data-testid=\"pull-merge\"]");
    await pullButton.waitForEnabled({ timeout: 60000 });
    await pullButton.click();

    await browser.waitUntil(
      async () => {
        const row = await $(`[data-commit-hash=\"${upstreamHead}\"]`);
        return row.isExisting();
      },
      { timeout: 90000, interval: 500 }
    );

    await expectBehindBadge(0);
  });

  it("pull --rebase: updates commits list and clears behind badge when no conflicts", async () => {
    await waitForBackdoor();

    await setRepoIdentity(env.alice, "Alice", "alice@example.com");
    await setRepoIdentity(env.bob, "Bob", "bob@example.com");

    await commitAndPush(env.alice, "alice.txt", "alice-1\n", "Upstream", env.branch);
    const upstreamHead = await resolveHead(env.alice);

    await openRepoInCommitsView(env.bob);
    await expectBehindBadge(1);

    await openPullMenu();
    const rebase = await $("[data-testid=\"pull-option-rebase\"]");
    await rebase.waitForEnabled({ timeout: 60000 });
    await rebase.click();

    await browser.waitUntil(
      async () => {
        const row = await $(`[data-commit-hash=\"${upstreamHead}\"]`);
        return row.isExisting();
      },
      { timeout: 90000, interval: 500 }
    );

    await expectBehindBadge(0);
  });

  it("pull --merge predict: shows no conflicts and Apply brings new commit", async () => {
    await waitForBackdoor();

    await setRepoIdentity(env.alice, "Alice", "alice@example.com");
    await setRepoIdentity(env.bob, "Bob", "bob@example.com");

    await fs.writeFile(path.join(env.bob, "bob.txt"), "bob-1\n", "utf-8");
    await tauriInvoke("git_commit", { repoPath: env.bob, message: "Bob local", paths: ["bob.txt"] });

    await commitAndPush(env.alice, "alice.txt", "alice-1\n", "Alice upstream", env.branch);
    const upstreamHead = await resolveHead(env.alice);

    await openRepoInCommitsView(env.bob);

    await openPullMenu();
    const predict = await $("[data-testid=\"pull-option-merge-predict\"]");
    await predict.waitForEnabled({ timeout: 60000 });
    await predict.click();

    const modalHeader = await $(".modalHeader");
    await modalHeader.waitForExist({ timeout: 60000 });
    const headerText = await modalHeader.getText();
    assert.ok(headerText.includes("Pull predict"));

    const modalBody = await $(".modalBody");
    await modalBody.waitForExist({ timeout: 60000 });
    await browser.waitUntil(
      async () => {
        const t = await modalBody.getText();
        return !t.includes("Predicting") && t.includes("No conflicts predicted.");
      },
      { timeout: 90000, interval: 250 }
    );

    const bodyText = await modalBody.getText();
    assert.ok(bodyText.includes("No conflicts predicted."));

    const footer = await $(".modalFooter");
    const apply = await footer.$("button=Apply");
    await apply.waitForEnabled({ timeout: 60000 });
    await apply.click();

    await browser.waitUntil(
      async () => {
        const row = await $(`[data-commit-hash=\"${upstreamHead}\"]`);
        return row.isExisting();
      },
      { timeout: 90000, interval: 500 }
    );
  });

  it("pull --merge predict: shows conflicting files when conflict is possible", async () => {
    await waitForBackdoor();

    await setRepoIdentity(env.alice, "Alice", "alice@example.com");
    await setRepoIdentity(env.bob, "Bob", "bob@example.com");

    await commitAndPush(env.alice, "conflict.txt", "base\n", "Base", env.branch);

    await syncToOriginBranch(env.bob, env.branch);

    await fs.writeFile(path.join(env.bob, "conflict.txt"), "bob-change\n", "utf-8");
    await tauriInvoke("git_commit", { repoPath: env.bob, message: "Bob local", paths: ["conflict.txt"] });

    await commitAndPush(env.alice, "conflict.txt", "alice-change\n", "Alice upstream", env.branch);

    await openRepoInCommitsView(env.bob);

    await openPullMenu();
    const predict = await $("[data-testid=\"pull-option-merge-predict\"]");
    await predict.waitForEnabled({ timeout: 60000 });
    await predict.click();

    const modalHeader = await $(".modalHeader");
    await modalHeader.waitForExist({ timeout: 60000 });

    await browser.waitUntil(
      async () => {
        const els = await $$(".modalBody .statusList .statusPath");
        for (const el of els) {
          const t = (await el.getText()).trim();
          if (t.includes("conflict.txt")) return true;
        }
        return false;
      },
      { timeout: 60000, interval: 250 }
    );

    const footer = await $(".modalFooter");
    const cancel = await footer.$("button=Cancel");
    await cancel.waitForEnabled({ timeout: 60000 });
    await cancel.click();
  });

  it("pull --rebase predict: shows no conflicts and Apply brings new commit", async () => {
    await waitForBackdoor();

    await setRepoIdentity(env.alice, "Alice", "alice@example.com");
    await setRepoIdentity(env.bob, "Bob", "bob@example.com");

    await fs.writeFile(path.join(env.bob, "bob.txt"), "bob-1\n", "utf-8");
    await tauriInvoke("git_commit", { repoPath: env.bob, message: "Bob local", paths: ["bob.txt"] });

    await commitAndPush(env.alice, "alice.txt", "alice-1\n", "Alice upstream", env.branch);
    const upstreamHead = await resolveHead(env.alice);

    await openRepoInCommitsView(env.bob);

    await openPullMenu();
    const predict = await $("[data-testid=\"pull-option-rebase-predict\"]");
    await predict.waitForEnabled({ timeout: 60000 });
    await predict.click();

    const modalHeader = await $(".modalHeader");
    await modalHeader.waitForExist({ timeout: 60000 });
    const headerText = await modalHeader.getText();
    assert.ok(headerText.includes("Pull predict"));

    const modalBody = await $(".modalBody");
    await modalBody.waitForExist({ timeout: 60000 });
    await browser.waitUntil(
      async () => {
        const t = await modalBody.getText();
        return !t.includes("Predicting") && t.includes("No conflicts predicted.");
      },
      { timeout: 90000, interval: 250 }
    );

    const bodyText = await modalBody.getText();
    assert.ok(bodyText.includes("No conflicts predicted."));
    assert.ok(bodyText.includes("Action:") && bodyText.includes("rebase"));

    const footer = await $(".modalFooter");
    const apply = await footer.$("button=Apply");
    await apply.waitForEnabled({ timeout: 60000 });
    await apply.click();

    await browser.waitUntil(
      async () => {
        const row = await $(`[data-commit-hash=\"${upstreamHead}\"]`);
        return row.isExisting();
      },
      { timeout: 90000, interval: 500 }
    );
  });

  it("pull --rebase predict: shows conflicting files when conflict is possible", async () => {
    await waitForBackdoor();

    await setRepoIdentity(env.alice, "Alice", "alice@example.com");
    await setRepoIdentity(env.bob, "Bob", "bob@example.com");

    await commitAndPush(env.alice, "conflict.txt", "base\n", "Base", env.branch);

    await syncToOriginBranch(env.bob, env.branch);

    await fs.writeFile(path.join(env.bob, "conflict.txt"), "bob-change\n", "utf-8");
    await tauriInvoke("git_commit", { repoPath: env.bob, message: "Bob local", paths: ["conflict.txt"] });

    await commitAndPush(env.alice, "conflict.txt", "alice-change\n", "Alice upstream", env.branch);

    await openRepoInCommitsView(env.bob);

    await openPullMenu();
    const predict = await $("[data-testid=\"pull-option-rebase-predict\"]");
    await predict.waitForEnabled({ timeout: 60000 });
    await predict.click();

    const modalHeader = await $(".modalHeader");
    await modalHeader.waitForExist({ timeout: 60000 });

    await browser.waitUntil(
      async () => {
        const els = await $$(".modalBody .statusList .statusPath");
        for (const el of els) {
          const t = (await el.getText()).trim();
          if (t.includes("conflict.txt")) return true;
        }
        return false;
      },
      { timeout: 60000, interval: 250 }
    );

    const footer = await $(".modalFooter");
    const cancel = await footer.$("button=Cancel");
    await cancel.waitForEnabled({ timeout: 60000 });
    await cancel.click();
  });

  it("pull autochoose: chooses rebase when no conflicts", async () => {
    await waitForBackdoor();

    await setRepoIdentity(env.alice, "Alice", "alice@example.com");
    await setRepoIdentity(env.bob, "Bob", "bob@example.com");

    await openRepoInCommitsView(env.bob);

    await fs.writeFile(path.join(env.bob, "bob.txt"), "bob-1\n", "utf-8");
    await tauriInvoke("git_commit", { repoPath: env.bob, message: "Bob local", paths: ["bob.txt"] });

    await commitAndPush(env.alice, "alice.txt", "alice-1\n", "Alice upstream", env.branch);

    await openPullMenu();
    const autochoose1 = await $("[data-testid=\"pull-option-autochoose\"]");
    await autochoose1.waitForEnabled({ timeout: 60000 });
    await autochoose1.click();

    await browser.waitUntil(
      async () => {
        const txt = await browser.execute(() => document.querySelector(".toolbar")?.textContent ?? "");
        return !txt.includes("Loading");
      },
      { timeout: 90000, interval: 500 }
    );

    const parents = headParents(env.bob);
    assert.equal(parents.length, 2);
  });

  it("pull autochoose: opens conflicts modal when conflicts are predicted", async () => {
    await waitForBackdoor();

    await setRepoIdentity(env.alice, "Alice", "alice@example.com");
    await setRepoIdentity(env.bob, "Bob", "bob@example.com");

    await commitAndPush(env.alice, "conflict.txt", "base\n", "Base", env.branch);

    await syncToOriginBranch(env.bob, env.branch);

    await fs.writeFile(path.join(env.bob, "conflict.txt"), "bob-change\n", "utf-8");
    await tauriInvoke("git_commit", { repoPath: env.bob, message: "Bob local", paths: ["conflict.txt"] });

    await commitAndPush(env.alice, "conflict.txt", "alice-change\n", "Alice upstream", env.branch);

    await openRepoInCommitsView(env.bob);

    await openPullMenu();
    const autochoose = await $("[data-testid=\"pull-option-autochoose\"]");
    await autochoose.waitForEnabled({ timeout: 60000 });
    await autochoose.click();

    await browser.waitUntil(
      async () => {
        const header = await $(".modalHeader");
        if (!(await header.isExisting())) return false;
        const txt = await header.getText();
        return txt.includes("Conflicts detected");
      },
      { timeout: 60000, interval: 250 }
    );

    await browser.waitUntil(
      async () => {
        const els = await $$(".modalBody .statusList .statusPath");
        for (const el of els) {
          const t = (await el.getText()).trim();
          if (t.includes("conflict.txt")) return true;
        }
        return false;
      },
      { timeout: 60000, interval: 250 }
    );
  });
});
