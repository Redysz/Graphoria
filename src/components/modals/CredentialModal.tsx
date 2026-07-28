import { useEffect, useState } from "react";

type CredentialScope = "repo" | "host" | "global";

type Props = {
  repoPath: string;
  host: string | null;
  onClose: () => void;
  onSaved: () => void;
};

export function CredentialModal({ repoPath, host, onClose, onSaved }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [scope, setScope] = useState<CredentialScope>("repo");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
  }, [repoPath]);

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
      });
      onSaved();
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

            <div style={{ opacity: 0.7, fontSize: 12 }}>
              Credentials are stored in plain text by git&apos;s <code>credential-store</code> helper. Use
              repository scope whenever possible.
            </div>
          </div>
        </div>
        <div className="modalFooter">
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" onClick={() => void save()} disabled={!canSave || busy}>
            {busy ? "Saving…" : "Save credentials"}
          </button>
        </div>
      </div>
    </div>
  );
}
