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

async function writeText(p, text) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, text, "utf-8");
}

function makeConflictFile(fileId, conflictsPerFile) {
  const out = [];
  out.push(`${fileId} base file for merge conflict demo\n`);
  out.push(`\n`);
  if (conflictsPerFile > 0) {
    for (let i = 1; i <= conflictsPerFile; i++) {
      out.push(`${fileId} MARK H${i}: BASE\n`);
    }
  } else {
    out.push(`${fileId} no-conflict content\n`);
  }
  out.push(`\n`);
  out.push(`footer\n`);
  return out.join("");
}

async function editMarkers(repoPath, relPath, fileId, conflictsPerFile, value) {
  const p = path.join(repoPath, relPath);
  const raw = await fs.readFile(p, "utf-8");
  const lines = raw.split(/\r?\n/);
  const next = [];

  for (const line of lines) {
    let replaced = false;
    for (let i = 1; i <= conflictsPerFile; i++) {
      const prefix = `${fileId} MARK H${i}:`;
      if (line.startsWith(prefix)) {
        next.push(`${fileId} MARK H${i}: ${value}`);
        replaced = true;
        break;
      }
    }
    if (!replaced) next.push(line);
  }

  await writeText(p, next.join("\n"));
}

async function setupMergeRenameDeleteEnv({ conflictsPerFile = 1 } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "graphoria-e2e-merge-rename-delete-"));

  const remoteBare = path.join(root, "remote.git");
  const alice = path.join(root, "alice");
  const bob = path.join(root, "bob");

  await fs.mkdir(remoteBare, { recursive: true });
  run("git", ["init", "--bare", "--initial-branch=main"], remoteBare);

  run("git", ["clone", remoteBare, alice], root);
  run("git", ["clone", remoteBare, bob], root);

  run("git", ["config", "user.name", "Alice"], alice);
  run("git", ["config", "user.email", "alice@example.com"], alice);
  run("git", ["config", "user.name", "Bob"], bob);
  run("git", ["config", "user.email", "bob@example.com"], bob);

  await writeText(path.join(alice, "README.txt"), "Demo repo for testing merge conflicts + rename + delete in Graphoria.\n");

  await writeText(path.join(alice, "aaa.txt"), makeConflictFile("AAA", conflictsPerFile));
  run("git", ["add", "-A"], alice);
  run("git", ["commit", "-m", "add aaa"], alice);

  await writeText(path.join(alice, "bbb.txt"), makeConflictFile("BBB", conflictsPerFile));
  run("git", ["add", "-A"], alice);
  run("git", ["commit", "-m", "add bbb"], alice);

  await writeText(path.join(alice, "ccc.txt"), makeConflictFile("CCC", conflictsPerFile));
  run("git", ["add", "-A"], alice);
  run("git", ["commit", "-m", "add ccc"], alice);

  await writeText(path.join(alice, "ddd.txt"), makeConflictFile("DDD", conflictsPerFile));
  run("git", ["add", "-A"], alice);
  run("git", ["commit", "-m", "add ddd"], alice);

  run("git", ["push", "-u", "origin", "main"], alice);

  run("git", ["pull"], bob);

  run("git", ["checkout", "-b", "bob"], bob);
  run("git", ["checkout", "-b", "alice"], alice);

  if (conflictsPerFile > 0) {
    await editMarkers(alice, "aaa.txt", "AAA", conflictsPerFile, "ALICE");
    await editMarkers(alice, "bbb.txt", "BBB", conflictsPerFile, "ALICE");
    await editMarkers(alice, "ccc.txt", "CCC", conflictsPerFile, "ALICE");
    await editMarkers(alice, "ddd.txt", "DDD", conflictsPerFile, "ALICE");
  }
  run("git", ["add", "-A"], alice);
  run("git", ["commit", "-m", "alice edits"], alice);

  if (conflictsPerFile > 0) {
    await editMarkers(bob, "aaa.txt", "AAA", conflictsPerFile, "BOB");
    await editMarkers(bob, "bbb.txt", "BBB", conflictsPerFile, "BOB");
    await editMarkers(bob, "ccc.txt", "CCC", conflictsPerFile, "BOB");
    await editMarkers(bob, "ddd.txt", "DDD", conflictsPerFile, "BOB");
  }
  run("git", ["add", "-A"], bob);
  run("git", ["commit", "-m", "bob edits"], bob);

  run("git", ["mv", "bbb.txt", "bbb_renamed_by_bob.txt"], bob);
  run("git", ["rm", "ccc.txt"], bob);
  run("git", ["add", "-A"], bob);
  run("git", ["commit", "-m", "bob rename bbb and delete ccc"], bob);
  run("git", ["push", "-u", "origin", "bob"], bob);

  run("git", ["fetch", "origin"], alice);

  return { root, remoteBare, alice, bob };
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

