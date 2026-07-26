import { describe, expect, it } from "vitest";
import { COMPACT_FEATURES_MIN_TOOLBAR_WIDTH, canFitCompactFeatures } from "./toolbar-width-context";

describe("canFitCompactFeatures", () => {
  it("keeps Features on a roomy toolbar", () => {
    expect(canFitCompactFeatures(COMPACT_FEATURES_MIN_TOOLBAR_WIDTH)).toBe(true);
    expect(canFitCompactFeatures(COMPACT_FEATURES_MIN_TOOLBAR_WIDTH + 200)).toBe(true);
  });

  it("drops Features once the toolbar is narrower than the threshold", () => {
    expect(canFitCompactFeatures(COMPACT_FEATURES_MIN_TOOLBAR_WIDTH - 1)).toBe(false);
    expect(canFitCompactFeatures(120)).toBe(false);
  });

  // The first render happens before onLayout reports anything. Hiding on an
  // unmeasured 0 and popping the button back in a frame later is the more
  // jarring of the two mistakes.
  it("treats an unmeasured width as no constraint", () => {
    expect(canFitCompactFeatures(0)).toBe(true);
    expect(canFitCompactFeatures(-1)).toBe(true);
  });
});
