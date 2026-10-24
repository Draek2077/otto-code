import { useCallback, useState } from "react";
import { View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { SettingsButton, SettingsCard, SettingsRow } from "@getpaseo/plugin/client/ui";
import { getCapabilities } from "../shared/rpc.js";
import { useRead } from "./use-read.js";
import { ProjectScreen, type KanbanScreenProps } from "./project-screen.js";
// PluginSurfaceScreen already owns HostFilter and the selected host. Never add
// another host inventory, client, fallback host, or global board selection here.
// Match Paseo PageLayout's content rails. The board can use the available work
// area; forms inside it keep the same readable 720px page frame as Settings.
const pageStyle = { flex: 1, minHeight: 0, paddingHorizontal: 16, paddingTop: 24 } as const;
export function KanbanScreen(props: KanbanScreenProps) {
  return (
    <View style={pageStyle} testID="kanban-page-content">
      <KanbanContent {...props} />
    </View>
  );
}
function KanbanContent(props: KanbanScreenProps) {
  // COMPAT(ottoKanban): added in v0.10.0; remove gate after 2027-04-24 when the host floor is v0.10.0.
  const read = useRpc(getCapabilities);
  const [retry, setRetry] = useState(0);
  const retryCapability = useCallback(() => setRetry((value) => value + 1), []);
  const load = useCallback(() => read({ hostId: props.host.id }), [read, props.host.id]);
  const capability = useRead({
    key: `${props.host.id}/${retry}`,
    enabled: true,
    load,
    errorMessage: "Kanban needs a compatible integration on the selected host.",
  });
  if (capability.status === "loading") return <SettingsRow label="Checking Kanban support..." />;
  if (capability.status === "error")
    return (
      <SettingsCard>
        <SettingsRow label="Kanban unavailable" error={capability.message} />
        <SettingsButton onPress={retryCapability}>Retry</SettingsButton>
      </SettingsCard>
    );
  const result = capability.value;
  if (!result.ok) return <SettingsRow label="Kanban unavailable" error={result.error.message} />;
  if (result.value.hostId !== props.host.id || !result.value.read)
    return <SettingsRow label="Kanban board reading is unavailable on this host." />;
  if (!result.value.providers.some((provider) => provider.id === "github" && provider.mutate))
    return <SettingsRow label="Update the host to use Kanban." />;
  return <ProjectScreen {...props} />;
}