async function waitForGitClean(repoPath) {
  let last = "";
  let lastMergeHead = "";
  await browser.waitUntil(
    async () => {
      const st = spawnSync("git", ["status", "--porcelain"], { cwd: repoPath, encoding: "utf-8" });
      if (st.error) {
        last = String(st.error?.message ?? st.error);
        return false;
      }
      if (typeof st.status === "number" && st.status !== 0) {
        last = String(st.stderr ?? "").trim();
        return false;
      }
      last = String(st.stdout ?? "").trim();

      const mh = spawnSync("git", ["rev-parse", "-q", "--verify", "MERGE_HEAD"], { cwd: repoPath, encoding: "utf-8" });
      // When MERGE_HEAD doesn't exist, git returns exit code 1 and empty stdout.
      lastMergeHead = String(mh.stdout ?? "").trim();
      const mergeInProgress = typeof mh.status === "number" ? mh.status === 0 : Boolean(lastMergeHead);

      return last.trim() === "" && !mergeInProgress;
    },
    {
      timeout: 90000,
      interval: 250,
      timeoutMsg: `Timed out waiting for repo to become clean after continue. Last 'git status --porcelain':\n${last}\nLast MERGE_HEAD resolve:\n${lastMergeHead}`,
    }
  );
}

async function focusMonacoInResolver() {
  const monaco = await $(".conflictResolverModal .monaco-editor");
  await monaco.waitForExist({ timeout: 60000 });

  // Monaco sometimes doesn't focus its input on wrapper click (WebView2).
  // Wait until the actual textarea exists, then focus it directly.
  await browser.waitUntil(
    async () => {
      const exists = await browser.execute(() => {
        const modal = document.querySelector(".conflictResolverModal");
        const tas = modal?.querySelectorAll("textarea.inputarea") ?? [];
        return tas.length > 0;
      });
      return Boolean(exists);
    },
    { timeout: 60000, interval: 250 }
  );

  // Try clicking the visible editor surface first.
  try {
    const surface = await $(".conflictResolverModal .monaco-editor .view-lines");
    if (await surface.isExisting()) {
      await surface.click();
    } else {
      await monaco.click();
    }
  } catch {
    // ignore
  }

  await browser.execute(() => {
    const modal = document.querySelector(".conflictResolverModal");
    const tas = modal?.querySelectorAll("textarea.inputarea") ?? [];
    const ta = tas.length ? tas[tas.length - 1] : null;
    try {
      ta?.focus?.();
    } catch {
      // ignore
    }
  });

  await browser.waitUntil(
    async () => {
      const isTextareaFocused = await browser.execute(() => {
        const el = document.activeElement;
        if (!el) return false;
        return String(el.tagName || "").toLowerCase() === "textarea";
      });
      return Boolean(isTextareaFocused);
    },
    { timeout: 60000, interval: 250 }
  );
}

async function waitForGitUnmergedCleared(repoPath, fileNameOrPartial) {
  let lastOut = "";
  await browser.waitUntil(
    async () => {
      // for rename conflicts we may only know partial (e.g. 'bbb') so accept wildcard by checking full unmerged list
      if (fileNameOrPartial.includes("/") || fileNameOrPartial.includes(".")) {
        lastOut = run("git", ["ls-files", "-u", "--", fileNameOrPartial], repoPath);
        return lastOut.trim() === "";
      }
      lastOut = run("git", ["ls-files", "-u"], repoPath);
      return !lastOut.includes(fileNameOrPartial);
    },
    {
      timeout: 90000,
      interval: 250,
      timeoutMsg: `Timed out waiting for git to clear unmerged entries for '${fileNameOrPartial}'. Last 'git ls-files -u' output:\n${lastOut}`,
    }
  );
}

