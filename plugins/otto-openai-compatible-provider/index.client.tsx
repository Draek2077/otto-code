import type { PluginClientContext } from "@getpaseo/plugin/client";
import { ConnectionScreen } from "./client/connection.js";

export default function contribute(client: PluginClientContext) {
  const removeSettings = client.addSettingsScreen({
    id: "connection",
    title: "Otto OpenAI-compatible",
    icon: "Cable",
    Component: ConnectionScreen,
  });
  const removeCommand = client.addCommandCenterItem({
    id: "connection-settings",
    context: "global",
    title: "Otto OpenAI-compatible settings",
    icon: "Cable",
    keywords: ["provider", "models", "endpoint", "OpenRouter", "LM Studio"],
    onSelect: ({ openSettings }) => openSettings("connection"),
  });
  return async () => {
    await removeCommand();
    await removeSettings();
  };
}
