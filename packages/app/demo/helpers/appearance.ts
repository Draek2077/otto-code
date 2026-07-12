import type { Page } from "@playwright/test";

const APP_SETTINGS_KEY = "@otto:app-settings";
const CREATE_AGENT_PREFERENCES_KEY = "@otto:create-agent-preferences";

/**
 * Per-platform capture themes (a user decision, not a default):
 * - desktop/site assets run Neotokyo (theme id "cyberpunk") for a colorful UI,
 * - Android captures run the stock dark theme,
 * - iOS captures run light mode.
 */
export interface DemoAppearanceOptions {
  colorSchemeMode?: "light" | "dark";
  /** Dark theme id; "cyberpunk" is displayed as Neotokyo. */
  darkTheme?: "dark" | "evergreen" | "zinc" | "midnight" | "claude" | "ghostty" | "cyberpunk";
  lightTheme?: "daylight" | "meadow" | "terracotta" | "horizon" | "powder" | "pastel";
  /** Syntax highlighting theme id from @otto-code/highlight (e.g. "neotokyo"). */
  syntaxTheme?: string;
}

/**
 * Stages the device-local appearance the demos capture, plus a presentable
 * composer default (Claude Code instead of the e2e fixture's mock/load-test
 * preset). Must run before the first navigation (addInitScript), because
 * these stores are read from localStorage at boot; this runs after the e2e
 * fixture's init script, so its writes win.
 */
export async function applyDemoAppearance(
  page: Page,
  options?: DemoAppearanceOptions,
): Promise<void> {
  const serverId = process.env.E2E_SERVER_ID;
  if (!serverId) {
    throw new Error("E2E_SERVER_ID is not set (expected from Playwright globalSetup).");
  }
  await page.addInitScript(
    ({ settingsKey, preferencesKey, seededServerId, appearance }) => {
      localStorage.setItem(
        settingsKey,
        JSON.stringify({
          colorSchemeMode: appearance.colorSchemeMode,
          lightTheme: appearance.lightTheme,
          darkTheme: appearance.darkTheme,
          sendBehavior: "interrupt",
          serviceUrlBehavior: "ask",
          terminalScrollbackLines: 10_000,
          uiFontFamily: "",
          monoFontFamily: "",
          uiFontSize: 16,
          codeFontSize: 14,
          syntaxTheme: appearance.syntaxTheme,
        }),
      );
      localStorage.setItem(
        preferencesKey,
        JSON.stringify({
          serverId: seededServerId,
          provider: "claude",
          providerPreferences: { claude: { model: "opus" } },
        }),
      );
    },
    {
      settingsKey: APP_SETTINGS_KEY,
      preferencesKey: CREATE_AGENT_PREFERENCES_KEY,
      seededServerId: serverId,
      appearance: {
        colorSchemeMode: options?.colorSchemeMode ?? "dark",
        darkTheme: options?.darkTheme ?? "dark",
        lightTheme: options?.lightTheme ?? "daylight",
        syntaxTheme: options?.syntaxTheme ?? "default",
      },
    },
  );
}
