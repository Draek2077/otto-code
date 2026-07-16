import { useState, useCallback, useEffect, useMemo, type ReactElement } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTranslation } from "react-i18next";
import { type CheckoutGitActionStatus, useCheckoutGitActionsStore } from "@/git/actions-store";
import { type CheckoutStatusPayload, useCheckoutStatusQuery } from "@/git/use-status-query";
import { type CheckoutPrStatusPayload, useCheckoutPrStatusQuery } from "@/git/use-pr-status-query";
import {
  buildGitActions,
  getGitHostingProviderDisplayName,
  narrowPullRequestState,
  type BuildGitActionsInput,
  type GitAction,
  type GitActions,
} from "@/git/policy";
import type {
  CheckoutPrMergeMethod,
  CommitMessageAgent,
  GitHostingProviderId,
} from "@otto-code/protocol/messages";
import { confirmDialog } from "@/utils/confirm-dialog";
import { openLink } from "@/utils/open-link";
import { useToast } from "@/contexts/toast-context";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import {
  useActiveWorkspaceSelection,
  type ActiveWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { redirectIfArchivingActiveWorkspace } from "@/utils/sidebar-workspace-archive-redirect";
import { type WorktreeArchiveWarningLabels } from "@/git/worktree-archive-warning";
import { useWorkspaceArchive } from "@/workspace/use-workspace-archive";
import { resolveWorkspaceMapKeyByIdentity } from "@/utils/workspace-identity";

export type { GitActionId, GitAction, GitActions } from "@/git/policy";

function openURLInNewTab(url: string): void {
  void openLink(url);
}

/** Human-friendly "who writes the message" line for the AI-commit confirmation. */
function describeCommitAgentMessage(
  agent: Exclude<CommitMessageAgent, { kind: "none" }>,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const detail = agent.modelLabel
    ? t("workspace.git.commitAgent.providerModel", {
        provider: agent.providerLabel,
        model: agent.modelLabel,
      })
    : agent.providerLabel;
  if (agent.kind === "personality") {
    return t("workspace.git.commitAgent.messagePersonality", {
      name: agent.personalityName,
      detail,
    });
  }
  return t("workspace.git.commitAgent.messageProvider", { detail });
}

function isActionDisabled(actionsDisabled: boolean, status: CheckoutGitActionStatus): boolean {
  return actionsDisabled || status === "pending";
}

function resolveBranchLabel(input: {
  currentBranch: string | null | undefined;
  notGit: boolean;
  notRepositoryLabel: string;
  unknownLabel: string;
}): string {
  if (input.currentBranch && input.currentBranch !== "HEAD") {
    return input.currentBranch;
  }
  if (input.notGit) {
    return input.notRepositoryLabel;
  }
  return input.unknownLabel;
}

function formatBaseRefLabel(baseRef: string | undefined, fallbackLabel: string): string {
  if (!baseRef) return fallbackLabel;
  const trimmed = baseRef.replace(/^refs\/(heads|remotes)\//, "").trim();
  return trimmed.startsWith("origin/") ? trimmed.slice("origin/".length) : trimmed;
}

type PrStatusValue = NonNullable<CheckoutPrStatusPayload["status"]> | null;

interface DeriveGitActionsStateArgs {
  isGit: boolean;
  status: CheckoutStatusPayload | null;
  gitStatus: CheckoutStatusPayload | null;
  prStatus: PrStatusValue;
  hasUncommittedChanges: boolean;
  postShipArchiveSuggested: boolean;
  isStatusLoading: boolean;
  isBranchSwitchPending: boolean;
  baseRefLabel: string;
}

interface DerivedGitActionsState {
  actionsDisabled: boolean;
  aheadCount: number;
  behindBaseCount: number;
  aheadOfOrigin: number | null;
  behindOfOrigin: number | null;
  hasPullRequest: boolean;
  hasRemote: boolean;
  isOttoOwnedWorktree: boolean;
  isOnBaseBranch: boolean;
  shouldPromoteArchive: boolean;
}

interface GitCommitCounts {
  aheadCount: number;
  behindBaseCount: number;
  aheadOfOrigin: number | null;
  behindOfOrigin: number | null;
}

function extractGitCommitCounts(gitStatus: CheckoutStatusPayload | null): GitCommitCounts {
  return {
    aheadCount: gitStatus?.aheadBehind?.ahead ?? 0,
    behindBaseCount: gitStatus?.aheadBehind?.behind ?? 0,
    aheadOfOrigin: gitStatus?.aheadOfOrigin ?? null,
    behindOfOrigin: gitStatus?.behindOfOrigin ?? null,
  };
}

function computeShouldPromoteArchive(input: {
  hasUncommittedChanges: boolean;
  postShipArchiveSuggested: boolean;
  isMergedPullRequest: boolean;
}): boolean {
  return (
    !input.hasUncommittedChanges && (input.postShipArchiveSuggested || input.isMergedPullRequest)
  );
}

function deriveGitActionsState(args: DeriveGitActionsStateArgs): DerivedGitActionsState {
  const {
    isGit,
    status,
    gitStatus,
    prStatus,
    hasUncommittedChanges,
    postShipArchiveSuggested,
    isStatusLoading,
    isBranchSwitchPending,
    baseRefLabel,
  } = args;
  // A pending branch switch rewrites the working tree, so every other git
  // action in the header locks until it resolves.
  const actionsDisabled =
    !isGit || Boolean(status?.error) || isStatusLoading || isBranchSwitchPending;
  const isOttoOwnedWorktree = gitStatus?.isOttoOwnedWorktree ?? false;
  const isMergedPullRequest = Boolean(prStatus?.isMerged);
  return {
    actionsDisabled,
    ...extractGitCommitCounts(gitStatus),
    hasPullRequest: Boolean(prStatus?.url),
    hasRemote: gitStatus?.hasRemote ?? false,
    isOttoOwnedWorktree,
    isOnBaseBranch: gitStatus?.currentBranch === baseRefLabel,
    shouldPromoteArchive: computeShouldPromoteArchive({
      hasUncommittedChanges,
      postShipArchiveSuggested,
      isMergedPullRequest,
    }),
  };
}

interface UseGitActionsInput {
  serverId: string;
  cwd: string;
  icons: {
    commit: ReactElement;
    pull: ReactElement;
    push: ReactElement;
    pullAndPush: ReactElement;
    // PR-hosting actions carry the provider mark (GitHub/Bitbucket), so they
    // render per-provider — the hook resolves them with the workspace's
    // detected git hosting provider.
    viewPr: (provider: GitHostingProviderId) => ReactElement;
    createPr: (provider: GitHostingProviderId) => ReactElement;
    mergePrSquash: (provider: GitHostingProviderId) => ReactElement;
    mergePrMerge: (provider: GitHostingProviderId) => ReactElement;
    mergePrRebase: (provider: GitHostingProviderId) => ReactElement;
    merge: ReactElement;
    mergeFromBase: ReactElement;
    archive: ReactElement;
  };
}

interface UseGitActionsResult {
  gitActions: GitActions;
  branchLabel: string;
  isGit: boolean;
}

interface UseWorkspaceScreenArchiveControllerInput {
  serverId: string;
  activeWorkspaceSelection: ActiveWorkspaceSelection | null;
  workspaceDirectory: string | null | undefined;
  branchLabel: string;
  gitStatus: CheckoutStatusPayload | null;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function resolveArchiveWorkspaceDescriptor(input: {
  workspaces: Map<string, WorkspaceDescriptor> | undefined;
  activeWorkspaceSelection: ActiveWorkspaceSelection | null;
  workspaceDirectory: string | null | undefined;
}): WorkspaceDescriptor | null {
  const activeWorkspaceKey = input.activeWorkspaceSelection
    ? resolveWorkspaceMapKeyByIdentity({
        workspaces: input.workspaces,
        workspaceId: input.activeWorkspaceSelection.workspaceId,
      })
    : null;
  if (activeWorkspaceKey) {
    return input.workspaces?.get(activeWorkspaceKey) ?? null;
  }
  if (!input.workspaceDirectory) {
    return null;
  }
  for (const candidate of input.workspaces?.values() ?? []) {
    if (candidate.workspaceDirectory === input.workspaceDirectory) {
      return candidate;
    }
  }
  return null;
}

function resolveWorkspaceArchiveRisk(
  workspace: WorkspaceDescriptor | null,
  gitStatus: CheckoutStatusPayload | null,
): { isDirty: boolean | null | undefined; aheadOfOrigin: number | null | undefined } {
  return {
    isDirty: gitStatus?.isDirty ?? workspace?.gitRuntime?.isDirty,
    aheadOfOrigin: gitStatus?.aheadOfOrigin ?? workspace?.gitRuntime?.aheadOfOrigin,
  };
}

function canArchiveWorkspace(
  workspace: WorkspaceDescriptor | null,
  risk: ReturnType<typeof resolveWorkspaceArchiveRisk>,
): boolean {
  return (
    workspace !== null &&
    (workspace.workspaceKind !== "worktree" ||
      (risk.isDirty !== undefined && risk.aheadOfOrigin !== undefined))
  );
}

function useWorkspaceScreenArchiveController({
  serverId,
  activeWorkspaceSelection,
  workspaceDirectory,
  branchLabel,
  gitStatus,
  t,
}: UseWorkspaceScreenArchiveControllerInput) {
  const sessionWorkspaces = useSessionStore((state) => state.sessions[serverId]?.workspaces);
  const [isHidingWorkspace, setIsHidingWorkspace] = useState(false);
  const workspaceDescriptor = useMemo(
    () =>
      resolveArchiveWorkspaceDescriptor({
        workspaces: sessionWorkspaces,
        activeWorkspaceSelection,
        workspaceDirectory,
      }),
    [activeWorkspaceSelection, sessionWorkspaces, workspaceDirectory],
  );
  const archiveRisk = resolveWorkspaceArchiveRisk(workspaceDescriptor, gitStatus);

  const controller = useWorkspaceArchive({
    serverId,
    workspaceId: workspaceDescriptor?.id ?? "",
    workspaceKind: workspaceDescriptor?.workspaceKind ?? "directory",
    name: workspaceDescriptor?.name ?? branchLabel,
    isDirty: archiveRisk.isDirty,
    aheadOfOrigin: archiveRisk.aheadOfOrigin,
    diffStat: workspaceDescriptor?.diffStat ?? null,
    warningLabels: getWorktreeArchiveWarningLabels(t),
    onSetHiding: setIsHidingWorkspace,
    onArchiveStarted: () => {
      if (!activeWorkspaceSelection) {
        return;
      }
      redirectIfArchivingActiveWorkspace({
        serverId,
        workspaceId: activeWorkspaceSelection.workspaceId,
        activeWorkspaceSelection,
      });
    },
  });

  return {
    ...controller,
    isArchiving: workspaceDescriptor?.archivingAt != null || isHidingWorkspace,
    canArchive: canArchiveWorkspace(workspaceDescriptor, archiveRisk),
  };
}

export function useGitActions({ serverId, cwd, icons }: UseGitActionsInput): UseGitActionsResult {
  const { t } = useTranslation();
  const toast = useToast();
  const activeWorkspaceSelection = useActiveWorkspaceSelection();
  const [postShipArchiveSuggested, setPostShipArchiveSuggested] = useState(false);
  const [shipDefault, setShipDefault] = useState<"merge" | "pr">("pr");

  const { status, isLoading: isStatusLoading } = useCheckoutStatusQuery({ serverId, cwd });
  const gitStatus = status && status.isGit ? status : null;
  const isGit = Boolean(gitStatus);
  const notGit = status !== null && !status.isGit && !status.error;
  const baseRef = gitStatus?.baseRef ?? undefined;

  const hasUncommittedChanges = Boolean(gitStatus?.isDirty);

  const {
    status: prStatus,
    githubFeaturesEnabled,
    hostingProvider,
  } = useCheckoutPrStatusQuery({
    serverId,
    cwd,
    enabled: isGit,
  });
  const baseRefLabel = useMemo(
    () => formatBaseRefLabel(baseRef, t("workspace.git.diff.base")),
    [baseRef, t],
  );
  const branchLabel = resolveBranchLabel({
    currentBranch: gitStatus?.currentBranch,
    notGit,
    notRepositoryLabel: t("workspace.git.diff.notRepository"),
    unknownLabel: t("workspace.git.diff.branchUnknown"),
  });

  // Ship default persistence
  const shipDefaultStorageKey = useMemo(() => {
    if (!gitStatus?.repoRoot) {
      return null;
    }
    return `@otto:changes-ship-default:${gitStatus.repoRoot}`;
  }, [gitStatus?.repoRoot]);

  useEffect(() => {
    if (!shipDefaultStorageKey) {
      setShipDefault("pr");
      return;
    }
    let isActive = true;
    setShipDefault("pr");
    AsyncStorage.getItem(shipDefaultStorageKey)
      .then((value) => {
        if (!isActive) return;
        if (value === "pr" || value === "merge") {
          setShipDefault(value);
          return;
        }
        setShipDefault("pr");
        return;
      })
      .catch(() => undefined);
    return () => {
      isActive = false;
    };
  }, [shipDefaultStorageKey]);

  const persistShipDefault = useCallback(
    async (next: "merge" | "pr") => {
      setShipDefault(next);
      if (!shipDefaultStorageKey) return;
      try {
        await AsyncStorage.setItem(shipDefaultStorageKey, next);
      } catch {
        // Ignore persistence failures; default will reset to "pr".
      }
    },
    [shipDefaultStorageKey],
  );

  useEffect(() => {
    setPostShipArchiveSuggested(false);
  }, [cwd]);

  const commitStatus = useCheckoutGitActionsStore((s) =>
    s.getStatus({ serverId, cwd, actionId: "commit" }),
  );
  const pullStatus = useCheckoutGitActionsStore((s) =>
    s.getStatus({ serverId, cwd, actionId: "pull" }),
  );
  const pushStatus = useCheckoutGitActionsStore((s) =>
    s.getStatus({ serverId, cwd, actionId: "push" }),
  );
  const pullAndPushStatus = useCheckoutGitActionsStore((s) =>
    s.getStatus({ serverId, cwd, actionId: "pull-and-push" }),
  );
  const prCreateStatus = useCheckoutGitActionsStore((s) =>
    s.getStatus({ serverId, cwd, actionId: "create-pr" }),
  );
  const mergePrStatuses: Record<CheckoutPrMergeMethod, CheckoutGitActionStatus> = {
    squash: useCheckoutGitActionsStore((s) =>
      s.getStatus({ serverId, cwd, actionId: "merge-pr-squash" }),
    ),
    merge: useCheckoutGitActionsStore((s) =>
      s.getStatus({ serverId, cwd, actionId: "merge-pr-merge" }),
    ),
    rebase: useCheckoutGitActionsStore((s) =>
      s.getStatus({ serverId, cwd, actionId: "merge-pr-rebase" }),
    ),
  };
  const enablePrAutoMergeStatuses: Record<CheckoutPrMergeMethod, CheckoutGitActionStatus> = {
    squash: useCheckoutGitActionsStore((s) =>
      s.getStatus({ serverId, cwd, actionId: "enable-pr-auto-merge-squash" }),
    ),
    merge: useCheckoutGitActionsStore((s) =>
      s.getStatus({ serverId, cwd, actionId: "enable-pr-auto-merge-merge" }),
    ),
    rebase: useCheckoutGitActionsStore((s) =>
      s.getStatus({ serverId, cwd, actionId: "enable-pr-auto-merge-rebase" }),
    ),
  };
  const disablePrAutoMergeStatus = useCheckoutGitActionsStore((s) =>
    s.getStatus({ serverId, cwd, actionId: "disable-pr-auto-merge" }),
  );
  const mergeStatus = useCheckoutGitActionsStore((s) =>
    s.getStatus({ serverId, cwd, actionId: "merge-branch" }),
  );
  const mergeFromBaseStatus = useCheckoutGitActionsStore((s) =>
    s.getStatus({ serverId, cwd, actionId: "merge-from-base" }),
  );
  const switchBranchStatus = useCheckoutGitActionsStore((s) =>
    s.getStatus({ serverId, cwd, actionId: "switch-branch" }),
  );

  const runCommit = useCheckoutGitActionsStore((s) => s.commit);
  const resolveCommitAgent = useCheckoutGitActionsStore((s) => s.resolveCommitAgent);
  const commitAgentSupported = useSessionStore(
    (s) => s.sessions[serverId]?.serverInfo?.features?.checkoutGitCommitAgent === true,
  );
  const runPull = useCheckoutGitActionsStore((s) => s.pull);
  const runPush = useCheckoutGitActionsStore((s) => s.push);
  const runPullAndPush = useCheckoutGitActionsStore((s) => s.pullAndPush);
  const runCreatePr = useCheckoutGitActionsStore((s) => s.createPr);
  const runMergePr = useCheckoutGitActionsStore((s) => s.mergePr);
  const runEnablePrAutoMerge = useCheckoutGitActionsStore((s) => s.enablePrAutoMerge);
  const runDisablePrAutoMerge = useCheckoutGitActionsStore((s) => s.disablePrAutoMerge);
  const runMergeBranch = useCheckoutGitActionsStore((s) => s.mergeBranch);
  const runMergeFromBase = useCheckoutGitActionsStore((s) => s.mergeFromBase);
  const githubAutoMergeActionsEnabled = useSessionStore(
    (s) => s.sessions[serverId]?.serverInfo?.features?.checkoutGithubSetAutoMerge === true,
  );

  const toastActionError = useCallback(
    (error: unknown, fallback: string) => {
      const message = error instanceof Error ? error.message : fallback;
      toast.error(message);
    },
    [toast],
  );

  const toastActionSuccess = useCallback(
    (message: string) => {
      toast.show(message, { variant: "success" });
    },
    [toast],
  );

  // Handlers
  const performCommit = useCallback(
    () =>
      runCommit({ serverId, cwd })
        .then(() => {
          toastActionSuccess(t("workspace.git.actions.commit.success"));
          return;
        })
        .catch((err) => {
          toastActionError(err, t("workspace.git.actions.toasts.failedCommit"));
        }),
    [cwd, runCommit, serverId, t, toastActionError, toastActionSuccess],
  );

  // The header "Commit" CTA authors its message with an AI agent. Before running
  // it, resolve which agent the host would use and confirm it with the user; if
  // nothing is set up to write the message, refuse instead of committing
  // placeholder text. Old hosts that can't name the agent keep the one-click flow.
  const handleCommit = useCallback(() => {
    if (!commitAgentSupported) {
      void performCommit();
      return;
    }
    void (async () => {
      let agent: CommitMessageAgent;
      try {
        agent = await resolveCommitAgent({ serverId, cwd });
      } catch (err) {
        toastActionError(err, t("workspace.git.actions.toasts.failedCommit"));
        return;
      }
      if (agent.kind === "none") {
        await confirmDialog({
          title: t("workspace.git.commitAgent.noneTitle"),
          message: t("workspace.git.commitAgent.noneMessage"),
          confirmLabel: t("workspace.git.commitAgent.noneConfirm"),
        });
        return;
      }
      const confirmed = await confirmDialog({
        title: t("workspace.git.commitAgent.confirmTitle"),
        message: describeCommitAgentMessage(agent, t),
        confirmLabel: t("workspace.git.commitAgent.confirmCta"),
      });
      if (!confirmed) {
        return;
      }
      await performCommit();
    })();
  }, [commitAgentSupported, cwd, performCommit, resolveCommitAgent, serverId, t, toastActionError]);

  const handlePull = useCallback(() => {
    void runPull({ serverId, cwd })
      .then(() => {
        toastActionSuccess(t("workspace.git.actions.pull.success"));
        return;
      })
      .catch((err) => {
        toastActionError(err, t("workspace.git.actions.toasts.failedPull"));
      });
  }, [cwd, runPull, serverId, t, toastActionError, toastActionSuccess]);

  const handlePush = useCallback(() => {
    void runPush({ serverId, cwd })
      .then(() => {
        toastActionSuccess(t("workspace.git.actions.push.success"));
        return;
      })
      .catch((err) => {
        toastActionError(err, t("workspace.git.actions.toasts.failedPush"));
      });
  }, [cwd, runPush, serverId, t, toastActionError, toastActionSuccess]);

  const handlePullAndPush = useCallback(() => {
    void runPullAndPush({ serverId, cwd })
      .then(() => {
        toastActionSuccess(t("workspace.git.actions.pullAndPush.success"));
        return;
      })
      .catch((err) => {
        toastActionError(err, t("workspace.git.actions.toasts.failedPullAndPush"));
      });
  }, [cwd, runPullAndPush, serverId, t, toastActionError, toastActionSuccess]);

  const handleCreatePr = useCallback(() => {
    void persistShipDefault("pr");
    void runCreatePr({ serverId, cwd })
      .then(() => {
        toastActionSuccess(t("workspace.git.actions.createPr.success"));
        return;
      })
      .catch((err) => {
        toastActionError(err, t("workspace.git.actions.toasts.failedCreatePr"));
      });
  }, [cwd, persistShipDefault, runCreatePr, serverId, t, toastActionError, toastActionSuccess]);

  const handleMergePr = useCallback(
    (method: CheckoutPrMergeMethod) => {
      void persistShipDefault("pr");
      void runMergePr({ serverId, cwd, method })
        .then(() => {
          setPostShipArchiveSuggested(true);
          toastActionSuccess(t("workspace.git.actions.mergePr.success"));
          return;
        })
        .catch((err) => {
          toastActionError(err, t("workspace.git.actions.toasts.failedMergePr"));
        });
    },
    [cwd, persistShipDefault, runMergePr, serverId, t, toastActionError, toastActionSuccess],
  );

  const handleEnablePrAutoMerge = useCallback(
    (method: CheckoutPrMergeMethod) => {
      void persistShipDefault("pr");
      void runEnablePrAutoMerge({ serverId, cwd, method })
        .then(() => {
          toastActionSuccess(t("workspace.git.actions.autoMerge.enabled"));
          return;
        })
        .catch((err) => {
          toastActionError(err, t("workspace.git.actions.toasts.failedEnableAutoMerge"));
        });
    },
    [
      cwd,
      persistShipDefault,
      runEnablePrAutoMerge,
      serverId,
      t,
      toastActionError,
      toastActionSuccess,
    ],
  );

  const handleDisablePrAutoMerge = useCallback(() => {
    void runDisablePrAutoMerge({ serverId, cwd })
      .then(() => {
        toastActionSuccess(t("workspace.git.actions.autoMerge.disabled"));
        return;
      })
      .catch((err) => {
        toastActionError(err, t("workspace.git.actions.toasts.failedDisableAutoMerge"));
      });
  }, [cwd, runDisablePrAutoMerge, serverId, t, toastActionError, toastActionSuccess]);

  const handleMergeBranch = useCallback(() => {
    if (!baseRef) {
      toast.error(t("workspace.git.actions.toasts.baseRefUnavailable"));
      return;
    }
    void persistShipDefault("merge");
    void runMergeBranch({ serverId, cwd, baseRef })
      .then(() => {
        setPostShipArchiveSuggested(true);
        toastActionSuccess(t("workspace.git.actions.mergeBranch.success"));
        return;
      })
      .catch((err) => {
        toastActionError(err, t("workspace.git.actions.toasts.failedMerge"));
      });
  }, [
    baseRef,
    cwd,
    persistShipDefault,
    runMergeBranch,
    serverId,
    t,
    toast,
    toastActionError,
    toastActionSuccess,
  ]);

  const handleMergeFromBase = useCallback(() => {
    if (!baseRef) {
      toast.error(t("workspace.git.actions.toasts.baseRefUnavailable"));
      return;
    }
    void runMergeFromBase({ serverId, cwd, baseRef })
      .then(() => {
        toastActionSuccess(t("workspace.git.actions.mergeFromBase.success"));
        return;
      })
      .catch((err) => {
        toastActionError(err, t("workspace.git.actions.toasts.failedMergeFromBase"));
      });
  }, [baseRef, cwd, runMergeFromBase, serverId, t, toast, toastActionError, toastActionSuccess]);

  const archiveController = useWorkspaceScreenArchiveController({
    serverId,
    activeWorkspaceSelection,
    workspaceDirectory: status?.cwd,
    branchLabel,
    gitStatus,
    t,
  });

  const handleArchiveWorkspace = useCallback(() => {
    archiveController.archive();
  }, [archiveController]);

  const derived = deriveGitActionsState({
    isGit,
    status,
    gitStatus,
    prStatus,
    hasUncommittedChanges,
    postShipArchiveSuggested,
    isStatusLoading,
    isBranchSwitchPending: switchBranchStatus === "pending",
    baseRefLabel,
  });
  const {
    actionsDisabled,
    aheadCount,
    behindBaseCount,
    aheadOfOrigin,
    behindOfOrigin,
    hasPullRequest,
    hasRemote,
    isOttoOwnedWorktree,
    isOnBaseBranch,
    shouldPromoteArchive,
  } = derived;

  const handlePrAction = useCallback(() => {
    if (prStatus?.url) {
      openURLInNewTab(prStatus.url);
      return;
    }
    handleCreatePr();
  }, [prStatus?.url, handleCreatePr]);

  // Build actions
  const gitActionsInput = useMemo<BuildGitActionsInput>(
    () => ({
      isGit,
      githubFeaturesEnabled,
      githubAutoMergeActionsEnabled,
      hasPullRequest,
      pullRequestUrl: prStatus?.url ?? null,
      pullRequestState: narrowPullRequestState(prStatus?.state),
      pullRequestIsDraft: prStatus?.isDraft ?? false,
      pullRequestIsMerged: prStatus?.isMerged ?? false,
      pullRequestMergeable: prStatus?.mergeable ?? "UNKNOWN",
      pullRequestGithub: prStatus?.github ?? null,
      pullRequestHosting: prStatus?.hosting ?? null,
      hostingProvider,
      hasRemote,
      isOttoOwnedWorktree,
      isOnBaseBranch,
      hasUncommittedChanges,
      baseRefAvailable: Boolean(baseRef),
      baseRefLabel,
      aheadCount,
      behindBaseCount,
      aheadOfOrigin,
      behindOfOrigin,
      shouldPromoteArchive,
      shipDefault,
      runtime: {
        commit: {
          disabled: isActionDisabled(actionsDisabled, commitStatus),
          status: commitStatus,
          icon: icons.commit,
          handler: handleCommit,
        },
        pull: {
          disabled: isActionDisabled(actionsDisabled, pullStatus),
          status: pullStatus,
          icon: icons.pull,
          handler: handlePull,
        },
        push: {
          disabled: isActionDisabled(actionsDisabled, pushStatus),
          status: pushStatus,
          icon: icons.push,
          handler: handlePush,
        },
        "pull-and-push": {
          disabled: isActionDisabled(actionsDisabled, pullAndPushStatus),
          status: pullAndPushStatus,
          icon: icons.pullAndPush,
          handler: handlePullAndPush,
        },
        pr: {
          disabled: isActionDisabled(actionsDisabled, prCreateStatus),
          status: hasPullRequest ? "idle" : prCreateStatus,
          icon: hasPullRequest ? icons.viewPr(hostingProvider) : icons.createPr(hostingProvider),
          handler: handlePrAction,
        },
        "merge-pr-squash": {
          disabled: isActionDisabled(actionsDisabled, mergePrStatuses.squash),
          status: mergePrStatuses.squash,
          icon: icons.mergePrSquash(hostingProvider),
          handler: () => handleMergePr("squash"),
        },
        "merge-pr-merge": {
          disabled: isActionDisabled(actionsDisabled, mergePrStatuses.merge),
          status: mergePrStatuses.merge,
          icon: icons.mergePrMerge(hostingProvider),
          handler: () => handleMergePr("merge"),
        },
        "merge-pr-rebase": {
          disabled: isActionDisabled(actionsDisabled, mergePrStatuses.rebase),
          status: mergePrStatuses.rebase,
          icon: icons.mergePrRebase(hostingProvider),
          handler: () => handleMergePr("rebase"),
        },
        "enable-pr-auto-merge-squash": {
          disabled: isActionDisabled(actionsDisabled, enablePrAutoMergeStatuses.squash),
          status: enablePrAutoMergeStatuses.squash,
          icon: icons.mergePrSquash(hostingProvider),
          handler: () => handleEnablePrAutoMerge("squash"),
        },
        "enable-pr-auto-merge-merge": {
          disabled: isActionDisabled(actionsDisabled, enablePrAutoMergeStatuses.merge),
          status: enablePrAutoMergeStatuses.merge,
          icon: icons.mergePrMerge(hostingProvider),
          handler: () => handleEnablePrAutoMerge("merge"),
        },
        "enable-pr-auto-merge-rebase": {
          disabled: isActionDisabled(actionsDisabled, enablePrAutoMergeStatuses.rebase),
          status: enablePrAutoMergeStatuses.rebase,
          icon: icons.mergePrRebase(hostingProvider),
          handler: () => handleEnablePrAutoMerge("rebase"),
        },
        "disable-pr-auto-merge": {
          disabled: isActionDisabled(actionsDisabled, disablePrAutoMergeStatus),
          status: disablePrAutoMergeStatus,
          icon: icons.viewPr(hostingProvider),
          handler: handleDisablePrAutoMerge,
        },
        "merge-branch": {
          disabled: isActionDisabled(actionsDisabled, mergeStatus),
          status: mergeStatus,
          icon: icons.merge,
          handler: handleMergeBranch,
        },
        "merge-from-base": {
          disabled: isActionDisabled(actionsDisabled, mergeFromBaseStatus),
          status: mergeFromBaseStatus,
          icon: icons.mergeFromBase,
          handler: handleMergeFromBase,
        },
        "archive-workspace": {
          disabled: !archiveController.canArchive || archiveController.isArchiving,
          status: archiveController.isArchiving ? "pending" : "idle",
          icon: icons.archive,
          handler: handleArchiveWorkspace,
        },
      },
    }),
    [
      isGit,
      hasRemote,
      hasPullRequest,
      prStatus?.url,
      prStatus?.state,
      prStatus?.isDraft,
      prStatus?.isMerged,
      prStatus?.mergeable,
      prStatus?.github,
      prStatus?.hosting,
      aheadCount,
      behindBaseCount,
      isOttoOwnedWorktree,
      isOnBaseBranch,
      githubFeaturesEnabled,
      githubAutoMergeActionsEnabled,
      hasUncommittedChanges,
      aheadOfOrigin,
      behindOfOrigin,
      shipDefault,
      baseRefLabel,
      shouldPromoteArchive,
      actionsDisabled,
      commitStatus,
      pullStatus,
      pushStatus,
      pullAndPushStatus,
      prCreateStatus,
      mergePrStatuses.squash,
      mergePrStatuses.merge,
      mergePrStatuses.rebase,
      enablePrAutoMergeStatuses.squash,
      enablePrAutoMergeStatuses.merge,
      enablePrAutoMergeStatuses.rebase,
      disablePrAutoMergeStatus,
      mergeStatus,
      mergeFromBaseStatus,
      archiveController.canArchive,
      archiveController.isArchiving,
      handleCommit,
      handlePull,
      handlePush,
      handlePullAndPush,
      handlePrAction,
      handleMergePr,
      handleEnablePrAutoMerge,
      handleDisablePrAutoMerge,
      handleMergeBranch,
      handleMergeFromBase,
      handleArchiveWorkspace,
      icons,
      hostingProvider,
      baseRef,
    ],
  );

  const gitActions: GitActions = useMemo(
    () =>
      translateGitActions(buildGitActions(gitActionsInput), {
        baseRefLabel,
        hasPullRequest,
        hostingProvider,
        t,
      }),
    [gitActionsInput, baseRefLabel, hasPullRequest, hostingProvider, t],
  );

  return { gitActions, branchLabel, isGit };
}

interface TranslateGitActionsInput {
  baseRefLabel: string;
  hasPullRequest: boolean;
  hostingProvider: GitHostingProviderId | null;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function translateGitActions(actions: GitActions, input: TranslateGitActionsInput): GitActions {
  return {
    primary: actions.primary ? translateGitAction(actions.primary, input) : null,
    secondary: actions.secondary.map((action) => translateGitAction(action, input)),
    menu: actions.menu.map((action) => translateGitAction(action, input)),
  };
}

function translateGitAction(action: GitAction, input: TranslateGitActionsInput): GitAction {
  const labels = getTranslatedGitActionLabels(action, input);
  return {
    ...action,
    ...labels,
    unavailableMessage: translateGitActionUnavailableMessage(action.unavailableMessage, input),
  };
}

function getTranslatedGitActionLabels(
  action: GitAction,
  { baseRefLabel, hasPullRequest, t }: TranslateGitActionsInput,
): Pick<GitAction, "label" | "pendingLabel" | "successLabel" | "description"> {
  switch (action.id) {
    case "commit":
      return {
        label: t("workspace.git.actions.commit.label"),
        pendingLabel: t("workspace.git.actions.commit.pending"),
        successLabel: t("workspace.git.actions.commit.success"),
        description: t("workspace.git.actions.commit.description"),
      };
    case "pull":
      return {
        label: t("workspace.git.actions.pull.label"),
        pendingLabel: t("workspace.git.actions.pull.pending"),
        successLabel: t("workspace.git.actions.pull.success"),
        description: t("workspace.git.actions.pull.description"),
      };
    case "push":
      return {
        label: t("workspace.git.actions.push.label"),
        pendingLabel: t("workspace.git.actions.push.pending"),
        successLabel: t("workspace.git.actions.push.success"),
        description: t("workspace.git.actions.push.description"),
      };
    case "pull-and-push":
      return {
        label: t("workspace.git.actions.pullAndPush.label"),
        pendingLabel: t("workspace.git.actions.pullAndPush.pending"),
        successLabel: t("workspace.git.actions.pullAndPush.success"),
        description: t("workspace.git.actions.pullAndPush.description"),
      };
    case "pr":
      return hasPullRequest
        ? {
            label: t("workspace.git.actions.viewPr"),
            pendingLabel: t("workspace.git.actions.viewPr"),
            successLabel: t("workspace.git.actions.viewPr"),
            description: t("workspace.git.actions.viewPrDescription"),
          }
        : {
            label: t("workspace.git.actions.createPr.label"),
            pendingLabel: t("workspace.git.actions.createPr.pending"),
            successLabel: t("workspace.git.actions.createPr.success"),
            description: t("workspace.git.actions.createPr.description", {
              baseRef: baseRefLabel,
            }),
          };
    case "merge-pr-squash":
      return {
        label: t("workspace.git.actions.mergePr.squash"),
        pendingLabel: t("workspace.git.actions.mergePr.pending"),
        successLabel: t("workspace.git.actions.mergePr.success"),
        description: t("workspace.git.actions.mergePr.squashDescription"),
      };
    case "merge-pr-merge":
      return {
        label: t("workspace.git.actions.mergePr.merge"),
        pendingLabel: t("workspace.git.actions.mergePr.pending"),
        successLabel: t("workspace.git.actions.mergePr.success"),
        description: t("workspace.git.actions.mergePr.mergeDescription"),
      };
    case "merge-pr-rebase":
      return {
        label: t("workspace.git.actions.mergePr.rebase"),
        pendingLabel: t("workspace.git.actions.mergePr.pending"),
        successLabel: t("workspace.git.actions.mergePr.success"),
        description: t("workspace.git.actions.mergePr.rebaseDescription"),
      };
    case "enable-pr-auto-merge-squash":
      return {
        label: t("workspace.git.actions.autoMerge.enableSquash"),
        pendingLabel: t("workspace.git.actions.autoMerge.enabling"),
        successLabel: t("workspace.git.actions.autoMerge.enabled"),
        description: t("workspace.git.actions.autoMerge.enableDescription"),
      };
    case "enable-pr-auto-merge-merge":
      return {
        label: t("workspace.git.actions.autoMerge.enableMerge"),
        pendingLabel: t("workspace.git.actions.autoMerge.enabling"),
        successLabel: t("workspace.git.actions.autoMerge.enabled"),
        description: t("workspace.git.actions.autoMerge.enableDescription"),
      };
    case "enable-pr-auto-merge-rebase":
      return {
        label: t("workspace.git.actions.autoMerge.enableRebase"),
        pendingLabel: t("workspace.git.actions.autoMerge.enabling"),
        successLabel: t("workspace.git.actions.autoMerge.enabled"),
        description: t("workspace.git.actions.autoMerge.enableDescription"),
      };
    case "disable-pr-auto-merge":
      return {
        label: t("workspace.git.actions.autoMerge.enabled"),
        pendingLabel: t("workspace.git.actions.autoMerge.disabling"),
        successLabel: t("workspace.git.actions.autoMerge.disabled"),
        description: t("workspace.git.actions.autoMerge.disableDescription"),
      };
    case "merge-branch":
      return {
        label: t("workspace.git.actions.mergeBranch.label", { baseRef: baseRefLabel }),
        pendingLabel: t("workspace.git.actions.mergeBranch.pending"),
        successLabel: t("workspace.git.actions.mergeBranch.success"),
        description: t("workspace.git.actions.mergeBranch.description", {
          baseRef: baseRefLabel,
        }),
      };
    case "merge-from-base":
      return {
        label: t("workspace.git.actions.mergeFromBase.label", { baseRef: baseRefLabel }),
        pendingLabel: t("workspace.git.actions.mergeFromBase.pending"),
        successLabel: t("workspace.git.actions.mergeFromBase.success"),
        description: t("workspace.git.actions.mergeFromBase.description", {
          baseRef: baseRefLabel,
        }),
      };
    case "archive-workspace":
      return {
        label: t("workspace.git.actions.archive.label"),
        pendingLabel: t("workspace.git.actions.archive.pending"),
        successLabel: t("workspace.git.actions.archive.success"),
        description: t("workspace.git.actions.archive.description"),
      };
  }
}

function translateGitActionUnavailableMessage(
  message: string | undefined,
  { baseRefLabel, hostingProvider, t }: TranslateGitActionsInput,
): string | undefined {
  if (!message) return undefined;
  const keyByMessage: Record<string, string> = {
    "Pull isn't available here because this branch is not connected to a remote yet":
      "workspace.git.actions.unavailable.pullNoRemote",
    "Pull isn't available while you have local changes so commit or stash them first":
      "workspace.git.actions.unavailable.pullDirty",
    "Pull isn't available because this branch is already up to date":
      "workspace.git.actions.unavailable.pullUpToDate",
    "Push isn't available here because this branch is not connected to a remote yet":
      "workspace.git.actions.unavailable.pushNoRemote",
    "Push isn't available yet because there are newer changes to bring in first":
      "workspace.git.actions.unavailable.pushBehind",
    "Push isn't available because there is nothing new to send":
      "workspace.git.actions.unavailable.pushNothing",
    "Pull and push isn't available here because this branch is not connected to a remote yet":
      "workspace.git.actions.unavailable.pullAndPushNoRemote",
    "Pull and push isn't available while you have local changes so commit or stash them first":
      "workspace.git.actions.unavailable.pullAndPushDirty",
    "Pull and push isn't available because this branch is already in sync":
      "workspace.git.actions.unavailable.pullAndPushInSync",
    "Create PR isn't available because this branch doesn't have any new commits yet":
      "workspace.git.actions.unavailable.createPrNoCommits",
    "Merge isn't available because we couldn't determine the base branch":
      "workspace.git.actions.unavailable.mergeNoBase",
    "Merge isn't available while you have local changes so commit or stash them first":
      "workspace.git.actions.unavailable.mergeDirty",
    "Merge isn't available because this branch doesn't have anything new to merge yet":
      "workspace.git.actions.unavailable.mergeNothing",
    "Update isn't available because we couldn't determine the base branch":
      "workspace.git.actions.unavailable.updateNoBase",
    "Update isn't available while you have local changes so commit or stash them first":
      "workspace.git.actions.unavailable.updateDirty",
    "Merge PR isn't available because there isn't a pull request yet":
      "workspace.git.actions.unavailable.mergePrMissing",
    "Merge PR isn't available because the pull request is still a draft":
      "workspace.git.actions.unavailable.mergePrDraft",
    "Merge PR isn't available because the pull request is already merged":
      "workspace.git.actions.unavailable.mergePrMerged",
    "Merge PR isn't available because the pull request is closed":
      "workspace.git.actions.unavailable.mergePrClosed",
    "Merge PR isn't available because the pull request has conflicts":
      "workspace.git.actions.unavailable.mergePrConflicts",
    "Merge PR isn't available here because this repository uses a merge queue":
      "workspace.git.actions.unavailable.mergePrQueue",
    "Merge PR isn't available until GitHub reports the pull request is ready to merge":
      "workspace.git.actions.unavailable.mergePrNotReady",
    "Auto-merge is enabled, but this account can't disable it":
      "workspace.git.actions.unavailable.autoMergeCannotDisable",
  };
  if (
    message.startsWith("Update isn't available because this branch is already up to date with ")
  ) {
    return t("workspace.git.actions.unavailable.updateCurrent", { baseRef: baseRefLabel });
  }
  // The "<provider> isn't connected" messages carry the workspace's hosting
  // provider name, so they match by their invariant prefix instead of the
  // full string.
  const providerName = getGitHostingProviderDisplayName(hostingProvider);
  if (message.startsWith("View PR isn't available right now because ")) {
    return t("workspace.git.actions.unavailable.viewPrNoGithub", { provider: providerName });
  }
  if (message.startsWith("Create PR isn't available right now because ")) {
    return t("workspace.git.actions.unavailable.createPrNoGithub", { provider: providerName });
  }
  if (message.startsWith("Merge PR isn't available right now because ")) {
    return t("workspace.git.actions.unavailable.mergePrNoGithub", { provider: providerName });
  }
  const key = keyByMessage[message];
  return key ? t(key) : message;
}

function getWorktreeArchiveWarningLabels(
  t: (key: string, options?: Record<string, unknown>) => string,
): WorktreeArchiveWarningLabels {
  return {
    title: (workspaceName) => t("workspace.git.actions.archiveWarning.title", { workspaceName }),
    confirm: t("workspace.git.actions.archiveWarning.confirm"),
    cancel: t("workspace.git.actions.archiveWarning.cancel"),
    uncommittedChanges: t("workspace.git.actions.archiveWarning.uncommittedChanges"),
    uncommittedChangesWithDiff: (diffStat) =>
      t("workspace.git.actions.archiveWarning.uncommittedChangesWithDiff", { diffStat }),
    addedLine: (count) =>
      t(
        count === 1
          ? "workspace.git.actions.archiveWarning.addedLine"
          : "workspace.git.actions.archiveWarning.addedLines",
        { count },
      ),
    deletedLine: (count) =>
      t(
        count === 1
          ? "workspace.git.actions.archiveWarning.deletedLine"
          : "workspace.git.actions.archiveWarning.deletedLines",
        { count },
      ),
    unpushedCommit: (count) =>
      t(
        count === 1
          ? "workspace.git.actions.archiveWarning.unpushedCommit"
          : "workspace.git.actions.archiveWarning.unpushedCommits",
        { count },
      ),
  };
}
