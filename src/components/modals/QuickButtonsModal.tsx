import { useEffect, useMemo, useState } from "react";
import { defaultQuickButtons, type QuickButtonId } from "../../appSettingsStore";

type Props = {
  open: boolean;
  value: QuickButtonId[];
  onClose: () => void;
  onSave: (next: QuickButtonId[]) => void;
};

const maxQuickButtons = 10;

const meta: Array<{ id: QuickButtonId; label: string; note?: string }> = [
  { id: "open", label: "Open" },
  { id: "refresh", label: "Refresh" },
  { id: "fetch", label: "Fetch" },
  { id: "pull", label: "Pull", note: "Includes dropdown" },
  { id: "commit", label: "Commit" },
  { id: "push", label: "Push" },
  { id: "terminal", label: "Terminal", note: "Includes dropdown" },
  { id: "stash", label: "Stash" },
  { id: "create_tag", label: "Create tag" },
  { id: "reset", label: "Reset" },
  { id: "cherry_pick", label: "Cherry-pick" },
  { id: "export_patch", label: "Export patch" },
  { id: "apply_patch", label: "Apply patch" },
  { id: "diff_tool", label: "Diff tool" },
  { id: "commit_search", label: "Commit search" },
];

function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr];
  const [item] = next.splice(from, 1);
  if (typeof item === "undefined") return next;
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item);
  return next;
}

function removeItem<T>(arr: T[], item: T): T[] {
  return arr.filter((x) => x !== item);
}

