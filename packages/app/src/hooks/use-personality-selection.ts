import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProviderSnapshotEntry } from "@otto-code/protocol/agent-types";
import type { PersonalityRole } from "@otto-code/protocol/messages";
import { personalityHasRole } from "@otto-code/protocol/agent-personalities";
import { getActiveAgentTeam, isTeamMember } from "@otto-code/protocol/agent-teams";
import type { SelectorPersonality } from "@/components/combined-model-selector";
import {
  resolvePersonalityForForm,
  type PersonalityFormValues,
} from "@/provider-selection/personality-form";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useFormPreferences } from "@/hooks/use-form-preferences";
import { mergeLastPersonality } from "@/create-agent-preferences/preferences";

export type { SelectorPersonality };

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
  // Strict active-team scoping: with a team active only its members show
  // (role/availability-filtered as always). The one escape hatch is the
  // caller's already-bound personality (schedule form editing an off-team
  // binding). No active team = the full roster, exactly legacy behavior.
  const agentTeamsSource = config?.agentTeams;
  const activeTeam = useMemo(() => getActiveAgentTeam(agentTeamsSource), [agentTeamsSource]);
  const roster = useMemo(
    () =>
      (rosterSource ?? []).filter((personality) => {
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
    [rosterSource, role, activeTeam, alwaysIncludePersonalityId],
  );

  const resolutions = useMemo(
    () => new Map(roster.map((p) => [p.id, resolvePersonalityForForm(p, entries)] as const)),
    [roster, entries],
  );

  const personalities = useMemo<SelectorPersonality[]>(
    () =>
      roster.map((personality) => {
        const resolution = resolutions.get(personality.id);
        return {
          id: personality.id,
          name: personality.name,
          provider: personality.provider,
          subtitle: `${personality.provider} · ${personality.model}`,
          glowA: personality.spinner?.glowA,
          glowB: personality.spinner?.glowB,
          available: resolution?.available ?? false,
          unavailableReason: resolution && !resolution.available ? resolution.reason : undefined,
        };
      }),
    [roster, resolutions],
  );

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

  // A selection whose personality has since left the roster (deleted remotely,
  // role removed) reads as no selection — the draft must not spawn with a stale
  // id the daemon would soft-skip (spinner shown, prompt silently absent).
  const effectiveSelectedPersonalityId =
    selectedPersonalityId && roster.some((entry) => entry.id === selectedPersonalityId)
      ? selectedPersonalityId
      : null;

  return {
    personalities,
    selectedPersonalityId: effectiveSelectedPersonalityId,
    selectPersonality,
    clearPersonality,
  };
}
