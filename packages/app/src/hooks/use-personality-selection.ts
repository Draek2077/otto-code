import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProviderSnapshotEntry } from "@otto-code/protocol/agent-types";
import {
  PERSONALITY_ROLES,
  type AgentPersonality,
  type PersonalityRole,
} from "@otto-code/protocol/messages";
import {
  normalizePersonalityRoles,
  personalityHasRole,
} from "@otto-code/protocol/agent-personalities";
import {
  getActiveAgentTeam,
  isTeamMember,
  resolveTeamMembers,
} from "@otto-code/protocol/agent-teams";
import type {
  SelectorPersonality,
  SelectorPersonalityGroupSection,
  SelectorPersonalityRoleGroup,
} from "@/components/combined-model-selector";
import {
  resolvePersonalityForForm,
  type PersonalityFormValues,
} from "@/provider-selection/personality-form";
import { ROLE_ICONS } from "@/provider-selection/role-icons";
import { ROLE_LABELS } from "@/provider-selection/role-labels";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useFormPreferences } from "@/hooks/use-form-preferences";
import { mergeLastPersonality } from "@/create-agent-preferences/preferences";

export type { SelectorPersonality, SelectorPersonalityGroupSection };

/**
 * A provider that is broken right now — absent from the snapshot, disabled, or
 * in an error/unavailable state (auth failed, binary missing, unreachable).
 * Personalities bound to a broken provider are HIDDEN from pickers entirely
 * (not just grayed) — the provider itself is hidden too, so showing its
 * personalities would dead-end. A provider still loading is NOT broken; its
 * personalities stay visible (grayed "not ready") instead of flashing away.
 */
function isBrokenProviderEntry(entry: ProviderSnapshotEntry | undefined): boolean {
  if (!entry || !entry.enabled) {
    return true;
  }
  return entry.status === "error" || entry.status === "unavailable";
}

/**
 * The picker surface's current provider/model/effort (and, for attended
 * surfaces, mode). Used only to decide whether a remembered personality still
 * matches what the form landed on — memory re-selects a personality without ever
 * re-applying its values, so it must never claim a personality that the form has
 * since drifted away from. Omit `modeId` on unattended surfaces (artifacts,
 * schedules) so mode is excluded from the match.
 */
export interface PersonalityCurrentSelection {
  provider: string | null;
  model: string;
  modeId?: string;
  thinkingOptionId: string;
}

export interface UsePersonalitySelectionInput {
  serverId: string | null;
  /** Which surface this picker is — only personalities tagged with this role show. */
  role: PersonalityRole;
  entries: readonly ProviderSnapshotEntry[];
  /**
   * Apply the resolved form values (provider/model/mode/effort) to the host
   * form. Must be stable (wrap in useCallback). Surfaces without a mode field
   * (e.g. artifacts) simply ignore `modeId`.
   */
  onApply: (values: PersonalityFormValues) => void;
  /**
   * Current form selection, for match-gated memory. When omitted, the picker
   * never auto-re-selects a remembered personality (persistence still works).
   */
  currentSelection?: PersonalityCurrentSelection;
  /**
   * A personality id that stays selectable even when the active team's strict
   * member filter would hide it — the schedule form's already-bound off-team
   * personality (it was valid when authored; the form must not break). Never
   * pass a speculative id here.
   */
  alwaysIncludePersonalityId?: string | null;
}

export interface UsePersonalitySelectionResult {
  personalities: SelectorPersonality[];
  /**
   * The full roster organized for browsing: active team first (roles →
   * members), then the remaining personalities by role — or a single
   * "All personalities" section when no team is active. Every entry here is
   * selectable through selectPersonality, regardless of the surface role.
   */
  personalityGroups: SelectorPersonalityGroupSection[];
  selectedPersonalityId: string | null;
  selectPersonality: (id: string) => void;
  clearPersonality: () => void;
}

function selectionMatches(
  values: PersonalityFormValues,
  current: PersonalityCurrentSelection,
): boolean {
  if (current.provider !== values.provider) {
    return false;
  }
  if (current.model !== values.model) {
    return false;
  }
  if ((current.thinkingOptionId ?? "") !== (values.thinkingOptionId ?? "")) {
    return false;
  }
  // Unattended surfaces omit modeId — mode is not part of their identity.
  if (current.modeId !== undefined && current.modeId !== values.modeId) {
    return false;
  }
  return true;
}

