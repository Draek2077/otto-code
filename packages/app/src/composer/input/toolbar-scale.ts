// Floor for the uniform toolbar shrink. Below this point the controls become
// harder to use than a wrapped/scrolling alternative, so keep the scale stable
// and let the row clip instead. This is a flat floor on purpose: deriving it
// from the content width made the effective minimum drift with the number of
// controls, so the documented 0.7 was never the enforced one.
export const MIN_TOOLBAR_SCALE = 0.7;

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
  return Math.max(MIN_TOOLBAR_SCALE, toolbarRowWidth / toolbarNeededWidth);
}
