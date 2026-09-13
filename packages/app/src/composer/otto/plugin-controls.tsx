import { PluginComposerPills, useHasPluginComposerPills } from "@/plugins";
import { ComposerTrackBar } from "@/composer/tracks";
import { useIsCompactFormFactor } from "@/constants/layout";

/**
 * Plugin actions remain available when Otto renders subagents as full panels.
 * Mount inside the transcript's containing block, like AgentTracks: the shared
 * track bar anchors to its bottom, and the stream owns its tail clearance.
 */
export function OttoPluginComposerTrack({
  serverId,
  workspaceId,
  agentId,
}: {
  serverId: string;
  workspaceId: string;
  agentId: string;
}) {
  const compact = useIsCompactFormFactor();
  const hasPills = useHasPluginComposerPills(serverId, workspaceId, agentId);
  if (!hasPills) return null;
  return (
    <ComposerTrackBar>
      <PluginComposerPills
        serverId={serverId}
        workspaceId={workspaceId}
        agentId={agentId}
        compact={compact}
      />
    </ComposerTrackBar>
  );
}
