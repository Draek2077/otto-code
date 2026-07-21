import { useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { queryClient as appQueryClient } from "@/data/query-client";
import type { AppLanguage } from "@/i18n/locales";
import {
  DEFAULT_DESKTOP_SETTINGS,
  loadDesktopSettings,
  migrateLegacyDesktopSettings,
  useDesktopSettings,
} from "@/desktop/settings/desktop-settings";
import { isElectronRuntime } from "@/desktop/host";
import {
  APP_SETTINGS_KEY,
  APP_SETTINGS_QUERY_KEY,
  DEFAULT_APP_SETTINGS,
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_CODE_FONT_SIZE,
  DEFAULT_RULER_COLUMN,
  DEFAULT_TERMINAL_SCROLLBACK_LINES,
  DEFAULT_UI_FONT_SIZE,
  MAX_CODE_FONT_SIZE,
  MAX_RULER_COLUMN,
  MAX_TERMINAL_SCROLLBACK_LINES,
  MAX_UI_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
  MIN_RULER_COLUMN,
  MIN_TERMINAL_SCROLLBACK_LINES,
  MIN_UI_FONT_SIZE,
  loadAppSettingsFromStorage as loadAppSettingsFromStoragePure,
  loadSettingsFromStorage as loadSettingsFromStoragePure,
  parseClampedFontSize,
  parseTerminalScrollbackLines,
  sanitizeFontFamily,
  saveAppSettings as saveAppSettingsPure,
  type AppSettings,
  type DesktopSettingsBridge,
  type KeyValueStorage,
  type LinkOpenBehavior,
  type ReleaseChannel,
  type SendBehavior,
  type ServiceUrlBehavior,
  type Settings,
  type SettingsDeps,
  type ChatTimestampDisplay,
  type InterfaceMode,
  type AppStartScreen,
  type SuggestedTasksDefaultMode,
  type PreviewServerCloseBehavior,
  type VisualizerRenderQuality,
  type VisualizerNodeShape,
  type VisualizerContextDisplay,
  type WorkspaceTitleSource,
  type WorkspaceToolsPlacement,
} from "./storage";

export {
  APP_SETTINGS_KEY,
  DEFAULT_APP_SETTINGS,
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_CODE_FONT_SIZE,
  DEFAULT_RULER_COLUMN,
  DEFAULT_TERMINAL_SCROLLBACK_LINES,
  DEFAULT_UI_FONT_SIZE,
  MAX_CODE_FONT_SIZE,
  MAX_RULER_COLUMN,
  MAX_TERMINAL_SCROLLBACK_LINES,
  MAX_UI_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
  MIN_RULER_COLUMN,
  MIN_TERMINAL_SCROLLBACK_LINES,
  MIN_UI_FONT_SIZE,
  parseClampedFontSize,
  parseTerminalScrollbackLines,
  sanitizeFontFamily,
};
export type {
  AppSettings,
  AppLanguage,
  ChatTimestampDisplay,
  InterfaceMode,
  AppStartScreen,
  SuggestedTasksDefaultMode,
  DesktopSettingsBridge,
  KeyValueStorage,
  LinkOpenBehavior,
  ReleaseChannel,
  SendBehavior,
  ServiceUrlBehavior,
  Settings,
  SettingsDeps,
  PreviewServerCloseBehavior,
  VisualizerRenderQuality,
  VisualizerNodeShape,
  VisualizerContextDisplay,
  WorkspaceTitleSource,
  WorkspaceToolsPlacement,
};

const productionDeps: SettingsDeps = {
  storage: AsyncStorage,
  desktop: {
    isElectron: isElectronRuntime,
    loadDesktopSettings,
    migrateLegacyDesktopSettings,
  },
};

export interface UseAppSettingsReturn {
  settings: AppSettings;
  isLoading: boolean;
  error: unknown;
  updateSettings: (updates: Partial<AppSettings>) => Promise<void>;
  resetSettings: () => Promise<void>;
}

export interface UseSettingsReturn {
  settings: Settings;
  isLoading: boolean;
  error: unknown;
  updateSettings: (updates: Partial<Settings>) => Promise<void>;
  resetSettings: () => Promise<void>;
}

type SettingsSelector<TSelected> = (settings: Settings) => TSelected;

// Per-field allowlist for routing merged-Settings updates to the AppSettings
// store. Desktop-owned fields (manageBuiltInDaemon, releaseChannel) are handled
// separately by the caller — ADD NEW AppSettings FIELDS HERE, or writes to them
// through `useSettings()` are silently dropped.
//
// This was a chain of one `if` per field until it outgrew the cyclomatic-
// complexity ceiling; a list can't outgrow anything.
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
  "syntaxTheme",
  "rulerEnabled",
  "rulerColumn",
  "workspaceTitleSource",
  "autoExpandReasoning",
  "wrapCodeLines",
  "interfaceMode",
  "suggestedTasksEnabled",
  "suggestedTasksDefaultMode",
  "verticalTabRailWidth",
] as const satisfies readonly (keyof AppSettings)[];

function collectAppSettingsUpdates(updates: Partial<Settings>): Partial<AppSettings> {
  const appUpdates: Partial<AppSettings> = {};
  for (const key of APP_SETTINGS_UPDATE_KEYS) {
    const value = updates[key];
    if (value !== undefined) {
      // `key` indexes both records identically, but TS can't correlate the two
      // per-key value types across a loop, so the write is widened here. The
      // `satisfies` above is what actually keeps the keys honest.
      (appUpdates as Record<string, unknown>)[key] = value;
    }
  }
  return appUpdates;
}

