import { useEffect, useState } from "react";

type Scope = "repo" | "host" | "global";

const scopeLabels: Record<Scope, string> = {
  repo: "This repository",
  host: "This host",
  global: "All repositories (global)",
};

const allScopes: Scope[] = ["repo", "host", "global"];

export function CredentialsManagerModal({
  repoPath,
  host,
  onClose,
  onEdit,
}: {
  repoPath: string;
  host: string | null;
  onClose: () => void;
  onEdit: (scope: Scope) => void;
}) {
  const [activeScope, setActiveScope] = useState<Scope>("repo");
  const [scopes, setScopes] = useState<Set<Scope>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      const { gitListCredentialScopes } = await import("../../api/git");
      const list = await gitListCredentialScopes(repoPath);
      setScopes(new Set(list as Scope[]));
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
    }
  }

  useEffect(() => {
    void load();
  }, [repoPath]);

  async function remove(scope: Scope) {
    setBusy(true);
    setError("");
    try {
      const { gitRemoveCredential } = await import("../../api/git");
      await gitRemoveCredential({ repoPath, scope });
      await load();
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ width: "min(520px, 96vw)", maxHeight: "min(80vh, 640px)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>Manage credentials</div>
          <button type="button" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>
        <div className="modalBody">
          {error ? <div className="error">{error}</div> : null}

          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ opacity: 0.8, fontSize: 13 }}>
              {host ? (
                <>
                  Host: <strong>{host}</strong>
                </>
              ) : (
                "Could not detect remote host."
              )}
            </div>

            <div style={{ display: "flex", gap: 4, borderBottom: "1px solid rgba(128,128,128,0.3)" }}>
              {allScopes.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setActiveScope(s)}
                  disabled={busy}
                  style={{
                    padding: "8px 12px",
                    background: activeScope === s ? "rgba(128,128,128,0.25)" : "transparent",
                    border: "none",
                    borderBottom: activeScope === s ? "2px solid var(--accent)" : "2px solid transparent",
                    cursor: "pointer",
                    fontWeight: activeScope === s ? 800 : 400,
                    opacity: 0.9,
                  }}
                >
                  {scopeLabels[s]}
                </button>
              ))}
            </div>

            <div>
              <strong>{scopeLabels[activeScope]}</strong>
              <div style={{ marginTop: 8, opacity: 0.8 }}>
                {scopes.has(activeScope) ? (
                  <span style={{ color: "#51cf66" }}>Saved</span>
                ) : (
                  "No credentials stored for this scope."
                )}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                {scopes.has(activeScope) ? (
                  <button
                    type="button"
                    onClick={() => void remove(activeScope)}
                    disabled={busy}
                    style={{ color: "#ff6b6b" }}
                  >
                    {busy ? "Removing…" : "Remove"}
                  </button>
                ) : null}
                <button type="button" onClick={() => onEdit(activeScope)} disabled={busy}>
                  {scopes.has(activeScope) ? "Update" : "Add"}
                </button>
              </div>
            </div>
          </div>
        </div>
        <div className="modalFooter">
          <button type="button" onClick={onClose} disabled={busy}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
