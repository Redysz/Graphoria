import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { gitHeadFileContent, gitWorkingFileContent } from "./api/gitWorkingFiles";
import { readTextFile } from "./api/system";
import { useAppSettings } from "./appSettingsStore";

type DiffToolMode = "repo_head" | "file_file" | "clipboard";

type DiffSideSource = "clipboard" | "file" | "repo_head" | "repo_working";

type DiffRow = {
  leftText: string;
  rightText: string;
  leftKind: "ctx" | "add" | "del";
  rightKind: "ctx" | "add" | "del";
  leftNo: number | null;
  rightNo: number | null;
};

type MiniMark = {
  topPct: number;
  heightPct: number;
  kind: "add" | "del" | "mod";
};

type DiffOp = { kind: "equal" | "insert" | "delete"; text: string };

type DiffResult = {
  leftLabel: string;
  rightLabel: string;
  leftContent: string;
  rightContent: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  repos: string[];
  activeRepoPath: string;
};

function normalizePath(p: string) {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

function relPathFromRepo(repoPath: string, filePath: string) {
  const repo = normalizePath(repoPath);
  const file = normalizePath(filePath);
  if (file === repo) return "";
  if (file.startsWith(repo + "/")) return file.slice(repo.length + 1);

  const repoLower = repo.toLowerCase();
  const fileLower = file.toLowerCase();
  if (!fileLower.startsWith(repoLower + "/")) return "";
  return file.slice(repo.length + 1);
}

function splitLines(s: string) {
  return s.replace(/\r\n/g, "\n").split("\n");
}

function levenshteinDiffOps(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  const w = m + 1;

  const cost = new Uint16Array((n + 1) * (m + 1));
  const dir = new Uint8Array((n + 1) * (m + 1));

  for (let i = 1; i <= n; i++) {
    cost[i * w] = i;
    dir[i * w] = 2;
  }
  for (let j = 1; j <= m; j++) {
    cost[j] = j;
    dir[j] = 3;
  }

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const idx = i * w + j;
      const ai = a[i - 1] ?? "";
      const bj = b[j - 1] ?? "";

      if (ai === bj) {
        cost[idx] = cost[(i - 1) * w + (j - 1)] ?? 0;
        dir[idx] = 1;
        continue;
      }

      const del = (cost[(i - 1) * w + j] ?? 0) + 1;
      const ins = (cost[i * w + (j - 1)] ?? 0) + 1;
      const sub = (cost[(i - 1) * w + (j - 1)] ?? 0) + 1;

      let best = sub;
      let bestDir: 1 | 2 | 3 = 1;
      if (del < best) {
        best = del;
        bestDir = 2;
      }
      if (ins < best) {
        best = ins;
        bestDir = 3;
      }

      cost[idx] = best;
      dir[idx] = bestDir;
    }
  }

  const opsRev: DiffOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const d = dir[i * w + j] ?? 0;
    if (d === 1) {
      const ai = a[i - 1] ?? "";
      const bj = b[j - 1] ?? "";
      if (ai === bj) {
        opsRev.push({ kind: "equal", text: ai });
      } else {
        opsRev.push({ kind: "insert", text: bj });
        opsRev.push({ kind: "delete", text: ai });
      }
      i--;
      j--;
      continue;
    }
    if (d === 2) {
      opsRev.push({ kind: "delete", text: a[i - 1] ?? "" });
      i--;
      continue;
    }
    if (d === 3) {
      opsRev.push({ kind: "insert", text: b[j - 1] ?? "" });
      j--;
      continue;
    }

    if (i > 0) {
      opsRev.push({ kind: "delete", text: a[i - 1] ?? "" });
      i--;
      continue;
    }
    opsRev.push({ kind: "insert", text: b[j - 1] ?? "" });
    j--;
  }

  opsRev.reverse();
  return opsRev;
}

function diffOps(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  if (n * m <= 20000) {
    return levenshteinDiffOps(a, b);
  }
  return myersDiff(a, b);
}

