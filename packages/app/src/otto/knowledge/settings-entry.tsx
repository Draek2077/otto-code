import { useCallback } from "react";
import { router } from "expo-router";
import { SettingsCard, SettingsRow } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { useInstalledPlugin } from "@/plugins/registry";
import { buildPluginSettingsRoute } from "@/plugins/settings/routes";

/** Built-ins have no user-installed row, so their settings need an explicit entry. */
export function KnowledgeSettingsEntry({ serverId }: { serverId: string }) {
  const plugin = useInstalledPlugin(serverId, "otto-project-knowledge");
  const open = useCallback(
    () => router.push(buildPluginSettingsRoute(serverId, "otto-project-knowledge", "knowledge")),
    [serverId],
  );
  if (!plugin?.settingsScreens.some((screen) => screen.id === "knowledge")) return null;
  return (
    <SettingsCard>
      <SettingsRow label="Knowledge">
        <Button variant="outline" size="sm" onPress={open}>
          Configure Knowledge
        </Button>
      </SettingsRow>
    </SettingsCard>
  );
}
