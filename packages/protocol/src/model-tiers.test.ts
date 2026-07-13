import { describe, expect, it } from "vitest";
import { catalogTier, inferModelTier, resolveModelTier } from "./model-tiers.js";

describe("model-tiers", () => {
  it("classifies known catalog models, case-insensitively", () => {
    expect(catalogTier("claude-opus-4-8[1m]")).toBe("deep");
    expect(catalogTier("claude-opus-4-8")).toBe("standard");
    expect(catalogTier("claude-fable-5")).toBe("deep");
    expect(catalogTier("GPT-4o")).toBe("standard");
    expect(catalogTier("deepseek-chat")).toBe("standard");
  });

  it("tiers 1M-context Opus as deep and non-1M Opus as standard", () => {
    expect(catalogTier("claude-opus-4-7[1m]")).toBe("deep");
    expect(catalogTier("claude-opus-4-7")).toBe("standard");
    expect(catalogTier("claude-opus-4-6[1m]")).toBe("deep");
    expect(catalogTier("claude-opus-4-6")).toBe("standard");
    expect(catalogTier("claude-sonnet-4-6")).toBe("standard");
    expect(catalogTier("claude-sonnet-4-6[1m]")).toBe("standard");
  });

  it("leaves models we don't ship an id for as Unknown (undefined)", () => {
    // No name-pattern guessing: a big-sounding local id is still Unknown.
    expect(catalogTier("Qwen2.5-72B-Instruct")).toBeUndefined();
    expect(inferModelTier({ id: "Qwen2.5-72B-Instruct" })).toBeUndefined();
    expect(inferModelTier({ id: "some-random-local-model" })).toBeUndefined();
  });

  it("lets an override win, and is the only tier source for Unknown models", () => {
    // Known model: override beats the catalog.
    expect(resolveModelTier({ id: "claude-haiku-4-5" }, "deep")).toBe("deep");
    expect(resolveModelTier({ id: "claude-haiku-4-5" }, undefined)).toBe("fast");
    // Unknown model: only an override gives it a tier.
    expect(resolveModelTier({ id: "my-local-model" }, "standard")).toBe("standard");
    expect(resolveModelTier({ id: "my-local-model" }, undefined)).toBeUndefined();
  });
});
