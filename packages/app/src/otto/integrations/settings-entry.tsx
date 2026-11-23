import { useCallback } from "react";
import { router } from "expo-router";
import { SettingsCard, SettingsRow } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { useInstalledPlugin } from "@/plugins/registry";
import { buildPluginSettingsRoute } from "@/plugins/settings/routes";
import { BitbucketSettingsEntry } from "../bitbucket/settings-entry";
import { ConnectorSettingsEntry } from "../connectors/settings-entry";

export function IntegrationSettingsEntry({ serverId }: { serverId: string }) {
  const plugin = useInstalledPlugin(serverId, "otto-integrations");
  const open = useCallback(
    () => router.push(buildPluginSettingsRoute(serverId, "otto-integrations", "atlassian")),
    [serverId],
  );
  if (!plugin?.settingsScreens.some((screen) => screen.id === "atlassian")) return null;
  return (
    <SettingsCard>
      <ConnectorSettingsEntry serverId={serverId} />
      <SettingsRow
        label="Atlassian account"
        hint="Shared host authorization for Jira and Bitbucket."
      >
        <Button variant="outline" size="sm" onPress={open}>
          Configure Atlassian
        </Button>
      </SettingsRow>
      <BitbucketSettingsEntry serverId={serverId} />
    </SettingsCard>
  );
}
