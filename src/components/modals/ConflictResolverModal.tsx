import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { DiffEditor, Editor } from "@monaco-editor/react";
import type { GitConflictFileEntry } from "../../types/git";
import {
  gitConflictApply,
  gitConflictApplyAndStage,
  gitConflictFileVersions,
  gitConflictResolveRenameWithContent,
  gitConflictState,
  gitConflictTakeOurs,
  gitConflictTakeTheirs,
  gitConflictResolveRename,
} from "../../api/git";
import { useAppSettings } from "../../appSettingsStore";

type Props = {
  open: boolean;
  repoPath: string;
  operation: "merge" | "rebase" | "cherry-pick" | "am";
  initialFiles?: string[];
  busy: boolean;
  onClose: () => void;
  onContinue: () => void;
  onAbort: () => void;
  onSkipRebase: () => void;
};

type Versions = {
  base: string;
  ours: string;
  theirs: string;
  working: string;
  oursPath: string;
  theirsPath: string;
  oursDeleted: boolean;
  theirsDeleted: boolean;
  conflictKind: "text" | "rename" | "modify_delete";
};

type ConflictContextMenuItem = {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onClick: () => void;
};

type ConflictContextMenuState = {
  x: number;
  y: number;
  items: ConflictContextMenuItem[];
};

function normalizeNewlines(s: string) {
  return s.replace(/\r\n/g, "\n");
}

function listConflictBlocksFromText(text: string) {
  const lines = normalizeNewlines(text).split("\n");
  const blocks: Array<{ start: number; mid: number; end: number; oursText: string; theirsText: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const ln = i + 1;
    const t = lines[i] ?? "";
    if (!t.startsWith("<<<<<<<")) continue;

    let mid = -1;
    let end = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const tt = lines[j] ?? "";
      if (tt.startsWith("=======")) {
        mid = j + 1;
        continue;
      }
      if (tt.startsWith(">>>>>>>")) {
        end = j + 1;
        break;
      }
    }
    if (mid < 0 || end < 0) continue;

    const ours = lines.slice(ln, mid - 1).join("\n");
    const theirs = lines.slice(mid, end - 1).join("\n");
    blocks.push({ start: ln, mid, end, oursText: ours, theirsText: theirs });
    i = end - 1;
  }

  return blocks;
}

function applyConflictBlock(text: string, blockIndex: number, replacement: string) {
  const blocks = listConflictBlocksFromText(text);
  const blk = blocks[blockIndex];
  if (!blk) return text;

  const lines = normalizeNewlines(text).split("\n");
  const startIdx = blk.start - 1;
  const endIdx = blk.end - 1;
  const replacementLines = normalizeNewlines(replacement).split("\n");

  const next = [...lines.slice(0, startIdx), ...replacementLines, ...lines.slice(endIdx + 1)];
  return next.join("\n");
}

function buildVariantFromWorking(working: string, choice: "ours" | "theirs") {
  let out = working;
  while (true) {
    const blocks = listConflictBlocksFromText(out);
    if (blocks.length === 0) break;
    out = applyConflictBlock(out, 0, choice === "ours" ? blocks[0]?.oursText ?? "" : blocks[0]?.theirsText ?? "");
  }
  return out;
}

function splitTextByConflictBlocks(text: string) {
  const lines = normalizeNewlines(text).split("\n");
  const parts: Array<{ kind: "plain"; text: string } | { kind: "block"; raw: string }> = [];

  let buf: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const t = lines[i] ?? "";
    if (t.startsWith("<<<<<<<")) {
      if (buf.length > 0) {
        parts.push({ kind: "plain", text: buf.join("\n") });
        buf = [];
      }
      const block: string[] = [];
      block.push(t);
      i++;
      for (; i < lines.length; i++) {
        const tt = lines[i] ?? "";
        block.push(tt);
        if (tt.startsWith(">>>>>>>")) {
          i++;
          break;
        }
      }
      parts.push({ kind: "block", raw: block.join("\n") });
      continue;
    }
    buf.push(t);
    i++;
  }

  if (buf.length > 0) {
    parts.push({ kind: "plain", text: buf.join("\n") });
  }

  return parts;
}

function makeSyntheticConflictText(oursText: string, theirsText: string) {
  const ours = normalizeNewlines(oursText ?? "").replace(/\s+$/g, "");
  const theirs = normalizeNewlines(theirsText ?? "").replace(/\s+$/g, "");
  return `<<<<<<< ours\n${ours}\n=======\n${theirs}\n>>>>>>> theirs\n`;
}

function makeLogicalLineLabelsForConflictText(text: string) {
  const lines = normalizeNewlines(text).split("\n");
  const labels: string[] = new Array(lines.length);

  let logical = 0;
  let inConflict = false;
  let conflictLogical = 0;

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i] ?? "";
    if (ln.startsWith("<<<<<<<")) {
      inConflict = true;
      conflictLogical = logical + 1;
      labels[i] = "";
      continue;
    }
    if (inConflict && ln.startsWith("=======")) {
      labels[i] = "";
      continue;
    }
    if (inConflict && ln.startsWith(">>>>>>>")) {
      labels[i] = "";
      inConflict = false;
      logical = conflictLogical;
      continue;
    }

    if (inConflict) {
      labels[i] = String(conflictLogical);
    } else {
      logical++;
      labels[i] = String(logical);
    }
  }

  return labels;
}

function isUnmergedStatus(s: string) {
  const t = (s ?? "").replace(/\s+/g, "");
  if (t.includes("U")) return true;
  if (t === "AA" || t === "DD") return true;
  return false;
}

function formatConflictStatus(status: string) {
  const s = (status ?? "").trim();
  if (!s) return "U";
  if (isUnmergedStatus(s)) return "U";
  return s[0] ?? "U";
}

