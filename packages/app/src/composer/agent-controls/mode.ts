import type { DraftAgentControlsProps } from "@/composer/agent-controls";
import type { AgentMode } from "@otto-code/protocol/agent-types";
import { isUserSelectableMode } from "@otto-code/protocol/provider-manifest";

export interface ModeSelection {
  /** Modes the user may pick — the dropdown options (excludes hidden modes). */
  selectableModes: AgentMode[];
  /** The active mode, resolved from the full set so a hidden active mode still shows. */
  selectedMode: AgentMode | null;
  /** True when the active mode isn't user-selectable and the surface locks it. */
  isLocked: boolean;
}

// Splits the provider's modes into what a user may pick vs. what merely displays.
// Hidden modes (Claude "dontAsk") never appear as options, but an agent already in
// one still resolves its label/icon; on a locking surface (a live agent) that also
// locks the control. Fallback to a *selectable* default only when the active id is
// unknown, so an unknown selection never silently defaults into a hidden mode.
export function resolveModeSelection({
  provider,
  modeOptions,
  selectedModeId,
  lockNonSelectable,
}: {
  provider: string;
  modeOptions: readonly AgentMode[];
  selectedModeId: string | null | undefined;
  lockNonSelectable: boolean;
}): ModeSelection {
  const selectableModes = modeOptions.filter((mode) => isUserSelectableMode(provider, mode.id));
  if (modeOptions.length === 0) {
    return { selectableModes, selectedMode: null, isLocked: false };
  }
  const selectedMode =
    modeOptions.find((mode) => mode.id === selectedModeId) ?? selectableModes[0] ?? modeOptions[0];
  const isLocked =
    lockNonSelectable && selectedMode ? !isUserSelectableMode(provider, selectedMode.id) : false;
  return { selectableModes, selectedMode, isLocked };
}

export function resolveNextAgentModeId({
  modeOptions,
  selectedMode,
}: {
  modeOptions: readonly AgentMode[];
  selectedMode: string | null | undefined;
}): string | null {
  if (modeOptions.length < 2) return null;

  const selectedIndex = modeOptions.findIndex((mode) => mode.id === selectedMode);
  const currentIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const nextIndex = (currentIndex + 1) % modeOptions.length;
  return modeOptions[nextIndex]?.id ?? null;
}

export function resolveAgentControlsMode(agentControls?: DraftAgentControlsProps) {
  return agentControls ? "draft" : "ready";
}
