import { useMemo, useRef } from "react";
import { View } from "react-native";
import Svg, { Defs, LinearGradient as SvgLinearGradient, Rect, Stop } from "react-native-svg";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useAppSettings } from "@/hooks/use-settings";
import type { Theme } from "@/styles/theme";

// Peak alpha of the white sheen at its anchor corner. The bubble surfaces are
// 75%-alpha theme tokens, so anything much past ~0.25 stops reading as caught
// light and starts washing out the text behind it.
const SHEEN_PEAK_OPACITY = 0.3;

// Dark surfaces catch a white sheen much harder than light ones, so dark
// themes render the whole overlay at half strength; light themes at full.
// Applied as wrapper-View opacity (multiplies the gradient stops) rather than
// per-stop SVG attributes, which cannot follow the theme on web
// (docs/unistyles.md).
const DARK_MODE_SHEEN_OPACITY = 0.2;

// Resolution-independent drawing space: the Svg stretches to fill its square
// wrapper, so gradient coordinates are fixed viewBox units instead of
// measured pixels. Keeps the proven userSpaceOnUse numeric coords (percentage
// strings don't mirror reliably in react-native-svg) without any onLayout —
// which RN-web only fires on mount/window-resize, so a measured size would
// freeze while a streaming bubble grows.
const VIEWBOX_SIZE = 100;

interface BubbleCornerSheenProps {
  /** Top corner the sheen anchors to: "left" for assistant bubbles, "right" for user bubbles. */
  corner: "left" | "right";
  /**
   * Distance in px between this bubble segment's top edge and the top of the
   * visual bubble group it belongs to (agent-stream/bubble-group-offsets.ts).
   * The gradient square shifts up by this amount so consecutive segments of a
   * split streamed reply paint slices of one continuous group-spanning sheen
   * instead of each restarting it. Defaults to 0 (standalone bubble or the
   * segment that owns the group's top edge).
   */
  offsetTop?: number;
}

interface SheenOverlayProps extends BubbleCornerSheenProps {
  /** Whole-overlay opacity, resolved from the active theme's color scheme. */
  sheenOpacity: number;
  /**
   * Black chat background is on. The chat pane is scoped to the `black` theme
   * (always a dark surface) regardless of the app-wide light/dark mode, but
   * `withUnistyles`/`uniProps` below resolves against the app theme — not the
   * `ScopedTheme`, which silently unwinds for self-re-rendering descendants on
   * web (docs/unistyles.md, black-chat-scope.ts). So when this is set we ignore
   * the resolved `sheenOpacity` and force the dark-surface strength.
   */
  forceDark: boolean;
}

function SheenOverlay({ corner, sheenOpacity, forceDark, offsetTop = 0 }: SheenOverlayProps) {
  const effectiveOpacity = forceDark ? DARK_MODE_SHEEN_OPACITY : sheenOpacity;
  const gradientIdRef = useRef(`bubble-sheen-${Math.random().toString(36).substring(2, 9)}`);
  const gradientId = gradientIdRef.current;
  const fillStyle = useMemo(
    () => [
      corner === "right" ? sheenStylesheet.fillMirrored : sheenStylesheet.fill,
      { opacity: effectiveOpacity },
    ],
    [corner, effectiveOpacity],
  );
  const squareStyle = useMemo(
    () => [sheenStylesheet.square, offsetTop !== 0 && { top: -offsetTop }],
    [offsetTop],
  );
  return (
    <View pointerEvents="none" style={fillStyle}>
      <View style={squareStyle}>
        {/* The wrapper is a bubbleWidth-sided square, so the square viewBox
            maps onto it 1:1 — no measurement needed for the gradient's own
            size, and the sheen's extent is anchored to the bubble's width
            (identical for every segment of a group) rather than any one
            segment's height. */}
        <Svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
          preserveAspectRatio="xMinYMin slice"
        >
          <Defs>
            <SvgLinearGradient
              id={gradientId}
              gradientUnits="userSpaceOnUse"
              x1={0}
              y1={0}
              x2={VIEWBOX_SIZE}
              y2={VIEWBOX_SIZE}
            >
              {/* Transparent by the midpoint: the sheen never reaches past
                  halfway across the square's diagonal. */}
              <Stop offset="0%" stopColor="#ffffff" stopOpacity={SHEEN_PEAK_OPACITY} />
              <Stop offset="50%" stopColor="#ffffff" stopOpacity={0} />
              <Stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
            </SvgLinearGradient>
          </Defs>
          <Rect
            x={0}
            y={0}
            width={VIEWBOX_SIZE}
            height={VIEWBOX_SIZE}
            fill={`url(#${gradientId})`}
          />
        </Svg>
      </View>
    </View>
  );
}

// uniProps resolves a concrete number through React on mount and theme flips —
// unlike a themed stylesheet opacity, there is no class/ShadowRegistry update
// path to go stale (docs/unistyles.md welcome-screen gotcha). colorScheme is a
// plain string, not a color token, so web CSSVars mode is not a concern.
const ThemedSheenOverlay = withUnistyles(SheenOverlay);

const sheenOpacityMapping = (theme: Theme) => ({
  sheenOpacity: theme.colorScheme === "dark" ? DARK_MODE_SHEEN_OPACITY : 1,
});

/**
 * Diagonal white sheen pinned to a chat bubble's top corner — white at the
 * anchor corner fading to fully transparent by the diagonal midpoint.
 * The gradient is always square (1:1) with its side pinned to the bubble's
 * width: the wrapper sizes itself with `width: 100%` + `aspectRatio: 1`, so
 * the square viewBox maps 1:1 with no measurement, the overhang below a short
 * bubble cropped by the bubble's overflow: "hidden". Pure layout — it tracks
 * the bubble as it grows, and its extent doesn't change with message length.
 *
 * A streamed reply split into several butted segments (blockGroupId) passes
 * `offsetTop` on each continuation segment: the same width-sided square is
 * shifted up by the height of the segments above, so the whole group paints
 * one continuous sheen anchored at the group's top edge.
 *
 * Both corners render the identical top-left layout and gradient; the "right"
 * corner mirrors the whole overlay with scaleX(-1). Pinning the clamp view at
 * `right: 0` instead silently landed at the top left on web, so the one
 * layout that provably works is reused and flipped.
 *
 * Render as the bubble's first child so content paints over it. The bubble
 * needs overflow: "hidden" so the square clips to the rounded corners.
 */
export function BubbleCornerSheen({ corner, offsetTop }: BubbleCornerSheenProps) {
  const { settings } = useAppSettings();
  return (
    <ThemedSheenOverlay
      corner={corner}
      offsetTop={offsetTop}
      forceDark={settings.blackTabBackground}
      uniProps={sheenOpacityMapping}
    />
  );
}

const sheenStylesheet = StyleSheet.create({
  fill: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  // Horizontal flip about the wrapper's center: the top-left square lands at
  // the top right, and the gradient's white corner lands with it.
  fillMirrored: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    transform: [{ scaleX: -1 }],
  },
  // A bubbleWidth-sided square anchored at the bubble's top-left; the part
  // extending past a shorter bubble is clipped by the bubble's overflow.
  // Grouped continuation segments override `top` to shift it into group space.
  square: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    aspectRatio: 1,
  },
});
