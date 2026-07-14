import { useCallback, useMemo, useState } from "react";
import type { ProviderSnapshotEntry } from "@otto-code/protocol/agent-types";
import type { PersonalityRole } from "@otto-code/protocol/messages";
import { getActiveAgentTeam } from "@otto-code/protocol/agent-teams";
import type { SelectorPersonality } from "@/components/combined-model-selector";
import type { PersonalityFormValues } from "@/provider-selection/personality-form";
import { buildTeamRoleEntry } from "@/provider-selection/team-role-entry";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useAgentTeamsFeature } from "@/screens/settings/agent-teams-section";
import {
  usePersonalitySelection,
  type PersonalityCurrentSelection,
} from "@/hooks/use-personality-selection";

/**
 * The single contract every surface's personality producer emits and the shared
 * RoleModelSelector consumes. `personalities` + the four selection handlers feed
 * CombinedModelSelector directly; the metadata below is what individual surfaces
 * read to drive their own chrome (effort-hide, row-lock, custom trigger, and —
 * schedules only — the submitted binding). Keeping every surface on one shape is
 * what stops the wiring from drifting again.
 */
export interface RolePersonality {
  personalities: SelectorPersonality[] | undefined;
  selectedPersonalityId: string | null;
  onSelectPersonality: ((id: string) => void) | undefined;
  onClearPersonality: (() => void) | undefined;
  onSelectModelOverPersonality?: (provider: string, modelId: string) => void;
  /** A personality (or "Team's <Role>" slot) is currently selected. */
  hasBoundPersonality: boolean;
  /** Agent strategy only: an agent.personality.set RPC is in flight. Always false for form. */
  isSwitching: boolean;
  /** Display name of the current selection; null when none. */
  selectedName: string | null;
  selectedSpinner?: { glowA: string; glowB: string };
  /** Neutral role glyph when the selection is a "Team's <Role>" slot. */
  selectedRoleIcon?: SelectorPersonality["roleIcon"];
  /**
   * Schedule binding only: the personality name (or team sentinel) to submit as
   * the schedule's stored binding — exactly what the trigger shows, so display
   * and persistence can't diverge. Undefined on apply-now surfaces.
   */
  resolveSubmitPersonality?: () => string | null;
}

// ===========================================================================
// Form strategy — draft composer, artifact sheet, schedule form
// ===========================================================================

/** The synthetic "Team's <Role>" combo entry configuration. */
export interface RoleTeamEntryConfig {
  /** Local picker id for the synthetic row (never leaves the form). */
  entryId: string;
  /** Row display name, e.g. "Team's Chatter". */
  label: string;
  /** Human role label used in the unavailable messages, e.g. "Chatter". */
  roleLabel: string;
  /**
   * Gate the synthetic entry off even when a team is active (the schedule form
   * only offers it for new-agent targets). Defaults to enabled.
   */
  enabled?: boolean;
}

/**
 * Schedule-style persisted binding. When present the producer seeds its team
 * selection from a stored sentinel, keeps an already-bound off-team personality
 * selectable, and exposes resolveSubmitPersonality. Apply-now surfaces omit it.
 */
export interface RolePersonalityBindingConfig {
  /** The stored binding from an edited record: a personality name or the team sentinel. */
  originalBinding: string | null;
  /** The sentinel string meaning "follow the active team's holder of this role" at run time. */
  teamSentinel: string;
}

export interface UseFormRolePersonalityInput {
  serverId: string | null;
  /** Which surface this picker is — only personalities tagged with this role show. */
  role: PersonalityRole;
  entries: readonly ProviderSnapshotEntry[];
  /** Apply the resolved personality/role values to the host form. Must be stable. */
  onApply: (values: PersonalityFormValues) => void;
  /** Current form selection, for match-gated memory (see usePersonalitySelection). */
  currentSelection?: PersonalityCurrentSelection;
  /** Prepend a "Team's <Role>" combo entry when a team is active. Omit for none. */
  team?: RoleTeamEntryConfig;
  /** Persisted-binding behavior (schedules). Omit for apply-now surfaces. */
  binding?: RolePersonalityBindingConfig;
}

