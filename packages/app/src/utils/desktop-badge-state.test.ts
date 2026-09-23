import { describe, expect, it } from "vitest";
import {
  deriveMacDockBadgeCountFromWorkspaceStatuses,
  isWorkspaceActionableForDesktopBadge,
  selectDesktopAttentionSnapshots,
} from "./desktop-badge-state";

describe("desktop-badge-state", () => {
  it("treats attention-requiring workspace statuses as actionable", () => {
    expect(isWorkspaceActionableForDesktopBadge("attention")).toBe(true);
    expect(isWorkspaceActionableForDesktopBadge("needs_input")).toBe(true);
    expect(isWorkspaceActionableForDesktopBadge("failed")).toBe(true);
  });

  it("ignores running and done workspace statuses", () => {
    expect(isWorkspaceActionableForDesktopBadge("running")).toBe(false);
    expect(isWorkspaceActionableForDesktopBadge("done")).toBe(false);
  });

  it("returns undefined when no visible workspaces need attention", () => {
    expect(deriveMacDockBadgeCountFromWorkspaceStatuses(["done", "running"])).toBeUndefined();
  });

  it("counts only actionable visible workspaces", () => {
    expect(
      deriveMacDockBadgeCountFromWorkspaceStatuses([
        "done",
        "attention",
        "running",
        "needs_input",
        "failed",
      ]),
    ).toBe(3);
  });

  it("reconciles only hydrated servers and their current attention sources", () => {
    const ready = {
      hasHydratedAgents: true,
      hasHydratedWorkspaces: true,
      agents: new Map([
        ["unread", { archivedAt: null, requiresAttention: true, pendingPermissions: [] }],
        ["archived", { archivedAt: new Date(), requiresAttention: true, pendingPermissions: [] }],
      ]),
      workspaces: new Map([
        ["one", { id: "workspace-one", status: "needs_input" as const }],
        ["two", { id: "workspace-two", status: "done" as const }],
      ]),
    };
    expect(
      selectDesktopAttentionSnapshots({
        ready,
        loading: { ...ready, hasHydratedAgents: false },
      }),
    ).toEqual([{ serverId: "ready", agentIds: ["unread"], workspaceIds: ["workspace-one"] }]);
  });
});
