import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { gitHeadFileContent, gitWorkingFileContent } from "./api/gitWorkingFiles";
import { readTextFile } from "./api/system";

type DiffToolMode = "repo_head" | "file_file";

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

function myersDiff(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;

  const v = new Map<number, number>();
  v.set(1, 0);
  const trace: Array<Map<number, number>> = [];

  for (let d = 0; d <= max; d++) {
    const vSnapshot = new Map<number, number>();
    for (const [k, x] of v.entries()) vSnapshot.set(k, x);
    trace.push(vSnapshot);

    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d) {
        x = v.get(k + 1) ?? 0;
      } else if (k === d) {
        x = (v.get(k - 1) ?? 0) + 1;
      } else {
        const xDown = v.get(k + 1) ?? 0;
        const xRight = (v.get(k - 1) ?? 0) + 1;
        x = xDown > xRight ? xDown : xRight;
      }

      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }

      v.set(k, x);

      if (x >= n && y >= m) {
        const ops: DiffOp[] = [];
        let curX = n;
        let curY = m;

        for (let curD = trace.length - 1; curD > 0; curD--) {
          const vPrev = trace[curD - 1];
          const k2 = curX - curY;

          let prevK: number;
          if (k2 === -curD || (k2 !== curD && (vPrev.get(k2 - 1) ?? 0) < (vPrev.get(k2 + 1) ?? 0))) {
            prevK = k2 + 1;
          } else {
            prevK = k2 - 1;
          }

          const prevX = vPrev.get(prevK) ?? 0;
          const prevY = prevX - prevK;

          while (curX > prevX && curY > prevY) {
            ops.push({ kind: "equal", text: a[curX - 1] ?? "" });
            curX--;
            curY--;
          }

          if (curX === prevX) {
            if (curY > 0) {
              ops.push({ kind: "insert", text: b[curY - 1] ?? "" });
              curY--;
            }
          } else {
            if (curX > 0) {
              ops.push({ kind: "delete", text: a[curX - 1] ?? "" });
              curX--;
            }
          }
        }

        while (curX > 0 && curY > 0) {
          ops.push({ kind: "equal", text: a[curX - 1] ?? "" });
          curX--;
          curY--;
        }
        while (curX > 0) {
          ops.push({ kind: "delete", text: a[curX - 1] ?? "" });
          curX--;
        }
        while (curY > 0) {
          ops.push({ kind: "insert", text: b[curY - 1] ?? "" });
          curY--;
        }

        ops.reverse();
        return ops;
      }
    }
  }

  return [];
}

function buildSplitRows(left: string, right: string): DiffRow[] {
  const a = splitLines(left);
  const b = splitLines(right);
  const ops = myersDiff(a, b);

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

  const [mode, setMode] = useState<DiffToolMode>("file_file");
  const [repoPath, setRepoPath] = useState<string>("");
  const [repoRelPath, setRepoRelPath] = useState<string>("");

  const [leftPath, setLeftPath] = useState<string>("");
  const [rightPath, setRightPath] = useState<string>("");

  const [syncScroll, setSyncScroll] = useState(true);

  const [leftLabel, setLeftLabel] = useState<string>("");
  const [rightLabel, setRightLabel] = useState<string>("");

  const [leftContent, setLeftContent] = useState<string>("");
  const [rightContent, setRightContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  const leftRef = useRef<HTMLDivElement | null>(null);
  const rightRef = useRef<HTMLDivElement | null>(null);
  const syncingRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return;

    setError("");
    setLoading(false);
    setLeftContent("");
    setRightContent("");

    const hasRepo = !!activeRepoPath.trim();
    setMode(hasRepo ? "repo_head" : "file_file");
    setRepoPath(activeRepoPath);
    setRepoRelPath("");

    setLeftPath("");
    setRightPath("");

    setLeftLabel("");
    setRightLabel("");
  }, [isOpen, activeRepoPath]);

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

  const rows = useMemo(() => buildSplitRows(leftContent, rightContent), [leftContent, rightContent]);
  const miniMarks = useMemo(() => buildMiniMarks(rows), [rows]);
  const emptyHint = useMemo(() => {
    if (loading) return "Comparing…";
    if (error) return "";
    if (!leftContent && !rightContent) return "Select inputs and click Compare.";
    if (rows.length === 0) return "No content.";
    return "";
  }, [error, leftContent, loading, rightContent, rows.length]);

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
    setLeftContent("");
    setRightContent("");

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

        setLeftLabel(`HEAD:${rel}`);
        setRightLabel(rel);

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

        setLeftContent(head);
        setRightContent(working);
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

      setLeftLabel(l);
      setRightLabel(r);

      const [left, right] = await Promise.all([
        readTextFile(l),
        readTextFile(r),
      ]);

      setLeftContent(left);
      setRightContent(right);
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setLoading(false);
    }
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
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.85 }}>
              <input type="checkbox" checked={syncScroll} onChange={(e) => setSyncScroll(e.target.checked)} />
              Sync scroll
            </label>

            <button
              type="button"
              onClick={() => void runCompare()}
              disabled={loading || (mode === "repo_head" ? !repoPath.trim() || !repoRelPath.trim() : !leftPath.trim() || !rightPath.trim())}
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
          ) : (
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
          )}

          <div className="splitDiffLayout" style={{ flex: "1 1 auto", minHeight: 0 }}>
            <div className="splitDiffHeader">
              <div className="splitDiffHeaderCell" title={leftLabel}>
                {leftLabel}
              </div>
              <div className="splitDiffHeaderCell" title={rightLabel}>
                {rightLabel}
              </div>
            </div>
            <div className="splitDiffPanes">
              <div ref={leftRef} className="diffCode splitDiffPane splitDiffPaneLeft">
                {emptyHint ? (
                  <div style={{ opacity: 0.75 }}>{emptyHint}</div>
                ) : (
                  rows.map((r, i) => (
                    <div key={i} className="splitDiffRow">
                      <span className="splitDiffLineNo">{r.leftNo ?? ""}</span>
                      <span className={`diffLine diffLine-${r.leftKind}`}>{r.leftText ? r.leftText : "\u00A0"}</span>
                    </div>
                  ))
                )}
              </div>

              <div className="splitDiffRightWrap">
                <div ref={rightRef} className="diffCode splitDiffPane splitDiffPaneRight">
                  {emptyHint ? (
                    <div style={{ opacity: 0.75 }}>{emptyHint}</div>
                  ) : (
                    rows.map((r, i) => (
                      <div key={i} className="splitDiffRow">
                        <span className="splitDiffLineNo">{r.rightNo ?? ""}</span>
                        <span className={`diffLine diffLine-${r.rightKind}`}>{r.rightText ? r.rightText : "\u00A0"}</span>
                      </div>
                    ))
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
