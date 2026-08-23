// The composer toolbar degrades in one direction only: it gives up text before
// it gives up size. Each stage below collapses exactly one control group to
// icon-only, in least-consulted-first order, so a narrowing pane loses one
// label at a time instead of flipping the whole row at once. Only after the
// last stage - every control already icon-only - may the row scale uniformly
// (see `input/toolbar-scale.ts`). Scaling while any control still shows text
// is the defect this ladder exists to prevent.
export const COMPOSER_CONTROL_STAGES = [
  "full",
  "feature-icons",
  "thinking-icon",
  "mode-icon",
  "model-icon",
] as const;

export type ComposerControlStage = (typeof COMPOSER_CONTROL_STAGES)[number];

export interface ComposerControlPresentation {
  showModelLabel: boolean;
  showThinkingLabel: boolean;
  showModeLabel: boolean;
  showFeatureLabels: boolean;
}

export const COMPOSER_TOOLBAR_GEOMETRY = {
  controlSize: 28,
  controlGap: 4,
  iconLabelGap: 4,
  labelPadding: 8,
  caretSize: 14,
} as const;

// Retreating to a roomier stage needs more width than staying put, so a pane
// parked on a boundary cannot flip-flop between two stages every frame.
export const COMPOSER_STAGE_HYSTERESIS = 12;

/**
 * Advance or retreat by at most one stage per measurement.
 *
 * Stage selection is driven entirely by measured widths - never by estimated
 * label metrics - because the only reliable answer to "does this fit" is the
 * layout engine's. `measuredNeededByStage` records the intrinsic width the row
 * reported the last time it rendered at each stage, so widening retreats to a
 * stage we have proof will fit rather than to a guess.
 */
export function resolveNextComposerControlStage(input: {
  availableWidth: number;
  neededWidth: number;
  stageIndex: number;
  measuredNeededByStage: readonly (number | undefined)[];
}): number {
  const { availableWidth, neededWidth } = input;
  const lastStage = COMPOSER_CONTROL_STAGES.length - 1;
  const stageIndex = Math.min(Math.max(input.stageIndex, 0), lastStage);
  if (availableWidth <= 0) return stageIndex;

  if (neededWidth > availableWidth) {
    return stageIndex < lastStage ? stageIndex + 1 : stageIndex;
  }

  if (stageIndex > 0) {
    const previousNeeded = input.measuredNeededByStage[stageIndex - 1];
    if (
      previousNeeded !== undefined &&
      availableWidth >= previousNeeded + COMPOSER_STAGE_HYSTERESIS
    ) {
      return stageIndex - 1;
    }
  }

  return stageIndex;
}

export function resolveComposerControlPresentation(
  stage: ComposerControlStage,
): ComposerControlPresentation {
  const reached = COMPOSER_CONTROL_STAGES.indexOf(stage);
  const collapsedAt = (at: ComposerControlStage) => reached < COMPOSER_CONTROL_STAGES.indexOf(at);
  return {
    showFeatureLabels: collapsedAt("feature-icons"),
    showThinkingLabel: collapsedAt("thinking-icon"),
    showModeLabel: collapsedAt("mode-icon"),
    showModelLabel: collapsedAt("model-icon"),
  };
}

/** True once every control is icon-only, which is the only point scaling may begin. */
export function isComposerControlStageFullyCollapsed(stage: ComposerControlStage): boolean {
  return COMPOSER_CONTROL_STAGES.indexOf(stage) >= COMPOSER_CONTROL_STAGES.length - 1;
}
