import { v4 as uuidv4 } from "uuid";
import type { AgentSnapshotPayload } from "../messages.js";
import type { AgentStorage } from "../agent/agent-storage.js";

// TODO: Remove once all app store clients are on >=0.1.45 and understand arbitrary provider strings.
// Clients before 0.1.45 validate providers with z.enum(["claude", "codex", "opencode"]) and reject
// the entire session message if they encounter an unknown provider.
export const LEGACY_PROVIDER_IDS = new Set(["claude", "codex", "opencode"]);
const MIN_VERSION_ALL_PROVIDERS = "0.1.45";
const MIN_VERSION_EXPLICIT_WORKSPACE_RECOVERY = "0.1.105";
export function errorToFriendlyMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

/** Normalize an optional (possibly-undefined) dependency to `T | null`. */
export function coalesceToNull<T>(value: T | null | undefined): T | null {
  return value ?? null;
}

/**
 * A personality-memory scope arrives as a plain string (forward compat, like
 * roles and effort levels), so an unrecognized value is dropped here rather than
 * coerced - "project" and "global" are different claims, and guessing between
 * them would silently widen or narrow a lesson's reach.
 */
export function readPersonalityMemoryScope(
  value: string | undefined,
): "project" | "global" | undefined {
  if (value === "project" || value === "global") return value;
  return undefined;
}

export function resolveSubscriptionId(
  subscribe: unknown,
  requestedSubscriptionId: string | undefined,
): string | null {
  if (!subscribe) return null;
  if (requestedSubscriptionId && requestedSubscriptionId.length > 0) {
    return requestedSubscriptionId;
  }
  return uuidv4();
}

function isAppVersionAtLeast(appVersion: string | null, minVersion: string): boolean {
  if (!appVersion) return false;
  // Strip prerelease suffix: "0.1.45-beta.4" -> "0.1.45"
  const base = appVersion.replace(/-.*$/, "");
  const parts = base.split(".").map(Number);
  const minParts = minVersion.split(".").map(Number);
  for (let i = 0; i < minParts.length; i++) {
    const a = parts[i] ?? 0;
    const b = minParts[i] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return true;
}

export function clientSupportsAllProviders(appVersion: string | null): boolean {
  return isAppVersionAtLeast(appVersion, MIN_VERSION_ALL_PROVIDERS);
}

export function clientUsesLegacyWorkspaceRestore(appVersion: string | null): boolean {
  return (
    appVersion !== null && !isAppVersionAtLeast(appVersion, MIN_VERSION_EXPLICIT_WORKSPACE_RECOVERY)
  );
}

type DeleteFencedAgentStorage = AgentStorage & {
  beginDelete(agentId: string): void;
};

export function beginAgentDeleteIfSupported(agentStorage: AgentStorage, agentId: string): void {
  if ("beginDelete" in agentStorage && typeof agentStorage.beginDelete === "function") {
    (agentStorage as DeleteFencedAgentStorage).beginDelete(agentId);
  }
}

export function resolveWaitForFinishError(options: {
  status: "permission" | "error" | "idle";
  final: AgentSnapshotPayload | null;
}): string | null {
  if (options.status !== "error") {
    return null;
  }
  const message = options.final?.lastError;
  return typeof message === "string" && message.trim().length > 0 ? message : "Agent failed";
}
