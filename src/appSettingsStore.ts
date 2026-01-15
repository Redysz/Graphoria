import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeName = "light" | "dark" | "blue" | "sepia";
export type ViewMode = "graph" | "commits";
export type RankDir = "TB" | "LR";
export type EdgeDirection = "to_parent" | "to_child";

 export type GitHistoryOrder = "topo" | "date" | "first_parent";

 export type TooltipMode = "custom" | "native";

export type TooltipSettings = {
  enabled: boolean;
  mode: TooltipMode;
  showDelayMs: number;
  autoHideMs: number;
};

export type TerminalPlatform = "windows" | "macos" | "linux";

export type TerminalProfileKind =
  | "builtin_default"
  | "builtin_git_bash"
  | "builtin_cmd"
  | "builtin_powershell"
  | "custom";

export type TerminalProfile = {
  id: string;
  name: string;
  kind: TerminalProfileKind;
  command: string;
  args: string[];
};

export type TerminalSettings = {
  profiles: TerminalProfile[];
  defaultProfileId: string;
};

export type GeneralSettings = {
  openOnStartup: boolean;
  tooltips: TooltipSettings;
};

export type GitSettings = {
  userName: string;
  userEmail: string;
  commitsOnlyHead: boolean;
  commitsHistoryOrder: GitHistoryOrder;
  showOnlineAvatars: boolean;
  diffTool: DiffToolSettings;
};

export type DiffToolSettings = {
  difftool: string;
  path: string;
  command: string;
};

export type AppearanceSettings = {
  theme: ThemeName;
  fontFamily: string;
  fontSizePx: number;
  modalClosePosition: "left" | "right";
};

export type GraphSettings = {
  rankDir: RankDir;
  nodeSep: number;
  rankSep: number;
  padding: number;
  nodeCornerRadius: number;
  edgeDirection: EdgeDirection;
  canvasBackground: string;
  showStashesOnGraph: boolean;
  showRemoteBranchesOnGraph: boolean;
};

export type LayoutSettings = {
  sidebarWidthPx: number;
  detailsHeightPx: number;
};

export type AppSettingsState = {
  general: GeneralSettings;
  appearance: AppearanceSettings;
  git: GitSettings;
  viewMode: ViewMode;
  graph: GraphSettings;
  layout: LayoutSettings;
  terminal: TerminalSettings;

  setGeneral: (patch: Partial<GeneralSettings>) => void;
  setTheme: (theme: ThemeName) => void;
  setViewMode: (viewMode: ViewMode) => void;
  setAppearance: (patch: Partial<AppearanceSettings>) => void;
  setGit: (patch: Partial<GitSettings>) => void;
  setGraph: (patch: Partial<GraphSettings>) => void;
  setLayout: (patch: Partial<LayoutSettings>) => void;
  setTerminal: (patch: Partial<TerminalSettings>) => void;
  resetLayout: () => void;
  resetTerminal: () => void;
  resetSettings: () => void;
};

export const defaultGeneralSettings: GeneralSettings = {
  openOnStartup: false,
  tooltips: {
    enabled: true,
    mode: "custom",
    showDelayMs: 250,
    autoHideMs: 0,
  },
};

export const defaultAppearanceSettings: AppearanceSettings = {
  theme: "light",
  fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
  fontSizePx: 14,
  modalClosePosition: "right",
};

export const defaultGitSettings: GitSettings = {
  userName: "",
  userEmail: "",
  commitsOnlyHead: false,
  commitsHistoryOrder: "topo",
  showOnlineAvatars: true,
  diffTool: {
    difftool: "Graphoria builtin diff",
    path: "",
    command: "",
  },
};

export const defaultGraphSettings: GraphSettings = {
  rankDir: "TB",
  nodeSep: 50,
  rankSep: 60,
  padding: 20,
  nodeCornerRadius: 10,
  edgeDirection: "to_parent",
  canvasBackground: "",
  showStashesOnGraph: false,
  showRemoteBranchesOnGraph: true,
};

export const defaultLayoutSettings: LayoutSettings = {
  sidebarWidthPx: 280,
  detailsHeightPx: 280,
};

function detectTerminalPlatform(): TerminalPlatform {
  const ua = (typeof navigator !== "undefined" ? navigator.userAgent : "").toLowerCase();
  if (ua.includes("windows")) return "windows";
  const isAppleMobile = ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod");
  if (!isAppleMobile && (ua.includes("mac os") || ua.includes("macintosh"))) return "macos";
  return "linux";
}