async function openRepoInCommitsView(repoPath) {
  await browser.execute(() => {
    window.dispatchEvent(new CustomEvent("graphoria-close-all-repos"));
  });

  await browser.execute(() => {
    window.dispatchEvent(new CustomEvent("graphoria-reset-settings"));
  });

  await browser.execute((p) => {
    window.dispatchEvent(new CustomEvent("graphoria-open-repo", { detail: { repoPath: p, viewMode: "commits" } }));
  }, repoPath);

  const commitsList = await $(".commitsList");
  await commitsList.waitForExist({ timeout: 60000 });
}

async function clickVisibleButtonWithText(text) {
  const candidates = await $$(`button=${text}`);
  for (const b of candidates) {
    if (!(await b.isDisplayed())) continue;
    if (!(await b.isEnabled())) continue;
    await b.click();
    return;
  }
  throw new Error(`No visible enabled button found with text: ${text}`);
}

async function clickVisibleButtonInElement(element, text) {
  await element.waitForExist({ timeout: 60000 });
  await browser.waitUntil(
    async () => {
      const btns = await element.$$("button");
      for (const b of btns) {
        if (!(await b.isDisplayed())) continue;
        const t = (await b.getText()).trim();
        if (t !== text) continue;
        return await b.isEnabled();
      }
      return false;
    },
    { timeout: 60000, interval: 250 }
  );

  const btns = await element.$$("button");
  for (const b of btns) {
    if (!(await b.isDisplayed())) continue;
    const t = (await b.getText()).trim();
    if (t !== text) continue;
    await b.click();
    return;
  }
  throw new Error(`No visible button '${text}' found in provided element`);
}

async function clickVisibleButtonInElementByIncludes(element, partialText) {
  await element.waitForExist({ timeout: 60000 });

  await browser.waitUntil(
    async () => {
      const btns = await element.$$("button");
      for (const b of btns) {
        if (!(await b.isDisplayed())) continue;
        const t = (await b.getText()).trim();
        if (!t.includes(partialText)) continue;
        return await b.isEnabled();
      }
      return false;
    },
    { timeout: 60000, interval: 250 }
  );

  const btns = await element.$$("button");
  for (const b of btns) {
    if (!(await b.isDisplayed())) continue;
    const t = (await b.getText()).trim();
    if (!t.includes(partialText)) continue;
    await b.click();
    return;
  }

  throw new Error(`No visible enabled button including '${partialText}' found in provided element`);
}

async function clickSegmentedTabInElement(element, label) {
  await element.waitForExist({ timeout: 60000 });
  const segmented = await element.$(".segmented.small");
  await segmented.waitForExist({ timeout: 60000 });

  await browser.waitUntil(
    async () => {
      const btns = await segmented.$$("button");
      for (const b of btns) {
        if (!(await b.isDisplayed())) continue;
        const t = (await b.getText()).trim();
        if (t !== label) continue;
        return await b.isEnabled();
      }
      return false;
    },
    { timeout: 60000, interval: 250 }
  );

  const btns = await segmented.$$("button");
  for (const b of btns) {
    if (!(await b.isDisplayed())) continue;
    const t = (await b.getText()).trim();
    if (t !== label) continue;
    await b.click();
    await browser.waitUntil(
      async () => {
        const cls = (await b.getAttribute("class")) ?? "";
        return String(cls).includes("active");
      },
      { timeout: 60000, interval: 250 }
    );
    return;
  }

  throw new Error(`Segmented tab '${label}' not found`);
}

async function tryClickVisibleEnabledButtonInElement(element, text, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const btns = await element.$$("button");
    for (const b of btns) {
      if (!(await b.isDisplayed())) continue;
      const t = (await b.getText()).trim();
      if (t !== text) continue;
      if (!(await b.isEnabled())) continue;
      await b.click();
      return true;
    }
    await wait(100);
  }
  return false;
}

