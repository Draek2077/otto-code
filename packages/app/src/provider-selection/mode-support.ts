import type { AgentMode, AgentModelDefinition } from "@otto-code/protocol/agent-types";
import { getUnattendedModeId } from "@otto-code/protocol/provider-manifest";

// Per-model permission-mode support. The daemon stamps `supportsAutoMode:
// false` on catalog models that cannot run the provider's "auto" permission
// mode (e.g. Claude's classifier-based Auto mode is unsupported on Haiku).
// Absent means supported-or-unknown — including old daemons — so only an
// explicit false hides the option; the daemon still coerces at create as the
// backstop.

export function modelSupportsAutoMode(model: AgentModelDefinition | null | undefined): boolean {
  return model?.supportsAutoMode !== false;
}

export function filterModesForModel(
  modes: AgentMode[],
  model: AgentModelDefinition | null | undefined,
): AgentMode[] {
  if (modelSupportsAutoMode(model)) {
    return modes;
  }
  return modes.filter((mode) => mode.id !== "auto");
}

// When "auto" can't run on the selected model (Claude Haiku), we don't drop to
// the provider default ("Always Ask") — Auto is a low-friction safety classifier,
// so its closest safe analog is the provider's guardrailed no-prompt mode (Claude
// "dontAsk": runs without prompting, denies anything not pre-approved). `model` is
// a concrete definition in this branch (supportsAutoMode is only ever stamped
// false on a real model), so `model.provider` resolves the target; a provider with
// no unattended mode falls back to "" (provider default).
export function coerceModeForModel(
  modeId: string,
  model: AgentModelDefinition | null | undefined,
): string {
  if (modeId === "auto" && !modelSupportsAutoMode(model)) {
    return (model ? getUnattendedModeId(model.provider) : undefined) ?? "";
  }
  return modeId;
}

export function findModelDefinition(
  models: readonly AgentModelDefinition[] | null | undefined,
  modelId: string,
): AgentModelDefinition | null {
  if (!modelId) {
    return null;
  }
  return models?.find((model) => model.id === modelId) ?? null;
}
