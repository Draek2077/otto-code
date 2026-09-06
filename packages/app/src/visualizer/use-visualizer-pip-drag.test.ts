import { describe, expect, it } from "vitest";
import { rebasePipFractionForContainer, resolvePipOffset } from "./use-visualizer-pip-drag";

describe("rebasePipFractionForContainer", () => {
  const pip = { width: 200, height: 150 };
  const previousContainer = { width: 1000, height: 800 };
  const nextContainer = { width: 1500, height: 1000 };

  it("keeps a left/top PIP inset from those edges", () => {
    const fraction = rebasePipFractionForContainer({
      previousContainer,
      nextContainer,
      previousPip: pip,
      nextPip: pip,
      fraction: { x: 0.25, y: 0.2 },
    });

    expect(resolvePipOffset({ container: nextContainer, pip, fraction })).toEqual({
      left: 200,
      top: 130,
    });
  });

  it("keeps a right/bottom PIP inset from those edges", () => {
    const fraction = rebasePipFractionForContainer({
      previousContainer,
      nextContainer,
      previousPip: pip,
      nextPip: pip,
      fraction: { x: 0.75, y: 0.8 },
    });

    expect(resolvePipOffset({ container: nextContainer, pip, fraction })).toEqual({
      left: 1100,
      top: 720,
    });
  });

  it("clamps to the visible edge when the window becomes too small", () => {
    const fraction = rebasePipFractionForContainer({
      previousContainer,
      nextContainer: { width: 160, height: 100 },
      previousPip: pip,
      nextPip: pip,
      fraction: { x: 1, y: 1 },
    });

    expect(fraction).toEqual({ x: 0, y: 0 });
  });
});
