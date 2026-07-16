import { beforeEach, describe, expect, it } from "vitest";
import { useClearedSubagentTokensStore } from "./cleared-subagent-tokens-store";

function total(serverId: string, parentAgentId: string): number {
  return (
    useClearedSubagentTokensStore.getState().byParent.get(`${serverId}::${parentAgentId}`)?.total ??
    0
  );
}

describe("useClearedSubagentTokensStore", () => {
  beforeEach(() => {
    useClearedSubagentTokensStore.setState({ byParent: new Map() });
  });

  it("sums cleared tokens per parent, ignoring rows without a total", () => {
    useClearedSubagentTokensStore.getState().recordCleared({
      serverId: "s1",
      parentAgentId: "p1",
      rows: [{ id: "a", cumulativeTokens: 100 }, { id: "b" }, { id: "c", cumulativeTokens: 250 }],
    });
    expect(total("s1", "p1")).toBe(350);
  });

  it("counts each id at most once (idempotent against a retried clear)", () => {
    const { recordCleared } = useClearedSubagentTokensStore.getState();
    recordCleared({
      serverId: "s1",
      parentAgentId: "p1",
      rows: [{ id: "a", cumulativeTokens: 100 }],
    });
    recordCleared({
      serverId: "s1",
      parentAgentId: "p1",
      rows: [{ id: "a", cumulativeTokens: 100 }],
    });
    expect(total("s1", "p1")).toBe(100);
  });

  it("keeps tallies isolated per parent and per server", () => {
    const { recordCleared } = useClearedSubagentTokensStore.getState();
    recordCleared({
      serverId: "s1",
      parentAgentId: "p1",
      rows: [{ id: "a", cumulativeTokens: 10 }],
    });
    recordCleared({
      serverId: "s1",
      parentAgentId: "p2",
      rows: [{ id: "b", cumulativeTokens: 20 }],
    });
    recordCleared({
      serverId: "s2",
      parentAgentId: "p1",
      rows: [{ id: "c", cumulativeTokens: 30 }],
    });
    expect(total("s1", "p1")).toBe(10);
    expect(total("s1", "p2")).toBe(20);
    expect(total("s2", "p1")).toBe(30);
  });

  it("resets a single parent's tally without touching others", () => {
    const { recordCleared, resetForParent } = useClearedSubagentTokensStore.getState();
    recordCleared({
      serverId: "s1",
      parentAgentId: "p1",
      rows: [{ id: "a", cumulativeTokens: 10 }],
    });
    recordCleared({
      serverId: "s1",
      parentAgentId: "p2",
      rows: [{ id: "b", cumulativeTokens: 20 }],
    });
    resetForParent({ serverId: "s1", parentAgentId: "p1" });
    expect(total("s1", "p1")).toBe(0);
    expect(total("s1", "p2")).toBe(20);
  });
});
