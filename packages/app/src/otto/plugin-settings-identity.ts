export function ottoPluginSettingsTitle(pluginId: string, screenId: string): string | null {
  if (pluginId === "otto-openai-compatible-provider" && screenId === "connection")
    return "OpenAI-compatible";
  return null;
}
