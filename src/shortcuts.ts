export type AppPlatform = "windows" | "macos" | "linux";

export type ShortcutActionId =
  | "repo.prev"
  | "repo.next"
  | "panel.branches.show"
  | "panel.branches.hide"
  | "panel.details.show"
  | "panel.details.hide"
  | "view.graph"
  | "view.commits"
  | "view.toggleStashesOnGraph"
  | "view.toggleTags"
  | "view.toggleRemoteBranches"
  | "view.toggleDetailsWindow"
  | "view.toggleBranchesWindow"
  | "view.toggleGraphButtons"
  | "view.toggleOnlineAvatars"
  | "view.toggleCommitsOnlyHead"
  | "view.toggleLayoutDirection"
  | "view.toggleTooltips"
  | "nav.goToCommit"
  | "nav.goToTag"
  | "cmd.commit"
  | "cmd.push"
  | "cmd.stash"
  | "cmd.createBranch"
  | "cmd.checkoutBranch"
  | "cmd.reset"
  | "repo.open"
  | "repo.refresh"
  | "repo.initialize"
  | "cmd.terminalMenu"
  | "repo.fetch"
  | "tool.diffTool";

export type ShortcutSpec = string;

export const shortcutActions: Array<{ id: ShortcutActionId; label: string }> = [
  { id: "repo.prev", label: "Previous repository" },
  { id: "repo.next", label: "Next repository" },
  { id: "panel.branches.show", label: "Show branches window" },
  { id: "panel.branches.hide", label: "Hide branches window" },
  { id: "panel.details.show", label: "Show details window" },
  { id: "panel.details.hide", label: "Hide details window" },
  { id: "view.graph", label: "Graph view" },
  { id: "view.commits", label: "Commits view" },
  { id: "view.toggleStashesOnGraph", label: "Toggle: Show stashes on graph" },
  { id: "view.toggleTags", label: "Toggle: Show tags" },
  { id: "view.toggleRemoteBranches", label: "Toggle: Show remote branches" },
  { id: "view.toggleDetailsWindow", label: "Toggle: Show details window" },
  { id: "view.toggleBranchesWindow", label: "Toggle: Show branches window" },
  { id: "view.toggleGraphButtons", label: "Toggle: Show buttons on graph" },
  { id: "view.toggleOnlineAvatars", label: "Toggle: Show online avatars" },
  { id: "view.toggleCommitsOnlyHead", label: "Toggle: Show only commits reachable from HEAD" },
  { id: "view.toggleLayoutDirection", label: "Toggle: Layout direction from top to bottom" },
  { id: "view.toggleTooltips", label: "Toggle: Show tooltips" },
  { id: "nav.goToCommit", label: "Go to commit" },
  { id: "nav.goToTag", label: "Go to tag" },
  { id: "cmd.commit", label: "Commit" },
  { id: "cmd.push", label: "Push" },
  { id: "cmd.stash", label: "Stash" },
  { id: "cmd.createBranch", label: "Create branch" },
  { id: "cmd.checkoutBranch", label: "Checkout branch" },
  { id: "cmd.reset", label: "Reset (soft/hard)" },
  { id: "repo.open", label: "Open repository" },
  { id: "repo.refresh", label: "Refresh" },
  { id: "repo.initialize", label: "Initialize project" },
  { id: "cmd.terminalMenu", label: "Terminal" },
  { id: "repo.fetch", label: "Fetch" },
  { id: "tool.diffTool", label: "Diff tool" },
];

export function detectAppPlatform(): AppPlatform {
  const ua = (typeof navigator !== "undefined" ? navigator.userAgent : "").toLowerCase();
  if (ua.includes("windows")) return "windows";
  const isAppleMobile = ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod");
  if (!isAppleMobile && (ua.includes("mac os") || ua.includes("macintosh"))) return "macos";
  return "linux";
}

function isModifierKey(key: string) {
  return key === "Shift" || key === "Control" || key === "Alt" || key === "Meta";
}

function canonicalKeyFromEventKey(key: string): string {
  if (key.startsWith("Arrow")) return key;
  if (/^F\d{1,2}$/i.test(key)) return key.toUpperCase();
  if (key.length === 1) {
    const ch = key;
    const up = ch.toUpperCase();
    const isLetter = up >= "A" && up <= "Z";
    if (isLetter) return up;
    return ch;
  }
  return key;
}

export function eventToShortcutSpec(e: KeyboardEvent): ShortcutSpec | null {
  if (isModifierKey(e.key)) return null;

  const key = canonicalKeyFromEventKey(e.key);
  const mods: string[] = [];

  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.metaKey) mods.push("Meta");

  const hasNonShiftModifier = e.ctrlKey || e.altKey || e.metaKey;
  const isSymbolShiftImplicit = key === "<" || key === ">";
  if (e.shiftKey && hasNonShiftModifier && !isSymbolShiftImplicit) {
    mods.push("Shift");
  }

  const spec = mods.length ? `${mods.join("+")}+${key}` : key;
  return spec.trim();
}

function displayKey(key: string): string {
  if (key === "ArrowLeft") return "←";
  if (key === "ArrowRight") return "→";
  if (key === "ArrowUp") return "↑";
  if (key === "ArrowDown") return "↓";
  return key;
}

export function formatShortcutSpecForDisplay(spec: ShortcutSpec, platform: AppPlatform): string {
  const s = (spec ?? "").trim();
  if (!s) return "";

  const parts = s.split("+").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return "";

  const key = displayKey(parts[parts.length - 1] ?? "");
  const mods = parts.slice(0, -1);

  if (platform === "macos") {
    const mapped = mods
      .map((m) => {
        if (m === "Meta") return "⌘";
        if (m === "Alt") return "⌥";
        if (m === "Shift") return "⇧";
        if (m === "Ctrl") return "⌃";
        return m;
      })
      .join("");
    return `${mapped}${key}`;
  }

  const mapped = mods
    .map((m) => {
      if (m === "Meta") return "Win";
      return m;
    })
    .join("+");

  return mapped ? `${mapped}+${key}` : key;
}

export function joinShortcutDisplay(a: ShortcutSpec, b: ShortcutSpec, platform: AppPlatform): string {
  const aa = formatShortcutSpecForDisplay(a, platform);
  const bb = formatShortcutSpecForDisplay(b, platform);
  if (aa && bb) return `${aa} / ${bb}`;
  return aa || bb || "";
}