/**
 * Form-surface personality producer: the role-filtered roster (via
 * usePersonalitySelection) plus, when a team is active, a synthetic entry that
 * follows the team's holder of `role` at pick time. Selecting the synthetic
 * entry resolves the active team's current holder NOW and applies its
 * provider/model/effort (+ mode on attended surfaces); it stays selected only
 * while it still resolves. With `binding` set it additionally preserves an
 * existing stored binding across edits and emits resolveSubmitPersonality.
 */
export function useFormRolePersonality(input: UseFormRolePersonalityInput): RolePersonality {
  const { serverId, role, entries, onApply, currentSelection, team, binding } = input;
  const { config } = useDaemonConfig(serverId);
  const hasTeamsFeature = useAgentTeamsFeature(serverId ?? "");
  const rosterSource = config?.agentPersonalities?.personalities;
  const activeTeam = useMemo(() => getActiveAgentTeam(config?.agentTeams), [config?.agentTeams]);

  // The already-bound personality stays selectable even when the active team's
  // strict filter would hide it — an edit must not break an existing binding.
  const boundRosterId = useMemo(() => {
    if (!binding || !binding.originalBinding || binding.originalBinding === binding.teamSentinel) {
      return null;
    }
    const target = binding.originalBinding;
    const roster = rosterSource ?? [];
    const match =
      roster.find((entry) => entry.name === target) ??
      roster.find((entry) => entry.name.toLowerCase() === target.toLowerCase());
    return match?.id ?? null;
  }, [binding, rosterSource]);

  const { personalities, selectedPersonalityId, selectPersonality, clearPersonality } =
    usePersonalitySelection({
      serverId,
      role,
      entries,
      onApply,
      currentSelection,
      alwaysIncludePersonalityId: boundRosterId,
    });

  const teamEntryEnabled = team ? (team.enabled ?? true) : false;
  const teamEntry = useMemo(
    () =>
      team && teamEntryEnabled && hasTeamsFeature && activeTeam
        ? buildTeamRoleEntry({
            entryId: team.entryId,
            role,
            label: team.label,
            roleLabel: team.roleLabel,
            team: activeTeam,
            roster: rosterSource ?? [],
            entries,
          })
        : null,
    [team, teamEntryEnabled, hasTeamsFeature, activeTeam, rosterSource, entries, role],
  );
  const teamEntryId = team?.entryId ?? null;

  const [teamEntrySelected, setTeamEntrySelected] = useState(
    binding ? binding.originalBinding === binding.teamSentinel : false,
  );
  // True after any explicit select/clear — gates whether an edit rewrites or
  // preserves the stored binding (a roster that hasn't loaded yet must not
  // silently strip it). Inert on apply-now surfaces (no binding).
  const [bindingTouched, setBindingTouched] = useState(false);

  const displayPersonalities = useMemo<SelectorPersonality[]>(
    () => (teamEntry ? [teamEntry.selector, ...personalities] : personalities),
    [teamEntry, personalities],
  );

  let effectiveSelectedId: string | null;
  if (teamEntrySelected) {
    effectiveSelectedId = teamEntry ? teamEntryId : null;
  } else {
    effectiveSelectedId = selectedPersonalityId ?? (!bindingTouched ? boundRosterId : null);
  }

  const handleSelect = useCallback(
    (id: string) => {
      setBindingTouched(true);
      if (teamEntryId !== null && id === teamEntryId) {
        if (!teamEntry?.values) {
          return;
        }
        setTeamEntrySelected(true);
        onApply(teamEntry.values);
        return;
      }
      setTeamEntrySelected(false);
      selectPersonality(id);
    },
    [teamEntry, teamEntryId, onApply, selectPersonality],
  );

  const handleClear = useCallback(() => {
    setBindingTouched(true);
    setTeamEntrySelected(false);
    clearPersonality();
  }, [clearPersonality]);

  const selectedEntry = useMemo(
    () => displayPersonalities.find((entry) => entry.id === effectiveSelectedId) ?? null,
    [displayPersonalities, effectiveSelectedId],
  );
  const selectedSpinner = useMemo(
    () =>
      selectedEntry?.glowA && selectedEntry.glowB
        ? { glowA: selectedEntry.glowA, glowB: selectedEntry.glowB }
        : undefined,
    [selectedEntry],
  );

  // The name (or sentinel) to submit as the stored binding — exactly what the
  // trigger shows, so display and persistence can't diverge. Only meaningful on
  // binding surfaces; undefined elsewhere.
  const resolveSubmitPersonality = useCallback((): string | null => {
    if (!binding) {
      return null;
    }
    if (teamEntrySelected) {
      if (teamEntry) {
        return binding.teamSentinel;
      }
      // Teams aren't visible right now (no active team / old daemon): an
      // untouched edit must not silently clear the stored sentinel.
      return bindingTouched ? null : binding.originalBinding;
    }
    if (effectiveSelectedId) {
      const selected = personalities.find((entry) => entry.id === effectiveSelectedId);
      if (selected) {
        return selected.name;
      }
    }
    return bindingTouched ? null : binding.originalBinding;
  }, [binding, teamEntrySelected, teamEntry, bindingTouched, effectiveSelectedId, personalities]);

  return {
    personalities: displayPersonalities,
    selectedPersonalityId: effectiveSelectedId,
    onSelectPersonality: handleSelect,
    onClearPersonality: handleClear,
    hasBoundPersonality: effectiveSelectedId != null,
    isSwitching: false,
    selectedName: selectedEntry?.name ?? null,
    selectedSpinner,
    selectedRoleIcon: selectedEntry?.roleIcon,
    resolveSubmitPersonality: binding ? resolveSubmitPersonality : undefined,
  };
}

