import { useMemo } from "react";
import { useInstalledPlugin } from "@/plugins/registry";
import { PluginInstallationProvider } from "@/plugins/installation-provider";
import { useHostFeature } from "@/runtime/host-features";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useRetainedPanelActive } from "@/components/retained-panel";
import type { ArtifactScope } from "@getpaseo/plugin/otto/artifacts";
import { ProjectStorageSettings } from "./screen";
/** The canonical project settings page owns placement; the feature owns its controls and RPC. */
export function OttoArtifactProjectSettings({
  serverId,
  projectId,
}: {
  serverId: string;
  projectId: string;
}) {
  const plugin = useInstalledPlugin(serverId, "otto-artifacts");
  const available = useHostFeature(serverId, "ottoArtifacts"),
    visible = useAppVisible(),
    retained = useRetainedPanelActive();
  const scope = useMemo<ArtifactScope>(
    () => ({ hostId: serverId, target: { kind: "project", id: projectId } }),
    [serverId, projectId],
  );
  if (!available || !plugin) return null;
  return (
    <PluginInstallationProvider plugin={plugin}>
      <ProjectStorageSettings scope={scope} active={visible && retained} />
    </PluginInstallationProvider>
  );
}
