import type { PluginClientContext } from "@getpaseo/plugin/client";
import { ConnectionScreen } from "./client/connection.js";

export default function contribute(client: PluginClientContext) {
  const removeSettings = client.addSettingsScreen({
    id: "connection",
    title: "OpenAI Compatible Provider",
    icon: "Cable",
    Component: ConnectionScreen,
  });
  const removeCommand = client.addCommandCenterItem({
    id: "connection-settings",
    context: "global",
    title: "OpenAI Compatible API settings",
    icon: "Cable",
    keywords: ["provider", "models", "endpoint", "OpenRouter", "LM Studio"],
    onSelect: ({ openSettings }) => openSettings("connection"),
  });
  return async () => {
    await removeCommand();
    await removeSettings();
  };
}
