import {
  getAgentProviderDefinition,
  isUserSelectableMode,
} from "@otto-code/protocol/provider-manifest";

import type { AgentMode, AgentProvider } from "./agent-sdk-types.js";

export interface ResolveModelPickExitModeInput {
  provider: AgentProvider;
  // The agent's active mode. Null/undefined = nothing to exit.
  currentModeId: string | null | undefined;
  // The agent's own modes, so dynamic (ACP) rosters resolve too.
  availableModes: readonly AgentMode[];
}

function isUnattendedMode(mode: AgentMode): boolean {
  return mode.isUnattended === true;
}

function selectsModel(mode: AgentMode): boolean {
  return mode.selectsModel === true;
}

/**
 * Where an agent lands when an explicit model pick pulls it out of a mode that
 * picks the model itself (Claude's Auto, where the CLI routes each turn to its
 * own choice and a chosen model silently loses).
 *
 * Returns undefined when there is nothing to do, which is the case for every
 * provider that has no such mode — the coercion is driven by the `selectsModel`
 * flag on the mode, never by a provider or mode-id check. Codex has a mode
 * literally named "auto" that is a permission level and nothing else; it is
 * correctly untouched.
 *
 * The landing mode is the provider's own declared default (Claude: "Always
 * Ask"). Otto keeps no record of the mode an agent held before it entered Auto,
 * so there is no earlier state to restore — the provider default is the honest
 * choice rather than a guess. Two invariants constrain it:
 *
 *  - Attendedness is preserved. Coercing an unattended run into a mode that
 *    prompts would strand it on the first approval, undoing the unattended
 *    coercion in create-agent-mode.ts. A model-selecting mode that is itself
 *    unattended can only land on another unattended mode.
 *  - System-assigned modes (`userSelectable: false`) are never a landing spot,
 *    since they lock the mode control.
 *
 * With no candidate satisfying both, this returns undefined and the caller
 * leaves the mode alone: a wrong mode is worse than a stale one.
 */
export function resolveModelPickExitModeId(
  input: ResolveModelPickExitModeInput,
): string | undefined {
  const { provider, currentModeId, availableModes } = input;
  if (!currentModeId) {
    return undefined;
  }
  const currentMode = availableModes.find((mode) => mode.id === currentModeId);
  if (!currentMode || !selectsModel(currentMode)) {
    return undefined;
  }

  const mustStayUnattended = isUnattendedMode(currentMode);
  const candidates = availableModes.filter(
    (mode) =>
      !selectsModel(mode) &&
      isUnattendedMode(mode) === mustStayUnattended &&
      isUserSelectableMode(provider, mode.id),
  );
  if (candidates.length === 0) {
    return undefined;
  }

  const providerDefaultModeId = getAgentProviderDefinition(provider)?.defaultModeId ?? null;
  const providerDefault = providerDefaultModeId
    ? candidates.find((mode) => mode.id === providerDefaultModeId)
    : undefined;
  return (providerDefault ?? candidates[0]).id;
}
