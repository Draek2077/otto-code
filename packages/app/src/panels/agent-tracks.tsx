import { memo, useCallback, type ReactElement } from "react";
import { WorkspaceDiffStatPill } from "@/composer/diff-stat-pill";
import { AgentTaskList } from "@/composer/task-list";
import { ComposerTrackBar } from "@/composer/tracks";
import { useWorkspaceHasDiffStat } from "@/composer/workspace-diff-stat";
import { useWorkspaceChangeIndicator } from "@/hooks/use-workspace-change-indicator";
import { useAutoClearCompletedSubagentsSetting } from "@/hooks/use-auto-clear-completed-subagents";
import { useSettings } from "@/hooks/use-settings";
import { useIsCompactFormFactor } from "@/constants/layout";
import { usePaneContext } from "@/panels/pane-context";
import { useSessionStore } from "@/stores/session-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { openPreferredWorkspaceTarget } from "@/workspace-tabs/open-beside";
import {
  useArchiveSubagent,
  useAutoClearCompletedSubagents,
  useClearCompletedSubagents,
  useDetachSubagent,
  useStopSubagent,
  useSubagentsForParent,
} from "@/subagents";
import { SubagentsPillTrack } from "@/subagents/pill-track";
import { navigateToAgent } from "@/utils/navigate-to-agent";

/**
 * Paseo's composer-track renderer. It deliberately reads the ordinary Otto
 * subagent selector and calls the ordinary Otto actions: this is a view switch,
 * never a second provider-subagent store or ingestion path.
 */
export const AgentTracks = memo(function AgentTracks({
  serverId,
  workspaceId,
  agentId,
}: {
  serverId: string;
  workspaceId: string;
  agentId: string;
}): ReactElement | null {
  const { tabId } = usePaneContext();
  const isCompact = useIsCompactFormFactor();
  const openInSidePane = useSettings((settings) => settings.openInSidePane);
  const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
  const rows = useSubagentsForParent({ serverId, parentAgentId: agentId });
  const canDetach = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.agentDetach === true,
  );
  const archiveSubagent = useArchiveSubagent({ serverId });
  const stopSubagent = useStopSubagent({ serverId });
  const clearCompleted = useClearCompletedSubagents({ serverId, parentAgentId: agentId });
  const detachSubagent = useDetachSubagent({ serverId });
  const autoClearCompleted = useAutoClearCompletedSubagentsSetting();
  const workspaceChangeIndicator = useWorkspaceChangeIndicator();
  useAutoClearCompletedSubagents({
    serverId,
    parentAgentId: agentId,
    rows,
    enabled: autoClearCompleted,
  });
  const hasDiff = useWorkspaceHasDiffStat(serverId, workspaceId, workspaceChangeIndicator);
  const hasTasks = useSessionStore((state) =>
    Boolean(state.sessions[serverId]?.agentTasks.get(agentId)?.length),
  );

  const openSubagent = useCallback(
    (subagentId: string) => {
      const session = useSessionStore.getState().sessions[serverId];
      const subagent = session?.agents.get(subagentId) ?? session?.agentDetails.get(subagentId);
      if (subagent?.workspaceId && subagent.workspaceId !== workspaceId) {
        navigateToAgent({ serverId, agentId: subagentId });
        return;
      }
      openPreferredWorkspaceTarget({
        isCompact,
        workspaceKey,
        target: { kind: "agent", agentId: subagentId },
        source: "subagents",
        preferences: openInSidePane,
        parentTabId: tabId,
      });
    },
    [isCompact, openInSidePane, serverId, tabId, workspaceId, workspaceKey],
  );
  const openProviderSubagent = useCallback(
    (parentAgentId: string, subagentId: string) => {
      openPreferredWorkspaceTarget({
        isCompact,
        workspaceKey,
        target: { kind: "provider_subagent", parentAgentId, subagentId },
        source: "subagents",
        preferences: openInSidePane,
        parentTabId: tabId,
      });
    },
    [isCompact, openInSidePane, tabId, workspaceKey],
  );
  const openChanges = useCallback(() => {
    openPreferredWorkspaceTarget({
      isCompact,
      workspaceKey,
      target: { kind: "working_diff" },
      source: "changesLinks",
      preferences: openInSidePane,
      parentTabId: tabId,
    });
  }, [isCompact, openInSidePane, tabId, workspaceKey]);

  if (!hasDiff && rows.length === 0 && !hasTasks) return null;
  return (
    <ComposerTrackBar>
      <AgentTaskList serverId={serverId} agentId={agentId} />
      <SubagentsPillTrack
        rows={rows}
        onOpenSubagent={openSubagent}
        onOpenProviderSubagent={openProviderSubagent}
        onArchiveSubagent={archiveSubagent}
        onStopSubagent={stopSubagent}
        onClearCompleted={clearCompleted}
        onDetachSubagent={canDetach ? detachSubagent : undefined}
      />
      <WorkspaceDiffStatPill
        serverId={serverId}
        workspaceId={workspaceId}
        indicator={workspaceChangeIndicator}
        onPress={openChanges}
      />
    </ComposerTrackBar>
  );
});
