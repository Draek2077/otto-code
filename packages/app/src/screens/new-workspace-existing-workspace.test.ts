import { describe, expect, test } from "vitest";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import {
  findWorkspaceById,
  findWorkspaceForDirectory,
  findWorkspaceForProject,
} from "./new-workspace-existing-workspace";

const PROJECT_ROOT = "/repos/otto";

function workspace(overrides: Partial<WorkspaceDescriptor>): WorkspaceDescriptor {
  return {
    id: "wks_1",
    projectId: "proj_otto",
    projectDisplayName: "otto",
    projectCustomName: null,
    projectRootPath: PROJECT_ROOT,
    workspaceDirectory: PROJECT_ROOT,
    projectKind: "git",
    workspaceKind: "local",
    name: "otto",
    title: null,
    status: "idle",
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    scripts: [],
    ...overrides,
  } as WorkspaceDescriptor;
}

describe("findWorkspaceForDirectory", () => {
  test("matches the workspace whose own directory is the one asked about", () => {
    const root = workspace({ id: "wks_root" });
    const worktree = workspace({
      id: "wks_worktree",
      workspaceDirectory: "/repos/otto/.otto/worktrees/feature",
      workspaceKind: "worktree",
    });

    const found = findWorkspaceForDirectory({
      workspaces: [worktree, root],
      directory: PROJECT_ROOT,
    });

    expect(found?.id).toBe("wks_root");
  });

  test("does not match a worktree by its project root", () => {
    const worktree = workspace({
      id: "wks_worktree",
      workspaceDirectory: "/repos/otto/.otto/worktrees/feature",
      workspaceKind: "worktree",
    });

    const found = findWorkspaceForDirectory({
      workspaces: [worktree],
      directory: PROJECT_ROOT,
    });

    // Directory ownership is the question here, and the worktree does not own the
    // root. Widening this would make the occupied-directory steer offer to open a
    // workspace the daemon never refused on.
    expect(found).toBeNull();
  });

  test("normalizes separators so a Windows path matches its stored form", () => {
    const found = findWorkspaceForDirectory({
      workspaces: [workspace({ id: "wks_root", workspaceDirectory: "C:/repos/otto" })],
      directory: "C:\\repos\\otto",
    });

    expect(found?.id).toBe("wks_root");
  });

  test("returns null for an empty directory rather than matching a directoryless workspace", () => {
    const found = findWorkspaceForDirectory({
      workspaces: [workspace({ id: "wks_empty", workspaceDirectory: "" })],
      directory: "",
    });

    expect(found).toBeNull();
  });

  test("returns null when there are no workspaces at all", () => {
    expect(
      findWorkspaceForDirectory({ workspaces: undefined, directory: PROJECT_ROOT }),
    ).toBeNull();
  });
});

describe("findWorkspaceForProject", () => {
  test("prefers the workspace rooted at the project root", () => {
    const worktree = workspace({
      id: "wks_worktree",
      workspaceDirectory: "/repos/otto/.otto/worktrees/feature",
      workspaceKind: "worktree",
    });
    const root = workspace({ id: "wks_root" });

    const found = findWorkspaceForProject({
      workspaces: [worktree, root],
      sourceDirectory: PROJECT_ROOT,
    });

    expect(found?.id).toBe("wks_root");
  });

  test("falls back to a worktree when the project has nothing at its root", () => {
    // The regression: reading a README used to create a whole extra workspace
    // here, because the root was unoccupied so creation succeeded.
    const worktree = workspace({
      id: "wks_worktree",
      workspaceDirectory: "/repos/otto/.otto/worktrees/feature",
      workspaceKind: "worktree",
    });

    const found = findWorkspaceForProject({
      workspaces: [worktree],
      sourceDirectory: PROJECT_ROOT,
    });

    expect(found?.id).toBe("wks_worktree");
  });

  test("skips workspaces being archived", () => {
    const archiving = workspace({
      id: "wks_archiving",
      workspaceDirectory: "/repos/otto/.otto/worktrees/dying",
      archivingAt: "2026-07-29T00:00:00.000Z",
    });
    const live = workspace({
      id: "wks_live",
      workspaceDirectory: "/repos/otto/.otto/worktrees/feature",
    });

    const found = findWorkspaceForProject({
      workspaces: [archiving, live],
      sourceDirectory: PROJECT_ROOT,
    });

    expect(found?.id).toBe("wks_live");
  });

  test("ignores workspaces belonging to a different project", () => {
    const other = workspace({
      id: "wks_other",
      projectId: "proj_other",
      projectRootPath: "/repos/other",
      workspaceDirectory: "/repos/other",
    });

    const found = findWorkspaceForProject({
      workspaces: [other],
      sourceDirectory: PROJECT_ROOT,
    });

    expect(found).toBeNull();
  });

  test("returns null for an empty source directory", () => {
    expect(
      findWorkspaceForProject({ workspaces: [workspace({})], sourceDirectory: "" }),
    ).toBeNull();
  });
});

describe("findWorkspaceById", () => {
  test("resolves a workspace the steer already identified", () => {
    const found = findWorkspaceById({
      workspaces: [workspace({ id: "wks_a" }), workspace({ id: "wks_b" })],
      workspaceId: "wks_b",
    });

    expect(found?.id).toBe("wks_b");
  });

  test("returns null when the workspace is gone", () => {
    const found = findWorkspaceById({
      workspaces: [workspace({ id: "wks_a" })],
      workspaceId: "wks_gone",
    });

    expect(found).toBeNull();
  });
});
