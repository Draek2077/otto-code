import { useCallback } from "react";
import { router } from "expo-router";
import { SettingsRow } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { useInstalledPlugin } from "@/plugins/registry";
import { buildPluginSettingsRoute } from "@/plugins/settings/routes";
export function BitbucketSettingsEntry({ serverId }: { serverId: string }) {
  const plugin = useInstalledPlugin(serverId, "otto-integrations");
  const open = useCallback(
    () => router.push(buildPluginSettingsRoute(serverId, "otto-integrations", "bitbucket")),
    [serverId],
  );
  if (!plugin?.settingsScreens.some((screen) => screen.id === "bitbucket")) return null;
  return (
    <SettingsRow label="Bitbucket connections">
      <Button variant="outline" size="sm" onPress={open}>
        Configure Bitbucket
      </Button>
    </SettingsRow>
  );
}
