import { StyleSheet as RNStyleSheet, View } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import type { Theme } from "@/styles/theme";

const SEAM_SHADOW_WIDTH = 5;
const SEAM_SHADOW_OPACITY_LIGHT = 0.05;
const SEAM_SHADOW_OPACITY_DARK = 0.2;

interface SeamShadowGradientProps {
  seam: "left" | "right";
  shadowOpacity?: number;
}

function SeamShadowGradient({
  seam,
  shadowOpacity = SEAM_SHADOW_OPACITY_DARK,
}: SeamShadowGradientProps) {
  const gradientId = `sidebar-seam-shadow-${seam}`;
  return (
    <Svg width="100%" height="100%" preserveAspectRatio="none">
      <Defs>
        <LinearGradient
          id={gradientId}
          x1={seam === "left" ? "100%" : "0%"}
          y1="0%"
          x2={seam === "left" ? "0%" : "100%"}
          y2="0%"
        >
          <Stop offset="0%" stopColor="#000000" stopOpacity={0} />
          <Stop offset="100%" stopColor="#000000" stopOpacity={shadowOpacity} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
    </Svg>
  );
}

// The scheme-dependent strength must flow through React props (withUnistyles
// + uniProps), NOT a `theme.colorScheme` ternary in a StyleSheet factory: on
// web the factory's non-color values are computed once at module load against
// the then-active theme and never re-evaluated on scheme switches, so the
// branch freezes on the startup scheme (docs/unistyles.md).
const ThemedSeamShadowGradient = withUnistyles(SeamShadowGradient);

const seamShadowOpacityMapping = (theme: Theme) => ({
  shadowOpacity:
    theme.colorScheme === "dark" ? SEAM_SHADOW_OPACITY_DARK : SEAM_SHADOW_OPACITY_LIGHT,
});

/**
 * Inset shadow along a pinned sidebar's seam with the main view, so the
 * sidebar reads as sitting below it. `seam` names the sidebar edge that
 * touches the main view: "right" for the left sidebar, "left" for the
 * explorer sidebar. Desktop-only callers — the mobile drawers overlay the
 * content and have no seam.
 */
export function SidebarSeamShadow({ seam }: { seam: "left" | "right" }) {
  return (
    <View style={seam === "left" ? LEFT_STRIP_STYLE : RIGHT_STRIP_STYLE} pointerEvents="none">
      <ThemedSeamShadowGradient seam={seam} uniProps={seamShadowOpacityMapping} />
    </View>
  );
}

const styles = RNStyleSheet.create({
  strip: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: SEAM_SHADOW_WIDTH,
  },
  left: {
    left: 0,
  },
  right: {
    right: 0,
  },
});

const LEFT_STRIP_STYLE = [styles.strip, styles.left];
const RIGHT_STRIP_STYLE = [styles.strip, styles.right];
