// The composer toolbar row's measured width, published to whatever renders
// inside it.
//
// `leftContent` (the agent controls) is built in composer/index.tsx but rendered
// inside input.tsx's button row, which is the only place that measures. A
// context rather than a prop because the value has to cross that gap without
// composer/index.tsx — which neither measures nor cares — growing a parameter
// for it.
//
// It is the ROW's width, not its contents'. That distinction is the whole point:
// a control that hides itself when the content no longer fits would make the
// content fit by hiding, then reappear, then overflow again. The container's
// width does not move when a child leaves, so a threshold against it settles.
import { createContext, useContext } from "react";

/** 0 means "not measured yet" — treat it as no constraint, never as zero width. */
export const ComposerToolbarWidthContext = createContext(0);

export function useComposerToolbarWidth(): number {
  return useContext(ComposerToolbarWidthContext);
}

/**
 * Below this row width a compact toolbar is squeezed hard enough that the
 * uniform shrink is approaching its floor, and the Features button — the one
 * control that is purely a door to a sheet, with no state to read at a glance —
 * is the first thing worth surrendering for the room.
 *
 * A single tunable number on purpose. Raise it to drop Features on ordinary
 * phones too; lower it to keep Features until the row is about to clip.
 */
export const COMPACT_FEATURES_MIN_TOOLBAR_WIDTH = 360;

/** Whether the Features control has room in a compact toolbar this wide. */
export function canFitCompactFeatures(toolbarWidth: number): boolean {
  // Unmeasured (0) keeps Features: showing it and hiding on the first layout
  // pass is far less jarring than the reverse.
  return toolbarWidth <= 0 || toolbarWidth >= COMPACT_FEATURES_MIN_TOOLBAR_WIDTH;
}
