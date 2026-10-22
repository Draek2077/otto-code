import path from "node:path";
import { BUILTIN_PROVIDER_IDS } from "@getpaseo/protocol/provider-manifest";

interface PluginHostInput {
  pluginId: string;
  settingsDirectory?: string;
}

/** The bootstrap supplies <host home>/plugin-settings/<plugin id>. Never use
 * the parent process's home: a daemon can be constructed with another host home. */
export function ottoPluginEnvironment({
  pluginId,
  settingsDirectory,
}: PluginHostInput): Record<string, string> {
  if (pluginId !== "otto-openai-compatible-provider") return {};
  if (
    !settingsDirectory ||
    !path.isAbsolute(settingsDirectory) ||
    path.basename(settingsDirectory) !== pluginId ||
    path.basename(path.dirname(settingsDirectory)) !== "plugin-settings"
  )
    throw new Error("The Otto provider requires the daemon's resolved host settings directory.");
  return {
    OTTO_PROVIDER_HOST_HOME: path.dirname(path.dirname(settingsDirectory)),
    OTTO_PROVIDER_RESERVED_IDS: JSON.stringify(BUILTIN_PROVIDER_IDS),
  };
}
