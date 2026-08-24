// Floor for the uniform toolbar shrink. Below this point the controls become
// harder to use than a wrapped/scrolling alternative, so keep the scale stable
// and let the row clip instead. This is a flat floor on purpose: deriving it
// from the content width made the effective minimum drift with the number of
// controls, so the documented 0.7 was never the enforced one.
export const MIN_TOOLBAR_SCALE = 0.7;

// Compact form factors draw every control at 2x (`compactUp`), so a phone asks
// for roughly twice the row a desktop does while having less of it to give. One
// flat floor cannot serve both: measured on a 411dp-wide Android device, nine
// icon-only controls need 532dp against 366dp of row, a required scale of
// 0.687, which the desktop floor refused - so the row stopped shrinking and
// clipped the last control, the voice button, by 7dp.
//
// Clipping is the worse of the two failures. A control drawn a few points
// smaller is still readable and still hittable; one with its right edge sliced
// off reads as a broken layout, and on a phone this row is the only place these
// controls live. 0.6 keeps a 56dp compact control at ~34dp, which is still
// larger than the 28dp the same control is drawn at on desktop, and it holds
// the row intact down to roughly a 320dp-wide phone.
export const MIN_TOOLBAR_SCALE_COMPACT = 0.6;

/**
 * Only ever called once every control is already icon-only. Scaling while any
 * control still shows text is the responsive defect this stage exists after,
 * not a state the toolbar may enter - see `toolbar-stage.ts`.
 */
export function computeToolbarScale(input: {
  toolbarRowWidth: number;
  toolbarNeededWidth: number;
  isCompact: boolean;
}): number {
  const { toolbarRowWidth, toolbarNeededWidth } = input;
  if (toolbarRowWidth <= 0 || toolbarNeededWidth <= 0) return 1;
  if (toolbarNeededWidth <= toolbarRowWidth) return 1;
  const floor = input.isCompact ? MIN_TOOLBAR_SCALE_COMPACT : MIN_TOOLBAR_SCALE;
  return Math.max(floor, toolbarRowWidth / toolbarNeededWidth);
}
