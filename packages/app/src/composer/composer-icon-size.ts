import type { IconSizeToken } from "@/components/icons/icon-size";
import { isWeb } from "@/constants/platform";

/**
 * The one size every icon in the composer toolbar row draws at.
 *
 * The row mixes controls from four owners - the attachment button, the usage ring, the
 * agent controls, the voice and send buttons - and the eye reads them as a single strip,
 * so any of them naming its own size shows up immediately as one glyph that is wrong.
 * They all name this instead, and the desktop/compact difference is left to the ladder
 * in `applyAppearance` rather than resolved by hand at any call site.
 *
 * Native takes the larger token because the composer buttons are worked with a thumb
 * there even on a tablet, where the breakpoint still reads as wide.
 */
export const COMPOSER_ICON_SIZE: IconSizeToken = isWeb ? "md" : "lg";
