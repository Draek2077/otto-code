import { isSyntaxThemeId, type SyntaxThemeId } from "@otto-code/highlight";
import type { QueryClient } from "@tanstack/react-query";
import type { ChatWidth } from "@/constants/layout";
import type { DesktopSettings } from "@/desktop/settings/desktop-settings";
import { parseAppLanguage, type AppLanguage } from "@/i18n/locales";
import type { LightThemeName, DarkThemeName } from "@/styles/theme";

export const APP_SETTINGS_KEY = "@otto:app-settings";
export const APP_SETTINGS_QUERY_KEY = ["app-settings"];
const LEGACY_SETTINGS_KEY = "@otto:settings";

export type SendBehavior = "interrupt" | "queue";
export type ReleaseChannel = "stable" | "beta";
export type ServiceUrlBehavior = "ask" | "in-app" | "external";
export type WorkspaceTitleSource = "title" | "branch";
export type PreviewServerCloseBehavior = "keep-running" | "stop-on-close";
export type WorkspaceToolsPlacement = "header" | "workspaceList";
export type ColorSchemeMode = "light" | "dark" | "system";

const LIGHT_THEME_NAMES: readonly LightThemeName[] = [
  "daylight",
  "meadow",
  "terracotta",
  "horizon",
  "powder",
  "pastel",
];
const DARK_THEME_NAMES: readonly DarkThemeName[] = [
  "dark",
  "evergreen",
  "zinc",
  "midnight",
  "claude",
  "ghostty",
  "cyberpunk",
];
const VALID_LIGHT_THEMES = new Set<string>(LIGHT_THEME_NAMES);
const VALID_DARK_THEMES = new Set<string>(DARK_THEME_NAMES);
const VALID_COLOR_SCHEME_MODES = new Set<ColorSchemeMode>(["light", "dark", "system"]);
const VALID_SERVICE_URL_BEHAVIORS = new Set<ServiceUrlBehavior>(["ask", "in-app", "external"]);
const VALID_WORKSPACE_TITLE_SOURCES = new Set<WorkspaceTitleSource>(["title", "branch"]);
const VALID_WORKSPACE_TOOLS_PLACEMENTS = new Set<WorkspaceToolsPlacement>([
  "header",
  "workspaceList",
]);
const VALID_CHAT_WIDTHS = new Set<ChatWidth>(["default", "wide", "full"]);
export const DEFAULT_TERMINAL_SCROLLBACK_LINES = 10_000;
export const MIN_TERMINAL_SCROLLBACK_LINES = 0;
export const MAX_TERMINAL_SCROLLBACK_LINES = 1_000_000;
export const DEFAULT_UI_FONT_SIZE = 16; // == FONT_SIZE.base
export const MIN_UI_FONT_SIZE = 11;
export const MAX_UI_FONT_SIZE = 24;
export const DEFAULT_CODE_FONT_SIZE = 12; // == FONT_SIZE.code
export const MIN_CODE_FONT_SIZE = 9;
export const MAX_CODE_FONT_SIZE = 22; // line-height 1.5×22=33 stays safe
export const MAX_FONT_FAMILY_LENGTH = 200;

export interface AppSettings {
  colorSchemeMode: ColorSchemeMode;
  lightTheme: LightThemeName;
  darkTheme: DarkThemeName;
  language: AppLanguage;
  sendBehavior: SendBehavior;
  serviceUrlBehavior: ServiceUrlBehavior;
  terminalScrollbackLines: number;
  uiFontFamily: string; // "" = platform default UI stack
  monoFontFamily: string; // "" = platform default mono stack
  uiFontSize: number; // clamped px, default 16
  codeFontSize: number; // clamped px, default 12
  syntaxTheme: SyntaxThemeId; // default "default"
  workspaceTitleSource: WorkspaceTitleSource;
  previewServerCloseBehavior: PreviewServerCloseBehavior;
  previewAutoStartOnRestore: boolean;
  compactSidebarTopSpacing: boolean;
  workspaceToolsPlacement: WorkspaceToolsPlacement;
  chatWidth: ChatWidth;
}

export interface Settings extends AppSettings {
  manageBuiltInDaemon: boolean;
  releaseChannel: ReleaseChannel;
}

