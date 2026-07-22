import { describe, expect, it } from "vitest";

import { buildReattachCandidates } from "./worktree-reattach.js";
import type { PersistedWorkspaceRecord } from "./workspace-registry.js";

function workspace(overrides: Partial<PersistedWorkspaceRecord>): PersistedWorkspaceRecord {
  return {
    workspaceId: "wks_1",
    projectId: "proj",
    cwd: "/wt/a",
    kind: "worktree",
    displayName: "a",
    title: null,
    branch: "feature/a",
    baseBranch: "main",
    hidden: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

const noBase = () => null;

describe("buildReattachCandidates", () => {
  it("surfaces an archived worktree workspace whose directory still exists", () => {
    const candidates = buildReattachCandidates({
      worktreeWorkspaces: [workspace({ workspaceId: "wks_a", cwd: "/wt/a" })],
      onDiskWorktrees: [{ path: "/wt/a", branchName: "feature/a" }],
      readBaseBranch: noBase,
    });
    expect(candidates).toEqual([
      {
        workspaceId: "wks_a",
        worktreePath: "/wt/a",
        branchName: "feature/a",
        baseBranch: "main",
        directoryOnDisk: true,
        displayName: "a",
        archivedAt: "2026-01-02T00:00:00.000Z",
      },
    ]);
  });

  it("marks an archived worktree whose directory was deleted as recreatable", () => {
    const candidates = buildReattachCandidates({
      worktreeWorkspaces: [workspace({ workspaceId: "wks_a", cwd: "/wt/a" })],
      onDiskWorktrees: [],
      readBaseBranch: noBase,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ workspaceId: "wks_a", directoryOnDisk: false });
  });

  it("excludes active worktree workspaces — they are already live", () => {
    const candidates = buildReattachCandidates({
      worktreeWorkspaces: [workspace({ workspaceId: "wks_a", cwd: "/wt/a", archivedAt: null })],
      onDiskWorktrees: [{ path: "/wt/a", branchName: "feature/a" }],
      readBaseBranch: noBase,
    });
    expect(candidates).toEqual([]);
  });

  it("excludes an archived worktree workspace that has no branch to recreate from", () => {
    const candidates = buildReattachCandidates({
      worktreeWorkspaces: [workspace({ workspaceId: "wks_a", cwd: "/wt/a", branch: null })],
      onDiskWorktrees: [],
      readBaseBranch: noBase,
    });
    expect(candidates).toEqual([]);
  });

  it("surfaces an orphaned on-disk worktree with no workspace record", () => {
    const candidates = buildReattachCandidates({
      worktreeWorkspaces: [],
      onDiskWorktrees: [{ path: "/wt/orphan", branchName: "feature/orphan" }],
      readBaseBranch: (path) => (path === "/wt/orphan" ? "develop" : null),
    });
    expect(candidates).toEqual([
      {
        workspaceId: null,
        worktreePath: "/wt/orphan",
        branchName: "feature/orphan",
        baseBranch: "develop",
        directoryOnDisk: true,
        displayName: null,
        archivedAt: null,
      },
    ]);
  });

  it("does not treat an on-disk worktree with a record (active or archived) as an orphan", () => {
    const candidates = buildReattachCandidates({
      worktreeWorkspaces: [
        workspace({ workspaceId: "wks_active", cwd: "/wt/live", archivedAt: null }),
      ],
      onDiskWorktrees: [{ path: "/wt/live", branchName: "feature/live" }],
      readBaseBranch: noBase,
    });
    // Active record is excluded, and the on-disk dir it backs is not an orphan.
    expect(candidates).toEqual([]);
  });
});
