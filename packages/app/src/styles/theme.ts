import { Platform } from "react-native";
import { darkHighlightColors, lightHighlightColors } from "@otto-code/highlight";
import { resolveChatMaxWidth, useIsCompactFormFactor } from "@/constants/layout";
import {
  BLACK_VARIANT_OVERRIDES,
  baseColors,
  buildDarkSemanticColors,
  buildLightSemanticColors,
  darkShadow,
  daylightColors,
  emberDarkColors,
  evergreenDarkColors,
  graphiteDarkColors,
  horizonColors,
  ivoryColors,
  lightShadow,
  meadowColors,
  neotokyoDarkColors,
  neutralDarkColors,
  nightfallDarkColors,
  obsidianDarkColors,
  powderColors,
  pureBlackDarkColors,
  sherbetColors,
  slateDarkColors,
  terracottaColors,
} from "./theme-palettes";
import type { ThemeVariantName } from "./theme-palettes";
// PROVENANCE: Otto's theme set is authored locally in this fork and is NOT
// inherited from upstream Paseo. `light`/`dark` predate the fork, but the theme
// variants (`zinc`/`midnight`/`claude`/`ghostty`, added in 2f77674c5, plus
// `daylight`/`evergreen`/`cyberpunk`/`pastel`, plus
// `meadow`/`terracotta`/`horizon`/`powder`, plus the monochrome
// `ivory`/`obsidian` pair) were created in Otto. During
// upstream merges, resolve
// conflicts in this file in favor of the Otto side - do not pull theme changes
// from Paseo.
//
// Resolving THIS file to ours is only half the job. Anything that styles
// against these tokens (control-geometry.ts, the ui/ components) has to be
// resolved the same way, or upstream geometry ends up driving Otto's palette.
// That is exactly what v0.2.5 did to the segmented control.

export const SPACING = {
  0: 0,
  0.5: 2,
  1: 4,
  1.5: 6,
  2: 8,
  3: 12,
  4: 16,
  6: 24,
  8: 32,
  12: 48,
  16: 64,
  20: 80,
  24: 96,
  32: 128,
} as const;

export const FONT_SIZE = {
  xs: 12,
  code: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  "2xl": 22,
  "3xl": 26,
  "4xl": 34,
} as const;

export const LINE_HEIGHT = {
  diff: 22,
} as const;

export const ICON_SIZE = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
} as const;

function scaleIconSizes(scale: number): Record<keyof typeof ICON_SIZE, number> {
  return {
    xs: ICON_SIZE.xs * scale,
    sm: ICON_SIZE.sm * scale,
    md: ICON_SIZE.md * scale,
    lg: ICON_SIZE.lg * scale,
  };
}

const ICON_SIZE_COMPACT = scaleIconSizes(2);

/**
 * Icon size tokens, scaled on compact form factors (doubled by default - pass
 * `compactScale` for a different multiplier, e.g. `1.5` for controls that sit next
 * to a fixed-chrome sibling and shouldn't double as aggressively). For callers that
 * read `ICON_SIZE` as a static import (a plain `size` prop, not a `StyleSheet.create`
 * value) rather than through the live theme - those never see the runtime
 * `theme.iconSize` patch `applyAppearance` applies, so they need this hook instead.
 * Mirrors `useIsCompactFormFactor`'s pattern rather than calling `useUnistyles()` directly.
 */
export function useIconSize(compactScale: number = 2): Record<keyof typeof ICON_SIZE, number> {
  const isCompact = useIsCompactFormFactor();
  if (!isCompact) return ICON_SIZE;
  return compactScale === 2 ? ICON_SIZE_COMPACT : scaleIconSizes(compactScale);
}

export const FONT_WEIGHT = {
  normal: "normal" as const,
  medium: "500" as const,
  semibold: "600" as const,
  bold: "bold" as const,
} as const;

export const BORDER_RADIUS = {
  none: 0,
  sm: 2,
  base: 4,
  md: 6,
  lg: 8,
  xl: 12,
  "2xl": 16,
  full: 9999,
} as const;

export const BORDER_WIDTH = {
  0: 0,
  1: 1,
  2: 2,
} as const;

export const OPACITY = {
  0: 0,
  50: 0.5,
  100: 1,
} as const;

