import type { AgentMode, AgentProvider } from "../agent-sdk-types.js";
interface ProviderSummary {
  id: AgentProvider;
  label: string;
  description: string;
  enabled: boolean;
  modes: AgentMode[];
  status: string;
  error?: string;
}

export function toProviderSummary(entry: {
  provider: AgentProvider;
  label?: string;
  description?: string;
  enabled: boolean;
  modes?: AgentMode[];
  status: string;
  error?: string;
}): ProviderSummary {
  return {
    id: entry.provider,
    label: entry.label ?? entry.provider,
    description: entry.description ?? "",
    enabled: entry.enabled,
    modes: entry.modes ?? [],
    status: entry.status === "ready" ? "available" : entry.status,
    ...(entry.error ? { error: entry.error } : {}),
  };
}
