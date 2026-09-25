import type { AgentStorage } from "../agent/agent-storage.js";
import type { AgentClient, AgentProvider } from "../agent/agent-sdk-types.js";
import { buildImportedTimelineRows } from "../agent/timeline-display.js";

type Clients = ReadonlyMap<AgentProvider, AgentClient>;

export async function getSearchHistoryRevision(
  registry: AgentStorage | undefined,
  clients: Clients,
  id: string,
): Promise<string | null> {
  const record = await registry?.get(id);
  if (!record?.persistence || record.internal) return null;
  return (
    clients.get(record.provider)?.getSearchHistoryRevision?.(record.persistence, record.cwd) ?? null
  );
}

export async function readSearchHistory(
  registry: AgentStorage | undefined,
  clients: Clients,
  id: string,
  signal?: AbortSignal,
) {
  const record = await registry?.get(id);
  if (!record?.persistence || record.internal) return null;
  const client = clients.get(record.provider);
  if (!client?.readSearchHistory) return null;
  signal?.throwIfAborted();
  const history = await client.readSearchHistory(record.persistence, record.cwd, signal);
  signal?.throwIfAborted();
  return buildImportedTimelineRows(history);
}
