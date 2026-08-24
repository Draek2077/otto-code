import { useCallback, useEffect, useRef, useState } from "react";
import type { LayoutChangeEvent, ViewStyle } from "react-native";
import { useAnimatedStyle, useSharedValue, type AnimatedStyle } from "react-native-reanimated";
import {
  COMPOSER_CONTROL_STAGES,
  isComposerControlStageFullyCollapsed,
  resolveNextComposerControlStage,
  type ComposerControlStage,
} from "@/composer/agent-controls/layout";
import { canFitCompactFeatures } from "./toolbar-width-context";
import { computeToolbarScale } from "./toolbar-scale";

// Keep a small separation between the left and right toolbar groups when the
// row has enough room. Once it does not, the row degrades one control at a
// time and only then scales uniformly.
export const TOOLBAR_GROUP_GAP = 8;

export interface ToolbarMeasurements {
  rowWidth: number;
  rightWidth: number;
  leftWidth: number;
  /**
   * The stage the left group was rendered at when `leftWidth` was reported.
   * The ladder only steps on a measurement taken at the stage it is judging,
   * which is what keeps it to one control per pass instead of collapsing the
   * whole row against a single stale width.
   */
  leftStage: number;
  rowReady: boolean;
  rightReady: boolean;
  leftReady: boolean;
}

export type ToolbarMeasurementSlot = "row" | "left" | "right";

export function createToolbarMeasurements(): ToolbarMeasurements {
  return {
    rowWidth: 0,
    rightWidth: 0,
    leftWidth: 0,
    leftStage: -1,
    rowReady: false,
    rightReady: false,
    leftReady: false,
  };
}

/**
 * Record a width, reporting whether anything actually moved.
 *
 * Widths are rounded first. Layout reports sub-pixel values that jitter by
 * fractions on a resize without the row looking any different, and every one of
 * those used to cost a render pass; at integer precision they collapse to no
 * change at all.
 */
export function applyToolbarMeasurement(
  measurements: ToolbarMeasurements,
  slot: ToolbarMeasurementSlot,
  rawWidth: number,
  stageIndex: number,
): boolean {
  if (rawWidth < 0) return false;
  const width = Math.round(rawWidth);
  if (slot === "row") {
    if (measurements.rowReady && measurements.rowWidth === width) return false;
    measurements.rowWidth = width;
    measurements.rowReady = true;
    return true;
  }
  if (slot === "right") {
    if (measurements.rightReady && measurements.rightWidth === width) return false;
    measurements.rightWidth = width;
    measurements.rightReady = true;
    return true;
  }
  if (
    measurements.leftReady &&
    measurements.leftWidth === width &&
    measurements.leftStage === stageIndex
  ) {
    return false;
  }
  measurements.leftWidth = width;
  measurements.leftStage = stageIndex;
  measurements.leftReady = true;
  return true;
}

export interface ToolbarLayoutStep {
  /** The stage to render next; equal to the current one when nothing changes. */
  nextStageIndex: number;
  /** 1 unless every control is icon-only and the row still overflows. */
  scale: number;
  canFitFeatures: boolean;
  /** The row's intrinsic width, to record against the stage that produced it. */
  neededWidth: number;
  /** False when the measurement was taken at a stage no longer on screen. */
  judgedCurrentStage: boolean;
}

/**
 * The whole responsive decision, as one pure step.
 *
 * Kept out of the hook so the ladder and the scale can be tested directly
 * rather than through a renderer. Returns null until every slot has reported.
 */
