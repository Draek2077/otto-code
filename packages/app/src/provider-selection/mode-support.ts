import type { AgentMode, AgentModelDefinition } from "@otto-code/protocol/agent-types";

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

/** "" (provider default) when the selected mode is auto but the model can't run it. */
export function coerceModeForModel(
  modeId: string,
  model: AgentModelDefinition | null | undefined,
): string {
  if (modeId === "auto" && !modelSupportsAutoMode(model)) {
    return "";
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
