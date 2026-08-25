import { describe, expect, it } from "vitest";
import { isModelVisible, updateModelVisibilityOverrides } from "./provider-model-visibility";

describe("provider model visibility", () => {
  it("defaults unknown models to visible", () => {
    expect(isModelVisible([], "otto-brain", "qwen")).toBe(true);
  });

  it("hides, shows, and bulk-updates only the requested provider models", () => {
    const initial = [
      { provider: "other", modelId: "keep-hidden", visible: false },
      { provider: "otto-brain", modelId: "alpha", visible: false },
    ];
    const hidden = updateModelVisibilityOverrides({
      overrides: initial,
      provider: "otto-brain",
      modelIds: ["alpha", "beta", "beta"],
      visible: false,
    });

    expect(hidden).toEqual([
      { provider: "other", modelId: "keep-hidden", visible: false },
      { provider: "otto-brain", modelId: "alpha", visible: false },
      { provider: "otto-brain", modelId: "beta", visible: false },
    ]);

    expect(
      updateModelVisibilityOverrides({
        overrides: hidden,
        provider: "otto-brain",
        modelIds: ["alpha", "beta"],
        visible: true,
      }),
    ).toEqual([{ provider: "other", modelId: "keep-hidden", visible: false }]);
  });
});
