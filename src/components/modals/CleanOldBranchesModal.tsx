import type { Dispatch, SetStateAction } from "react";

type CandidateRow = {
  name: string;
  committer_date: string;
  daysOld: number | null;
};

type Props = {
  days: number;
  setDays: (v: number) => void;

  loading: boolean;
  deleting: boolean;
  error: string;

  candidates: CandidateRow[];
  selected: Record<string, boolean>;
  setSelected: Dispatch<SetStateAction<Record<string, boolean>>>;
  selectedCount: number;

  onClose: () => void;
  onDelete: () => void;
};

export function CleanOldBranchesModal({
  days,
  setDays,
  loading,
  deleting,
  error,
  candidates,
  selected,
  setSelected,
  selectedCount,
  onClose,
  onDelete,
}: Props) {
  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ width: "min(980px, 96vw)", maxHeight: "min(84vh, 900px)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>Clean old branches</div>
          <button type="button" onClick={onClose} disabled={deleting}>
            Close
          </button>
        </div>
        <div className="modalBody" style={{ display: "grid", gap: 12, minHeight: 0 }}>
          {error ? <div className="error">{error}</div> : null}

          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 10, alignItems: "center" }}>
              <div style={{ fontWeight: 900, opacity: 0.75 }}>Stale if last commit older than</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  className="modalInput"
                  type="number"
                  min={0}
                  step={1}
                  value={String(days)}
                  disabled={loading || deleting}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    setDays(Number.isFinite(n) ? Math.max(0, n) : 0);
                  }}
                  style={{ width: 140 }}
                />
                <div style={{ fontWeight: 800, opacity: 0.75 }}>days</div>
                {loading ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, opacity: 0.7 }}>
                    <span className="miniSpinner" />
                    <span>Scanning…</span>
                  </div>
                ) : null}
              </div>
            </div>

            <div style={{ opacity: 0.8, fontWeight: 800 }}>This tool only deletes local branches. It does NOT delete anything on remotes.</div>
          </div>

          <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--panel)", minHeight: 0 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "42px 1fr 200px 90px",
                gap: 10,
                alignItems: "center",
                padding: "10px 12px",
                borderBottom: "1px solid rgba(15, 15, 15, 0.08)",
                background: "var(--panel)",
                fontWeight: 900,
                opacity: 0.8,
              }}
            >
              <input
                type="checkbox"
                checked={candidates.length > 0 && selectedCount === candidates.length}
                ref={(el) => {
                  if (!el) return;
                  el.indeterminate = selectedCount > 0 && selectedCount < candidates.length;
                }}
                onChange={(e) => {
                  const v = e.target.checked;
                  setSelected(() => {
                    const next: Record<string, boolean> = {};
                    for (const r of candidates) next[r.name] = v;
                    return next;
                  });
                }}
                disabled={loading || deleting || candidates.length === 0}
                title="Select all"
              />
              <div>Branch</div>
              <div>Last commit</div>
              <div style={{ textAlign: "right" }}>Age</div>
            </div>

            <div style={{ overflow: "auto", maxHeight: "min(52vh, 520px)" }}>
              {candidates.length === 0 ? (
                <div style={{ padding: 12, opacity: 0.75 }}>{loading ? "Scanning…" : "No branches match the current criteria."}</div>
              ) : (
                candidates.map((r) => (
                  <div
                    key={r.name}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "42px 1fr 200px 90px",
                      gap: 10,
                      alignItems: "center",
                      padding: "10px 12px",
                      borderBottom: "1px solid rgba(15, 15, 15, 0.06)",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={!!selected[r.name]}
                      onChange={(e) => setSelected((prev) => ({ ...prev, [r.name]: e.target.checked }))}
                      disabled={loading || deleting}
                    />
                    <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12 }}>{r.name}</div>
                    <div
                      style={{
                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                        fontSize: 12,
                        opacity: 0.85,
                      }}
                    >
                      {r.committer_date}
                    </div>
                    <div
                      style={{
                        textAlign: "right",
                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                        fontSize: 12,
                        opacity: 0.85,
                      }}
                    >
                      {typeof r.daysOld === "number" ? `${r.daysOld}d` : ""}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="modalFooter" style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <button type="button" onClick={onClose} disabled={deleting}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={loading || deleting || selectedCount === 0}
            title={selectedCount === 0 ? "No branches selected" : undefined}
          >
            {deleting ? "Deleting…" : `Delete (${selectedCount})`}
          </button>
        </div>
      </div>
    </div>
  );
}
