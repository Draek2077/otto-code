import type { WorktreeArchiveBranchDetection } from "@otto-code/protocol/messages";
import { confirmDialog } from "@/utils/confirm-dialog";
import { i18n } from "@/i18n/i18next";

export interface WorktreeArchiveRisk {
  isDirty?: boolean | null;
  aheadOfOrigin?: number | null;
  diffStat?: { additions: number; deletions: number } | null;
}

export interface WorktreeArchiveRiskInput {
  archiveHasUncommittedChanges?: boolean | null;
  archiveUnpushedCommitCount?: number | null;
  diffStat?: WorktreeArchiveRisk["diffStat"];
}

export interface WorktreeArchiveConfirmationInput extends WorktreeArchiveRisk {
  workspaceName: string;
}

export interface WorktreeArchiveWarningLabels {
  title: (workspaceName: string) => string;
  confirm: string;
  cancel: string;
  uncommittedChanges: string;
  uncommittedChangesWithDiff: (diffStat: string) => string;
  addedLine: (count: number) => string;
  deletedLine: (count: number) => string;
  unpushedCommit: (count: number) => string;
}

export const DEFAULT_WORKTREE_ARCHIVE_WARNING_LABELS: WorktreeArchiveWarningLabels = {
  title: (workspaceName) => i18n.t("workspace.git.actions.archiveWarning.title", { workspaceName }),
  confirm: i18n.t("workspace.git.actions.archiveWarning.confirm"),
  cancel: i18n.t("workspace.git.actions.archiveWarning.cancel"),
  uncommittedChanges: i18n.t("workspace.git.actions.archiveWarning.uncommittedChanges"),
  uncommittedChangesWithDiff: (diffStat) =>
    i18n.t("workspace.git.actions.archiveWarning.uncommittedChangesWithDiff", { diffStat }),
  addedLine: (count) =>
    count === 1
      ? i18n.t("workspace.git.actions.archiveWarning.addedLine", { count })
      : i18n.t("workspace.git.actions.archiveWarning.addedLines", { count }),
  deletedLine: (count) =>
    count === 1
      ? i18n.t("workspace.git.actions.archiveWarning.deletedLine", { count })
      : i18n.t("workspace.git.actions.archiveWarning.deletedLines", { count }),
  unpushedCommit: (count) =>
    count === 1
      ? i18n.t("workspace.git.actions.archiveWarning.unpushedCommit", { count })
      : i18n.t("workspace.git.actions.archiveWarning.unpushedCommits", { count }),
};

export function toWorktreeArchiveRisk(input: WorktreeArchiveRiskInput): WorktreeArchiveRisk {
  return {
    isDirty: input.archiveHasUncommittedChanges,
    aheadOfOrigin: input.archiveUnpushedCommitCount,
    diffStat: input.diffStat,
  };
}

function formatDiffStat(
  diffStat: WorktreeArchiveRisk["diffStat"],
  labels: WorktreeArchiveWarningLabels,
): string | null {
  if (!diffStat) {
    return null;
  }

  const parts: string[] = [];
  if (diffStat.additions > 0) {
    parts.push(labels.addedLine(diffStat.additions));
  }
  if (diffStat.deletions > 0) {
    parts.push(labels.deletedLine(diffStat.deletions));
  }

  return parts.length > 0 ? parts.join(", ") : null;
}

export function buildWorktreeArchiveRiskReasons(
  input: WorktreeArchiveRisk,
  labels: WorktreeArchiveWarningLabels = DEFAULT_WORKTREE_ARCHIVE_WARNING_LABELS,
): string[] {
  const reasons: string[] = [];
  const diffStat = input.diffStat;
  const hasDiffStatChanges = diffStat ? diffStat.additions > 0 || diffStat.deletions > 0 : false;
  const hasUncommittedChanges =
    input.isDirty === true || (input.isDirty == null && hasDiffStatChanges);

  if (hasUncommittedChanges) {
    const diffStatLabel = formatDiffStat(diffStat, labels);
    reasons.push(
      diffStatLabel ? labels.uncommittedChangesWithDiff(diffStatLabel) : labels.uncommittedChanges,
    );
  }

  if ((input.aheadOfOrigin ?? 0) > 0) {
    const aheadOfOrigin = input.aheadOfOrigin ?? 0;
    reasons.push(labels.unpushedCommit(aheadOfOrigin));
  }

  return reasons;
}

