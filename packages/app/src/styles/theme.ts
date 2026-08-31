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
export { buildDarkSemanticColors, buildLightSemanticColors } from "./theme-palettes";
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

// Otto's scale runs a step larger than upstream's at every rung - a deliberate
// look-and-feel choice. `content` is upstream's addition (readable body copy
// gets its own size, separate from `base` chrome text), adopted here on Otto's
// scale rather than at their 15.
export const FONT_SIZE = {
  xs: 12,
  code: 12,
  sm: 14,
  base: 16,
  content: 17,
  lg: 18,
  xl: 20,
  "2xl": 22,
  "3xl": 26,
  "4xl": 34,
} as const;

export const LINE_HEIGHT = {
  diff: 22,
} as const;

/**
 * The sizes an icon may be drawn at, as authored for a pointer.
 *
 * Two ladders, not one. `xs`-`lg` is the app's icon ramp and doubles on a compact
 * form factor, because a 16pt glyph authored for a mouse is a speck under a thumb.
 * `chrome*` is the same ramp for icons that sit inside fixed chrome - title-bar and
 * header buttons, whose surrounding row cannot grow with them - and scales by 1.5
 * instead, which is as far as those glyphs can go before they overrun the bar.
 *
 * Desktop values are identical across the two ladders. They diverge only on compact,
 * which is the whole reason the distinction lives in the token rather than in a
 * multiplier argument at each call site.
 *
 * `mdPlus` is 18, a step the ramp did not have and twenty-two call sites hardcoded
 * anyway - toast status glyphs, card stars and kebabs, modal row leading icons, list
 * type glyphs. A step that many places reach for independently is a real step, and
 * hardcoding it froze every one of them at 18 on a phone.
 *
 * `chromeXs` is 12 - the chrome twin of `xs`, added because the chrome ladder started
 * at 14 and the smallest affordances in a dense transcript (tool-call badge glyphs,
 * disclosure chevrons, metric icons) are authored at 12. Without it those call sites
 * had to choose between doubling to 24 on a phone or gaining 2pt on the desktop.
 *
 * The scaling itself happens in exactly one place, `applyAppearance`. Never scale an
 * icon at a call site.
 */
export const ICON_SIZE = {
  xs: 12,
  sm: 14,
  md: 16,
  mdPlus: 18,
  lg: 20,
  chromeXs: 12,
  chromeSm: 14,
  chromeMd: 16,
  chromeLg: 20,
  chromeXl: 24,
} as const;

/**
 * The compact ladder, resolved exactly as `applyAppearance` resolves it: the ordinary
 * ramp doubles, the `chrome*` ramp grows by half.
 *
 * Two copies of the same resolution, because `applyAppearance` patches the Unistyles
 * theme and this serves the callers that need a number in hand. `apply-appearance.test`
 * asserts the two agree, so a factor changed in one place fails rather than drifts.
 */
export const ICON_SIZE_COMPACT: Record<keyof typeof ICON_SIZE, number> = {
  xs: ICON_SIZE.xs * 2,
  sm: ICON_SIZE.sm * 2,
  md: ICON_SIZE.md * 2,
  mdPlus: ICON_SIZE.mdPlus * 2,
  lg: ICON_SIZE.lg * 2,
  chromeXs: ICON_SIZE.chromeXs * 1.5,
  chromeSm: ICON_SIZE.chromeSm * 1.5,
  chromeMd: ICON_SIZE.chromeMd * 1.5,
  chromeLg: ICON_SIZE.chromeLg * 1.5,
  chromeXl: ICON_SIZE.chromeXl * 1.5,
};

/**
 * The icon ladder resolved to numbers for the current form factor.
 *
 * **Prefer a size token on the icon itself.** `<Search size="md" />` resolves through
 * the live theme and repaints when the breakpoint changes; this hook resolves once per
 * render and only re-resolves because the component re-rendered. It exists for the few
 * places that genuinely need the number rather than the glyph: a glow radius, an
 * optical multiplier, an SVG viewBox, a blob-loader that lays out from it.
 *
 * There is no scale argument any more. A caller that wanted a gentler compact bump
 * asked for `useIconSize(1.5)`, which multiplied every token uniformly and left five
 * different hand-rolled scales across the app. That distinction is now in the token:
 * name a `chrome*` size and get the 1.5 ramp, name an ordinary one and get the double.
 */
export function useIconSize(): Record<keyof typeof ICON_SIZE, number> {
  const isCompact = useIsCompactFormFactor();
  return isCompact ? ICON_SIZE_COMPACT : ICON_SIZE;
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

export function buildDarkTheme(semanticColors: ReturnType<typeof buildDarkSemanticColors>) {
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

export function buildLightTheme(semanticColors: ReturnType<typeof buildLightSemanticColors>) {
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
// Upstream calls the default light theme `lightTheme`; Otto's is Daylight.
export const lightTheme = daylightTheme;
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
// Upstream's plugin theming: a plugin may contribute a palette, which is
// registered as its own pair of Unistyles themes and selected through the
// `plugin` preference. Otto keeps its own theme roster (see the provenance note
// above) and hosts upstream's mechanism on top of it - the plugin themes start
// as Otto's light/dark and are overwritten at runtime when a plugin supplies
// one, so nothing here changes Otto's look until a plugin is active.
export const PLUGIN_THEME_PREFERENCE = "plugin";
export const PLUGIN_THEME_NAMES = {
  light: "pluginLight",
  dark: "pluginDark",
} as const;

export const REGISTERED_THEMES = {
  light: daylightTheme,
  dark: darkTheme,
  black: blackTheme,
  [PLUGIN_THEME_NAMES.light]: daylightTheme,
  [PLUGIN_THEME_NAMES.dark]: darkTheme,
} as const;

// Otto's preference names already match their Unistyles keys, so this is an
// identity map. It exists because upstream's plugin code resolves preferences
// through it rather than assuming the two namespaces line up.
export const THEME_TO_UNISTYLES = {
  light: "light",
  dark: "dark",
  black: "black",
  [PLUGIN_THEME_NAMES.light]: PLUGIN_THEME_NAMES.light,
  [PLUGIN_THEME_NAMES.dark]: PLUGIN_THEME_NAMES.dark,
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
