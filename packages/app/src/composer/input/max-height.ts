/** One line of text — the input never collapses below this. */
export const MIN_INPUT_HEIGHT = 32;

/**
 * Cap used until a viewport has been measured, and by hosts that never report
 * one (the setup dialog, the new-workspace screen). Roughly seven lines.
 */
export const DEFAULT_MAX_INPUT_HEIGHT = 160;

/**
 * Share of its viewport the whole composer may occupy. Compact form factors get
 * a smaller share: the on-screen keyboard already covers most of the pane, so a
 * half-height composer would leave no transcript at all.
 */
const MAX_COMPOSER_VIEWPORT_RATIO = 0.5;
const MAX_COMPOSER_VIEWPORT_RATIO_COMPACT = 0.4;

/**
 * The composer's non-input chrome, taken out of that share so the toolbar row —
 * and with it the send button — always lands inside the measured viewport: the
 * wrapper's vertical padding (2 x spacing[4] = 32), the gap above the toolbar
 * (spacing[3] = 12), its 1px border top and bottom, and one toolbar button's
 * height (28) less the row's -6 bleed. Literals rather than theme reads so this
 * stays a pure module — layout math, not style values (see docs/unistyles.md,
 * "Hard-coded constants for genuinely static values").
 */
const COMPOSER_CHROME_HEIGHT = 32 + 12 + 2 + 22;

interface MaxInputHeightInput {
  /**
   * Height of the box the composer has to fit inside — the chat pane where the
   * host measures one, the window otherwise. Never a content height: this must
   * not grow with the input, or the cap would chase the text it is capping.
   */
  viewportHeight: number;
  isCompact: boolean;
}

/**
 * Caps how tall the text input may grow. Past this the input scrolls internally
 * instead of pushing the toolbar out of the pane — which is what a few hundred
 * pasted lines used to do.
 */
export function resolveMaxInputHeight(input: MaxInputHeightInput): number {
  const { viewportHeight, isCompact } = input;
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    return DEFAULT_MAX_INPUT_HEIGHT;
  }
  const ratio = isCompact ? MAX_COMPOSER_VIEWPORT_RATIO_COMPACT : MAX_COMPOSER_VIEWPORT_RATIO;
  const share = Math.floor(viewportHeight * ratio) - COMPOSER_CHROME_HEIGHT;
  return Math.max(MIN_INPUT_HEIGHT, share);
}
