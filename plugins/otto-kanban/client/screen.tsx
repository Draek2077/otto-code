import { useCallback, useState } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import { SettingsButton, SettingsCard, SettingsRow } from "@getpaseo/plugin/client/ui";
import { getCapabilities } from "../shared/rpc.js";
import { useRead } from "./use-read.js";
import { ProjectScreen, type KanbanScreenProps } from "./project-screen.js";
// PluginSurfaceScreen already owns HostFilter and the selected host. Never add
// another host inventory, client, fallback host, or global board selection here.
export function KanbanScreen(props: KanbanScreenProps) {
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
  return <ProjectScreen {...props} />;
}
