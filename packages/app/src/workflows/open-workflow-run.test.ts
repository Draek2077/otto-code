import { describe, expect, it } from "vitest";
import type { Run } from "@otto-code/protocol/workflow";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { resolveWorkflowWorkspaceId } from "./open-workflow-run";
import { collectWorkflowWorkerAgentIds } from "./workflow-workers";

function workspace(overrides: Partial<WorkspaceDescriptor>): WorkspaceDescriptor {
  return {
    id: "ws",
    projectId: "project_1",
    projectDisplayName: "Otto",
    projectRootPath: "C:\\repo",
    workspaceDirectory: "C:\\repo",
    projectKind: "git",
    workspaceKind: "local_checkout",
    name: "main",
    status: "idle",
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    scripts: [],
    ...overrides,
  } as WorkspaceDescriptor;
}

function byId(...items: WorkspaceDescriptor[]): Map<string, WorkspaceDescriptor> {
  return new Map(items.map((item) => [item.id, item]));
}

const root = workspace({ id: "ws_root" });
const worktree = workspace({
  id: "ws_tree",
  workspaceKind: "worktree",
  workspaceDirectory: "C:\\worktrees\\feature",
});

describe("resolveWorkflowWorkspaceId", () => {
  it("opens in the run's own workspace while it is still open", () => {
    expect(
      resolveWorkflowWorkspaceId(
        { workspaceId: "ws_tree", cwd: "C:\\worktrees\\feature" },
        byId(root, worktree),
      ),
    ).toBe("ws_tree");
  });

  it("falls back to the project's root folder workspace when the run's is gone", () => {
    expect(
      resolveWorkflowWorkspaceId(
        { workspaceId: "ws_gone", cwd: "C:/repo/", workflowStorage: undefined },
        byId(worktree, root),
      ),
    ).toBe("ws_root");
  });

  it("matches the project by the run's storage provenance, not only its cwd", () => {
    expect(
      resolveWorkflowWorkspaceId(
        {
          cwd: "C:\\elsewhere",
          workflowStorage: {
            schemaVersion: 1,
            projectId: "project_1",
            location: "repository",
            storeKey: "k",
            source: "project-store",
          },
        },
        byId(root),
      ),
    ).toBe("ws_root");
  });

  it("never falls back into a worktree or a workspace being archived", () => {
    const archiving = workspace({ id: "ws_archiving", archivingAt: "2026-10-07T00:00:00Z" });
    expect(resolveWorkflowWorkspaceId({ cwd: "C:\\repo" }, byId(worktree, archiving))).toBeNull();
  });
});

describe("collectWorkflowWorkerAgentIds", () => {
  it("lists every candidate and every judge, never the conductor", () => {
    const run = {
      conductorAgentId: "conductor",
      phases: [
        {
          id: "plan",
          type: "plan",
          title: "Plan",
          task: "t",
          status: "done",
          candidates: [{ agentId: "maker", judgeAgentIds: ["judge_1", "judge_2"] }],
        },
      ],
    } as unknown as Run;
    expect([...collectWorkflowWorkerAgentIds(run)]).toEqual(["maker", "judge_1", "judge_2"]);
  });
});
