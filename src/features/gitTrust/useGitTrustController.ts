import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { changeRepoOwnershipToCurrentUser, gitTrustRepoGlobal, gitTrustRepoSession } from "../../api/git";
import { getCurrentUsername, openInFileExplorer } from "../../api/system";
import { copyText } from "../../utils/clipboard";
import { normalizeGitPath } from "../../utils/gitPath";

export function useGitTrustState() {
  const [gitTrustOpen, setGitTrustOpen] = useState(false);
  const [gitTrustRepoPath, setGitTrustRepoPath] = useState<string>("");
  const [gitTrustDetails, setGitTrustDetails] = useState<string>("");
  const [gitTrustDetailsOpen, setGitTrustDetailsOpen] = useState(false);
  const [gitTrustBusy, setGitTrustBusy] = useState(false);
  const [gitTrustActionError, setGitTrustActionError] = useState<string>("");
  const [gitTrustCopied, setGitTrustCopied] = useState(false);
  const [currentUsername, setCurrentUsername] = useState<string>("");

  const gitTrustCopyTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!gitTrustOpen) return;
    if (currentUsername) return;
    void getCurrentUsername()
      .then((u) => {
        setCurrentUsername(typeof u === "string" ? u : "");
      })
      .catch(() => {
        setCurrentUsername("");
      });
  }, [gitTrustOpen, currentUsername]);

  useEffect(() => {
    if (gitTrustCopyTimeoutRef.current) {
      window.clearTimeout(gitTrustCopyTimeoutRef.current);
      gitTrustCopyTimeoutRef.current = null;
    }
    setGitTrustCopied(false);
  }, [gitTrustOpen, gitTrustRepoPath]);

  const gitTrustGlobalCommand = useMemo(() => {
    return gitTrustRepoPath ? `git config --global --add safe.directory ${normalizeGitPath(gitTrustRepoPath)}` : "";
  }, [gitTrustRepoPath]);

  const copyGitTrustGlobalCommand = useCallback(async () => {
    if (!gitTrustGlobalCommand) return;
    try {
      await copyText(gitTrustGlobalCommand);
      setGitTrustCopied(true);
      if (gitTrustCopyTimeoutRef.current) {
        window.clearTimeout(gitTrustCopyTimeoutRef.current);
      }
      gitTrustCopyTimeoutRef.current = window.setTimeout(() => {
        setGitTrustCopied(false);
        gitTrustCopyTimeoutRef.current = null;
      }, 1200);
    } catch (e) {
      setGitTrustActionError(typeof e === "string" ? e : JSON.stringify(e));
    }
  }, [gitTrustGlobalCommand]);

  return {
    gitTrustOpen,
    setGitTrustOpen,
    gitTrustRepoPath,
    setGitTrustRepoPath,
    gitTrustDetails,
    setGitTrustDetails,
    gitTrustDetailsOpen,
    setGitTrustDetailsOpen,
    gitTrustBusy,
    setGitTrustBusy,
    gitTrustActionError,
    setGitTrustActionError,
    gitTrustCopied,
    currentUsername,

    gitTrustGlobalCommand,

    copyGitTrustGlobalCommand,
  } satisfies {
    gitTrustOpen: boolean;
    setGitTrustOpen: Dispatch<SetStateAction<boolean>>;
    gitTrustRepoPath: string;
    setGitTrustRepoPath: Dispatch<SetStateAction<string>>;
    gitTrustDetails: string;
    setGitTrustDetails: Dispatch<SetStateAction<string>>;
    gitTrustDetailsOpen: boolean;
    setGitTrustDetailsOpen: Dispatch<SetStateAction<boolean>>;
    gitTrustBusy: boolean;
    setGitTrustBusy: Dispatch<SetStateAction<boolean>>;
    gitTrustActionError: string;
    setGitTrustActionError: Dispatch<SetStateAction<string>>;
    gitTrustCopied: boolean;
    currentUsername: string;
    gitTrustGlobalCommand: string;
    copyGitTrustGlobalCommand: () => Promise<void>;
  };
}

