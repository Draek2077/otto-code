import { useInstalledPlugin } from "@/plugins/registry";
import { PluginInstallationProvider } from "@/plugins/installation-provider";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { BitbucketConnectionSettings } from "./settings";
import { BitbucketAvailable } from "./bridge";
export function OttoBitbucketProjectSettings({
  serverId,
  projectId,
}: {
  serverId: string;
  projectId: string;
}) {
  const plugin = useInstalledPlugin(serverId, "otto-integrations");
  const visible = useAppVisible(),
    retained = useRetainedPanelActive();
  if (!plugin) return null;
  return (
    <BitbucketAvailable hostId={serverId}>
      <PluginInstallationProvider plugin={plugin}>
        <BitbucketConnectionSettings
          key={`${serverId}:${projectId}`}
          hostId={serverId}
          projectId={projectId}
          active={visible && retained}
        />
      </PluginInstallationProvider>
    </BitbucketAvailable>
  );
}
