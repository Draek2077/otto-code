import type { AgentBehaviorSettings } from "./agent-sdk-types.js";
import {
  STALL_GUARD_DEFAULT_THRESHOLD,
  STALL_GUARD_MAX_THRESHOLD,
  STALL_GUARD_MIN_THRESHOLD,
} from "@otto-code/protocol/provider-config";

// Resolve the daemon-wide behavior toggles from their optional config shape.
// Mirrors the persist-layer rule (daemon-config-store.readAgentBehaviors): a
// field is on unless it is explicitly `false`, so absent/undefined preserves
// today's all-on behavior.
export function resolveAgentBehaviorSettings(
  behaviors:
    | {
        promptSuggestions?: boolean;
        agentProgressSummaries?: boolean;
        notifyOnFinishDefault?: boolean;
        todoNudge?: boolean;
        todoReconcileOnIdle?: boolean;
        stallGuardThreshold?: number;
      }
    | undefined,
): AgentBehaviorSettings {
  return {
    promptSuggestions: behaviors?.promptSuggestions !== false,
    agentProgressSummaries: behaviors?.agentProgressSummaries !== false,
    notifyOnFinishDefault: behaviors?.notifyOnFinishDefault !== false,
    todoNudge: behaviors?.todoNudge !== false,
    todoReconcileOnIdle: behaviors?.todoReconcileOnIdle !== false,
    stallGuardThreshold: resolveStallGuardThreshold(behaviors?.stallGuardThreshold),
  };
}

/**
 * Clamp the stall-guard threshold into [MIN, MAX], keeping 0 (disabled) as an
 * explicit escape hatch. A hand-edited config can turn the guard off outright
 * but cannot set it to a hair trigger. Missing or non-finite values fall back
 * to the default rather than silently disabling the guard.
 */
function resolveStallGuardThreshold(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return STALL_GUARD_DEFAULT_THRESHOLD;
  }
  const rounded = Math.round(value);
  if (rounded <= 0) {
    return 0;
  }
  return Math.min(STALL_GUARD_MAX_THRESHOLD, Math.max(STALL_GUARD_MIN_THRESHOLD, rounded));
}