function myersDiff(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;

  const v = new Map<number, number>();
  v.set(1, 0);
  const trace: Array<Map<number, number>> = [];

  let foundD: number | null = null;

  for (let d = 0; d <= max; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && (v.get(k - 1) ?? 0) < (v.get(k + 1) ?? 0))) {
        x = v.get(k + 1) ?? 0;
      } else {
        x = (v.get(k - 1) ?? 0) + 1;
      }

      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }

      v.set(k, x);

      if (x >= n && y >= m) {
        foundD = d;
        break;
      }
    }

    const vSnapshot = new Map<number, number>();
    for (const [k, x] of v.entries()) vSnapshot.set(k, x);
    trace.push(vSnapshot);

    if (foundD !== null) break;
  }

  if (foundD === null) return [];

  const ops: DiffOp[] = [];
  let x = n;
  let y = m;

  for (let d = foundD; d > 0; d--) {
    const vPrev = trace[d - 1];
    const k = x - y;

    let prevK: number;
    if (k === -d || (k !== d && (vPrev.get(k - 1) ?? 0) < (vPrev.get(k + 1) ?? 0))) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }

    const prevX = vPrev.get(prevK) ?? 0;
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      ops.push({ kind: "equal", text: a[x - 1] ?? "" });
      x--;
      y--;
    }

    if (x === prevX) {
      ops.push({ kind: "insert", text: b[y - 1] ?? "" });
      y--;
    } else {
      ops.push({ kind: "delete", text: a[x - 1] ?? "" });
      x--;
    }
  }

  while (x > 0 && y > 0) {
    ops.push({ kind: "equal", text: a[x - 1] ?? "" });
    x--;
    y--;
  }
  while (x > 0) {
    ops.push({ kind: "delete", text: a[x - 1] ?? "" });
    x--;
  }
  while (y > 0) {
    ops.push({ kind: "insert", text: b[y - 1] ?? "" });
    y--;
  }

  ops.reverse();
  return ops;
}

function buildSplitRows(left: string, right: string): DiffRow[] {
  const a = splitLines(left);
  const b = splitLines(right);
  const ops = diffOps(a, b);

  const rows: DiffRow[] = [];
  let aNo = 1;
  let bNo = 1;

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];

    if (op.kind === "equal") {
      rows.push({
        leftText: op.text,
        rightText: op.text,
        leftKind: "ctx",
        rightKind: "ctx",
        leftNo: aNo++,
        rightNo: bNo++,
      });
      continue;
    }

    const del: string[] = [];
    const ins: string[] = [];
    while (i < ops.length && ops[i].kind !== "equal") {
      const cur = ops[i];
      if (cur.kind === "delete") del.push(cur.text);
      else if (cur.kind === "insert") ins.push(cur.text);
      i++;
    }
    i--;

    const max = Math.max(del.length, ins.length);
    for (let j = 0; j < max; j++) {
      const dl = del[j];
      const il = ins[j];
      rows.push({
        leftText: typeof dl === "string" ? dl : "",
        rightText: typeof il === "string" ? il : "",
        leftKind: typeof dl === "string" ? "del" : "ctx",
        rightKind: typeof il === "string" ? "add" : "ctx",
        leftNo: typeof dl === "string" ? aNo++ : null,
        rightNo: typeof il === "string" ? bNo++ : null,
      });
    }
  }

  return rows;
}

function rowChangeKind(r: DiffRow): "add" | "del" | "mod" | null {
  const hasDel = r.leftKind === "del";
  const hasAdd = r.rightKind === "add";
  if (hasDel && hasAdd) return "mod";
  if (hasDel) return "del";
  if (hasAdd) return "add";
  return null;
}

function buildMiniMarks(rows: DiffRow[]): MiniMark[] {
  if (rows.length === 0) return [];

  const out: MiniMark[] = [];
  let i = 0;
  while (i < rows.length) {
    const k = rowChangeKind(rows[i]);
    if (!k) {
      i++;
      continue;
    }

    let start = i;
    let end = i;
    let hasAdd = k === "add";
    let hasDel = k === "del";
    let hasMod = k === "mod";
    i++;

    while (i < rows.length) {
      const kk = rowChangeKind(rows[i]);
      if (!kk) break;
      end = i;
      if (kk === "add") hasAdd = true;
      if (kk === "del") hasDel = true;
      if (kk === "mod") hasMod = true;
      i++;
    }

    const kind: MiniMark["kind"] = hasMod || (hasAdd && hasDel) ? "mod" : hasDel ? "del" : "add";
    out.push({
      topPct: start / rows.length,
      heightPct: (end - start + 1) / rows.length,
      kind,
    });
  }

  return out;
}

