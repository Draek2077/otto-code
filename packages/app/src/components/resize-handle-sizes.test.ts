import { describe, expect, it } from "vitest";
import { computeResizeHandleSizes } from "@/components/resize-handle-sizes";

describe("computeResizeHandleSizes", () => {
  it("allows a pane to shrink to zero at the right edge", () => {
    const sizes = computeResizeHandleSizes({
      sizes: [0.25, 0.5, 0.25],
      index: 1,
      deltaRatio: 0.5,
    });

    expect(sizes[0]).toBe(0.25);
    expect(sizes[1]).toBe(0.75);
    expect(sizes[2]).toBe(0);
  });

  it("allows a pane to shrink to zero at the left edge", () => {
    const sizes = computeResizeHandleSizes({
      sizes: [0.25, 0.5, 0.25],
      index: 1,
      deltaRatio: -0.5,
    });

    expect(sizes[0]).toBe(0.25);
    expect(sizes[1]).toBe(0);
    expect(sizes[2]).toBe(0.75);
  });

  it("moves adjacent pane sizes without clamping", () => {
    const sizes = computeResizeHandleSizes({
      sizes: [0.25, 0.5, 0.25],
      index: 1,
      deltaRatio: 0.05,
    });

    expect(sizes[0]).toBe(0.25);
    expect(sizes[1]).toBe(0.55);
    expect(sizes[2]).toBeCloseTo(0.2, 10);
  });

  it("keeps tiny adjacent panes resizable in both directions", () => {
    expect(
      computeResizeHandleSizes({
        sizes: [0.45, 0.05, 0.05, 0.45],
        index: 1,
        deltaRatio: 0.05,
      }),
    ).toEqual([0.45, 0.1, 0, 0.45]);
    expect(
      computeResizeHandleSizes({ sizes: [0.45, 0.05, 0.05, 0.45], index: 1, deltaRatio: -0.05 }),
    ).toEqual([0.45, 0, 0.1, 0.45]);
    expect(
      computeResizeHandleSizes({ sizes: [0.45, 0, 0.1, 0.45], index: 1, deltaRatio: 0.05 }),
    ).toEqual([0.45, 0.05, 0.05, 0.45]);
  });

  it("leaves sizes unchanged when the adjacent pair is invalid", () => {
    expect(
      computeResizeHandleSizes({
        sizes: [0.25, 0.5, 0.25],
        index: 3,
        deltaRatio: 0.25,
      }),
    ).toEqual([0.25, 0.5, 0.25]);
    expect(
      computeResizeHandleSizes({
        sizes: [0.25, 0, 0, 0.75],
        index: 1,
        deltaRatio: 0.25,
      }),
    ).toEqual([0.25, 0, 0, 0.75]);
  });
});
