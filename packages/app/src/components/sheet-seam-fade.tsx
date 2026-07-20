import { useEffect, useMemo } from "react";
import { StyleSheet as RNStyleSheet } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { withUnistyles } from "react-native-unistyles";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import type { Theme } from "@/styles/theme";

const SHEET_SEAM_FADE_HEIGHT = 24;
export const SHEET_SEAM_FADE_DURATION_MS = 160;

export type SheetSeamFadeEdge = "top" | "bottom";
/**
 * Which dialog background the fade dissolves into. The desktop card paints
 * `surface1`; the mobile bottom sheet paints `surface0` (see
 * `adaptive-modal-sheet.tsx`). Unlike the chat pane there is no black scope —
 * dialogs only ever sit on the light/dark theme surfaces.
 */
export type SheetSeamFadeSurface = "surface0" | "surface1";

interface SheetSeamFadeGradientProps {
  edge: SheetSeamFadeEdge;
  color: string;
}

function SheetSeamFadeGradient({ edge, color }: SheetSeamFadeGradientProps) {
  const gradientId = `sheet-seam-fade-${edge}`;
  return (
    <Svg width="100%" height="100%" preserveAspectRatio="none">
      <Defs>
        <LinearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
          <Stop offset="0%" stopColor={color} stopOpacity={edge === "top" ? 1 : 0} />
          {/* Midpoint sits at 50% (not the chat fade's 25%/75%), so the dialog
              fade ramps evenly across the strip instead of dropping off fast. */}
          <Stop offset="50%" stopColor={color} stopOpacity={0.5} />
          <Stop offset="100%" stopColor={color} stopOpacity={edge === "top" ? 0 : 1} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
    </Svg>
  );
}

const ThemedSheetSeamFadeGradient = withUnistyles(SheetSeamFadeGradient);

const surface0Mapping = (theme: Theme) => ({ color: theme.colors.surface0 });
const surface1Mapping = (theme: Theme) => ({ color: theme.colors.surface1 });

/**
 * Inset fade along the top/bottom seam of a dialog's scroll region — the same
 * three-stop gradient as the chat pane's seam fade (`chat-seam-fade.tsx`), so
 * content scrolling past the edge dissolves into the dialog background instead
 * of clipping hard.
 *
 * Render as a later sibling of the scroll view inside a relatively positioned
 * container, and before any web scrollbar overlay so the scrollbar keeps
 * painting above the fade (paint order, no zIndex — same as the chat fades).
 *
 * `visible` cross-fades the strip rather than unmounting it, so an edge that
 * stops overflowing dissolves instead of popping. Pair it with
 * `useScrollEdgeFades` to hide each edge when there is nothing beyond it.
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
  // Seeded from the initial `visible` so a fade that is already needed on the
  // first frame does not animate in from nothing.
  const opacity = useSharedValue(visible ? 1 : 0);
  useEffect(() => {
    const target = visible ? 1 : 0;
    opacity.value = animated
      ? withTiming(target, { duration: SHEET_SEAM_FADE_DURATION_MS })
      : target;
  }, [visible, animated, opacity]);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const stripStyle = useMemo(
    () => [edge === "top" ? TOP_STRIP_STYLE : BOTTOM_STRIP_STYLE, animatedStyle],
    [edge, animatedStyle],
  );

  return (
    <Animated.View style={stripStyle} pointerEvents="none">
      <ThemedSheetSeamFadeGradient
        edge={edge}
        uniProps={surface === "surface0" ? surface0Mapping : surface1Mapping}
      />
    </Animated.View>
  );
}

const styles = RNStyleSheet.create({
  strip: {
    position: "absolute",
    left: 0,
    right: 0,
    height: SHEET_SEAM_FADE_HEIGHT,
  },
  top: {
    top: 0,
  },
  bottom: {
    bottom: 0,
  },
});

const TOP_STRIP_STYLE = [styles.strip, styles.top];
const BOTTOM_STRIP_STYLE = [styles.strip, styles.bottom];
