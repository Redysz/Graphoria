import { useEffect, useState } from "react";
import { gitCommitEditInfo, gitEditCommit } from "../../api/git";
import type { CommitEditInfo, CommitEditResult } from "../../types/git";

type Props = {
  repoPath: string;
  hash: string;
  onClose: () => void;
  onDone: (result: CommitEditResult, info: CommitEditInfo) => void | Promise<void>;
};

const WARNING_STYLE = {
  fontSize: 12,
  padding: "8px 12px",
  background: "rgba(244, 67, 54, 0.1)",
  border: "1px solid rgba(244, 67, 54, 0.3)",
  borderRadius: 8,
  color: "rgba(244, 67, 54, 0.9)",
  fontWeight: 600,
} as const;

const NOTE_STYLE = {
  fontSize: 12,
  padding: "8px 12px",
  background: "rgba(255, 152, 0, 0.1)",
  border: "1px solid rgba(255, 152, 0, 0.35)",
  borderRadius: 8,
  fontWeight: 600,
} as const;

const errText = (e: unknown) => (typeof e === "string" ? e : JSON.stringify(e));

export function EditCommitModal({ repoPath, hash, onClose, onDone }: Props) {
  const [info, setInfo] = useState<CommitEditInfo | null>(null);
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [authorEmail, setAuthorEmail] = useState("");
  const [resetDate, setResetDate] = useState(false);
  const [confirmPushed, setConfirmPushed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setInfo(null);
    setLoadError("");
    gitCommitEditInfo({ repoPath, hash })
      .then((i) => {
        if (cancelled) return;
        setInfo(i);
        setMessage(i.message);
        setAuthorName(i.author_name);
        setAuthorEmail(i.author_email);
      })
      .catch((e) => !cancelled && setLoadError(errText(e)));
    return () => {
      cancelled = true;
    };
  }, [repoPath, hash]);

  const pushed = (info?.pushed_to.length ?? 0) > 0;
  const changed =
    !!info &&
    (message.trim() !== info.message.trim() ||
      authorName.trim() !== info.author_name ||
      authorEmail.trim() !== info.author_email ||
      resetDate);
  const valid = message.trim() !== "" && authorName.trim() !== "" && authorEmail.trim() !== "";
  const canSave = !!info && info.reachable_from_head && changed && valid && !busy && (!pushed || confirmPushed);

  async function save() {
    if (!info || !canSave) return;
    setBusy(true);
    setError("");
    try {
      const res = await gitEditCommit({
        repoPath,
        hash: info.hash,
        message,
        authorName: authorName.trim(),
        authorEmail: authorEmail.trim(),
        resetAuthorDate: resetDate,
      });
      await onDone(res, info);
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ width: "min(720px, 96vw)", maxHeight: "min(90vh, 760px)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>Edit commit{info ? ` ${info.short_hash}` : ""}</div>
          <button type="button" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>
        <div className="modalBody">
          {loadError ? <div className="error">{loadError}</div> : null}
          {error ? <div className="error">{error}</div> : null}
          {!info && !loadError ? (
            <div style={{ opacity: 0.7 }}>
              <span className="miniSpinner" style={{ marginRight: 8 }} />
              Loading…
            </div>
          ) : null}
          {info ? (
            <div style={{ display: "grid", gap: 12 }}>
              {!info.reachable_from_head ? (
                <div style={WARNING_STYLE}>
                  This commit is not part of the currently checked out history. Check out the branch that contains it
                  first.
                </div>
              ) : null}

              {pushed ? (
                <div style={WARNING_STYLE}>
                  This commit has already been pushed ({info.pushed_to.slice(0, 4).join(", ")}
                  {info.pushed_to.length > 4 ? `, +${info.pushed_to.length - 4} more` : ""}). Editing it rewrites
                  published history: you will have to force-push, and anyone who already pulled it will have to
                  reconcile their copies.
                  <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                    <input
                      type="checkbox"
                      checked={confirmPushed}
                      onChange={(e) => setConfirmPushed(e.target.checked)}
                      disabled={busy}
                    />
                    I understand and want to rewrite pushed history
                  </label>
                </div>
              ) : null}

              {info.rewritten_descendants > 0 ? (
                <div style={NOTE_STYLE}>
                  {info.rewritten_descendants} newer commit{info.rewritten_descendants > 1 ? "s" : ""} on{" "}
                  {info.current_branch ?? "the current HEAD"} will get new hashes (their contents stay the same).
                </div>
              ) : null}

              {info.other_local_branches.length > 0 ? (
                <div style={NOTE_STYLE}>
                  Other local branches also contain this commit and will keep the old version:{" "}
                  {info.other_local_branches.slice(0, 6).join(", ")}
                  {info.other_local_branches.length > 6 ? ", …" : ""}
                </div>
              ) : null}

              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontWeight: 800, opacity: 0.8 }}>Message</div>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={10}
                  className="modalTextarea"
                  disabled={busy}
                  autoFocus
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 800, opacity: 0.8 }}>Author name</div>
                  <input
                    value={authorName}
                    onChange={(e) => setAuthorName(e.target.value)}
                    className="modalInput"
                    disabled={busy}
                  />
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 800, opacity: 0.8 }}>Author email</div>
                  <input
                    value={authorEmail}
                    onChange={(e) => setAuthorEmail(e.target.value)}
                    className="modalInput"
                    disabled={busy}
                  />
                </div>
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.9 }}>
                <input type="checkbox" checked={resetDate} onChange={(e) => setResetDate(e.target.checked)} disabled={busy} />
                Set author date to now (currently {info.author_date.replace("T", " ").slice(0, 19)})
              </label>
            </div>
          ) : null}
        </div>
        <div className="modalFooter" style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" onClick={() => void save()} disabled={!canSave}>
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
