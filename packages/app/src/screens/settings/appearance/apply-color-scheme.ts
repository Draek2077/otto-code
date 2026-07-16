import { UnistylesRuntime } from "react-native-unistyles";
import { syncBlackChatScopeVars } from "@/styles/black-chat-scope";
import {
  BLACK_LIGHT_VARIANT_COLORS,
  BLACK_VARIANT_OVERRIDES,
  daylightTheme,
  meadowTheme,
  terracottaTheme,
  horizonTheme,
  powderTheme,
  pastelTheme,
  darkTheme,
  darkEvergreenTheme,
  darkZincTheme,
  darkMidnightTheme,
  darkClaudeTheme,
  darkGhosttyTheme,
  darkCyberpunkTheme,
  type LightThemeName,
  type DarkThemeName,
} from "@/styles/theme";

// Source-of-truth palette per variant name. These are never registered with
// Unistyles directly (see `styles/unistyles.ts`) — only copied from here into
// the two registered `light`/`dark` mirror keys by `applyColorScheme` below.
// Exported for resolveVisualizerTheme (visualizer-theme.ts), which resolves
// the active variant the same way to derive the Visualizer guest palette.
export const LIGHT_VARIANT_THEMES: Record<LightThemeName, typeof daylightTheme> = {
  daylight: daylightTheme,
  meadow: meadowTheme,
  terracotta: terracottaTheme,
  horizon: horizonTheme,
  powder: powderTheme,
  pastel: pastelTheme,
};

export const DARK_VARIANT_THEMES: Record<DarkThemeName, typeof darkTheme> = {
  dark: darkTheme,
  evergreen: darkEvergreenTheme,
  zinc: darkZincTheme,
  midnight: darkMidnightTheme,
  claude: darkClaudeTheme,
  ghostty: darkGhosttyTheme,
  cyberpunk: darkCyberpunkTheme,
};

export interface ColorSchemeInput {
  colorSchemeMode: "light" | "dark" | "system";
  lightTheme: LightThemeName;
  darkTheme: DarkThemeName;
  // The OS scheme, used to resolve which spectrum is actually on screen when
  // mode is "system" — the `black` key mirrors the ACTIVE theme's palette
  // (a dark-on-black counterpart of the light pick when light is showing),
  // so its repaint must re-run whenever this flips. Null/undefined (OS scheme
  // unknown) resolves to dark.
  systemColorScheme: "light" | "dark" | null | undefined;
}

/**
 * Repaint the two registered Unistyles theme keys (`light`/`dark`) to match
 * the user's current per-spectrum variant picks, then engage the requested
 * mode. Unistyles' adaptive-theme mechanism hardcodes toggling between the
 * literal keys `light`/`dark` — it cannot target an arbitrary named theme —
 * so "remembering a specific variant per spectrum and auto-swapping on OS
 * scheme change" only works if those two keys are kept perpetually repainted
 * with the user's current picks, regardless of which mode is active. This
 * runs before every mode switch (never after) so there is no frame where a
 * mirror key still shows a stale variant.
 */
export function applyColorScheme(input: ColorSchemeInput): void {
  const lightSource = LIGHT_VARIANT_THEMES[input.lightTheme];
  const darkSource = DARK_VARIANT_THEMES[input.darkTheme];

  // Narrow on the `colorScheme` discriminant before spreading — same reason
  // as `apply-appearance.ts`: the updater must return the theme union, and a
  // spread of the union widens `colorScheme` to `"light" | "dark"`, assignable
  // to neither concrete member. `colors.syntax` is carried forward from the
  // current mirror content (owned by `applyAppearance`, not here) so the two
  // patchers stay commutative regardless of call order.
  UnistylesRuntime.updateTheme("light", (t) => {
    if (t.colorScheme !== "light") return t;
    return {
      ...t,
      colors: { ...lightSource.colors, syntax: t.colors.syntax },
      shadow: lightSource.shadow,
    };
  });
  UnistylesRuntime.updateTheme("dark", (t) => {
    if (t.colorScheme !== "dark") return t;
    return {
      ...t,
      colors: { ...darkSource.colors, syntax: t.colors.syntax },
      shadow: darkSource.shadow,
    };
  });
  // The `black` key mirrors the ACTIVE theme with a dedicated pure-black
  // palette: when the dark spectrum is showing, the dark pick's colors with
  // that variant's black overrides (`BLACK_VARIANT_OVERRIDES`); when the
  // light spectrum is showing, a full dark-on-black counterpart of the light
  // pick (`BLACK_LIGHT_VARIANT_COLORS`) — Sherbet in light mode gets a dark
  // Sherbet chat pane, not the user's dark variant. It is consumed only
  // through `ScopedTheme name="black"` (Black tab background setting) and is
  // repainted unconditionally so the scoped pane is always current the moment
  // the setting turns on.
  const resolvedScheme =
    input.colorSchemeMode === "system"
      ? (input.systemColorScheme ?? "dark")
      : input.colorSchemeMode;
  // The light branch underlays the neutral dark theme's colors for the keys
  // the semantic builder doesn't produce (`palette`; `syntax` is carried from
  // the mirror below) — every visible token comes from the variant palette.
  const blackColors =
    resolvedScheme === "light"
      ? { ...darkTheme.colors, ...BLACK_LIGHT_VARIANT_COLORS[input.lightTheme] }
      : { ...darkSource.colors, ...BLACK_VARIANT_OVERRIDES[input.darkTheme] };
  const blackShadow = resolvedScheme === "light" ? darkTheme.shadow : darkSource.shadow;
  UnistylesRuntime.updateTheme("black", (t) => {
    if (t.colorScheme !== "dark") return t;
    return {
      ...t,
      colors: { ...blackColors, syntax: t.colors.syntax },
      shadow: blackShadow,
    };
  });

  // Web: mirror the freshly repainted `black` variables onto the chat-scope
  // class so wrapped chat panes pick up the new variant (no-op on native).
  syncBlackChatScopeVars();

  if (input.colorSchemeMode === "system") {
    UnistylesRuntime.setAdaptiveThemes(true);
    return;
  }
  UnistylesRuntime.setAdaptiveThemes(false);
  UnistylesRuntime.setTheme(input.colorSchemeMode);
}
