import type { Dispatch, ReactNode, RefObject, SetStateAction } from "react";
import type { QuickButtonId, TerminalSettings } from "../appSettingsStore";
import type { ShortcutActionId } from "../shortcuts";

export function TopToolbar(props: {
  repos: string[];
  activeRepoPath: string;
  loading: boolean;
  cloneBusy: boolean;
  remoteUrl: string | null | undefined;
  quickButtons: QuickButtonId[];
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
  openStashDialog: () => void | Promise<void>;
  openCreateTagDialog: () => void | Promise<void>;
  openResetDialog: () => void | Promise<void>;
  openCherryPickDialog: () => void | Promise<void>;
  openExportPatchDialog: () => void | Promise<void>;
  openApplyPatchDialog: () => void | Promise<void>;
  openDiffTool: () => void | Promise<void>;
  openCommitSearch: () => void | Promise<void>;
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
  errorHasDetails?: boolean;
  onOpenErrorDetails?: () => void;
  errorCanIgnore?: boolean;
  onIgnoreError?: () => void;
  errorIgnoreBusy?: boolean;
  pullError: string;
}) {
  const {
    repos,
    activeRepoPath,
    loading,
    cloneBusy,
    remoteUrl,
    quickButtons,
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
    openStashDialog,
    openCreateTagDialog,
    openResetDialog,
    openCherryPickDialog,
    openExportPatchDialog,
    openApplyPatchDialog,
    openDiffTool,
    openCommitSearch,
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
    errorHasDetails,
    onOpenErrorDetails,
    errorCanIgnore,
    onIgnoreError,
    errorIgnoreBusy,
    pullError,
  } = props;

  const desired = (quickButtons ?? []).slice(0, 10);
  const shouldShowOpen = repos.length === 0 || desired.includes("open");
  const order = shouldShowOpen ? (["open", ...desired.filter((x) => x !== "open")] as QuickButtonId[]) : desired;

  const pullButton = () => (
    <div key="pull" style={{ position: "relative", display: "flex", alignItems: "stretch" }}>
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
  );

  const terminalButton = () => (
    <div key="terminal" style={{ position: "relative", display: "flex", alignItems: "stretch" }}>
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
  );

  const renderers: Record<QuickButtonId, () => ReactNode> = {
    open: () => (
      <button
        key="open"
        type="button"
        onClick={() => {
          void openRepoPicker();
        }}
        disabled={loading || cloneBusy}
        title="Open repository"
      >
        {toolbarItem("Open", shortcutLabel("repo.open"))}
      </button>
    ),
    refresh: () => (
      <button key="refresh" type="button" onClick={() => void refreshRepo()} disabled={!activeRepoPath || loading}>
        {toolbarItem("Refresh", shortcutLabel("repo.refresh"))}
      </button>
    ),
    fetch: () => (
      <button
        key="fetch"
        type="button"
        onClick={() => void runFetch()}
        disabled={!activeRepoPath || loading || !remoteUrl}
        title={!remoteUrl ? "No remote origin" : "git fetch origin"}
      >
        {toolbarItem("Fetch", shortcutLabel("repo.fetch"))}
      </button>
    ),
    pull: pullButton,
    commit: () => (
      <button key="commit" type="button" onClick={() => void openCommitDialog()} disabled={!activeRepoPath || loading}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>Commit…</span>
          {changedCount > 0 ? <span className="badge">{changedCount}</span> : null}
          {showToolbarShortcutHints && shortcutLabel("cmd.commit") ? <span className="menuShortcut">{shortcutLabel("cmd.commit")}</span> : null}
        </span>
      </button>
    ),
    push: () => (
      <button
        key="push"
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
    ),
    terminal: terminalButton,
    stash: () => (
      <button key="stash" type="button" onClick={() => void openStashDialog()} disabled={!activeRepoPath || loading}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>Stash…</span>
          {changedCount > 0 ? <span className="badge">{changedCount}</span> : null}
          {showToolbarShortcutHints && shortcutLabel("cmd.stash") ? <span className="menuShortcut">{shortcutLabel("cmd.stash")}</span> : null}
        </span>
      </button>
    ),
    create_tag: () => (
      <button key="create_tag" type="button" onClick={() => void openCreateTagDialog()} disabled={!activeRepoPath || loading}>
        {toolbarItem("Create tag…", shortcutLabel("cmd.createTag"))}
      </button>
    ),
    reset: () => (
      <button key="reset" type="button" onClick={() => void openResetDialog()} disabled={!activeRepoPath || loading}>
        {toolbarItem("Reset…", shortcutLabel("cmd.reset"))}
      </button>
    ),
    cherry_pick: () => (
      <button key="cherry_pick" type="button" onClick={() => void openCherryPickDialog()} disabled={!activeRepoPath || loading}>
        {toolbarItem("Cherry-pick…", shortcutLabel("cmd.cherryPick"))}
      </button>
    ),
    export_patch: () => (
      <button key="export_patch" type="button" onClick={() => void openExportPatchDialog()} disabled={!activeRepoPath || loading}>
        {toolbarItem("Export patch…")}
      </button>
    ),
    apply_patch: () => (
      <button key="apply_patch" type="button" onClick={() => void openApplyPatchDialog()} disabled={!activeRepoPath || loading}>
        {toolbarItem("Apply patch…")}
      </button>
    ),
    diff_tool: () => (
      <button key="diff_tool" type="button" onClick={() => void openDiffTool()} disabled={loading}>
        {toolbarItem("Diff tool…", shortcutLabel("tool.diffTool"))}
      </button>
    ),
    commit_search: () => (
      <button key="commit_search" type="button" onClick={() => void openCommitSearch()} disabled={!activeRepoPath || loading}>
        {toolbarItem("Commit search…", shortcutLabel("tool.commitSearch"))}
      </button>
    ),
  };

  return (
    <div className="toolbar">
      {order.map((id) => {
        const r = renderers[id];
        return r ? r() : null;
      })}
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
      {error ? (
        <div className="error" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span>{error}</span>
          {errorHasDetails && onOpenErrorDetails ? (
            <button type="button" onClick={onOpenErrorDetails} style={{ padding: "2px 8px", minHeight: 24 }}>
              Details
            </button>
          ) : null}
          {errorCanIgnore && onIgnoreError ? (
            <button type="button" onClick={onIgnoreError} disabled={!!errorIgnoreBusy} style={{ padding: "2px 8px", minHeight: 24 }}>
              {errorIgnoreBusy ? "Ignoring…" : "Ignore"}
            </button>
          ) : null}
        </div>
      ) : null}
      {pullError ? <div className="error">{pullError}</div> : null}
    </div>
  );
}
