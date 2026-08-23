import { createContext, useContext } from "react";
import type { ComposerControlStage } from "@/composer/agent-controls/layout";

/**
 * Whether the compact toolbar has room for its aggregated features button.
 *
 * This is the gate's answer, not the raw row width, on purpose: a width changes
 * every frame of a resize and would re-render every control in the row with it,
 * while the answer flips at most once.
 */
export const ComposerToolbarFeatureFitContext = createContext(true);

export function useComposerToolbarFeatureFit(): boolean {
  return useContext(ComposerToolbarFeatureFitContext);
}

/**
 * How much text the agent controls may render. The composer row owns this: it
 * is the only place that can compare the controls' intrinsic width against the
 * space available, so a control must never decide to collapse itself.
 */
export const ComposerToolbarStageContext = createContext<ComposerControlStage>("full");

export function useComposerToolbarStage(): ComposerControlStage {
  return useContext(ComposerToolbarStageContext);
}

export const COMPACT_FEATURES_MIN_TOOLBAR_WIDTH = 360;

export function canFitCompactFeatures(toolbarWidth: number): boolean {
  return toolbarWidth <= 0 || toolbarWidth >= COMPACT_FEATURES_MIN_TOOLBAR_WIDTH;
}
