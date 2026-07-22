import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useToast } from "@/contexts/toast-context";
import {
  buildWorktreeArchiveBranchDialog,
  canOfferBranchDeletion,
  confirmRiskyWorktreeArchive,
  DEFAULT_WORKTREE_ARCHIVE_WARNING_LABELS,
  type WorktreeArchiveBranchLabels,
  type WorktreeArchiveWarningLabels,
} from "@/git/worktree-archive-warning";
import type { WorktreeArchiveBranchDetection } from "@otto-code/protocol/messages";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import {
  buildWorkspaceTabPersistenceKey,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { useWorkspaceTabsStore } from "@/stores/workspace-tabs-store";
import { confirmDialogWithCheckbox } from "@/utils/confirm-dialog";
import { archiveWorkspaceOptimistically } from "@/workspace/workspace-archive";

function purgeArchivedWorkspaceState(input: { serverId: string; workspaceId: string }): void {
  const workspaceKey = buildWorkspaceTabPersistenceKey(input);
  if (workspaceKey) {
    useWorkspaceLayoutStore.getState().purgeWorkspace(workspaceKey);
  }
  useWorkspaceTabsStore.getState().purgeWorkspace(input);
}

export interface ArchiveWorkspaceInput {
  serverId: string;
  workspaceId: string;
  workspaceKind: WorkspaceDescriptor["workspaceKind"];
  name: string;
  isDirty?: boolean | null;
  aheadOfOrigin?: number | null;
  diffStat?: { additions: number; deletions: number } | null;
  warningLabels?: WorktreeArchiveWarningLabels;
  onArchiveStarted: () => void;
  onSetHiding?: (hiding: boolean) => void;
}

export interface WorkspaceArchiveController {
  archive: () => void;
}

// Resolves to "keep" | "delete" | null. null means the user cancelled.
type BranchDecision = "keep" | "delete" | null;

export function useWorkspaceArchive(input: ArchiveWorkspaceInput): WorkspaceArchiveController {
  const {
    serverId,
    workspaceId,
    workspaceKind,
    name,
    isDirty,
    aheadOfOrigin,
    diffStat,
    warningLabels = DEFAULT_WORKTREE_ARCHIVE_WARNING_LABELS,
    onArchiveStarted,
    onSetHiding,
  } = input;
  const { t } = useTranslation();
  const toast = useToast();

  const branchCleanupEnabled = useSessionStore(
    (state) =>
      state.sessions[serverId]?.serverInfo?.features?.worktreeArchiveBranchCleanup === true,
  );

  const branchLabels = useMemo<WorktreeArchiveBranchLabels>(
    () => ({
      intro: (branchName) => t("workspace.git.actions.archiveWarning.branchIntro", { branchName }),
      deleteCheckbox: (branchName) =>
        t("workspace.git.actions.archiveWarning.deleteBranchCheckbox", { branchName }),
      merged: (baseBranch) =>
        baseBranch
          ? t("workspace.git.actions.archiveWarning.branchMerged", { baseBranch })
          : t("workspace.git.actions.archiveWarning.branchMergedNoBase"),
      unmerged: (count, baseBranch) =>
        baseBranch
          ? t(
              count === 1
                ? "workspace.git.actions.archiveWarning.branchUnmergedCommit"
                : "workspace.git.actions.archiveWarning.branchUnmergedCommits",
              { count, baseBranch },
            )
          : t(
              count === 1
                ? "workspace.git.actions.archiveWarning.branchUnmergedCommitNoBase"
                : "workspace.git.actions.archiveWarning.branchUnmergedCommitsNoBase",
              { count },
            ),
      unknown: t("workspace.git.actions.archiveWarning.branchMergeUnknown"),
      remoteKept: t("workspace.git.actions.archiveWarning.branchRemoteKept"),
    }),
    [t],
  );

  const archiveWorkspaceRecord = useCallback(
    async (branchDisposition: "keep" | "delete") => {
      const client = getHostRuntimeStore().getClient(serverId);
      if (!client) {
        toast.error(t("sidebar.workspace.toasts.hostDisconnected"));
        return;
      }
      onSetHiding?.(true);
      try {
        onArchiveStarted();
        const { deletedBranch } = await archiveWorkspaceOptimistically({
          client,
          workspace: { serverId, workspaceId },
          branchDisposition,
        });
        purgeArchivedWorkspaceState({ serverId, workspaceId });
        if (branchDisposition === "delete") {
          if (deletedBranch) {
            toast.show(
              t("workspace.git.actions.archiveWarning.branchDeleted", {
                branchName: deletedBranch,
              }),
            );
          }
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : t("sidebar.workspace.toasts.archiveFailed"),
        );
      } finally {
        onSetHiding?.(false);
      }
    },
    [onArchiveStarted, onSetHiding, serverId, t, toast, workspaceId],
  );

  // Detect (preflight) → confirm (combined dialog with a delete-branch checkbox)
  // for worktree workspaces on a capable daemon. Returns the chosen disposition,
  // or null if the user cancelled.
  const confirmWithBranchCleanup = useCallback(async (): Promise<BranchDecision> => {
    const client = getHostRuntimeStore().getClient(serverId);
    let detection: WorktreeArchiveBranchDetection | null = null;
    if (client) {
      try {
        const payload = await client.workspaceArchivePreflight(workspaceId);
        detection = payload.detection;
      } catch {
        detection = null;
      }
    }

    if (!canOfferBranchDeletion(detection) || !detection) {
      // No leftover branch to clean up — fall back to the plain risk warning.
      const confirmed = await confirmRiskyWorktreeArchive(
        { workspaceName: name, isDirty, aheadOfOrigin, diffStat },
        warningLabels,
      );
      return confirmed ? "keep" : null;
    }

    const dialog = buildWorktreeArchiveBranchDialog({
      detection,
      risk: { isDirty, aheadOfOrigin, diffStat },
      riskLabels: warningLabels,
      branchLabels,
    });
    const result = await confirmDialogWithCheckbox({
      title: warningLabels.title(name),
      message: dialog.message,
      confirmLabel: warningLabels.confirm,
      cancelLabel: warningLabels.cancel,
      destructive: true,
      checkboxLabel: dialog.checkboxLabel,
      checkboxDefaultChecked: dialog.checkboxDefaultChecked,
    });
    if (!result.confirmed) {
      return null;
    }
    return result.checkboxChecked ? "delete" : "keep";
  }, [aheadOfOrigin, branchLabels, diffStat, isDirty, name, serverId, warningLabels, workspaceId]);

  const archive = useCallback(() => {
    void (async () => {
      let branchDisposition: "keep" | "delete" = "keep";
      if (workspaceKind === "worktree") {
        if (branchCleanupEnabled) {
          const decision = await confirmWithBranchCleanup();
          if (decision === null) {
            return;
          }
          branchDisposition = decision;
        } else {
          const confirmed = await confirmRiskyWorktreeArchive(
            { workspaceName: name, isDirty, aheadOfOrigin, diffStat },
            warningLabels,
          );
          if (!confirmed) {
            return;
          }
        }
      }
      await archiveWorkspaceRecord(branchDisposition);
    })();
  }, [
    aheadOfOrigin,
    archiveWorkspaceRecord,
    branchCleanupEnabled,
    confirmWithBranchCleanup,
    diffStat,
    isDirty,
    name,
    warningLabels,
    workspaceKind,
  ]);

  return {
    archive,
  };
}
