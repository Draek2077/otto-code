import type { AgentStorage, StoredAgentRecord } from "../../agent/agent-storage.js";
export interface ContextAgent {
  id: string;
  provider: string;
  workspaceId: string | null;
  title: string | null;
  sessionId: string | null;
  internal: boolean;
  cwd?: string;
  fromStorage?: boolean;
}
interface LiveContextAgent {
  id: string;
  provider: string;
  workspaceId?: string;
  cwd: string;
  config: { title?: string | null };
  session: { id: string | null; readonly ottoContextSessionId?: string } | null;
  internal?: boolean;
}
function project(agent: LiveContextAgent | null): ContextAgent | null {
  if (!agent) return null;
  return {
    id: agent.id,
    provider: agent.provider,
    workspaceId: agent.workspaceId ?? null,
    title: agent.config.title ?? null,
    sessionId: agent.session?.ottoContextSessionId ?? agent.session?.id ?? null,
    internal: agent.internal === true,
    cwd: agent.cwd,
  };
}
function stored(record: StoredAgentRecord | null): ContextAgent | null {
  if (!record || record.archivedAt) return null;
  return {
    id: record.id,
    provider: record.provider,
    workspaceId: record.workspaceId ?? null,
    title: record.title ?? null,
    sessionId: null,
    internal: record.internal === true,
    cwd: record.cwd,
    fromStorage: true,
  };
}
/** Project the canonical live/registry owners without loading history or creating a provider session. */
export function contextAgents(
  manager: { getAgent(id: string): LiveContextAgent | null; listAgents(): LiveContextAgent[] },
  registry: Pick<AgentStorage, "get" | "list">,
) {
  return {
    get: async (id: string) => project(manager.getAgent(id)) ?? stored(await registry.get(id)),
    list: async () => {
      const agents = new Map<string, ContextAgent>();
      for (const record of await registry.list()) {
        const value = stored(record);
        if (value) agents.set(value.id, value);
      }
      for (const agent of manager.listAgents()) {
        const value = project(agent);
        if (value) agents.set(value.id, value);
      }
      return [...agents.values()];
    },
  };
}
