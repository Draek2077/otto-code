import { useCallback } from "react";
import { router } from "expo-router";
import { SettingsCard, SettingsRow } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { useInstalledPlugin } from "@/plugins/registry";
import { buildPluginSettingsRoute } from "@/plugins/settings/routes";

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
      <SettingsRow label="Otto OpenAI-compatible" hint="Host endpoints, models and API keys.">
        <Button variant="outline" size="sm" onPress={open}>
          Configure Otto provider
        </Button>
      </SettingsRow>
    </SettingsCard>
  );
}
