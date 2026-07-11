import { useMemo, useRef } from "react";
import { View } from "react-native";
import Svg, { Defs, LinearGradient as SvgLinearGradient, Rect, Stop } from "react-native-svg";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
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
}

interface SheenOverlayProps extends BubbleCornerSheenProps {
  /** Whole-overlay opacity, resolved from the active theme's color scheme. */
  sheenOpacity: number;
}

function SheenOverlay({ corner, sheenOpacity }: SheenOverlayProps) {
  const gradientIdRef = useRef(`bubble-sheen-${Math.random().toString(36).substring(2, 9)}`);
  const gradientId = gradientIdRef.current;
  const fillStyle = useMemo(
    () => [
      corner === "right" ? sheenStylesheet.fillMirrored : sheenStylesheet.fill,
      { opacity: sheenOpacity },
    ],
    [corner, sheenOpacity],
  );
  return (
    <View pointerEvents="none" style={fillStyle}>
      <View style={sheenStylesheet.square}>
        {/* "slice" scales the square viewBox uniformly to cover the whole
            bubble (background-size: cover semantics), anchored top-left: the
            gradient stays 1:1 with its side at max(bubbleWidth, bubbleHeight),
            overflow cropped by the Svg bounds. */}
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
 * The gradient is always square (1:1) and always covers the whole bubble:
 * preserveAspectRatio="slice" scales the square viewBox uniformly to cover
 * (its side lands at max(bubbleWidth, bubbleHeight), the overhang cropped).
 * Pure layout — no measurement — so it tracks the bubble as it grows.
 *
 * Both corners render the identical top-left layout and gradient; the "right"
 * corner mirrors the whole overlay with scaleX(-1). Pinning the clamp view at
 * `right: 0` instead silently landed at the top left on web, so the one
 * layout that provably works is reused and flipped.
 *
 * Render as the bubble's first child so content paints over it. The bubble
 * needs overflow: "hidden" so the square clips to the rounded corners.
 */
export function BubbleCornerSheen({ corner }: BubbleCornerSheenProps) {
  return <ThemedSheenOverlay corner={corner} uniProps={sheenOpacityMapping} />;
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
  // Fills the bubble; the Svg's preserveAspectRatio="slice" owns keeping the
  // gradient square while covering the full area.
  square: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
