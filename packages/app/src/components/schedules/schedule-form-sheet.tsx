import equal from "fast-deep-equal";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from "react";
import { Text, View } from "react-native";
import { Brain, Folder, GitBranch } from "@/components/icons/material-icons";
import { StyleSheet } from "react-native-unistyles";
import type { AgentProvider } from "@otto-code/protocol/agent-types";
import type { ScheduleSummary } from "@otto-code/protocol/schedule/types";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { ComboboxItem } from "@/components/ui/combobox";
import { Button } from "@/components/ui/button";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import {
  usePersonalitySelection,
  type SelectorPersonality,
} from "@/hooks/use-personality-selection";
import { type PersonalityFormValues } from "@/provider-selection/personality-form";
import { buildTeamRoleEntry } from "@/provider-selection/team-role-entry";
import type { AgentPersonality, AgentTeam } from "@otto-code/protocol/messages";
import type { ProviderSnapshotEntry } from "@otto-code/protocol/agent-types";
import {
  getActiveAgentTeam,
  TEAM_SCHEDULER_PERSONALITY_SENTINEL,
} from "@otto-code/protocol/agent-teams";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useAgentTeamsFeature } from "@/screens/settings/agent-teams-section";
import { useIsCompactFormFactor } from "@/constants/layout";
import { HostStatusDotSlot } from "@/components/hosts/host-picker";
import { createControlGeometry, type FieldControlSize } from "@/components/ui/control-geometry";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { NumberStepperField } from "@/components/ui/number-stepper-field";
import { Switch } from "@/components/ui/switch";
import { getProviderIcon } from "@/components/provider-icons";
import { PersonalityProviderIcon } from "@/components/personality-provider-icon";
import { CadenceEditor } from "@/components/schedules/cadence-editor";
import {
  SelectField,
  SelectFieldTrigger,
  type SelectFieldDisplay,
  type SelectFieldOption,
  type SelectFieldRenderOptionInput,
} from "@/components/ui/select-field";
import { formatThinkingOptionLabel } from "@/composer/agent-controls/utils";
import {
  mergeProviderPreferences,
  useFormPreferences,
  type FormPreferences,
} from "@/hooks/use-form-preferences";
import { useScheduleMutations } from "@/hooks/use-schedule-mutations";
import { useAggregatedAgents } from "@/hooks/use-aggregated-agents";
import { useProjects } from "@/hooks/use-projects";
import { useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { buildScheduleProjectTargets } from "@/schedules/schedule-project-targets";
import { useScheduleFormModel } from "@/schedules/use-schedule-form-model";
import { useScheduleFormProviderSnapshot } from "@/schedules/use-schedule-form-provider-snapshot";
import type {
  ScheduleFormDisplay,
  ScheduleFormHost,
  ScheduleFormModel,
  ScheduleFormSnapshot,
  ScheduleFormState,
} from "@/schedules/schedule-form-model";
import { validateCron } from "@/utils/schedule-format";
import { toErrorMessage } from "@/utils/error-messages";
import { getDeviceTimeZone } from "@/utils/device-timezone";

export interface ScheduleFormSheetProps {
  serverId?: string;
  visible: boolean;
  onClose: () => void;
  mode: "create" | "edit";
  schedule?: ScheduleSummary;
}

// A schedule that would run more than this many times may as well be unlimited,
// so the picker caps here and 0 (empty) means "run forever".
const MAX_SCHEDULE_RUNS = 9999;

function parseMaxRuns(raw: string): number | null {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.min(parsed, MAX_SCHEDULE_RUNS);
}

function formatMaxRunsHint(raw: string): string {
  const parsed = parseMaxRuns(raw);
  if (parsed == null) {
    return "Runs forever";
  }
  return `Stops after ${parsed} ${parsed === 1 ? "run" : "runs"}`;
}

// The synthetic "Team's Scheduler" picker entry — a dynamic binding that
// resolves to the active team's Scheduler at RUN time, not a concrete
// personality. Its id never leaves the form; the submitted binding is the
// protocol sentinel.
const TEAM_SCHEDULER_ENTRY_ID = "__team-scheduler__";

// Resolve who the active team's Scheduler is RIGHT NOW for the picker entry's
// display + form auto-fill. The daemon re-resolves at every run, so this is a
// preview, not a binding — the entry's subtitle says so. Shared builder in
// team-role-entry.ts (mirrored by the artifact sheet's "Team's Artificer").
function buildTeamSchedulerEntry(input: {
  team: AgentTeam;
  roster: readonly AgentPersonality[];
  entries: readonly ProviderSnapshotEntry[];
}): { selector: SelectorPersonality; values: PersonalityFormValues | null } {
  const entry = buildTeamRoleEntry({
    entryId: TEAM_SCHEDULER_ENTRY_ID,
    role: "scheduler",
    label: "Team's Scheduler",
    roleLabel: "Scheduler",
    team: input.team,
    roster: input.roster,
    entries: input.entries,
  });
  return { selector: entry.selector, values: entry.values };
}

function resolveCreateServerId(input: {
  mode: "create" | "edit";
  serverId: string | null | undefined;
  hosts: readonly ScheduleFormHost[];
}): string | null {
  if (input.mode === "edit") {
    return input.serverId ?? null;
  }
  if (input.serverId !== undefined) {
    return input.serverId;
  }
  if (input.hosts.length === 1) {
    return input.hosts[0]?.serverId ?? null;
  }
  return null;
}

function buildScheduleHostOptionTestId(serverId: string): string {
  return `schedule-host-option-${serverId}`;
}

function buildThinkingOptionTestId(optionId: string): string {
  return `schedule-thinking-option-${optionId}`;
}

function openKey(props: ScheduleFormSheetProps): string {
  if (props.mode === "edit") {
    return `edit:${props.serverId ?? ""}:${props.schedule?.id ?? ""}`;
  }
  return `create:${props.serverId ?? ""}`;
}

function selectScheduleHosts(
  hosts: readonly { serverId: string; label: string }[],
): (state: ReturnType<typeof useSessionStore.getState>) => ScheduleFormHost[] {
  return (state) =>
    hosts.map((host) => ({
      serverId: host.serverId,
      label: host.label,
      supportsWorkspaceMultiplicity:
        state.sessions[host.serverId]?.serverInfo?.features?.workspaceMultiplicity === true,
    }));
}

function buildSnapshot(input: {
  mode: "create" | "edit";
  serverId: string | undefined;
  schedule: ScheduleSummary | undefined;
  hosts: readonly ScheduleFormHost[];
  projectTargets: ReturnType<typeof buildScheduleProjectTargets>;
  preferences: FormPreferences;
  timezone: string;
}): ScheduleFormSnapshot {
  const schedule = input.schedule
    ? { ...input.schedule, serverId: input.serverId, serverName: undefined }
    : undefined;
  return {
    mode: input.mode,
    schedule,
    hosts: input.hosts,
    defaults: {
      serverId: resolveCreateServerId({
        mode: input.mode,
        serverId: input.serverId,
        hosts: input.hosts,
      }),
      projectTargets: input.projectTargets,
      preferences: input.preferences,
      timezone: input.timezone,
    },
  };
}

function updateSelectionPreferences(input: {
  preferences: FormPreferences;
  provider: AgentProvider;
  model: string;
  mode: string;
  thinkingOptionId: string;
  isolation: "local" | "worktree";
}): FormPreferences {
  const model = input.model.trim();
  const mode = input.mode.trim();
  const thinkingOptionId = input.thinkingOptionId.trim();
  return {
    ...mergeProviderPreferences({
      preferences: input.preferences,
      provider: input.provider,
      updates: {
        model: model || undefined,
        mode: mode || undefined,
        ...(model && thinkingOptionId ? { thinkingByModel: { [model]: thinkingOptionId } } : {}),
      },
    }),
    isolation: input.isolation,
  };
}

export function ScheduleFormSheet(props: ScheduleFormSheetProps): ReactElement | null {
  const [renderedProps, setRenderedProps] = useState<ScheduleFormSheetProps | null>(() =>
    props.visible ? props : null,
  );
  const [sheetVisible, setSheetVisible] = useState(props.visible);
  const livePropsRef = useRef(props);
  const closeRequestedRef = useRef(false);
  livePropsRef.current = props;

  useEffect(() => {
    if (props.visible) {
      if (closeRequestedRef.current) {
        return;
      }
      setRenderedProps(props);
      setSheetVisible(true);
      return;
    }
    if (renderedProps) {
      setSheetVisible(false);
    }
  }, [props, renderedProps]);

  const requestClose = useCallback(() => {
    closeRequestedRef.current = true;
    setSheetVisible(false);
  }, []);

  const handleDismiss = useCallback(() => {
    const dismissedProps = livePropsRef.current;
    closeRequestedRef.current = false;
    setRenderedProps(null);
    setSheetVisible(false);
    if (dismissedProps.visible) {
      dismissedProps.onClose();
    }
  }, []);

  if (!renderedProps) {
    return null;
  }

  return (
    <OpenScheduleFormSheet
      key={openKey(renderedProps)}
      {...renderedProps}
      visible={sheetVisible}
      onClose={requestClose}
      onDismiss={handleDismiss}
    />
  );
}

function OpenScheduleFormSheet({
  serverId,
  visible,
  onClose,
  onDismiss,
  mode,
  schedule,
}: ScheduleFormSheetProps & { onDismiss: () => void }): ReactElement {
  const controlSize: FieldControlSize = useIsCompactFormFactor() ? "md" : "sm";
  const { projects } = useProjects();
  const hostProfiles = useHosts();
  const hosts = useStoreWithEqualityFn(
    useSessionStore,
    useMemo(() => selectScheduleHosts(hostProfiles), [hostProfiles]),
    equal,
  );
  const { preferences, updatePreferences } = useFormPreferences();
  const projectTargets = useMemo(() => buildScheduleProjectTargets(projects), [projects]);
  const timezone = useMemo(getDeviceTimeZone, []);
  const snapshot = useMemo(
    () =>
      buildSnapshot({
        mode,
        serverId,
        schedule,
        hosts,
        projectTargets,
        preferences,
        timezone,
      }),
    [hosts, mode, preferences, projectTargets, schedule, serverId, timezone],
  );
  const model = useScheduleFormModel(snapshot);
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  const providerSnapshot = useScheduleFormProviderSnapshot(model, state);
  const { agents } = useAggregatedAgents({ includeArchived: true });
  const mutationServerId = state.selectedServerId ?? serverId ?? "";
  const { createSchedule, updateSchedule, isCreating, isUpdating } = useScheduleMutations({
    serverId: mutationServerId,
  });

  const {
    personalities: displayPersonalities,
    selectedPersonalityId: effectiveSelectedPersonalityId,
    onSelectPersonality: handleSelectPersonality,
    onClearPersonality: handleClearPersonality,
    resolveSubmitPersonality,
  } = useSchedulePersonalityBinding({
    mutationServerId,
    schedule,
    state,
    model,
    providerSnapshot,
  });

  const isSubmitting = isCreating || isUpdating;
  const cadenceError =
    state.cadence.type === "cron" ? validateCron(state.cadence.expression) : null;
  const canSubmit = state.canSubmit && cadenceError === null && !isSubmitting;
  const agentTargetLabel = useMemo(() => {
    if (!schedule || schedule.target.type !== "agent") {
      return null;
    }
    const { agentId } = schedule.target;
    const agent = agents.find(
      (entry) => entry.serverId === (state.selectedServerId ?? serverId) && entry.id === agentId,
    );
    if (!agent) {
      return "Agent unavailable";
    }
    return agent.title?.trim() || "Untitled agent";
  }, [agents, schedule, serverId, state.selectedServerId]);

  const persistPreferences = useCallback(async () => {
    const provider = state.selectedProvider;
    if (!provider) {
      return;
    }
    await updatePreferences((current) =>
      updateSelectionPreferences({
        preferences: current,
        provider,
        model: state.selectedModel,
        mode: state.selectedMode,
        thinkingOptionId: state.selectedThinkingOptionId,
        isolation: state.isolation,
      }),
    );
  }, [
    state.isolation,
    state.selectedMode,
    state.selectedModel,
    state.selectedProvider,
    state.selectedThinkingOptionId,
    updatePreferences,
  ]);

  const submitAgentTarget = useCallback(async (): Promise<boolean> => {
    if (!schedule) {
      return false;
    }
    await updateSchedule({
      id: schedule.id,
      name: state.name.trim() || null,
      prompt: state.prompt.trim(),
      cadence: state.submitCadence,
      maxRuns: parseMaxRuns(state.maxRuns),
    });
    return true;
  }, [schedule, state.maxRuns, state.name, state.prompt, state.submitCadence, updateSchedule]);

  const submitNewAgent = useCallback(async (): Promise<boolean> => {
    const provider = state.selectedProvider;
    const cwd = state.workingDir.trim();
    if (!provider || !cwd) {
      return false;
    }

    await persistPreferences();
    const maxRuns = parseMaxRuns(state.maxRuns);
    const personalityBinding = resolveSubmitPersonality();
    if (mode === "edit" && schedule) {
      await updateSchedule({
        id: schedule.id,
        name: state.name.trim() || null,
        prompt: state.prompt.trim(),
        cadence: state.submitCadence,
        newAgentConfig: {
          provider,
          model: state.selectedModel || null,
          // Always null: schedule runs are unattended and there is no mode
          // field anymore. Explicit null (not omission) so editing a schedule
          // clears any mode stored by an older client — a stored attended
          // mode would fail the run at its first approval prompt.
          modeId: null,
          thinkingOptionId: state.selectedThinkingOptionId || null,
          // Explicit null clears a binding the user removed in the picker.
          personality: personalityBinding,
          cwd,
          ...(state.submitArchiveOnFinish !== undefined
            ? { archiveOnFinish: state.submitArchiveOnFinish }
            : {}),
          ...(state.submitIsolation !== undefined ? { isolation: state.submitIsolation } : {}),
        },
        maxRuns,
      });
      return true;
    }

    await createSchedule({
      prompt: state.prompt.trim(),
      name: state.name.trim() || undefined,
      cadence: state.submitCadence,
      target: {
        type: "new-agent",
        config: {
          provider,
          cwd,
          model: state.selectedModel || undefined,
          thinkingOptionId: state.selectedThinkingOptionId || undefined,
          ...(personalityBinding ? { personality: personalityBinding } : {}),
          ...(state.submitArchiveOnFinish !== undefined
            ? { archiveOnFinish: state.submitArchiveOnFinish }
            : {}),
          ...(state.submitIsolation !== undefined ? { isolation: state.submitIsolation } : {}),
          title: state.name.trim() || undefined,
        },
      },
      ...(maxRuns != null ? { maxRuns } : {}),
    });
    return true;
  }, [
    createSchedule,
    mode,
    persistPreferences,
    resolveSubmitPersonality,
    schedule,
    state,
    updateSchedule,
  ]);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) {
      return;
    }
    model.setSubmitError(null);
    try {
      const submitted =
        state.targetKind === "agent" ? await submitAgentTarget() : await submitNewAgent();
      if (submitted) {
        onClose();
      }
    } catch (error) {
      model.setSubmitError(toErrorMessage(error));
    }
  }, [canSubmit, model, onClose, state.targetKind, submitAgentTarget, submitNewAgent]);

  const handleSubmitPress = useCallback(() => {
    void handleSubmit();
  }, [handleSubmit]);

  const header = useMemo<SheetHeader>(
    () => ({ title: mode === "edit" ? "Edit schedule" : "New schedule" }),
    [mode],
  );

  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button
          style={styles.footerButton}
          variant="secondary"
          onPress={onClose}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button
          style={styles.footerButton}
          variant="default"
          onPress={handleSubmitPress}
          disabled={!canSubmit}
          loading={isSubmitting}
          testID="schedule-form-submit"
        >
          {mode === "edit" ? "Save changes" : "Create schedule"}
        </Button>
      </View>
    ),
    [canSubmit, handleSubmitPress, isSubmitting, mode, onClose],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      onDismiss={onDismiss}
      footer={footer}
      webScrollbar
      testID="schedule-form-sheet"
    >
      <ScheduleFormFields
        model={model}
        state={state}
        providerSnapshot={providerSnapshot}
        agentTargetLabel={agentTargetLabel}
        controlSize={controlSize}
        cadenceError={cadenceError}
        mutationServerId={mutationServerId}
        personalities={displayPersonalities}
        selectedPersonalityId={effectiveSelectedPersonalityId}
        onSelectPersonality={handleSelectPersonality}
        onClearPersonality={handleClearPersonality}
      />
    </AdaptiveModalSheet>
  );
}

