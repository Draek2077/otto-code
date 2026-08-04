import { describe, expect, it } from "vitest";
import {
  accumulateLifetimeUsage,
  costCoverageOf,
  cumulativeUsageScopeFor,
  lifetimeUsageTotalTokens,
  observedLifetimeUsage,
  toTurnSpend,
  type AgentLifetimeUsage,
  type TurnUsageWatermark,
} from "./turn-usage.js";

describe("cumulativeUsageScopeFor", () => {
  it("treats per-turn reporters as needing no differencing", () => {
    expect(cumulativeUsageScopeFor("claude")).toBe("none");
    expect(cumulativeUsageScopeFor("codex")).toBe("none");
    expect(cumulativeUsageScopeFor("openai-compatible")).toBe("none");
  });

  it("marks Pi's whole stat block cumulative and OpenCode's cost only", () => {
    expect(cumulativeUsageScopeFor("pi")).toBe("all");
    expect(cumulativeUsageScopeFor("opencode")).toBe("cost");
  });
});

describe("toTurnSpend", () => {
  it("passes a per-turn provider's usage straight through", () => {
    const usage = { inputTokens: 100, outputTokens: 20, totalCostUsd: 0.5 };
    const result = toTurnSpend(usage, "claude", undefined);
    expect(result.usage).toBe(usage);
    expect(result.watermark).toBeUndefined();
  });

  it("differences Pi's lifetime stats so a three-turn chat is not booked six times", () => {
    // Pi reports the session total every turn: 100 → 250 → 400 tokens.
    let watermark: TurnUsageWatermark | undefined;
    const booked: number[] = [];
    for (const total of [100, 250, 400]) {
      const result = toTurnSpend({ inputTokens: total }, "pi", watermark);
      watermark = result.watermark;
      booked.push(result.usage?.inputTokens ?? 0);
    }
    expect(booked).toEqual([100, 150, 150]);
    // Summing the deltas reproduces the provider's own final figure exactly.
    expect(booked.reduce((sum, value) => sum + value, 0)).toBe(400);
  });

  it("differences OpenCode's cost while leaving its per-turn tokens alone", () => {
    let watermark: TurnUsageWatermark | undefined;
    const first = toTurnSpend({ inputTokens: 100, totalCostUsd: 0.25 }, "opencode", watermark);
    watermark = first.watermark;
    // Second turn: tokens are this turn's, cost is the running session total.
    const second = toTurnSpend({ inputTokens: 80, totalCostUsd: 0.75 }, "opencode", watermark);

    expect(first.usage?.inputTokens).toBe(100);
    expect(first.usage?.totalCostUsd).toBeCloseTo(0.25);
    // Tokens untouched - OpenCode already resets its token accumulator per turn.
    expect(second.usage?.inputTokens).toBe(80);
    // Cost differenced - booking 0.75 again would have made the total 1.00.
    expect(second.usage?.totalCostUsd).toBeCloseTo(0.5);
  });

  it("never books a negative delta when a provider reports a smaller total", () => {
    const first = toTurnSpend({ inputTokens: 500, totalCostUsd: 2 }, "pi", undefined);
    // A session reset / re-attach that lost history reports a lower figure.
    const second = toTurnSpend({ inputTokens: 10, totalCostUsd: 0.1 }, "pi", first.watermark);
    expect(second.usage?.inputTokens).toBe(0);
    expect(second.usage?.totalCostUsd).toBe(0);
    // The watermark holds at the high-water mark rather than regressing.
    expect(second.watermark?.tokens?.inputTokens).toBe(500);
    expect(second.watermark?.costUsd).toBe(2);
  });

  it("leaves absolute context-window occupancy undifferenced", () => {
    const first = toTurnSpend(
      { inputTokens: 100, contextWindowUsedTokens: 5_000, contextWindowMaxTokens: 200_000 },
      "pi",
      undefined,
    );
    const second = toTurnSpend(
      { inputTokens: 250, contextWindowUsedTokens: 9_000, contextWindowMaxTokens: 200_000 },
      "pi",
      first.watermark,
    );
    // Occupancy answers "how full am I" and is absolute - differencing it would
    // be meaningless. Only the billable leaves move.
    expect(second.usage?.contextWindowUsedTokens).toBe(9_000);
    expect(second.usage?.contextWindowMaxTokens).toBe(200_000);
    expect(second.usage?.inputTokens).toBe(150);
  });
});