export const defaultTerminalSettings: TerminalSettings = (() => {
  const platform = detectTerminalPlatform();
  if (platform === "windows") {
    return {
      profiles: [
        { id: "git-bash", name: "Git Bash", kind: "builtin_git_bash", command: "", args: [] },
        { id: "cmd", name: "Command Prompt", kind: "builtin_cmd", command: "", args: [] },
        { id: "powershell", name: "PowerShell", kind: "builtin_powershell", command: "", args: [] },
      ],
      defaultProfileId: "git-bash",
    };
  }

  return {
    profiles: [{ id: "terminal", name: "Terminal", kind: "builtin_default", command: "", args: [] }],
    defaultProfileId: "terminal",
  };
})();

export const useAppSettings = create<AppSettingsState>()(
  persist(
    (set) => ({
      general: defaultGeneralSettings,
      appearance: defaultAppearanceSettings,
      git: defaultGitSettings,
      viewMode: "graph",
      graph: defaultGraphSettings,
      layout: defaultLayoutSettings,
      terminal: defaultTerminalSettings,

      setGeneral: (patch) => set((s) => ({ general: { ...s.general, ...patch } })),
      setTheme: (theme) =>
        set((s) => ({
          appearance: {
            ...s.appearance,
            theme,
          },
        })),
      setViewMode: (viewMode) => set({ viewMode }),
      setAppearance: (patch) => set((s) => ({ appearance: { ...s.appearance, ...patch } })),
      setGit: (patch) => set((s) => ({ git: { ...s.git, ...patch } })),
      setGraph: (patch) => set((s) => ({ graph: { ...s.graph, ...patch } })),
      setLayout: (patch) => set((s) => ({ layout: { ...s.layout, ...patch } })),
      setTerminal: (patch) => set((s) => ({ terminal: { ...s.terminal, ...patch } })),
      resetLayout: () => set({ layout: defaultLayoutSettings }),
      resetTerminal: () => set({ terminal: defaultTerminalSettings }),
      resetSettings: () =>
        set({
          general: defaultGeneralSettings,
          appearance: defaultAppearanceSettings,
          git: defaultGitSettings,
          viewMode: "graph",
          graph: defaultGraphSettings,
          layout: defaultLayoutSettings,
          terminal: defaultTerminalSettings,
        }),
    }),
    {
      name: "graphoria.settings.v1",
      version: 11,
      migrate: (persisted, _version) => {
        const s = persisted as any;
        if (!s || typeof s !== "object") return s;
        if (!s.general || typeof s.general !== "object") {
          s.general = defaultGeneralSettings;
        } else {
          if (typeof s.general.openOnStartup !== "boolean") {
            s.general.openOnStartup = defaultGeneralSettings.openOnStartup;
          }
          if (!s.general.tooltips || typeof s.general.tooltips !== "object") {
            s.general.tooltips = defaultGeneralSettings.tooltips;
          } else {
            if (typeof s.general.tooltips.enabled !== "boolean") {
              s.general.tooltips.enabled = defaultGeneralSettings.tooltips.enabled;
            }
            if (s.general.tooltips.mode !== "custom" && s.general.tooltips.mode !== "native") {
              s.general.tooltips.mode = defaultGeneralSettings.tooltips.mode;
            }
            if (!Number.isFinite(s.general.tooltips.showDelayMs)) {
              s.general.tooltips.showDelayMs = defaultGeneralSettings.tooltips.showDelayMs;
            }
            if (!Number.isFinite(s.general.tooltips.autoHideMs)) {
              s.general.tooltips.autoHideMs = defaultGeneralSettings.tooltips.autoHideMs;
            }
          }
        }
        if (!s.appearance || typeof s.appearance !== "object") {
          s.appearance = defaultAppearanceSettings;
        } else if (s.appearance.modalClosePosition !== "left" && s.appearance.modalClosePosition !== "right") {
          s.appearance.modalClosePosition = defaultAppearanceSettings.modalClosePosition;
        }
        if (!s.git || typeof s.git !== "object") return s;
        if (!s.git.diffTool) {
          s.git.diffTool = defaultGitSettings.diffTool;
        }
        if (typeof s.git.commitsOnlyHead !== "boolean") {
          s.git.commitsOnlyHead = defaultGitSettings.commitsOnlyHead;
        }
        if (s.git.commitsHistoryOrder !== "topo" && s.git.commitsHistoryOrder !== "date" && s.git.commitsHistoryOrder !== "first_parent") {
          s.git.commitsHistoryOrder = defaultGitSettings.commitsHistoryOrder;
        }
        if (typeof s.git.showOnlineAvatars !== "boolean") {
          s.git.showOnlineAvatars = defaultGitSettings.showOnlineAvatars;
        }
        if (!s.graph || typeof s.graph !== "object") {
          s.graph = defaultGraphSettings;
        } else if (typeof s.graph.showStashesOnGraph !== "boolean") {
          s.graph.showStashesOnGraph = false;
        }
        if (s.graph && typeof s.graph.showRemoteBranchesOnGraph !== "boolean") {
          s.graph.showRemoteBranchesOnGraph = true;
        }
        if (!s.layout || typeof s.layout !== "object") {
          s.layout = defaultLayoutSettings;
        } else {
          if (!Number.isFinite(s.layout.sidebarWidthPx)) {
            s.layout.sidebarWidthPx = defaultLayoutSettings.sidebarWidthPx;
          }
          if (!Number.isFinite(s.layout.detailsHeightPx)) {
            s.layout.detailsHeightPx = defaultLayoutSettings.detailsHeightPx;
          }
        }
        if (!s.terminal || typeof s.terminal !== "object") {
          s.terminal = defaultTerminalSettings;
        } else {
          if (!Array.isArray(s.terminal.profiles) || s.terminal.profiles.length === 0) {
            s.terminal.profiles = defaultTerminalSettings.profiles;
          }
          if (typeof s.terminal.defaultProfileId !== "string" || !s.terminal.defaultProfileId.trim()) {
            s.terminal.defaultProfileId = defaultTerminalSettings.defaultProfileId;
          }
        }
        return s;
      },
    },
  ),
);

