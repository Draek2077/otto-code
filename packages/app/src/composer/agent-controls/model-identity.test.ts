import { describe, expect, it } from "vitest";
import { buildModelIdentity, type ModelIdentityInput } from "./model-identity";

const BASE: ModelIdentityInput = {
  personalityName: null,
  modelLabel: "Sonnet 5",
  providerLabel: "Claude Code",
  tier: "standard",
  effortLabel: "High",
  modeLabel: "Plan",
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
    });
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
    });
    expect(identity?.providerLabel).toBeNull();
    expect(identity?.effortLabel).toBeNull();
    expect(identity?.modeLabel).toBeNull();
  });

  it("returns null when nothing is selected yet", () => {
    expect(buildModelIdentity({ ...BASE, personalityName: null, modelLabel: "" })).toBeNull();
  });
});