describe("accumulateLifetimeUsage", () => {
  it("keeps the split rather than flattening it, so cache reads stay visible", () => {
    let usage = accumulateLifetimeUsage(
      undefined,
      { inputTokens: 100, cachedInputTokens: 900, cacheCreationInputTokens: 50, outputTokens: 30 },
      250_000,
    );
    usage = accumulateLifetimeUsage(
      usage,
      { inputTokens: 20, cachedInputTokens: 1_200, outputTokens: 40 },
      100_000,
    );

    expect(usage).toMatchObject({
      inputTokens: 120,
      cachedInputTokens: 2_100,
      cacheCreationInputTokens: 50,
      outputTokens: 70,
      turns: 2,
      costedTurns: 2,
    });
    expect(usage?.costUsd).toBeCloseTo(0.35);
    expect(lifetimeUsageTotalTokens(usage as AgentLifetimeUsage)).toBe(2_340);
  });

  it("books the cost the manager actually charged, not the one on the usage", () => {
    // The residual de-inflation hands in a smaller figure than usage.totalCostUsd
    // because the sub-agents' share was already booked to their own rows.
    const usage = accumulateLifetimeUsage(undefined, { inputTokens: 10, totalCostUsd: 5 }, 400_000);
    expect(usage?.costUsd).toBeCloseTo(0.4);
  });

  it("records an unpriced turn as spend without inventing a cost", () => {
    const usage = accumulateLifetimeUsage(
      undefined,
      { inputTokens: 100, outputTokens: 5 },
      undefined,
    );
    expect(usage?.costUsd).toBeUndefined();
    expect(usage).toMatchObject({ turns: 1, costedTurns: 0 });
    expect(costCoverageOf(usage as AgentLifetimeUsage)).toBe("none");
  });

  it("ignores a turn that reported nothing", () => {
    const existing = accumulateLifetimeUsage(undefined, { inputTokens: 10 }, undefined);
    expect(accumulateLifetimeUsage(existing, undefined, undefined)).toBe(existing);
    expect(accumulateLifetimeUsage(existing, {}, 0)).toBe(existing);
  });
});

describe("costCoverageOf", () => {
  function lifetime(overrides: Partial<AgentLifetimeUsage>): AgentLifetimeUsage {
    return {
      inputTokens: 100,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      outputTokens: 10,
      turns: 1,
      costedTurns: 0,
      ...overrides,
    };
  }

  it("reports complete only when every token-bearing turn was priced", () => {
    expect(costCoverageOf(lifetime({ turns: 3, costedTurns: 3, costUsd: 1 }))).toBe("complete");
  });

  it("reports partial when some turns were unpriced, so the figure is a floor", () => {
    expect(costCoverageOf(lifetime({ turns: 3, costedTurns: 1, costUsd: 1 }))).toBe("partial");
  });

  it("reports none for a provider that never priced anything", () => {
    expect(costCoverageOf(lifetime({ turns: 3, costedTurns: 0 }))).toBe("none");
  });
});

describe("observedLifetimeUsage", () => {
  it("projects an observed sub-agent's already-cumulative usage without differencing", () => {
    const usage = observedLifetimeUsage({
      inputTokens: 500,
      cachedInputTokens: 12_000,
      cacheCreationInputTokens: 200,
      outputTokens: 800,
      totalCostUsd: 0.042,
    });
    expect(usage).toEqual({
      inputTokens: 500,
      cachedInputTokens: 12_000,
      cacheCreationInputTokens: 200,
      outputTokens: 800,
      costUsd: 0.042,
      turns: 1,
      costedTurns: 1,
    });
    expect(costCoverageOf(usage as AgentLifetimeUsage)).toBe("complete");
  });

  it("leaves cost absent for a sub-agent the provider could not price", () => {
    const usage = observedLifetimeUsage({ inputTokens: 500, outputTokens: 100 });
    expect(usage?.costUsd).toBeUndefined();
    expect(costCoverageOf(usage as AgentLifetimeUsage)).toBe("none");
  });

  it("returns nothing for a sub-agent that never reported a real split", () => {
    expect(observedLifetimeUsage(undefined)).toBeUndefined();
    expect(observedLifetimeUsage({ contextWindowUsedTokens: 5_000 })).toBeUndefined();
  });
});
