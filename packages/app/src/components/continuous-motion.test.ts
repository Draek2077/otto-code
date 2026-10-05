import { describe, expect, it } from "vitest";
import { BLOB_LOADER_DURATION_MS, WOBBLE_CYCLES } from "./blob-loader-glow";
import {
  chooseSoftwareStepMs,
  DEFAULT_SOFTWARE_STEP_MS,
  quantizeToStepGrid,
  STEP_GRID_UNIT_MS,
  stepMsForRate,
  steppedTimingFunction,
} from "./continuous-motion";

describe("continuous motion stepping", () => {
  it("keeps every grid step a whole fraction of the plasma ring's segments", () => {
    const wobbleMs = BLOB_LOADER_DURATION_MS / WOBBLE_CYCLES;
    // Four keyframe segments in the wobble; the loop is a whole number of them.
    expect(wobbleMs / 4).toBe(STEP_GRID_UNIT_MS);
    expect(Number.isInteger(BLOB_LOADER_DURATION_MS / STEP_GRID_UNIT_MS)).toBe(true);
    for (const rate of [5, 11, 30, 60]) {
      const step = stepMsForRate(rate);
      expect(Number.isInteger(STEP_GRID_UNIT_MS / step)).toBe(true);
    }
  });

  it("builds per-segment step counts from the chosen step", () => {
    const wobbleMs = BLOB_LOADER_DURATION_MS / WOBBLE_CYCLES;
    expect(steppedTimingFunction(BLOB_LOADER_DURATION_MS, 1, DEFAULT_SOFTWARE_STEP_MS)).toBe(
      "steps(64, end)",
    );
    expect(steppedTimingFunction(wobbleMs, 4, DEFAULT_SOFTWARE_STEP_MS)).toBe("steps(4, end)");
    expect(steppedTimingFunction(10, 1, DEFAULT_SOFTWARE_STEP_MS)).toBe("steps(1, end)");
  });

  it("rounds derived durations onto the step grid", () => {
    expect(quantizeToStepGrid(1250, DEFAULT_SOFTWARE_STEP_MS)).toBe(14 * DEFAULT_SOFTWARE_STEP_MS);
    expect(quantizeToStepGrid(1, DEFAULT_SOFTWARE_STEP_MS)).toBe(DEFAULT_SOFTWARE_STEP_MS);
  });

  it("spends the CPU budget on rate when a software draw is cheap", () => {
    // 120Hz display, animating frames still land on the refresh: draw < 8.3ms.
    const step = chooseSoftwareStepMs({ idleFrameMs: 8.33, animatedFrameMs: 8.4 });
    expect(1000 / step).toBeGreaterThanOrEqual(28);
    expect(1000 / step).toBeLessThanOrEqual(32);
  });

  it("slows down when a software draw is expensive", () => {
    // The Linux capture: frames stretched to ~60ms once anything animated.
    const step = chooseSoftwareStepMs({ idleFrameMs: 8.33, animatedFrameMs: 60 });
    expect(1000 / step).toBeGreaterThanOrEqual(5);
    expect(1000 / step).toBeLessThanOrEqual(6);
  });

  it("never steps faster than the display refreshes", () => {
    const step = chooseSoftwareStepMs({ idleFrameMs: 100, animatedFrameMs: 100 });
    expect(1000 / step).toBeLessThanOrEqual(10);
  });
});
