import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  useAppSettings,
  type ThemeName,
  type ViewMode,
  type WorkingFilesViewMode,
  type RankDir,
  type EdgeDirection,
  type GitHistoryOrder,
  type TooltipMode,
  type TerminalProfileKind,
} from "./appSettingsStore";
import {
  detectAppPlatform,
  eventToShortcutSpec,
  formatShortcutSpecForDisplay,
  shortcutActions,
  type ShortcutActionId,
} from "./shortcuts";
import { gitSetUserIdentity } from "./api/git";

type SettingsSection = "general" | "appearance" | "graph" | "git" | "terminal" | "shortcuts";

export default function SettingsModal(props: { open: boolean; activeRepoPath: string; onClose: () => void }) {
  const { open, activeRepoPath, onClose } = props;

  const general = useAppSettings((s) => s.general);
  const appearance = useAppSettings((s) => s.appearance);
  const graph = useAppSettings((s) => s.graph);
  const git = useAppSettings((s) => s.git);
  const terminal = useAppSettings((s) => s.terminal);
  const shortcuts = useAppSettings((s) => s.shortcuts);

  const viewMode = useAppSettings((s) => s.viewMode);

  const setGeneral = useAppSettings((s) => s.setGeneral);
  const setTheme = useAppSettings((s) => s.setTheme);
  const setAppearance = useAppSettings((s) => s.setAppearance);
  const setGit = useAppSettings((s) => s.setGit);
  const setGraph = useAppSettings((s) => s.setGraph);
  const setTerminal = useAppSettings((s) => s.setTerminal);
  const setShortcuts = useAppSettings((s) => s.setShortcuts);
  const setViewMode = useAppSettings((s) => s.setViewMode);
  const resetSettings = useAppSettings((s) => s.resetSettings);
  const resetLayout = useAppSettings((s) => s.resetLayout);
  const resetTerminal = useAppSettings((s) => s.resetTerminal);
  const resetShortcuts = useAppSettings((s) => s.resetShortcuts);

  const [section, setSection] = useState<SettingsSection>("general");

  const [applyScope, setApplyScope] = useState<"repo" | "global">("repo");
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyError, setApplyError] = useState<string>("");
  const [applyOk, setApplyOk] = useState(false);

  const platform = useMemo(() => detectAppPlatform(), []);
  const [capturingId, setCapturingId] = useState<ShortcutActionId | null>(null);

  const diffTool = git.diffTool;
  const tooltips = general.tooltips;

  const title = useMemo(() => {
    switch (section) {
      case "general":
        return "General";
      case "appearance":
        return "Appearance";
      case "graph":
        return "Graph";
      case "git":
        return "Git";
      case "terminal":
        return "Terminal";
      case "shortcuts":
        return "Shortcuts";
    }
  }, [section]);

  useEffect(() => {
    if (!open) return;
    setApplyBusy(false);
    setApplyError("");
    setApplyOk(false);
    setApplyScope(activeRepoPath.trim() ? "repo" : "global");
  }, [activeRepoPath, open]);

  if (!open) return null;

  const sectionButton = (id: SettingsSection, label: string) => (
    <button
      type="button"
      className={section === id ? "settingsNavItem settingsNavItemActive" : "settingsNavItem"}
      onClick={() => setSection(id)}
    >
      {label}
    </button>
  );

  const shortcutDisplay = (id: ShortcutActionId) => {
    const spec = shortcuts.bindings?.[id] ?? "";
    return formatShortcutSpecForDisplay(spec, platform);
  };

  const field = (label: string, control: ReactNode, hint?: string) => (
    <div className="settingsField">
      <div className="settingsFieldLabel">{label}</div>
      <div className="settingsFieldControl">
        {control}
        {hint ? <div className="settingsHint">{hint}</div> : null}
      </div>
    </div>
  );

  async function applyGitIdentity() {
    setApplyBusy(true);
    setApplyError("");
    setApplyOk(false);

    try {
      const scope = applyScope;
      if (scope === "repo" && !activeRepoPath.trim()) {
        setApplyError("Open a repository first.");
        return;
      }

      await gitSetUserIdentity({
        scope,
        userName: git.userName,
        userEmail: git.userEmail,
        repoPath: scope === "repo" ? activeRepoPath : undefined,
      });
      setApplyOk(true);
    } catch (e) {
      setApplyError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setApplyBusy(false);
    }
  }

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ width: "min(980px, 96vw)", maxHeight: "min(84vh, 900px)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>Settings</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={() => resetSettings()}>
              Reset
            </button>
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className="modalBody">
          <div className="settingsLayout">
            <div className="settingsNav">
              <div className="settingsNavTitle">Graphoria</div>
              {sectionButton("general", "General")}
              {sectionButton("appearance", "Appearance")}
              {sectionButton("graph", "Graph")}
              {sectionButton("git", "Git")}
              {sectionButton("shortcuts", "Shortcuts")}
              {sectionButton("terminal", "Terminal")}
            </div>

            <div className="settingsContent">
              <div className="settingsContentHeader">
                <div style={{ fontWeight: 900 }}>{title}</div>
              </div>

              {section === "general" ? (
                <div className="settingsContentBody">
                  {field(
                    "Default view",
                    <select value={viewMode} onChange={(e) => setViewMode(e.target.value as ViewMode)}>
                      <option value="graph">Graph</option>
                      <option value="commits">Commits</option>
                    </select>,
                  )}

                  {field(
                    "Open on system startup",
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.9 }}>
                      <input
                        type="checkbox"
                        checked={general.openOnStartup}
                        onChange={(e) => setGeneral({ openOnStartup: e.target.checked })}
                      />
                      Enable
                    </label>,
                    "May require additional OS permissions.",
                  )}

                  {field(
                    "Toolbar shortcut hints",
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.9 }}>
                      <input
                        type="checkbox"
                        checked={general.showToolbarShortcutHints}
                        onChange={(e) => setGeneral({ showToolbarShortcutHints: e.target.checked })}
                      />
                      Show shortcuts on top toolbar buttons
                    </label>,
                    "Shows keyboard shortcuts next to buttons like Refresh/Fetch/Commit on the top toolbar.",
                  )}

                  {field(
                    "Tooltips",
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.9 }}>
                      <input
                        type="checkbox"
                        checked={tooltips.enabled}
                        onChange={(e) => setGeneral({ tooltips: { ...tooltips, enabled: e.target.checked } })}
                      />
                      Enable
                    </label>,
                    "Can make the UI feel faster (less motion).",
                  )}

                  {field(
                    "Tooltip style",
                    <select
                      value={tooltips.mode}
                      onChange={(e) => setGeneral({ tooltips: { ...tooltips, mode: e.target.value as TooltipMode } })}
                      disabled={!tooltips.enabled}
                    >
                      <option value="custom">Graphoria (custom)</option>
                      <option value="native">System (native)</option>
                    </select>,
                    "Custom tooltips support faster display and optional auto-hide.",
                  )}

                  {field(
                    "Tooltip show delay (ms)",
                    <input
                      className="modalInput"
                      type="number"
                      min={0}
                      max={5000}
                      value={tooltips.showDelayMs}
                      onChange={(e) => setGeneral({ tooltips: { ...tooltips, showDelayMs: Number(e.target.value || 0) } })}
                      disabled={!tooltips.enabled || tooltips.mode !== "custom"}
                    />,
                    "Lower = faster. Applies to custom tooltips only.",
                  )}

                  {field(
                    "Tooltip auto-hide (ms)",
                    <input
                      className="modalInput"
                      type="number"
                      min={0}
                      max={60000}
                      value={tooltips.autoHideMs}
                      onChange={(e) => setGeneral({ tooltips: { ...tooltips, autoHideMs: Number(e.target.value || 0) } })}
                      disabled={!tooltips.enabled || tooltips.mode !== "custom"}
                    />,
                    "0 = never. When enabled, a thin progress bar shows remaining time.",
                  )}

                  {field(
                    "Window layout",
                    <button type="button" onClick={() => resetLayout()}>
                      Reset window layout
                    </button>,
                    "Resets sidebar width and Details panel height.",
                  )}
                </div>
              ) : null}

              {section === "appearance" ? (
                <div className="settingsContentBody">
                  {field(
                    "Theme",
                    <select value={appearance.theme} onChange={(e) => setTheme(e.target.value as ThemeName)}>
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                      <option value="blue">Blue</option>
                      <option value="sepia">Sepia</option>
                    </select>,
                  )}

                  {field(
                    "Modal close button",
                    <select
                      value={appearance.modalClosePosition}
                      onChange={(e) => setAppearance({ modalClosePosition: e.target.value as "left" | "right" })}
                    >
                      <option value="right">Right</option>
                      <option value="left">Left</option>
                    </select>,
                  )}

                  {field(
                    "Font family",
                    <input
                      className="modalInput"
                      value={appearance.fontFamily}
                      onChange={(e) => setAppearance({ fontFamily: e.target.value })}
                      placeholder="Inter, system-ui, ..."
                    />,
                  )}

                  {field(
                    "Font size",
                    <input
                      className="modalInput"
                      type="number"
                      min={10}
                      max={20}
                      value={appearance.fontSizePx}
                      onChange={(e) => setAppearance({ fontSizePx: Number(e.target.value || 14) })}
                    />,
                    "Applies to Graphoria UI (not to the graph nodes yet).",
                  )}
                </div>
              ) : null}

              {section === "graph" ? (
                <div className="settingsContentBody">
                  {field(
                    "Show stashes on graph",
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.9 }}>
                      <input
                        type="checkbox"
                        checked={graph.showStashesOnGraph}
                        onChange={(e) => setGraph({ showStashesOnGraph: e.target.checked })}
                      />
                      Enable
                    </label>,
                    "When enabled, stashes are shown as separate badges in the graph (not as normal commits).",
                  )}

                  {field(
                    "Show tags on graph",
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.9 }}>
                      <input type="checkbox" checked={graph.showTags} onChange={(e) => setGraph({ showTags: e.target.checked })} />
                      Enable
                    </label>,
                    "When disabled, tag badges are hidden.",
                  )}

                  {field(
                    "Show remote branches on graph",
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.9 }}>
                      <input
                        type="checkbox"
                        checked={graph.showRemoteBranchesOnGraph}
                        onChange={(e) => setGraph({ showRemoteBranchesOnGraph: e.target.checked })}
                      />
                      Enable
                    </label>,
                    "When disabled, remote branch badges like origin/* are hidden.",
                  )}

                  {field(
                    "Layout direction",
                    <select value={graph.rankDir} onChange={(e) => setGraph({ rankDir: e.target.value as RankDir })}>
                      <option value="TB">Top {"→"} Bottom</option>
                      <option value="LR">Left {"→"} Right</option>
                    </select>,
                  )}

                  {field(
                    "Edge arrows",
                    <select value={graph.edgeDirection} onChange={(e) => setGraph({ edgeDirection: e.target.value as EdgeDirection })}>
                      <option value="to_parent">Commit {"→"} parent</option>
                      <option value="to_child">Parent {"→"} commit</option>
                    </select>,
                  )}

                  {field(
                    "Node corner radius",
                    <input
                      className="modalInput"
                      type="number"
                      min={0}
                      max={30}
                      value={graph.nodeCornerRadius}
                      onChange={(e) => setGraph({ nodeCornerRadius: Number(e.target.value || 0) })}
                    />,
                  )}

                  {field(
                    "Node spacing",
                    <input
                      className="modalInput"
                      type="number"
                      min={10}
                      max={200}
                      value={graph.nodeSep}
                      onChange={(e) => setGraph({ nodeSep: Number(e.target.value || 50) })}
                    />,
                  )}

                  {field(
                    "Rank spacing",
                    <input
                      className="modalInput"
                      type="number"
                      min={10}
                      max={240}
                      value={graph.rankSep}
                      onChange={(e) => setGraph({ rankSep: Number(e.target.value || 60) })}
                    />,
                  )}

                  {field(
                    "Graph padding",
                    <input
                      className="modalInput"
                      type="number"
                      min={0}
                      max={200}
                      value={graph.padding}
                      onChange={(e) => setGraph({ padding: Number(e.target.value || 0) })}
                    />,
                  )}

                  {field(
                    "Canvas background",
                    <input
                      className="modalInput"
                      value={graph.canvasBackground}
                      onChange={(e) => setGraph({ canvasBackground: e.target.value })}
                      placeholder="Leave empty to use theme default"
                    />,
                    "Example: #ffffff or transparent or rgba(...)",
                  )}
                </div>
              ) : null}

              {section === "git" ? (
                <div className="settingsContentBody">
                  {applyError ? <div className="error">{applyError}</div> : null}
                  {field(
                    "Commit/Stash files view",
                    <select
                      value={git.workingFilesView}
                      onChange={(e) => setGit({ workingFilesView: e.target.value as WorkingFilesViewMode })}
                    >
                      <option value="flat">Flat</option>
                      <option value="tree">Tree</option>
                    </select>,
                    "Default view mode used in Commit and Stash dialogs.",
                  )}

                  {field(
                    "History scope",
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.9 }}>
                      <input
                        type="checkbox"
                        checked={git.commitsOnlyHead}
                        onChange={(e) => setGit({ commitsOnlyHead: e.target.checked })}
                      />
                      Show only commits reachable from HEAD
                    </label>,
                    "When disabled, history includes commits from all branches/tags/remotes (more lanes but more context). Affects Graph and Commits views.",
                  )}

                  {field(
                    "History order",
                    <select
                      value={git.commitsHistoryOrder}
                      onChange={(e) => setGit({ commitsHistoryOrder: e.target.value as GitHistoryOrder })}
                    >
                      <option value="topo">Topological (current)</option>
                      <option value="date">Date order (compact)</option>
                      <option value="first_parent">First parent (very compact)</option>
                    </select>,
                    "Affects the commit list order and the compactness of the graph (Graph and Commits views).",
                  )}

                  {field(
                    "Author avatars",
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.9 }}>
                      <input
                        type="checkbox"
                        checked={git.showOnlineAvatars}
                        onChange={(e) => setGit({ showOnlineAvatars: e.target.checked })}
                      />
                      Show online avatars (Gravatar)
                    </label>,
                    "When enabled, Graphoria will try to load author avatars from Gravatar using the commit author email and fall back to initials if unavailable.",
                  )}

                  {field(
                    "User name",
                    <input
                      className="modalInput"
                      value={git.userName}
                      onChange={(e) => {
                        setApplyOk(false);
                        setGit({ userName: e.target.value });
                      }}
                      placeholder="Your Name"
                    />,
                    "Stored in Graphoria settings. Use Apply below to write to git config.",
                  )}

                  {field(
                    "User email",
                    <input
                      className="modalInput"
                      value={git.userEmail}
                      onChange={(e) => {
                        setApplyOk(false);
                        setGit({ userEmail: e.target.value });
                      }}
                      placeholder="you@example.com"
                    />,
                  )}

                  {field(
                    "Apply",
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <select
                        value={applyScope}
                        onChange={(e) => {
                          setApplyOk(false);
                          setApplyScope(e.target.value as "repo" | "global");
                        }}
                      >
                        <option value="repo">This repository</option>
                        <option value="global">Global</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => void applyGitIdentity()}
                        disabled={applyBusy || (applyScope === "repo" && !activeRepoPath.trim())}
                      >
                        {applyBusy ? "Applying…" : "Apply to git config"}
                      </button>
                    </div>,
                    applyScope === "repo" && !activeRepoPath.trim()
                      ? "Open a repository to apply repo-local config."
                      : applyOk
                        ? "Applied."
                        : undefined,
                  )}

                  {field(
                    "Diff tool",
                    <select
                      value={diffTool.difftool}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "DiffMerge") {
                          setGit({
                            diffTool: {
                              difftool: "DiffMerge",
                              path: "sgdm.exe",
                              command: 'sgdm.exe "$LOCAL" "$REMOTE"',
                            },
                          });
                          return;
                        }
                        if (v === "Meld") {
                          setGit({
                            diffTool: {
                              difftool: "Meld",
                              path: "meld.exe",
                              command: 'meld.exe "$LOCAL" "$REMOTE"',
                            },
                          });
                          return;
                        }
                        if (v === "Graphoria builtin diff") {
                          setGit({
                            diffTool: {
                              difftool: "Graphoria builtin diff",
                              path: "",
                              command: "",
                            },
                          });
                          return;
                        }
                        setGit({ diffTool: { ...diffTool, difftool: v } });
                      }}
                    >
                      <option value="Graphoria builtin diff">Graphoria builtin diff</option>
                      <option value="DiffMerge">DiffMerge</option>
                      <option value="Meld">Meld</option>
                      <option value="Custom">Custom</option>
                    </select>,
                    "Builtin renders inside Graphoria. External tools use the Path/Command below.",
                  )}

                  {diffTool.difftool !== "Graphoria builtin diff" ? (
                    <>
                      {field(
                        "Path",
                        <input
                          className="modalInput"
                          value={diffTool.path}
                          onChange={(e) => setGit({ diffTool: { ...diffTool, path: e.target.value } })}
                          placeholder="meld.exe"
                        />,
                        "Executable name or full path.",
                      )}

                      {field(
                        "Command",
                        <input
                          className="modalInput"
                          value={diffTool.command}
                          onChange={(e) => setGit({ diffTool: { ...diffTool, command: e.target.value } })}
                          placeholder='meld.exe "$LOCAL" "$REMOTE"'
                        />,
                        "Variables: $LOCAL, $REMOTE (and $BASE reserved for future merge/conflict tooling).",
                      )}
                    </>
                  ) : null}
                </div>
              ) : null}

              {section === "terminal" ? (
                <div className="settingsContentBody">
                  {(() => {
                    const profiles = terminal.profiles ?? [];
                    const defaultId = terminal.defaultProfileId;

                    const normalizeArgs = (text: string) => {
                      const out: string[] = [];
                      const re = /"([^"]*)"|(\S+)/g;
                      let m: RegExpExecArray | null;
                      while ((m = re.exec(text)) !== null) {
                        const v = (m[1] ?? m[2] ?? "").trim();
                        if (v) out.push(v);
                      }
                      return out;
                    };

                    const updateProfiles = (next: typeof profiles, nextDefault?: string) => {
                      const safeNext = next.length ? next : profiles;
                      const desiredDefault = (nextDefault ?? defaultId).trim();
                      const hasDefault = safeNext.some((p) => p.id === desiredDefault);
                      setTerminal({
                        profiles: safeNext,
                        defaultProfileId: hasDefault ? desiredDefault : (safeNext[0]?.id ?? desiredDefault),
                      });
                    };

                    return (
                      <>
                        {field(
                          "Default profile",
                          <select
                            value={defaultId}
                            onChange={(e) => {
                              updateProfiles(profiles, e.target.value);
                            }}
                          >
                            {profiles.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>,
                        )}

                        {field(
                          "Profiles",
                          <div style={{ display: "grid", gap: 10 }}>
                            {profiles.map((p) => (
                              <div key={p.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 10 }}>
                                <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
                                  <div style={{ fontWeight: 900, opacity: 0.9 }}>{p.id}</div>
                                  <button
                                    type="button"
                                    disabled={profiles.length <= 1}
                                    onClick={() => {
                                      const next = profiles.filter((x) => x.id !== p.id);
                                      updateProfiles(next);
                                    }}
                                  >
                                    Remove
                                  </button>
                                </div>

                                <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                                  <label style={{ display: "grid", gap: 4 }}>
                                    <div style={{ fontWeight: 800, opacity: 0.85 }}>Name</div>
                                    <input
                                      className="modalInput"
                                      value={p.name}
                                      onChange={(e) => {
                                        const next = profiles.map((x) => (x.id === p.id ? { ...x, name: e.target.value } : x));
                                        updateProfiles(next);
                                      }}
                                    />
                                  </label>

                                  <label style={{ display: "grid", gap: 4 }}>
                                    <div style={{ fontWeight: 800, opacity: 0.85 }}>Type</div>
                                    <select
                                      value={p.kind}
                                      onChange={(e) => {
                                        const kind = e.target.value as TerminalProfileKind;
                                        const next = profiles.map((x) =>
                                          x.id === p.id
                                            ? {
                                                ...x,
                                                kind,
                                                command: kind === "custom" ? x.command : "",
                                                args: kind === "custom" ? x.args : [],
                                              }
                                            : x,
                                        );
                                        updateProfiles(next);
                                      }}
                                    >
                                      <option value="builtin_default">System default</option>
                                      <option value="builtin_git_bash">Git Bash (Windows)</option>
                                      <option value="builtin_cmd">Command Prompt (Windows)</option>
                                      <option value="builtin_powershell">PowerShell (Windows)</option>
                                      <option value="custom">Custom</option>
                                    </select>
                                  </label>

                                  <label style={{ display: "grid", gap: 4 }}>
                                    <div style={{ fontWeight: 800, opacity: 0.85 }}>Command</div>
                                    <input
                                      className="modalInput"
                                      value={p.command}
                                      disabled={p.kind !== "custom"}
                                      onChange={(e) => {
                                        const next = profiles.map((x) => (x.id === p.id ? { ...x, command: e.target.value } : x));
                                        updateProfiles(next);
                                      }}
                                      placeholder={p.kind === "custom" ? "zsh" : "(built-in)"}
                                    />
                                  </label>

                                  <label style={{ display: "grid", gap: 4 }}>
                                    <div style={{ fontWeight: 800, opacity: 0.85 }}>Args</div>
                                    <input
                                      className="modalInput"
                                      value={(p.args ?? []).join(" ")}
                                      disabled={p.kind !== "custom"}
                                      onChange={(e) => {
                                        const nextArgs = normalizeArgs(e.target.value);
                                        const next = profiles.map((x) => (x.id === p.id ? { ...x, args: nextArgs } : x));
                                        updateProfiles(next);
                                      }}
                                      placeholder={p.kind === "custom" ? "-l" : "(built-in)"}
                                    />
                                  </label>

                                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        updateProfiles(profiles, p.id);
                                      }}
                                    >
                                      Set as default
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ))}

                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <button
                                type="button"
                                onClick={() => {
                                  const id = `custom-${Date.now().toString(36)}`;
                                  const next = [
                                    ...profiles,
                                    { id, name: "Custom", kind: "custom" as const, command: "", args: [] },
                                  ];
                                  updateProfiles(next);
                                }}
                              >
                                Add profile
                              </button>
                              <button type="button" onClick={() => resetTerminal()}>
                                Reset terminal profiles
                              </button>
                            </div>
                          </div>,
                          "You must keep at least one profile. For custom args, you can use quotes (e.g. \"--login\").",
                        )}
                      </>
                    );
                  })()}
                </div>
              ) : null}

              {section === "shortcuts" ? (
                <div className="settingsContentBody">
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700 }}>
                      Click a field and press a shortcut. Backspace/Delete clears. Esc cancels.
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        resetShortcuts();
                        setCapturingId(null);
                      }}
                    >
                      Reset shortcuts
                    </button>
                  </div>

                  <div style={{ display: "grid", gap: 10 }}>
                    {shortcutActions.map((a) => (
                      <div
                        key={a.id}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr min(320px, 46vw) auto",
                          gap: 10,
                          alignItems: "center",
                        }}
                      >
                        <div style={{ fontWeight: 900, color: "var(--muted)", minWidth: 0 }}>{a.label}</div>
                        <input
                          className="modalInput"
                          data-shortcut-capture="true"
                          value={capturingId === a.id ? "" : shortcutDisplay(a.id)}
                          placeholder={capturingId === a.id ? "Press keys…" : "(none)"}
                          readOnly
                          onFocus={() => setCapturingId(a.id)}
                          onBlur={() => {
                            setCapturingId((cur) => (cur === a.id ? null : cur));
                          }}
                          onKeyDown={(e) => {
                            if (capturingId !== a.id) return;
                            e.preventDefault();
                            e.stopPropagation();
                            if (e.key === "Escape") {
                              setCapturingId(null);
                              return;
                            }
                            if (e.key === "Backspace" || e.key === "Delete") {
                              setShortcuts({ bindings: { [a.id]: "" } as any });
                              setCapturingId(null);
                              return;
                            }
                            const spec = eventToShortcutSpec(e.nativeEvent);
                            if (!spec) return;
                            setShortcuts({ bindings: { [a.id]: spec } as any });
                            setCapturingId(null);
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setShortcuts({ bindings: { [a.id]: "" } as any });
                            if (capturingId === a.id) setCapturingId(null);
                          }}
                          disabled={!shortcuts.bindings?.[a.id]?.trim()}
                        >
                          Clear
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="modalFooter">
          <button type="button" onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
