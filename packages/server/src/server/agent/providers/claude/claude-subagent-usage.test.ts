import { describe, expect, it } from "vitest";

import { readUsageTotals, toClaudeSubagentUsage } from "./claude-subagent-usage.js";

describe("readUsageTotals (Anthropic wire → neutral split)", () => {
  it("reads the full split, defaulting missing cache fields to zero", () => {
    expect(readUsageTotals({ input_tokens: 10, output_tokens: 7 })).toEqual({
      inputTokens: 10,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      outputTokens: 7,
    });
  });

  it("maps cache_read/cache_creation onto the neutral split", () => {
    expect(
      readUsageTotals({
        input_tokens: 4,
        output_tokens: 913,
        cache_creation_input_tokens: 726,
        cache_read_input_tokens: 68161,
      }),
    ).toEqual({
      inputTokens: 4,
      cacheReadInputTokens: 68161,
      cacheCreationInputTokens: 726,
      outputTokens: 913,
    });
  });

  it("returns undefined when output_tokens is absent (a non-usage shape)", () => {
    expect(readUsageTotals({ input_tokens: 5 })).toBeUndefined();
    expect(readUsageTotals(undefined)).toBeUndefined();
    expect(readUsageTotals("nope")).toBeUndefined();
  });
});

describe("toClaudeSubagentUsage", () => {
  const SPLIT = {
    inputTokens: 4,
    cacheReadInputTokens: 68161,
    cacheCreationInputTokens: 726,
    outputTokens: 913,
  };

  it("bridges the split onto the wire shape and prices it on the Claude model", () => {
    const usage = toClaudeSubagentUsage(SPLIT, "claude-haiku-4-5-20251001");
    expect(usage).toMatchObject({
      inputTokens: 4,
      cachedInputTokens: 68161,
      cacheCreationInputTokens: 726,
      outputTokens: 913,
    });
    // Haiku: (4×$1 + 68161×$0.10 + 726×$1.25 + 913×$5) / 1e6.
    expect(usage.totalCostUsd).toBeCloseTo(
      (4 * 1 + 68161 * 0.1 + 726 * 1.25 + 913 * 5) / 1_000_000,
      12,
    );
  });

  it("omits cost for an unpriceable model (honest blank, spend stays on parent)", () => {
    const usage = toClaudeSubagentUsage(SPLIT, "some-local-model");
    expect(usage.totalCostUsd).toBeUndefined();
    expect(usage).toMatchObject({ inputTokens: 4, outputTokens: 913 });
  });
});
