import { describe, expect, it } from "vitest";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { filterHistoryAgents } from "./filter-history-agents";

function agent(overrides: Partial<AggregatedAgent>): AggregatedAgent {
  return {
    id: "agent-1",
    serverId: "host-1",
    serverLabel: "Personal host",
    title: "Untitled chat",
    lastActivityAt: new Date("2026-08-14T00:00:00Z"),
    ...overrides,
  } as AggregatedAgent;
}

describe("filterHistoryAgents", () => {
  const agents = [
    agent({
      id: "frontend",
      title: "Fix responsive history search",
      projectPlacement: {
        projectKey: "otto-code",
        projectName: "Otto Code",
        workspaceName: "history-search",
        checkout: {
          cwd: "/repo/history-search",
          isGit: true,
          currentBranch: "feature/history-search",
          remoteUrl: null,
          worktreeRoot: "/repo/history-search",
          isOttoOwnedWorktree: false,
          mainRepoRoot: "/repo",
        },
      },
    }),
    agent({ id: "docs", serverLabel: "Work host", title: "Update release notes" }),
  ];

  it("matches the conversation and every metadata field visible in History", () => {
    expect(filterHistoryAgents(agents, "responsive").map((entry) => entry.id)).toEqual([
      "frontend",
    ]);
    expect(filterHistoryAgents(agents, "otto code").map((entry) => entry.id)).toEqual(["frontend"]);
    expect(filterHistoryAgents(agents, "HISTORY-SEARCH").map((entry) => entry.id)).toEqual([
      "frontend",
    ]);
    expect(filterHistoryAgents(agents, "work host").map((entry) => entry.id)).toEqual(["docs"]);
  });

  it("returns all history for an empty search and none for a missing term", () => {
    expect(filterHistoryAgents(agents, "   ").map((entry) => entry.id)).toEqual([
      "frontend",
      "docs",
    ]);
    expect(filterHistoryAgents(agents, "nothing here")).toEqual([]);
  });
});
