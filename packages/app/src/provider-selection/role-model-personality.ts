import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProviderSnapshotEntry } from "@otto-code/protocol/agent-types";
import type { PersonalityRole } from "@otto-code/protocol/messages";
import { getActiveAgentTeam } from "@otto-code/protocol/agent-teams";
import type {
  SelectorPersonality,
  SelectorPersonalityGroupSection,
} from "@/components/combined-model-selector";
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
  /**
   * The id to actually spawn with. Identical to `selectedPersonalityId` except
   * when the synthetic "Team's <Role>" slot is picked: that id is a UI-only
   * sentinel (`__team-chatter__`) no roster entry matches, so sending it made the
   * daemon's roster lookup miss and spawn a bare agent — no personality prompt,
   * no team prompt, and whatever model the device happened to remember. Read this
   * for anything that crosses the wire; read `selectedPersonalityId` for the picker.
   */
  spawnPersonalityId?: string | null;
  /**
   * The whole roster grouped by team + role for the picker's collapsible
   * browse section. Form surfaces supply it; the running-agent strategy leaves
   * it undefined (its picker is locked to the agent's provider family).
   */
  personalityGroups?: SelectorPersonalityGroupSection[];
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
  /**
   * Auto-pick a sensible default on open instead of leaving the form on its
   * device-last model. Runs once, only while the user hasn't touched the picker
   * and no stored binding is being edited.
   *
   * - `"always"` — the active team's holder of `role` (the "Team's <Role>"
   *   entry) if a team is active, else the first available personality carrying
   *   `role`, else nothing. Suppresses the remembered-personality preselect so
   *   the default always wins. Used by create surfaces whose record has no
   *   history of its own (new schedule, new artifact).
   * - `"fallback"` — the default is restricted to the team entry, and it is the
   *   ACTIVE TEAM that decides who arbitrates:
   *     - Team active → identical to `"always"`. The team entry wins and device
   *       memory is suppressed. An active team is an explicit, host-level choice;
   *       a device-local last-used personality is a leftover, and must never
   *       outrank it. (It used to, and the result was a latch: the first pick
   *       set `lastPersonalityByRole` and also rewrote the device's last-used
   *       model, so memory matched forever after and the team's holder could
   *       never auto-apply again — the team entry never persists a last
   *       personality, so nothing could clear it.)
   *     - No team → no default at all. There is nothing principled to pick, so
   *       the form keeps whatever model it landed on and device memory is the
   *       only preselect, exactly as before teams existed.
   *   This is what the new-chat composer wants.
   * - omitted / `false` — no default; the form keeps its last-used model.
   */
  autoSelectDefault?: false | "always" | "fallback";
}

/**
 * Does the surface's own default own the initial pick outright, suppressing the
 * device-local remembered-personality preselect? True for `"always"`, and for
 * `"fallback"` whenever the team slot is live — an active team is an explicit
 * host-level choice and outranks device memory. See `autoSelectDefault`.
 */