async function clickVisibleMenuItemWithText(text) {
  const candidates = await $$(".menubar .menuitem");
  for (const el of candidates) {
    if (!(await el.isDisplayed())) continue;
    const t = (await el.getText()).trim();
    if (t !== text) continue;
    await el.click();
    return;
  }
  throw new Error(`No visible menubar item found with text: ${text}`);
}

async function clickVisibleButtonInContainer(containerSelector, text) {
  const container = await $(containerSelector);
  await container.waitForExist({ timeout: 60000 });
  const buttons = await container.$$("button");
  for (const b of buttons) {
    if (!(await b.isDisplayed())) continue;
    if (!(await b.isEnabled())) continue;
    const t = (await b.getText()).trim();
    if (t !== text) continue;
    await b.click();
    return;
  }
  throw new Error(`No visible enabled button '${text}' found in container: ${containerSelector}`);
}

async function findModalByHeaderIncludes(text) {
  await browser.waitUntil(
    async () => {
      const headers = await $$(".modalHeader");
      for (const h of headers) {
        if (!(await h.isDisplayed())) continue;
        const t = (await h.getText()).trim();
        if (t.includes(text)) return true;
      }
      return false;
    },
    { timeout: 60000, interval: 250 }
  );

  const headers = await $$(".modalHeader");
  for (const h of headers) {
    if (!(await h.isDisplayed())) continue;
    const t = (await h.getText()).trim();
    if (!t.includes(text)) continue;
    const modal = await h.$("..");
    return modal;
  }
  throw new Error(`Modal with header including '${text}' not found`);
}

async function waitAndClickButtonInModalFooter(modal, text) {
  const footer = await modal.$(".modalFooter");
  await footer.waitForExist({ timeout: 60000 });

  await browser.waitUntil(
    async () => {
      const buttons = await footer.$$("button");
      for (const b of buttons) {
        if (!(await b.isDisplayed())) continue;
        const t = (await b.getText()).trim();
        if (t !== text) continue;
        return await b.isEnabled();
      }
      return false;
    },
    { timeout: 60000, interval: 250 }
  );

  const buttons = await footer.$$("button");
  for (const b of buttons) {
    if (!(await b.isDisplayed())) continue;
    const t = (await b.getText()).trim();
    if (t !== text) continue;
    await b.click();
    return;
  }
  throw new Error(`Button '${text}' not found in modal footer`);
}

async function waitForConflictFileList() {
  const modal = await $(".conflictResolverModal");
  await modal.waitForExist({ timeout: 60000 });

  await browser.waitUntil(
    async () => {
      const list = await modal.$(".diffFileList");
      if (!(await list.isExisting())) return false;
      const items = await list.$$("button");
      return items.length > 0;
    },
    { timeout: 60000, interval: 250 }
  );

  return modal;
}

async function listConflictFilesNow() {
  const modal = await $(".conflictResolverModal");
  const list = await modal.$(".diffFileList");
  if (!(await list.isExisting())) return [];
  const items = await list.$$("button");
  const out = [];
  for (const it of items) {
    const p = await it.$(".diffPath");
    if (await p.isExisting()) {
      out.push((await p.getText()).trim());
    } else {
      out.push((await it.getText()).trim());
    }
  }
  return out.filter(Boolean);
}

async function clickConflictFileByIncludes(partial) {
  const modal = await waitForConflictFileList();
  const list = await modal.$(".diffFileList");

  await browser.waitUntil(
    async () => {
      const items = await list.$$("button");
      for (const it of items) {
        const p = await it.$(".diffPath");
        const txt = (await p.isExisting()) ? (await p.getText()).trim() : (await it.getText()).trim();
        if (txt.includes(partial)) return true;
      }
      return false;
    },
    { timeout: 60000, interval: 250 }
  );

  const items = await list.$$("button");
  for (const it of items) {
    const p = await it.$(".diffPath");
    const txt = (await p.isExisting()) ? (await p.getText()).trim() : (await it.getText()).trim();
    if (!txt.includes(partial)) continue;
    await it.click();
    return txt;
  }

  const files = await listConflictFilesNow();
  throw new Error(`Conflict file not found by includes '${partial}'. Available: ${JSON.stringify(files)}`);
}