// ===========================================================================
// Agent strategy — running-agent message box (live agent.personality.set RPC)
// ===========================================================================

/**
 * The subset of a running-agent personality hook's result the contract maps
 * from. The running-agent producer (useRunningChatPersonality, which owns the
 * RPC/confirm/lock behavior) returns exactly this shape; toRolePersonality lifts
 * it onto the shared contract so the running box renders the same
 * RoleModelSelector as every other surface.
 */
export interface AgentPersonalityResult {
  personalities: SelectorPersonality[] | undefined;
  selectedPersonalityId: string | null;
  onSelectPersonality: ((id: string) => void) | undefined;
  onClearPersonality: (() => void) | undefined;
  onSelectModelOverPersonality: ((provider: string, modelId: string) => void) | undefined;
  hasBoundPersonality: boolean;
  /** True while an agent.personality.set RPC is in flight. */
  isSwitching: boolean;
}

/** Lift a running-agent personality result onto the shared RolePersonality contract. */
export function toRolePersonality(result: AgentPersonalityResult): RolePersonality {
  const selected =
    result.personalities?.find((entry) => entry.id === result.selectedPersonalityId) ?? null;
  const selectedSpinner =
    selected?.glowA && selected.glowB
      ? { glowA: selected.glowA, glowB: selected.glowB }
      : undefined;
  return {
    personalities: result.personalities,
    selectedPersonalityId: result.selectedPersonalityId,
    onSelectPersonality: result.onSelectPersonality,
    onClearPersonality: result.onClearPersonality,
    onSelectModelOverPersonality: result.onSelectModelOverPersonality,
    hasBoundPersonality: result.hasBoundPersonality,
    isSwitching: result.isSwitching,
    selectedName: selected?.name ?? null,
    selectedSpinner,
    selectedRoleIcon: selected?.roleIcon,
  };
}