// Default font stacks. Otto bundles Inter (ui) and JetBrains Mono (mono) - both
// OFL-licensed, free for commercial use - via @expo-google-fonts and loads them
// with `useFonts` in `app/_layout.tsx`, so the family name below is registered on
// every platform (native and web) before first render. Web keeps a CSS fallback
// chain in case the webfont fails to load; native fontFamily takes a single name,
// so it has none. These seed the dynamic `fontFamily` theme token and are the
// fallback an empty user-supplied family resolves to at apply time.
export const DEFAULT_UI_FONT_STACK: string = Platform.select({
  ios: "Inter_400Regular",
  default: "Inter_400Regular",
  web: "Inter_400Regular, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
});

export const DEFAULT_MONO_FONT_STACK: string = Platform.select({
  ios: "JetBrainsMono_400Regular",
  default: "JetBrainsMono_400Regular",
  web: "JetBrainsMono_400Regular, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
});

// `fontSize`, `fontFamily`, `lineHeight`, `iconSize`, and `layout` are deliberately
// widened to plain `number`/`string` (not narrowed by `as const`) so the appearance
// updater can patch them at runtime via `UnistylesRuntime.updateTheme`. The remaining
// tokens keep their literal types.
interface CommonTheme {
  spacing: typeof SPACING;
  fontSize: Record<keyof typeof FONT_SIZE, number>;
  fontFamily: { ui: string; mono: string };
  lineHeight: Record<keyof typeof LINE_HEIGHT, number>;
  iconSize: Record<keyof typeof ICON_SIZE, number>;
  fontWeight: typeof FONT_WEIGHT;
  borderRadius: typeof BORDER_RADIUS;
  borderWidth: typeof BORDER_WIDTH;
  opacity: typeof OPACITY;
  layout: { chatMaxWidth: number | undefined };
}

const commonTheme: CommonTheme = {
  spacing: SPACING,
  fontSize: FONT_SIZE,
  fontFamily: { ui: DEFAULT_UI_FONT_STACK, mono: DEFAULT_MONO_FONT_STACK },
  lineHeight: LINE_HEIGHT,
  iconSize: ICON_SIZE,
  fontWeight: FONT_WEIGHT,
  borderRadius: BORDER_RADIUS,
  borderWidth: BORDER_WIDTH,
  opacity: OPACITY,
  layout: { chatMaxWidth: resolveChatMaxWidth("default") },
};

function buildDarkTheme(semanticColors: ReturnType<typeof buildDarkSemanticColors>) {
  return {
    colorScheme: "dark" as const,
    colors: {
      ...semanticColors,
      palette: baseColors,
      syntax: darkHighlightColors,
    },
    shadow: darkShadow,
    ...commonTheme,
  } as const;
}

function buildLightTheme(semanticColors: ReturnType<typeof buildLightSemanticColors>) {
  return {
    colorScheme: "light" as const,
    colors: {
      ...semanticColors,
      palette: baseColors,
      syntax: lightHighlightColors,
    },
    shadow: lightShadow,
    ...commonTheme,
  } as const;
}

export const darkTheme = buildDarkTheme(neutralDarkColors);
export const darkEvergreenTheme = buildDarkTheme(evergreenDarkColors);
export const darkZincTheme = buildDarkTheme(graphiteDarkColors);
export const darkMidnightTheme = buildDarkTheme(nightfallDarkColors);
export const darkClaudeTheme = buildDarkTheme(emberDarkColors);
export const darkGhosttyTheme = buildDarkTheme(slateDarkColors);
export const darkCyberpunkTheme = buildDarkTheme(neotokyoDarkColors);
export const darkPureBlackTheme = buildDarkTheme(pureBlackDarkColors);
export const darkObsidianTheme = buildDarkTheme(obsidianDarkColors);

export const daylightTheme = buildLightTheme(daylightColors);
export const pastelTheme = buildLightTheme(sherbetColors);
export const meadowTheme = buildLightTheme(meadowColors);
export const terracottaTheme = buildLightTheme(terracottaColors);
export const horizonTheme = buildLightTheme(horizonColors);
export const powderTheme = buildLightTheme(powderColors);
export const ivoryTheme = buildLightTheme(ivoryColors);

