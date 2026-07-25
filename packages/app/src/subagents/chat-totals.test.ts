import { describe, expect, it } from "vitest";
import type { AgentCumulativeUsage } from "@otto-code/protocol/messages";
import { EMPTY_CHAT_TOTALS, selectChatTotals } from "./chat-totals";
import type { Agent } from "@/stores/session-store";

const SERVER = "server-1";

interface AgentSpec {
  id: string;
  parentAgentId?: string;
  attend?: "attended" | "observed";
  archivedAt?: Date;
  cumulativeTokens?: number;
  cumulativeUsage?: AgentCumulativeUsage;
}

function agent(spec: AgentSpec): Agent {
  return {
    id: spec.id,
    provider: "claude",
    status: "idle",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastUserMessageAt: null,
    lastActivityAt: new Date(0),
    capabilities: {} as Agent["capabilities"],
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    lastError: null,
    title: null,
    cwd: "/tmp",
    model: null,
    thinkingOptionId: null,
    requiresAttention: false,
    attentionReason: null,
    attentionTimestamp: null,
    archivedAt: spec.archivedAt ?? null,
    labels: {},
    parentAgentId: spec.parentAgentId,
    attend: spec.attend ?? "observed",
    cumulativeTokens: spec.cumulativeTokens,
    cumulativeUsage: spec.cumulativeUsage,
  } as unknown as Agent;
}

function state(specs: AgentSpec[]) {
  const agents = new Map<string, Agent>();
  for (const spec of specs) {
    agents.set(spec.id, agent(spec));
  }
  return { sessions: { [SERVER]: { agents } } } as unknown as Parameters<
    typeof selectChatTotals
  >[0];
}

function split(input: Partial<AgentCumulativeUsage> & { costUsd?: number }): AgentCumulativeUsage {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    outputTokens: 0,
    costCoverage: input.costUsd !== undefined ? "complete" : "none",
    ...input,
  };
}

describe("selectChatTotals", () => {
  it("is the parent PLUS its descendants — the number nothing used to show", () => {
    const totals = selectChatTotals(
      state([
        {
          id: "parent",
          cumulativeTokens: 1_000,
          cumulativeUsage: split({ inputTokens: 400, outputTokens: 600, costUsd: 0.1 }),
        },
        {
          id: "child",
          parentAgentId: "parent",
          cumulativeTokens: 250,
          cumulativeUsage: split({ inputTokens: 200, outputTokens: 50, costUsd: 0.02 }),
        },
      ]),
      { serverId: SERVER, agentId: "parent" },
    );

    expect(totals.tokens).toBe(1_250);
    expect(totals.costUsd).toBeCloseTo(0.12);
    expect(totals.costCoverage).toBe("complete");
    expect(totals.agentCount).toBe(2);
  });

  it("counts a nested observed sub-agent, at any depth", () => {
    const totals = selectChatTotals(
      state([
        { id: "parent", cumulativeTokens: 100 },
        { id: "child", parentAgentId: "parent", cumulativeTokens: 200 },
        { id: "grandchild", parentAgentId: "child", cumulativeTokens: 300 },
      ]),
      { serverId: SERVER, agentId: "parent" },
    );
    expect(totals.tokens).toBe(600);
    expect(totals.agentCount).toBe(3);
  });

  it("stops at an attended child, which is its own chat with its own total", () => {
    const totals = selectChatTotals(
      state([
        { id: "parent", cumulativeTokens: 100 },
        { id: "attended", parentAgentId: "parent", attend: "attended", cumulativeTokens: 200 },
        // Belongs to the attended chat's total, not this one.
        { id: "under-attended", parentAgentId: "attended", cumulativeTokens: 400 },
      ]),
      { serverId: SERVER, agentId: "parent" },
    );
    // The attended child itself is a direct child and still counts; only ITS
    // subtree is excluded.
    expect(totals.tokens).toBe(300);
  });

  it("keeps cleared rows counted so tidying up never makes a chat look cheaper", () => {
    const totals = selectChatTotals(
      state([{ id: "parent", cumulativeTokens: 1_000, cumulativeUsage: split({ costUsd: 0.1 }) }]),
      { serverId: SERVER, agentId: "parent" },
      { tokens: 5_000, costUsd: 0.4 },
    );
    expect(totals.tokens).toBe(6_000);
    expect(totals.costUsd).toBeCloseTo(0.5);
  });

  it("never counts an archived descendant twice alongside the cleared tally", () => {
    const totals = selectChatTotals(
      state([
        { id: "parent", cumulativeTokens: 1_000 },
        { id: "gone", parentAgentId: "parent", cumulativeTokens: 500, archivedAt: new Date(0) },
      ]),
      { serverId: SERVER, agentId: "parent" },
      { tokens: 500, costUsd: 0 },
    );
    expect(totals.tokens).toBe(1_500);
  });

  it("reports no cost at all rather than estimating one for an unpriceable provider", () => {
    const totals = selectChatTotals(
      state([
        {
          id: "parent",
          cumulativeTokens: 40_000,
          cumulativeUsage: split({ inputTokens: 38_000, outputTokens: 2_000 }),
        },
      ]),
      { serverId: SERVER, agentId: "parent" },
    );
    expect(totals.tokens).toBe(40_000);
    expect(totals.costUsd).toBeNull();
    expect(totals.costCoverage).toBe("none");
  });

  it("marks the total a floor when only some contributors were priced", () => {
    const totals = selectChatTotals(
      state([
        { id: "parent", cumulativeTokens: 1_000, cumulativeUsage: split({ costUsd: 0.1 }) },
        // A local-model sub-agent: real tokens, no knowable cost.
        { id: "child", parentAgentId: "parent", cumulativeTokens: 9_000 },
      ]),
      { serverId: SERVER, agentId: "parent" },
    );
    expect(totals.tokens).toBe(10_000);
    expect(totals.costUsd).toBeCloseTo(0.1);
    expect(totals.costCoverage).toBe("partial");
  });

  it("propagates a partially-priced contributor to the whole total", () => {
    const totals = selectChatTotals(
      state([
        {
          id: "parent",
          cumulativeTokens: 1_000,
          cumulativeUsage: { ...split({ costUsd: 0.1 }), costCoverage: "partial" },
        },
      ]),
      { serverId: SERVER, agentId: "parent" },
    );
    expect(totals.costCoverage).toBe("partial");
  });

  it("still totals tokens from a daemon too old to send the split", () => {
    const totals = selectChatTotals(
      state([
        { id: "parent", cumulativeTokens: 1_000 },
        { id: "child", parentAgentId: "parent", cumulativeTokens: 500 },
      ]),
      { serverId: SERVER, agentId: "parent" },
    );
    expect(totals.tokens).toBe(1_500);
    // ...but says the breakdown is not exact, so no surface presents it as one.
    expect(totals.hasSplit).toBe(false);
    expect(totals.costUsd).toBeNull();
  });

  it("is empty for an unknown chat or a chat that has spent nothing", () => {
    expect(selectChatTotals(state([]), { serverId: SERVER, agentId: "nope" })).toEqual(
      EMPTY_CHAT_TOTALS,
    );
    expect(
      selectChatTotals(state([{ id: "parent" }]), { serverId: SERVER, agentId: "parent" }),
    ).toEqual(EMPTY_CHAT_TOTALS);
  });
});