function ensureConflictThemes(monaco: any) {
  monaco.editor.defineTheme("graphoria-conflict-light", {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "focusBorder": "rgba(47, 111, 237, 0.55)",
      "menu.foreground": "#0f0f0f",
      "menu.background": "#ffffff",
      "menu.border": "rgba(15, 15, 15, 0.12)",
      "menu.selectionForeground": "#0f0f0f",
      "menu.selectionBackground": "rgba(47, 111, 237, 0.14)",
      "menu.separatorBackground": "rgba(15, 15, 15, 0.12)",
      "list.hoverBackground": "rgba(47, 111, 237, 0.10)",
      "list.activeSelectionBackground": "rgba(47, 111, 237, 0.14)",
      "list.activeSelectionForeground": "#0f0f0f",
      "list.inactiveSelectionBackground": "rgba(47, 111, 237, 0.10)",
      "list.inactiveSelectionForeground": "#0f0f0f",
      "list.focusBackground": "rgba(47, 111, 237, 0.14)",
      "list.focusForeground": "#0f0f0f",
      "list.highlightForeground": "#2f6fed",
      "widget.shadow": "rgba(0, 0, 0, 0.18)",
      "widget.border": "rgba(15, 15, 15, 0.12)",
      "editorWidget.background": "#ffffff",
      "editorWidget.foreground": "#0f0f0f",
      "editorWidget.border": "rgba(15, 15, 15, 0.12)",
      "editorWidget.resizeBorder": "rgba(47, 111, 237, 0.55)",
      "quickInput.background": "#ffffff",
      "quickInput.foreground": "#0f0f0f",
      "quickInputTitle.background": "#f5f7fb",
      "quickInputList.focusBackground": "rgba(47, 111, 237, 0.14)",
      "quickInputList.focusForeground": "#0f0f0f",
      "quickInputList.focusIconForeground": "#0f0f0f",
      "input.background": "#ffffff",
      "input.foreground": "#0f0f0f",
      "input.border": "rgba(15, 15, 15, 0.18)",
      "input.placeholderForeground": "rgba(15, 15, 15, 0.50)",
      "inputOption.activeBorder": "rgba(47, 111, 237, 0.55)",
      "inputOption.activeBackground": "rgba(47, 111, 237, 0.14)",
      "inputOption.activeForeground": "#0f0f0f",
      "inputOption.hoverBackground": "rgba(47, 111, 237, 0.10)",
      "keybindingLabel.background": "rgba(15, 15, 15, 0.06)",
      "keybindingLabel.foreground": "#0f0f0f",
      "keybindingLabel.border": "rgba(15, 15, 15, 0.12)",
      "keybindingLabel.bottomBorder": "rgba(15, 15, 15, 0.18)",
      "inputValidation.infoBorder": "rgba(47, 111, 237, 0.55)",
      "inputValidation.infoBackground": "#ffffff",
      "inputValidation.infoForeground": "#0f0f0f",
      "inputValidation.warningBorder": "rgba(47, 111, 237, 0.55)",
      "inputValidation.warningBackground": "#ffffff",
      "inputValidation.warningForeground": "#0f0f0f",
      "inputValidation.errorBorder": "rgba(47, 111, 237, 0.55)",
      "inputValidation.errorBackground": "#ffffff",
      "inputValidation.errorForeground": "#0f0f0f",
      "diffEditor.insertedLineBackground": "#fff6df",
      "diffEditor.insertedTextBackground": "#ffe7b3",
      "diffEditor.removedLineBackground": "#e6f6ea",
      "diffEditor.removedTextBackground": "#bfe9c9",
      "diffEditor.border": "#d9dfe9",
    },
  });

  monaco.editor.defineTheme("graphoria-conflict-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "focusBorder": "rgba(75, 139, 255, 0.55)",
      "menu.foreground": "#f2f4f8",
      "menu.background": "#151922",
      "menu.border": "rgba(255, 255, 255, 0.12)",
      "menu.selectionForeground": "#f2f4f8",
      "menu.selectionBackground": "rgba(75, 139, 255, 0.20)",
      "menu.separatorBackground": "rgba(255, 255, 255, 0.12)",
      "list.hoverBackground": "rgba(75, 139, 255, 0.16)",
      "list.activeSelectionBackground": "rgba(75, 139, 255, 0.20)",
      "list.activeSelectionForeground": "#f2f4f8",
      "list.inactiveSelectionBackground": "rgba(75, 139, 255, 0.16)",
      "list.inactiveSelectionForeground": "#f2f4f8",
      "list.focusBackground": "rgba(75, 139, 255, 0.20)",
      "list.focusForeground": "#f2f4f8",
      "list.highlightForeground": "#80b3ff",
      "widget.shadow": "rgba(0, 0, 0, 0.55)",
      "widget.border": "rgba(255, 255, 255, 0.12)",
      "editorWidget.background": "#151922",
      "editorWidget.foreground": "#f2f4f8",
      "editorWidget.border": "rgba(255, 255, 255, 0.12)",
      "editorWidget.resizeBorder": "rgba(75, 139, 255, 0.55)",
      "quickInput.background": "#151922",
      "quickInput.foreground": "#f2f4f8",
      "quickInputTitle.background": "#101624",
      "quickInputList.focusBackground": "rgba(75, 139, 255, 0.20)",
      "quickInputList.focusForeground": "#f2f4f8",
      "quickInputList.focusIconForeground": "#f2f4f8",
      "input.background": "#1a1f2e",
      "input.foreground": "#f2f4f8",
      "input.border": "rgba(255, 255, 255, 0.18)",
      "input.placeholderForeground": "rgba(242, 244, 248, 0.50)",
      "inputOption.activeBorder": "rgba(75, 139, 255, 0.55)",
      "inputOption.activeBackground": "rgba(75, 139, 255, 0.20)",
      "inputOption.activeForeground": "#f2f4f8",
      "inputOption.hoverBackground": "rgba(75, 139, 255, 0.16)",
      "keybindingLabel.background": "rgba(255, 255, 255, 0.06)",
      "keybindingLabel.foreground": "#f2f4f8",
      "keybindingLabel.border": "rgba(255, 255, 255, 0.12)",
      "keybindingLabel.bottomBorder": "rgba(255, 255, 255, 0.18)",
      "inputValidation.infoBorder": "rgba(75, 139, 255, 0.55)",
      "inputValidation.infoBackground": "#151922",
      "inputValidation.infoForeground": "#f2f4f8",
      "inputValidation.warningBorder": "rgba(75, 139, 255, 0.55)",
      "inputValidation.warningBackground": "#151922",
      "inputValidation.warningForeground": "#f2f4f8",
      "inputValidation.errorBorder": "rgba(75, 139, 255, 0.55)",
      "inputValidation.errorBackground": "#151922",
      "inputValidation.errorForeground": "#f2f4f8",
      "diffEditor.insertedLineBackground": "#3a2f18",
      "diffEditor.insertedTextBackground": "#5a4014",
      "diffEditor.removedLineBackground": "#183020",
      "diffEditor.removedTextBackground": "#245a35",
      "diffEditor.border": "#2b3446",
    },
  });

  monaco.editor.defineTheme("graphoria-conflict-blue", {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "focusBorder": "rgba(31, 111, 235, 0.55)",
      "editor.background": "#f6faff",
      "editor.foreground": "#0a2346",
      "menu.foreground": "#0a2346",
      "menu.background": "#f6faff",
      "menu.border": "rgba(10, 35, 70, 0.16)",
      "menu.selectionForeground": "#0a2346",
      "menu.selectionBackground": "rgba(31, 111, 235, 0.14)",
      "menu.separatorBackground": "rgba(10, 35, 70, 0.16)",
      "list.hoverBackground": "rgba(31, 111, 235, 0.10)",
      "list.activeSelectionBackground": "rgba(31, 111, 235, 0.14)",
      "list.activeSelectionForeground": "#0a2346",
      "list.inactiveSelectionBackground": "rgba(31, 111, 235, 0.10)",
      "list.inactiveSelectionForeground": "#0a2346",
      "list.focusBackground": "rgba(31, 111, 235, 0.14)",
      "list.focusForeground": "#0a2346",
      "list.highlightForeground": "#1f6feb",
      "widget.shadow": "rgba(0, 0, 0, 0.18)",
      "widget.border": "rgba(10, 35, 70, 0.16)",
      "editorWidget.background": "#f6faff",
      "editorWidget.foreground": "#0a2346",
      "editorWidget.border": "rgba(10, 35, 70, 0.16)",
      "editorWidget.resizeBorder": "rgba(31, 111, 235, 0.55)",
      "quickInput.background": "#f6faff",
      "quickInput.foreground": "#0a2346",
      "quickInputTitle.background": "#eaf2ff",
      "quickInputList.focusBackground": "rgba(31, 111, 235, 0.14)",
      "quickInputList.focusForeground": "#0a2346",
      "quickInputList.focusIconForeground": "#0a2346",
      "input.background": "#f6faff",
      "input.foreground": "#0a2346",
      "input.border": "rgba(10, 35, 70, 0.22)",
      "input.placeholderForeground": "rgba(10, 35, 70, 0.50)",
      "inputOption.activeBorder": "rgba(31, 111, 235, 0.55)",
      "inputOption.activeBackground": "rgba(31, 111, 235, 0.14)",
      "inputOption.activeForeground": "#0a2346",
      "inputOption.hoverBackground": "rgba(31, 111, 235, 0.10)",
      "keybindingLabel.background": "rgba(10, 35, 70, 0.06)",
      "keybindingLabel.foreground": "#0a2346",
      "keybindingLabel.border": "rgba(10, 35, 70, 0.16)",
      "keybindingLabel.bottomBorder": "rgba(10, 35, 70, 0.22)",
      "inputValidation.infoBorder": "rgba(31, 111, 235, 0.55)",
      "inputValidation.infoBackground": "#f6faff",
      "inputValidation.infoForeground": "#0a2346",
      "inputValidation.warningBorder": "rgba(31, 111, 235, 0.55)",
      "inputValidation.warningBackground": "#f6faff",
      "inputValidation.warningForeground": "#0a2346",
      "inputValidation.errorBorder": "rgba(31, 111, 235, 0.55)",
      "inputValidation.errorBackground": "#f6faff",
      "inputValidation.errorForeground": "#0a2346",
      "diffEditor.insertedLineBackground": "#fff6df",
      "diffEditor.insertedTextBackground": "#ffe7b3",
      "diffEditor.removedLineBackground": "#e6f6ea",
      "diffEditor.removedTextBackground": "#bfe9c9",
      "diffEditor.border": "#c8d8ef",
    },
  });

  monaco.editor.defineTheme("graphoria-conflict-sepia", {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "focusBorder": "rgba(163, 91, 29, 0.55)",
      "editor.background": "#fffaf0",
      "editor.foreground": "#3d2b1f",
      "menu.foreground": "#3d2b1f",
      "menu.background": "#fffaf0",
      "menu.border": "rgba(61, 43, 31, 0.18)",
      "menu.selectionForeground": "#3d2b1f",
      "menu.selectionBackground": "rgba(163, 91, 29, 0.14)",
      "menu.separatorBackground": "rgba(61, 43, 31, 0.18)",
      "list.hoverBackground": "rgba(163, 91, 29, 0.10)",
      "list.activeSelectionBackground": "rgba(163, 91, 29, 0.14)",
      "list.activeSelectionForeground": "#3d2b1f",
      "list.inactiveSelectionBackground": "rgba(163, 91, 29, 0.10)",
      "list.inactiveSelectionForeground": "#3d2b1f",
      "list.focusBackground": "rgba(163, 91, 29, 0.14)",
      "list.focusForeground": "#3d2b1f",
      "list.highlightForeground": "#a35b1d",
      "widget.shadow": "rgba(0, 0, 0, 0.18)",
      "widget.border": "rgba(61, 43, 31, 0.18)",
      "editorWidget.background": "#fffaf0",
      "editorWidget.foreground": "#3d2b1f",
      "editorWidget.border": "rgba(61, 43, 31, 0.18)",
      "editorWidget.resizeBorder": "rgba(163, 91, 29, 0.55)",
      "quickInput.background": "#fffaf0",
      "quickInput.foreground": "#3d2b1f",
      "quickInputTitle.background": "#f5efe3",
      "quickInputList.focusBackground": "rgba(163, 91, 29, 0.14)",
      "quickInputList.focusForeground": "#3d2b1f",
      "quickInputList.focusIconForeground": "#3d2b1f",
      "input.background": "#fffaf0",
      "input.foreground": "#3d2b1f",
      "input.border": "rgba(61, 43, 31, 0.25)",
      "input.placeholderForeground": "rgba(61, 43, 31, 0.50)",
      "inputOption.activeBorder": "rgba(163, 91, 29, 0.55)",
      "inputOption.activeBackground": "rgba(163, 91, 29, 0.14)",
      "inputOption.activeForeground": "#3d2b1f",
      "inputOption.hoverBackground": "rgba(163, 91, 29, 0.10)",
      "keybindingLabel.background": "rgba(61, 43, 31, 0.06)",
      "keybindingLabel.foreground": "#3d2b1f",
      "keybindingLabel.border": "rgba(61, 43, 31, 0.18)",
      "keybindingLabel.bottomBorder": "rgba(61, 43, 31, 0.25)",
      "inputValidation.infoBorder": "rgba(163, 91, 29, 0.55)",
      "inputValidation.infoBackground": "#fffaf0",
      "inputValidation.infoForeground": "#3d2b1f",
      "inputValidation.warningBorder": "rgba(163, 91, 29, 0.55)",
      "inputValidation.warningBackground": "#fffaf0",
      "inputValidation.warningForeground": "#3d2b1f",
      "inputValidation.errorBorder": "rgba(163, 91, 29, 0.55)",
      "inputValidation.errorBackground": "#fffaf0",
      "inputValidation.errorForeground": "#3d2b1f",
      "diffEditor.insertedLineBackground": "#fff6df",
      "diffEditor.insertedTextBackground": "#ffe7b3",
      "diffEditor.removedLineBackground": "#e6f6ea",
      "diffEditor.removedTextBackground": "#bfe9c9",
      "diffEditor.border": "#e0d6c8",
    },
  });
}

