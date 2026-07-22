import type { QueryClient } from "@tanstack/react-query";
import type { PromptTemplate } from "@otto-code/protocol/orchestration";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";

// Query keys + cache helpers for the host-level prompt templates a graph node
// can bind to (projects/orchestration-graphs). Same replica discipline as
// orchestration graphs: fetched once, then replaced wholesale by
// runs.templates.changed.notification, which carries the full list.

export function promptTemplatesQueryKey(serverId: string): readonly unknown[] {
  return ["prompt-templates", serverId, "list"];
}

export type PromptTemplatesClient = Pick<DaemonClient, "listPromptTemplates">;

export async function fetchPromptTemplates(input: {
  client: PromptTemplatesClient;
}): Promise<PromptTemplate[]> {
  return input.client.listPromptTemplates();
}

/** Replace the cached list with a pushed full snapshot; no-op before first fetch. */
export function applyPromptTemplatesChanged(input: {
  queryClient: QueryClient;
  serverId: string;
  templates: PromptTemplate[];
}): void {
  const key = promptTemplatesQueryKey(input.serverId);
  const existing = input.queryClient.getQueryData<PromptTemplate[]>(key);
  if (!existing) {
    return;
  }
  input.queryClient.setQueryData<PromptTemplate[]>(key, input.templates);
}