interface SchedulePersonalityBinding {
  personalities: SelectorPersonality[];
  selectedPersonalityId: string | null;
  onSelectPersonality: (id: string) => void;
  onClearPersonality: () => void;
  /** The name (or sentinel) to submit as the schedule's personality binding. */
  resolveSubmitPersonality: () => string | null;
}

// The schedule form's personality binding: selecting a personality here BINDS
// it onto the schedule — the daemon re-resolves the binding at every run (and
// hard-fails loudly when it's out of commission). The synthetic "Team's
// Scheduler" entry stores the protocol sentinel instead of a name and follows
// whoever holds the Scheduler role in the active team at run time.
function useSchedulePersonalityBinding(input: {
  mutationServerId: string;
  schedule: ScheduleSummary | undefined;
  state: ScheduleFormState;
  model: ScheduleFormModel;
  providerSnapshot: ReturnType<typeof useScheduleFormProviderSnapshot>;
}): SchedulePersonalityBinding {
  const { mutationServerId, schedule, state, model, providerSnapshot } = input;
  const { config: daemonConfig } = useDaemonConfig(mutationServerId || null);
  const hasTeamsFeature = useAgentTeamsFeature(mutationServerId);
  const scheduleConfig = schedule?.target.type === "new-agent" ? schedule.target.config : null;
  const originalBinding = scheduleConfig?.personality?.trim() || null;

  // Schedule runs are unattended, so a personality's mode is ignored; only its
  // provider/model/effort auto-fill here.
  const applyPersonality = useCallback(
    (values: PersonalityFormValues) => {
      model.setModel(values.provider as AgentProvider, values.model);
      model.setThinking(values.thinkingOptionId);
    },
    [model],
  );
  const personalityCurrentSelection = useMemo(
    () => ({
      provider: state.selectedProvider,
      model: state.selectedModel,
      thinkingOptionId: state.selectedThinkingOptionId,
    }),
    [state.selectedProvider, state.selectedModel, state.selectedThinkingOptionId],
  );

  const rosterSource = daemonConfig?.agentPersonalities?.personalities;
  // The already-bound personality stays selectable even when the active team's
  // strict filter would hide it — the form must not break an existing binding.
  const boundRosterId = useMemo(() => {
    if (!originalBinding || originalBinding === TEAM_SCHEDULER_PERSONALITY_SENTINEL) {
      return null;
    }
    const roster = rosterSource ?? [];
    const match =
      roster.find((entry) => entry.name === originalBinding) ??
      roster.find((entry) => entry.name.toLowerCase() === originalBinding.toLowerCase());
    return match?.id ?? null;
  }, [originalBinding, rosterSource]);

  const { personalities, selectedPersonalityId, selectPersonality, clearPersonality } =
    usePersonalitySelection({
      serverId: mutationServerId || null,
      role: "scheduler",
      entries: providerSnapshot.entries ?? [],
      onApply: applyPersonality,
      currentSelection: personalityCurrentSelection,
      alwaysIncludePersonalityId: boundRosterId,
    });

  const activeTeam = useMemo(
    () => getActiveAgentTeam(daemonConfig?.agentTeams),
    [daemonConfig?.agentTeams],
  );
  const teamSchedulerEntry = useMemo(
    () =>
      hasTeamsFeature && activeTeam && state.targetKind === "new-agent"
        ? buildTeamSchedulerEntry({
            team: activeTeam,
            roster: rosterSource ?? [],
            entries: providerSnapshot.entries ?? [],
          })
        : null,
    [hasTeamsFeature, activeTeam, state.targetKind, rosterSource, providerSnapshot.entries],
  );

  const [teamSchedulerSelected, setTeamSchedulerSelected] = useState(
    originalBinding === TEAM_SCHEDULER_PERSONALITY_SENTINEL,
  );
  // True after any explicit personality select/clear — gates whether an edit
  // rewrites or preserves the stored binding (a roster that hasn't loaded yet
  // must not silently strip it).
  const [bindingTouched, setBindingTouched] = useState(false);

  const displayPersonalities = useMemo<SelectorPersonality[]>(
    () => (teamSchedulerEntry ? [teamSchedulerEntry.selector, ...personalities] : personalities),
    [teamSchedulerEntry, personalities],
  );
  let effectiveSelectedPersonalityId: string | null;
  if (teamSchedulerSelected) {
    effectiveSelectedPersonalityId = teamSchedulerEntry ? TEAM_SCHEDULER_ENTRY_ID : null;
  } else {
    effectiveSelectedPersonalityId =
      selectedPersonalityId ?? (!bindingTouched ? boundRosterId : null);
  }

  const handleSelectPersonality = useCallback(
    (id: string) => {
      setBindingTouched(true);
      if (id === TEAM_SCHEDULER_ENTRY_ID) {
        if (!teamSchedulerEntry?.values) {
          return;
        }
        setTeamSchedulerSelected(true);
        applyPersonality(teamSchedulerEntry.values);
        return;
      }
      setTeamSchedulerSelected(false);
      selectPersonality(id);
    },
    [teamSchedulerEntry, applyPersonality, selectPersonality],
  );
  const handleClearPersonality = useCallback(() => {
    setBindingTouched(true);
    setTeamSchedulerSelected(false);
    clearPersonality();
  }, [clearPersonality]);

  // The name (or sentinel) submitted as the schedule's personality binding —
  // exactly what the trigger shows, so display and persistence can't diverge.
  const resolveSubmitPersonality = useCallback((): string | null => {
    if (teamSchedulerSelected) {
      if (teamSchedulerEntry) {
        return TEAM_SCHEDULER_PERSONALITY_SENTINEL;
      }
      // Teams aren't visible right now (no active team / old daemon): an
      // untouched edit must not silently clear the stored sentinel.
      return bindingTouched ? null : originalBinding;
    }
    if (effectiveSelectedPersonalityId) {
      const selected = personalities.find((entry) => entry.id === effectiveSelectedPersonalityId);
      if (selected) {
        return selected.name;
      }
    }
    return bindingTouched ? null : originalBinding;
  }, [
    teamSchedulerSelected,
    teamSchedulerEntry,
    bindingTouched,
    originalBinding,
    effectiveSelectedPersonalityId,
    personalities,
  ]);

  return {
    personalities: displayPersonalities,
    selectedPersonalityId: effectiveSelectedPersonalityId,
    onSelectPersonality: handleSelectPersonality,
    onClearPersonality: handleClearPersonality,
    resolveSubmitPersonality,
  };
}