function findConflictBlock(model: any, lineNumber: number) {
  const max = model.getLineCount();
  let start = -1;
  for (let ln = lineNumber; ln >= 1; ln--) {
    const t = model.getLineContent(ln);
    if (t.startsWith("<<<<<<<")) {
      start = ln;
      break;
    }
    if (t.startsWith(">>>>>>>")) {
      return null;
    }
  }
  if (start < 0) return null;

  let mid = -1;
  let end = -1;
  for (let ln = start + 1; ln <= max; ln++) {
    const t = model.getLineContent(ln);
    if (t.startsWith("=======")) {
      mid = ln;
      continue;
    }
    if (t.startsWith(">>>>>>>")) {
      end = ln;
      break;
    }
  }
  if (mid < 0 || end < 0) return null;
  return { start, mid, end };
}

function pickLanguageByPath(path: string) {
  const p = path.toLowerCase();
  if (p.endsWith(".ts") || p.endsWith(".tsx")) return "typescript";
  if (p.endsWith(".js") || p.endsWith(".jsx")) return "javascript";
  if (p.endsWith(".json")) return "json";
  if (p.endsWith(".css")) return "css";
  if (p.endsWith(".html") || p.endsWith(".htm")) return "html";
  if (p.endsWith(".md")) return "markdown";
  if (p.endsWith(".rs")) return "rust";
  if (p.endsWith(".py")) return "python";
  if (p.endsWith(".go")) return "go";
  if (p.endsWith(".java")) return "java";
  if (p.endsWith(".c") || p.endsWith(".h")) return "c";
  if (p.endsWith(".cpp") || p.endsWith(".hpp")) return "cpp";
  if (p.endsWith(".yml") || p.endsWith(".yaml")) return "yaml";
  return "plaintext";
}

