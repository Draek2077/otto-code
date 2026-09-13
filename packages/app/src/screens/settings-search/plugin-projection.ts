import type { SettingsSearchItem } from "../settings-search-catalog";

export interface SearchablePluginInstallation {
  serverId: string;
  id: string;
  settingsScreens: readonly { id: string; title: string }[];
}

/** An identity projection of the live SDK registry, never another registration store. */
export function pluginSettingsSearchId(
  serverId: string,
  pluginId: string,
  screenId: string,
): string {
  return `plugin-settings:${JSON.stringify([serverId, pluginId, screenId])}`;
}

export function projectPluginSettingsSearchItems(
  plugins: readonly SearchablePluginInstallation[],
  serverId: string | null,
  supported: boolean,
): SettingsSearchItem[] {
  if (!serverId || !supported) return [];
  return plugins
    .filter((plugin) => plugin.serverId === serverId)
    .flatMap((plugin) =>
      plugin.settingsScreens.map((screen) => ({
        id: pluginSettingsSearchId(serverId, plugin.id, screen.id),
        title: screen.title,
        description: plugin.id,
        keywords: `${screen.title} ${plugin.id}`,
        scope: "Host" as const,
        section: "plugins" as const,
        host: true,
        category: "Plugins",
        group: plugin.id,
        audience: "User",
        kind: "Settings screen",
        choices: "",
        defaultValue: "",
        conditions: "pluginSettings capability; installed plugin registration",
        persistence: "Plugin-owned Settings definition",
        advanced: false,
        pluginDestination: { serverId, pluginId: plugin.id, screenId: screen.id },
      })),
    );
}
