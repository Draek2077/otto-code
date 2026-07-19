import type { DemoAppearanceOptions } from "./appearance";

/**
 * Site-default capture themes. "twilight" is the dark-spectrum neutral
 * default (theme id "dark", displayed as "Twilight"); "daylight" is the
 * light-spectrum neutral default (theme id + display name both "daylight").
 * Neotokyo (theme id "cyberpunk") is reserved for the dedicated Themes
 * showcase (12-themes) — it's a feature to demo, not a backdrop for every
 * other scenario.
 */
export type DemoThemeName = "twilight" | "daylight";

const THEME_APPEARANCE: Record<DemoThemeName, DemoAppearanceOptions> = {
  twilight: { colorSchemeMode: "dark", darkTheme: "dark", syntaxTheme: "default" },
  daylight: { colorSchemeMode: "light", lightTheme: "daylight", syntaxTheme: "default" },
};

/** Playwright project names carry the theme as a suffix: "demo-twilight", "spread-daylight". */
export function resolveDemoTheme(projectName: string): DemoThemeName {
  return projectName.endsWith("daylight") ? "daylight" : "twilight";
}

export function demoThemeAppearance(theme: DemoThemeName): DemoAppearanceOptions {
  return THEME_APPEARANCE[theme];
}
