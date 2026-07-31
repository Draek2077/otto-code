import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import type { Theme } from "@/styles/theme";

// Height of the cast-shadow strip. Deliberately a fixed pixel value rather than
// a spacing token: it is a lighting effect sized to read as a card edge, not
// layout.
const TRACK_SEAM_SHADOW_HEIGHT = 10;
const TRACK_SEAM_SHADOW_OPACITY_LIGHT = 0.12;
const TRACK_SEAM_SHADOW_OPACITY_DARK = 0.32;

// `shadowOpacity` is optional with a default for the same reason as
// sidebar-seam-shadow.tsx: withUnistyles supplies it through `uniProps` at
// render time, so it is never passed at the JSX call site.
function TrackSeamShadowGradient({
  shadowOpacity = TRACK_SEAM_SHADOW_OPACITY_DARK,
}: {
  shadowOpacity?: number;
}) {
  const gradientId = "composer-track-seam-shadow";
  return (
    <Svg width="100%" height="100%" preserveAspectRatio="none">
      <Defs>
        <LinearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
          <Stop offset="0%" stopColor="#000000" stopOpacity={0} />
          {/* Mid stop keeps the falloff hugging the seam instead of smearing
              evenly across all 10px — light drops off fast under a card edge. */}
          <Stop offset="55%" stopColor="#000000" stopOpacity={shadowOpacity * 0.3} />
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
// is a literal black rather than a token — an SVG `stopColor` presentation
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
 * Every card in the fan tucks `-spacing[4]` of itself behind the next one
 * (`track.marginBottom` in each track's stylesheet), so the card in front has
 * its top edge exactly `spacing[4]` above this card's own bottom — that is
 * where the strip sits, and the gradient darkens toward it. The frontmost card
 * (the composer) has nothing over it and therefore carries no strip.
 *
 * Render as the LAST child of a track's surface view so it paints over the
 * card's own background and any hover fill.
 */
export function ComposerTrackSeamShadow() {
  return (
    <View style={styles.strip} pointerEvents="none">
      <ThemedTrackSeamShadowGradient uniProps={seamShadowOpacityMapping} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  strip: {
    position: "absolute",
    left: 0,
    right: 0,
    // Lines the strip's bottom edge up with the top edge of the card in front:
    // the same `spacing[4]` each track tucks itself by.
    bottom: theme.spacing[4],
    height: TRACK_SEAM_SHADOW_HEIGHT,
  },
}));
