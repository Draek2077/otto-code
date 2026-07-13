import { catalogTier } from "@otto-code/protocol/model-tiers";
import { describe, expect, it } from "vitest";
import { CLAUDE_MODEL_MANIFEST } from "./model-manifest.js";

describe("claude model manifest", () => {
  // The manifest is the official Claude model list we ship — every entry must
  // classify to a known tier so no first-party Claude model ever shows as
  // "Unknown" in tier-driven UI (wizard presets, personality forms).
  it("every manifest model has a known tier in the shared catalog", () => {
    for (const model of CLAUDE_MODEL_MANIFEST) {
      expect(catalogTier(model.id), `expected a catalog tier for ${model.id}`).toBeDefined();
    }
  });

  // Exact-string expectations, one per manifest id — no name-pattern derivation.
  // Rule of thumb encoded here: 1M-context Opus (and Fable) are deep, non-1M
  // Opus and Sonnet are standard, Haiku is fast.
  it("each manifest model has its expected tier", () => {
    expect(
      Object.fromEntries(CLAUDE_MODEL_MANIFEST.map((model) => [model.id, catalogTier(model.id)])),
    ).toEqual({
      "claude-fable-5": "deep",
      "claude-opus-4-8[1m]": "deep",
      "claude-opus-4-8": "standard",
      "claude-sonnet-5": "standard",
      "claude-opus-4-7[1m]": "deep",
      "claude-opus-4-7": "standard",
      "claude-opus-4-6[1m]": "deep",
      "claude-opus-4-6": "standard",
      "claude-sonnet-4-6[1m]": "standard",
      "claude-sonnet-4-6": "standard",
      "claude-haiku-4-5": "fast",
    });
  });
});
