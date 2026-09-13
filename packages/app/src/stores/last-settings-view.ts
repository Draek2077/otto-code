import type { SettingsView } from "@/navigation/settings-navigation";
import { buildPluginSettingsRoute } from "@/plugins/settings/routes";
import {
  buildProjectSettingsRoute,
  buildSettingsHostSectionRoute,
  buildSettingsSectionRoute,
} from "@/utils/host-routes";

// A settings sub-page route the app can redirect back into.
export type SettingsRoute =
  | ReturnType<typeof buildSettingsSectionRoute>
  | ReturnType<typeof buildSettingsHostSectionRoute>
  | ReturnType<typeof buildProjectSettingsRoute>
  | ReturnType<typeof buildPluginSettingsRoute>;

// Remembers a sub-page for callers that explicitly restore it. The normal Settings
// entry remains the search-first overview. Scoped to the running app session only.
let lastSettingsRoute: SettingsRoute | null = null;

/** The route that re-enters a settings view, or null for the root list / invalid ids. */
export function settingsViewRoute(view: SettingsView): SettingsRoute | null {
  switch (view.kind) {
    case "section":
      return buildSettingsSectionRoute(view.section);
    case "host":
      // Builders throw on empty ids; the root list has nothing worth remembering.
      return view.serverId ? buildSettingsHostSectionRoute(view.serverId, view.section) : null;
    case "project":
      return view.serverId && view.projectId
        ? buildProjectSettingsRoute(view.serverId, view.projectId)
        : null;
    case "plugin":
      return view.serverId.trim() && view.pluginId.trim() && view.screenId.trim()
        ? buildPluginSettingsRoute(view.serverId, view.pluginId, view.screenId)
        : null;
    case "root":
      return null;
  }
}

export function rememberLastSettingsView(view: SettingsView): void {
  const route = settingsViewRoute(view);
  if (route) {
    lastSettingsRoute = route;
  }
}

export function getLastSettingsRoute(): SettingsRoute | null {
  return lastSettingsRoute;
}

// Test-only: clear the remembered route between cases.
export function resetLastSettingsRoute(): void {
  lastSettingsRoute = null;
}