export default function DiffToolModal(props: Props) {
  const { open: isOpen, onClose, repos, activeRepoPath } = props;

  const diffShowLineNumbers = useAppSettings((s) => s.git.diffShowLineNumbers);

  const [mode, setMode] = useState<DiffToolMode>("file_file");
  const [repoPath, setRepoPath] = useState<string>("");
  const [repoRelPath, setRepoRelPath] = useState<string>("");

  const [leftSource, setLeftSource] = useState<DiffSideSource>("clipboard");
  const [rightSource, setRightSource] = useState<DiffSideSource>("clipboard");
  const [leftRepoRelPath, setLeftRepoRelPath] = useState<string>("");
  const [rightRepoRelPath, setRightRepoRelPath] = useState<string>("");
  const [leftClipboard, setLeftClipboard] = useState<string>("");
  const [rightClipboard, setRightClipboard] = useState<string>("");

  const [leftPath, setLeftPath] = useState<string>("");
  const [rightPath, setRightPath] = useState<string>("");

  const [syncScroll, setSyncScroll] = useState(true);

  const emptyResult: DiffResult = useMemo(
    () => ({ leftLabel: "", rightLabel: "", leftContent: "", rightContent: "" }),
    [],
  );
  const [resultByMode, setResultByMode] = useState<Record<DiffToolMode, DiffResult>>({
    repo_head: { leftLabel: "", rightLabel: "", leftContent: "", rightContent: "" },
    file_file: { leftLabel: "", rightLabel: "", leftContent: "", rightContent: "" },
    clipboard: { leftLabel: "", rightLabel: "", leftContent: "", rightContent: "" },
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  const leftRef = useRef<HTMLDivElement | null>(null);
  const rightRef = useRef<HTMLDivElement | null>(null);
  const syncingRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return;

    setError("");
    setLoading(false);
    setResultByMode({ repo_head: emptyResult, file_file: emptyResult, clipboard: emptyResult });

    const hasRepo = !!activeRepoPath.trim();
    setMode(hasRepo ? "repo_head" : "file_file");
    setRepoPath(activeRepoPath);
    setRepoRelPath("");

    setLeftSource("clipboard");
    setRightSource("clipboard");
    setLeftRepoRelPath("");
    setRightRepoRelPath("");
    setLeftClipboard("");
    setRightClipboard("");

    setLeftPath("");
    setRightPath("");
  }, [isOpen, activeRepoPath]);

  useEffect(() => {
    setResultByMode((prev) => ({
      ...prev,
      repo_head: emptyResult,
    }));
  }, [repoPath, repoRelPath]);

  useEffect(() => {
    setResultByMode((prev) => ({
      ...prev,
      file_file: emptyResult,
    }));
  }, [leftPath, rightPath]);

  useEffect(() => {
    setResultByMode((prev) => ({
      ...prev,
      clipboard: emptyResult,
    }));
  }, [
    leftSource,
    rightSource,
    leftRepoRelPath,
    rightRepoRelPath,
    leftClipboard,
    rightClipboard,
    leftPath,
    rightPath,
    repoPath,
  ]);

  async function pasteInto(side: "left" | "right") {
    try {
      const t = await navigator.clipboard.readText();
      if (side === "left") setLeftClipboard(t);
      else setRightClipboard(t);
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
    }
  }

  async function loadSideFromFile(side: "left" | "right", path: string) {
    const p = path.trim();
    if (!p) {
      setError(side === "left" ? "Select left file." : "Select right file.");
      return;
    }

    setError("");
    try {
      const t = await readTextFile(p);
      if (side === "left") setLeftClipboard(t);
      else setRightClipboard(t);
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
    }
  }

  async function loadSideFromRepo(side: "left" | "right", kind: "repo_head" | "repo_working") {
    const rp = repoPath.trim();
    const rel = (side === "left" ? leftRepoRelPath : rightRepoRelPath).trim();
    if (!rp) {
      setError("Select a repository.");
      return;
    }
    if (!rel) {
      setError(side === "left" ? "Select left repo file." : "Select right repo file.");
      return;
    }

    setError("");
    try {
      const t =
        kind === "repo_head"
          ? await gitHeadFileContent({ repoPath: rp, path: rel })
          : await gitWorkingFileContent({ repoPath: rp, path: rel });

      if (side === "left") setLeftClipboard(t);
      else setRightClipboard(t);
    } catch (e) {
      const msg = typeof e === "string" ? e : JSON.stringify(e);
      const binaryMsg = "Binary file preview is not supported.";
      setError(msg.includes(binaryMsg) ? binaryMsg : msg);
    }
  }

  async function pickRepoFolder() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select a Git repository",
    });

    if (!selected || Array.isArray(selected)) return;
    setError("");
    setRepoPath(selected);
  }

  function sync(from: HTMLElement, to: HTMLElement) {
    const maxFromTop = Math.max(0, from.scrollHeight - from.clientHeight);
    const maxToTop = Math.max(0, to.scrollHeight - to.clientHeight);
    const pctTop = maxFromTop > 0 ? from.scrollTop / maxFromTop : 0;
    to.scrollTop = pctTop * maxToTop;

    const maxFromLeft = Math.max(0, from.scrollWidth - from.clientWidth);
    const maxToLeft = Math.max(0, to.scrollWidth - to.clientWidth);
    const pctLeft = maxFromLeft > 0 ? from.scrollLeft / maxFromLeft : 0;
    to.scrollLeft = pctLeft * maxToLeft;
  }

  useEffect(() => {
    if (!isOpen) return;
    if (!syncScroll) return;

    const leftEl = leftRef.current;
    const rightEl = rightRef.current;
    if (!leftEl || !rightEl) return;

    const onLeft = () => {
      if (!syncScroll) return;
      if (syncingRef.current) return;
      syncingRef.current = true;
      try {
        sync(leftEl, rightEl);
      } finally {
        syncingRef.current = false;
      }
    };

    const onRight = () => {
      if (!syncScroll) return;
      if (syncingRef.current) return;
      syncingRef.current = true;
      try {
        sync(rightEl, leftEl);
      } finally {
        syncingRef.current = false;
      }
    };

    leftEl.addEventListener("scroll", onLeft, { passive: true });
    rightEl.addEventListener("scroll", onRight, { passive: true });

    return () => {
      leftEl.removeEventListener("scroll", onLeft);
      rightEl.removeEventListener("scroll", onRight);
    };
  }, [isOpen, syncScroll, leftRef.current, rightRef.current]);

  const activeResult = resultByMode[mode];
  const rows = useMemo(
    () => buildSplitRows(activeResult.leftContent, activeResult.rightContent),
    [activeResult.leftContent, activeResult.rightContent],
  );
  const miniMarks = useMemo(() => buildMiniMarks(rows), [rows]);
  const emptyHint = useMemo(() => {
    if (loading) return "Comparing…";
    if (error) return "";
    if (!activeResult.leftContent && !activeResult.rightContent) return "Select inputs and click Compare.";
    if (rows.length === 0) return "No content.";
    return "";
  }, [activeResult.leftContent, activeResult.rightContent, error, loading, rows.length]);

  function scrollRightToPct(pct: number) {
    const rightEl = rightRef.current;
    if (!rightEl) return;
    const maxTop = Math.max(0, rightEl.scrollHeight - rightEl.clientHeight);
    rightEl.scrollTop = pct * maxTop;
  }

  function onMiniBarClick(e: React.MouseEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const pct = rect.height > 0 ? Math.max(0, Math.min(1, y / rect.height)) : 0;
    scrollRightToPct(pct);
  }

  async function pickRepoFile() {
    if (!repoPath.trim()) {
      setError("Select a repository.");
      return;
    }

    const selected = await open({
      directory: false,
      multiple: false,
      title: "Select a file in repository",
      defaultPath: repoPath,
    });

    if (!selected || Array.isArray(selected)) return;

    const rel = relPathFromRepo(repoPath, selected);
    if (!rel) {
      setError("Selected file is not inside the selected repository.");
      return;
    }

    setError("");
    setRepoRelPath(rel);
  }

  async function pickRepoFileForSide(side: "left" | "right") {
    if (!repoPath.trim()) {
      setError("Select a repository.");
      return;
    }

    const selected = await open({
      directory: false,
      multiple: false,
      title: side === "left" ? "Select left repo file" : "Select right repo file",
      defaultPath: repoPath,
    });

    if (!selected || Array.isArray(selected)) return;

    const rel = relPathFromRepo(repoPath, selected);
    if (!rel) {
      setError("Selected file is not inside the selected repository.");
      return;
    }

    setError("");
    if (side === "left") setLeftRepoRelPath(rel);
    else setRightRepoRelPath(rel);
  }

  async function pickLeftFile() {
    const selected = await open({ directory: false, multiple: false, title: "Select left file" });
    if (!selected || Array.isArray(selected)) return;
    setError("");
    setLeftPath(selected);
  }

  async function pickRightFile() {
    const selected = await open({ directory: false, multiple: false, title: "Select right file" });
    if (!selected || Array.isArray(selected)) return;
    setError("");
    setRightPath(selected);
  }

  async function runCompare() {
    setError("");
    setLoading(true);

    try {
      if (mode === "repo_head") {
        const rp = repoPath.trim();
        const rel = repoRelPath.trim();
        if (!rp) {
          setError("Select a repository.");
          return;
        }
        if (!rel) {
          setError("Select a file.");
          return;
        }

        const leftLabel = `HEAD:${rel}`;
        const rightLabel = rel;

        const [headRes, workingRes] = await Promise.allSettled([
          gitHeadFileContent({ repoPath: rp, path: rel }),
          gitWorkingFileContent({ repoPath: rp, path: rel }),
        ]);

        const headErr = headRes.status === "rejected" ? (typeof headRes.reason === "string" ? headRes.reason : JSON.stringify(headRes.reason)) : "";
        const workingErr =
          workingRes.status === "rejected" ? (typeof workingRes.reason === "string" ? workingRes.reason : JSON.stringify(workingRes.reason)) : "";

        const binaryMsg = "Binary file preview is not supported.";
        if ((headErr && headErr.includes(binaryMsg)) || (workingErr && workingErr.includes(binaryMsg))) {
          setError(binaryMsg);
          return;
        }

        const head = headRes.status === "fulfilled" ? headRes.value : "";
        const working = workingRes.status === "fulfilled" ? workingRes.value : "";

        if (headRes.status === "rejected" && workingRes.status === "rejected") {
          const msg = typeof headRes.reason === "string" ? headRes.reason : JSON.stringify(headRes.reason);
          setError(msg);
          return;
        }

        setResultByMode((prev) => ({
          ...prev,
          repo_head: {
            leftLabel,
            rightLabel,
            leftContent: head,
            rightContent: working,
          },
        }));
        return;
      }

      if (mode === "clipboard") {
        const leftLabelForSource = () => {
          if (leftSource === "file") return leftPath.trim() || "(file)";
          if (leftSource === "repo_head") return `HEAD:${leftRepoRelPath.trim() || "(file)"}`;
          if (leftSource === "repo_working") return leftRepoRelPath.trim() || "(file)";
          return "Clipboard";
        };
        const rightLabelForSource = () => {
          if (rightSource === "file") return rightPath.trim() || "(file)";
          if (rightSource === "repo_head") return `HEAD:${rightRepoRelPath.trim() || "(file)"}`;
          if (rightSource === "repo_working") return rightRepoRelPath.trim() || "(file)";
          return "Clipboard";
        };

        setResultByMode((prev) => ({
          ...prev,
          clipboard: {
            leftLabel: leftLabelForSource(),
            rightLabel: rightLabelForSource(),
            leftContent: leftClipboard,
            rightContent: rightClipboard,
          },
        }));
        return;
      }

      const l = leftPath.trim();
      const r = rightPath.trim();
      if (!l) {
        setError("Select left file.");
        return;
      }
      if (!r) {
        setError("Select right file.");
        return;
      }

      const leftLabel = l;
      const rightLabel = r;

      const [left, right] = await Promise.all([
        readTextFile(l),
        readTextFile(r),
      ]);

      setResultByMode((prev) => ({
        ...prev,
        file_file: {
          leftLabel,
          rightLabel,
          leftContent: left,
          rightContent: right,
        },
      }));
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setLoading(false);
    }
  }

  function swapClipboardSides() {
    setLeftSource(rightSource);
    setRightSource(leftSource);

    setLeftPath(rightPath);
    setRightPath(leftPath);

    setLeftRepoRelPath(rightRepoRelPath);
    setRightRepoRelPath(leftRepoRelPath);

    setLeftClipboard(rightClipboard);
    setRightClipboard(leftClipboard);

    setResultByMode((prev) => ({
      ...prev,
      clipboard: {
        leftLabel: prev.clipboard.rightLabel,
        rightLabel: prev.clipboard.leftLabel,
        leftContent: prev.clipboard.rightContent,
        rightContent: prev.clipboard.leftContent,
      },
    }));
  }

  if (!isOpen) return null;

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ width: "min(1200px, 96vw)", height: "min(92vh, 980px)", maxHeight: "min(92vh, 980px)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>Diff Tool</div>
          <button type="button" onClick={onClose} disabled={loading}>
            Close
          </button>
        </div>

        <div className="modalBody" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 12, minHeight: 0, overflow: "hidden" }}>
          {error ? <div className="error">{error}</div> : null}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div className="segmented small" style={{ flex: "0 0 auto" }}>
              <button type="button" className={mode === "repo_head" ? "active" : ""} onClick={() => setMode("repo_head")}>
                File vs HEAD
              </button>
              <button type="button" className={mode === "file_file" ? "active" : ""} onClick={() => setMode("file_file")}>
                File vs file
              </button>
              <button type="button" className={mode === "clipboard" ? "active" : ""} onClick={() => setMode("clipboard")}>
                Clipboard
              </button>
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.85 }}>
              <input type="checkbox" checked={syncScroll} onChange={(e) => setSyncScroll(e.target.checked)} />
              Sync scroll
            </label>

            {mode === "clipboard" ? (
              <button type="button" onClick={() => swapClipboardSides()} disabled={loading}>
                Swap sides
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => void runCompare()}
              disabled={
                loading ||
                (mode === "repo_head"
                  ? !repoPath.trim() || !repoRelPath.trim()
                  : mode === "file_file"
                    ? !leftPath.trim() || !rightPath.trim()
                    : false)
              }
            >
              {loading ? "Comparing…" : "Compare"}
            </button>
          </div>

          {mode === "repo_head" ? (
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "220px 1fr auto", gap: 10, alignItems: "center" }}>
                <div style={{ fontWeight: 900, opacity: 0.75 }}>Repository</div>
                <select value={repoPath} onChange={(e) => setRepoPath(e.target.value)} disabled={loading}>
                  <option value="">(select)</option>
                  {repos.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => void pickRepoFolder()} disabled={loading}>
                  Browse…
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "220px 1fr auto", gap: 10, alignItems: "center" }}>
                <div style={{ fontWeight: 900, opacity: 0.75 }}>File (relative)</div>
                <input className="modalInput" value={repoRelPath} onChange={(e) => setRepoRelPath(e.target.value)} disabled={loading} />
                <button type="button" onClick={() => void pickRepoFile()} disabled={loading || !repoPath.trim()}>
                  Browse…
                </button>
              </div>
            </div>
          ) : mode === "file_file" ? (
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "220px 1fr auto", gap: 10, alignItems: "center" }}>
                <div style={{ fontWeight: 900, opacity: 0.75 }}>Left file</div>
                <input className="modalInput" value={leftPath} onChange={(e) => setLeftPath(e.target.value)} disabled={loading} />
                <button type="button" onClick={() => void pickLeftFile()} disabled={loading}>
                  Browse…
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "220px 1fr auto", gap: 10, alignItems: "center" }}>
                <div style={{ fontWeight: 900, opacity: 0.75 }}>Right file</div>
                <input className="modalInput" value={rightPath} onChange={(e) => setRightPath(e.target.value)} disabled={loading} />
                <button type="button" onClick={() => void pickRightFile()} disabled={loading}>
                  Browse…
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {(leftSource === "repo_head" || leftSource === "repo_working" || rightSource === "repo_head" || rightSource === "repo_working") ? (
                <div style={{ display: "grid", gridTemplateColumns: "220px 1fr auto", gap: 10, alignItems: "center" }}>
                  <div style={{ fontWeight: 900, opacity: 0.75 }}>Repository</div>
                  <select value={repoPath} onChange={(e) => setRepoPath(e.target.value)} disabled={loading}>
                    <option value="">(select)</option>
                    {repos.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <button type="button" onClick={() => void pickRepoFolder()} disabled={loading}>
                    Browse…
                  </button>
                </div>
              ) : null}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "220px 1fr auto auto", gap: 10, alignItems: "center" }}>
                    <div style={{ fontWeight: 900, opacity: 0.75 }}>Left</div>
                    <select value={leftSource} onChange={(e) => setLeftSource(e.target.value as DiffSideSource)} disabled={loading}>
                      <option value="clipboard">Clipboard</option>
                      <option value="file">File</option>
                      <option value="repo_head">HEAD file</option>
                      <option value="repo_working">Working file</option>
                    </select>
                    <button type="button" onClick={() => void pasteInto("left")} disabled={loading || leftSource !== "clipboard"}>
                      Paste
                    </button>
                    <button type="button" onClick={() => setLeftClipboard("")} disabled={loading || leftSource !== "clipboard"}>
                      Clear
                    </button>
                  </div>

                  {leftSource === "file" ? (
                    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr auto auto", gap: 10, alignItems: "center" }}>
                      <div style={{ fontWeight: 900, opacity: 0.75 }}>Left file</div>
                      <input className="modalInput" value={leftPath} onChange={(e) => setLeftPath(e.target.value)} disabled={loading} />
                      <button
                        type="button"
                        onClick={() =>
                          void (async () => {
                            const selected = await open({ directory: false, multiple: false, title: "Select left file" });
                            if (!selected || Array.isArray(selected)) return;
                            setError("");
                            setLeftPath(selected);
                            await loadSideFromFile("left", selected);
                          })()
                        }
                        disabled={loading}
                      >
                        Browse…
                      </button>
                      <button type="button" onClick={() => void loadSideFromFile("left", leftPath)} disabled={loading || !leftPath.trim()}>
                        Load
                      </button>
                    </div>
                  ) : null}

                  {leftSource === "repo_head" || leftSource === "repo_working" ? (
                    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr auto auto", gap: 10, alignItems: "center" }}>
                      <div style={{ fontWeight: 900, opacity: 0.75 }}>Left repo file</div>
                      <input
                        className="modalInput"
                        value={leftRepoRelPath}
                        onChange={(e) => setLeftRepoRelPath(e.target.value)}
                        disabled={loading}
                      />
                      <button type="button" onClick={() => void pickRepoFileForSide("left")} disabled={loading || !repoPath.trim()}>
                        Browse…
                      </button>
                      <button
                        type="button"
                        onClick={() => void loadSideFromRepo("left", leftSource)}
                        disabled={loading || !repoPath.trim() || !leftRepoRelPath.trim()}
                      >
                        Load
                      </button>
                    </div>
                  ) : null}

                  <textarea
                    className="modalInput"
                    value={leftClipboard}
                    onChange={(e) => setLeftClipboard(e.target.value)}
                    disabled={loading}
                    style={{
                      minHeight: 120,
                      resize: "vertical",
                      fontFamily:
                        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace",
                      whiteSpace: "pre",
                    }}
                    placeholder="Paste or type left content here…"
                  />
                </div>

                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "220px 1fr auto auto", gap: 10, alignItems: "center" }}>
                    <div style={{ fontWeight: 900, opacity: 0.75 }}>Right</div>
                    <select value={rightSource} onChange={(e) => setRightSource(e.target.value as DiffSideSource)} disabled={loading}>
                      <option value="clipboard">Clipboard</option>
                      <option value="file">File</option>
                      <option value="repo_head">HEAD file</option>
                      <option value="repo_working">Working file</option>
                    </select>
                    <button type="button" onClick={() => void pasteInto("right")} disabled={loading || rightSource !== "clipboard"}>
                      Paste
                    </button>
                    <button type="button" onClick={() => setRightClipboard("")} disabled={loading || rightSource !== "clipboard"}>
                      Clear
                    </button>
                  </div>

                  {rightSource === "file" ? (
                    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr auto auto", gap: 10, alignItems: "center" }}>
                      <div style={{ fontWeight: 900, opacity: 0.75 }}>Right file</div>
                      <input className="modalInput" value={rightPath} onChange={(e) => setRightPath(e.target.value)} disabled={loading} />
                      <button
                        type="button"
                        onClick={() =>
                          void (async () => {
                            const selected = await open({ directory: false, multiple: false, title: "Select right file" });
                            if (!selected || Array.isArray(selected)) return;
                            setError("");
                            setRightPath(selected);
                            await loadSideFromFile("right", selected);
                          })()
                        }
                        disabled={loading}
                      >
                        Browse…
                      </button>
                      <button type="button" onClick={() => void loadSideFromFile("right", rightPath)} disabled={loading || !rightPath.trim()}>
                        Load
                      </button>
                    </div>
                  ) : null}

                  {rightSource === "repo_head" || rightSource === "repo_working" ? (
                    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr auto auto", gap: 10, alignItems: "center" }}>
                      <div style={{ fontWeight: 900, opacity: 0.75 }}>Right repo file</div>
                      <input
                        className="modalInput"
                        value={rightRepoRelPath}
                        onChange={(e) => setRightRepoRelPath(e.target.value)}
                        disabled={loading}
                      />
                      <button type="button" onClick={() => void pickRepoFileForSide("right")} disabled={loading || !repoPath.trim()}>
                        Browse…
                      </button>
                      <button
                        type="button"
                        onClick={() => void loadSideFromRepo("right", rightSource)}
                        disabled={loading || !repoPath.trim() || !rightRepoRelPath.trim()}
                      >
                        Load
                      </button>
                    </div>
                  ) : null}

                  <textarea
                    className="modalInput"
                    value={rightClipboard}
                    onChange={(e) => setRightClipboard(e.target.value)}
                    disabled={loading}
                    style={{
                      minHeight: 120,
                      resize: "vertical",
                      fontFamily:
                        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace",
                      whiteSpace: "pre",
                    }}
                    placeholder="Paste or type right content here…"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="splitDiffLayout" style={{ flex: "1 1 auto", minHeight: 0 }}>
            <div className="splitDiffHeader">
              <div className="splitDiffHeaderCell" title={activeResult.leftLabel}>
                {activeResult.leftLabel}
              </div>
              <div className="splitDiffHeaderCell" title={activeResult.rightLabel}>
                {activeResult.rightLabel}
              </div>
            </div>
            <div className="splitDiffPanes">
              <div ref={leftRef} className="diffCode splitDiffPane splitDiffPaneLeft">
                {emptyHint ? (
                  <div style={{ opacity: 0.75 }}>{emptyHint}</div>
                ) : (
                  rows.map((r, i) =>
                    diffShowLineNumbers ? (
                      <div key={i} className="splitDiffRow">
                        <span className="splitDiffLineNo">{r.leftNo ?? ""}</span>
                        <span className={`diffLine diffLine-${r.leftKind}`}>{r.leftText ? r.leftText : "\u00A0"}</span>
                      </div>
                    ) : (
                      <div key={i} className={`diffLine diffLine-${r.leftKind}`}>
                        {r.leftText ? r.leftText : "\u00A0"}
                      </div>
                    ),
                  )
                )}
              </div>

              <div className="splitDiffRightWrap">
                <div ref={rightRef} className="diffCode splitDiffPane splitDiffPaneRight">
                  {emptyHint ? (
                    <div style={{ opacity: 0.75 }}>{emptyHint}</div>
                  ) : (
                    rows.map((r, i) =>
                      diffShowLineNumbers ? (
                        <div key={i} className="splitDiffRow">
                          <span className="splitDiffLineNo">{r.rightNo ?? ""}</span>
                          <span className={`diffLine diffLine-${r.rightKind}`}>{r.rightText ? r.rightText : "\u00A0"}</span>
                        </div>
                      ) : (
                        <div key={i} className={`diffLine diffLine-${r.rightKind}`}>
                          {r.rightText ? r.rightText : "\u00A0"}
                        </div>
                      ),
                    )
                  )}
                </div>

                <div className="splitDiffMiniBar" onClick={onMiniBarClick} title="Changes overview">
                  {miniMarks.map((m, idx) => (
                    <div
                      key={idx}
                      className={`splitDiffMiniMark splitDiffMiniMark-${m.kind}`}
                      style={{ top: `${m.topPct * 100}%`, height: `${m.heightPct * 100}%` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="modalFooter">
          <button type="button" onClick={onClose} disabled={loading}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
