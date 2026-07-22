import { describe, expect, it } from "vitest";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import {
  buildOrchestrationWorkspaceTargets,
  resolveProjectKeyForWorkspaceCwd,
  resolveSelectedWorkspaceTarget,
  PROJECT_ROOT_WORKSPACE_ID,
} from "./orchestration-workspace-targets";

function workspace(overrides: Partial<WorkspaceDescriptor> & { id: string }): WorkspaceDescriptor {
  return {
    projectId: "project-a",
    projectDisplayName: "Project A",
    projectRootPath: "/repos/a",
    workspaceDirectory: "/repos/a",
    projectKind: "git",
    workspaceKind: "local_checkout",
    name: "main",
    status: "done",
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    scripts: [],
    ...overrides,
  } as WorkspaceDescriptor;
}

const workspaces = (entries: WorkspaceDescriptor[]): Map<string, WorkspaceDescriptor> =>
  new Map(entries.map((entry) => [entry.id, entry]));

describe("buildOrchestrationWorkspaceTargets", () => {
  it("lists the project's workspaces with the root first", () => {
    const targets = buildOrchestrationWorkspaceTargets({
      workspaces: workspaces([
        workspace({
          id: "ws-feature",
          workspaceDirectory: "/otto/worktrees/a/feature",
          workspaceKind: "worktree",
          name: "feature",
        }),
        workspace({ id: "ws-root" }),
        workspace({
          id: "ws-other-project",
          projectId: "project-b",
          workspaceDirectory: "/repos/b",
        }),
      ]),
      project: { projectKey: "project-a", cwd: "/repos/a" },
    });

    expect(targets.map((target) => target.id)).toEqual(["ws-root", "ws-feature"]);
    expect(targets[0]?.isProjectRoot).toBe(true);
    // A worktree lives outside the repo root and still belongs to the project.
    expect(targets[1]?.cwd).toBe("/otto/worktrees/a/feature");
  });

  it("offers a synthetic root entry when the project has no open root workspace", () => {
    const targets = buildOrchestrationWorkspaceTargets({
      workspaces: workspaces([
        workspace({
          id: "ws-feature",
          workspaceDirectory: "/otto/worktrees/a/feature",
          workspaceKind: "worktree",
          name: "feature",
        }),
      ]),
      project: { projectKey: "project-a", cwd: "/repos/a" },
    });

    expect(targets[0]).toMatchObject({ id: PROJECT_ROOT_WORKSPACE_ID, cwd: "/repos/a" });
    expect(targets).toHaveLength(2);
  });

  it("skips archiving workspaces", () => {
    const targets = buildOrchestrationWorkspaceTargets({
      workspaces: workspaces([
        workspace({ id: "ws-root" }),
        workspace({
          id: "ws-gone",
          workspaceDirectory: "/otto/worktrees/a/gone",
          archivingAt: "2026-07-22T00:00:00.000Z",
        }),
      ]),
      project: { projectKey: "project-a", cwd: "/repos/a" },
    });

    expect(targets.map((target) => target.id)).toEqual(["ws-root"]);
  });
});

describe("resolveSelectedWorkspaceTarget", () => {
  it("matches on the normalized path", () => {
    const targets = buildOrchestrationWorkspaceTargets({
      workspaces: workspaces([workspace({ id: "ws-root" })]),
      project: { projectKey: "project-a", cwd: "/repos/a" },
    });

    expect(resolveSelectedWorkspaceTarget(targets, "/repos/a/")?.id).toBe("ws-root");
    expect(resolveSelectedWorkspaceTarget(targets, "/repos/other")).toBeNull();
  });
});

describe("resolveProjectKeyForWorkspaceCwd", () => {
  it("names the project owning a worktree directory", () => {
    const map = workspaces([
      workspace({
        id: "ws-feature",
        workspaceDirectory: "/otto/worktrees/a/feature",
        workspaceKind: "worktree",
      }),
    ]);

    expect(resolveProjectKeyForWorkspaceCwd(map, "/otto/worktrees/a/feature")).toBe("project-a");
    expect(resolveProjectKeyForWorkspaceCwd(map, "/repos/a")).toBeNull();
  });
});
