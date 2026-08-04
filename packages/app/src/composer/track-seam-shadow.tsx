import { StyleSheet as RNStyleSheet, View } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { SPACING, type Theme } from "@/styles/theme";

// Visible depth of the cast shadow: how far the darkening reaches UP from the
// front card's top edge. A fixed pixel value rather than a spacing token - it
// is a lighting effect sized to read as a card edge, not layout.
const TRACK_SEAM_SHADOW_FALLOFF = 10;
// How much of itself each card tucks behind the next one - the same
// `-spacing[4]` every track carries as `track.marginBottom`.
const TRACK_SEAM_SHADOW_TUCK = SPACING[4];
// The strip runs from the falloff down to the card's own bottom edge, not just
// down to the front card's top edge. The front card has rounded top corners, so
// its two corner notches leave the tucked strip of THIS card visible at the far
// left and right - unshaded, those notches read as bright nicks in the seam.
const TRACK_SEAM_SHADOW_HEIGHT = TRACK_SEAM_SHADOW_FALLOFF + TRACK_SEAM_SHADOW_TUCK;

const TRACK_SEAM_SHADOW_OPACITY_LIGHT = 0.06;
const TRACK_SEAM_SHADOW_OPACITY_DARK = 0.16;

// Gradient stops as fractions of the full strip. Everything below the falloff
// sits under the front card (or in its corner notches) and stays at full
// strength, so the notches match the darkest point of the falloff exactly and
// no band boundary shows.
const shadowStop = (depth: number) => `${((depth / TRACK_SEAM_SHADOW_HEIGHT) * 100).toFixed(2)}%`;
const SHADOW_MID_STOP = shadowStop(TRACK_SEAM_SHADOW_FALLOFF * 0.55);
const SHADOW_FULL_STOP = shadowStop(TRACK_SEAM_SHADOW_FALLOFF);

// `shadowOpacity` is optional with a default for the same reason as
// sidebar-seam-shadow.tsx: withUnistyles supplies it through `uniProps` at
// render time, so it is never passed at the JSX call site.
//
// `layer` makes the gradient id unique per caller (see gradientId below) -
// without it every mounted track shared the literal string
// "composer-track-seam-shadow", and `url(#id)` references resolve against the
// whole document, not the local `<svg>`. Whichever track's Defs happened to
// land first in the DOM "won" for every other track's <Rect>; dismissing that
// first track then left the rest pointing at a gradient that no longer
// existed, so their shadow silently stopped painting.
function TrackSeamShadowGradient({
  layer,
  shadowOpacity = TRACK_SEAM_SHADOW_OPACITY_DARK,
}: {
  layer: number;
  shadowOpacity?: number;
}) {
  const gradientId = `composer-track-seam-shadow-${layer}`;
  return (
    <Svg width="100%" height="100%" preserveAspectRatio="none">
      <Defs>
        <LinearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
          <Stop offset="0%" stopColor="#000000" stopOpacity={0} />
          {/* Mid stop keeps the falloff hugging the seam instead of smearing
              evenly across it - light drops off fast under a card edge. */}
          <Stop offset={SHADOW_MID_STOP} stopColor="#000000" stopOpacity={shadowOpacity * 0.3} />
          <Stop offset={SHADOW_FULL_STOP} stopColor="#000000" stopOpacity={shadowOpacity} />
          <Stop offset="100%" stopColor="#000000" stopOpacity={shadowOpacity} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
    </Svg>
  );
}

// The scheme-dependent strength must flow through React props (withUnistyles +
// uniProps), NOT a `theme.colorScheme` ternary in a StyleSheet factory: on web
// the factory's non-color values are computed once at module load against the
// then-active theme and never re-evaluated on scheme switches, so the branch
// would freeze on the startup scheme (docs/unistyles.md). Same reason the color
// is a literal black rather than a token - an SVG `stopColor` presentation
// attribute cannot resolve a `var()` (see chat-seam-fade.tsx).
const ThemedTrackSeamShadowGradient = withUnistyles(TrackSeamShadowGradient);

const seamShadowOpacityMapping = (theme: Theme) => ({
  shadowOpacity:
    theme.colorScheme === "dark" ? TRACK_SEAM_SHADOW_OPACITY_DARK : TRACK_SEAM_SHADOW_OPACITY_LIGHT,
});

/**
 * The cast shadow along a composer track's bottom seam, so each fanned card
 * reads as lying *under* the one in front of it rather than being pasted flush
 * against it.
 *
 * Every card in the fan tucks `-spacing[4]` of itself behind the next one, so
 * the card in front has its top edge exactly that far above this card's own
 * bottom. The gradient darkens down to that seam and then holds full strength
 * through the tucked remainder, which is mostly hidden but shows through the
 * front card's two rounded top corners. The frontmost card (the composer) has
 * nothing over it and therefore carries no strip.
 *
 * Render as the sibling right AFTER the surface, inside the track's
 * `ChatWidthBounds` - not inside the surface itself. Two reasons, both about
 * the surface's box: an absolutely-positioned child anchors to the padding box,
 * which sits inside the surface's 1px border, and the expandable surfaces clip
 * to that same box with `overflow: "hidden"`. Either way the strip would stop
 * short of the card's real edges. The surface is `alignSelf: "stretch"` inside
 * a `ChatWidthBounds` that has no padding or border of its own, so anchoring
 * here spans the surface's full border box. Being a later sibling also keeps it
 * painted over the card's background and any hover fill.
 */
export function ComposerTrackSeamShadow({ layer }: { layer: number }) {
  return (
    <View style={styles.strip} pointerEvents="none">
      <ThemedTrackSeamShadowGradient layer={layer} uniProps={seamShadowOpacityMapping} />
    </View>
  );
}

const styles = RNStyleSheet.create({
  strip: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: TRACK_SEAM_SHADOW_HEIGHT,
  },
});
