export interface FetchAgentOptions {
  agentId: string;
  requestId?: string;
  timeout?: number;
}

// COMPAT(daemon-client-object-options): added in v0.1.102; remove after
// 2026-12-29 once SDK callers have migrated to object parameters.
export function normalizeFetchAgentOptions(
  input: FetchAgentOptions | string,
  legacyOptions?: Omit<FetchAgentOptions, "agentId"> | string,
): FetchAgentOptions {
  if (typeof input !== "string") {
    return input;
  }
  if (typeof legacyOptions === "string") {
    return { agentId: input, requestId: legacyOptions };
  }
  return { agentId: input, ...legacyOptions };
}
