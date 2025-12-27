import { useMemo, useState, type ReactNode } from "react";
import { useAppSettings, type ThemeName, type ViewMode, type RankDir, type EdgeDirection } from "./appSettingsStore";

type SettingsSection = "general" | "appearance" | "graph" | "git";

export default function SettingsModal(props: { open: boolean; onClose: () => void }) {
  const { open, onClose } = props;

  const general = useAppSettings((s) => s.general);
  const appearance = useAppSettings((s) => s.appearance);
  const graph = useAppSettings((s) => s.graph);
  const git = useAppSettings((s) => s.git);

  const viewMode = useAppSettings((s) => s.viewMode);

  const setGeneral = useAppSettings((s) => s.setGeneral);
  const setTheme = useAppSettings((s) => s.setTheme);
  const setAppearance = useAppSettings((s) => s.setAppearance);
  const setGit = useAppSettings((s) => s.setGit);
  const setGraph = useAppSettings((s) => s.setGraph);
  const setViewMode = useAppSettings((s) => s.setViewMode);
  const resetSettings = useAppSettings((s) => s.resetSettings);

  const [section, setSection] = useState<SettingsSection>("general");

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
    }
  }, [section]);

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

  const field = (label: string, control: ReactNode, hint?: string) => (
    <div className="settingsField">
      <div className="settingsFieldLabel">{label}</div>
      <div className="settingsFieldControl">
        {control}
        {hint ? <div className="settingsHint">{hint}</div> : null}
      </div>
    </div>
  );

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
                    "Not implemented yet at OS level; currently only stored in Graphoria settings.",
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
                  {field(
                    "User name",
                    <input
                      className="modalInput"
                      value={git.userName}
                      onChange={(e) => setGit({ userName: e.target.value })}
                      placeholder="Your Name"
                    />,
                    "Not applied to git config yet (UI + persist only).",
                  )}

                  {field(
                    "User email",
                    <input
                      className="modalInput"
                      value={git.userEmail}
                      onChange={(e) => setGit({ userEmail: e.target.value })}
                      placeholder="you@example.com"
                    />,
                  )}
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
