import { OTTO_OPENAI_PROVIDER_LABEL } from "./provider-identity";

export function ottoPluginSettingsTitle(pluginId: string, screenId: string): string | null {
  if (pluginId === "otto-openai-compatible-provider" && screenId === "connection")
    return OTTO_OPENAI_PROVIDER_LABEL;
  return null;
}
