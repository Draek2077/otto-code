import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useArchiveAgent } from "@/hooks/use-archive-agent";
import { useSessionStore } from "@/stores/session-store";
import {
  createArchiveFinishedSubagents,
  type ArchiveFinishedOutcome,
  type ArchiveFinishedState,
  type ArchiveFinishedSubagents,
} from "./archive-finished";
import { controlProviderSubagent } from "./provider-subagent-control";
import type { SubagentRow } from "./select";

export type { ArchiveFinishedStatus } from "./archive-finished";

export interface UseArchiveFinishedSubagentsInput {
  serverId: string;
  parentAgentId: string;
  rows: readonly SubagentRow[];
}

export interface ArchiveFinishedSubagentsCapability extends ArchiveFinishedState {
  archiveFinished: () => Promise<ArchiveFinishedOutcome>;
}

export function useArchiveFinishedSubagents({
  serverId,
  parentAgentId,
  rows,
}: UseArchiveFinishedSubagentsInput): ArchiveFinishedSubagentsCapability {
  const { archiveAgent } = useArchiveAgent();
  const archiveFinished = useMemo<ArchiveFinishedSubagents>(
    () =>
      createArchiveFinishedSubagents([], {
        parentAgentId,
        getManagedSubagent: (id) => useSessionStore.getState().sessions[serverId]?.agents.get(id),
        archiveManagedSubagent: (id) => archiveAgent({ serverId, agentId: id }),
        archiveProviderSubagent: (id) =>
          controlProviderSubagent(serverId, parentAgentId, id, "archive"),
      }),
    [archiveAgent, parentAgentId, serverId],
  );
  const state = useSyncExternalStore(
    archiveFinished.subscribe,
    archiveFinished.getState,
    archiveFinished.getState,
  );

  useEffect(() => {
    archiveFinished.setRows(rows);
  }, [archiveFinished, rows]);

  return { ...state, archiveFinished: archiveFinished.archiveFinished };
}
