import { useEffect, useMemo, useState } from "react";
import type { DiffToolSettings } from "./appSettingsStore";
import { gitLaunchExternalDiffWorking, gitWorkingFileContent, gitWorkingFileDiff } from "./api/gitWorkingFiles";
import { gitCommitChanges, gitCommitFileContent, gitCommitFileDiff, gitLaunchExternalDiffCommit, gitStatus } from "./api/git";

type GitChangeEntry = {
  status: string;
  path: string;
  old_path?: string | null;
};

type SourceMode =
  | { kind: "commit"; commit: string }
  | { kind: "working" };

type Props = {
  repoPath: string;
  source: SourceMode;
  tool: DiffToolSettings;
  height?: string | number;
};

export type DiffLineKind = "meta" | "hunk" | "add" | "del" | "ctx" | "moved_add" | "moved_del";

export type ParsedDiffLine = {
  kind: DiffLineKind;
  text: string;
};

function normalizeMovedKey(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

export function parseUnifiedDiff(raw: string): ParsedDiffLine[] {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const parsed: ParsedDiffLine[] = [];

  const adds: Array<{ idx: number; key: string }> = [];
  const dels: Array<{ idx: number; key: string }> = [];

  for (const line of lines) {
    if (line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ")) {
      parsed.push({ kind: "meta", text: line });
      continue;
    }
    if (line.startsWith("@@")) {
      parsed.push({ kind: "hunk", text: line });
      continue;
    }
    if (line.startsWith("+")) {
      const idx = parsed.length;
      parsed.push({ kind: "add", text: line });
      adds.push({ idx, key: normalizeMovedKey(line.slice(1)) });
      continue;
    }
    if (line.startsWith("-")) {
      const idx = parsed.length;
      parsed.push({ kind: "del", text: line });
      dels.push({ idx, key: normalizeMovedKey(line.slice(1)) });
      continue;
    }
    parsed.push({ kind: "ctx", text: line });
  }

  const addMap = new Map<string, number[]>();
  for (const a of adds) {
    if (!a.key) continue;
    const arr = addMap.get(a.key) ?? [];
    arr.push(a.idx);
    addMap.set(a.key, arr);
  }

  for (const d of dels) {
    if (!d.key) continue;
    const arr = addMap.get(d.key);
    if (!arr || arr.length === 0) continue;
    const addIdx = arr.shift();
    if (typeof addIdx !== "number") continue;
    parsed[d.idx] = { ...parsed[d.idx], kind: "moved_del" };
    parsed[addIdx] = { ...parsed[addIdx], kind: "moved_add" };
  }

  return parsed;
}

export function statusLabel(status: string) {
  const t = status.trim();
  if (t.startsWith("R")) return "Renamed";
  if (t.startsWith("C")) return "Copied";
  if (t.startsWith("A")) return "Added";
  if (t.startsWith("D")) return "Deleted";
  if (t.startsWith("M")) return "Modified";
  if (t.startsWith("T")) return "Type change";
  return t || "?";
}

export default function DiffView(props: Props) {
  const { repoPath, source, tool, height } = props;

  const [files, setFiles] = useState<GitChangeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [selectedPath, setSelectedPath] = useState<string>("");
  const selected = useMemo(() => files.find((f) => f.path === selectedPath) ?? null, [files, selectedPath]);

  const [diffText, setDiffText] = useState<string>("");
  const [contentText, setContentText] = useState<string>("");
  const [rightLoading, setRightLoading] = useState(false);
  const [rightError, setRightError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    setFiles([]);
    setSelectedPath("");
    setDiffText("");
    setContentText("");

    const run = async () => {
      try {
        if (source.kind === "commit") {
          const res = await gitCommitChanges({ repoPath, commit: source.commit });
          if (!alive) return;
          setFiles(res);
          if (res.length > 0) setSelectedPath(res[0].path);
        } else {
          const res = await gitStatus(repoPath);
          if (!alive) return;
          const mapped: GitChangeEntry[] = res.map((r) => ({ status: r.status, path: r.path }));
          setFiles(mapped);
          if (mapped.length > 0) setSelectedPath(mapped[0].path);
        }
      } catch (e) {
        if (!alive) return;
        setError(typeof e === "string" ? e : JSON.stringify(e));
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    };

    void run();
    return () => {
      alive = false;
    };
  }, [repoPath, source.kind, source.kind === "commit" ? source.commit : ""]);

  useEffect(() => {
    if (!selected || !selectedPath) {
      setDiffText("");
      setContentText("");
      return;
    }

    let alive = true;
    setRightLoading(true);
    setRightError("");
    setDiffText("");
    setContentText("");

    const run = async () => {
      try {
        const useExternal = tool.difftool !== "Graphoria builtin diff";

        if (useExternal) {
          if (source.kind === "commit") {
            await gitLaunchExternalDiffCommit({
              repoPath,
              commit: source.commit,
              path: selected.path,
              oldPath: selected.old_path ?? null,
              toolPath: tool.path,
              command: tool.command,
            });
          } else {
            await gitLaunchExternalDiffWorking({ repoPath, path: selected.path, toolPath: tool.path, command: tool.command });
          }
          if (!alive) return;
          setContentText("Opened in external diff tool.");
          return;
        }

        if (source.kind === "commit") {
          const st = selected.status.trim();
          if (st.startsWith("A") || st.startsWith("C")) {
            const content = await gitCommitFileContent({ repoPath, commit: source.commit, path: selected.path });
            if (!alive) return;
            setContentText(content);
            return;
          }

          const diff = await gitCommitFileDiff({ repoPath, commit: source.commit, path: selected.path });
          if (!alive) return;
          setDiffText(diff);
          return;
        }

        const st = selected.status.trim();
        if (st.startsWith("??")) {
          const content = await gitWorkingFileContent({ repoPath, path: selected.path });
          if (!alive) return;
          setContentText(content);
          return;
        }

        const diff = await gitWorkingFileDiff({ repoPath, path: selected.path });
        if (!alive) return;
        setDiffText(diff);
      } catch (e) {
        if (!alive) return;
        setRightError(typeof e === "string" ? e : JSON.stringify(e));
      } finally {
        if (!alive) return;
        setRightLoading(false);
      }
    };

    void run();

    return () => {
      alive = false;
    };
  }, [repoPath, selectedPath, source.kind, source.kind === "commit" ? source.commit : "", tool.command, tool.difftool, tool.path]);

  const parsed = useMemo(() => (diffText ? parseUnifiedDiff(diffText) : []), [diffText]);

  return (
    <div className="diffLayout" style={height ? { height } : undefined}>
      <div className="diffLeft">
        <div className="diffLeftHeader">
          <div style={{ fontWeight: 900, opacity: 0.8 }}>Files</div>
        </div>

        {loading ? <div className="diffEmpty">Loading…</div> : null}
        {error ? <div className="diffEmpty diffError">{error}</div> : null}

        {!loading && !error ? (
          files.length === 0 ? (
            <div className="diffEmpty">No changes.</div>
          ) : (
            <div className="diffFileList">
              {files.map((f) => (
                <button
                  key={f.path}
                  type="button"
                  className={f.path === selectedPath ? "diffFile diffFileActive" : "diffFile"}
                  onClick={() => setSelectedPath(f.path)}
                >
                  <span className="diffStatus">{statusLabel(f.status)}</span>
                  <span className="diffPath">{f.path}</span>
                </button>
              ))}
            </div>
          )
        ) : null}
      </div>

      <div className="diffRight">
        <div className="diffRightHeader">
          <div style={{ fontWeight: 900, opacity: 0.8 }}>{selected ? selected.path : ""}</div>
          {tool.difftool === "Graphoria builtin diff" ? (
            <div style={{ opacity: 0.75, fontSize: 12, marginTop: 4 }}>
              Green: added, red: removed. Yellow/blue: detected moved lines (same content removed and added in a different place).
            </div>
          ) : null}
        </div>

        {rightLoading ? <div className="diffEmpty">Loading…</div> : null}
        {rightError ? <div className="diffEmpty diffError">{rightError}</div> : null}

        {!rightLoading && !rightError ? (
          diffText ? (
            <pre className="diffCode">
              {parsed.map((l, i) => (
                <div key={i} className={`diffLine diffLine-${l.kind}`}>
                  {l.text}
                </div>
              ))}
            </pre>
          ) : contentText ? (
            <pre className="diffCode">
              {contentText.replace(/\r\n/g, "\n")}
            </pre>
          ) : (
            <div className="diffEmpty">Select a file.</div>
          )
        ) : null}
      </div>
    </div>
  );
}
