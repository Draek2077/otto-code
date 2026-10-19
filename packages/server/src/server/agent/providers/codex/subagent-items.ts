/** Codex emits camelCase thread items and PascalCase/snake_case event items. */
export function normalizeCodexSubagentItem(item: unknown): Record<string, unknown> | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const record = item as Record<string, unknown>;
  if (record.type === "subAgentActivity" || record.type === "SubAgentActivity") {
    return {
      ...record,
      type: "subAgentActivity",
      agentThreadId: record.agentThreadId ?? record.agent_thread_id,
      agentPath: record.agentPath ?? record.agent_path,
    };
  }
  if (record.type === "collabAgentToolCall" || record.type === "CollabAgentToolCall") {
    return {
      ...record,
      type: "collabAgentToolCall",
      receiverThreadIds: record.receiverThreadIds ?? record.receiver_thread_ids,
      agentsStates: record.agentsStates ?? record.agents_states,
    };
  }
  return record;
}

/** Coordination targets are references, never declarations of child ownership. */
export function readCodexOwnedSubagentThreadIds(item: unknown): string[] {
  const record = normalizeCodexSubagentItem(item);
  if (record?.type === "subAgentActivity" && record.kind === "started") {
    return typeof record.agentThreadId === "string" && record.agentThreadId.length > 0
      ? [record.agentThreadId]
      : [];
  }
  if (
    record?.type !== "collabAgentToolCall" ||
    record.tool !== "spawnAgent" ||
    !Array.isArray(record.receiverThreadIds)
  )
    return [];
  return record.receiverThreadIds.filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
}
