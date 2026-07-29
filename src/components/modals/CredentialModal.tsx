import { useEffect, useState } from "react";

type CredentialScope = "repo" | "host" | "global";

type Props = {
  repoPath: string;
  host: string | null;
  initialScope?: CredentialScope;
  onClose: () => void;
  onSaved: () => void;
};

export function CredentialModal({ repoPath, host, initialScope, onClose, onSaved }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [scope, setScope] = useState<CredentialScope>(initialScope ?? "repo");
  const [applyToGit, setApplyToGit] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyRemove, setBusyRemove] = useState(false);
  const [error, setError] = useState("");
  const [hasCredential, setHasCredential] = useState(false);

  useEffect(() => {
    setError("");
    setUsername("");
    setPassword("");
    setScope(initialScope ?? "repo");
    setApplyToGit(true);
    setHasCredential(false);

    let cancelled = false;
    (async () => {
      try {
        const { gitHasCredential } = await import("../../api/git");
        const present = await gitHasCredential(repoPath);
        if (!cancelled) setHasCredential(present);
      } catch {
        if (!cancelled) setHasCredential(false);
      }
    })();
    return () => { cancelled = true; };
  }, [repoPath, initialScope]);

  const canSave = username.trim() && password.trim() && host;

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setError("");
    try {
      const { gitStoreCredential } = await import("../../api/git");
      await gitStoreCredential({
        repoPath,
        username: username.trim(),
        password: password.trim(),
        scope,
        applyToGit,
      });
      onSaved();
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusyRemove(true);
    setError("");
    try {
      const { gitRemoveCredential } = await import("../../api/git");
      await gitRemoveCredential({ repoPath, scope: "repo" });
      await gitRemoveCredential({ repoPath, scope: "host" });
      await gitRemoveCredential({ repoPath, scope: "global" });
      setHasCredential(false);
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setBusyRemove(false);
    }
  }

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ width: "min(520px, 96vw)", maxHeight: "min(80vh, 640px)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>Remote credentials</div>
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

            <div style={{ display: "grid", gap: 6 }}>
              <label style={{ fontWeight: 800, opacity: 0.8 }}>Username</label>
              <input
                className="modalInput"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. Redysz"
                disabled={busy}
              />
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label style={{ fontWeight: 800, opacity: 0.8 }}>Password / token</label>
              <input
                className="modalInput"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="App password or token"
                disabled={busy}
              />
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label style={{ fontWeight: 800, opacity: 0.8 }}>Remember for</label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.9 }}>
                <input
                  type="radio"
                  name="credentialScope"
                  value="repo"
                  checked={scope === "repo"}
                  onChange={() => setScope("repo")}
                  disabled={busy}
                />
                This repository only
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.9 }}>
                <input
                  type="radio"
                  name="credentialScope"
                  value="host"
                  checked={scope === "host"}
                  onChange={() => setScope("host")}
                  disabled={busy}
                />
                This host ({host ?? "unknown"})
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.9 }}>
                <input
                  type="radio"
                  name="credentialScope"
                  value="global"
                  checked={scope === "global"}
                  onChange={() => setScope("global")}
                  disabled={busy}
                />
                All repositories (global)
              </label>
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.9 }}>
              <input
                type="checkbox"
                checked={applyToGit}
                onChange={(e) => setApplyToGit(e.target.checked)}
                disabled={busy}
              />
              Also use this token for command-line git
            </label>

            <div style={{ opacity: 0.7, fontSize: 12 }}>
              Credentials are stored in plain text by git&apos;s <code>credential-store</code> helper. Use
              repository scope whenever possible. If the checkbox is unchecked, Graphoria will use the token
              only inside this app.
            </div>
          </div>
        </div>
        <div className="modalFooter">
          {hasCredential ? (
            <button type="button" onClick={() => void remove()} disabled={busyRemove || busy} style={{ color: "#ff6b6b" }}>
              {busyRemove ? "Removing…" : "Remove saved"}
            </button>
          ) : (
            <span />
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={onClose} disabled={busy || busyRemove}>
              Cancel
            </button>
            <button type="button" onClick={() => void save()} disabled={!canSave || busy || busyRemove}>
              {busy ? "Saving…" : "Save credentials"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
