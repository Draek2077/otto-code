import { describe, expect, it } from "vitest";
import { decideProjectTeamSwitch } from "./use-project-default-team-switch";

function enter(input: {
  workspaceId: string;
  projectDefaultTeamId: string | null;
  activeTeamId: string | null;
  lastHandledKey: string | null;
}) {
  return decideProjectTeamSwitch({
    serverId: "host-1",
    workspaceId: input.workspaceId,
    resolved: {
      projectDefaultTeamId: input.projectDefaultTeamId,
      activeTeamId: input.activeTeamId,
    },
    lastHandledKey: input.lastHandledKey,
  });
}

describe("decideProjectTeamSwitch", () => {
  it("switches to the project's default team when entering its workspace", () => {
    const decision = enter({
      workspaceId: "ws-1",
      projectDefaultTeamId: "team-a",
      activeTeamId: "team-b",
      lastHandledKey: null,
    });
    expect(decision.switchToTeamId).toBe("team-a");
  });

  it("leaves the active team alone when the project default is not set", () => {
    const decision = enter({
      workspaceId: "ws-1",
      projectDefaultTeamId: null,
      activeTeamId: "team-b",
      lastHandledKey: null,
    });
    expect(decision.switchToTeamId).toBeNull();
  });

  it("does not patch when the default team is already active", () => {
    const decision = enter({
      workspaceId: "ws-1",
      projectDefaultTeamId: "team-a",
      activeTeamId: "team-a",
      lastHandledKey: null,
    });
    expect(decision.switchToTeamId).toBeNull();
  });

  it("keeps a manual switch made inside the same workspace", () => {
    const first = enter({
      workspaceId: "ws-1",
      projectDefaultTeamId: "team-a",
      activeTeamId: "team-b",
      lastHandledKey: null,
    });
    // The user then picks team-b by hand while still in ws-1.
    const afterManualSwitch = enter({
      workspaceId: "ws-1",
      projectDefaultTeamId: "team-a",
      activeTeamId: "team-b",
      lastHandledKey: first.handledKey,
    });
    expect(afterManualSwitch.switchToTeamId).toBeNull();
  });

  it("switches again on entering another workspace of the project", () => {
    const first = enter({
      workspaceId: "ws-1",
      projectDefaultTeamId: "team-a",
      activeTeamId: "team-b",
      lastHandledKey: null,
    });
    const next = enter({
      workspaceId: "ws-2",
      projectDefaultTeamId: "team-a",
      activeTeamId: "team-b",
      lastHandledKey: first.handledKey,
    });
    expect(next.switchToTeamId).toBe("team-a");
  });

  it("waits while the workspace or config is still loading", () => {
    const loading = decideProjectTeamSwitch({
      serverId: "host-1",
      workspaceId: "ws-1",
      resolved: null,
      lastHandledKey: null,
    });
    expect(loading).toEqual({ handledKey: null, switchToTeamId: null });

    const loaded = enter({
      workspaceId: "ws-1",
      projectDefaultTeamId: "team-a",
      activeTeamId: null,
      lastHandledKey: loading.handledKey,
    });
    expect(loaded.switchToTeamId).toBe("team-a");
  });
});
