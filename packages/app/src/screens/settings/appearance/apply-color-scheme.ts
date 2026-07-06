import { UnistylesRuntime } from "react-native-unistyles";
import {
  BLACK_TAB_SURFACE_OVERRIDES,
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
const LIGHT_VARIANT_THEMES: Record<LightThemeName, typeof daylightTheme> = {
  daylight: daylightTheme,
  meadow: meadowTheme,
  terracotta: terracottaTheme,
  horizon: horizonTheme,
  powder: powderTheme,
  pastel: pastelTheme,
};

const DARK_VARIANT_THEMES: Record<DarkThemeName, typeof darkTheme> = {
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
  // The `black` key mirrors the dark pick with pure-black chat surfaces. It is
  // consumed only through `ScopedTheme name="black"` (Black tab background
  // setting) and is repainted unconditionally so the scoped pane is always
  // current the moment the setting turns on.
  UnistylesRuntime.updateTheme("black", (t) => {
    if (t.colorScheme !== "dark") return t;
    return {
      ...t,
      colors: { ...darkSource.colors, ...BLACK_TAB_SURFACE_OVERRIDES, syntax: t.colors.syntax },
      shadow: darkSource.shadow,
    };
  });

  if (input.colorSchemeMode === "system") {
    UnistylesRuntime.setAdaptiveThemes(true);
    return;
  }
  UnistylesRuntime.setAdaptiveThemes(false);
  UnistylesRuntime.setTheme(input.colorSchemeMode);
}
