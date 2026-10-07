import type { AgentFeature, AgentFeatureToggle } from "../../agent-sdk-types.js";
import { claudeManifestModelSupportsFastMode } from "./model-manifest.js";

export const CLAUDE_FAST_MODE_FEATURE: Omit<AgentFeatureToggle, "value"> = {
  type: "toggle",
  id: "fast_mode",
  label: "Fast",
  description: "Lower latency Opus responses at higher token cost",
  tooltip: "Toggle fast mode",
  icon: "zap",
};

/**
 * What the Claude CLI last reported about fast mode on its init and result
 * messages (`fast_mode_state` / `fast_mode_disabled_reason`). The CLI silently
 * serves standard speed when fast mode is blocked, so this is the only signal
 * that the toggle is not taking effect. Kept as plain strings: the CLI grows
 * new reasons over time and an unrecognized one must still surface.
 */
export interface ClaudeFastModeRuntimeStatus {
  state: string | null;
  disabledReason: string | null;
}

export function claudeModelSupportsFastMode(modelId: string | null | undefined): boolean {
  return claudeManifestModelSupportsFastMode(modelId);
}

/** Reads the fast mode fields from an SDK init or result message; null when it carries neither. */
export function readClaudeFastModeRuntimeStatus(
  message: Record<string, unknown>,
): ClaudeFastModeRuntimeStatus | null {
  const state = typeof message.fast_mode_state === "string" ? message.fast_mode_state : null;
  const disabledReason =
    typeof message.fast_mode_disabled_reason === "string"
      ? message.fast_mode_disabled_reason
      : null;
  if (state === null && disabledReason === null) {
    return null;
  }
  return { state, disabledReason };
}

/**
 * Why fast mode is not taking effect, phrased so the user knows what to change.
 * Undefined when nothing blocks it, or while the CLI is still checking.
 */
export function describeClaudeFastModeUnavailability(
  status: ClaudeFastModeRuntimeStatus | null,
): string | undefined {
  if (!status) {
    return undefined;
  }
  if (status.state === "cooldown") {
    return "Fast mode is paused after a rate limit. Responses use standard speed until it resets.";
  }
  switch (status.disabledReason) {
    case null:
    case "pending":
      return undefined;
    case "extra_usage_disabled":
      return "Fast mode is not active: it is billed as usage credits, which are turned off for this Claude account. Turn on extra usage in your Claude account settings.";
    case "free":
      return "Fast mode is not active: it requires a paid Claude plan.";
    case "preference":
      return "Fast mode is not active: your organization has disabled it.";
    case "network_error":
      return "Fast mode is not active: Claude Code could not check availability due to a network error.";
    case "not_first_party":
      return "Fast mode is not active: it is only available when using the Anthropic API directly.";
    case "disabled_by_env":
      return "Fast mode is not active: it is disabled by the Claude Code environment.";
    case "model_not_allowed":
      return "Fast mode is not active: this model is not in your organization's allowed models.";
    case "sdk_opt_in_required":
      return "Fast mode is not active: Claude Code did not receive the fast mode opt-in.";
    default:
      return "Fast mode is currently unavailable.";
  }
}

export function buildClaudeFeatures(input: {
  modelId: string | null | undefined;
  fastModeEnabled: boolean;
  fastModeStatus?: ClaudeFastModeRuntimeStatus | null;
}): AgentFeature[] {
  if (!claudeModelSupportsFastMode(input.modelId)) {
    return [];
  }

  const unavailableReason = describeClaudeFastModeUnavailability(input.fastModeStatus ?? null);
  return [
    {
      ...CLAUDE_FAST_MODE_FEATURE,
      value: input.fastModeEnabled,
      ...(unavailableReason ? { unavailableReason } : {}),
    },
  ];
}
