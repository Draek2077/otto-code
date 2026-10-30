import { useCallback } from "react";
import { router } from "expo-router";
import { SettingsRow } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { useInstalledPlugin } from "@/plugins/registry";
import { buildPluginSettingsRoute } from "@/plugins/settings/routes";
export function ConnectorSettingsEntry({ serverId }: { serverId: string }) {
  const plugin = useInstalledPlugin(serverId, "otto-integrations");
  const open = useCallback(
    () => router.push(buildPluginSettingsRoute(serverId, "otto-integrations", "connectors")),
    [serverId],
  );
  if (!plugin?.settingsScreens.some((screen) => screen.id === "connectors")) return null;
  return (
    <SettingsRow
      label="Connectors"
      hint="Accounts, MCP connections and tools shared by your agent providers."
    >
      <Button variant="outline" size="sm" onPress={open}>
        Configure Connectors
      </Button>
    </SettingsRow>
  );
}