interface ScheduleFormFieldsProps {
  model: ScheduleFormModel;
  state: ScheduleFormState;
  providerSnapshot: ReturnType<typeof useScheduleFormProviderSnapshot>;
  agentTargetLabel: string | null;
  controlSize: FieldControlSize;
  cadenceError: string | null;
  mutationServerId: string;
  personalities: SelectorPersonality[];
  selectedPersonalityId: string | null;
  onSelectPersonality: (id: string) => void;
  onClearPersonality: () => void;
}

function ScheduleFormFields({
  model,
  state,
  providerSnapshot,
  agentTargetLabel,
  controlSize,
  cadenceError,
  mutationServerId,
  personalities,
  selectedPersonalityId,
  onSelectPersonality,
  onClearPersonality,
}: ScheduleFormFieldsProps): ReactElement {
  const maxRunsHint = formatMaxRunsHint(state.maxRuns);
  return (
    <>
      <Field label="Name">
        <FormTextInput
          size={controlSize}
          testID="schedule-name-input"
          accessibilityLabel="Schedule name"
          initialValue={state.name}
          value={state.name}
          onChangeText={model.setName}
          placeholder="Optional"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </Field>

      <Field label="Prompt">
        <FormTextInput
          size={controlSize}
          testID="schedule-prompt-input"
          accessibilityLabel="Prompt"
          initialValue={state.prompt}
          value={state.prompt}
          onChangeText={model.setPrompt}
          placeholder="What should the agent do each run?"
          style={styles.multilineInput}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />
      </Field>

      <ScheduleTargetFields
        model={model}
        state={state}
        providerSnapshot={providerSnapshot}
        agentTargetLabel={agentTargetLabel}
        controlSize={controlSize}
        mutationServerId={mutationServerId}
        personalities={personalities}
        selectedPersonalityId={selectedPersonalityId}
        onSelectPersonality={onSelectPersonality}
        onClearPersonality={onClearPersonality}
      />

      <CadenceEditor
        value={state.cadence}
        onChange={model.setCadence}
        error={cadenceError ?? undefined}
        size={controlSize}
      />

      <Field label="Max runs" hint={maxRunsHint}>
        <NumberStepperField
          size={controlSize}
          testID="schedule-max-runs"
          accessibilityLabel="Max runs"
          value={state.maxRuns}
          onChangeText={model.setMaxRuns}
          min={0}
          max={MAX_SCHEDULE_RUNS}
          unlimitedAtMin
          placeholder="Unlimited"
          decrementLabel="Fewer runs"
          incrementLabel="More runs"
        />
      </Field>

      {state.submitError ? <Text style={styles.submitError}>{state.submitError}</Text> : null}
    </>
  );
}

