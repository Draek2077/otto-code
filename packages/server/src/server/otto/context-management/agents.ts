import type { AgentManager, ManagedAgent } from "../../agent/agent-manager.js";
export interface ContextAgent {
  id: string;
  provider: string;
  workspaceId: string | null;
  title: string | null;
  sessionId: string | null;
  internal: boolean;
  cwd?: string;
}
function project(agent: ManagedAgent | null): ContextAgent | null {
  if (!agent) return null;
  return {
    id: agent.id,
    provider: agent.provider,
    workspaceId: agent.workspaceId ?? null,
    title: agent.config.title ?? null,
    sessionId: agent.session?.id ?? null,
    internal: agent.internal === true,
    cwd: agent.cwd,
  };
}
/** Live projection, not a second chat store or provider session owner. */
export function contextAgents(manager: Pick<AgentManager, "getAgent" | "listAgents">) {
  return {
    get: (id: string) => project(manager.getAgent(id)),
    list: () =>
      manager.listAgents().flatMap((agent) => {
        const value = project(agent);
        return value ? [value] : [];
      }),
  };
}