/**
 * Bridges the host's personality roster into a model picker: filters by role,
 * computes availability against the live provider snapshot, and on select
 * resolves + applies the personality's provider/model/mode/effort to the form.
 * The selected id is the personality identity — it survives manual field edits
 * (deviation keeps identity) and only clears on an explicit clear or a switch to
 * another personality.
 *
 * Memory: the last selected personality per role is persisted device-locally.
 * On mount, if that personality is still available and its resolved values match
 * what the form currently shows, it is re-selected (identity only, no re-apply).
 * Any explicit user select/clear disables further auto-preselection for the life
 * of the picker.
 */
export function usePersonalitySelection(
  input: UsePersonalitySelectionInput,
): UsePersonalitySelectionResult {
  const { serverId, role, entries, onApply, currentSelection, alwaysIncludePersonalityId } = input;
  const { config } = useDaemonConfig(serverId);
  const { preferences, isLoading: preferencesLoading, updatePreferences } = useFormPreferences();
  const [selectedPersonalityId, setSelectedPersonalityId] = useState<string | null>(null);
  // Set once the user explicitly picks or clears — freezes auto-preselection so
  // clearing can't immediately re-select the still-matching personality.
  const interactedRef = useRef(false);

  // Depend on the roster slice, not the whole config — unrelated daemon-config
  // changes must not rebuild the roster → resolutions → personalities chain.
  const rosterSource = config?.agentPersonalities?.personalities;
  const fullRoster = useMemo(() => rosterSource ?? [], [rosterSource]);
  // Strict active-team scoping FOR THE UP-FRONT SECTION: with a team active
  // only its members show (role/availability-filtered as always). The one
  // escape hatch is the caller's already-bound personality (schedule form
  // editing an off-team binding). No active team = the full roster, exactly
  // legacy behavior. The grouped browse section below deliberately reaches the
  // whole roster (off-team spawns simply don't carry the team prompt).
  const agentTeamsSource = config?.agentTeams;
  const activeTeam = useMemo(() => getActiveAgentTeam(agentTeamsSource), [agentTeamsSource]);
  const roster = useMemo(
    () =>
      fullRoster.filter((personality) => {
        if (!personalityHasRole(personality, role)) {
          return false;
        }
        if (!activeTeam) {
          return true;
        }
        return (
          isTeamMember(activeTeam, personality.id) ||
          personality.id === (alwaysIncludePersonalityId ?? null)
        );
      }),
    [fullRoster, role, activeTeam, alwaysIncludePersonalityId],
  );

  // Resolutions cover the FULL roster (not just the surface role) — the
  // grouped browse section makes every personality selectable here.
  const resolutions = useMemo(
    () => new Map(fullRoster.map((p) => [p.id, resolvePersonalityForForm(p, entries)] as const)),
    [fullRoster, entries],
  );

  // Providers that are broken right now — their personalities are hidden from
  // the picker (the provider itself is hidden too). Exceptions below keep the
  // CURRENT selection (and a schedule's already-stored binding) rendering with
  // an unavailable marker instead of vanishing out from under the trigger.
  const brokenProviders = useMemo(() => {
    const broken = new Set<string>();
    for (const personality of fullRoster) {
      if (broken.has(personality.provider)) {
        continue;
      }
      const entry = entries.find((candidate) => candidate.provider === personality.provider);
      if (isBrokenProviderEntry(entry)) {
        broken.add(personality.provider);
      }
    }
    return broken;
  }, [fullRoster, entries]);

  const isHiddenPersonality = useCallback(
    (personality: AgentPersonality): boolean =>
      brokenProviders.has(personality.provider) &&
      personality.id !== selectedPersonalityId &&
      personality.id !== (alwaysIncludePersonalityId ?? null),
    [brokenProviders, selectedPersonalityId, alwaysIncludePersonalityId],
  );

  const buildSelectorPersonality = useCallback(
    (personality: AgentPersonality): SelectorPersonality => {
      const resolution = resolutions.get(personality.id);
      // Show the human-readable provider/model names from the live snapshot
      // rather than the raw ids; fall back to the id when the snapshot has no
      // matching entry (provider unavailable, model since removed).
      const entry = entries.find((candidate) => candidate.provider === personality.provider);
      const providerLabel = entry?.label ?? personality.provider;
      const modelLabel =
        entry?.models?.find((candidate) => candidate.id === personality.model)?.label ??
        personality.model;
      return {
        id: personality.id,
        name: personality.name,
        provider: personality.provider,
        subtitle: `${providerLabel} · ${modelLabel}`,
        glowA: personality.spinner?.glowA,
        glowB: personality.spinner?.glowB,
        available: resolution?.available ?? false,
        unavailableReason: resolution && !resolution.available ? resolution.reason : undefined,
      };
    },
    [resolutions, entries],
  );

  const personalities = useMemo<SelectorPersonality[]>(
    () =>
      roster
        .filter((personality) => !isHiddenPersonality(personality))
        .map(buildSelectorPersonality),
    [roster, isHiddenPersonality, buildSelectorPersonality],
  );

  // The grouped browse structure: with a team active, ONE group — the active
  // team's members by role (strict active-team scoping, same as the up-front
  // section); with no team, one "All personalities" group over the full
  // roster. A multi-role personality appears under each role it carries;
  // roleless ones land in a trailing "No role" group so everything on deck
  // stays reachable.
  const personalityGroups = useMemo<SelectorPersonalityGroupSection[]>(() => {
    const visible = fullRoster.filter((personality) => !isHiddenPersonality(personality));
    if (visible.length === 0) {
      return [];
    }
    const buildRoleGroups = (list: readonly AgentPersonality[]): SelectorPersonalityRoleGroup[] => {
      const groups: SelectorPersonalityRoleGroup[] = [];
      for (const groupRole of PERSONALITY_ROLES) {
        const members = list.filter((personality) => personalityHasRole(personality, groupRole));
        if (members.length > 0) {
          groups.push({
            key: groupRole,
            label: ROLE_LABELS[groupRole],
            icon: ROLE_ICONS[groupRole],
            personalities: members.map(buildSelectorPersonality),
          });
        }
      }
      const roleless = list.filter(
        (personality) => normalizePersonalityRoles(personality.roles).length === 0,
      );
      if (roleless.length > 0) {
        groups.push({
          key: "none",
          // i18n: English-only pending the agent-personalities translation pass.
          label: "No role",
          personalities: roleless.map(buildSelectorPersonality),
        });
      }
      return groups;
    };
    if (activeTeam) {
      const teamGroups = buildRoleGroups(resolveTeamMembers(activeTeam, visible));
      return teamGroups.length > 0
        ? [{ key: "team", label: activeTeam.name, roleGroups: teamGroups }]
        : [];
    }
    const roleGroups = buildRoleGroups(visible);
    // i18n: English-only pending the agent-personalities translation pass.
    return roleGroups.length > 0 ? [{ key: "all", label: "All personalities", roleGroups }] : [];
  }, [fullRoster, isHiddenPersonality, activeTeam, buildSelectorPersonality]);

  const persistLastPersonality = useCallback(
    (personalityId: string | null) => {
      void updatePreferences((current) =>
        mergeLastPersonality({ preferences: current, role, personalityId }),
      ).catch((error) => {
        console.warn("[usePersonalitySelection] persist last personality failed", error);
      });
    },
    [role, updatePreferences],
  );

  const selectPersonality = useCallback(
    (id: string) => {
      const resolution = resolutions.get(id);
      if (!resolution || !resolution.available) {
        return;
      }
      interactedRef.current = true;
      onApply(resolution.values);
      setSelectedPersonalityId(id);
      persistLastPersonality(id);
    },
    [resolutions, onApply, persistLastPersonality],
  );

  const clearPersonality = useCallback(() => {
    interactedRef.current = true;
    setSelectedPersonalityId(null);
    persistLastPersonality(null);
  }, [persistLastPersonality]);

  const rememberedId = preferences.lastPersonalityByRole?.[role];
  const curProvider = currentSelection?.provider ?? null;
  const curModel = currentSelection?.model ?? "";
  const curMode = currentSelection?.modeId;
  const curThinking = currentSelection?.thinkingOptionId ?? "";

  useEffect(() => {
    if (interactedRef.current || selectedPersonalityId !== null) {
      return;
    }
    if (preferencesLoading || !rememberedId || !curProvider) {
      return;
    }
    const resolution = resolutions.get(rememberedId);
    if (!resolution || !resolution.available) {
      return;
    }
    if (
      !selectionMatches(resolution.values, {
        provider: curProvider,
        model: curModel,
        modeId: curMode,
        thinkingOptionId: curThinking,
      })
    ) {
      return;
    }
    setSelectedPersonalityId(rememberedId);
  }, [
    curMode,
    curModel,
    curProvider,
    curThinking,
    preferencesLoading,
    rememberedId,
    resolutions,
    selectedPersonalityId,
  ]);

  // A selection whose personality has since left the roster (deleted remotely)
  // reads as no selection — the draft must not spawn with a stale id the
  // daemon would soft-skip (spinner shown, prompt silently absent). Checked
  // against the FULL roster: any personality is selectable via the grouped
  // browse section, so a role change alone must not drop the selection.
  const effectiveSelectedPersonalityId =
    selectedPersonalityId && fullRoster.some((entry) => entry.id === selectedPersonalityId)
      ? selectedPersonalityId
      : null;

  return {
    personalities,
    personalityGroups,
    selectedPersonalityId: effectiveSelectedPersonalityId,
    selectPersonality,
    clearPersonality,
  };
}