interface ScheduleTargetFieldsProps {
  model: ScheduleFormModel;
  state: ScheduleFormState;
  providerSnapshot: ReturnType<typeof useScheduleFormProviderSnapshot>;
  agentTargetLabel: string | null;
  controlSize: FieldControlSize;
  mutationServerId: string;
  // Personality binding selection, owned by the parent (which submits it).
  personalities: SelectorPersonality[];
  selectedPersonalityId: string | null;
  onSelectPersonality: (id: string) => void;
  onClearPersonality: () => void;
}

function ScheduleTargetFields({
  model,
  state,
  providerSnapshot,
  agentTargetLabel,
  controlSize,
  mutationServerId,
  personalities,
  selectedPersonalityId,
  onSelectPersonality,
  onClearPersonality,
}: ScheduleTargetFieldsProps): ReactElement {
  const hostOptions = useMemo<SelectFieldOption<string>[]>(
    () =>
      state.hosts.map((host) => ({
        id: host.serverId,
        value: host.serverId,
        label: host.label,
        testID: buildScheduleHostOptionTestId(host.serverId),
      })),
    [state.hosts],
  );
  const selectedHost = state.hosts.find((host) => host.serverId === state.selectedServerId) ?? null;
  const selectedHostDisplay = useMemo<SelectFieldDisplay | null>(() => {
    if (selectedHost) {
      return { label: selectedHost.label };
    }
    if (state.selectedServerId) {
      return { label: state.selectedServerId };
    }
    return null;
  }, [selectedHost, state.selectedServerId]);
  const projectOptions = state.projectOptions;
  const thinkingOptions = useMemo<SelectFieldOption<string>[]>(
    () =>
      state.availableThinkingOptions.map((option) => ({
        id: option.id,
        value: option.id,
        label: formatThinkingOptionLabel(option),
        testID: buildThinkingOptionTestId(option.id),
      })),
    [state.availableThinkingOptions],
  );
  const handleSelectHost = useCallback(
    (nextServerId: string) => {
      model.setHost(nextServerId);
    },
    [model],
  );
  const handleSelectProject = useCallback(
    (optionId: string, display: ScheduleFormDisplay) => {
      model.setProject(optionId, display);
    },
    [model],
  );
  const handleSelectModel = useCallback(
    (provider: AgentProvider, modelId: string) => {
      model.setModel(provider, modelId);
    },
    [model],
  );
  const handleSelectThinking = useCallback(
    (thinkingOptionId: string) => {
      model.setThinking(thinkingOptionId);
    },
    [model],
  );
  const selectedPersonality = useMemo(
    () => personalities.find((entry) => entry.id === selectedPersonalityId) ?? null,
    [personalities, selectedPersonalityId],
  );
  const selectedPersonalityName = selectedPersonality?.name ?? null;
  const handleModelOpen = useCallback(() => {
    providerSnapshot.refetchIfStale(state.selectedProvider);
  }, [providerSnapshot, state.selectedProvider]);
  const handleRetryProvider = useCallback(
    (provider: AgentProvider) => {
      void providerSnapshot.refresh([provider]);
    },
    [providerSnapshot],
  );
  const renderHostOption = useCallback(
    (input: SelectFieldRenderOptionInput<string>) => <HostOptionItem {...input} />,
    [],
  );
  const renderProjectOption = useCallback(
    (input: SelectFieldRenderOptionInput<string>) => <ProjectOptionItem {...input} />,
    [],
  );
  const renderThinkingOption = useCallback(
    (input: SelectFieldRenderOptionInput<string>) => <ThinkingOptionItem {...input} />,
    [],
  );
  const modelTriggerLeading = useMemo(() => {
    // A role-slot entry (Team's <Role>) wears its neutral role glyph rather than
    // the current holder's colored provider icon — picking it means "the role",
    // not that specific personality.
    if (selectedPersonality?.roleIcon) {
      const RoleIcon = selectedPersonality.roleIcon;
      return <RoleIcon size={16} color={styles.providerIcon.color} />;
    }
    if (selectedPersonality) {
      return (
        <PersonalityProviderIcon
          provider={selectedPersonality.provider}
          size={16}
          glowA={selectedPersonality.glowA}
          glowB={selectedPersonality.glowB}
        />
      );
    }
    return <ProviderGlyph provider={state.selectedProvider} />;
  }, [selectedPersonality, state.selectedProvider]);
  const renderModelTrigger = useCallback(
    ({
      selectedModelLabel,
      disabled,
      isOpen,
      hovered,
      pressed,
    }: {
      selectedModelLabel: string;
      onPress: () => void;
      disabled: boolean;
      isOpen: boolean;
      hovered: boolean;
      pressed: boolean;
    }): ReactNode => {
      const displayLabel =
        selectedPersonalityName ?? state.selectedModelDisplay?.label ?? selectedModelLabel;
      return (
        <SelectFieldTrigger
          label={displayLabel}
          isPlaceholder={!state.selectedModel && !selectedPersonalityName}
          placeholder={displayLabel}
          leading={modelTriggerLeading}
          disabled={disabled}
          active={hovered || pressed || isOpen}
          size={controlSize}
          testID="schedule-model-trigger"
        />
      );
    },
    [
      controlSize,
      modelTriggerLeading,
      selectedPersonalityName,
      state.selectedModel,
      state.selectedModelDisplay,
    ],
  );

  if (state.targetKind === "agent") {
    return <ScheduleAgentTargetField label={agentTargetLabel} size={controlSize} />;
  }

  return (
    <>
      {state.mode === "edit" || state.hosts.length > 1 ? (
        <SelectField
          label="Host"
          value={state.selectedServerId}
          selectedDisplay={selectedHostDisplay}
          options={hostOptions}
          onChange={handleSelectHost}
          placeholder="Select host"
          emptyText="No hosts found"
          disabled={state.mode === "edit"}
          searchable={false}
          title="Host"
          size={controlSize}
          triggerTestID="schedule-host-trigger"
          renderOption={renderHostOption}
        />
      ) : null}

      {state.disclosure.showProjectField ? (
        <SelectField
          label="Project"
          value={state.selectedProjectOptionId || null}
          selectedDisplay={state.projectDisplay}
          options={projectOptions}
          onChange={handleSelectProject}
          placeholder="Select project"
          emptyText="No projects found"
          disabled={!state.selectedServerId}
          hint={!state.selectedServerId ? "Choose a host first." : undefined}
          searchable
          searchPlaceholder="Search projects..."
          title="Select project"
          size={controlSize}
          triggerTestID="schedule-project-trigger"
          renderOption={renderProjectOption}
        />
      ) : null}

      {state.disclosure.showModelField ? (
        <Field label="Model">
          <CombinedModelSelector
            providers={state.modelSelectorProviders}
            selectedProvider={state.selectedProvider ?? ""}
            selectedModel={state.selectedModel}
            onSelect={handleSelectModel}
            isLoading={providerSnapshot.isLoading || providerSnapshot.isFetching}
            renderTrigger={renderModelTrigger}
            triggerFill
            serverId={mutationServerId}
            disabled={!state.selectedServerId}
            onOpen={handleModelOpen}
            onRetryProvider={handleRetryProvider}
            isRetryingProvider={providerSnapshot.isRefreshing}
            personalities={personalities}
            selectedPersonalityId={selectedPersonalityId}
            onSelectPersonality={onSelectPersonality}
            onClearPersonality={onClearPersonality}
          />
        </Field>
      ) : null}

      {/* A personality already fixes its own effort, so hide the picker while
          one is selected — the whole point is not having to choose it. */}
      {!selectedPersonalityId && state.disclosure.showThinkingField ? (
        <SelectField
          label="Effort"
          value={state.selectedThinkingOptionId || null}
          selectedDisplay={state.selectedThinkingDisplay}
          options={thinkingOptions}
          onChange={handleSelectThinking}
          placeholder="Select effort"
          emptyText="No effort options found"
          searchable={thinkingOptions.length > 6}
          title="Select effort"
          size={controlSize}
          triggerTestID="schedule-thinking-trigger"
          renderOption={renderThinkingOption}
        />
      ) : null}

      {state.disclosure.showIsolationField ? (
        <ScheduleIsolationField model={model} state={state} size={controlSize} />
      ) : null}

      {state.disclosure.showArchiveOnFinishField ? (
        <Field label="Archive on finish">
          <Switch
            value={state.archiveOnFinish}
            onValueChange={model.setArchiveOnFinish}
            accessibilityLabel="Archive on finish"
            testID="schedule-archive-on-finish-switch"
          />
        </Field>
      ) : null}
    </>
  );
}

