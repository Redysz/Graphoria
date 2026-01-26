import type { Dispatch, ReactNode, RefObject, SetStateAction } from "react";
import type { TerminalSettings } from "../appSettingsStore";
import type { ShortcutActionId } from "../shortcuts";

export function TopToolbar(props: {
  repos: string[];
  activeRepoPath: string;
  loading: boolean;
  cloneBusy: boolean;
  remoteUrl: string | null | undefined;
  changedCount: number;
  aheadCount: number;
  behindCount: number;
  pullBusy: boolean;
  pullMenuOpen: boolean;
  setPullMenuOpen: Dispatch<SetStateAction<boolean>>;
  pullPredictBusy: boolean;
  startPull: (mode: "merge" | "rebase") => void | Promise<void>;
  predictPull: (rebase: boolean) => void | Promise<void>;
  pullAutoChoose: () => void | Promise<void>;
  openCommitDialog: () => void | Promise<void>;
  openPushDialog: () => void | Promise<void>;
  openRepoPicker: () => void | Promise<void>;
  refreshRepo: () => void | Promise<void>;
  runFetch: () => void | Promise<void>;
  showToolbarShortcutHints: boolean;
  toolbarItem: (left: ReactNode, shortcutText?: string) => ReactNode;
  shortcutLabel: (id: ShortcutActionId) => string;
  terminalMenuOpen: boolean;
  setTerminalMenuOpen: Dispatch<SetStateAction<boolean>>;
  terminalMenuRef: RefObject<HTMLDivElement | null>;
  terminalSettings: TerminalSettings;
  chooseTerminalProfile: (id: string) => void | Promise<void>;
  openTerminalDefault: () => void | Promise<void>;
  openTerminalSettings: () => void;
  indicatorsUpdating: boolean;
  error: string;
  pullError: string;
}) {
  const {
    repos,
    activeRepoPath,
    loading,
    cloneBusy,
    remoteUrl,
    changedCount,
    aheadCount,
    behindCount,
    pullBusy,
    pullMenuOpen,
    setPullMenuOpen,
    pullPredictBusy,
    startPull,
    predictPull,
    pullAutoChoose,
    openCommitDialog,
    openPushDialog,
    openRepoPicker,
    refreshRepo,
    runFetch,
    showToolbarShortcutHints,
    toolbarItem,
    shortcutLabel,
    terminalMenuOpen,
    setTerminalMenuOpen,
    terminalMenuRef,
    terminalSettings,
    chooseTerminalProfile,
    openTerminalDefault,
    openTerminalSettings,
    indicatorsUpdating,
    error,
    pullError,
  } = props;

  return (
    <div className="toolbar">
      {repos.length === 0 ? (
        <button
          type="button"
          onClick={() => {
            void openRepoPicker();
          }}
          disabled={loading || cloneBusy}
          title="Open repository"
        >
          {toolbarItem("Open", shortcutLabel("repo.open"))}
        </button>
      ) : null}
      <button type="button" onClick={() => void refreshRepo()} disabled={!activeRepoPath || loading}>
        {toolbarItem("Refresh", shortcutLabel("repo.refresh"))}
      </button>
      <button
        type="button"
        onClick={() => void runFetch()}
        disabled={!activeRepoPath || loading || !remoteUrl}
        title={!remoteUrl ? "No remote origin" : "git fetch origin"}
      >
        {toolbarItem("Fetch", shortcutLabel("repo.fetch"))}
      </button>
      <div style={{ position: "relative", display: "flex", alignItems: "stretch" }}>
        <button
          type="button"
          onClick={() => void startPull("merge")}
          disabled={!activeRepoPath || loading || pullBusy || !remoteUrl}
          title={!remoteUrl ? "No remote origin" : "git pull (merge)"}
          data-testid="pull-merge"
          style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span>Pull</span>
            {behindCount > 0 ? <span className="badge">↓{behindCount}</span> : null}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setPullMenuOpen((v) => !v)}
          disabled={!activeRepoPath || loading || pullBusy || !remoteUrl}
          title="More pull options"
          data-testid="pull-menu"
          style={{
            borderTopLeftRadius: 0,
            borderBottomLeftRadius: 0,
            borderLeft: "0",
            paddingLeft: 8,
            paddingRight: 8,
          }}
        >
          {toolbarItem("▾", shortcutLabel("cmd.pullMenu"))}
        </button>

        {pullMenuOpen ? (
          <div className="menuDropdown" style={{ left: 0, top: "calc(100% + 6px)", minWidth: 260 }}>
            <button
              type="button"
              onClick={() => {
                setPullMenuOpen(false);
                void startPull("merge");
              }}
              disabled={!activeRepoPath || loading || pullBusy || !remoteUrl}
              title="git pull --merge"
              data-testid="pull-option-merge"
            >
              Pull --merge
            </button>
            <button
              type="button"
              onClick={() => {
                setPullMenuOpen(false);
                void startPull("rebase");
              }}
              disabled={!activeRepoPath || loading || pullBusy || !remoteUrl}
              title="git pull --rebase"
              data-testid="pull-option-rebase"
            >
              Pull --rebase
            </button>
            <button
              type="button"
              onClick={() => {
                setPullMenuOpen(false);
                void predictPull(false);
              }}
              disabled={!activeRepoPath || loading || pullPredictBusy || !remoteUrl}
              title="Predict if git pull will create merge commit and whether there may be conflicts"
              data-testid="pull-option-merge-predict"
            >
              Pull --merge predict
            </button>
            <button
              type="button"
              onClick={() => {
                setPullMenuOpen(false);
                void predictPull(true);
              }}
              disabled={!activeRepoPath || loading || pullPredictBusy || !remoteUrl}
              title="Predict if git pull --rebase will have conflicts"
              data-testid="pull-option-rebase-predict"
            >
              Pull --rebase predict
            </button>
            <button
              type="button"
              onClick={() => {
                setPullMenuOpen(false);
                void pullAutoChoose();
              }}
              disabled={!activeRepoPath || loading || pullBusy || pullPredictBusy || !remoteUrl}
              title="Tries pull --rebase; if conflicts predicted, falls back to normal pull (merge)."
              data-testid="pull-option-autochoose"
            >
              Pull rebase/merge autochoose
            </button>
          </div>
        ) : null}
      </div>
      <button type="button" onClick={() => void openCommitDialog()} disabled={!activeRepoPath || loading}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>Commit…</span>
          {changedCount > 0 ? <span className="badge">{changedCount}</span> : null}
          {showToolbarShortcutHints && shortcutLabel("cmd.commit") ? <span className="menuShortcut">{shortcutLabel("cmd.commit")}</span> : null}
        </span>
      </button>
      <button
        type="button"
        onClick={() => void openPushDialog()}
        disabled={!activeRepoPath || loading || !remoteUrl}
        title={!remoteUrl ? "No remote origin" : undefined}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>Push…</span>
          {aheadCount > 0 ? <span className="badge">↑{aheadCount}</span> : null}
          {showToolbarShortcutHints && shortcutLabel("cmd.push") ? <span className="menuShortcut">{shortcutLabel("cmd.push")}</span> : null}
        </span>
      </button>
      <div style={{ position: "relative", display: "flex", alignItems: "stretch" }}>
        <button
          type="button"
          onClick={() => void openTerminalDefault()}
          disabled={!activeRepoPath}
          title="Open terminal in repository"
          style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
        >
          Terminal
        </button>
        <button
          type="button"
          onClick={() => setTerminalMenuOpen((v) => !v)}
          disabled={!activeRepoPath}
          title="Choose terminal profile"
          style={{
            borderTopLeftRadius: 0,
            borderBottomLeftRadius: 0,
            borderLeft: "0",
            paddingLeft: 8,
            paddingRight: 8,
          }}
        >
          {toolbarItem("▾", shortcutLabel("cmd.terminalMenu"))}
        </button>

        {terminalMenuOpen ? (
          <div ref={terminalMenuRef} className="menuDropdown" style={{ left: 0, top: "calc(100% + 6px)", minWidth: 260 }}>
            {(terminalSettings.profiles ?? []).map((p) => (
              <button
                key={p.id}
                type="button"
                data-terminal-profile-id={p.id}
                onClick={() => {
                  setTerminalMenuOpen(false);
                  void chooseTerminalProfile(p.id);
                }}
                disabled={!activeRepoPath}
                title={p.kind === "custom" ? (p.command?.trim() ? p.command.trim() : "Custom") : undefined}
              >
                {p.name}
              </button>
            ))}
            {(terminalSettings.profiles ?? []).length === 0 ? <div style={{ opacity: 0.75, padding: "6px 8px" }}>No terminal profiles.</div> : null}
            <button
              type="button"
              onClick={() => {
                setTerminalMenuOpen(false);
                openTerminalSettings();
              }}
            >
              Terminal settings…
            </button>
          </div>
        ) : null}
      </div>
      <div style={{ flex: 1 }} />
      {indicatorsUpdating ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, opacity: 0.75 }} title="Updating remote status">
          <span className="miniSpinner" />
        </div>
      ) : null}
      {loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, opacity: 0.7 }}>
          <span className="miniSpinner" />
          <span>Loading…</span>
        </div>
      ) : null}
      {error ? <div className="error">{error}</div> : null}
      {pullError ? <div className="error">{pullError}</div> : null}
    </div>
  );
}
