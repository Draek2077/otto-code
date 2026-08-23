import { describe, expect, it } from "vitest";
import { MIN_TOOLBAR_SCALE } from "./toolbar-scale";
import {
  applyToolbarMeasurement,
  createToolbarMeasurements,
  resolveToolbarLayoutStep,
  TOOLBAR_GROUP_GAP,
  type ToolbarMeasurements,
} from "./toolbar-stage";

const STAGE_ORDER = ["full", "feature-icons", "thinking-icon", "mode-icon", "model-icon"] as const;
const LAST_STAGE = STAGE_ORDER.length - 1;

function measured(input: {
  rowWidth: number;
  leftWidth: number;
  rightWidth: number;
  leftStage?: number;
}): ToolbarMeasurements {
  const measurements = createToolbarMeasurements();
  applyToolbarMeasurement(measurements, "row", input.rowWidth, 0);
  applyToolbarMeasurement(measurements, "right", input.rightWidth, 0);
  applyToolbarMeasurement(measurements, "left", input.leftWidth, input.leftStage ?? 0);
  return measurements;
}

function step(input: {
  rowWidth: number;
  leftWidth: number;
  rightWidth: number;
  stageIndex?: number;
  leftStage?: number;
  measuredNeededByStage?: (number | undefined)[];
  isCompact?: boolean;
}) {
  const stageIndex = input.stageIndex ?? 0;
  return resolveToolbarLayoutStep({
    measurements: measured({ ...input, leftStage: input.leftStage ?? stageIndex }),
    stageIndex,
    measuredNeededByStage: input.measuredNeededByStage ?? [],
    isCompact: input.isCompact ?? false,
  });
}

describe("applyToolbarMeasurement", () => {
  it("ignores sub-pixel jitter that does not change the rounded width", () => {
    // Layout reports fractions that wobble on every resize frame. Each one used
    // to cost a render pass even though the row looked identical.
    const measurements = createToolbarMeasurements();
    expect(applyToolbarMeasurement(measurements, "row", 419.6, 0)).toBe(true);
    expect(measurements.rowWidth).toBe(420);
    expect(applyToolbarMeasurement(measurements, "row", 420.4, 0)).toBe(false);
    expect(applyToolbarMeasurement(measurements, "row", 419.51, 0)).toBe(false);
    expect(applyToolbarMeasurement(measurements, "row", 421, 0)).toBe(true);
  });

  it("re-reports an unchanged left width when the stage moved under it", () => {
    const measurements = createToolbarMeasurements();
    applyToolbarMeasurement(measurements, "left", 320, 1);
    expect(applyToolbarMeasurement(measurements, "left", 320, 1)).toBe(false);
    expect(applyToolbarMeasurement(measurements, "left", 320, 2)).toBe(true);
    expect(measurements.leftStage).toBe(2);
  });

  it("rejects a negative width outright", () => {
    const measurements = createToolbarMeasurements();
    expect(applyToolbarMeasurement(measurements, "row", -1, 0)).toBe(false);
    expect(measurements.rowReady).toBe(false);
  });
});

describe("resolveToolbarLayoutStep", () => {
  it("waits until every slot has reported", () => {
    const measurements = createToolbarMeasurements();
    applyToolbarMeasurement(measurements, "row", 800, 0);
    expect(
      resolveToolbarLayoutStep({
        measurements,
        stageIndex: 0,
        measuredNeededByStage: [],
        isCompact: false,
      }),
    ).toBeNull();
  });

  it("stays full and unscaled while the row fits", () => {
    const result = step({ rowWidth: 900, leftWidth: 400, rightWidth: 120 });
    expect(result?.nextStageIndex).toBe(0);
    expect(result?.scale).toBe(1);
  });

  it("steps one rung at a time, however far the row overflows", () => {
    expect(step({ rowWidth: 200, leftWidth: 700, rightWidth: 120 })?.nextStageIndex).toBe(1);
    expect(
      step({ rowWidth: 200, leftWidth: 700, rightWidth: 120, stageIndex: 1 })?.nextStageIndex,
    ).toBe(2);
  });

  it("refuses to judge a measurement taken at a stage no longer on screen", () => {
    // The guard that keeps the ladder to one control per pass.
    const result = step({
      rowWidth: 200,
      leftWidth: 700,
      rightWidth: 120,
      stageIndex: 2,
      leftStage: 1,
    });
    expect(result?.judgedCurrentStage).toBe(false);
    expect(result?.nextStageIndex).toBe(2);
  });

  it("never scales while a label is still on screen", () => {
    for (let stageIndex = 0; stageIndex < LAST_STAGE; stageIndex += 1) {
      const result = step({ rowWidth: 200, leftWidth: 700, rightWidth: 120, stageIndex });
      expect(result?.scale).toBe(1);
    }
  });

  it("scales only on the last rung, once there is nothing left to drop", () => {
    const result = step({
      rowWidth: 420,
      leftWidth: 400,
      rightWidth: 120,
      stageIndex: LAST_STAGE,
    });
    expect(result?.nextStageIndex).toBe(LAST_STAGE);
    expect(result?.scale).toBeCloseTo(420 / (400 + 120 + TOOLBAR_GROUP_GAP));
  });

  it("holds the flat floor rather than shrinking without limit", () => {
    const result = step({
      rowWidth: 60,
      leftWidth: 700,
      rightWidth: 200,
      stageIndex: LAST_STAGE,
    });
    expect(result?.scale).toBe(MIN_TOOLBAR_SCALE);
  });

  it("restores a label only when a measurement proves the roomier stage fits", () => {
    const measuredNeededByStage = [800, 460, 420];
    expect(
      step({ rowWidth: 500, leftWidth: 300, rightWidth: 112, stageIndex: 2, measuredNeededByStage })
        ?.nextStageIndex,
    ).toBe(1);
    expect(
      step({ rowWidth: 465, leftWidth: 300, rightWidth: 112, stageIndex: 2, measuredNeededByStage })
        ?.nextStageIndex,
    ).toBe(2);
  });

  it("reports the compact feature gate from the row width", () => {
    expect(step({ rowWidth: 900, leftWidth: 200, rightWidth: 120 })?.canFitFeatures).toBe(true);
    expect(step({ rowWidth: 200, leftWidth: 700, rightWidth: 120 })?.canFitFeatures).toBe(false);
  });
});
