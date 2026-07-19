import { describe, expect, it } from "vitest";

import {
  SubagentUsageAccumulator,
  deltaAgentUsage,
  grandTotalTokens,
  subagentUsageToAgentUsage,
} from "./subagent-usage.js";

describe("SubagentUsageAccumulator", () => {
  it("dedups by message.id keeping the final (max-output) frame, then sums", () => {
    const acc = new SubagentUsageAccumulator();
    // msg_A streams twice — the final frame (out=913) carries the real split.
    acc.observe({
      messageId: "msg_A",
      usage: {
        inputTokens: 3,
        cacheReadInputTokens: 13644,
        cacheCreationInputTokens: 7178,
        outputTokens: 1,
      },
      model: undefined,
    });
    acc.observe({
      messageId: "msg_A",
      usage: {
        inputTokens: 4,
        cacheReadInputTokens: 68161,
        cacheCreationInputTokens: 726,
        outputTokens: 913,
      },
      model: undefined,
    });
    // A second message adds on top.
    acc.observe({
      messageId: "msg_B",
      usage: {
        inputTokens: 2,
        cacheReadInputTokens: 100,
        cacheCreationInputTokens: 0,
        outputTokens: 40,
      },
      model: undefined,
    });

    expect(acc.totals()).toEqual({
      inputTokens: 6,
      cacheReadInputTokens: 68261,
      cacheCreationInputTokens: 726,
      outputTokens: 953,
    });
    expect(grandTotalTokens(acc.totals())).toBe(6 + 68261 + 726 + 953);
  });

  it("remembers the model (first seen) even from a usage-less frame", () => {
    const acc = new SubagentUsageAccumulator();
    expect(acc.model()).toBeUndefined();
    expect(acc.isEmpty()).toBe(true);
    // A model-only frame: no usage, but the model must stick.
    acc.observe({ messageId: undefined, usage: undefined, model: "claude-haiku-4-5-20251001" });
    expect(acc.model()).toBe("claude-haiku-4-5-20251001");
    expect(acc.isEmpty()).toBe(true);
    // A later frame reporting a different model does not overwrite it.
    acc.observe({
      messageId: "m1",
      usage: {
        inputTokens: 1,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        outputTokens: 5,
      },
      model: "claude-sonnet-5",
    });
    expect(acc.model()).toBe("claude-haiku-4-5-20251001");
    expect(acc.isEmpty()).toBe(false);
  });
});

describe("deltaAgentUsage", () => {
  const recorded = {
    inputTokens: 4,
    cachedInputTokens: 68_161,
    cacheCreationInputTokens: 726,
    outputTokens: 913,
    totalCostUsd: 0.05,
  };

  it("returns the full usage when nothing has been recorded yet", () => {
    expect(deltaAgentUsage(recorded, undefined)).toEqual(recorded);
  });

  it("returns undefined when the totals have not grown (duplicate settle)", () => {
    expect(deltaAgentUsage(recorded, recorded)).toBeUndefined();
  });

  it("returns only the increment when a second stream grows the totals", () => {
    const grown = {
      inputTokens: 10,
      cachedInputTokens: 70_000,
      cacheCreationInputTokens: 800,
      outputTokens: 1_500,
      totalCostUsd: 0.08,
    };
    const delta = deltaAgentUsage(grown, recorded)!;
    expect(delta.inputTokens).toBe(6);
    expect(delta.cachedInputTokens).toBe(1_839);
    expect(delta.cacheCreationInputTokens).toBe(74);
    expect(delta.outputTokens).toBe(587);
    expect(delta.totalCostUsd).toBeCloseTo(0.03, 10);
  });

  it("clamps per field so a shrinking report can never emit a negative row", () => {
    const shrunk = { ...recorded, outputTokens: 5_000, cachedInputTokens: 100 };
    const delta = deltaAgentUsage(shrunk, recorded)!;
    expect(delta.cachedInputTokens).toBe(0);
    expect(delta.outputTokens).toBe(5_000 - 913);
  });
});

describe("subagentUsageToAgentUsage", () => {
  it("bridges the split onto the wire shape and attaches NO cost (provider-neutral)", () => {
    const usage = subagentUsageToAgentUsage({
      inputTokens: 4,
      cacheReadInputTokens: 68161,
      cacheCreationInputTokens: 726,
      outputTokens: 913,
    });
    // cache_read → cachedInputTokens, cache_creation → cacheCreationInputTokens.
    expect(usage).toEqual({
      inputTokens: 4,
      cachedInputTokens: 68161,
      cacheCreationInputTokens: 726,
      outputTokens: 913,
    });
    // Cost is a provider concern, set separately — never here.
    expect(usage.totalCostUsd).toBeUndefined();
  });
});