// Seed for the `black` Unistyles key: the neutral dark variant on black chat
// surfaces. Runtime repaints replace it with the user's dark-variant pick.
// Annotated as `typeof darkTheme` so the override literals stay widened and
// `UnistylesRuntime.updateTheme("black", ...)` can assign arbitrary variant
// colors back into the mirror.
export const blackTheme: typeof darkTheme = {
  ...darkTheme,
  colors: { ...darkTheme.colors, ...BLACK_VARIANT_OVERRIDES.dark },
};

// Unistyles registers only the adaptive light/dark mirrors plus the scoped
// black chat surface. Named palette variants repaint these keys at runtime.
export const REGISTERED_THEMES = {
  light: daylightTheme,
  dark: darkTheme,
  black: blackTheme,
} as const;

// Keep compatibility with existing code
export const theme = darkTheme;

// Export a union type that works for both themes
export type Theme = typeof darkTheme | typeof daylightTheme;

// Only the adaptive Unistyles theme keys (`light`/`dark`, see
// `styles/unistyles.ts`) - Unistyles' adaptive-theme mechanism hardcodes
// switching between those two literal keys and cannot be pointed at an
// arbitrary named theme. Every variant below (including the neutral
// Daylight/Twilight pair) is exported here as plain data only; nothing but
// `screens/settings/appearance/apply-color-scheme.ts` reads these exports,
// which repaints the two registered `light`/`dark` mirror keys to match
// whichever variant is the user's current per-spectrum preference, for both
// explicit Light/Dark mode and System (adaptive) mode alike.
export const THEME_SWATCHES: Record<ThemeVariantName, string> = {
  daylight: "#f4f4f5", // the neutral light surface - Daylight is picked for being untinted
  pastel: "#e86bb0",
  meadow: "#0f9c5b",
  terracotta: "#dd5b25",
  horizon: "#1a63e6",
  powder: "#6d7ed8",
  ivory: "#ffffff", // Ivory is white paper - the swatch ring is what makes it visible
  dark: "#3f3f46", // the neutral dark surface - Twilight is picked for being untinted
  evergreen: "#16a066",
  zinc: "#808080", // Graphite's swatch stays grey: the theme is monochrome, the cyan is only its accent
  midnight: "#3d7fe0",
  claude: "#f2662f",
  ghostty: "#6ba6ff",
  cyberpunk: "#ff5ad1",
  obsidian: "#000000", // Obsidian is true black, the mirror of Ivory
};

// Compatibility catalog for upstream's theme shortcut and picker contract.
// Otto's richer per-spectrum variant catalogs remain canonical for Appearance;
// these entries preserve the upstream option ordering without replacing them.
export const THEME_OPTIONS = [
  { name: "light", group: "primary", theme: daylightTheme, swatch: "#ffffff" },
  { name: "dark", group: "primary", theme: darkTheme, swatch: "#3f3f46" },
  { name: "auto", group: "primary" },
  { name: "zinc", group: "variant", theme: darkZincTheme, swatch: "#808080" },
  { name: "midnight", group: "variant", theme: darkMidnightTheme, swatch: "#3d7fe0" },
  { name: "claude", group: "variant", theme: darkClaudeTheme, swatch: "#f2662f" },
  { name: "ghostty", group: "variant", theme: darkGhosttyTheme, swatch: "#6ba6ff" },
  { name: "pureBlack", group: "variant", theme: darkPureBlackTheme, swatch: "#000000" },
] as const;

export type ThemePreference = (typeof THEME_OPTIONS)[number]["name"];

export function getNextThemePreference(current: ThemePreference): ThemePreference {
  const currentIndex = THEME_OPTIONS.findIndex((option) => option.name === current);
  const nextIndex = (currentIndex + 1) % THEME_OPTIONS.length;
  return THEME_OPTIONS[nextIndex]?.name ?? THEME_OPTIONS[0].name;
}

// The palette layer lives in theme-palettes.ts; this file stays the import
// surface its consumers use.
export {
  BLACK_LIGHT_VARIANT_COLORS,
  BLACK_VARIANT_OVERRIDES,
  DEFAULT_FONT_CONTRAST,
  accentFillInk,
  baseColors,
  compactFont,
  compactUp,
  resolveInkOverrides,
} from "./theme-palettes";
export type {
  DarkThemeName,
  InkOverrides,
  InkSource,
  LightThemeName,
  ThemeVariantName,
} from "./theme-palettes";