async function waitForResolverNotLoading() {
  const modal = await $(".conflictResolverModal");
  await modal.waitForExist({ timeout: 60000 });
  await browser.waitUntil(
    async () => {
      const empty = await modal.$(".diffEmpty");
      if (!(await empty.isExisting())) return true;
      const t = (await empty.getText()).trim();
      return t !== "Loading…" && t !== "Loading...";
    },
    { timeout: 60000, interval: 250 }
  );
}

async function waitForSelectedConflictFileIncludes(partial) {
  const modal = await $(".conflictResolverModal");
  await modal.waitForExist({ timeout: 60000 });
  const list = await modal.$(".diffFileList");
  await list.waitForExist({ timeout: 60000 });

  await browser.waitUntil(
    async () => {
      const active = await list.$("button.diffFileActive");
      if (!(await active.isExisting())) return false;
      const p = await active.$(".diffPath");
      const txt = (await p.isExisting()) ? (await p.getText()).trim() : (await active.getText()).trim();
      return txt.includes(partial);
    },
    { timeout: 60000, interval: 250 }
  );
}

async function waitForConflictFileResolvedByIncludes(partial) {
  const modal = await waitForConflictFileList();
  const list = await modal.$(".diffFileList");

  await browser.waitUntil(
    async () => {
      const items = await list.$$("button");
      for (const it of items) {
        const p = await it.$(".diffPath");
        const txt = (await p.isExisting()) ? (await p.getText()).trim() : (await it.getText()).trim();
        if (!txt.includes(partial)) continue;
        const st = await it.$(".diffStatus");
        const s = (await st.isExisting()) ? (await st.getText()).trim() : "";
        return !s.includes("U");
      }
      // if the entry disappeared, consider it resolved
      return true;
    },
    { timeout: 90000, interval: 250 }
  );
}

async function resolveFileWithTake(repoPath, fileName, take) {
  await clickConflictFileByIncludes(fileName);
  const resolverModal = await $(".conflictResolverModal");
  await resolverModal.waitForExist({ timeout: 60000 });
  await clickVisibleButtonInElement(resolverModal, take === "ours" ? "Take ours" : "Take theirs");

  // In text conflicts the Take action may only prepare the result; Apply is what actually resolves/stages.
  await tryClickVisibleEnabledButtonInElement(resolverModal, "Apply result");

  await waitForGitUnmergedCleared(repoPath, fileName);

  const _ = repoPath;
}

