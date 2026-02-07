import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "./api/system";

type Props = {
  open: boolean;
  activeRepoPath: string;
  onClose: () => void;
};

type EntryEditModalProps = {
  title: string;
  initial: string;
  onCancel: () => void;
  onOk: (value: string) => void;
};

function EntryEditModal({ title, initial, onCancel, onOk }: EntryEditModalProps) {
  const [value, setValue] = useState(initial);

  useEffect(() => {
    setValue(initial);
  }, [initial]);

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" style={{ zIndex: 90 }}>
      <div className="modal" style={{ width: "min(560px, 96vw)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>{title}</div>
          <button type="button" onClick={onCancel}>
            Close
          </button>
        </div>
        <div className="modalBody" style={{ display: "grid", gap: 10 }}>
          <input className="modalInput" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        </div>
        <div className="modalFooter" style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" onClick={() => onOk(value)}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

function normalizeNewlines(s: string) {
  return (s ?? "").replace(/\r\n/g, "\n");
}

function splitLines(s: string) {
  return normalizeNewlines(s).split("\n");
}

function joinLines(lines: string[]) {
  return lines.join("\n");
}

export default function GitIgnoreModifierModal(props: Props) {
  const { open: isOpen, activeRepoPath, onClose } = props;

  const defaultPath = useMemo(() => {
    if (!activeRepoPath.trim()) return "";
    const sep = activeRepoPath.includes("\\") ? "\\" : "/";
    const base = activeRepoPath.replace(/[\\/]+$/, "");
    return `${base}${sep}.gitignore`;
  }, [activeRepoPath]);

  const [path, setPath] = useState("");
  const [lines, setLines] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");

  const [editTextMode, setEditTextMode] = useState(false);
  const [rawText, setRawText] = useState("");

  const [editModal, setEditModal] = useState<null | { title: string; initial: string; onOk: (v: string) => void }>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError("");
    setBusy(false);
    setDirty(false);
    setEditTextMode(false);
    setRawText("");
    setSelectedIndex(-1);
    setPath(defaultPath);
    setLines([]);

    if (!defaultPath.trim()) return;
    void (async () => {
      try {
        const t = await readTextFile(defaultPath);
        const normalized = normalizeNewlines(t);
        setLines(splitLines(normalized));
        setRawText(normalized);
      } catch (e) {
        const msg = typeof e === "string" ? e : JSON.stringify(e);
        if (msg.toLowerCase().includes("does not exist")) {
          setLines([]);
          setRawText("");
          return;
        }
        setError(msg);
      }
    })();
  }, [isOpen, defaultPath]);

  useEffect(() => {
    if (!editTextMode) return;
    setRawText(joinLines(lines));
  }, [editTextMode]);

  async function browseFile() {
    const selected = await open({ directory: false, multiple: false, title: "Select .gitignore file", defaultPath: activeRepoPath || undefined });
    if (!selected || Array.isArray(selected)) return;
    setPath(selected);
    await loadFromPath(selected);
  }

  async function loadFromPath(p: string) {
    const pp = (p ?? "").trim();
    if (!pp) {
      setError("Select a file.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const t = await readTextFile(pp);
      const normalized = normalizeNewlines(t);
      setLines(splitLines(normalized));
      setRawText(normalized);
      setSelectedIndex(-1);
      setDirty(false);
    } catch (e) {
      const msg = typeof e === "string" ? e : JSON.stringify(e);
      if (msg.toLowerCase().includes("does not exist")) {
        setLines([]);
        setRawText("");
        setSelectedIndex(-1);
        setDirty(false);
        return;
      }
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  function insertAt(idx: number, value: string) {
    const at = Math.max(0, Math.min(lines.length, idx));
    setLines((prev) => {
      const next = prev.slice();
      next.splice(at, 0, value);
      return next;
    });
    setSelectedIndex(at);
    setDirty(true);
  }

  function updateAt(idx: number, value: string) {
    if (idx < 0 || idx >= lines.length) return;
    setLines((prev) => {
      const next = prev.slice();
      next[idx] = value;
      return next;
    });
    setDirty(true);
  }

  function removeAt(idx: number) {
    if (idx < 0 || idx >= lines.length) return;
    setLines((prev) => {
      const next = prev.slice();
      next.splice(idx, 1);
      return next;
    });
    const nextLen = Math.max(0, lines.length - 1);
    setSelectedIndex(nextLen === 0 ? -1 : Math.min(idx, nextLen - 1));
    setDirty(true);
  }

  function move(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (idx < 0 || idx >= lines.length) return;
    if (j < 0 || j >= lines.length) return;
    setLines((prev) => {
      const next = prev.slice();
      const t = next[idx];
      next[idx] = next[j];
      next[j] = t;
      return next;
    });
    setSelectedIndex(j);
    setDirty(true);
  }

  function newEntry() {
    const insertIdx = selectedIndex >= 0 ? selectedIndex + 1 : lines.length;
    setEditModal({
      title: "New entry",
      initial: "",
      onOk: (v) => {
        setEditModal(null);
        insertAt(insertIdx, v);
      },
    });
  }

  function editEntry() {
    if (selectedIndex < 0 || selectedIndex >= lines.length) return;
    const initial = lines[selectedIndex] ?? "";
    setEditModal({
      title: "Edit entry",
      initial,
      onOk: (v) => {
        setEditModal(null);
        updateAt(selectedIndex, v);
      },
    });
  }

  function insertBlank() {
    const insertIdx = selectedIndex >= 0 ? selectedIndex + 1 : lines.length;
    insertAt(insertIdx, "");
  }

  function toggleEditText() {
    if (!editTextMode) {
      setRawText(joinLines(lines));
      setEditTextMode(true);
      return;
    }

    setLines(splitLines(rawText));
    setEditTextMode(false);
    setDirty(true);
  }

  async function save() {
    const p = path.trim();
    if (!p) {
      setError("Select a file.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const content = editTextMode ? normalizeNewlines(rawText) : joinLines(lines);
      await writeTextFile(p, content.endsWith("\n") ? content : content + "\n");
      setDirty(false);
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setBusy(false);
    }
  }

  if (!isOpen) return null;

  const canEditList = !editTextMode;
  const selectedValid = selectedIndex >= 0 && selectedIndex < lines.length;

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ width: "min(980px, 96vw)", height: "min(84vh, 820px)", maxHeight: "min(84vh, 820px)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>Gitignore modifier</div>
          <button type="button" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>

        <div className="modalBody" style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0, overflow: "hidden" }}>
          {error ? <div className="error">{error}</div> : null}

          <div style={{ display: "grid", gridTemplateColumns: "160px 1fr auto auto", gap: 10, alignItems: "center" }}>
            <div style={{ fontWeight: 900, opacity: 0.75 }}>File</div>
            <input className="modalInput" value={path} onChange={(e) => setPath(e.target.value)} disabled={busy} />
            <button type="button" onClick={() => void browseFile()} disabled={busy || !activeRepoPath.trim()}>
              Browse…
            </button>
            <button type="button" onClick={() => void loadFromPath(path)} disabled={busy || !path.trim()}>
              Load
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 180px", gap: 12, minHeight: 0, flex: "1 1 auto" }}>
            <div
              style={{
                border: "1px solid rgba(0,0,0,0.12)",
                borderRadius: 10,
                minHeight: 0,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div style={{ padding: "10px 12px", borderBottom: "1px solid rgba(0,0,0,0.08)", fontWeight: 900, opacity: 0.8 }}>
                Entries
              </div>

              {editTextMode ? (
                <textarea
                  className="modalInput"
                  value={rawText}
                  onChange={(e) => {
                    setRawText(e.target.value);
                    setDirty(true);
                  }}
                  disabled={busy}
                  style={{ flex: "1 1 auto", border: "none", borderRadius: 0, resize: "none", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace" }}
                />
              ) : (
                <div style={{ overflow: "auto", flex: "1 1 auto" }}>
                  {lines.length === 0 ? (
                    <div style={{ padding: 12, opacity: 0.7 }}>No entries.</div>
                  ) : (
                    lines.map((l, idx) => {
                      const isBlank = !l;
                      const selected = idx === selectedIndex;
                      return (
                        <div
                          key={idx}
                          onClick={() => setSelectedIndex(idx)}
                          onDoubleClick={() => editEntry()}
                          style={{
                            padding: isBlank ? "6px 10px" : "8px 10px",
                            cursor: "pointer",
                            background: selected ? "rgba(0, 120, 212, 0.12)" : "transparent",
                            borderBottom: "1px solid rgba(0,0,0,0.06)",
                            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace",
                            opacity: isBlank ? 0.55 : 0.95,
                            whiteSpace: "pre",
                          }}
                        >
                          {isBlank ? "(blank line)" : l}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            <div style={{ display: "grid", gap: 8, alignContent: "start" }}>
              <button type="button" onClick={() => newEntry()} disabled={busy || !canEditList}>
                New
              </button>
              <button type="button" onClick={() => editEntry()} disabled={busy || !canEditList || !selectedValid}>
                Edit
              </button>
              <button type="button" onClick={() => removeAt(selectedIndex)} disabled={busy || !canEditList || !selectedValid}>
                Remove
              </button>
              <button type="button" onClick={() => insertBlank()} disabled={busy || !canEditList}>
                Blank line
              </button>
              <div style={{ height: 6 }} />
              <button type="button" onClick={() => move(selectedIndex, -1)} disabled={busy || !canEditList || !selectedValid || selectedIndex <= 0}>
                Move up
              </button>
              <button
                type="button"
                onClick={() => move(selectedIndex, 1)}
                disabled={busy || !canEditList || !selectedValid || selectedIndex < 0 || selectedIndex >= lines.length - 1}
              >
                Move down
              </button>
              <div style={{ height: 6 }} />
              <button type="button" onClick={() => toggleEditText()} disabled={busy}>
                {editTextMode ? "Apply text" : "Edit text…"}
              </button>
              <div style={{ height: 6 }} />
              <button type="button" onClick={() => void save()} disabled={busy || !dirty}>
                Save
              </button>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", opacity: 0.8, fontSize: 12 }}>
            <div>{dirty ? "Unsaved changes" : ""}</div>
            <div>Double-click an entry to edit.</div>
          </div>
        </div>
      </div>

      {editModal ? (
        <EntryEditModal
          title={editModal.title}
          initial={editModal.initial}
          onCancel={() => setEditModal(null)}
          onOk={(v) => editModal.onOk(v)}
        />
      ) : null}
    </div>
  );
}