function ScheduleIsolationField({
  model,
  state,
  size,
}: {
  model: ScheduleFormModel;
  state: ScheduleFormState;
  size: FieldControlSize;
}): ReactElement {
  const options = useMemo<SelectFieldOption<"local" | "worktree">[]>(
    () => [
      {
        id: "local",
        value: "local",
        label: "Local",
        testID: "schedule-isolation-local",
      },
      {
        id: "worktree",
        value: "worktree",
        label: "Worktree",
        testID: "schedule-isolation-worktree",
      },
    ],
    [],
  );
  const selectedDisplay = useMemo<SelectFieldDisplay>(
    () => ({ label: state.effectiveIsolation === "worktree" ? "Worktree" : "Local" }),
    [state.effectiveIsolation],
  );
  const triggerLeading = useMemo(
    () => (
      <View style={styles.optionIconBox}>
        {state.effectiveIsolation === "worktree" ? (
          <GitBranch size={16} color={styles.providerIcon.color} />
        ) : (
          <Folder size={16} color={styles.providerIcon.color} />
        )}
      </View>
    ),
    [state.effectiveIsolation],
  );
  const handleSelectIsolation = useCallback(
    (value: "local" | "worktree") => {
      model.setIsolation(value);
    },
    [model],
  );
  const renderIsolationOption = useCallback(
    (input: SelectFieldRenderOptionInput<"local" | "worktree">) => (
      <IsolationOptionItem {...input} />
    ),
    [],
  );

  return (
    <SelectField
      label="Isolation"
      value={state.effectiveIsolation}
      selectedDisplay={selectedDisplay}
      options={options}
      onChange={handleSelectIsolation}
      placeholder="Select isolation"
      emptyText="No isolation options found"
      searchable={false}
      title="Isolation"
      size={size}
      testID="schedule-isolation"
      triggerTestID="schedule-isolation-trigger"
      triggerLeading={triggerLeading}
      renderOption={renderIsolationOption}
    />
  );
}

