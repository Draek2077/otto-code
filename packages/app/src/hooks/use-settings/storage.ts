import { type SyntaxThemeId } from "@otto-code/highlight";
import type { QueryClient } from "@tanstack/react-query";
import type { DesktopSettings } from "@/desktop/settings/desktop-settings";
import { type AppLanguage } from "@/i18n/locales";
import {
  DEFAULT_SIDEBAR_CHECKS_DISPLAY,
  parseSidebarChecksDisplay,
  type SidebarChecksDisplay,
} from "@/components/sidebar/display-preferences/checks-display";
import {
  DEFAULT_SIDEBAR_ROW_ITEMS,
  isChecksHiddenByLegacyRowItem,
  parseSidebarRowItems,
  type SidebarRowItems,
} from "@/components/sidebar/display-preferences/row-items";
import { DEFAULT_CODE_FONT_SIZE, DEFAULT_UI_FONT_SIZE } from "./limits";
import {
  DEFAULT_OTTO_SETTINGS,
  DEFAULT_TERMINAL_SCROLLBACK_LINES,
  migrateLegacyThemeField,
  migrateSetupWizardFlag,
  migrateTutorialFlag,
  parseSettingsRecord,
  pickAgentAutoSpeechSettings,
  pickAgentVoiceCueSettings,
  pickChatCodeSettings,
  pickFeatureFlagSettings,
  pickFontSettings,
  pickOnboardingSettings,
  pickPreviewSettings,
  pickShortcutOverlaySettings,
  pickTabLayoutSettings,
  pickTextEffectSettings,
  pickThemeAndBehaviorSettings,
  pickVisualizerSettings,
  pickVoicePlaybackSettings,
  pickWorkspaceLayoutSettings,
  pickZoomRecorderSettings,
} from "./otto-settings";
import type {
  LinkOpenBehavior,
  OttoAppSettings,
  ReleaseChannel,
  SendBehavior,
  ServiceUrlBehavior,
  ToolCallDetailLevel,
  WorkspaceTitleSource,
} from "./otto-settings";
export const APP_SETTINGS_KEY = "@otto:app-settings";
export const APP_SETTINGS_QUERY_KEY = ["app-settings"];
const LEGACY_SETTINGS_KEY = "@otto:settings";

export type SidebarWorkspaceTrailing = "diff" | "timestamp" | "none";

export interface AppSettings extends OttoAppSettings {
  language: AppLanguage;
  sendBehavior: SendBehavior;
  // Show AI-predicted next-prompt suggestions as composer ghost-text watermark
  // (Tab to accept). Native Claude prompt suggestions; gated on the host's
  // promptSuggestions capability. Device-local presentation only. Default on.
  serviceUrlBehavior: ServiceUrlBehavior;
  // See LinkOpenBehavior. Device-local presentation only.
  terminalScrollbackLines: number;
  useLegacyTerminalRenderer: boolean;
  uiFontFamily: string; // "" = platform default UI stack
  monoFontFamily: string; // "" = platform default mono stack
  uiFontSize: number; // clamped px, default 16
  codeFontSize: number; // clamped px, default 12
  syntaxTheme: SyntaxThemeId; // default "default"
  // Whether whitespace-only changes appear in diff review. Device-local
  // presentation only. Default on.
  workspaceTitleSource: WorkspaceTitleSource;
  autoExpandReasoning: boolean;
  // Repeating cue tone while voice mode waits for the agent's reply.
  // Device-local: gates playback on this device only.
  toolCallDetailLevel: ToolCallDetailLevel;
  /** Vim keybindings in the file editor. */
  vimKeybindings: boolean;
  sidebarWorkspaceTrailing: SidebarWorkspaceTrailing;
  sidebarRowItems: SidebarRowItems;
  sidebarChecksDisplay: SidebarChecksDisplay;
  /** Constrained leader-only Otto action mappings for Vim keybindings. */
}

export interface Settings extends AppSettings {
  manageBuiltInDaemon: boolean;
  releaseChannel: ReleaseChannel;
}