export function useGitTrustActions(opts: {
  repos: string[];
  openRepository: (repoPath: string) => Promise<void>;
  closeRepository: (repoPath: string) => Promise<void>;
  confirmDialog: (opts: { title: string; message: string; okLabel?: string; cancelLabel?: string }) => Promise<boolean>;
  openTerminalProfile: (profileId?: string, repoPathOverride?: string) => Promise<void>;

  gitTrustRepoPath: string;
  currentUsername: string;
  setGitTrustOpen: Dispatch<SetStateAction<boolean>>;
  setGitTrustBusy: Dispatch<SetStateAction<boolean>>;
  setGitTrustActionError: Dispatch<SetStateAction<string>>;
}) {
  const {
    repos,
    openRepository,
    closeRepository,
    confirmDialog,
    openTerminalProfile,
    gitTrustRepoPath,
    currentUsername,
    setGitTrustOpen,
    setGitTrustBusy,
    setGitTrustActionError,
  } = opts;

  const trustRepoGloballyAndOpen = useCallback(async () => {
    if (!gitTrustRepoPath) return;
    setGitTrustBusy(true);
    setGitTrustActionError("");
    try {
      await gitTrustRepoGlobal(gitTrustRepoPath);
      setGitTrustOpen(false);
      await openRepository(gitTrustRepoPath);
    } catch (e) {
      setGitTrustActionError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setGitTrustBusy(false);
    }
  }, [gitTrustRepoPath, openRepository, setGitTrustActionError, setGitTrustBusy, setGitTrustOpen]);

  const trustRepoForSessionAndOpen = useCallback(async () => {
    if (!gitTrustRepoPath) return;
    setGitTrustBusy(true);
    setGitTrustActionError("");
    try {
      await gitTrustRepoSession(gitTrustRepoPath);
      setGitTrustOpen(false);
      await openRepository(gitTrustRepoPath);
    } catch (e) {
      setGitTrustActionError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setGitTrustBusy(false);
    }
  }, [gitTrustRepoPath, openRepository, setGitTrustActionError, setGitTrustBusy, setGitTrustOpen]);

  const changeOwnershipAndOpen = useCallback(async () => {
    if (!gitTrustRepoPath) return;
    const who = currentUsername ? currentUsername : "current user";
    const ok = await confirmDialog({
      title: "Change ownership",
      message: `This will attempt to change ownership of the repository folder to ${who}.\n\nUse this only if you know what you are doing. Continue?`,
      okLabel: "Continue",
      cancelLabel: "Cancel",
    });
    if (!ok) return;

    setGitTrustBusy(true);
    setGitTrustActionError("");
    try {
      await changeRepoOwnershipToCurrentUser(gitTrustRepoPath);
      setGitTrustOpen(false);
      await openRepository(gitTrustRepoPath);
    } catch (e) {
      setGitTrustActionError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setGitTrustBusy(false);
    }
  }, [confirmDialog, currentUsername, gitTrustRepoPath, openRepository, setGitTrustActionError, setGitTrustBusy, setGitTrustOpen]);

  const revealRepoInExplorerFromTrustDialog = useCallback(async () => {
    if (!gitTrustRepoPath) return;
    setGitTrustBusy(true);
    setGitTrustActionError("");
    try {
      await openInFileExplorer(gitTrustRepoPath);
      setGitTrustOpen(false);
    } catch (e) {
      setGitTrustActionError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setGitTrustBusy(false);
    }
  }, [gitTrustRepoPath, setGitTrustActionError, setGitTrustBusy, setGitTrustOpen]);

  const openTerminalFromTrustDialog = useCallback(async () => {
    if (!gitTrustRepoPath) return;
    setGitTrustBusy(true);
    setGitTrustActionError("");
    try {
      await openTerminalProfile(undefined, gitTrustRepoPath);
    } catch (e) {
      setGitTrustActionError(typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      setGitTrustBusy(false);
    }
  }, [gitTrustRepoPath, openTerminalProfile, setGitTrustActionError, setGitTrustBusy]);

  const closeTrustDialogAndRepoIfOpen = useCallback(async () => {
    const p = gitTrustRepoPath;
    setGitTrustOpen(false);
    setGitTrustActionError("");
    if (!p) return;
    if (repos.includes(p)) {
      await closeRepository(p);
    }
  }, [closeRepository, gitTrustRepoPath, repos, setGitTrustActionError, setGitTrustOpen]);

  return {
    trustRepoGloballyAndOpen,
    trustRepoForSessionAndOpen,
    changeOwnershipAndOpen,
    revealRepoInExplorerFromTrustDialog,
    openTerminalFromTrustDialog,
    closeTrustDialogAndRepoIfOpen,
  };
}
