import { create } from "zustand";

const limit = 64;

export const usePromptSuggestions = create<{
  hosts: ReadonlyMap<string, ReadonlyMap<string, string>>;
}>(() => ({ hosts: new Map() }));

export function storePromptSuggestion(
  serverId: string,
  agentId: string,
  text: string | null,
): void {
  usePromptSuggestions.setState((state) => {
    if ((state.hosts.get(serverId)?.get(agentId) ?? null) === text) return state;
    const hosts = new Map(state.hosts);
    const agents = new Map(hosts.get(serverId));
    agents.delete(agentId);
    if (text !== null) agents.set(agentId, text);
    if (agents.size > limit) {
      const oldest = agents.keys().next();
      if (!oldest.done) agents.delete(oldest.value);
    }
    if (agents.size > 0) hosts.set(serverId, agents);
    else hosts.delete(serverId);
    return { hosts };
  });
}

export function clearHostPromptSuggestions(serverId: string): void {
  usePromptSuggestions.setState((state) => {
    if (!state.hosts.has(serverId)) return state;
    const hosts = new Map(state.hosts);
    hosts.delete(serverId);
    return { hosts };
  });
}

export function takePromptSuggestion(serverId: string, agentId: string, expected: string): boolean {
  if (usePromptSuggestions.getState().hosts.get(serverId)?.get(agentId) !== expected) return false;
  storePromptSuggestion(serverId, agentId, null);
  return true;
}
