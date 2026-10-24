import type { PluginClientContext } from "@getpaseo/plugin/client";
import { AtlassianSettings } from "./client/settings.js";
export default function contribute(client: PluginClientContext) {
  return client.addSettingsScreen({
    id: "atlassian",
    title: "Atlassian account",
    icon: "Plug",
    Component: AtlassianSettings,
  });
}
