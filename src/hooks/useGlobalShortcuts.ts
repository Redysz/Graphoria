import { useEffect, type MutableRefObject } from "react";
import { getCurrentWindow, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
import { eventToShortcutSpec, type ShortcutActionId } from "../shortcuts";

export function useGlobalShortcuts(
  runtimeRef: MutableRefObject<any>,
  fullscreenRestoreRef: MutableRefObject<{ pos: any; size: any } | null>
) {
  useEffect(() => {
    const isTextEntryTarget = (t: EventTarget | null) => {
      const el = t instanceof HTMLElement ? t : null;
      if (!el) return false;
      if (el.isContentEditable) return true;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      return !!el.closest("input,textarea,select,[contenteditable='true']");
    };

    const isShortcutCaptureTarget = (t: EventTarget | null) => {
      const el = t instanceof HTMLElement ? t : null;
      if (!el) return false;
      return !!el.closest("[data-shortcut-capture='true']");
    };

    const isBrowserShortcut = (e: KeyboardEvent) => {
      const key = (e.key || "").toLowerCase();
      const primary = e.ctrlKey || e.metaKey;

      if (e.key === "F5") return true;
      if (e.key === "F11") return true;
      if (primary && !e.altKey && (key === "r" || key === "p" || key === "f" || key === "g")) return true;
      if (primary && !e.altKey && (key === "t" || key === "n" || key === "w" || key === "o" || key === "s")) return true;
      if (primary && !e.altKey && (key === "l" || key === "k" || key === "u")) return true;
      if (primary && e.shiftKey && !e.altKey && (key === "i" || key === "j" || key === "c")) return true;
      return false;
    };

    const toggleFullscreen = async () => {
      const win = getCurrentWindow();
      const isFs = await win.isFullscreen();
      if (!isFs) {
        const pos = await win.outerPosition();
        const size = await win.outerSize();
        fullscreenRestoreRef.current = { pos, size };
        await win.setFullscreen(true);
        return;
      }

      await win.setFullscreen(false);
      const restore = fullscreenRestoreRef.current;
      if (!restore) return;
      await win.setSize(new PhysicalSize(restore.size.width, restore.size.height)).catch(() => undefined);
      await win.setPosition(new PhysicalPosition(restore.pos.x, restore.pos.y)).catch(() => undefined);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const s = runtimeRef.current;

      const inShortcutCapture = isShortcutCaptureTarget(e.target) || isShortcutCaptureTarget(document.activeElement);
      if (inShortcutCapture) return;

      if (e.key === "F12") {
        e.preventDefault();
        e.stopPropagation();
        void toggleFullscreen();
        return;
      }

      const inTextEntry = isTextEntryTarget(e.target) || isTextEntryTarget(document.activeElement);
      const blockedByBrowser = isBrowserShortcut(e);
      if (blockedByBrowser) {
        e.preventDefault();
        e.stopPropagation();
      }

      const anyModalOpen =
        !!s.gitTrustOpen ||
        !!s.diffToolModalOpen ||
        !!s.cleanOldBranchesOpen ||
        !!s.settingsOpen ||
        !!s.goToOpen ||
        !!s.confirmOpen ||
        !!s.cloneModalOpen ||
        !!s.commitModalOpen ||
        !!s.stashModalOpen ||
        !!s.stashViewOpen ||
        !!s.remoteModalOpen ||
        !!s.pushModalOpen ||
        !!s.resetModalOpen ||
        !!s.createBranchOpen ||
        !!s.renameBranchOpen ||
        !!s.switchBranchOpen ||
        !!s.pullConflictOpen ||
        !!s.pullPredictOpen ||
        !!s.filePreviewOpen ||
        !!s.detachedHelpOpen ||
        !!s.cherryStepsOpen ||
        !!s.previewZoomSrc;

      if (s.terminalMenuOpen) {
        const profiles = (s.terminalSettings?.profiles ?? []) as Array<{ id: string }>;
        const max = profiles.length;

        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          s.setTerminalMenuOpen(false);
          return;
        }
        if (max > 0 && e.key === "ArrowDown") {
          e.preventDefault();
          e.stopPropagation();
          s.setTerminalMenuIndex((i: number) => Math.min(max - 1, i + 1));
          return;
        }
        if (max > 0 && e.key === "ArrowUp") {
          e.preventDefault();
          e.stopPropagation();
          s.setTerminalMenuIndex((i: number) => Math.max(0, i - 1));
          return;
        }
        if (max > 0 && e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          const p = profiles[Math.max(0, Math.min(max - 1, s.terminalMenuIndex))];
          if (!p) return;
          s.setTerminalMenuOpen(false);
          s.setTerminal({ defaultProfileId: p.id });
          s.openTerminalProfile(p.id);
          return;
        }
      }

      if (anyModalOpen) return;
      if (inTextEntry) return;

      const spec = eventToShortcutSpec(e);
      if (!spec) return;

      let actionId: ShortcutActionId | null = null;
      for (const [k, v] of Object.entries(s.shortcutBindings ?? ({} as Record<string, unknown>))) {
        const vv = typeof v === "string" ? v : "";
        if (vv.trim() === spec) {
          actionId = k as ShortcutActionId;
          break;
        }
      }
      if (!actionId) return;

      e.preventDefault();
      e.stopPropagation();

      if (actionId === "cmd.terminalMenu" && !s.activeRepoPath) return;
      if (actionId === "cmd.pullMenu" && !s.activeRepoPath) return;
      if (actionId === "repo.fetch" && !s.activeRepoPath) return;
      if (actionId === "cmd.commit" && !s.activeRepoPath) return;
      if (actionId === "cmd.push" && !s.activeRepoPath) return;
      if (actionId === "cmd.stash" && !s.activeRepoPath) return;
      if (actionId === "cmd.checkoutBranch" && !s.activeRepoPath) return;
      if (actionId === "cmd.reset" && !s.activeRepoPath) return;

      switch (actionId) {
        case "repo.prev":
          s.moveActiveRepoBy(-1);
          return;
        case "repo.next":
          s.moveActiveRepoBy(1);
          return;
        case "panel.branches.show":
          s.setSidebarVisible(true);
          return;
        case "panel.branches.hide":
          s.setSidebarVisible(false);
          return;
        case "panel.details.show":
          s.setDetailsVisible(true);
          return;
        case "panel.details.hide":
          s.setDetailsVisible(false);
          return;
        case "view.graph":
          s.setViewMode("graph");
          return;
        case "view.commits":
          s.setViewMode("commits");
          return;
        case "nav.goToCommit":
          s.setGoToError("");
          s.setGoToKind("commit");
          s.setGoToText("");
          s.setGoToTargetView(s.viewMode);
          s.setGoToOpen(true);
          return;
        case "nav.goToTag":
          s.setGoToError("");
          s.setGoToKind("tag");
          s.setGoToText("");
          s.setGoToTargetView(s.viewMode);
          s.setGoToOpen(true);
          return;
        case "cmd.commit":
          s.openCommitDialog();
          return;
        case "cmd.push":
          s.openPushDialog();
          return;
        case "cmd.stash":
          s.openStashDialog();
          return;
        case "cmd.createBranch": {
          const at = (s.selectedHash?.trim() ? s.selectedHash.trim() : s.headHash?.trim()).trim();
          if (!at) return;
          s.openCreateBranchDialog(at);
          return;
        }
        case "cmd.checkoutBranch":
          s.openSwitchBranchDialog();
          return;
        case "cmd.reset":
          s.openResetDialog();
          return;
        case "repo.open":
          s.pickRepository();
          return;
        case "repo.refresh":
          s.loadRepo();
          return;
        case "repo.initialize":
          s.initializeProject();
          return;
        case "cmd.terminalMenu":
          s.setTerminalMenuOpen((v: boolean) => !v);
          return;
        case "cmd.pullMenu":
          if (!s.activeRepoPath || s.loading || s.pullBusy || !s.remoteUrl) return;
          s.setPullMenuOpen((v: boolean) => !v);
          return;
        case "repo.fetch":
          s.runFetch();
          return;
        case "tool.diffTool":
          s.setDiffToolModalOpen(true);
          return;
        case "view.toggleStashesOnGraph":
          s.setGraph({ showStashesOnGraph: !s.graphSettings.showStashesOnGraph });
          return;
        case "view.toggleTags":
          s.setGraph({ showTags: !s.graphSettings.showTags });
          return;
        case "view.toggleRemoteBranches":
          s.setGraph({ showRemoteBranchesOnGraph: !s.graphSettings.showRemoteBranchesOnGraph });
          return;
        case "view.toggleDetailsWindow":
          s.setDetailsVisible(!(s.layout.detailsHeightPx > 0));
          return;
        case "view.toggleBranchesWindow":
          s.setSidebarVisible(!(s.layout.sidebarWidthPx > 0));
          return;
        case "view.toggleGraphButtons":
          s.setGraphButtonsVisible((v: boolean) => !v);
          return;
        case "view.toggleOnlineAvatars":
          s.setGit({ showOnlineAvatars: !s.showOnlineAvatars });
          return;
        case "view.toggleCommitsOnlyHead":
          s.setGit({ commitsOnlyHead: !s.commitsOnlyHead });
          return;
        case "view.toggleLayoutDirection":
          s.setGraph({ edgeDirection: s.graphSettings.edgeDirection === "to_parent" ? "to_child" : "to_parent" });
          return;
        case "view.toggleTooltips":
          s.setGeneral({ tooltips: { ...s.tooltipSettings, enabled: !s.tooltipSettings.enabled } });
          return;
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [fullscreenRestoreRef, runtimeRef]);
}
