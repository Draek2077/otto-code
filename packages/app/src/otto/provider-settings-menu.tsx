import { useCallback } from "react";
import { router } from "expo-router";
import { SettingsCard, SettingsRow } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { useInstalledPlugin } from "@/plugins/registry";
import { buildPluginSettingsRoute } from "@/plugins/settings/routes";

// Keep setup reachable from the provider's model sheet, including on a fresh host.
export function OttoProviderConfigurationAction({
  serverId,
  provider,
  hasModels,
  onOpen,
}: {
  serverId: string;
  provider: string;
  hasModels: boolean;
  onOpen: () => void;
}) {
  const pluginId = "otto-openai-compatible-provider";
  const plugin = useInstalledPlugin(serverId, pluginId);
  const open = useCallback(() => {
    onOpen();
    router.push(buildPluginSettingsRoute(serverId, pluginId, "connection"));
  }, [serverId, onOpen]);
  if (
    provider !== "openai-compatible" ||
    hasModels ||
    !plugin?.settingsScreens.some((screen) => screen.id === "connection")
  )
    return null;
  return (
    <SettingsCard>
      <SettingsRow
        label="Endpoint configuration"
        hint="Set the API URL, API key and models on this host."
      >
        <Button variant="outline" size="sm" onPress={open}>
          Configure endpoint
        </Button>
      </SettingsRow>
    </SettingsCard>
  );
}

// OTTO(provider-settings): built-ins are intentionally absent from Paseo's installed-plugin list.
export function OttoProviderSettingsMenu({ serverId }: { serverId: string }) {
  const pluginId = "otto-openai-compatible-provider";
  const plugin = useInstalledPlugin(serverId, pluginId);
  const open = useCallback(
    () => router.push(buildPluginSettingsRoute(serverId, pluginId, "connection")),
    [serverId],
  );
  if (!plugin?.settingsScreens.some((screen) => screen.id === "connection")) return null;
  return (
    <SettingsCard>
      <SettingsRow label="OpenAI Compatible Provider" hint="Host endpoints, models and API keys.">
        <Button variant="outline" size="sm" onPress={open}>
          Configure Otto provider
        </Button>
      </SettingsRow>
    </SettingsCard>
  );
}