export function resolveToolbarLayoutStep(input: {
  measurements: ToolbarMeasurements;
  stageIndex: number;
  measuredNeededByStage: readonly (number | undefined)[];
  isCompact: boolean;
}): ToolbarLayoutStep | null {
  const { measurements, stageIndex } = input;
  if (!measurements.rowReady || !measurements.rightReady || !measurements.leftReady) return null;
  if (measurements.rowWidth <= 0) return null;

  const availableWidth = measurements.rowWidth;
  const neededWidth = measurements.leftWidth + measurements.rightWidth + TOOLBAR_GROUP_GAP;
  const canFitFeatures = canFitCompactFeatures(availableWidth);

  // Only a width measured at the stage now on screen can decide the next one.
  if (measurements.leftStage !== stageIndex) {
    return {
      nextStageIndex: stageIndex,
      scale: 1,
      canFitFeatures,
      neededWidth,
      judgedCurrentStage: false,
    };
  }

  const nextStageIndex = resolveNextComposerControlStage({
    availableWidth,
    neededWidth,
    stageIndex,
    measuredNeededByStage: input.measuredNeededByStage,
  });

  // Scaling is the last resort, never the first: it may only start once the
  // ladder has run out of labels to drop. Judged on the stage currently on
  // screen, not the one we are stepping to - the next stage's width has not
  // been measured yet, so scaling against it would over-shrink for a pass.
  const stage = COMPOSER_CONTROL_STAGES[stageIndex] ?? COMPOSER_CONTROL_STAGES[0];
  const scale = isComposerControlStageFullyCollapsed(stage)
    ? computeToolbarScale({
        toolbarRowWidth: availableWidth,
        toolbarNeededWidth: neededWidth,
        isCompact: input.isCompact,
      })
    : 1;

  return { nextStageIndex, scale, canFitFeatures, neededWidth, judgedCurrentStage: true };
}

export interface ComposerToolbarLayout {
  /** Whether the compact toolbar has room for its aggregated features button. */
  canFitFeatures: boolean;
  /** How much text the agent controls may render. */
  toolbarStage: ComposerControlStage;
  /**
   * Width compensation plus the uniform shrink, driven from the UI thread. The
   * row is widened by exactly what the scale takes back, so `space-between`
   * still holds the two groups against the row's real edges once transformed.
   */
  toolbarContentStyle: AnimatedStyle<ViewStyle>;
  handleToolbarRowLayout: (event: LayoutChangeEvent) => void;
  handleToolbarLeftLayout: (event: LayoutChangeEvent) => void;
  handleToolbarRightLayout: (event: LayoutChangeEvent) => void;
}

/**
 * Drives the composer toolbar's two-phase responsive behavior.
 *
 * Phase one collapses one control group per measurement pass, least-consulted
 * first, until every control is icon-only. Phase two scales what is left as a
 * single unit. The stage never advances on an estimate: each pass compares the
 * groups' intrinsic width against the row's available width, so the ladder is
 * self-correcting. Because a pass is only judged once the left group has
 * re-reported its width at the current stage, the row steps down one rung per
 * pass rather than collapsing every control against one stale measurement.
 *
 * Resizing has to stay cheap with several composers on screen, so as little of
 * this as possible reaches React. Measurements live in a ref and are evaluated
 * in the layout handler itself, and the only React state is the stage, which
 * changes at most once per rung across the entire width range.
 *
 * The scale and its width compensation ride shared values. Note this buys a
 * real UI-thread hand-off on native only: on web Reanimated applies inline
 * styles from JS like anything else, and the animated property here is `width`,
 * which forces reflow.
 */
