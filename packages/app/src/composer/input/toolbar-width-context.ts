import { createContext, useContext } from "react";

/**
 * The measured width of the composer toolbar row. Agent controls use this
 * value for the old compact-toolbar gate; it is the row width, not the width
 * left after children have already hidden themselves.
 */
export const ComposerToolbarWidthContext = createContext(0);

export function useComposerToolbarWidth(): number {
  return useContext(ComposerToolbarWidthContext);
}

export const COMPACT_FEATURES_MIN_TOOLBAR_WIDTH = 360;

export function canFitCompactFeatures(toolbarWidth: number): boolean {
  return toolbarWidth <= 0 || toolbarWidth >= COMPACT_FEATURES_MIN_TOOLBAR_WIDTH;
}
