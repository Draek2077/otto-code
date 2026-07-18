import type { SettingsView } from "@/screens/settings-screen";
import {
  buildProjectSettingsRoute,
  buildProjectsSettingsRoute,
  buildSettingsHostSectionRoute,
  buildSettingsSectionRoute,
} from "@/utils/host-routes";

// A settings sub-page route the app can redirect back into.
export type SettingsRoute =
  | ReturnType<typeof buildSettingsSectionRoute>
  | ReturnType<typeof buildSettingsHostSectionRoute>
  | ReturnType<typeof buildProjectsSettingsRoute>
  | ReturnType<typeof buildProjectSettingsRoute>;

// Remembers the settings sub-page the user was last on, so re-opening Settings
// returns there instead of resetting to General. Scoped to the running app
// session (module-level, not persisted): a full app restart starts at General.
let lastSettingsRoute: SettingsRoute | null = null;

/** The route that re-enters a settings view, or null for the root list / invalid ids. */
export function settingsViewRoute(view: SettingsView): SettingsRoute | null {
  switch (view.kind) {
    case "section":
      return buildSettingsSectionRoute(view.section);
    case "host":
      // Builders throw on empty ids; the root list has nothing worth remembering.
      return view.serverId ? buildSettingsHostSectionRoute(view.serverId, view.section) : null;
    case "projects":
      return buildProjectsSettingsRoute();
    case "project":
      return view.projectKey ? buildProjectSettingsRoute(view.projectKey) : null;
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