export function useAppSettings(): UseAppSettingsReturn {
  const queryClient = useQueryClient();
  const { data, isPending, error } = useQuery({
    queryKey: APP_SETTINGS_QUERY_KEY,
    queryFn: () => loadAppSettingsFromStorage(),
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const updateSettings = useCallback(
    async (updates: Partial<AppSettings>) => {
      try {
        await saveAppSettings({ queryClient, updates });
      } catch (err) {
        console.error("[AppSettings] Failed to save settings:", err);
        throw err;
      }
    },
    [queryClient],
  );

  const resetSettings = useCallback(async () => {
    try {
      const next = { ...DEFAULT_CLIENT_SETTINGS };
      queryClient.setQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY, next);
      await AsyncStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(next));
    } catch (err) {
      console.error("[AppSettings] Failed to reset settings:", err);
      throw err;
    }
  }, [queryClient]);

  return {
    settings: data ?? DEFAULT_CLIENT_SETTINGS,
    isLoading: isPending,
    error: error ?? null,
    updateSettings,
    resetSettings,
  };
}

/**
 * Narrow subscription to a single derived AppSettings value. Unlike
 * `useAppSettings()` — a bare query subscription that re-renders its consumer
 * on every settings write — this applies `select` inside the query, so the
 * consumer re-renders only when the selected value itself changes. Use it in
 * hot paths (per-message components, list rows). Pass a stable (module-level)
 * selector that returns a defined value; while the settings are still loading
 * the selector runs against `DEFAULT_CLIENT_SETTINGS`.
 */
export function useAppSettingValue<TSelected>(
  select: (settings: AppSettings) => TSelected,
): TSelected {
  const { data } = useQuery({
    queryKey: APP_SETTINGS_QUERY_KEY,
    queryFn: () => loadAppSettingsFromStorage(),
    staleTime: Infinity,
    gcTime: Infinity,
    select,
    notifyOnChangeProps: ["data"],
  });
  return data === undefined ? select(DEFAULT_CLIENT_SETTINGS) : data;
}

export function useSettings(): UseSettingsReturn;
export function useSettings<TSelected>(selector: SettingsSelector<TSelected>): TSelected;
export function useSettings<TSelected>(
  selector?: SettingsSelector<TSelected>,
): UseSettingsReturn | TSelected {
  const appSettings = useAppSettings();
  const desktopSettings = useDesktopSettings();

  const updateSettings = useCallback(
    async (updates: Partial<Settings>) => {
      const appUpdates = collectAppSettingsUpdates(updates);
      const promises: Promise<void>[] = [];
      if (Object.keys(appUpdates).length > 0) {
        promises.push(appSettings.updateSettings(appUpdates));
      }

      if (isElectronRuntime()) {
        const desktopUpdates: Parameters<typeof desktopSettings.updateSettings>[0] = {};
        if (updates.manageBuiltInDaemon !== undefined) {
          desktopUpdates.daemon = {
            manageBuiltInDaemon: updates.manageBuiltInDaemon,
          };
        }
        if (updates.releaseChannel !== undefined) {
          desktopUpdates.releaseChannel = updates.releaseChannel;
        }
        if (Object.keys(desktopUpdates).length > 0) {
          promises.push(desktopSettings.updateSettings(desktopUpdates));
        }
      }

      await Promise.all(promises);
    },
    [appSettings, desktopSettings],
  );

  const resetSettings = useCallback(async () => {
    const resets: Promise<void>[] = [appSettings.resetSettings()];
    if (isElectronRuntime()) {
      resets.push(desktopSettings.updateSettings(DEFAULT_DESKTOP_SETTINGS));
    }
    await Promise.all(resets);
  }, [appSettings, desktopSettings]);

  const settings = {
    ...DEFAULT_APP_SETTINGS,
    ...appSettings.settings,
    manageBuiltInDaemon: desktopSettings.settings.daemon.manageBuiltInDaemon,
    releaseChannel: desktopSettings.settings.releaseChannel,
  };

  if (selector) {
    return selector(settings);
  }

  return {
    settings,
    isLoading: appSettings.isLoading || desktopSettings.isLoading,
    error: appSettings.error ?? desktopSettings.error,
    updateSettings,
    resetSettings,
  };
}

export async function persistAppSettings(updates: Partial<AppSettings>): Promise<void> {
  await saveAppSettings({ queryClient: appQueryClient, updates });
}

export async function saveAppSettings(input: {
  queryClient: QueryClient;
  updates: Partial<AppSettings>;
  deps?: SettingsDeps;
}): Promise<void> {
  await saveAppSettingsPure({
    queryClient: input.queryClient,
    updates: input.updates,
    deps: input.deps ?? productionDeps,
  });
}

export async function loadAppSettingsFromStorage(deps?: SettingsDeps): Promise<AppSettings> {
  return loadAppSettingsFromStoragePure(deps ?? productionDeps);
}

export async function loadSettingsFromStorage(deps?: SettingsDeps): Promise<Settings> {
  return loadSettingsFromStoragePure(deps ?? productionDeps);
}