export function buildWorktreeArchiveConfirmationMessage(
  input: WorktreeArchiveConfirmationInput,
  labels: WorktreeArchiveWarningLabels = DEFAULT_WORKTREE_ARCHIVE_WARNING_LABELS,
): string | null {
  const reasons = buildWorktreeArchiveRiskReasons(input, labels);
  if (reasons.length === 0) {
    return null;
  }

  return reasons.join("\n");
}

// ---------------------------------------------------------------------------
// Leftover-branch cleanup (server_info.features.worktreeArchiveBranchCleanup)
// ---------------------------------------------------------------------------

export interface WorktreeArchiveBranchLabels {
  intro: (branchName: string) => string;
  deleteCheckbox: (branchName: string) => string;
  merged: (baseBranch: string | null) => string;
  unmerged: (count: number, baseBranch: string | null) => string;
  unknown: string;
  remoteKept: string;
}

// True when the detection describes an Otto-owned worktree branch we can
// actually delete once the workspace is archived: it exists, the backing
// directory is going away, and the branch is not also checked out elsewhere.
export function canOfferBranchDeletion(
  detection: WorktreeArchiveBranchDetection | null | undefined,
): boolean {
  return Boolean(
    detection?.isOttoWorktree &&
    detection.branchName &&
    detection.directoryWillBeRemoved &&
    !detection.branchCheckedOutElsewhere,
  );
}

function buildBranchContextLine(
  detection: WorktreeArchiveBranchDetection,
  labels: WorktreeArchiveBranchLabels,
): string {
  if (detection.mergeState === "merged") {
    return labels.merged(detection.baseBranch);
  }
  if (detection.mergeState === "unmerged") {
    return labels.unmerged(detection.unmergedCommitCount ?? 0, detection.baseBranch);
  }
  return labels.unknown;
}

export interface WorktreeArchiveBranchDialogContent {
  message: string;
  checkboxLabel: string;
  // Merged branches default to "delete" — the leftover is safe to remove; every
  // other state defaults to "keep" so commits are never discarded by inertia.
  checkboxDefaultChecked: boolean;
}

export function buildWorktreeArchiveBranchDialog(input: {
  detection: WorktreeArchiveBranchDetection;
  risk: WorktreeArchiveRisk;
  riskLabels?: WorktreeArchiveWarningLabels;
  branchLabels: WorktreeArchiveBranchLabels;
}): WorktreeArchiveBranchDialogContent {
  const branchName = input.detection.branchName ?? "";
  const lines: string[] = [];
  const riskReasons = buildWorktreeArchiveRiskReasons(
    input.risk,
    input.riskLabels ?? DEFAULT_WORKTREE_ARCHIVE_WARNING_LABELS,
  );
  if (riskReasons.length > 0) {
    lines.push(...riskReasons, "");
  }
  lines.push(input.branchLabels.intro(branchName));
  lines.push(buildBranchContextLine(input.detection, input.branchLabels));
  if (input.detection.hasRemoteBranch) {
    lines.push(input.branchLabels.remoteKept);
  }
  return {
    message: lines.join("\n"),
    checkboxLabel: input.branchLabels.deleteCheckbox(branchName),
    checkboxDefaultChecked: input.detection.mergeState === "merged",
  };
}

export async function confirmRiskyWorktreeArchive(
  input: WorktreeArchiveConfirmationInput,
  labels: WorktreeArchiveWarningLabels = DEFAULT_WORKTREE_ARCHIVE_WARNING_LABELS,
): Promise<boolean> {
  const message = buildWorktreeArchiveConfirmationMessage(input, labels);
  if (!message) {
    return true;
  }

  return await confirmDialog({
    title: labels.title(input.workspaceName),
    message,
    confirmLabel: labels.confirm,
    cancelLabel: labels.cancel,
    destructive: true,
  });
}