export function QuickButtonsModal({ open, value, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<QuickButtonId[]>(value);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState<{ id: QuickButtonId; from: "available" | "quick"; pointerId: number } | null>(null);
  const [hover, setHover] = useState<{
    list: "available" | "quick";
    overId: QuickButtonId | null;
    position: "before" | "after";
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(value);
    setError("");
  }, [open, value]);

  const draftSet = useMemo(() => new Set(draft), [draft]);

  const available = useMemo(() => {
    return meta.filter((m) => !draftSet.has(m.id));
  }, [draftSet]);

  if (!open) return null;

  const clearDrag = () => {
    setDrag(null);
    setHover(null);
  };

  const onPointerCancelItem = (e: React.PointerEvent) => {
    if (!drag) return;
    if (e.pointerId !== drag.pointerId) return;
    clearDrag();
  };

  const canAdd = (id: QuickButtonId) => {
    if (draft.includes(id)) return false;
    return draft.length < maxQuickButtons;
  };

  const addToQuick = (id: QuickButtonId, index?: number) => {
    setError("");
    setDraft((prev) => {
      if (prev.includes(id)) return prev;
      if (prev.length >= maxQuickButtons) {
        setError(`Maximum ${maxQuickButtons} quick buttons.`);
        return prev;
      }
      const next = [...prev];
      const at = typeof index === "number" ? Math.max(0, Math.min(next.length, index)) : next.length;
      next.splice(at, 0, id);
      return next;
    });
  };

  const removeFromQuick = (id: QuickButtonId) => {
    setError("");
    setDraft((prev) => removeItem(prev, id));
  };

  const onPointerDownItem = (e: React.PointerEvent, payload: { id: QuickButtonId; from: "available" | "quick" }) => {
    if (e.button !== 0) return;
    const t = e.target instanceof HTMLElement ? e.target : null;
    if (t?.closest("button")) return;
    const el = e.currentTarget as HTMLElement;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    setError("");
    setDrag({ id: payload.id, from: payload.from, pointerId: e.pointerId });
    setHover({ list: payload.from, overId: payload.id, position: "before" });
    e.preventDefault();
  };

  const onPointerMoveItem = (e: React.PointerEvent) => {
    if (!drag) return;
    if (e.pointerId !== drag.pointerId) return;
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    if (!el) {
      setHover(null);
      return;
    }

    const listEl = el.closest("[data-qb-list]") as HTMLElement | null;
    if (!listEl) {
      setHover(null);
      return;
    }
    const list = (listEl.getAttribute("data-qb-list") as "available" | "quick" | null) ?? null;
    if (list !== "available" && list !== "quick") {
      setHover(null);
      return;
    }

    if (list === "quick") {
      const items = Array.from(listEl.querySelectorAll("[data-qb-item-id]")) as HTMLElement[];
      for (const it of items) {
        const idRaw = (it.getAttribute("data-qb-item-id") ?? "") as unknown;
        const okId = meta.some((m) => m.id === idRaw);
        if (!okId) continue;
        const r = it.getBoundingClientRect();
        const mid = r.top + r.height / 2;
        if (e.clientY < mid) {
          setHover({ list: "quick", overId: idRaw as QuickButtonId, position: "before" });
          e.preventDefault();
          return;
        }
      }

      setHover({ list: "quick", overId: null, position: "after" });
      e.preventDefault();
      return;
    }

    const itemEl = el.closest("[data-qb-item-id]") as HTMLElement | null;
    const overRaw = itemEl?.getAttribute("data-qb-item-id") ?? "";
    const overId = meta.some((m) => m.id === (overRaw as any)) ? (overRaw as QuickButtonId) : null;
    setHover({ list: "available", overId, position: "after" });
    e.preventDefault();
  };

  const onPointerUpItem = (e: React.PointerEvent) => {
    if (!drag) return;
    if (e.pointerId !== drag.pointerId) return;

    const h = hover;
    clearDrag();
    if (!h) return;

    if (h.list === "available") {
      if (drag.from === "quick") {
        removeFromQuick(drag.id);
      }
      return;
    }

    const baseIndex = h.overId ? draft.indexOf(h.overId) : draft.length;
    const toIndex = h.overId ? baseIndex + (h.position === "after" ? 1 : 0) : baseIndex;
    if (drag.from === "available") {
      addToQuick(drag.id, toIndex >= 0 ? toIndex : undefined);
      return;
    }

    if (drag.from === "quick") {
      setDraft((prev) => {
        const fromIdx = prev.indexOf(drag.id);
        if (fromIdx < 0) return prev;
        const baseTo = h.overId ? prev.indexOf(h.overId) : prev.length;
        let toIdx = h.overId ? baseTo + (h.position === "after" ? 1 : 0) : baseTo;
        if (toIdx < 0) return prev;
        if (fromIdx < toIdx) toIdx -= 1;
        if (fromIdx === toIdx) return prev;
        return moveItem(prev, fromIdx, toIdx);
      });
    }
  };

  const renderItem = (m: { id: QuickButtonId; label: string; note?: string }, opts: { inQuick: boolean; index?: number }) => {
    const inQuick = opts.inQuick;
    const enabledAdd = canAdd(m.id);
    const isDragging = drag?.id === m.id;
    const isHoverTarget = hover?.list === (inQuick ? "quick" : "available") && hover?.overId === m.id;
    const insertionShadow =
      isHoverTarget && hover?.list === "quick"
        ? hover.position === "before"
          ? "0 2px 0 0 rgba(80, 160, 255, 0.95) inset"
          : "0 -2px 0 0 rgba(80, 160, 255, 0.95) inset"
        : undefined;

    return (
      <div
        key={`${inQuick ? "q" : "a"}-${m.id}`}
        data-qb-item-id={m.id}
        data-qb-item-list={inQuick ? "quick" : "available"}
        onPointerDown={(e) => onPointerDownItem(e, { id: m.id, from: inQuick ? "quick" : "available" })}
        onPointerMove={onPointerMoveItem}
        onPointerUp={onPointerUpItem}
        onPointerCancel={onPointerCancelItem}
        onLostPointerCapture={() => {
          if (drag) clearDrag();
        }}
        style={{
          border: "1px solid var(--border)",
          boxShadow: insertionShadow,
          borderRadius: 10,
          padding: "8px 10px",
          background: "var(--panel)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          cursor: drag ? (isDragging ? "grabbing" : "grab") : "grab",
          opacity: isDragging ? 0.5 : 1,
          userSelect: "none",
        }}
        title={m.note ?? "Drag to move"}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.label}</div>
          {m.note ? <div style={{ opacity: 0.7, fontSize: 12 }}>{m.note}</div> : null}
        </div>
        {inQuick ? (
          <button type="button" onClick={() => removeFromQuick(m.id)} title="Remove from quick buttons">
            Remove
          </button>
        ) : (
          <button type="button" onClick={() => addToQuick(m.id)} disabled={!enabledAdd} title={!enabledAdd ? "Toolbar limit reached" : "Add to quick buttons"}>
            Add
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" style={{ zIndex: 80 }}>
      <div className="modal" style={{ width: "min(980px, 96vw)", maxHeight: "min(86vh, 860px)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>Rearrange quick buttons</div>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="modalBody" style={{ display: "grid", gap: 12 }}>
          {error ? <div className="error">{error}</div> : null}

          <div style={{ opacity: 0.75, fontSize: 12 }}>
            Drag and drop between lists, or use Add/Remove. Maximum {maxQuickButtons} buttons.
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "start" }}>
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontWeight: 900 }}>Quick buttons</div>
                <div style={{ opacity: 0.7, fontSize: 12 }}>
                  {draft.length}/{maxQuickButtons}
                </div>
              </div>

              <div
                data-qb-list="quick"
                style={{
                  display: "grid",
                  gap: 8,
                  padding: 10,
                  border: "1px dashed var(--border)",
                  borderRadius: 12,
                  background: "var(--panel-2)",
                  boxShadow:
                    hover?.list === "quick" && hover.overId === null
                      ? "0 -2px 0 0 rgba(80, 160, 255, 0.95) inset"
                      : undefined,
                }}
              >
                {draft.length === 0 ? <div style={{ opacity: 0.7, fontSize: 12 }}>Drop items here</div> : null}
                {draft.map((id, idx) => {
                  const m = meta.find((x) => x.id === id);
                  if (!m) return null;
                  return renderItem(m, { inQuick: true, index: idx });
                })}
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <button
                  type="button"
                  onClick={() => {
                    setError("");
                    setDraft([...defaultQuickButtons]);
                  }}
                >
                  Reset to default
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setError("");
                    setDraft([]);
                  }}
                >
                  Clear
                </button>
              </div>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ fontWeight: 900 }}>Available</div>
              <div
                data-qb-list="available"
                style={{ display: "grid", gap: 8, padding: 10, border: "1px dashed var(--border)", borderRadius: 12, background: "var(--panel-2)" }}
              >
                {available.length === 0 ? <div style={{ opacity: 0.7, fontSize: 12 }}>No more items</div> : null}
                {available.map((m) => renderItem(m, { inQuick: false }))}
              </div>
            </div>
          </div>
        </div>

        <div className="modalFooter" style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <button
            type="button"
            onClick={() => {
              setDraft(value);
              setError("");
              onClose();
            }}
            data-modal-cancel="true"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onSave(draft);
              onClose();
            }}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
