import { describe, expect, it } from "vitest";

import type { WorktreeArchiveBranchDetection } from "@otto-code/protocol/messages";
import {
  buildWorktreeArchiveBranchDialog,
  buildWorktreeArchiveConfirmationMessage,
  buildWorktreeArchiveRiskReasons,
  canOfferBranchDeletion,
  toWorktreeArchiveRisk,
  type WorktreeArchiveBranchLabels,
} from "@/git/worktree-archive-warning";

function detection(
  overrides?: Partial<WorktreeArchiveBranchDetection>,
): WorktreeArchiveBranchDetection {
  return {
    isOttoWorktree: true,
    branchName: "feature/thing",
    baseBranch: "main",
    mergeState: "merged",
    unmergedCommitCount: 0,
    hasRemoteBranch: false,
    branchCheckedOutElsewhere: false,
    directoryWillBeRemoved: true,
    ...overrides,
  };
}

const TEST_BRANCH_LABELS: WorktreeArchiveBranchLabels = {
  intro: (branchName) => `On branch ${branchName}.`,
  deleteCheckbox: (branchName) => `Delete ${branchName}`,
  merged: (baseBranch) => (baseBranch ? `Merged into ${baseBranch}.` : "Merged."),
  unmerged: (count, baseBranch) =>
    baseBranch ? `Not merged into ${baseBranch} (${count}).` : `Not merged (${count}).`,
  unknown: "Merge status unknown.",
  remoteKept: "Remote kept.",
};

describe("workspace archive warning for worktree backing", () => {
  it("does not require a confirmation for clean and pushed worktrees", () => {
    expect(
      buildWorktreeArchiveConfirmationMessage({
        workspaceName: "feature",
        isDirty: false,
        aheadOfOrigin: 0,
        diffStat: null,
      }),
    ).toBeNull();
  });

  it("explains uncommitted line changes", () => {
    expect(
      buildWorktreeArchiveRiskReasons({
        isDirty: true,
        aheadOfOrigin: 0,
        diffStat: { additions: 12, deletions: 1 },
      }),
    ).toEqual(["Uncommitted changes (12 added lines, 1 deleted line)"]);
  });

  it("treats nonzero diff stats as dirty when dirty state is missing", () => {
    expect(
      buildWorktreeArchiveRiskReasons({
        isDirty: undefined,
        aheadOfOrigin: 0,
        diffStat: { additions: 4, deletions: 0 },
      }),
    ).toEqual(["Uncommitted changes (4 added lines)"]);
  });

  it("explains unpushed commits", () => {
    expect(
      buildWorktreeArchiveRiskReasons({
        isDirty: false,
        aheadOfOrigin: 2,
        diffStat: null,
      }),
    ).toEqual(["2 unpushed commits"]);
  });

  it("includes every archive risk in the confirmation copy", () => {
    expect(
      buildWorktreeArchiveConfirmationMessage({
        workspaceName: "risky-feature",
        isDirty: true,
        aheadOfOrigin: 1,
        diffStat: { additions: 1, deletions: 3 },
      }),
    ).toBe("Uncommitted changes (1 added line, 3 deleted lines)\n1 unpushed commit");
  });

  it("offers branch deletion only for an owned, removable, exclusively-checked-out branch", () => {
    expect(canOfferBranchDeletion(detection())).toBe(true);
    expect(canOfferBranchDeletion(null)).toBe(false);
    expect(canOfferBranchDeletion(detection({ isOttoWorktree: false }))).toBe(false);
    expect(canOfferBranchDeletion(detection({ branchName: null }))).toBe(false);
    expect(canOfferBranchDeletion(detection({ directoryWillBeRemoved: false }))).toBe(false);
    expect(canOfferBranchDeletion(detection({ branchCheckedOutElsewhere: true }))).toBe(false);
  });

  it("defaults a merged branch to deletion and describes it", () => {
    const dialog = buildWorktreeArchiveBranchDialog({
      detection: detection({ hasRemoteBranch: true }),
      risk: { isDirty: false, aheadOfOrigin: 0, diffStat: null },
      branchLabels: TEST_BRANCH_LABELS,
    });

    expect(dialog.checkboxDefaultChecked).toBe(true);
    expect(dialog.checkboxLabel).toBe("Delete feature/thing");
    expect(dialog.message).toBe("On branch feature/thing.\nMerged into main.\nRemote kept.");
  });

  it("defaults an unmerged branch to keep and leads with the risk reasons", () => {
    const dialog = buildWorktreeArchiveBranchDialog({
      detection: detection({ mergeState: "unmerged", unmergedCommitCount: 3 }),
      risk: { isDirty: true, aheadOfOrigin: 0, diffStat: null },
      branchLabels: TEST_BRANCH_LABELS,
    });

    expect(dialog.checkboxDefaultChecked).toBe(false);
    expect(dialog.message).toBe(
      "Uncommitted changes\n\nOn branch feature/thing.\nNot merged into main (3).",
    );
  });

  it("maps archive workspace fields into the shared worktree risk shape", () => {
    expect(
      toWorktreeArchiveRisk({
        archiveHasUncommittedChanges: true,
        archiveUnpushedCommitCount: 3,
        diffStat: { additions: 2, deletions: 1 },
      }),
    ).toEqual({
      isDirty: true,
      aheadOfOrigin: 3,
      diffStat: { additions: 2, deletions: 1 },
    });
  });
});
