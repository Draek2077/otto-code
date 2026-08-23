import { describe, expect, it } from "vitest";
import { computeToolbarScale, MIN_TOOLBAR_SCALE } from "./toolbar-scale";

describe("computeToolbarScale", () => {
  it("keeps a full-size toolbar when the measured row fits", () => {
    expect(
      computeToolbarScale({ toolbarRowWidth: 500, toolbarNeededWidth: 420, isCompact: false }),
    ).toBe(1);
  });

  it("scales the complete toolbar when its groups overlap", () => {
    expect(
      computeToolbarScale({ toolbarRowWidth: 300, toolbarNeededWidth: 420, isCompact: false }),
    ).toBeCloseTo(300 / 420);
  });

  it("does not use stale measurements before the row reports its width", () => {
    expect(
      computeToolbarScale({ toolbarRowWidth: 0, toolbarNeededWidth: 420, isCompact: false }),
    ).toBe(1);
  });

  it("holds a flat floor that does not drift with the number of controls", () => {
    const narrow = computeToolbarScale({
      toolbarRowWidth: 60,
      toolbarNeededWidth: 420,
      isCompact: false,
    });
    const wide = computeToolbarScale({
      toolbarRowWidth: 60,
      toolbarNeededWidth: 900,
      isCompact: false,
    });
    expect(narrow).toBe(MIN_TOOLBAR_SCALE);
    expect(wide).toBe(MIN_TOOLBAR_SCALE);
  });
});