function ScheduleAgentTargetField({
  label,
  size,
}: {
  label: string | null;
  size: FieldControlSize;
}): ReactElement {
  const fieldStyle = useMemo(
    () => [styles.readonlyField, size === "sm" ? styles.readonlyFieldSm : styles.readonlyFieldMd],
    [size],
  );
  const textStyle = useMemo(
    () => [styles.readonlyText, size === "sm" ? styles.readonlyTextSm : styles.readonlyTextMd],
    [size],
  );

  return (
    <Field label="Target">
      <View style={fieldStyle} testID="schedule-agent-target">
        <Text style={textStyle} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Field>
  );
}

function IsolationOptionItem({
  option,
  selected,
  active,
  onPress,
}: SelectFieldRenderOptionInput<"local" | "worktree">): ReactElement {
  const leadingSlot = useMemo(
    () => (
      <View style={styles.optionIconBox}>
        {option.value === "worktree" ? (
          <GitBranch size={16} color={styles.providerIcon.color} />
        ) : (
          <Folder size={16} color={styles.providerIcon.color} />
        )}
      </View>
    ),
    [option.value],
  );

  return (
    <ComboboxItem
      testID={option.testID}
      label={option.label}
      selected={selected}
      active={active}
      onPress={onPress}
      leadingSlot={leadingSlot}
    />
  );
}

