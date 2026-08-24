import { useCallback, useMemo, useRef, useState } from "react";
import type { ProviderSnapshotEntry } from "@otto-code/protocol/agent-types";
import type { AgentProfile } from "@otto-code/protocol/messages";
import { getActiveAgentTeam, isTeamMember } from "@otto-code/protocol/agent-teams";
import { profileHasRole } from "@otto-code/protocol/agent-profiles";
import type { SelectorPersonality } from "@/components/model-selector/selector-content";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import {
  mergeSuppressPersonalitySwitchWarning,
  useFormPreferences,
} from "@/hooks/use-form-preferences";
import { useSessionStore } from "@/stores/session-store";
import { confirmDialogWithCheckbox, type ConfirmDialogInput } from "@/utils/confirm-dialog";
import { resolvePersonalityForForm } from "@/provider-selection/personality-form";
import { showProviderNoticeToast } from "@/utils/provider-notice-toast";
import { toErrorMessage } from "@/utils/error-messages";
import type { useToast } from "@/contexts/toast-context";

/** The agent facts this producer reads. Kept structural so the caller owns the slice. */
export interface RunningPersonalityAgent {
  provider: string;
  model: string | null | undefined;
  runtimeModelId: string | null;
  personalityName: string | null;
  personalityId: string | null;
  personalitySpinner: { glowA: string; glowB: string } | null;
}

export interface RunningChatPersonalityResult {
  personalities: SelectorPersonality[] | undefined;
  selectedPersonalityId: string | null;
  onSelectPersonality: ((id: string) => void) | undefined;
  onClearPersonality: (() => void) | undefined;
  onSelectModelOverPersonality: ((provider: string, modelId: string) => void) | undefined;
  hasBoundPersonality: boolean;
  /** True while an agent.personality.set RPC is in flight (capped at 30s). */
  isSwitching: boolean;
}

// Stable empty fallbacks so the memos below keep a constant deps identity while
// the provider snapshot / daemon config are still loading.
const EMPTY_SNAPSHOT_ENTRIES: readonly ProviderSnapshotEntry[] = [];
const EMPTY_PROFILE_ROSTER: readonly AgentProfile[] = [];

// A Personality switch restarts the provider query, so the controls lock while
// it is in flight. If the daemon does not answer within this window the controls
// re-enable so the user can retry or carry on (the switch may still land late -
// agent_state then updates the identity on its own).
const PERSONALITY_SWITCH_TIMEOUT_MS = 30_000;

const BOUND_PERSONALITY_FALLBACK_ID = "__bound-personality__";

/**
 * Build the selectable Personality roster for a running agent's model picker:
 * the host's Personalities that carry the "chatter" role AND belong to the
 * agent's locked-in provider family, resolved for availability against the live
 * snapshot. The family menu pins these above the raw model list so a running
 * chat agent can switch to a same-family Personality.
 */
function buildRunningChatPersonalities(input: {
  roster: readonly AgentProfile[];
  entries: readonly ProviderSnapshotEntry[];
}): SelectorPersonality[] {
  const { roster, entries } = input;
  return roster.map((personality) => {
    const resolution = resolvePersonalityForForm(personality, entries);
    // Show the human-readable provider/model names from the live snapshot rather
    // than the raw ids, matching usePersonalitySelection / buildTeamRoleEntry so
    // this picker reads the same as the schedule/artifact/draft ones.
    const entry = entries.find((candidate) => candidate.provider === personality.provider);
    const providerLabel = entry?.label ?? personality.provider;
    const modelId = personality.model ?? entry?.models?.find((m) => m.isDefault)?.id;
    const modelLabel = entry?.models?.find((m) => m.id === modelId)?.label ?? modelId ?? "";
    return {
      id: personality.id,
      name: personality.name,
      provider: personality.provider,
      subtitle: modelLabel ? `${providerLabel} · ${modelLabel}` : providerLabel,
      glowA: personality.spinner?.glowA,
      glowB: personality.spinner?.glowB,
      available: resolution.available,
      unavailableReason: resolution.available ? undefined : resolution.reason,
    };
  });
}