export function useComposerToolbarLayout({
  isCompact,
}: {
  isCompact: boolean;
}): ComposerToolbarLayout {
  const measurementsRef = useRef<ToolbarMeasurements>(createToolbarMeasurements());
  // The intrinsic width the row reported the last time it rendered at each
  // stage. Retreating to a roomier stage consults this rather than an
  // estimate, so a label only comes back when a measurement proves it fits.
  const measuredNeededByStageRef = useRef<(number | undefined)[]>([]);
  const [stageIndex, setStageIndex] = useState(0);
  const stageIndexRef = useRef(stageIndex);
  stageIndexRef.current = stageIndex;
  const [canFitFeatures, setCanFitFeatures] = useState(true);

  const scale = useSharedValue(1);
  const contentWidth = useSharedValue(0);

  /**
   * Re-judge the row from whatever has been measured so far. Runs inside the
   * layout handler, so a resize that changes neither the stage nor the feature
   * gate costs one shared-value write and no render at all.
   */
  const evaluate = useCallback(() => {
    const step = resolveToolbarLayoutStep({
      measurements: measurementsRef.current,
      stageIndex: stageIndexRef.current,
      measuredNeededByStage: measuredNeededByStageRef.current,
      isCompact,
    });
    if (!step) return;

    contentWidth.value = measurementsRef.current.rowWidth;
    setCanFitFeatures((previous) =>
      previous === step.canFitFeatures ? previous : step.canFitFeatures,
    );
    if (!step.judgedCurrentStage) return;

    measuredNeededByStageRef.current[stageIndexRef.current] = step.neededWidth;
    scale.value = step.scale;
    if (step.nextStageIndex !== stageIndexRef.current) {
      stageIndexRef.current = step.nextStageIndex;
      setStageIndex(step.nextStageIndex);
    }
  }, [contentWidth, isCompact, scale]);

  const report = useCallback(
    (slot: ToolbarMeasurementSlot, event: LayoutChangeEvent) => {
      const moved = applyToolbarMeasurement(
        measurementsRef.current,
        slot,
        event.nativeEvent.layout.width,
        stageIndexRef.current,
      );
      if (moved) evaluate();
    },
    [evaluate],
  );
  const handleToolbarRowLayout = useCallback(
    (event: LayoutChangeEvent) => report("row", event),
    [report],
  );
  const handleToolbarLeftLayout = useCallback(
    (event: LayoutChangeEvent) => report("left", event),
    [report],
  );
  const handleToolbarRightLayout = useCallback(
    (event: LayoutChangeEvent) => report("right", event),
    [report],
  );

  // A rung that changes nothing on screen - no select-type features to
  // collapse, no mode control, or the compact branch which is icon-only
  // already - moves no pixels, so no layout event ever arrives for it. Without
  // this the ladder waits forever on that rung: it never reaches the last one,
  // never reports fully collapsed, and uniform scaling never runs. One frame
  // after a stage change, adopt the width already in hand as this stage's
  // measurement so the ladder can step again.
  useEffect(() => {
    if (measurementsRef.current.leftStage === stageIndex) return;
    const frame = requestAnimationFrame(() => {
      if (measurementsRef.current.leftStage === stageIndex) return;
      measurementsRef.current.leftStage = stageIndex;
      evaluate();
    });
    return () => cancelAnimationFrame(frame);
  }, [evaluate, stageIndex]);

  const toolbarContentStyle = useAnimatedStyle(() => {
    // Before the first measurement the row has no width to compensate with, so
    // fall back to filling its parent rather than collapsing to zero - the
    // groups still have to lay out for their widths to be reported at all.
    if (contentWidth.value <= 0) return { width: "100%" as const };
    const s = scale.value;
    const width = contentWidth.value / s;
    // One pivot, and it lives here. The row is widened by exactly what the
    // scale takes back, so the scale has to pivot at the row's left edge or
    // the groups stop landing on the row's real edges. `transformOrigin` is
    // not that pivot on any platform: web never receives it (unistyles mangles
    // the array into junk CSS, and reanimated's web update path drops it -
    // verified live, the computed origin stayed at the box center), and on
    // Android Fabric the origin is resolved against the view's measured width
    // when the transform prop lands, which for this row is a width that is
    // itself animated, so it resolves against a stale size and the row settles
    // off-center. The row style therefore declares no origin at all.
    //
    // Baking it in instead: a center-pivot scale leaves the box
    // width * (1 - s) / 2 too far right, so a translateX of that amount
    // re-anchors it at the row's left edge - the left-edge pivot, expressed as
    // a pure reposition of the same uniform scale, and applied in the same
    // worklet as the width it compensates for, so the two can never disagree.
    //
    // Order matters: on web the array serializes to CSS in order and CSS
    // applies right-to-left; on native RN folds the array in listed order, so
    // the same list means the same thing. Either way the translate must come
    // first so it acts in screen space, after the scale. Listed second it
    // would itself be scaled by s and undercompensate by
    // width * (1 - s)^2 / 2.
    return {
      width,
      transform: [{ translateX: (-width * (1 - s)) / 2 }, { scale: s }],
    };
  });

  return {
    canFitFeatures,
    toolbarStage: COMPOSER_CONTROL_STAGES[stageIndex] ?? COMPOSER_CONTROL_STAGES[0],
    toolbarContentStyle,
    handleToolbarRowLayout,
    handleToolbarLeftLayout,
    handleToolbarRightLayout,
  };
}
