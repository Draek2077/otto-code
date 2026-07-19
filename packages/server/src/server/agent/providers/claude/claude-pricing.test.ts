import { describe, expect, it } from "vitest";

import type { SubagentUsageTotals } from "../../subagent-usage.js";
import {
  claudeModelRates,
  priceClaudeUsageUsd,
  readClaudeModelUsageSlices,
  verifyClaudeTreePricing,
} from "./claude-pricing.js";

const HAIKU = "claude-haiku-4-5-20251001";

function split(over: Partial<SubagentUsageTotals> = {}): SubagentUsageTotals {
  return {
    inputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    outputTokens: 0,
    ...over,
  };
}

describe("claudeModelRates", () => {
  it("prices known models with cache multipliers derived from the input rate", () => {
    // Haiku 4.5 — $1 in / $5 out; cache-read 0.1×, cache-write 1.25×.
    expect(claudeModelRates(HAIKU)).toEqual({
      inputPerMTok: 1,
      outputPerMTok: 5,
      cacheReadPerMTok: 0.1,
      cacheWritePerMTok: 1.25,
    });
    expect(claudeModelRates("claude-opus-4-8")?.inputPerMTok).toBe(15);
    expect(claudeModelRates("claude-sonnet-5")?.inputPerMTok).toBe(3);
  });

  it("is case-insensitive on the exact id and undefined for unknown/absent ids", () => {
    expect(claudeModelRates("CLAUDE-HAIKU-4-5")?.outputPerMTok).toBe(5);
    expect(claudeModelRates("some-local-llm")).toBeUndefined();
    expect(claudeModelRates(undefined)).toBeUndefined();
  });
});

describe("priceClaudeUsageUsd", () => {
  it("sums the four disjoint token classes at their own rates", () => {
    // 1M fresh input @ $1, 1M cache-read @ $0.10, 1M cache-write @ $1.25, 1M out @ $5.
    const usd = priceClaudeUsageUsd(
      split({
        inputTokens: 1_000_000,
        cacheReadInputTokens: 1_000_000,
        cacheCreationInputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
      HAIKU,
    );
    expect(usd).toBeCloseTo(1 + 0.1 + 1.25 + 5, 9);
  });

  it("returns undefined for an unpriceable model (caller attributes 0)", () => {
    expect(priceClaudeUsageUsd(split({ outputTokens: 100 }), "mystery-model")).toBeUndefined();
  });
});

describe("readClaudeModelUsageSlices", () => {
  it("reads per-model token totals + costUSD, dropping empty and malformed slices", () => {
    const slices = readClaudeModelUsageSlices({
      [HAIKU]: {
        inputTokens: 4,
        outputTokens: 913,
        cacheReadInputTokens: 68161,
        cacheCreationInputTokens: 726,
        costUSD: 0.012,
        contextWindow: 200000,
      },
      "claude-opus-4-8": { inputTokens: 0, outputTokens: 0, costUSD: 0 }, // dropped: no tokens
      "bad-shape": 42,
    });
    expect(slices).toEqual([
      {
        model: HAIKU,
        usage: {
          inputTokens: 4,
          cacheReadInputTokens: 68161,
          cacheCreationInputTokens: 726,
          outputTokens: 913,
        },
        costUSD: 0.012,
      },
    ]);
  });

  it("returns [] for non-object input", () => {
    expect(readClaudeModelUsageSlices(undefined)).toEqual([]);
    expect(readClaudeModelUsageSlices("nope")).toEqual([]);
  });
});

describe("verifyClaudeTreePricing", () => {
  it("passes when our table reproduces the SDK's per-model costUSD", () => {
    // 1M output on Haiku ⇒ $5 by our table; SDK agrees.
    const result = verifyClaudeTreePricing([
      { model: HAIKU, usage: split({ outputTokens: 1_000_000 }), costUSD: 5 },
    ]);
    expect(result.ok).toBe(true);
    expect(result.mismatches).toEqual([]);
    expect(result.unpriced).toEqual([]);
    expect(result.ourUsd).toBeCloseTo(5, 9);
    expect(result.sdkUsd).toBe(5);
  });

  it("flags a model whose SDK cost drifts beyond tolerance", () => {
    const result = verifyClaudeTreePricing([
      // Our table says $5; SDK says $6 (20% off, past the 2% tolerance).
      { model: HAIKU, usage: split({ outputTokens: 1_000_000 }), costUSD: 6 },
    ]);
    expect(result.ok).toBe(false);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]).toMatchObject({ model: HAIKU });
  });

  it("lists models it cannot price without failing the priced ones", () => {
    const result = verifyClaudeTreePricing([
      { model: HAIKU, usage: split({ outputTokens: 1_000_000 }), costUSD: 5 },
      { model: "local-llm", usage: split({ outputTokens: 500 }), costUSD: 0 },
    ]);
    expect(result.unpriced).toEqual(["local-llm"]);
    expect(result.mismatches).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