export type CyPalette = {
  nodeBg: string;
  nodeBorder: string;
  nodeText: string;
  nodeSelectedBg: string;
  nodeSelectedBorder: string;
  nodeHeadBorder: string;
  placeholderBg: string;
  placeholderBorder: string;
  placeholderText: string;
  edgeLine: string;
  edgeArrow: string;
  refBadgeBg: string;
  refBadgeBorder: string;
  refBadgeText: string;
  refHeadBg: string;
  refHeadBorder: string;
  refTagBg: string;
  refTagBorder: string;
  refBranchBg: string;
  refBranchBorder: string;
  refRemoteBg: string;
  refRemoteBorder: string;
  refRemoteText: string;
  refEdgeLine: string;
};

export function getCyPalette(theme: ThemeName): CyPalette {
  if (theme === "dark") {
    return {
      nodeBg: "#151922",
      nodeBorder: "rgba(255, 255, 255, 0.18)",
      nodeText: "#f2f4f8",
      nodeSelectedBg: "rgba(75, 139, 255, 0.14)",
      nodeSelectedBorder: "#80b3ff",
      nodeHeadBorder: "#4b8bff",
      placeholderBg: "#1b2130",
      placeholderBorder: "rgba(255, 255, 255, 0.14)",
      placeholderText: "rgba(242, 244, 248, 0.72)",
      edgeLine: "rgba(75, 139, 255, 0.55)",
      edgeArrow: "rgba(75, 139, 255, 0.8)",
      refBadgeBg: "#151922",
      refBadgeBorder: "rgba(255, 255, 255, 0.18)",
      refBadgeText: "#f2f4f8",
      refHeadBg: "rgba(255, 215, 130, 0.22)",
      refHeadBorder: "rgba(255, 215, 130, 0.35)",
      refTagBg: "rgba(120, 210, 140, 0.20)",
      refTagBorder: "rgba(120, 210, 140, 0.30)",
      refBranchBg: "rgba(120, 185, 255, 0.22)",
      refBranchBorder: "rgba(120, 185, 255, 0.32)",
      refRemoteBg: "rgba(235, 246, 255, 0.92)",
      refRemoteBorder: "rgba(235, 246, 255, 0.95)",
      refRemoteText: "#0b0f17",
      refEdgeLine: "rgba(242, 244, 248, 0.25)",
    };
  }

  if (theme === "blue") {
    return {
      nodeBg: "#ffffff",
      nodeBorder: "rgba(10, 35, 70, 0.22)",
      nodeText: "#0a2346",
      nodeSelectedBg: "rgba(31, 111, 235, 0.12)",
      nodeSelectedBorder: "#1f6feb",
      nodeHeadBorder: "#1f6feb",
      placeholderBg: "#f2f7ff",
      placeholderBorder: "rgba(10, 35, 70, 0.18)",
      placeholderText: "rgba(10, 35, 70, 0.72)",
      edgeLine: "rgba(31, 111, 235, 0.55)",
      edgeArrow: "rgba(31, 111, 235, 0.8)",
      refBadgeBg: "#ffffff",
      refBadgeBorder: "rgba(10, 35, 70, 0.20)",
      refBadgeText: "#0a2346",
      refHeadBg: "rgba(255, 230, 160, 0.70)",
      refHeadBorder: "rgba(140, 90, 0, 0.35)",
      refTagBg: "rgba(200, 230, 200, 0.70)",
      refTagBorder: "rgba(0, 90, 0, 0.25)",
      refBranchBg: "rgba(210, 235, 250, 0.75)",
      refBranchBorder: "rgba(0, 65, 100, 0.25)",
      refRemoteBg: "rgba(220, 220, 220, 0.55)",
      refRemoteBorder: "rgba(15, 15, 15, 0.20)",
      refRemoteText: "#0a2346",
      refEdgeLine: "rgba(10, 35, 70, 0.28)",
    };
  }

  if (theme === "sepia") {
    return {
      nodeBg: "#fffaf0",
      nodeBorder: "rgba(61, 43, 31, 0.25)",
      nodeText: "#3d2b1f",
      nodeSelectedBg: "rgba(163, 91, 29, 0.14)",
      nodeSelectedBorder: "#7d4212",
      nodeHeadBorder: "#a35b1d",
      placeholderBg: "#f5efe3",
      placeholderBorder: "rgba(61, 43, 31, 0.20)",
      placeholderText: "rgba(61, 43, 31, 0.72)",
      edgeLine: "rgba(163, 91, 29, 0.50)",
      edgeArrow: "rgba(163, 91, 29, 0.78)",
      refBadgeBg: "#fffaf0",
      refBadgeBorder: "rgba(61, 43, 31, 0.20)",
      refBadgeText: "#3d2b1f",
      refHeadBg: "rgba(255, 220, 150, 0.55)",
      refHeadBorder: "rgba(125, 66, 18, 0.30)",
      refTagBg: "rgba(160, 210, 170, 0.45)",
      refTagBorder: "rgba(40, 90, 50, 0.22)",
      refBranchBg: "rgba(205, 220, 230, 0.55)",
      refBranchBorder: "rgba(80, 95, 105, 0.22)",
      refRemoteBg: "rgba(61, 43, 31, 0.55)",
      refRemoteBorder: "rgba(61, 43, 31, 0.65)",
      refRemoteText: "#fffaf0",
      refEdgeLine: "rgba(61, 43, 31, 0.25)",
    };
  }

  return {
    nodeBg: "#ffffff",
    nodeBorder: "rgba(15, 15, 15, 0.20)",
    nodeText: "#0f0f0f",
    nodeSelectedBg: "rgba(47, 111, 237, 0.10)",
    nodeSelectedBorder: "#1f56c6",
    nodeHeadBorder: "#2f6fed",
    placeholderBg: "#f2f4f8",
    placeholderBorder: "rgba(15, 15, 15, 0.18)",
    placeholderText: "rgba(15, 15, 15, 0.70)",
    edgeLine: "rgba(47, 111, 237, 0.50)",
    edgeArrow: "rgba(47, 111, 237, 0.75)",
    refBadgeBg: "#ffffff",
    refBadgeBorder: "rgba(15, 15, 15, 0.20)",
    refBadgeText: "#0f0f0f",
    refHeadBg: "rgba(255, 230, 160, 0.70)",
    refHeadBorder: "rgba(140, 90, 0, 0.35)",
    refTagBg: "rgba(200, 230, 200, 0.70)",
    refTagBorder: "rgba(0, 90, 0, 0.25)",
    refBranchBg: "rgba(210, 235, 250, 0.75)",
    refBranchBorder: "rgba(0, 65, 100, 0.25)",
    refRemoteBg: "rgba(220, 220, 220, 0.55)",
    refRemoteBorder: "rgba(15, 15, 15, 0.20)",
    refRemoteText: "#0f0f0f",
    refEdgeLine: "rgba(15, 15, 15, 0.28)",
  };
}
