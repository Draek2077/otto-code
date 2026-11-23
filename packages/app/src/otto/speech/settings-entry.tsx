import { useCallback } from "react";
import { router } from "expo-router";
import { SettingsCard, SettingsRow } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { useInstalledPlugin } from "@/plugins/registry";
import { buildPluginSettingsRoute } from "@/plugins/settings/routes";
export function SpeechSettingsEntry({ serverId }: { serverId: string }) {
  const plugin = useInstalledPlugin(serverId, "otto-speech");
  const open = useCallback(
    () => router.push(buildPluginSettingsRoute(serverId, "otto-speech", "speech")),
    [serverId],
  );
  if (!plugin?.settingsScreens.some((screen) => screen.id === "speech")) return null;
  return (
    <SettingsCard>
      <SettingsRow label="Speech" hint="Recognition, spoken replies, voices and playback.">
        <Button variant="outline" size="sm" onPress={open}>
          Configure Speech
        </Button>
      </SettingsRow>
    </SettingsCard>
  );
}
