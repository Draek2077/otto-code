import { describe, expect, it } from "vitest";
import { computeToolbarScale } from "./toolbar-scale";

describe("computeToolbarScale", () => {
  it("recalculates from the new orientation's measurements", () => {
    expect(
      computeToolbarScale({
        toolbarRowWidth: 300,
        toolbarNeededWidth: 460,
        isCompact: true,
      }),
    ).toBeLessThan(1);

    expect(
      computeToolbarScale({
        toolbarRowWidth: 640,
        toolbarNeededWidth: 460,
        isCompact: false,
      }),
    ).toBe(1);
  });

  it("waits for a fresh measurement instead of scaling from stale geometry", () => {
    expect(
      computeToolbarScale({
        toolbarRowWidth: 0,
        toolbarNeededWidth: 460,
        isCompact: true,
      }),
    ).toBe(1);
  });
});
