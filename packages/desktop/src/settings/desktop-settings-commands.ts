import type { DesktopSettings, DesktopSettingsStore } from "./desktop-settings.js";

export type DesktopCommandHandler = (args?: Record<string, unknown>) => unknown;

export function createDesktopSettingsCommandHandlers({
  settingsStore,
  onSettingsChanged,
}: {
  settingsStore: DesktopSettingsStore;
  // Fired after patch/migrate resolve, so callers can keep an in-memory mirror of
  // settings that must be read synchronously (e.g. the tray's close-to-tray check).
  onSettingsChanged?: (settings: DesktopSettings) => void;
}): Record<string, DesktopCommandHandler> {
  return {
    get_desktop_settings: () => settingsStore.get(),
    patch_desktop_settings: async (args) => {
      const next = await settingsStore.patch(args);
      onSettingsChanged?.(next);
      return next;
    },
    migrate_legacy_desktop_settings: async (args) => {
      const next = await settingsStore.migrateLegacyRendererSettings(args);
      onSettingsChanged?.(next);
      return next;
    },
  };
}