function defaultOwnsInitialPick(
  autoSelectDefault: UseFormRolePersonalityInput["autoSelectDefault"],
  teamSlotLive: boolean,
): boolean {
  return autoSelectDefault === "always" || (autoSelectDefault === "fallback" && teamSlotLive);
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
  const { serverId, role, entries, onApply, currentSelection, team, binding, autoSelectDefault } =
    input;
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

  const teamEntryEnabled = team ? (team.enabled ?? true) : false;
  // Is the synthetic "Team's <Role>" slot actually live on this surface right
  // now? Computed before the roster hook because it decides who owns the
  // initial pick (below), not just what the picker renders.
  const teamSlotLive = teamEntryEnabled && hasTeamsFeature && activeTeam !== null;

  const {
    personalities,
    personalityGroups,
    selectedPersonalityId,
    selectPersonality,
    clearPersonality,
  } = usePersonalitySelection({
    serverId,
    role,
    entries,
    onApply,
    currentSelection,
    alwaysIncludePersonalityId: boundRosterId,
    // A surface whose default is unconditional owns the initial pick outright;
    // the remembered-personality preselect must not race ahead of it. Under an
    // active team "fallback" is unconditional too — the team decides, so memory
    // is suppressed there for the same reason.
    preselectRemembered: !defaultOwnsInitialPick(autoSelectDefault, teamSlotLive),
  });
  const teamEntry = useMemo(
    () =>
      team && teamSlotLive && activeTeam
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
    [team, teamSlotLive, activeTeam, rosterSource, entries, role],
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

  // One-shot default pick for surfaces that opt in (schedule/artifact create):
  // the active team's holder of `role`, else the first available personality
  // carrying it, else nothing. Waits for the roster + provider snapshot to load
  // (deciding on an empty snapshot would wrongly read as "nothing available")
  // and never overrides a user choice or a stored binding being edited.
  const defaultAppliedRef = useRef(false);
  useEffect(() => {
    if (!autoSelectDefault || defaultAppliedRef.current) {
      return;
    }
    // Any explicit pick, a seeded team sentinel, or a stored binding under edit
    // already owns the selection — settle without imposing a default.
    if (
      bindingTouched ||
      teamEntrySelected ||
      selectedPersonalityId !== null ||
      binding?.originalBinding
    ) {
      defaultAppliedRef.current = true;
      return;
    }
    // Not enough loaded yet to tell what's available — try again next render.
    if (!config || entries.length === 0) {
      return;
    }
    // Team entry only: with no active team (or a team whose holder of this role
    // doesn't resolve) there is nothing principled to fall back to, so the form
    // keeps the model it already landed on and device memory stands alone.
    if (autoSelectDefault === "fallback" && !teamEntry?.values) {
      defaultAppliedRef.current = true;
      return;
    }
    // Priority 1: the active team's current holder of this role.
    if (teamEntry?.values) {
      defaultAppliedRef.current = true;
      setTeamEntrySelected(true);
      onApply(teamEntry.values);
      return;
    }
    // Priority 2: the first available personality carrying this role.
    const firstAvailable = personalities.find((entry) => entry.available);
    if (firstAvailable) {
      defaultAppliedRef.current = true;
      selectPersonality(firstAvailable.id);
      return;
    }
    // Priority 3: leave the model to the user.
    defaultAppliedRef.current = true;
  }, [
    autoSelectDefault,
    bindingTouched,
    teamEntrySelected,
    selectedPersonalityId,
    binding,
    config,
    entries,
    teamEntry,
    personalities,
    onApply,
    selectPersonality,
  ]);

  // Grouped entries flattened for selection lookups — a personality picked
  // from the browse groups may not be in the up-front (surface-role) list, and
  // the trigger/binding must still resolve its name and spinner.
  const groupedById = useMemo(() => {
    const byId = new Map<string, SelectorPersonality>();
    for (const section of personalityGroups) {
      for (const group of section.roleGroups) {
        for (const entry of group.personalities) {
          if (!byId.has(entry.id)) {
            byId.set(entry.id, entry);
          }
        }
      }
    }
    return byId;
  }, [personalityGroups]);

  const selectedEntry = useMemo(
    () =>
      displayPersonalities.find((entry) => entry.id === effectiveSelectedId) ??
      (effectiveSelectedId ? (groupedById.get(effectiveSelectedId) ?? null) : null),
    [displayPersonalities, groupedById, effectiveSelectedId],
  );
  const selectedSpinner = useMemo(
    () =>
      selectedEntry?.glowA && selectedEntry.glowB
        ? { glowA: selectedEntry.glowA, glowB: selectedEntry.glowB }
        : undefined,
    [selectedEntry],
  );

  // The team slot's id is display-only, so resolve it to the member the team
  // actually picked before it can reach createAgent.
  const spawnPersonalityId = useMemo(
    () => (teamEntrySelected && teamEntry ? (teamEntry.member?.id ?? null) : effectiveSelectedId),
    [teamEntrySelected, teamEntry, effectiveSelectedId],
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
      const selected =
        personalities.find((entry) => entry.id === effectiveSelectedId) ??
        groupedById.get(effectiveSelectedId);
      if (selected) {
        return selected.name;
      }
    }
    return bindingTouched ? null : binding.originalBinding;
  }, [
    binding,
    teamEntrySelected,
    teamEntry,
    bindingTouched,
    effectiveSelectedId,
    personalities,
    groupedById,
  ]);

  return {
    personalities: displayPersonalities,
    personalityGroups,
    selectedPersonalityId: effectiveSelectedId,
    spawnPersonalityId,
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
