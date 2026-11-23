/** Built-ins are not listed among user-installed plugins; expose their actual settings route. */
import { useCallback } from "react";
import { router } from "expo-router";
import { SettingsCard, SettingsRow } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { useInstalledPlugin } from "@/plugins/registry";
import { buildPluginSettingsRoute } from "@/plugins/settings/routes";

export function BrainSettingsEntry({ serverId }: { serverId: string }) {
  const plugin = useInstalledPlugin(serverId, "otto-brain");
  const open = useCallback(
    () => router.push(buildPluginSettingsRoute(serverId, "otto-brain", "brain")),
    [serverId],
  );
  if (!plugin?.settingsScreens.some((screen) => screen.id === "brain")) return null;
  return (
    <SettingsCard>
      <SettingsRow
        label="Brain"
        hint="Local and Remote Brain, runtimes, models, sharing and security."
      >
        <Button variant="outline" size="sm" onPress={open}>
          Configure Brain
        </Button>
      </SettingsRow>
    </SettingsCard>
  );
}