function HostOptionItem({
  option,
  selected,
  active,
  onPress,
}: SelectFieldRenderOptionInput<string>): ReactElement {
  const leadingSlot = useMemo(() => <HostStatusDotSlot serverId={option.value} />, [option.value]);

  return (
    <ComboboxItem
      testID={option.testID}
      label={option.label}
      selected={selected}
      active={active}
      onPress={onPress}
      leadingSlot={leadingSlot}
    />
  );
}

function ProjectOptionItem({
  option,
  selected,
  active,
  onPress,
}: SelectFieldRenderOptionInput<string>): ReactElement {
  const leadingSlot = useMemo(
    () => (
      <View style={styles.optionIconBox}>
        <Folder size={16} color={styles.providerIcon.color} />
      </View>
    ),
    [],
  );

  return (
    <ComboboxItem
      testID={option.testID}
      label={option.label}
      selected={selected}
      active={active}
      onPress={onPress}
      leadingSlot={leadingSlot}
    />
  );
}

function ThinkingOptionItem({
  option,
  selected,
  active,
  onPress,
}: SelectFieldRenderOptionInput<string>): ReactElement {
  const leadingSlot = useMemo(
    () => (
      <View style={styles.optionIconBox}>
        <Brain size={16} color={styles.providerIcon.color} />
      </View>
    ),
    [],
  );

  return (
    <ComboboxItem
      testID={option.testID}
      label={option.label}
      selected={selected}
      active={active}
      onPress={onPress}
      leadingSlot={leadingSlot}
    />
  );
}

