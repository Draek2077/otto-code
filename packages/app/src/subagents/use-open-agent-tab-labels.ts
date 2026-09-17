import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import { getOpenAgentTabLabel } from "@otto-code/protocol/agent-labels";
import { useEffect, useRef, useState } from "react";
import { useSessionStore } from "@/stores/session-store";
import { getOrCreateClientId } from "@/utils/client-id";
import type { WorkspaceTab } from "@/workspace-tabs/model";
import { getAgentTabsNeedingOpenLabel } from "./open-tab-labels";

const RETRY_DELAY_MS = 30_000;

function increment(value: number): number {
  return value + 1;
}

export function useOpenAgentTabLabels(input: {
  client: DaemonClient | null;
  serverId: string;
  tabs: WorkspaceTab[];
  enabled: boolean;
}): void {
  const agents = useSessionStore((state) => state.sessions[input.serverId]?.agents ?? null);
  const agentDetails = useSessionStore(
    (state) => state.sessions[input.serverId]?.agentDetails ?? null,
  );
  const pendingAgentIdsRef = useRef(new Set<string>());
  const failedAgentIdsRef = useRef(new Set<string>());
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);

  useEffect(
    () => () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const client = input.client;
    if (!client || !input.enabled) {
      return;
    }

    const openAgentIds = new Set(
      input.tabs.flatMap((tab) => (tab.target.kind === "agent" ? [tab.target.agentId] : [])),
    );
    for (const agentId of pendingAgentIdsRef.current) {
      if (!openAgentIds.has(agentId)) {
        pendingAgentIdsRef.current.delete(agentId);
      }
    }
    if (openAgentIds.size === 0) {
      return;
    }

    // A failed id stays pending until the retry timer fires. Releasing it
    // immediately let every agents-map change (several per second while anything
    // streams) re-send the same failing request.
    const scheduleRetry = (agentId: string) => {
      failedAgentIdsRef.current.add(agentId);
      retryTimerRef.current ??= setTimeout(() => {
        retryTimerRef.current = null;
        for (const id of failedAgentIdsRef.current) {
          pendingAgentIdsRef.current.delete(id);
        }
        failedAgentIdsRef.current.clear();
        setRetryVersion(increment);
      }, RETRY_DELAY_MS);
    };

    void (async () => {
      try {
        const clientId = await getOrCreateClientId();
        const label = getOpenAgentTabLabel(clientId);
        const agentIds = getAgentTabsNeedingOpenLabel({
          tabs: input.tabs,
          getAgent: (agentId) => agents?.get(agentId) ?? agentDetails?.get(agentId),
          label,
          pendingAgentIds: pendingAgentIdsRef.current,
        });
        for (const agentId of agentIds) {
          pendingAgentIdsRef.current.add(agentId);
          try {
            await client.updateAgent(agentId, { labels: { [label]: "true" } });
            pendingAgentIdsRef.current.delete(agentId);
          } catch (error) {
            console.warn("[OpenAgentTabLabels] Failed to mark open subagent tab", {
              error,
              agentId,
            });
            scheduleRetry(agentId);
          }
        }
      } catch (error) {
        console.warn("[OpenAgentTabLabels] Failed to resolve client ID", { error });
      }
    })();
  }, [agentDetails, agents, input.client, input.enabled, input.tabs, retryVersion]);
}
