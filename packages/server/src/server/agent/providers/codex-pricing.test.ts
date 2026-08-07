import { codexModelRates, priceCodexUsageUsd } from "./codex-pricing.js";
import { describe, expect, test } from "vitest";

describe("Codex pricing", () => {
  test.each([
    ["gpt-5.6-sol", 5, 0.5, 30],
    ["gpt-5.6-terra", 2, 0.2, 12],
    ["gpt-5.6-luna", 0.2, 0.02, 1.2],
    ["gpt-5.5", 5, 0.5, 30],
    ["gpt-5.5-cyber", 12.5, 1.25, 75],
    ["gpt-5.4", 2.5, 0.25, 15],
    ["gpt-5.4-mini", 0.75, 0.075, 4.5],
    ["gpt-5.3-codex", 1.75, 0.175, 14],
    ["gpt-5.2", 1.75, 0.175, 14],
  ])("has the published rate card for %s", (model, input, cachedInput, output) => {
    const card = codexModelRates(model);
    expect(card?.inputPerMTok).toBe(input);
    expect(card?.cachedInputPerMTok).toBeCloseTo(cachedInput);
    expect(card?.outputPerMTok).toBe(output);
  });

  test("prices fresh, cached, and output tokens separately", () => {
    expect(
      priceCodexUsageUsd(
        { inputTokens: 1_000_000, cachedInputTokens: 1_000_000, outputTokens: 1_000_000 },
        "gpt-5.4",
      ),
    ).toBe(17.75);
  });

  test("is case-insensitive but leaves unknown and preview models blank", () => {
    expect(codexModelRates(" GPT-5.6-SOL ")).toBeDefined();
    expect(priceCodexUsageUsd({ inputTokens: 1 }, "gpt-5.3-codex-spark")).toBeUndefined();
    expect(priceCodexUsageUsd({ inputTokens: 1 }, "not-a-model")).toBeUndefined();
  });
});
