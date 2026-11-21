import type { SessionInfo } from "@opencode/client";
import type { AgentUsage } from "../../agent/agent-sdk-types.js";

export type OpenCodeUsageSnapshot = Pick<SessionInfo, "tokens" | "cost">;

/** A turn measured at its dispatch boundaries. Session totals may include restored history. */
export function openCodeActivityUsage(
  start: OpenCodeUsageSnapshot,
  end: OpenCodeUsageSnapshot,
): AgentUsage {
  const read = Math.max(0, end.tokens.cache.read - start.tokens.cache.read);
  const write = Math.max(0, end.tokens.cache.write - start.tokens.cache.write);
  return {
    inputTokens: Math.max(0, end.tokens.input - start.tokens.input) + read + write,
    cachedInputTokens: read,
    outputTokens: Math.max(0, end.tokens.output - start.tokens.output),
    totalCostUsd: Math.max(0, end.cost - start.cost),
  };
}