export const DEFAULT_CLIENT_SETTINGS: AppSettings = {
  ...DEFAULT_OTTO_SETTINGS,
  language: "system",
  sendBehavior: "interrupt",
  serviceUrlBehavior: "ask",
  terminalScrollbackLines: DEFAULT_TERMINAL_SCROLLBACK_LINES,
  useLegacyTerminalRenderer: false,
  uiFontFamily: "",
  monoFontFamily: "",
  uiFontSize: DEFAULT_UI_FONT_SIZE,
  codeFontSize: DEFAULT_CODE_FONT_SIZE,
  syntaxTheme: "default",
  workspaceTitleSource: "title",
  autoExpandReasoning: false,
  toolCallDetailLevel: "detailed",
  vimKeybindings: false,
  sidebarWorkspaceTrailing: "diff",
  sidebarRowItems: DEFAULT_SIDEBAR_ROW_ITEMS,
  sidebarChecksDisplay: DEFAULT_SIDEBAR_CHECKS_DISPLAY,
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
      const parsed = parseSettingsRecord(stored);
      if (parsed) {
        return {
          ...DEFAULT_CLIENT_SETTINGS,
          ...migrateLegacyThemeField(parsed),
          ...migrateTutorialFlag(parsed),
          ...migrateSetupWizardFlag(parsed),
          ...pickAppSettings(parsed as Partial<AppSettings>),
        };
      }
      // Unreadable blob: reset to defaults and persist so we don't re-hit the bad
      // value on every launch. The previous code threw here, which left the
      // settings query permanently in error (recoverable only by clearing data).
      console.warn("[AppSettings] Unreadable settings blob; resetting to defaults");
      await deps.storage.setItem(APP_SETTINGS_KEY, JSON.stringify(DEFAULT_CLIENT_SETTINGS));
      return DEFAULT_CLIENT_SETTINGS;
    }

    const legacyStored = await deps.storage.getItem(LEGACY_SETTINGS_KEY);
    const legacyParsed = legacyStored ? parseSettingsRecord(legacyStored) : null;
    if (legacyParsed) {
      const next = {
        ...DEFAULT_CLIENT_SETTINGS,
        ...migrateTutorialFlag(legacyParsed),
        ...migrateSetupWizardFlag(legacyParsed),
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

function pickAppSettings(stored: Partial<AppSettings>): Partial<AppSettings> {
  const sidebarWorkspaceTrailing = stored.sidebarWorkspaceTrailing;
  const sidebarChecksDisplay = parseSidebarChecksDisplay(stored.sidebarChecksDisplay);
  let sidebarChecksSetting: Partial<AppSettings> = {};
  if (sidebarChecksDisplay !== null) {
    sidebarChecksSetting = { sidebarChecksDisplay };
  } else if (isChecksHiddenByLegacyRowItem(stored.sidebarRowItems)) {
    sidebarChecksSetting = { sidebarChecksDisplay: "none" };
  }
  return {
    ...pickThemeAndBehaviorSettings(stored),
    ...pickFontSettings(stored),
    ...pickWorkspaceLayoutSettings(stored),
    ...pickShortcutOverlaySettings(stored),
    ...pickTextEffectSettings(stored),
    ...pickChatCodeSettings(stored),
    ...pickTabLayoutSettings(stored),
    ...pickOnboardingSettings(stored),
    ...pickPreviewSettings(stored),
    ...pickVisualizerSettings(stored),
    ...pickAgentVoiceCueSettings(stored),
    ...pickZoomRecorderSettings(stored),
    ...pickVoicePlaybackSettings(stored),
    ...pickAgentAutoSpeechSettings(stored),
    ...pickFeatureFlagSettings(stored),
    ...(typeof stored.useLegacyTerminalRenderer === "boolean"
      ? { useLegacyTerminalRenderer: stored.useLegacyTerminalRenderer }
      : {}),
    ...(stored.sidebarRowItems !== undefined
      ? { sidebarRowItems: parseSidebarRowItems(stored.sidebarRowItems) }
      : {}),
    ...sidebarChecksSetting,
    ...(sidebarWorkspaceTrailing === "diff" ||
    sidebarWorkspaceTrailing === "timestamp" ||
    sidebarWorkspaceTrailing === "none"
      ? { sidebarWorkspaceTrailing }
      : {}),
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
    return parseSettingsRecord(current);
  }

  const legacy = await storage.getItem(LEGACY_SETTINGS_KEY);
  if (!legacy) {
    return null;
  }
  return parseSettingsRecord(legacy);
}

// Otto's settings registry lives in otto-settings.ts; this file stays the
// import surface its consumers use.
export {
  DEFAULT_MOUNTED_WORKSPACE_LIMIT,
  DEFAULT_RULER_COLUMN,
  DEFAULT_TERMINAL_SCROLLBACK_LINES,
  MAX_MOUNTED_TAB_LIMIT,
  MAX_MOUNTED_WORKSPACE_LIMIT,
  MAX_RULER_COLUMN,
  MAX_TERMINAL_SCROLLBACK_LINES,
  MIN_MOUNTED_TAB_LIMIT,
  MIN_MOUNTED_WORKSPACE_LIMIT,
  MIN_RULER_COLUMN,
  MIN_TERMINAL_SCROLLBACK_LINES,
  VISUALIZER_CONTEXT_DISPLAYS,
  VISUALIZER_PIP_SIZES,
  VISUALIZER_SURFACES,
  buildAgentAutoSpeechKey,
  parseClampedFontSize,
  parseMountedTabLimit,
  parseMountedWorkspaceLimit,
  parseTerminalScrollbackLines,
  parseVerticalTabRailWidth,
  sanitizeFontFamily,
} from "./otto-settings";
export type {
  AppStartScreen,
  ChatTimestampDisplay,
  ColorSchemeMode,
  InterfaceMode,
  LinkOpenBehavior,
  MeetingTranscriptDeliveryPolicy,
  PreviewServerCloseBehavior,
  ReleaseChannel,
  SendBehavior,
  ServiceUrlBehavior,
  ShortcutOverlayMode,
  SuggestedTasksDefaultMode,
  TabOrientation,
  TeamSwitcherPlacement,
  ToolCallDetailLevel,
  VisualizerContextDisplay,
  VisualizerNodeShape,
  VisualizerPipSize,
  VisualizerRenderQuality,
  VisualizerSurface,
  WorkspaceChangeIndicator,
  WorkspaceTitleSource,
  WorkspaceToolsPlacement,
} from "./otto-settings";
export { DEFAULT_OTTO_SETTINGS } from "./otto-settings";
export type { OttoAppSettings } from "./otto-settings";

// Re-exported from a dependency-free module so a caller that only wants a bound is not forced to
// load this file's whole import graph - see limits.ts for why that matters outside Metro.
export {
  DEFAULT_CODE_FONT_SIZE,
  DEFAULT_TERMINAL_FONT_SIZE,
  DEFAULT_UI_FONT_SIZE,
  MAX_CODE_FONT_SIZE,
  MAX_TERMINAL_FONT_SIZE,
  MAX_FONT_FAMILY_LENGTH,
  MAX_UI_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  MIN_UI_FONT_SIZE,
} from "./limits";