/**
 * Copy for the Personality-switch warning dialog. The switch (or clear) applies
 * a new system prompt, which restarts the provider query: the conversation
 * resumes, but the change lands on the next turn. Suppressible per device.
 * i18n: English-only pending the agent-personalities translation pass.
 */
function buildPersonalitySwitchDialog(target: { name: string } | null): ConfirmDialogInput {
  if (target === null) {
    return {
      title: "Clear personality?",
      message:
        "Clearing the personality removes its system prompt from this agent. " +
        "The provider session restarts to apply the change: the conversation " +
        "continues, and the model, effort, and mode stay as they are.",
      confirmLabel: "Clear",
      checkboxLabel: "Don't show this again",
    };
  }
  return {
    title: `Switch to ${target.name}?`,
    message:
      `Switching applies ${target.name}'s model, effort, mode, and system prompt ` +
      "to this running agent. The provider session restarts to pick up the new " +
      "prompt: the conversation continues, and the change takes effect on the " +
      "next turn.",
    confirmLabel: "Switch",
    checkboxLabel: "Don't show this again",
  };
}

/**
 * Copy for picking a raw model while a Personality is bound: one confirm covers
 * both halves (clear the Personality, then apply the chosen model). Shares the
 * same device-local suppression as the switch/clear dialogs.
 * i18n: English-only pending the agent-personalities translation pass.
 */
function buildModelOverPersonalityDialog(input: {
  personalityName: string;
  modelLabel: string;
}): ConfirmDialogInput {
  return {
    title: `Switch to ${input.modelLabel}?`,
    message:
      `Picking a plain model releases ${input.personalityName}: its system prompt ` +
      `is removed and the agent switches to ${input.modelLabel}. The provider ` +
      "session restarts to apply the change; the conversation continues, and it " +
      "takes effect on the next turn.",
    confirmLabel: "Switch",
    checkboxLabel: "Don't show this again",
  };
}

// Read-only shape for daemons without the live switch: the bound identity still
// displays, but no handler exists that could emit the unsupported RPC.
function buildReadOnlyChatPersonalityResult(
  fallbackEntry: SelectorPersonality | null,
): RunningChatPersonalityResult {
  return {
    personalities: fallbackEntry ? [fallbackEntry] : undefined,
    selectedPersonalityId: fallbackEntry?.id ?? null,
    onSelectPersonality: undefined,
    onClearPersonality: undefined,
    onSelectModelOverPersonality: undefined,
    hasBoundPersonality: fallbackEntry != null,
    isSwitching: false,
  };
}

// Pure selection resolution, split out of the hook for the complexity budget.
function resolveRosterSelectedId(input: {
  familyRoster: readonly AgentProfile[];
  boundPersonalityId: string | null | undefined;
  personalityName: string | null | undefined;
}): string | null {
  const { familyRoster, boundPersonalityId, personalityName } = input;
  if (boundPersonalityId) {
    return familyRoster.some((entry) => entry.id === boundPersonalityId)
      ? boundPersonalityId
      : null;
  }
  if (!personalityName) {
    return null;
  }
  return familyRoster.find((entry) => entry.name === personalityName)?.id ?? null;
}

function resolveSnapshotModelLabel(
  entries: readonly ProviderSnapshotEntry[],
  providerId: string,
  modelId: string,
): string {
  const entry = entries.find((candidate) => candidate.provider === providerId);
  return entry?.models?.find((candidate) => candidate.id === modelId)?.label ?? modelId;
}

function buildBoundFallbackPersonality(input: {
  boundPersonalityId: string | null | undefined;
  personalityName: string | null | undefined;
  provider: string | undefined;
  model: string | null;
  spinner: { glowA: string; glowB: string } | null | undefined;
}): SelectorPersonality | null {
  const { boundPersonalityId, personalityName, provider, model, spinner } = input;
  if (!personalityName) {
    return null;
  }
  return {
    id: boundPersonalityId ?? BOUND_PERSONALITY_FALLBACK_ID,
    name: personalityName,
    provider: provider ?? "",
    subtitle: model && provider ? `${provider} · ${model}` : (provider ?? ""),
    glowA: spinner?.glowA,
    glowB: spinner?.glowB,
    available: true,
    unavailableReason: undefined,
  };
}