export const DEFAULT_CLIENT_SETTINGS: AppSettings = {
  colorSchemeMode: "system",
  lightTheme: "daylight",
  darkTheme: "dark",
  language: "system",
  sendBehavior: "interrupt",
  serviceUrlBehavior: "ask",
  terminalScrollbackLines: DEFAULT_TERMINAL_SCROLLBACK_LINES,
  uiFontFamily: "",
  monoFontFamily: "",
  uiFontSize: DEFAULT_UI_FONT_SIZE,
  codeFontSize: DEFAULT_CODE_FONT_SIZE,
  syntaxTheme: "default",
  workspaceTitleSource: "title",
  previewServerCloseBehavior: "keep-running",
  previewAutoStartOnRestore: false,
  compactSidebarTopSpacing: false,
  workspaceToolsPlacement: "header",
  chatWidth: "default",
};
export const DEFAULT_APP_SETTINGS: Settings = {
  ...DEFAULT_CLIENT_SETTINGS,
  manageBuiltInDaemon: true,
  releaseChannel: "stable",
};

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface DesktopSettingsBridge {
  isElectron(): boolean;
  loadDesktopSettings(): Promise<DesktopSettings>;
  migrateLegacyDesktopSettings(input: {
    manageBuiltInDaemon?: boolean;
    releaseChannel?: ReleaseChannel;
  }): Promise<void>;
}

export interface SettingsDeps {
  storage: KeyValueStorage;
  desktop: DesktopSettingsBridge;
}

export async function saveAppSettings(input: {
  queryClient: QueryClient;
  updates: Partial<AppSettings>;
  deps: SettingsDeps;
}): Promise<void> {
  const current =
    input.queryClient.getQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY) ??
    (await loadAppSettingsFromStorage(input.deps));
  const next = { ...current, ...input.updates };
  input.queryClient.setQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY, next);
  await input.deps.storage.setItem(APP_SETTINGS_KEY, JSON.stringify(next));
}

export async function loadAppSettingsFromStorage(deps: SettingsDeps): Promise<AppSettings> {
  try {
    const stored = await deps.storage.getItem(APP_SETTINGS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Record<string, unknown>;
      return {
        ...DEFAULT_CLIENT_SETTINGS,
        ...migrateLegacyThemeField(parsed),
        ...pickAppSettings(parsed as Partial<AppSettings>),
      };
    }

    const legacyStored = await deps.storage.getItem(LEGACY_SETTINGS_KEY);
    if (legacyStored) {
      const legacyParsed = JSON.parse(legacyStored) as Record<string, unknown>;
      const next = {
        ...DEFAULT_CLIENT_SETTINGS,
        ...pickAppSettingsFromLegacy(legacyParsed),
      } satisfies AppSettings;
      await deps.storage.setItem(APP_SETTINGS_KEY, JSON.stringify(next));
      return next;
    }

    await deps.storage.setItem(APP_SETTINGS_KEY, JSON.stringify(DEFAULT_CLIENT_SETTINGS));
    return DEFAULT_CLIENT_SETTINGS;
  } catch (error) {
    console.error("[AppSettings] Failed to load settings:", error);
    throw error;
  }
}

export async function loadSettingsFromStorage(deps: SettingsDeps): Promise<Settings> {
  const legacyDesktopSettings = deps.desktop.isElectron()
    ? await loadLegacyDesktopSettingsFromStorage(deps.storage)
    : null;
  const appSettings = await loadAppSettingsFromStorage(deps);

  if (!deps.desktop.isElectron()) {
    return {
      ...DEFAULT_APP_SETTINGS,
      ...appSettings,
    };
  }

  if (legacyDesktopSettings) {
    await deps.desktop.migrateLegacyDesktopSettings(legacyDesktopSettings);
  }

  const desktopSettings = await deps.desktop.loadDesktopSettings();
  return {
    ...DEFAULT_APP_SETTINGS,
    ...appSettings,
    manageBuiltInDaemon: desktopSettings.daemon.manageBuiltInDaemon,
    releaseChannel: desktopSettings.releaseChannel,
  };
}

