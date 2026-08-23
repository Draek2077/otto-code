import { describe, expect, it } from "vitest";
import {
  COMPOSER_CONTROL_STAGES,
  COMPOSER_STAGE_HYSTERESIS,
  COMPOSER_TOOLBAR_GEOMETRY,
  isComposerControlStageFullyCollapsed,
  resolveComposerControlPresentation,
  resolveNextComposerControlStage,
} from "./layout";

const NO_MEASUREMENTS: readonly (number | undefined)[] = [];

describe("composer control stages", () => {
  it("collapses exactly one control group per stage, least-consulted first", () => {
    expect(COMPOSER_CONTROL_STAGES).toEqual([
      "full",
      "feature-icons",
      "thinking-icon",
      "mode-icon",
      "model-icon",
    ]);

    expect(resolveComposerControlPresentation("full")).toEqual({
      showFeatureLabels: true,
      showThinkingLabel: true,
      showModeLabel: true,
      showModelLabel: true,
    });
    expect(resolveComposerControlPresentation("feature-icons")).toEqual({
      showFeatureLabels: false,
      showThinkingLabel: true,
      showModeLabel: true,
      showModelLabel: true,
    });
    expect(resolveComposerControlPresentation("thinking-icon")).toEqual({
      showFeatureLabels: false,
      showThinkingLabel: false,
      showModeLabel: true,
      showModelLabel: true,
    });
    expect(resolveComposerControlPresentation("mode-icon")).toEqual({
      showFeatureLabels: false,
      showThinkingLabel: false,
      showModeLabel: false,
      showModelLabel: true,
    });
    expect(resolveComposerControlPresentation("model-icon")).toEqual({
      showFeatureLabels: false,
      showThinkingLabel: false,
      showModeLabel: false,
      showModelLabel: false,
    });
  });

  it("only reports fully collapsed once every label is gone, which is when scaling may start", () => {
    expect(isComposerControlStageFullyCollapsed("full")).toBe(false);
    expect(isComposerControlStageFullyCollapsed("feature-icons")).toBe(false);
    expect(isComposerControlStageFullyCollapsed("thinking-icon")).toBe(false);
    expect(isComposerControlStageFullyCollapsed("mode-icon")).toBe(false);
    expect(isComposerControlStageFullyCollapsed("model-icon")).toBe(true);
  });

  it("advances a single stage per measurement rather than collapsing the row at once", () => {
    // A row far too narrow for its controls still only steps down one rung; the
    // next pass re-measures at the new stage before deciding again.
    expect(
      resolveNextComposerControlStage({
        availableWidth: 120,
        neededWidth: 900,
        stageIndex: 0,
        measuredNeededByStage: NO_MEASUREMENTS,
      }),
    ).toBe(1);
    expect(
      resolveNextComposerControlStage({
        availableWidth: 120,
        neededWidth: 820,
        stageIndex: 1,
        measuredNeededByStage: NO_MEASUREMENTS,
      }),
    ).toBe(2);
  });

  it("stops at the last stage instead of stepping past it", () => {
    const lastStage = COMPOSER_CONTROL_STAGES.length - 1;
    expect(
      resolveNextComposerControlStage({
        availableWidth: 120,
        neededWidth: 900,
        stageIndex: lastStage,
        measuredNeededByStage: NO_MEASUREMENTS,
      }),
    ).toBe(lastStage);
  });

  it("holds the current stage while the row fits", () => {
    expect(
      resolveNextComposerControlStage({
        availableWidth: 600,
        neededWidth: 420,
        stageIndex: 2,
        measuredNeededByStage: [800, 700, 420],
      }),
    ).toBe(2);
  });

  it("restores a label only when a measurement proves the roomier stage fits", () => {
    // 500 is wider than the row needed at stage 1, by more than the hysteresis.
    expect(
      resolveNextComposerControlStage({
        availableWidth: 500,
        neededWidth: 420,
        stageIndex: 2,
        measuredNeededByStage: [800, 460, 420],
      }),
    ).toBe(1);
    // Just inside the hysteresis band: stay put rather than flip-flop.
    expect(
      resolveNextComposerControlStage({
        availableWidth: 460 + COMPOSER_STAGE_HYSTERESIS - 1,
        neededWidth: 420,
        stageIndex: 2,
        measuredNeededByStage: [800, 460, 420],
      }),
    ).toBe(2);
  });

  it("never retreats on a stage it has not measured yet", () => {
    expect(
      resolveNextComposerControlStage({
        availableWidth: 5000,
        neededWidth: 420,
        stageIndex: 2,
        measuredNeededByStage: [800, undefined, 420],
      }),
    ).toBe(2);
  });

  it("does not act before the row reports a width", () => {
    expect(
      resolveNextComposerControlStage({
        availableWidth: 0,
        neededWidth: 420,
        stageIndex: 1,
        measuredNeededByStage: NO_MEASUREMENTS,
      }),
    ).toBe(1);
  });

  it("gives every toolbar control one shell", () => {
    expect(COMPOSER_TOOLBAR_GEOMETRY).toEqual({
      controlSize: 28,
      controlGap: 4,
      iconLabelGap: 4,
      labelPadding: 8,
      caretSize: 14,
    });
  });
});
