import type { PluginClientContext } from "@getpaseo/plugin/client";
import { SpeechSettings } from "@getpaseo/plugin/client/otto-speech";
export default function contribute(client: PluginClientContext) {
  return client.addSettingsScreen({
    id: "speech",
    title: "Speech",
    icon: "Mic",
    Component: SpeechSettings,
  });
}