// Migrates a stored `theme: ThemeName | "auto"` value (the schema this app used
// before the mode/variant split) into the new `colorSchemeMode`/`lightTheme`/
// `darkTheme` fields. Only runs when the new fields are entirely absent, so it
// never re-fires on already-migrated data. Operates on the raw untyped parse
// result (not `Partial<AppSettings>`) since `theme` isn't part of the current
// schema at all anymore.
function migrateLegacyThemeField(stored: Record<string, unknown>): Partial<AppSettings> {
  const legacyTheme = stored.theme;
  if (typeof legacyTheme !== "string" || stored.colorSchemeMode !== undefined) {
    return {};
  }
  if (legacyTheme === "auto") {
    return { colorSchemeMode: "system" };
  }
  if (legacyTheme === "light") {
    // The plain neutral "Light" theme was retired; Daylight absorbs it.
    return { colorSchemeMode: "light", lightTheme: "daylight" };
  }
  if (VALID_LIGHT_THEMES.has(legacyTheme)) {
    return { colorSchemeMode: "light", lightTheme: legacyTheme as LightThemeName };
  }
  if (VALID_DARK_THEMES.has(legacyTheme)) {
    return { colorSchemeMode: "dark", darkTheme: legacyTheme as DarkThemeName };
  }
  return {};
}

function pickThemeAndBehaviorSettings(stored: Partial<AppSettings>): Partial<AppSettings> {
  const result: Partial<AppSettings> = {};
  if (
    typeof stored.colorSchemeMode === "string" &&
    VALID_COLOR_SCHEME_MODES.has(stored.colorSchemeMode)
  ) {
    result.colorSchemeMode = stored.colorSchemeMode;
  }
  if (typeof stored.lightTheme === "string" && VALID_LIGHT_THEMES.has(stored.lightTheme)) {
    result.lightTheme = stored.lightTheme;
  }
  if (typeof stored.darkTheme === "string" && VALID_DARK_THEMES.has(stored.darkTheme)) {
    result.darkTheme = stored.darkTheme;
  }
  const language = parseAppLanguage(stored.language);
  if (language !== null) {
    result.language = language;
  }
  if (stored.sendBehavior === "interrupt" || stored.sendBehavior === "queue") {
    result.sendBehavior = stored.sendBehavior;
  }
  if (
    typeof stored.serviceUrlBehavior === "string" &&
    VALID_SERVICE_URL_BEHAVIORS.has(stored.serviceUrlBehavior)
  ) {
    result.serviceUrlBehavior = stored.serviceUrlBehavior;
  }
  return result;
}

function pickFontSettings(stored: Partial<AppSettings>): Partial<AppSettings> {
  const result: Partial<AppSettings> = {};
  const uiFontFamily = sanitizeFontFamily(stored.uiFontFamily);
  if (uiFontFamily !== null) {
    result.uiFontFamily = uiFontFamily;
  }
  const monoFontFamily = sanitizeFontFamily(stored.monoFontFamily);
  if (monoFontFamily !== null) {
    result.monoFontFamily = monoFontFamily;
  }
  const uiFontSize = parseClampedFontSize(stored.uiFontSize, {
    min: MIN_UI_FONT_SIZE,
    max: MAX_UI_FONT_SIZE,
  });
  if (uiFontSize !== null) {
    result.uiFontSize = uiFontSize;
  }
  const codeFontSize = parseClampedFontSize(stored.codeFontSize, {
    min: MIN_CODE_FONT_SIZE,
    max: MAX_CODE_FONT_SIZE,
  });
  if (codeFontSize !== null) {
    result.codeFontSize = codeFontSize;
  }
  if (typeof stored.syntaxTheme === "string" && isSyntaxThemeId(stored.syntaxTheme)) {
    result.syntaxTheme = stored.syntaxTheme;
  }
  return result;
}

function pickWorkspaceLayoutSettings(stored: Partial<AppSettings>): Partial<AppSettings> {
  const result: Partial<AppSettings> = {};
  const terminalScrollbackLines = parseTerminalScrollbackLines(stored.terminalScrollbackLines);
  if (terminalScrollbackLines !== null) {
    result.terminalScrollbackLines = terminalScrollbackLines;
  }
  if (
    typeof stored.workspaceTitleSource === "string" &&
    VALID_WORKSPACE_TITLE_SOURCES.has(stored.workspaceTitleSource)
  ) {
    result.workspaceTitleSource = stored.workspaceTitleSource;
  }
  if (typeof stored.compactSidebarTopSpacing === "boolean") {
    result.compactSidebarTopSpacing = stored.compactSidebarTopSpacing;
  }
  if (
    typeof stored.workspaceToolsPlacement === "string" &&
    VALID_WORKSPACE_TOOLS_PLACEMENTS.has(stored.workspaceToolsPlacement as WorkspaceToolsPlacement)
  ) {
    result.workspaceToolsPlacement = stored.workspaceToolsPlacement as WorkspaceToolsPlacement;
  }
  if (
    typeof stored.chatWidth === "string" &&
    VALID_CHAT_WIDTHS.has(stored.chatWidth as ChatWidth)
  ) {
    result.chatWidth = stored.chatWidth as ChatWidth;
  }
  return result;
}

