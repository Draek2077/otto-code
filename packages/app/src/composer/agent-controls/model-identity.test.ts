import { describe, expect, it } from "vitest";
import { buildModelIdentity, type ModelIdentityInput } from "./model-identity";

const BASE: ModelIdentityInput = {
  personalityName: null,
  modelLabel: "Sonnet 5",
  providerLabel: "Claude Code",
  tier: "standard",
  effortLabel: "High",
  modeLabel: "Plan",
  runtimeModelLabel: null,
};

describe("buildModelIdentity", () => {
  it("headlines the model when no personality is bound", () => {
    expect(buildModelIdentity(BASE)).toEqual({
      name: "Sonnet 5",
      modelLabel: null,
      providerLabel: "Claude Code",
      classLabel: "Standard",
      effortLabel: "High",
      modeLabel: "Plan",
      runtimeModelLabel: null,
    });
  });

  it("carries what actually ran when the surface hands it one", () => {
    const identity = buildModelIdentity({ ...BASE, runtimeModelLabel: "Opus 5" });
    // The selection is untouched by it: the fact sits beside the headline,
    // never in place of it.
    expect(identity?.name).toBe("Sonnet 5");
    expect(identity?.runtimeModelLabel).toBe("Opus 5");
  });

  it("headlines the personality and keeps the model as its own fact", () => {
    const identity = buildModelIdentity({ ...BASE, personalityName: "Aria" });
    expect(identity?.name).toBe("Aria");
    expect(identity?.modelLabel).toBe("Sonnet 5");
  });

  it("reads an unclassified model as Unknown rather than guessing", () => {
    expect(buildModelIdentity({ ...BASE, tier: undefined })?.classLabel).toBe("Unknown");
  });

  it("drops facts the surface has none of", () => {
    const identity = buildModelIdentity({
      ...BASE,
      providerLabel: "  ",
      effortLabel: null,
      modeLabel: undefined,
      runtimeModelLabel: "  ",
    });
    expect(identity?.providerLabel).toBeNull();
    expect(identity?.effortLabel).toBeNull();
    expect(identity?.modeLabel).toBeNull();
    expect(identity?.runtimeModelLabel).toBeNull();
  });

  it("returns null when nothing is selected yet", () => {
    expect(buildModelIdentity({ ...BASE, personalityName: null, modelLabel: "" })).toBeNull();
  });
});
