import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import { getOpenAgentTabLabel } from "@otto-code/protocol/agent-labels";
import { useEffect, useRef, useState } from "react";
import { useSessionStore } from "@/stores/session-store";
import { getOrCreateClientId } from "@/utils/client-id";
import type { WorkspaceTab } from "@/workspace-tabs/model";
import { getAgentTabsNeedingOpenLabel } from "./open-tab-labels";

const RETRY_DELAY_MS = 30_000;
const NO_PENDING_AGENT_IDS: ReadonlySet<string> = new Set();

function increment(value: number): number {
  return value + 1;
}

export function useOpenAgentTabLabels(input: {
  client: DaemonClient | null;
  serverId: string;
  tabs: WorkspaceTab[];
  enabled: boolean;
}): void {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getOrCreateClientId()
      .then((clientId) => {
        if (!cancelled) setLabel(getOpenAgentTabLabel(clientId));
        return undefined;
      })
      .catch((error: unknown) => {
        console.warn("[OpenAgentTabLabels] Failed to resolve client ID", { error });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  // Select the answer, never the agents map. This hook runs in
  // WorkspaceScreenContent, and the map is replaced on every agent_update for
  // any agent on the host (several per second while agents work), which
  // re-rendered the whole visible workspace and its tab strip each time:
  // measured ~130ms per update in a dev build. A joined id string only changes
  // when an open tab's agent actually needs the label.
  const needingLabelKey = useSessionStore((state) => {
    if (!label) return "";
    const session = state.sessions[input.serverId];
    return getAgentTabsNeedingOpenLabel({
      tabs: input.tabs,
      getAgent: (agentId) => session?.agents.get(agentId) ?? session?.agentDetails.get(agentId),
      label,
      pendingAgentIds: NO_PENDING_AGENT_IDS,
    }).join("\0");
  });
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
    if (!client || !input.enabled || !label) {
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
    if (openAgentIds.size === 0 || needingLabelKey === "") {
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

    const agentIds = needingLabelKey
      .split("\0")
      .filter((agentId) => !pendingAgentIdsRef.current.has(agentId));
    void (async () => {
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
    })();
  }, [input.client, input.enabled, input.tabs, label, needingLabelKey, retryVersion]);
}
