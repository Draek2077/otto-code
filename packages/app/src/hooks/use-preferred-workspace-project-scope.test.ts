import { describe, expect, it } from "vitest";
import type { SessionState, WorkspaceDescriptor } from "@/stores/session-store";
import {
  resolveInitialAggregateProjectScope,
  resolvePreferredWorkspaceProjectScope,
} from "./preferred-workspace-project-scope-state";

function workspace(input: { id: string; projectRootPath: string }): WorkspaceDescriptor {
  return input as WorkspaceDescriptor;
}

function sessionWithWorkspace(workspaceEntry: WorkspaceDescriptor): SessionState {
  return { workspaces: new Map([[workspaceEntry.id, workspaceEntry]]) } as SessionState;
}

describe("resolvePreferredWorkspaceProjectScope", () => {
  it("uses the active workspace before the persisted last workspace", () => {
    expect(
      resolvePreferredWorkspaceProjectScope({
        activeWorkspace: { serverId: "host-a", workspaceId: "active" },
        lastWorkspace: { serverId: "host-b", workspaceId: "last" },
        sessions: {
          "host-a": sessionWithWorkspace(
            workspace({ id: "active", projectRootPath: "/repo/otto" }),
          ),
          "host-b": sessionWithWorkspace(workspace({ id: "last", projectRootPath: "/repo/other" })),
        },
      }),
    ).toEqual({ serverId: "host-a", projectRootPath: "/repo/otto" });
  });

  it("resolves a route workspace id through its current map identity", () => {
    expect(
      resolvePreferredWorkspaceProjectScope({
        activeWorkspace: null,
        lastWorkspace: { serverId: "host-a", workspaceId: "route-id" },
        sessions: {
          "host-a": sessionWithWorkspace(
            workspace({ id: "route-id", projectRootPath: "C:\\repo\\otto\\" }),
          ),
        },
      }),
    ).toEqual({ serverId: "host-a", projectRootPath: "C:/repo/otto" });
  });
});

describe("resolveInitialAggregateProjectScope", () => {
  const preferredScope = { serverId: "host-a", projectRootPath: "/repo/otto" };
  const projectTargets = [
    { serverId: "host-a", cwd: "/repo/other" },
    { serverId: "host-a", cwd: "/repo/otto" },
  ];

  it("uses the last workspace project when the page first opens", () => {
    expect(
      resolveInitialAggregateProjectScope({
        hasExplicitSelection: false,
        preferredScope,
        availableHostIds: ["host-a"],
        projectTargets,
      }),
    ).toEqual({ serverId: "host-a", cwd: "/repo/otto" });
  });

  it("does not override an explicit All or picker selection", () => {
    expect(
      resolveInitialAggregateProjectScope({
        hasExplicitSelection: true,
        preferredScope,
        availableHostIds: ["host-a"],
        projectTargets,
      }),
    ).toBeNull();
  });

  it("does not select an unavailable workspace project", () => {
    expect(
      resolveInitialAggregateProjectScope({
        hasExplicitSelection: false,
        preferredScope,
        availableHostIds: ["host-b"],
        projectTargets,
      }),
    ).toBeNull();
  });
});
