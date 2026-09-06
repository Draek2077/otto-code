interface AgentAncestry {
  parentAgentId?: string | null;
  workspaceId?: string | null;
}

/** The adapter groups attended and observed children in their workspace root's
 * session. Selection must use this same identity, including from a child tab. */
export function resolveRootAgentId(
  agentId: string,
  agentsById: ReadonlyMap<string, AgentAncestry>,
): string {
  let currentId = agentId;
  const workspaceId = agentsById.get(agentId)?.workspaceId;
  for (let depth = 0; depth < 8; depth += 1) {
    const parentId = agentsById.get(currentId)?.parentAgentId;
    const parent = parentId ? agentsById.get(parentId) : undefined;
    if (!parentId || !parent || parent.workspaceId !== workspaceId) return currentId;
    currentId = parentId;
  }
  return currentId;
}
