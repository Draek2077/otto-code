import { useMemo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

const SHEET_SEAM_FADE_HEIGHT = 24;
export const SHEET_SEAM_FADE_DURATION_MS = 160;

const TRANSITION_STYLE = {
  transitionProperty: "opacity",
  transitionDuration: `${SHEET_SEAM_FADE_DURATION_MS}ms`,
  transitionTimingFunction: "ease",
} as const;
const VISIBLE_STYLE = { ...TRANSITION_STYLE, opacity: 1 };
const HIDDEN_STYLE = { ...TRANSITION_STYLE, opacity: 0 };
// No transition at all rather than a zero duration: a duration change alone can
// still let an in-flight transition finish, which is the pop we are avoiding.
const VISIBLE_INSTANT_STYLE = { opacity: 1 };
const HIDDEN_INSTANT_STYLE = { opacity: 0 };

export type SheetSeamFadeEdge = "top" | "bottom";
/**
 * Which dialog background the fade dissolves into. The desktop card paints
 * `surface1`; the mobile bottom sheet paints `surface0` (see
 * `adaptive-modal-sheet.tsx`). Unlike the chat pane there is no black scope —
 * dialogs only ever sit on the light/dark theme surfaces.
 */
export type SheetSeamFadeSurface = "surface0" | "surface1";

/**
 * Web variant of the dialog scroll-region seam fade (see `sheet-seam-fade.tsx`).
 *
 * Implemented as a CSS gradient in a `StyleSheet.create` class rather than the
 * native SVG gradient: on web every generated class references the theme's CSS
 * variables, so the fade follows live theme switches, which an SVG `stopColor`
 * presentation attribute cannot do (docs/unistyles.md). The transparent stop is
 * a `color-mix` of the same token so the fade stays in-hue instead of
 * interpolating through transparent black.
 *
 * `visible` cross-fades the strip rather than unmounting it, so an edge that
 * stops overflowing dissolves instead of popping. The transition is plain CSS
 * (as in the sheet overlay's own exit fade) rather than Reanimated: the strip's
 * gradient lives in a Unistyles class, and animating opacity in the compositor
 * costs nothing here.
 *
 * `animated` gates the cross-fade. Pass the hook's `hasScrolled` so the strip
 * settles instantly while the scroll view is still measuring itself — bringing
 * a dialog or a tab up should not play an animation — and only animates once
 * the user is driving the scroll.
 */
export function SheetSeamFade({
  edge,
  surface,
  visible = true,
  animated = true,
}: {
  edge: SheetSeamFadeEdge;
  surface: SheetSeamFadeSurface;
  visible?: boolean;
  animated?: boolean;
}) {
  const style = useMemo(() => {
    if (!animated) {
      return [STRIP_STYLES[edge][surface], visible ? VISIBLE_INSTANT_STYLE : HIDDEN_INSTANT_STYLE];
    }
    return [STRIP_STYLES[edge][surface], visible ? VISIBLE_STYLE : HIDDEN_STYLE];
  }, [edge, surface, visible, animated]);
  return <View style={style} pointerEvents="none" />;
}

// Midpoint sits at 50% (not the chat fade's 25%), so the dialog fade ramps
// evenly across the strip instead of dropping off fast.
const fadeGradient = (color: string, direction: "to bottom" | "to top") =>
  `linear-gradient(${direction}, ${color} 0%, ` +
  `color-mix(in srgb, ${color} 50%, transparent) 50%, ` +
  `color-mix(in srgb, ${color} 0%, transparent) 100%)`;

const styles = StyleSheet.create((theme) => ({
  stripTopSurface0: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: SHEET_SEAM_FADE_HEIGHT,
    ...({ backgroundImage: fadeGradient(theme.colors.surface0, "to bottom") } as object),
  },
  stripTopSurface1: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: SHEET_SEAM_FADE_HEIGHT,
    ...({ backgroundImage: fadeGradient(theme.colors.surface1, "to bottom") } as object),
  },
  stripBottomSurface0: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: SHEET_SEAM_FADE_HEIGHT,
    ...({ backgroundImage: fadeGradient(theme.colors.surface0, "to top") } as object),
  },
  stripBottomSurface1: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: SHEET_SEAM_FADE_HEIGHT,
    ...({ backgroundImage: fadeGradient(theme.colors.surface1, "to top") } as object),
  },
}));

const STRIP_STYLES = {
  top: { surface0: styles.stripTopSurface0, surface1: styles.stripTopSurface1 },
  bottom: { surface0: styles.stripBottomSurface0, surface1: styles.stripBottomSurface1 },
} as const;