/**
 * Running chat agent's family-scoped Personality selection for the model picker.
 * Filters the host roster to "chatter"-role Personalities on the agent's
 * locked-in provider, and seeds the selection from the agent's live identity. A
 * pick (after a suppressible warning dialog) goes through one
 * agent.personality.set RPC: the daemon applies prompt + identity +
 * model/mode/effort atomically and restarts the provider query, then the updated
 * agent_state flows the new identity back, so there is no client-side selection
 * state to drift.
 */
export function useRunningChatPersonality(input: {
  agentId: string;
  serverId: string;
  agent: RunningPersonalityAgent | null;
  entries: readonly ProviderSnapshotEntry[] | undefined;
  client: DaemonClient | null;
  toast: ReturnType<typeof useToast>;
}): RunningChatPersonalityResult {
  const { agentId, serverId, agent, client, toast } = input;
  const { config } = useDaemonConfig(serverId);
  // COMPAT(setAgentPersonality): added in v0.5.0 - an older daemon cannot apply
  // a Personality to a running agent, so the switcher's handlers hide there
  // (the bound identity still displays read-only via the fallback entry).
  const canSetPersonality = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.setAgentPersonality === true,
  );
  const { preferences, updatePreferences } = useFormPreferences();
  const provider = agent?.provider;
  const personalityName = agent?.personalityName;
  const boundPersonalityId = agent?.personalityId;
  const entries = input.entries ?? EMPTY_SNAPSHOT_ENTRIES;

  // With a team active, the pinned roster narrows to its members. The agent's
  // CURRENT Personality is deliberately allowed through even when off-team so
  // the trigger never lies and re-selecting it keeps working; other off-team
  // picks require switching or deactivating the team.
  const agentTeamsSource = config?.agentTeams;
  const activeTeam = useMemo(() => getActiveAgentTeam(agentTeamsSource), [agentTeamsSource]);
  const rosterSource = config?.agentProfiles;
  const familyRoster = useMemo(
    () =>
      (rosterSource ?? EMPTY_PROFILE_ROSTER).filter(
        (personality) =>
          profileHasRole(personality, "chatter") &&
          personality.provider === provider &&
          (!activeTeam ||
            isTeamMember(activeTeam, personality.id) ||
            personality.id === (boundPersonalityId ?? null)),
      ),
    [rosterSource, provider, activeTeam, boundPersonalityId],
  );
  const rosterPersonalities = useMemo(
    () => buildRunningChatPersonalities({ roster: familyRoster, entries }),
    [familyRoster, entries],
  );
  // Selection keys on the stable Personality id; the name match is the fallback
  // against daemons that predate personalityId on agent_state.
  const rosterSelectedId = useMemo(
    () => resolveRosterSelectedId({ familyRoster, boundPersonalityId, personalityName }),
    [familyRoster, boundPersonalityId, personalityName],
  );
  // The agent can be bound to a Personality the selectable roster cannot account
  // for - deleted, renamed (old daemons match by name), chatter role removed, or
  // a daemon that predates the live switch. Synthesize a display-only entry from
  // agent_state so the trigger keeps the truthful identity (name + spinner)
  // instead of half-reverting to the raw model.
  const fallbackEntry = useMemo(
    () =>
      rosterSelectedId
        ? null
        : buildBoundFallbackPersonality({
            boundPersonalityId,
            personalityName,
            provider,
            // Configured first, same rule as resolveAgentModelSelection: this
            // subtitle names the agent's selected model, and the runtime one
            // lags a fresh switch by a turn.
            model: agent?.model ?? agent?.runtimeModelId ?? null,
            spinner: agent?.personalitySpinner,
          }),
    [
      rosterSelectedId,
      boundPersonalityId,
      personalityName,
      provider,
      agent?.model,
      agent?.runtimeModelId,
      agent?.personalitySpinner,
    ],
  );
  const selectedPersonalityId = rosterSelectedId ?? fallbackEntry?.id ?? null;

  const suppressWarning = preferences.suppressPersonalitySwitchWarning === true;
  const confirmWithSuppression = useCallback(
    async (dialog: ConfirmDialogInput): Promise<boolean> => {
      if (suppressWarning) {
        return true;
      }
      const result = await confirmDialogWithCheckbox(dialog);
      if (result.confirmed && result.checkboxChecked) {
        void updatePreferences((current) =>
          mergeSuppressPersonalitySwitchWarning({ preferences: current, suppressed: true }),
        ).catch((error) => {
          console.warn("[AgentControls] persist switch-warning suppression failed", error);
        });
      }
      return result.confirmed;
    },
    [suppressWarning, updatePreferences],
  );

  // In-flight lock. The token guards against a stale completion (or the 30s
  // timeout) clobbering the lock of a newer switch started after it.
  const [isSwitching, setIsSwitching] = useState(false);
  const switchTokenRef = useRef(0);
  const runLockedSwitch = useCallback(
    async (operation: () => Promise<void>) => {
      const token = ++switchTokenRef.current;
      setIsSwitching(true);
      const timeout = setTimeout(() => {
        if (switchTokenRef.current !== token) return;
        setIsSwitching(false);
        // i18n: English-only pending the agent-personalities translation pass.
        toast.error(
          "Personality switch timed out - controls re-enabled. It may still apply in the background.",
        );
      }, PERSONALITY_SWITCH_TIMEOUT_MS);
      try {
        await operation();
      } catch (error) {
        console.warn("[AgentControls] personality switch failed", error);
        toast.error(toErrorMessage(error));
      } finally {
        clearTimeout(timeout);
        if (switchTokenRef.current === token) {
          setIsSwitching(false);
        }
      }
    },
    [toast],
  );

  const applyPersonality = useCallback(
    (personalityId: string | null, dialogTarget: { name: string } | null) => {
      if (!client) return;
      void (async () => {
        if (!(await confirmWithSuppression(buildPersonalitySwitchDialog(dialogTarget)))) {
          return;
        }
        await runLockedSwitch(async () => {
          const notice = await client.setAgentPersonality(agentId, personalityId);
          showProviderNoticeToast(toast, notice);
        });
      })();
    },
    [agentId, client, confirmWithSuppression, runLockedSwitch, toast],
  );
  const onSelectPersonality = useCallback(
    (id: string) => {
      const personality = familyRoster.find((entry) => entry.id === id);
      if (!personality) return;
      applyPersonality(id, { name: personality.name });
    },
    [applyPersonality, familyRoster],
  );
  const onClearPersonality = useCallback(() => {
    applyPersonality(null, null);
  }, [applyPersonality]);

  // Picking a raw model with a Personality bound: one confirm, then clear the
  // Personality and apply the model as a single locked flow. Nothing persists -
  // a started agent's picker is no-save.
  const boundPersonalityLabel =
    familyRoster.find((entry) => entry.id === selectedPersonalityId)?.name ?? personalityName;
  const onSelectModelOverPersonality = useCallback(
    (providerId: string, modelId: string) => {
      if (!client) return;
      const modelLabel = resolveSnapshotModelLabel(entries, providerId, modelId);
      void (async () => {
        const dialog = buildModelOverPersonalityDialog({
          personalityName: boundPersonalityLabel ?? "the personality",
          modelLabel,
        });
        if (!(await confirmWithSuppression(dialog))) {
          return;
        }
        await runLockedSwitch(async () => {
          const notice = await client.setAgentPersonality(agentId, null);
          await client.setAgentModel(agentId, modelId);
          showProviderNoticeToast(toast, notice);
        });
      })();
    },
    [
      agentId,
      boundPersonalityLabel,
      client,
      confirmWithSuppression,
      entries,
      runLockedSwitch,
      toast,
    ],
  );

  // COMPAT(setAgentPersonality): old daemon - read-only identity, no handlers,
  // so the model picker cannot emit the unsupported RPC.
  if (!canSetPersonality) {
    return buildReadOnlyChatPersonalityResult(fallbackEntry);
  }
  const personalities = fallbackEntry
    ? [...rosterPersonalities, fallbackEntry]
    : rosterPersonalities;
  return {
    personalities: personalities.length > 0 ? personalities : undefined,
    selectedPersonalityId,
    onSelectPersonality,
    onClearPersonality,
    onSelectModelOverPersonality,
    hasBoundPersonality: selectedPersonalityId != null,
    isSwitching,
  };
}