export function ConflictResolverModal({ open, repoPath, operation, initialFiles, busy, onClose, onContinue, onAbort, onSkipRebase }: Props) {
  const theme = useAppSettings((s) => s.appearance.theme);
  const layout = useAppSettings((s) => s.layout);
  const setLayout = useAppSettings((s) => s.setLayout);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const layoutRef = useRef<HTMLDivElement | null>(null);

  function startFilesResize(e: ReactMouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = layout.statusFilesWidthPx;

    const containerW = layoutRef.current?.getBoundingClientRect().width ?? window.innerWidth;

    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onMove = (ev: MouseEvent) => {
      const min = 260;
      const minRight = 520;
      const max = Math.max(min, Math.round(containerW - 6 - minRight));
      const next = Math.max(min, Math.min(max, Math.round(startW + (ev.clientX - startX))));
      setLayout({ statusFilesWidthPx: next });
    };

    const onUp = () => {
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const [files, setFiles] = useState<GitConflictFileEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>("");

  const [versions, setVersions] = useState<Versions | null>(null);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState("");

  const [renameKeepName, setRenameKeepName] = useState<"ours" | "theirs" | null>(null);

  const renameDiffOriginalEditorRef = useRef<any>(null);
  const renameDiffModifiedEditorRef = useRef<any>(null);

  const [editMode, setEditMode] = useState<"diff" | "result">("diff");
  const [resultDraft, setResultDraft] = useState<string>("");
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyError, setApplyError] = useState("");

  const [diffOurs, setDiffOurs] = useState<string>("");
  const [diffTheirs, setDiffTheirs] = useState<string>("");

  const lastAppliedResultRef = useRef<string>("");
  const resultInitKeyRef = useRef<string>("");

  const [ctxMenu, setCtxMenu] = useState<ConflictContextMenuState | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement | null>(null);

  const diffOriginalEditorRef = useRef<any>(null);
  const diffModifiedEditorRef = useRef<any>(null);
  const diffEditorRef = useRef<any>(null);
  const resultEditorRef = useRef<any>(null);

  const pendingRevealResultLineRef = useRef<number | null>(null);
  const pendingRevealDiffLineRef = useRef<number | null>(null);

  const resultLineLabels = useMemo(() => {
    return makeLogicalLineLabelsForConflictText(resultDraft);
  }, [resultDraft]);

  function mapLogicalToPhysicalResultLine(logicalLine: number) {
    const target = String(logicalLine);
    const idx = resultLineLabels.findIndex((x) => x === target);
    return idx >= 0 ? idx + 1 : logicalLine;
  }

  function mapPhysicalResultLineToLogical(physicalLine: number) {
    const raw = resultLineLabels[physicalLine - 1] ?? "";
    if (raw.trim()) {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) return n;
    }

    for (let i = physicalLine - 2; i >= 0; i--) {
      const v = resultLineLabels[i] ?? "";
      if (!v.trim()) continue;
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) return n;
      break;
    }

    for (let i = physicalLine; i < resultLineLabels.length; i++) {
      const v = resultLineLabels[i] ?? "";
      if (!v.trim()) continue;
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) return n;
      break;
    }

    return physicalLine;
  }

  function tryRevealResultLine(lineNumber?: number) {
    const editor = resultEditorRef.current;
    const model = editor?.getModel?.();
    if (!editor || !model) return;
    const target = lineNumber ?? pendingRevealResultLineRef.current;
    if (!target) return;

    const physicalTarget = mapLogicalToPhysicalResultLine(target);
    const ln = Math.max(1, Math.min(model.getLineCount(), physicalTarget || 1));
    editor.focus?.();
    editor.setPosition?.({ lineNumber: ln, column: 1 });
    editor.revealLineInCenter?.(ln);
    pendingRevealResultLineRef.current = null;
  }

  function tryRevealDiffLine(lineNumber?: number) {
    const o = diffOriginalEditorRef.current;
    const m = diffModifiedEditorRef.current;
    const om = o?.getModel?.();
    const mm = m?.getModel?.();

    const target = lineNumber ?? pendingRevealDiffLineRef.current;
    if (!target) return;

    if (o && om) {
      const ln = Math.max(1, Math.min(om.getLineCount(), target || 1));
      o.focus?.();
      o.setPosition?.({ lineNumber: ln, column: 1 });
      o.revealLineInCenter?.(ln);
    }

    if (m && mm) {
      const ln = Math.max(1, Math.min(mm.getLineCount(), target || 1));
      m.setPosition?.({ lineNumber: ln, column: 1 });
      m.revealLineInCenter?.(ln);
    }

    if ((o && om) || (m && mm)) {
      pendingRevealDiffLineRef.current = null;
    }
  }

  function showInResultView(lineNumber: number) {
    pendingRevealResultLineRef.current = lineNumber;
    setEditMode("result");
  }

  function showInDiffView(lineNumber: number) {
    pendingRevealDiffLineRef.current = lineNumber;
    setEditMode("diff");
  }

  const initialWorkingByPathRef = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;

    let alive = true;
    setLoading(true);
    setError("");
    setFiles([]);
    setSelectedPath("");
    setVersions(null);
    setVersionsError("");
    setVersionsLoading(false);
    setApplyError("");
    setApplyBusy(false);
    setEditMode("diff");
    setResultDraft("");
    setDiffOurs("");
    setDiffTheirs("");
    setRenameKeepName(null);

    initialWorkingByPathRef.current = {};

    void (async () => {
      try {
        const st = await gitConflictState(repoPath);
        if (!alive) return;

        let list = st.files ?? [];
        if (initialFiles && initialFiles.length > 0) {
          const wanted = new Set(initialFiles);
          const filtered = list.filter((f) => wanted.has(f.path));
          if (filtered.length > 0) list = filtered;
        }

        setFiles(list);
        if (list.length > 0) {
          setSelectedPath(list[0].path);
        }
      } catch (e) {
        if (!alive) return;
        setError(typeof e === "string" ? e : JSON.stringify(e));
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [open, repoPath, initialFiles]);

  useEffect(() => {
    if (!open) return;
    document.body.classList.add("conflictResolverMenu");
    document.documentElement.classList.add("conflictResolverMenu");
    return () => {
      document.body.classList.remove("conflictResolverMenu");
      document.documentElement.classList.remove("conflictResolverMenu");
    };
  }, [open]);

  useEffect(() => {
    if (!ctxMenu) return;

    const onMouseDown = (e: MouseEvent) => {
      const menuEl = ctxMenuRef.current;
      if (menuEl && e.target instanceof Node && menuEl.contains(e.target)) return;
      setCtxMenu(null);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCtxMenu(null);
    };

    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [ctxMenu]);

  const displayFiles = useMemo(() => {
    const list = files.slice();
    const p = selectedPath.trim();
    if (p && !list.some((f) => f.path === p)) {
      list.unshift({ path: p, status: "", stages: [] });
    }
    return list;
  }, [files, selectedPath]);

  useEffect(() => {
    if (!open) return;
    if (!selectedPath.trim()) {
      setVersions(null);
      setVersionsError("");
      setVersionsLoading(false);
      setResultDraft("");
      setDiffOurs("");
      setDiffTheirs("");
      return;
    }

    let alive = true;
    setVersions(null);
    setVersionsLoading(true);
    setVersionsError("");
    setApplyError("");
    setApplyBusy(false);

    void (async () => {
      try {
        const res = await gitConflictFileVersions({ repoPath, path: selectedPath });
        if (!alive) return;

        const next: Versions = {
          base: normalizeNewlines(res.base ?? ""),
          ours: normalizeNewlines(res.ours ?? ""),
          theirs: normalizeNewlines(res.theirs ?? ""),
          working: normalizeNewlines(res.working ?? ""),
          oursPath: (res.ours_path ?? selectedPath) || selectedPath,
          theirsPath: res.theirs_path ?? "",
          oursDeleted: !!res.ours_deleted,
          theirsDeleted: !!res.theirs_deleted,
          conflictKind: (res.conflict_kind === "rename" || res.conflict_kind === "modify_delete" ? res.conflict_kind : "text") as any,
        };

        setVersions(next);
        setResultDraft(next.working);
        lastAppliedResultRef.current = next.working;
        if (next.conflictKind === "text") {
          setDiffOurs(buildVariantFromWorking(next.working, "ours"));
          setDiffTheirs(buildVariantFromWorking(next.working, "theirs"));
        } else {
          setDiffOurs(next.oursDeleted ? "" : next.ours);
          setDiffTheirs(next.theirsDeleted ? "" : next.theirs);
        }

        if (next.conflictKind === "rename") {
          setRenameKeepName(null);
        }

        // Auto-switch to Result tab when Diff view can't show side-by-side
        if (next.conflictKind === "text" && (!next.ours.trim() || !next.theirs.trim())) {
          setEditMode("result");
        }

        if (!initialWorkingByPathRef.current[selectedPath]) {
          initialWorkingByPathRef.current[selectedPath] = next.working;
        }
      } catch (e) {
        if (!alive) return;
        setVersionsError(typeof e === "string" ? e : JSON.stringify(e));
      } finally {
        if (!alive) return;
        setVersionsLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [open, repoPath, selectedPath]);

  const monacoTheme = useMemo(() => {
    switch (theme) {
      case "dark": return "graphoria-conflict-dark";
      case "blue": return "graphoria-conflict-blue";
      case "sepia": return "graphoria-conflict-sepia";
      default: return "graphoria-conflict-light";
    }
  }, [theme]);

  const lang = useMemo(() => pickLanguageByPath(selectedPath), [selectedPath]);

  const resultDraftRef = useRef<string>("");
  useEffect(() => {
    resultDraftRef.current = resultDraft;
  }, [resultDraft]);

  const hasUnmergedFiles = useMemo(() => {
    for (const f of files) {
      if (isUnmergedStatus(f.status)) return true;
    }
    return false;
  }, [files]);

  async function refreshStateKeepPath() {
    const st = await gitConflictState(repoPath);
    const list = st.files ?? [];
    setFiles(list);
    if (!selectedPath.trim() && list.length > 0) {
      setSelectedPath(list[0].path);
    }
  }

  async function reloadSelectedVersions() {
    const p = selectedPath.trim();
    if (!p) return;
    const res = await gitConflictFileVersions({ repoPath, path: p });
    const next: Versions = {
      base: normalizeNewlines(res.base ?? ""),
      ours: normalizeNewlines(res.ours ?? ""),
      theirs: normalizeNewlines(res.theirs ?? ""),
      working: normalizeNewlines(res.working ?? ""),
      oursPath: (res.ours_path ?? p) || p,
      theirsPath: res.theirs_path ?? "",
      oursDeleted: !!res.ours_deleted,
      theirsDeleted: !!res.theirs_deleted,
      conflictKind: (res.conflict_kind === "rename" || res.conflict_kind === "modify_delete" ? res.conflict_kind : "text") as any,
    };
    setVersions(next);
    setResultDraft(next.working);
    lastAppliedResultRef.current = next.working;
    if (next.conflictKind === "text") {
      setDiffOurs(buildVariantFromWorking(next.working, "ours"));
      setDiffTheirs(buildVariantFromWorking(next.working, "theirs"));
    } else {
      setDiffOurs(next.oursDeleted ? "" : next.ours);
      setDiffTheirs(next.theirsDeleted ? "" : next.theirs);
    }

    if (next.conflictKind === "rename") {
      setRenameKeepName(null);
    }

    if (!initialWorkingByPathRef.current[p]) {
      initialWorkingByPathRef.current[p] = next.working;
    }
  }

  async function reloadVersionsForPath(path: string) {
    const p = (path ?? "").trim();
    if (!p) return;
    const res = await gitConflictFileVersions({ repoPath, path: p });
    const next: Versions = {
      base: normalizeNewlines(res.base ?? ""),
      ours: normalizeNewlines(res.ours ?? ""),
      theirs: normalizeNewlines(res.theirs ?? ""),
      working: normalizeNewlines(res.working ?? ""),
      oursPath: (res.ours_path ?? p) || p,
      theirsPath: res.theirs_path ?? "",
      oursDeleted: !!res.ours_deleted,
      theirsDeleted: !!res.theirs_deleted,
      conflictKind: (res.conflict_kind === "rename" || res.conflict_kind === "modify_delete" ? res.conflict_kind : "text") as any,
    };

    setVersions(next);
    setResultDraft(next.working);
    if (next.conflictKind === "text") {
      setDiffOurs(buildVariantFromWorking(next.working, "ours"));
      setDiffTheirs(buildVariantFromWorking(next.working, "theirs"));
    } else {
      setDiffOurs(next.oursDeleted ? "" : next.ours);
      setDiffTheirs(next.theirsDeleted ? "" : next.theirs);
    }

    if (next.conflictKind === "rename") {
      setRenameKeepName(null);
    }

    if (!initialWorkingByPathRef.current[p]) {
      initialWorkingByPathRef.current[p] = next.working;
    }
  }

  function openEditorContextMenu(e: ReactMouseEvent, items: ConflictContextMenuItem[]) {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  }

  function makeCopyItem(editor: any): ConflictContextMenuItem {
    return {
      label: "Copy",
      onClick: () => {
        setCtxMenu(null);
        try {
          editor?.focus?.();
          editor?.trigger?.("graphoria", "editor.action.clipboardCopyAction", null);
        } catch {
          // ignore
        }
      },
    };
  }

  function patchQuickInputBorder() {
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "rgba(47, 111, 237, 0.55)";
    const panel = getComputedStyle(document.documentElement).getPropertyValue("--panel").trim() || "#ffffff";
    let tries = 0;
    const id = setInterval(() => {
      const boxes = document.querySelectorAll<HTMLElement>(".quick-input-widget .monaco-inputbox");
      if (boxes.length > 0) {
        boxes.forEach((box) => {
          box.style.setProperty("border-color", accent, "important");
          box.style.setProperty("border-width", "1px", "important");
          box.style.setProperty("border-style", "solid", "important");
          box.style.setProperty("outline", "none", "important");
          box.style.setProperty("box-shadow", "none", "important");
          box.style.setProperty("background", panel, "important");
        });
        clearInterval(id);
      }
      if (++tries > 20) clearInterval(id);
    }, 30);
  }

  function makeCommandPaletteItem(editor: any): ConflictContextMenuItem {
    return {
      label: "Command Palette",
      shortcut: "F1",
      onClick: () => {
        setCtxMenu(null);
        try {
          editor?.focus?.();
          editor?.trigger?.("graphoria", "editor.action.quickCommand", null);
          patchQuickInputBorder();
        } catch {
          // ignore
        }
      },
    };
  }

  async function resolveRenameWithContent(keepContent: "ours" | "theirs") {
    if (!selectedPath.trim()) return;
    if (!versions || versions.conflictKind !== "rename") return;
    if (!renameKeepName) {
      setApplyError("Select final name (ours/theirs) first.");
      return;
    }

    const finalPath =
      renameKeepName === "ours"
        ? versions.oursPath
        : (versions.theirsPath || "").trim() || versions.oursPath;

    setApplyBusy(true);
    setApplyError("");
    try {
      await gitConflictResolveRename({ repoPath, path: selectedPath, keepName: renameKeepName, keepContent });
      setSelectedPath(finalPath);
      await refreshStateKeepPath();
      await reloadVersionsForPath(finalPath);
    } catch (e) {
      setApplyError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setApplyBusy(false);
    }
  }

  async function applyContentOrStageIfResolved(content: string) {
    if (listConflictBlocksFromText(content).length === 0) {
      await applyAndStageContent(content);
      return;
    }
    await applyContent(content);
  }

  async function takeOurs() {
    if (!selectedPath.trim()) return;
    if (versions?.conflictKind === "modify_delete") {
      setApplyBusy(true);
      setApplyError("");
      try {
        await gitConflictTakeOurs({ repoPath, path: selectedPath });
        await reloadSelectedVersions();
        await refreshStateKeepPath();
      } catch (e) {
        setApplyError(typeof e === "string" ? e : JSON.stringify(e));
      } finally {
        setApplyBusy(false);
      }
      return;
    }
    if (versions?.conflictKind === "rename") {
      await resolveRenameWithContent("ours");
      return;
    }
    const current = resultDraftRef.current;
    const blocks = listConflictBlocksFromText(current);
    if (blocks.length === 0) {
      await applyAndStageContent(current);
      return;
    }

    let next = current;
    while (true) {
      const bs = listConflictBlocksFromText(next);
      if (bs.length === 0) break;
      next = applyConflictBlock(next, 0, bs[0]?.oursText ?? "");
    }
    setResultDraft(next);
    await applyAndStageContent(next);
  }

  async function applyAndStageContent(content: string) {
    if (!selectedPath.trim()) return;
    setApplyBusy(true);
    setApplyError("");
    try {
      await gitConflictApplyAndStage({ repoPath, path: selectedPath, content });
      await reloadSelectedVersions();
      await refreshStateKeepPath();
    } catch (e) {
      setApplyError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setApplyBusy(false);
    }
  }

  async function applyContent(content: string) {
    if (!selectedPath.trim()) return;
    setApplyBusy(true);
    setApplyError("");
    try {
      await gitConflictApply({ repoPath, path: selectedPath, content });
      lastAppliedResultRef.current = content;
    } catch (e) {
      setApplyError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setApplyBusy(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    if (editMode !== "result") return;
    if (!selectedPath.trim()) return;
    if (!versions) return;
    if (applyBusy) return;
    if (versions.conflictKind === "rename" || versions.conflictKind === "modify_delete") return;
    if (resultDraft === lastAppliedResultRef.current) return;

    const t = window.setTimeout(() => {
      if (applyBusy) return;
      if (!selectedPath.trim()) return;
      if (!versions) return;
      if (versions.conflictKind === "rename" || versions.conflictKind === "modify_delete") return;

      const content = resultDraftRef.current;
      void (async () => {
        await applyContent(content);
      })();
    }, 550);

    return () => {
      window.clearTimeout(t);
    };
  }, [open, editMode, selectedPath, versions, resultDraft, applyBusy]);

  async function applyRenameResult() {
    if (!selectedPath.trim()) return;
    if (!versions || versions.conflictKind !== "rename") return;
    if (!renameKeepName) {
      setApplyError("Select final name (ours/theirs) first.");
      return;
    }

    const finalPath =
      renameKeepName === "ours"
        ? versions.oursPath
        : (versions.theirsPath || "").trim() || versions.oursPath;

    setApplyBusy(true);
    setApplyError("");
    try {
      await gitConflictResolveRenameWithContent({ repoPath, path: selectedPath, keepName: renameKeepName, content: resultDraftRef.current });
      setSelectedPath(finalPath);
      await refreshStateKeepPath();
      await reloadVersionsForPath(finalPath);
    } catch (e) {
      setApplyError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setApplyBusy(false);
    }
  }

  async function applyModifyDeleteResult() {
    if (!selectedPath.trim()) return;
    if (!versions || versions.conflictKind !== "modify_delete") return;

    const content = resultDraftRef.current;
    setApplyBusy(true);
    setApplyError("");
    try {
      if (!content.trim()) {
        if (versions.theirsDeleted) {
          await gitConflictTakeTheirs({ repoPath, path: selectedPath });
        } else if (versions.oursDeleted) {
          await gitConflictTakeOurs({ repoPath, path: selectedPath });
        } else {
          await gitConflictApplyAndStage({ repoPath, path: selectedPath, content: "" });
        }
      } else {
        await gitConflictApplyAndStage({ repoPath, path: selectedPath, content });
      }
      await reloadSelectedVersions();
      await refreshStateKeepPath();
    } catch (e) {
      setApplyError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setApplyBusy(false);
    }
  }

  async function applyTextResult() {
    if (!selectedPath.trim()) return;
    if (!versions || versions.conflictKind !== "text") return;

    const content = resultDraftRef.current;
    setApplyError("");

    const blocks = listConflictBlocksFromText(content);
    if (blocks.length === 0) {
      await applyAndStageContent(content);
      return;
    }

    const working = versions.working ?? "";
    const workingBlocks = splitTextByConflictBlocks(working).filter((p) => p.kind === "block") as Array<{ kind: "block"; raw: string }>;

    let blkIdx = 0;
    const merged = splitTextByConflictBlocks(content)
      .map((p) => {
        if (p.kind === "block") {
          const raw = workingBlocks[blkIdx]?.raw ?? p.raw;
          blkIdx++;
          return raw;
        }
        return p.text;
      })
      .join("\n");

    await applyContent(merged);

    setVersions((prev) => {
      if (!prev) return prev;
      return { ...prev, working: merged };
    });
    setResultDraft(merged);
    lastAppliedResultRef.current = merged;
    setDiffOurs(buildVariantFromWorking(merged, "ours"));
    setDiffTheirs(buildVariantFromWorking(merged, "theirs"));
  }

  const selectedIsUnmerged = useMemo(() => {
    const p = selectedPath.trim();
    if (!p) return false;
    const f = files.find((x) => x.path === p);
    if (!f) return false;
    return isUnmergedStatus(f.status);
  }, [files, selectedPath]);

  useEffect(() => {
    if (!open) return;
    if (editMode !== "result") return;
    if (!selectedPath.trim()) return;
    if (!versions) return;
    if (!selectedIsUnmerged) return;
    if (versions.conflictKind !== "rename" && versions.conflictKind !== "modify_delete") return;

    const key = `${selectedPath}::${versions.conflictKind}::${versions.oursDeleted ? "od" : ""}${versions.theirsDeleted ? "td" : ""}`;
    if (resultInitKeyRef.current === key) return;

    const oursText = versions.oursDeleted ? "" : versions.ours;
    const theirsText = versions.theirsDeleted ? "" : versions.theirs;
    setResultDraft(makeSyntheticConflictText(oursText, theirsText));
    resultInitKeyRef.current = key;
  }, [open, editMode, selectedIsUnmerged, selectedPath, versions]);

  const nextUnmergedPath = useMemo(() => {
    const p = selectedPath.trim();
    const list = displayFiles;
    const isUnmerged = (st: string) => isUnmergedStatus(st);
    const idx = p ? list.findIndex((f) => f.path === p) : -1;
    for (let i = Math.max(0, idx + 1); i < list.length; i++) {
      const f = list[i];
      if (f.path !== p && isUnmerged(f.status)) return f.path;
    }
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      if (f.path !== p && isUnmerged(f.status)) return f.path;
    }
    return "";
  }, [displayFiles, selectedPath]);

  const hasOtherUnmerged = useMemo(() => {
    return !!nextUnmergedPath;
  }, [nextUnmergedPath]);

  function goToNextUnmerged() {
    if (!nextUnmergedPath.trim()) return;
    setSelectedPath(nextUnmergedPath);
  }

  async function resetCurrentFile() {
    const p = selectedPath.trim();
    if (!p) return;
    if (!selectedIsUnmerged) return;
    const initial = initialWorkingByPathRef.current[p];
    if (typeof initial !== "string") return;

    setResultDraft(initial);
    setDiffOurs(buildVariantFromWorking(initial, "ours"));
    setDiffTheirs(buildVariantFromWorking(initial, "theirs"));
    await applyContent(initial);
    await refreshStateKeepPath();
  }

  async function resetAllFiles() {
    setApplyBusy(true);
    setApplyError("");
    try {
      for (const f of files) {
        const s = (f.status ?? "").replace(/\s+/g, "");
        if (!isUnmergedStatus(s)) continue;
        const initial = initialWorkingByPathRef.current[f.path];
        if (typeof initial !== "string") continue;
        await gitConflictApply({ repoPath, path: f.path, content: initial });
      }
      await refreshStateKeepPath();
      await reloadSelectedVersions();
    } catch (e) {
      setApplyError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setApplyBusy(false);
    }
  }

  async function takeTheirs() {
    if (!selectedPath.trim()) return;
    if (versions?.conflictKind === "modify_delete") {
      setApplyBusy(true);
      setApplyError("");
      try {
        await gitConflictTakeTheirs({ repoPath, path: selectedPath });
        await reloadSelectedVersions();
        await refreshStateKeepPath();
      } catch (e) {
        setApplyError(typeof e === "string" ? e : JSON.stringify(e));
      } finally {
        setApplyBusy(false);
      }
      return;
    }
    if (versions?.conflictKind === "rename") {
      await resolveRenameWithContent("theirs");
      return;
    }
    const current = resultDraftRef.current;
    const blocks = listConflictBlocksFromText(current);
    if (blocks.length === 0) {
      await applyAndStageContent(current);
      return;
    }

    let next = current;
    while (true) {
      const bs = listConflictBlocksFromText(next);
      if (bs.length === 0) break;
      next = applyConflictBlock(next, 0, bs[0]?.theirsText ?? "");
    }
    setResultDraft(next);
    await applyAndStageContent(next);
  }

  if (!open) return null;

  const disabled = loading || busy || applyBusy;
  const continueDisabled = disabled || hasUnmergedFiles;
  const renameNeedsNameChoice = versions?.conflictKind === "rename" && !renameKeepName;

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modal conflictResolverModal" style={{ width: "min(1320px, 96vw)", height: "min(92vh, 980px)", maxHeight: "min(92vh, 980px)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>Resolve conflicts</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              onClick={() => void resetAllFiles()}
              disabled={disabled || files.length === 0}
              title="Restore all conflict files to the state from when you started resolving"
            >
              Reset conflicts
            </button>
            <button
              type="button"
              onClick={() => void resetCurrentFile()}
              disabled={disabled || !selectedPath.trim() || !selectedIsUnmerged}
              title={!selectedIsUnmerged ? "Available only for files that are still unmerged" : "Restore this file to the initial conflict state"}
            >
              Reset file
            </button>
            <button type="button" onClick={onClose} disabled={disabled}>
              Close
            </button>
          </div>
        </div>

        <div
          ref={layoutRef}
          className="modalBody"
          style={{
            padding: 12,
            display: "grid",
            gridTemplateColumns: `${layout.statusFilesWidthPx}px 6px 1fr`,
            gap: 12,
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <div style={{ minHeight: 0, display: "grid", gridTemplateRows: "auto auto 1fr", gap: 10 }}>
            {error ? <div className="error">{error}</div> : null}

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ opacity: 0.8, fontWeight: 800 }}>
                Operation: <span className="mono">{operation}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  void refreshStateKeepPath();
                }}
                disabled={disabled}
                title="Refresh conflict state"
              >
                Refresh
              </button>
            </div>

            {loading ? <div className="diffEmpty">Loading…</div> : null}

            {!loading ? (
              displayFiles.length === 0 ? (
                <div className="diffEmpty">No conflicts detected.</div>
              ) : (
                <div className="diffFileList" style={{ padding: 0 }}>
                  {displayFiles.map((f) => (
                    <button
                      key={f.path}
                      type="button"
                      className={f.path === selectedPath ? "diffFile diffFileActive" : "diffFile"}
                      onClick={() => setSelectedPath(f.path)}
                      style={{ gridTemplateColumns: "64px 1fr" }}
                      title={f.path}
                    >
                      <span className="diffStatus">{formatConflictStatus(f.status)}</span>
                      <span className="diffPath">{f.path}</span>
                    </button>
                  ))}
                </div>
              )
            ) : null}
          </div>

          <div className="splitterV" onMouseDown={startFilesResize} title="Drag to resize files list" />

          <div style={{ minHeight: 0, display: "grid", gridTemplateRows: "auto 1fr", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div className="segmented small" style={{ flex: "0 0 auto" }}>
                <button type="button" className={editMode === "diff" ? "active" : ""} onClick={() => setEditMode("diff")}>
                  Diff
                </button>
                <button type="button" className={editMode === "result" ? "active" : ""} onClick={() => setEditMode("result")}>
                  Result
                </button>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span className="conflictLegend conflictLegend-ours">ours</span>
                <span className="conflictLegend conflictLegend-theirs">theirs</span>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {!selectedIsUnmerged ? (
                  hasOtherUnmerged ? (
                    <button
                      key="next-unmerged"
                      type="button"
                      onClick={goToNextUnmerged}
                      disabled={disabled}
                      title="This file looks great, go to the next one"
                    >
                      Go to next file with conflicts
                    </button>
                  ) : (
                    <div style={{ fontWeight: 800, opacity: 0.8, padding: "6px 2px" }}>All conflicts resolved!</div>
                  )
                ) : (
                  <>
                    <button
                      key="take-ours"
                      type="button"
                      onClick={() => void takeOurs()}
                      disabled={disabled || !selectedPath.trim() || renameNeedsNameChoice}
                      title={
                        renameNeedsNameChoice
                          ? "Select final name (ours/theirs) first"
                          : "Take only our version for the whole file and stage it"
                      }
                    >
                      Take ours
                    </button>
                    <button
                      key="take-theirs"
                      type="button"
                      onClick={() => void takeTheirs()}
                      disabled={disabled || !selectedPath.trim() || renameNeedsNameChoice}
                      title={
                        renameNeedsNameChoice
                          ? "Select final name (ours/theirs) first"
                          : "Take only their version for the whole file and stage it"
                      }
                    >
                      Take theirs
                    </button>
                  </>
                )}
              </div>
            </div>

            {applyError ? <div className="error">{applyError}</div> : null}
            {versionsError ? <div className="error">{versionsError}</div> : null}

            <div style={{ minHeight: 0, border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
              {versionsLoading ? (
                <div className="diffEmpty">Loading…</div>
              ) : !versions ? (
                <div className="diffEmpty">Select a file.</div>
              ) : !selectedIsUnmerged && selectedPath.trim() ? (
                versions.working.trim() ? (
                  <Editor
                    height="100%"
                    theme={monacoTheme}
                    language={lang}
                    value={versions.working}
                    beforeMount={(monaco) => {
                      ensureConflictThemes(monaco);
                    }}
                    onMount={(_, monaco) => {
                      ensureConflictThemes(monaco);
                    }}
                    options={{
                      readOnly: true,
                      contextmenu: false,
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      wordWrap: "on",
                      fontSize: 12,
                    }}
                  />
                ) : (
                  <div className="diffEmpty">File does not exist.</div>
                )
              ) : versions.conflictKind === "rename" ? (
                editMode === "diff" ? (
                  <div style={{ height: "100%", display: "grid", gridTemplateRows: "auto 1fr", minHeight: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: "1px solid var(--border)", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ fontWeight: 900, opacity: 0.8 }}>
                        <span style={renameNeedsNameChoice ? { color: "var(--danger)" } : undefined}>
                          {renameNeedsNameChoice ? "Rename conflict!" : "Rename conflict"}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <span style={renameNeedsNameChoice ? { fontWeight: 900, color: "var(--danger)" } : { fontWeight: 800, opacity: 0.75 }}>
                          {renameNeedsNameChoice ? "Set final name first:" : "Final name:"}
                        </span>
                        <button
                          type="button"
                          onClick={() => setRenameKeepName("ours")}
                          className="conflictLegend conflictLegend-ours"
                          style={{
                            cursor: "pointer",
                            background: renameNeedsNameChoice ? "rgba(0, 140, 0, 0.22)" : undefined,
                            borderColor: renameNeedsNameChoice ? "rgba(0, 140, 0, 0.32)" : undefined,
                            outline: renameKeepName === "ours" ? "2px solid rgba(0, 140, 0, 0.28)" : "none",
                            outlineOffset: 1,
                          }}
                          title="Keep our file name"
                        >
                          {versions.oursPath}
                        </button>
                        <button
                          type="button"
                          onClick={() => setRenameKeepName("theirs")}
                          className="conflictLegend conflictLegend-theirs"
                          style={{
                            cursor: "pointer",
                            background: renameNeedsNameChoice ? "rgba(255, 215, 130, 0.35)" : undefined,
                            borderColor: renameNeedsNameChoice ? "rgba(255, 215, 130, 0.55)" : undefined,
                            outline: renameKeepName === "theirs" ? "2px solid rgba(255, 215, 130, 0.55)" : "none",
                            outlineOffset: 1,
                          }}
                          title="Keep their file name"
                        >
                          {versions.theirsPath || "(unknown)"}
                        </button>
                      </div>
                    </div>

                    <div
                      style={{ height: "100%", minHeight: 0 }}
                      onContextMenu={(e) => {
                        const t = e.target as HTMLElement | null;
                        const isOriginal = !!t?.closest?.(".original") && !t?.closest?.(".modified");
                        const editor = isOriginal ? renameDiffOriginalEditorRef.current : renameDiffModifiedEditorRef.current;
                        const items: ConflictContextMenuItem[] = [
                          {
                            label: "Use this version",
                            disabled: !renameKeepName,
                            onClick: () => {
                              setCtxMenu(null);
                              void resolveRenameWithContent(isOriginal ? "ours" : "theirs");
                            },
                          },
                          makeCopyItem(editor),
                          makeCommandPaletteItem(editor),
                        ];
                        openEditorContextMenu(e, items);
                      }}
                    >
                      <DiffEditor
                        height="100%"
                        theme={monacoTheme}
                        language={lang}
                        original={versions.ours}
                        modified={versions.theirs}
                        beforeMount={(monaco) => {
                          ensureConflictThemes(monaco);
                        }}
                        onMount={(diffEditor, monaco) => {
                          ensureConflictThemes(monaco);
                          renameDiffOriginalEditorRef.current = diffEditor.getOriginalEditor();
                          renameDiffModifiedEditorRef.current = diffEditor.getModifiedEditor();
                        }}
                        options={{
                          readOnly: true,
                          contextmenu: false,
                          renderSideBySide: true,
                          renderSideBySideInlineBreakpoint: 0,
                          minimap: { enabled: false },
                          scrollBeyondLastLine: false,
                          wordWrap: "on",
                          fontSize: 12,
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  <div style={{ height: "100%", display: "grid", gridTemplateRows: "auto 1fr", minHeight: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: "1px solid var(--border)", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 900, opacity: 0.8 }}>
                          <span style={renameNeedsNameChoice ? { color: "var(--danger)" } : undefined}>
                            {renameNeedsNameChoice ? "Rename conflict!" : "Rename conflict"}
                          </span>
                        </div>
                        <button type="button" onClick={() => void applyRenameResult()} disabled={disabled || renameNeedsNameChoice}>
                          Apply result
                        </button>
                      </div>
                      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <span style={renameNeedsNameChoice ? { fontWeight: 900, color: "var(--danger)" } : { fontWeight: 800, opacity: 0.75 }}>
                          {renameNeedsNameChoice ? "Set final name first:" : "Final name:"}
                        </span>
                        <button
                          type="button"
                          onClick={() => setRenameKeepName("ours")}
                          className="conflictLegend conflictLegend-ours"
                          style={{
                            cursor: "pointer",
                            background: renameNeedsNameChoice ? "rgba(0, 140, 0, 0.22)" : undefined,
                            borderColor: renameNeedsNameChoice ? "rgba(0, 140, 0, 0.32)" : undefined,
                            outline: renameKeepName === "ours" ? "2px solid rgba(0, 140, 0, 0.28)" : "none",
                            outlineOffset: 1,
                          }}
                          title="Keep our file name"
                        >
                          {versions.oursPath}
                        </button>
                        <button
                          type="button"
                          onClick={() => setRenameKeepName("theirs")}
                          className="conflictLegend conflictLegend-theirs"
                          style={{
                            cursor: "pointer",
                            background: renameNeedsNameChoice ? "rgba(255, 215, 130, 0.35)" : undefined,
                            borderColor: renameNeedsNameChoice ? "rgba(255, 215, 130, 0.55)" : undefined,
                            outline: renameKeepName === "theirs" ? "2px solid rgba(255, 215, 130, 0.55)" : "none",
                            outlineOffset: 1,
                          }}
                          title="Keep their file name"
                        >
                          {versions.theirsPath || "(unknown)"}
                        </button>
                      </div>
                    </div>

                    <Editor
                      height="100%"
                      theme={monacoTheme}
                      language={lang}
                      value={resultDraft}
                      beforeMount={(monaco) => {
                        ensureConflictThemes(monaco);
                      }}
                      onChange={(v: string | undefined) => {
                        setResultDraft(v ?? "");
                      }}
                      onMount={(_, monaco) => {
                        ensureConflictThemes(monaco);
                      }}
                      options={{
                        readOnly: false,
                        contextmenu: false,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        wordWrap: "on",
                        fontSize: 12,
                        lineNumbers: (n: number) => {
                          return resultLineLabels[n - 1] ?? String(n);
                        },
                      }}
                    />
                  </div>
                )
              ) : versions.conflictKind === "modify_delete" ? (
                editMode === "diff" ? (
                  <div style={{ height: "100%", display: "grid", gridTemplateRows: "auto 1fr", minHeight: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: "1px solid var(--border)", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ fontWeight: 900, opacity: 0.8 }}>Modify / Delete conflict</div>
                      <div style={{ opacity: 0.75 }}>
                        {versions.theirsDeleted ? <span className="conflictLegend conflictLegend-theirs">deleted on theirs</span> : null}
                        {versions.oursDeleted ? <span className="conflictLegend conflictLegend-ours">deleted on ours</span> : null}
                      </div>
                    </div>

                    <DiffEditor
                      height="100%"
                      theme={monacoTheme}
                      language={lang}
                      original={versions.ours}
                      modified={versions.theirsDeleted ? "" : versions.theirs}
                      beforeMount={(monaco) => {
                        ensureConflictThemes(monaco);
                      }}
                      onMount={(_, monaco) => {
                        ensureConflictThemes(monaco);
                      }}
                      options={{
                        readOnly: true,
                        contextmenu: false,
                        renderSideBySide: true,
                        renderSideBySideInlineBreakpoint: 0,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        wordWrap: "on",
                        fontSize: 12,
                      }}
                    />
                  </div>
                ) : (
                  <div style={{ height: "100%", display: "grid", gridTemplateRows: "auto 1fr", minHeight: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: "1px solid var(--border)", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 900, opacity: 0.8 }}>Modify / Delete conflict</div>
                        <button type="button" onClick={() => void applyModifyDeleteResult()} disabled={disabled}>
                          Apply result
                        </button>
                      </div>
                      <div style={{ opacity: 0.75 }}>
                        {versions.theirsDeleted ? <span className="conflictLegend conflictLegend-theirs">deleted on theirs</span> : null}
                        {versions.oursDeleted ? <span className="conflictLegend conflictLegend-ours">deleted on ours</span> : null}
                      </div>
                    </div>
                    <Editor
                      height="100%"
                      theme={monacoTheme}
                      language={lang}
                      value={resultDraft}
                      beforeMount={(monaco) => {
                        ensureConflictThemes(monaco);
                      }}
                      onChange={(v: string | undefined) => {
                        setResultDraft(v ?? "");
                      }}
                      onMount={(_, monaco) => {
                        ensureConflictThemes(monaco);
                      }}
                      options={{
                        readOnly: false,
                        contextmenu: false,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        wordWrap: "on",
                        fontSize: 12,
                      }}
                    />
                  </div>
                )
              ) : editMode === "diff" ? (
                <div
                  style={{ height: "100%", display: "grid", gridTemplateRows: "auto 1fr", minHeight: 0 }}
                  onContextMenu={(e) => {
                    const t = e.target as HTMLElement | null;
                    const isOriginal = !!t?.closest?.(".original") && !t?.closest?.(".modified");
                    const editor = isOriginal ? diffOriginalEditorRef.current : diffModifiedEditorRef.current;
                    const useActionId = isOriginal ? "graphoria.conflict.useThisVersion.original" : "graphoria.conflict.useThisVersion.modified";
                    const useBothActionId = isOriginal ? "graphoria.conflict.useBoth.original" : "graphoria.conflict.useBoth.modified";

                    const diffEditor = diffEditorRef.current;
                    const target = editor?.getTargetAtClientPoint?.(e.clientX, e.clientY);
                    const clickLine = target?.position?.lineNumber ?? editor?.getPosition?.()?.lineNumber ?? 1;
                    try {
                      editor?.setPosition?.({ lineNumber: clickLine, column: 1 });
                    } catch {
                      // ignore
                    }

                    const canUseThisVersion = (() => {
                      if (!diffEditor) return false;
                      const changes = diffEditor.getLineChanges?.() ?? [];
                      const ln = clickLine;
                      for (const c of changes) {
                        if (isOriginal) {
                          const a = c.originalStartLineNumber;
                          const b = c.originalEndLineNumber;
                          if (!a || !b || a === 0 || b === 0) continue;
                          if (ln >= a && ln <= b) return true;
                        } else {
                          const a = c.modifiedStartLineNumber;
                          const b = c.modifiedEndLineNumber;
                          if (!a || !b || a === 0 || b === 0) continue;
                          if (ln >= a && ln <= b) return true;
                        }
                      }
                      return false;
                    })();

                    const items: ConflictContextMenuItem[] = [
                      {
                        label: "Use this version",
                        disabled: !canUseThisVersion,
                        onClick: () => {
                          setCtxMenu(null);
                          if (!canUseThisVersion) return;
                          try {
                            editor?.focus?.();
                            editor?.getAction?.(useActionId)?.run?.();
                          } catch {
                            // ignore
                          }
                        },
                      },
                      {
                        label: "Use both (this goes first)",
                        disabled: !canUseThisVersion,
                        onClick: () => {
                          setCtxMenu(null);
                          if (!canUseThisVersion) return;
                          try {
                            editor?.focus?.();
                            editor?.getAction?.(useBothActionId)?.run?.();
                          } catch {
                            // ignore
                          }
                        },
                      },
                      {
                        label: "Show in the Result view",
                        onClick: () => {
                          setCtxMenu(null);
                          showInResultView(clickLine);
                        },
                      },
                      makeCopyItem(editor),
                      makeCommandPaletteItem(editor),
                    ];
                    openEditorContextMenu(e, items);
                  }}
                >
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, borderBottom: "1px solid var(--border)" }}>
                    <div style={{ padding: "6px 10px", fontWeight: 900, opacity: 0.75 }}>
                      <span className="conflictLegend conflictLegend-ours">ours</span>
                    </div>
                    <div style={{ padding: "6px 10px", fontWeight: 900, opacity: 0.75, textAlign: "right" }}>
                      <span className="conflictLegend conflictLegend-theirs">theirs</span>
                    </div>
                  </div>
                  {versions.ours.trim() && versions.theirs.trim() ? (
                    <DiffEditor
                      height="100%"
                      theme={monacoTheme}
                      language={lang}
                      original={diffOurs}
                      modified={diffTheirs}
                      beforeMount={(monaco) => {
                        ensureConflictThemes(monaco);
                      }}
                      onMount={(diffEditor, monaco) => {
                        ensureConflictThemes(monaco);

                        diffEditorRef.current = diffEditor;

                        const originalEditor = diffEditor.getOriginalEditor();
                        const modifiedEditor = diffEditor.getModifiedEditor();

                        diffOriginalEditorRef.current = originalEditor;
                        diffModifiedEditorRef.current = modifiedEditor;

                        const origKey = originalEditor.createContextKey<boolean>("graphoriaConflictUseThisVersion", false);
                        const modKey = modifiedEditor.createContextKey<boolean>("graphoriaConflictUseThisVersion", false);

                        function findChangeIndex(isOriginal: boolean, lineNumber: number) {
                          const changes = diffEditor.getLineChanges() ?? [];
                          for (let idx = 0; idx < changes.length; idx++) {
                            const c = changes[idx];
                            if (isOriginal) {
                              const a = c.originalStartLineNumber;
                              const b = c.originalEndLineNumber;
                              if (a === 0 && b === 0) continue;
                              if (lineNumber >= a && lineNumber <= b) return idx;
                            } else {
                              const a = c.modifiedStartLineNumber;
                              const b = c.modifiedEndLineNumber;
                              if (a === 0 && b === 0) continue;
                              if (lineNumber >= a && lineNumber <= b) return idx;
                            }
                          }
                          return -1;
                        }

                        function normalizeComparable(s: string) {
                          return normalizeNewlines(s).replace(/\s+$/g, "").trim();
                        }

                        function getBlocksNow() {
                          return listConflictBlocksFromText(resultDraftRef.current);
                        }

                        function findConflictBlockIndexFromChange(isOriginal: boolean, changeIndex: number) {
                          const changes = diffEditor.getLineChanges() ?? [];
                          const c = changes[changeIndex];
                          if (!c) return -1;

                          const model = isOriginal ? originalEditor.getModel() : modifiedEditor.getModel();
                          if (!model) return -1;

                          const start = isOriginal ? c.originalStartLineNumber : c.modifiedStartLineNumber;
                          const end = isOriginal ? c.originalEndLineNumber : c.modifiedEndLineNumber;
                          if (!start || !end || start === 0 || end === 0) return -1;

                          const chunk = normalizeComparable(model.getValueInRange({
                            startLineNumber: start,
                            startColumn: 1,
                            endLineNumber: end,
                            endColumn: model.getLineMaxColumn(end),
                          }));
                          if (!chunk) return -1;

                          const blocksNow = getBlocksNow();
                          for (let i = 0; i < blocksNow.length; i++) {
                            const b = blocksNow[i];
                            const candidate = normalizeComparable(isOriginal ? b.oursText : b.theirsText);
                            if (!candidate) continue;
                            if (chunk === candidate) return i;
                          }

                          for (let i = 0; i < blocksNow.length; i++) {
                            const b = blocksNow[i];
                            const candidate = normalizeComparable(isOriginal ? b.oursText : b.theirsText);
                            if (!candidate) continue;
                            if (chunk.includes(candidate) || candidate.includes(chunk)) return i;
                          }

                          return -1;
                        }

                        function updateKeys() {
                          const op = originalEditor.getPosition();
                          const mp = modifiedEditor.getPosition();
                          const oChangeIdx = op ? findChangeIndex(true, op.lineNumber) : -1;
                          const mChangeIdx = mp ? findChangeIndex(false, mp.lineNumber) : -1;
                          const oBlkIdx = oChangeIdx >= 0 ? findConflictBlockIndexFromChange(true, oChangeIdx) : -1;
                          const mBlkIdx = mChangeIdx >= 0 ? findConflictBlockIndexFromChange(false, mChangeIdx) : -1;

                          origKey.set(oBlkIdx >= 0);
                          modKey.set(mBlkIdx >= 0);
                        }

                        updateKeys();
                        originalEditor.onDidChangeCursorPosition(updateKeys);
                        modifiedEditor.onDidChangeCursorPosition(updateKeys);
                        diffEditor.onDidUpdateDiff(updateKeys);

                        originalEditor.addAction({
                          id: "graphoria.conflict.useThisVersion.original",
                          label: "Use this version",
                          contextMenuGroupId: "navigation",
                          contextMenuOrder: 1.2,
                          run: async () => {
                            const pos = originalEditor.getPosition();
                            if (!pos) return;
                            const changeIdx = findChangeIndex(true, pos.lineNumber);
                            if (changeIdx < 0) return;
                            const blkIdx = findConflictBlockIndexFromChange(true, changeIdx);
                            if (blkIdx < 0) return;
                            const blocksNow = getBlocksNow();
                            const next = applyConflictBlock(resultDraftRef.current, blkIdx, blocksNow[blkIdx]?.oursText ?? "");
                            setResultDraft(next);
                            await applyContentOrStageIfResolved(next);
                            setDiffOurs(buildVariantFromWorking(next, "ours"));
                            setDiffTheirs(buildVariantFromWorking(next, "theirs"));
                          },
                        });

                        modifiedEditor.addAction({
                          id: "graphoria.conflict.useThisVersion.modified",
                          label: "Use this version",
                          contextMenuGroupId: "navigation",
                          contextMenuOrder: 1.2,
                          run: async () => {
                            const pos = modifiedEditor.getPosition();
                            if (!pos) return;
                            const changeIdx = findChangeIndex(false, pos.lineNumber);
                            if (changeIdx < 0) return;
                            const blkIdx = findConflictBlockIndexFromChange(false, changeIdx);
                            if (blkIdx < 0) return;
                            const blocksNow = getBlocksNow();
                            const next = applyConflictBlock(resultDraftRef.current, blkIdx, blocksNow[blkIdx]?.theirsText ?? "");
                            setResultDraft(next);
                            await applyContentOrStageIfResolved(next);
                            setDiffOurs(buildVariantFromWorking(next, "ours"));
                            setDiffTheirs(buildVariantFromWorking(next, "theirs"));
                          },
                        });

                        originalEditor.addAction({
                          id: "graphoria.conflict.useBoth.original",
                          label: "Use both (this goes first)",
                          contextMenuGroupId: "navigation",
                          contextMenuOrder: 1.21,
                          run: async () => {
                            const pos = originalEditor.getPosition();
                            if (!pos) return;
                            const changeIdx = findChangeIndex(true, pos.lineNumber);
                            if (changeIdx < 0) return;
                            const blkIdx = findConflictBlockIndexFromChange(true, changeIdx);
                            if (blkIdx < 0) return;
                            const blocksNow = getBlocksNow();
                            const ours = blocksNow[blkIdx]?.oursText ?? "";
                            const theirs = blocksNow[blkIdx]?.theirsText ?? "";
                            const combined = ours && theirs ? `${ours}\n${theirs}` : `${ours}${theirs}`;
                            const next = applyConflictBlock(resultDraftRef.current, blkIdx, combined);
                            setResultDraft(next);
                            await applyContentOrStageIfResolved(next);
                            setDiffOurs(buildVariantFromWorking(next, "ours"));
                            setDiffTheirs(buildVariantFromWorking(next, "theirs"));
                          },
                        });

                        modifiedEditor.addAction({
                          id: "graphoria.conflict.useBoth.modified",
                          label: "Use both (this goes first)",
                          contextMenuGroupId: "navigation",
                          contextMenuOrder: 1.21,
                          run: async () => {
                            const pos = modifiedEditor.getPosition();
                            if (!pos) return;
                            const changeIdx = findChangeIndex(false, pos.lineNumber);
                            if (changeIdx < 0) return;
                            const blkIdx = findConflictBlockIndexFromChange(false, changeIdx);
                            if (blkIdx < 0) return;
                            const blocksNow = getBlocksNow();
                            const ours = blocksNow[blkIdx]?.oursText ?? "";
                            const theirs = blocksNow[blkIdx]?.theirsText ?? "";
                            const combined = theirs && ours ? `${theirs}\n${ours}` : `${theirs}${ours}`;
                            const next = applyConflictBlock(resultDraftRef.current, blkIdx, combined);
                            setResultDraft(next);
                            await applyContentOrStageIfResolved(next);
                            setDiffOurs(buildVariantFromWorking(next, "ours"));
                            setDiffTheirs(buildVariantFromWorking(next, "theirs"));
                          },
                        });

                        tryRevealDiffLine();
                      }}
                      options={{
                        readOnly: true,
                        contextmenu: false,
                        renderSideBySide: true,
                        renderSideBySideInlineBreakpoint: 0,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        wordWrap: "on",
                        fontSize: 12,
                      }}
                    />
                  ) : (
                    <Editor
                      height="100%"
                      theme={monacoTheme}
                      language={lang}
                      value={resultDraft}
                      beforeMount={(monaco) => {
                        ensureConflictThemes(monaco);
                      }}
                      onChange={(v: string | undefined) => {
                        setResultDraft(v ?? "");
                      }}
                      options={{
                        readOnly: false,
                        contextmenu: false,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        wordWrap: "on",
                        fontSize: 12,
                      }}
                      onMount={(_, monaco) => {
                        ensureConflictThemes(monaco);
                      }}
                    />
                  )}
                </div>
              ) : (
                <div
                  style={{ height: "100%" }}
                  onContextMenu={(e) => {
                    const editor = resultEditorRef.current;

                    const target = editor?.getTargetAtClientPoint?.(e.clientX, e.clientY);
                    const clickLine = target?.position?.lineNumber ?? editor?.getPosition?.()?.lineNumber ?? 1;
                    try {
                      editor?.setPosition?.({ lineNumber: clickLine, column: 1 });
                    } catch {
                      // ignore
                    }

                    const pos = editor?.getPosition?.();
                    const model = editor?.getModel?.();
                    const canResolveAtCursor = !!(pos && model && findConflictBlock(model, pos.lineNumber));

                    const items: ConflictContextMenuItem[] = [
                      {
                        label: "Resolve conflict: take ours",
                        disabled: !canResolveAtCursor,
                        onClick: () => {
                          setCtxMenu(null);
                          if (!canResolveAtCursor) return;
                          try {
                            editor?.focus?.();
                            editor?.getAction?.("graphoria.resolveConflict.takeOurs")?.run?.();
                          } catch {
                            // ignore
                          }
                        },
                      },
                      {
                        label: "Resolve conflict: take theirs",
                        disabled: !canResolveAtCursor,
                        onClick: () => {
                          setCtxMenu(null);
                          if (!canResolveAtCursor) return;
                          try {
                            editor?.focus?.();
                            editor?.getAction?.("graphoria.resolveConflict.takeTheirs")?.run?.();
                          } catch {
                            // ignore
                          }
                        },
                      },
                      {
                        label: "Show in the Diff view",
                        onClick: () => {
                          setCtxMenu(null);
                          showInDiffView(mapPhysicalResultLineToLogical(clickLine));
                        },
                      },
                      makeCopyItem(editor),
                      makeCommandPaletteItem(editor),
                    ];
                    openEditorContextMenu(e, items);
                  }}
                >
                  <div style={{ height: "100%", display: "grid", gridTemplateRows: "auto 1fr", minHeight: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: "1px solid var(--border)", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 900, opacity: 0.8 }}>Text conflict</div>
                      <button
                        type="button"
                        onClick={() => void applyTextResult()}
                        disabled={disabled}
                        title={
                          listConflictBlocksFromText(resultDraft).length > 0
                            ? "Apply resolved changes and keep the remaining conflicts unresolved"
                            : "Stage the result and mark this conflict as resolved"
                        }
                      >
                        Apply result
                      </button>
                      </div>
                    </div>

                    <Editor
                      height="100%"
                      theme={monacoTheme}
                      language={lang}
                      value={resultDraft}
                      beforeMount={(monaco) => {
                        ensureConflictThemes(monaco);
                      }}
                      onChange={(v: string | undefined) => {
                        setResultDraft(v ?? "");
                      }}
                      onMount={(editor, monaco) => {
                        ensureConflictThemes(monaco);
                        resultEditorRef.current = editor;

                        const model = editor.getModel();
                        if (!model) return;

                        const key = editor.createContextKey<boolean>("graphoriaHasConflictAtCursor", false);
                        const updateKey = () => {
                          const pos = editor.getPosition();
                          if (!pos) {
                            key.set(false);
                            return;
                          }
                          const blk = findConflictBlock(model, pos.lineNumber);
                          key.set(!!blk);
                        };
                        updateKey();
                        editor.onDidChangeCursorPosition(updateKey);

                        editor.addAction({
                          id: "graphoria.resolveConflict.takeOurs",
                          label: "Resolve conflict: take ours",
                          contextMenuGroupId: "navigation",
                          contextMenuOrder: 1.5,
                          run: async () => {
                            const pos = editor.getPosition();
                            if (!pos) return;
                            const blk = findConflictBlock(model, pos.lineNumber);
                            if (!blk) return;

                            const oursLines: string[] = [];
                            for (let ln = blk.start + 1; ln <= blk.mid - 1; ln++) {
                              oursLines.push(model.getLineContent(ln));
                            }

                            const range = new monaco.Range(blk.start, 1, blk.end, model.getLineMaxColumn(blk.end));
                            model.applyEdits([{ range, text: oursLines.join("\n") }]);
                            const next = model.getValue();
                            setResultDraft(next);
                            await applyContentOrStageIfResolved(next);
                            setDiffOurs(buildVariantFromWorking(next, "ours"));
                            setDiffTheirs(buildVariantFromWorking(next, "theirs"));
                            return;
                          },
                        });

                        editor.addAction({
                          id: "graphoria.resolveConflict.takeTheirs",
                          label: "Resolve conflict: take theirs",
                          contextMenuGroupId: "navigation",
                          contextMenuOrder: 1.6,
                          run: async () => {
                            const pos = editor.getPosition();
                            if (!pos) return;
                            const blk = findConflictBlock(model, pos.lineNumber);
                            if (!blk) return;

                            const theirLines: string[] = [];
                            for (let ln = blk.mid + 1; ln <= blk.end - 1; ln++) {
                              theirLines.push(model.getLineContent(ln));
                            }

                            const range = new monaco.Range(blk.start, 1, blk.end, model.getLineMaxColumn(blk.end));
                            model.applyEdits([{ range, text: theirLines.join("\n") }]);
                            const next = model.getValue();
                            setResultDraft(next);
                            await applyContentOrStageIfResolved(next);
                            setDiffOurs(buildVariantFromWorking(next, "ours"));
                            setDiffTheirs(buildVariantFromWorking(next, "theirs"));
                            return;
                          },
                        });

                        tryRevealResultLine();
                      }}
                      options={{
                        readOnly: false,
                        contextmenu: false,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        wordWrap: "on",
                        fontSize: 12,
                        lineNumbers: (n: number) => {
                          return resultLineLabels[n - 1] ?? String(n);
                        },
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {ctxMenu ? (
          <div
            className="menuDropdown"
            ref={ctxMenuRef}
            style={{
              position: "fixed",
              left: ctxMenu.x,
              top: ctxMenu.y,
              zIndex: 500,
              minWidth: 260,
            }}
          >
            {ctxMenu.items.map((it, idx) => (
              <button
                key={`${it.label}-${idx}`}
                type="button"
                disabled={!!it.disabled}
                onClick={() => {
                  it.onClick();
                }}
                style={{ display: "flex", alignItems: "center", gap: 10 }}
              >
                <span style={{ flex: "1 1 auto" }}>{it.label}</span>
                {it.shortcut ? <span className="menuShortcut">{it.shortcut}</span> : null}
              </button>
            ))}
          </div>
        ) : null}

        <div className="modalFooter" style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "flex", gap: 8 }}>
            {operation === "rebase" ? (
              <button type="button" onClick={onSkipRebase} disabled={disabled}>
                Skip
              </button>
            ) : null}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={onContinue} disabled={continueDisabled}>
              Continue
            </button>
            <button type="button" onClick={onAbort} disabled={disabled}>
              Abort
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
