/**
 * WizardBrandBackdrop — the setup wizard's branded field, shared by the
 * Welcome cover and the Done step.
 *
 * Reproduces the marketing feature graphic's art language
 * (packages/app/demo/assets/feature-graphic.html) from live primitives,
 * layered back-to-front:
 *
 *   1. Theme base — `theme.colors.surface0`, the app background. The bookend
 *      rides whatever theme the app is in (light → near-white field, dark →
 *      near-black field) instead of a fixed dark slab, so the moment feels
 *      continuous with the app rather than a hard splash cut.
 *   2. Dual radial glow — indigo top-right + teal bottom-left — via
 *      react-native-svg RadialGradient (native-safe; CSS radial-gradient is
 *      web-only). Same Svg/RadialGradient/Stop primitives as BlobLoader's
 *      GlowLayer. These are low-alpha brand splashes that tint into the field
 *      on either theme.
 *   3. Faint 44px grid tinted from `theme.colors.foreground` at a whisper
 *      alpha (SVG Pattern, works on both platforms), so the lattice stays
 *      visible on a light field as a faint dark grid and on a dark field as a
 *      faint light one. On web the grid layer gets the feature graphic's radial
 *      CSS mask so it fades at the edges; native has no CSS masks, so it renders
 *      the plain grid slightly dimmed instead (the grid is decorative).
 *   4. `children`, centered above the field.
 *
 * API:
 *   <WizardBrandBackdrop>{hero content}</WizardBrandBackdrop>
 *
 * Pure presentation — no wizard state. Foreground content (logo, text, CTA)
 * reads theme tokens directly so it inverts with the field.
 */

import { useId, type ReactNode } from "react";
import { View } from "react-native";
import Svg, { Defs, Path, Pattern, RadialGradient, Rect, Stop } from "react-native-svg";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { isWeb } from "@/constants/platform";

const GLOW_INDIGO = "#635bff";
const GLOW_TEAL = "#2dd4bf";

const GRID_CELL_PX = 44;
// The grid is tinted from the theme foreground so it reads on both a light and
// a dark field; this whisper alpha keeps it decorative, never a real line.
const GRID_LINE_OPACITY = 0.05;

// Feature graphic mask: radial-gradient(640px 400px at 70% 30%, ...).
const GRID_MASK_CSS = "radial-gradient(640px 400px at 70% 30%, black, transparent 75%)";

// The grid stroke follows the theme foreground. withUnistyles maps the theme
// onto the SVG presentation props (same pattern as OttoLogo's themedForeground),
// so only this leaf repaints on theme change — no React re-render of the tree.
const ThemedGridPath = withUnistyles(Path, (theme: Theme) => ({
  stroke: theme.colors.foreground,
  strokeOpacity: GRID_LINE_OPACITY,
}));

/**
 * The dual glow: two full-bleed rects each filled with an off-center radial
 * gradient. `preserveAspectRatio="none"` stretches the 100×100 viewBox to the
 * screen, turning the circular gradients into soft ellipses like the feature
 * graphic's `radial-gradient(720px 420px at 82% 18%, ...)` pair.
 */
function GlowField({ indigoId, tealId }: { indigoId: string; tealId: string }) {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
      <Defs>
        <RadialGradient id={indigoId} cx="82%" cy="18%" r="65%">
          <Stop offset="0%" stopColor={GLOW_INDIGO} stopOpacity={0.22} />
          <Stop offset="100%" stopColor={GLOW_INDIGO} stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id={tealId} cx="12%" cy="92%" r="60%">
          <Stop offset="0%" stopColor={GLOW_TEAL} stopOpacity={0.1} />
          <Stop offset="100%" stopColor={GLOW_TEAL} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x={0} y={0} width={100} height={100} fill={`url(#${indigoId})`} />
      <Rect x={0} y={0} width={100} height={100} fill={`url(#${tealId})`} />
    </Svg>
  );
}

/**
 * The 44px grid as an SVG pattern (pixel units — no viewBox), so the same
 * implementation renders on web and native. Each tile draws its top and left
 * edge, tiling into a full lattice. The stroke is theme-tinted (ThemedGridPath).
 */
function GridField({ patternId }: { patternId: string }) {
  return (
    <Svg width="100%" height="100%">
      <Defs>
        <Pattern
          id={patternId}
          width={GRID_CELL_PX}
          height={GRID_CELL_PX}
          patternUnits="userSpaceOnUse"
        >
          <ThemedGridPath
            d={`M ${GRID_CELL_PX} 0 H 0 V ${GRID_CELL_PX}`}
            strokeWidth={1}
            fill="none"
          />
        </Pattern>
      </Defs>
      <Rect x={0} y={0} width="100%" height="100%" fill={`url(#${patternId})`} />
    </Svg>
  );
}

export function WizardBrandBackdrop({ children }: { children?: ReactNode }) {
  // Gradient/pattern ids land in the DOM on web, so they must be unique per
  // instance (same treatment as BlobLoader).
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const indigoId = `wizard-glow-indigo-${uid}`;
  const tealId = `wizard-glow-teal-${uid}`;
  const gridId = `wizard-grid-${uid}`;

  return (
    <View style={styles.root}>
      <View style={styles.layer} pointerEvents="none">
        <GlowField indigoId={indigoId} tealId={tealId} />
      </View>
      <View style={styles.gridLayer} pointerEvents="none">
        <GridField patternId={gridId} />
      </View>
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
    overflow: "hidden",
  },
  layer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  gridLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // Web: fade the grid radially like the feature graphic (CSS masks are
    // web-only). Native: no mask — dim the whole grid instead so it stays a
    // whisper without the edge fade.
    ...(isWeb
      ? ({
          maskImage: GRID_MASK_CSS,
          WebkitMaskImage: GRID_MASK_CSS,
        } as object)
      : { opacity: 0.6 }),
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
}));
