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
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyRemove, setBusyRemove] = useState(false);
  const [busyDefault, setBusyDefault] = useState(false);
  const [error, setError] = useState("");
  const [hasCredential, setHasCredential] = useState(false);

  useEffect(() => {
    setError("");
    setUsername("");
    setPassword("");
    setScope(initialScope ?? "repo");
    setApplyToGit(true);
    setRemember(true);
    setHasCredential(false);

    let cancelled = false;
    (async () => {
      try {
        const { gitHasCredential, gitGetSuggestedUsername } = await import("../../api/git");
        const [present, suggested] = await Promise.all([
          gitHasCredential(repoPath).catch(() => false),
          gitGetSuggestedUsername(repoPath).catch(() => ""),
        ]);
        if (cancelled) return;
        setHasCredential(present);
        if (suggested) setUsername(suggested);
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
        scope: remember ? scope : "session",
        applyToGit: remember ? applyToGit : false,
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

  async function openDefault() {
    setBusyDefault(true);
    setError("");
    try {
      const { gitOpenDefaultLogin } = await import("../../api/git");
      await gitOpenDefaultLogin({ repoPath, username: username.trim() || undefined });
      onSaved();
    } catch (e) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setBusyDefault(false);
    }
  }

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ width: "min(520px, 96vw)", maxHeight: "min(94vh, 820px)" }}>
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>Remote credentials</div>
          <button type="button" onClick={onClose} disabled={busy || busyDefault}>
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

            {host && host.includes("bitbucket.org") ? (
              <div style={{ opacity: 0.75, fontSize: 12, lineHeight: 1.4 }}>
                <strong>Bitbucket:</strong> the username depends on the token type.
                <br />
                &bull; <strong>App password</strong> &rarr; username is your Bitbucket username (e.g.{" "}
                <code>Redysz</code>).
                <br />
                &bull; <strong>API token</strong> (scopes like <code>write:repository:bitbucket</code>) &rarr;
                username must be your <strong>Atlassian account e-mail</strong>.
                <br />
                Using an API token with your Bitbucket username causes{" "}
                <code>Authentication failed</code>.
              </div>
            ) : null}

            <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.9 }}>
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                disabled={busy}
              />
              Remember this token
            </label>

            <div
              style={{
                display: "grid",
                gap: 6,
                marginLeft: 26,
                opacity: remember ? 1 : 0.45,
                pointerEvents: remember ? "auto" : "none",
              }}
            >
              <label style={{ fontWeight: 800, opacity: 0.8 }}>Remember for</label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.9 }}>
                <input
                  type="radio"
                  name="credentialScope"
                  value="repo"
                  checked={scope === "repo"}
                  onChange={() => setScope("repo")}
                  disabled={busy || !remember}
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
                  disabled={busy || !remember}
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
                  disabled={busy || !remember}
                />
                All repositories (global)
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, opacity: 0.9, marginTop: 4 }}>
                <input
                  type="checkbox"
                  checked={applyToGit}
                  onChange={(e) => setApplyToGit(e.target.checked)}
                  disabled={busy || !remember}
                />
                Also use this token for command-line git
              </label>
            </div>

            <div style={{ opacity: 0.7, fontSize: 12 }}>
              Credentials are stored in plain text by git&apos;s <code>credential-store</code> helper. Use
              repository scope whenever possible. When &quot;Remember this token&quot; is unchecked, Graphoria
              uses the token only for the current app session and forgets it on restart.
            </div>

            <div
              style={{
                borderTop: "1px solid var(--border, #2a2a2a)",
                marginTop: 4,
                paddingTop: 12,
                display: "grid",
                gap: 6,
              }}
            >
              <button
                type="button"
                onClick={() => void openDefault()}
                disabled={busy || busyRemove || busyDefault || !host}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  fontWeight: 900,
                  color: "#ff4d4f",
                  border: "1px solid #ff4d4f",
                  background: "transparent",
                  borderRadius: 8,
                  cursor: busyDefault ? "default" : "pointer",
                }}
              >
                {busyDefault ? "Opening…" : `Show default ${host ?? "host"} login window`}
              </button>
              <div style={{ opacity: 0.75, fontSize: 11, color: "#ff4d4f" }}>
                Fallback only. Use this if Graphoria cannot handle the sign-in &mdash; it opens the host&apos;s
                own login window instead.
              </div>
            </div>
          </div>
        </div>
        <div className="modalFooter">
          {hasCredential ? (
            <button type="button" onClick={() => void remove()} disabled={busyRemove || busy || busyDefault} style={{ color: "#ff6b6b" }}>
              {busyRemove ? "Removing…" : "Remove saved"}
            </button>
          ) : (
            <span />
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={onClose} disabled={busy || busyRemove || busyDefault}>
              Cancel
            </button>
            <button type="button" onClick={() => void save()} disabled={!canSave || busy || busyRemove || busyDefault}>
              {busy ? "Saving…" : remember ? "Save credentials" : "Use once"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
