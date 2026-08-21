// Floor for the uniform toolbar shrink. Below this, buttons/icons get too small
// to hit; the row is allowed to overflow-clip instead of scaling further.
const MIN_TOOLBAR_SCALE = 0.7;
// One toolbar button's footprint (matches attachButton/voiceButton/sendButton/
// etc. - see `compactUp(28)` in input.tsx) - the minimum shrink is pushed this
// much further so there's always at least one whole icon's worth of extra room
// at the narrowest size, rather than clipping at the MIN_TOOLBAR_SCALE edge.
const TOOLBAR_BUTTON_WIDTH = 28;
const TOOLBAR_BUTTON_WIDTH_COMPACT = TOOLBAR_BUTTON_WIDTH * 2;

export function computeToolbarScale(input: {
  toolbarRowWidth: number;
  toolbarNeededWidth: number;
  isCompact: boolean;
}): number {
  const { toolbarRowWidth, toolbarNeededWidth, isCompact } = input;
  if (toolbarRowWidth <= 0 || toolbarNeededWidth <= toolbarRowWidth) {
    return 1;
  }
  const toolbarButtonWidth = isCompact ? TOOLBAR_BUTTON_WIDTH_COMPACT : TOOLBAR_BUTTON_WIDTH;
  const toolbarMinScale = Math.max(0, MIN_TOOLBAR_SCALE - toolbarButtonWidth / toolbarNeededWidth);
  return Math.max(toolbarMinScale, toolbarRowWidth / toolbarNeededWidth);
}