function pickPreviewSettings(stored: Partial<AppSettings>): Partial<AppSettings> {
  const result: Partial<AppSettings> = {};
  if (
    stored.previewServerCloseBehavior === "keep-running" ||
    stored.previewServerCloseBehavior === "stop-on-close"
  ) {
    result.previewServerCloseBehavior = stored.previewServerCloseBehavior;
  }
  if (typeof stored.previewAutoStartOnRestore === "boolean") {
    result.previewAutoStartOnRestore = stored.previewAutoStartOnRestore;
  }
  return result;
}

function pickAppSettings(stored: Partial<AppSettings>): Partial<AppSettings> {
  return {
    ...pickThemeAndBehaviorSettings(stored),
    ...pickFontSettings(stored),
    ...pickWorkspaceLayoutSettings(stored),
    ...pickPreviewSettings(stored),
  };
}

function pickAppSettingsFromLegacy(legacy: Record<string, unknown>): Partial<AppSettings> {
  if (legacy.theme === "auto") {
    return { colorSchemeMode: "system" };
  }
  if (legacy.theme === "light") {
    return { colorSchemeMode: "light", lightTheme: "daylight" };
  }
  if (legacy.theme === "dark") {
    return { colorSchemeMode: "dark", darkTheme: "dark" };
  }
  return {};
}

export function parseTerminalScrollbackLines(value: unknown): number | null {
  let numericValue = NaN;
  if (typeof value === "number") {
    numericValue = value;
  } else if (typeof value === "string" && value.trim().length > 0) {
    numericValue = Number(value);
  }
  if (!Number.isFinite(numericValue)) {
    return null;
  }
  return Math.min(
    MAX_TERMINAL_SCROLLBACK_LINES,
    Math.max(MIN_TERMINAL_SCROLLBACK_LINES, Math.floor(numericValue)),
  );
}

export function parseClampedFontSize(
  value: unknown,
  bounds: { min: number; max: number },
): number | null {
  let numericValue = NaN;
  if (typeof value === "number") {
    numericValue = value;
  } else if (typeof value === "string" && value.trim().length > 0) {
    numericValue = Number(value);
  }
  if (!Number.isFinite(numericValue)) {
    return null;
  }
  return Math.min(bounds.max, Math.max(bounds.min, Math.floor(numericValue)));
}

export function sanitizeFontFamily(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return ""; // explicit empty = default
  }
  if (trimmed.length > MAX_FONT_FAMILY_LENGTH) {
    return null;
  }
  if (/[;{}<>]/.test(trimmed)) {
    return null; // would break the web CSS font-family declaration
  }
  if ([...trimmed].some((char) => char.charCodeAt(0) <= 0x1f)) {
    return null; // control chars would corrupt the font-family string
  }
  return trimmed; // quotes/commas are legit in stacks
}

async function loadLegacyDesktopSettingsFromStorage(storage: KeyValueStorage): Promise<{
  manageBuiltInDaemon?: boolean;
  releaseChannel?: ReleaseChannel;
} | null> {
  const stored = await loadRendererSettingsPayload(storage);
  if (!stored) {
    return null;
  }

  const result: {
    manageBuiltInDaemon?: boolean;
    releaseChannel?: ReleaseChannel;
  } = {};

  if (typeof stored.manageBuiltInDaemon === "boolean") {
    result.manageBuiltInDaemon = stored.manageBuiltInDaemon;
  }
  if (stored.releaseChannel === "stable" || stored.releaseChannel === "beta") {
    result.releaseChannel = stored.releaseChannel;
  }

  return Object.keys(result).length > 0 ? result : null;
}

async function loadRendererSettingsPayload(
  storage: KeyValueStorage,
): Promise<Record<string, unknown> | null> {
  const current = await storage.getItem(APP_SETTINGS_KEY);
  if (current) {
    return JSON.parse(current) as Record<string, unknown>;
  }

  const legacy = await storage.getItem(LEGACY_SETTINGS_KEY);
  if (!legacy) {
    return null;
  }
  return JSON.parse(legacy) as Record<string, unknown>;
}