function ProviderGlyph({ provider }: { provider: string | null }): ReactElement | null {
  if (!provider) {
    return null;
  }
  const Icon = getProviderIcon(provider);
  return <Icon size={16} color={styles.providerIcon.color} />;
}

const styles = StyleSheet.create((theme) => {
  const geometry = createControlGeometry(theme);

  return {
    multilineInput: {
      minHeight: 96,
    },
    readonlyField: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: theme.colors.surface2,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    readonlyFieldSm: {
      ...geometry.formTextInputSm,
    },
    readonlyFieldMd: {
      ...geometry.formTextInputMd,
    },
    readonlyText: {
      flex: 1,
      minWidth: 0,
      color: theme.colors.foreground,
    },
    readonlyTextSm: {
      fontSize: theme.fontSize.sm,
    },
    readonlyTextMd: {
      fontSize: theme.fontSize.base,
    },
    optionIconBox: {
      width: 18,
      height: 18,
      alignItems: "center",
      justifyContent: "center",
    },
    footer: {
      flex: 1,
      flexDirection: "row",
      gap: theme.spacing[3],
    },
    footerButton: {
      flex: 1,
    },
    submitError: {
      color: theme.colors.palette.red[300],
      fontSize: theme.fontSize.xs,
    },
    providerIcon: {
      color: theme.colors.foregroundMuted,
    },
  };
});
