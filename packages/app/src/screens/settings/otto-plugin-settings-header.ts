import { useInstalledPlugins } from "@/plugins/registry";
import { resolvePluginIcon } from "@/plugins/icons";
import { Blocks } from "@/components/icons/material-icons";
import type { SettingsView } from "@/navigation/settings-navigation";

export function usePluginSettingsHeader(view: SettingsView, fallbackTitle: string) {
  const installedPlugins = useInstalledPlugins();
  if (view.kind !== "plugin") return null;
  const screen = installedPlugins
    .find((plugin) => plugin.serverId === view.serverId && plugin.id === view.pluginId)
    ?.settingsScreens.find((candidate) => candidate.id === view.screenId);
  return {
    title: view.pluginId + " · " + (screen?.title ?? fallbackTitle),
    Icon: screen ? resolvePluginIcon(screen.icon) : Blocks,
  };
}
