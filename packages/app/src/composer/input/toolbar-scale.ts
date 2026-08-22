// Floor for the uniform toolbar shrink. Below this point the controls become
// harder to use than a wrapped/scrolling alternative, so keep the scale stable.
const MIN_TOOLBAR_SCALE = 0.7;
const TOOLBAR_BUTTON_WIDTH = 28;
const TOOLBAR_BUTTON_WIDTH_COMPACT = TOOLBAR_BUTTON_WIDTH * 2;

export function computeToolbarScale(input: {
  toolbarRowWidth: number;
  toolbarNeededWidth: number;
  isCompact: boolean;
}): number {
  const { toolbarRowWidth, toolbarNeededWidth, isCompact } = input;
  if (toolbarRowWidth <= 0 || toolbarNeededWidth <= toolbarRowWidth) return 1;

  const toolbarButtonWidth = isCompact ? TOOLBAR_BUTTON_WIDTH_COMPACT : TOOLBAR_BUTTON_WIDTH;
  const toolbarMinScale = Math.max(0, MIN_TOOLBAR_SCALE - toolbarButtonWidth / toolbarNeededWidth);
  return Math.max(toolbarMinScale, toolbarRowWidth / toolbarNeededWidth);
}