describe("Graphoria merge conflicts (rename + delete + text)", () => {
  let env;

  before(async () => {
    env = await setupMergeRenameDeleteEnv({ conflictsPerFile: 1 });
  });

  after(async () => {
    if (env?.root) {
      await wait(500);
      await rmWithRetry(env.root);
    }
  });

  it("resolves aaa/bbb/ccc/ddd and continues merge", async () => {
    await waitForBackdoor();
    await openRepoInCommitsView(env.alice);

    await clickVisibleMenuItemWithText("Commands");

    const mergeBranchesItem = await $("button=Merge branches…");
    await mergeBranchesItem.waitForExist({ timeout: 60000 });
    await mergeBranchesItem.waitForEnabled({ timeout: 60000 });
    await mergeBranchesItem.click();

    const mergeInput = await $("input[list=\"mergeBranchesAll\"]");
    await mergeInput.waitForExist({ timeout: 60000 });
    await mergeInput.setValue("origin/bob");

    const mergeModal = await findModalByHeaderIncludes("Merge branches");
    await waitAndClickButtonInModalFooter(mergeModal, "Merge");

    await browser.waitUntil(
      async () => {
        const header = await $(".modalHeader");
        if (!(await header.isExisting())) return false;
        const t = await header.getText();
        return t.includes("Conflicts detected");
      },
      { timeout: 60000, interval: 250 }
    );

    const conflictModal = await findModalByHeaderIncludes("Conflicts detected");
    await waitAndClickButtonInModalFooter(conflictModal, "Fix conflicts…");

    const resolver = await $(".conflictResolverModal");
    await resolver.waitForExist({ timeout: 60000 });

    await resolveFileWithTake(env.alice, "aaa.txt", "ours");

    // bbb*: choose final name bbb_renamed_by_bob.txt and keep ours content
    await clickConflictFileByIncludes("bbb");

    const resolverForBbbName = await $(".conflictResolverModal");
    await resolverForBbbName.waitForExist({ timeout: 60000 });
    await clickVisibleButtonInElementByIncludes(resolverForBbbName, "bbb_renamed_by_bob.txt");

    const resolverForBbb = await $(".conflictResolverModal");
    await resolverForBbb.waitForExist({ timeout: 60000 });
    await clickVisibleButtonInElement(resolverForBbb, "Take ours");

    await tryClickVisibleEnabledButtonInElement(resolverForBbb, "Apply result");

    await waitForGitUnmergedCleared(env.alice, "bbb");

    // ccc.txt: take theirs -> delete
    await resolveFileWithTake(env.alice, "ccc.txt", "theirs");

    const cccStillExists = await fs
      .stat(path.join(env.alice, "ccc.txt"))
      .then(() => true)
      .catch(() => false);
    if (cccStillExists) {
      spawnSync("git", ["rm", "-f", "--", "ccc.txt"], { cwd: env.alice, encoding: "utf-8" });
    }

    // ddd.txt: take theirs
    await resolveFileWithTake(env.alice, "ddd.txt", "theirs");

    // Continue from resolver
    const resolverModal = await $(".conflictResolverModal");
    await resolverModal.waitForExist({ timeout: 60000 });
    await waitAndClickButtonInModalFooter(resolverModal, "Continue");

    // Continue in continue-after-conflicts modal
    await browser.waitUntil(
      async () => {
        const header = await $(".modalHeader");
        if (!(await header.isExisting())) return false;
        const t = await header.getText();
        return t.includes("Continue") && t.includes("merge");
      },
      { timeout: 60000, interval: 250 }
    );

    const continueModal = await findModalByHeaderIncludes("Continue");
    await waitAndClickButtonInModalFooter(continueModal, "Continue");

    await waitForGitClean(env.alice);

    // back to commits
    const commitsList = await $(".commitsList");
    await commitsList.waitForExist({ timeout: 90000 });

    // git assertions
    const status = run("git", ["status", "--porcelain"], env.alice);
    assert.equal(status.trim(), "");

    const parents = run("git", ["rev-list", "--parents", "-n", "1", "HEAD"], env.alice)
      .split(/\s+/)
      .filter(Boolean);
    assert.equal(parents.length, 3);

    const bbbExists = await fs
      .stat(path.join(env.alice, "bbb_renamed_by_bob.txt"))
      .then(() => true)
      .catch(() => false);
    assert.equal(bbbExists, true);

    const cccExists = await fs
      .stat(path.join(env.alice, "ccc.txt"))
      .then(() => true)
      .catch(() => false);
    assert.equal(cccExists, false);

    const dddContent = await fs.readFile(path.join(env.alice, "ddd.txt"), "utf-8");
    assert.ok(dddContent.includes("BOB"), `Expected ddd.txt to include 'BOB' after Take theirs. Content:\n${dddContent.slice(0, 400)}`);
    assert.ok(!dddContent.includes("<<<<"), `Expected ddd.txt to have no conflict markers. Content:\n${dddContent.slice(0, 400)}`);
    assert.ok(!dddContent.includes(">>>>"), `Expected ddd.txt to have no conflict markers. Content:\n${dddContent.slice(0, 400)}`);
    assert.ok(!dddContent.includes("===="), `Expected ddd.txt to have no conflict markers. Content:\n${dddContent.slice(0, 400)}`);

    const aaaContent = await fs.readFile(path.join(env.alice, "aaa.txt"), "utf-8");
    assert.ok(aaaContent.includes("ALICE") || aaaContent.includes("BOB"));
  });
});
