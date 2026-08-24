import { describe, expect, it } from "vitest";
import { computeToolbarScale, MIN_TOOLBAR_SCALE, MIN_TOOLBAR_SCALE_COMPACT } from "./toolbar-scale";

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

  it("shrinks past the desktop floor on compact rather than clipping a control", () => {
    // The measured Android case: nine 2x controls needing 532dp of row against
    // the 366dp a 411dp-wide phone has. The desktop floor refused this and the
    // row clipped its last control; compact has to give the extra 1.3%.
    expect(
      computeToolbarScale({ toolbarRowWidth: 366, toolbarNeededWidth: 532, isCompact: true }),
    ).toBeCloseTo(366 / 532);
    expect(
      computeToolbarScale({ toolbarRowWidth: 366, toolbarNeededWidth: 532, isCompact: false }),
    ).toBe(MIN_TOOLBAR_SCALE);
  });

  it("still holds a floor on compact", () => {
    expect(
      computeToolbarScale({ toolbarRowWidth: 60, toolbarNeededWidth: 900, isCompact: true }),
    ).toBe(MIN_TOOLBAR_SCALE_COMPACT);
  });
});
