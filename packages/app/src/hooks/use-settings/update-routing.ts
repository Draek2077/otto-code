import type { AppSettings, Settings } from "./storage";

// Per-field allowlist for routing merged-Settings updates to the AppSettings
// store. Desktop-owned fields are handled separately by the caller. A missing
// key is silently dropped, so every newly writable AppSettings field belongs
// here and in the focused regression test.
const APP_SETTINGS_UPDATE_KEYS = [
  "colorSchemeMode",
  "lightTheme",
  "darkTheme",
  "language",
  "sendBehavior",
  "serviceUrlBehavior",
  "linkOpenBehavior",
  "terminalScrollbackLines",
  "uiFontFamily",
  "monoFontFamily",
  "uiFontSize",
  "codeFontSize",
  "fontContrast",
  "syntaxTheme",
  "rulerEnabled",
  "rulerColumn",
  "workspaceTitleSource",
  "autoExpandReasoning",
  "chatMetricsBar",
  "wrapCodeLines",
  "interfaceMode",
  "suggestedTasksEnabled",
  "suggestedTasksDefaultMode",
  "verticalTabRailWidth",
  "resourceMonitorEnabled",
  "clientResourceBarAllPages",
  "mountedWorkspaceLimit",
  "toolCallDetailLevel",
  "wakeWordEnabled",
  "wakeWordPhrase",
  "wakeWordSensitivity",
  "wakeWordSilenceTimeoutMs",
  "wakeWordAutoSend",
] as const satisfies readonly (keyof AppSettings)[];

export function collectAppSettingsUpdates(updates: Partial<Settings>): Partial<AppSettings> {
  const appUpdates: Partial<AppSettings> = {};
  for (const key of APP_SETTINGS_UPDATE_KEYS) {
    const value = updates[key];
    if (value !== undefined) {
      // `key` indexes both records identically, but TS cannot correlate the
      // per-key value types across a loop. The `satisfies` above keeps keys honest.
      (appUpdates as Record<string, unknown>)[key] = value;
    }
  }
  return appUpdates;
}
