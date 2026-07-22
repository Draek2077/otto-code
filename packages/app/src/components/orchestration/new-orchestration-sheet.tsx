import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Brain, ChevronDown, Folder, GitBranch, Schema } from "@/components/icons/material-icons";
import type { AgentModelDefinition } from "@otto-code/protocol/agent-types";
import type { OrchestrationGraph } from "@otto-code/protocol/orchestration";
import {
  AdaptiveModalSheet,
  AdaptiveTextInput,
  type SheetHeader,
} from "@/components/adaptive-modal-sheet";
import { Combobox, ComboboxItem, type ComboboxOption } from "@/components/ui/combobox";
import { Button } from "@/components/ui/button";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { TextAreaScrollFrame } from "@/components/ui/text-area";
import { RoleModelSelector } from "@/components/role-model-selector";
import { type SelectorPersonality } from "@/hooks/use-personality-selection";
import {
  useFormRolePersonality,
  type RolePersonality,
} from "@/provider-selection/role-model-personality";
import type { PersonalityFormValues } from "@/provider-selection/personality-form";
import { getProviderIcon } from "@/components/provider-icons";
import { PersonalityProviderIcon } from "@/components/personality-provider-icon";
import { formatThinkingOptionLabel } from "@/composer/agent-controls/utils";
import { useAgentFormState, type FormInitialValues } from "@/hooks/use-agent-form-state";
import { useProjects } from "@/hooks/use-projects";
import {
  useOrchestrationGraphs,
  useSaveOrchestrationGraph,
  useStartOrchestration,
  type StartOrchestrationInput,
} from "@/hooks/use-orchestration-graphs";
import { openOrchestrationGraphTab } from "@/orchestration-graph/open-orchestration-graph-tab";
import { buildEmptyOrchestrationGraph } from "@/orchestration-graph/graph-doc";
import {
  buildScheduleProjectTargets,
  type ScheduleProjectTarget,
} from "@/schedules/schedule-project-targets";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import {
  buildOrchestrationWorkspaceTargets,
  resolveProjectKeyForWorkspaceCwd,
  resolveSelectedWorkspaceTarget,
  type OrchestrationWorkspaceTarget,
} from "@/components/orchestration/orchestration-workspace-targets";
import { navigateToPreparedWorkspaceTab } from "@/utils/workspace-navigation";
import { shortenPath } from "@/utils/shorten-path";
import { normalizeWorkspacePath } from "@/utils/workspace-identity";
import { toErrorMessage } from "@/utils/error-messages";
import type { ProjectSummary } from "@/utils/projects";

// The New Orchestration dialog (projects/orchestration-graphs) — the same form
// idiom as the New Artifact / New Schedule sheets: Name, a multiline
// description, the shared project-target picker, RoleModelSelector for the
// orchestrator seat ("Team's Orchestrator" entry when a team is active), an
// Effort picker while no personality is bound, then the flavor payload —
// Prompt (AI) or graph + its declared inputs (Graph).

export interface NewOrchestrationPrefill {
  serverId: string;
  /** The workspace directory the designer tab lives in (resolves the project target). */
  projectCwd: string;
  graphId: string;
  runId?: string;
  /**
   * Edit mode — the dialog reopens on an existing Draft orchestration and is
   * seeded from that record (not from the graph). Save writes the draft back in
   * place; Run executes it. Only drafts are editable, so this always rides with
   * a `runId`.
   */
  draft?: NewOrchestrationDraftSeed;
}

export interface NewOrchestrationDraftSeed {
  title: string;
  description?: string;
  graphInputs?: Record<string, string>;
}

export interface NewOrchestrationSheetProps {
  visible: boolean;
  onClose: () => void;
  prefill?: NewOrchestrationPrefill;
}

type OrchestrationFlavor = "ai" | "graph";
/** Which footer button was pressed — "save-draft" exists only in edit mode. */
type SubmitIntent = "run" | "save-draft";

function resolveSheetTitle(isEditingDraft: boolean): string {
  return isEditingDraft ? "Edit Orchestration" : "New Orchestration";
}

/** Create mode starts empty; edit mode starts on the draft's own values. */
function resolveDraftSeedValues(draft: NewOrchestrationDraftSeed | undefined): {
  title: string;
  description: string;
  graphInputs: Record<string, string>;
} {
  return {
    title: draft?.title ?? "",
    description: draft?.description ?? "",
    graphInputs: { ...draft?.graphInputs },
  };
}
type ThinkingOptions = NonNullable<AgentModelDefinition["thinkingOptions"]>;

const NEW_GRAPH_VALUE = "__new-graph__";
// Synthetic "Team's Orchestrator" picker entry. Its id NEVER crosses the wire:
// selecting it sends no seat fields, and the daemon resolves the active team's
// Orchestrator at start time (the schedule form's run-time-sentinel pattern).
const TEAM_ORCHESTRATOR_ENTRY_ID = "__team-orchestrator__";

const FLAVOR_OPTIONS: SegmentedControlOption<OrchestrationFlavor>[] = [
  { value: "ai", label: "AI", testID: "orchestration-flavor-ai" },
  { value: "graph", label: "Graph", testID: "orchestration-flavor-graph" },
];

interface OrchestrationProjectOptions {
  targets: ScheduleProjectTarget[];
  options: ComboboxOption[];
  targetByOptionId: Map<string, ScheduleProjectTarget>;
}

function buildOrchestrationProjectOptions(
  projects: readonly ProjectSummary[],
): OrchestrationProjectOptions {
  const targets = buildScheduleProjectTargets(projects);
  const targetByOptionId = new Map(targets.map((target) => [target.optionId, target]));
  const options: ComboboxOption[] = targets.map((target) => ({
    id: target.optionId,
    label: target.projectName,
    description: `${target.serverName} - ${shortenPath(target.cwd)}`,
  }));
  return { targets, options, targetByOptionId };
}

// The selected cwd is a *workspace* directory, which may be a worktree under
// the project root — match by normalized containment, preferring the most
// specific root.
function resolveProjectTargetForCwd(input: {
  targets: readonly ScheduleProjectTarget[];
  serverId: string | null | undefined;
  cwd: string | null | undefined;
}): ScheduleProjectTarget | null {
  const cwd = normalizeWorkspacePath(input.cwd);
  if (!cwd) {
    return null;
  }
  let best: ScheduleProjectTarget | null = null;
  let bestLength = -1;
  for (const target of input.targets) {
    if (input.serverId && target.serverId !== input.serverId) {
      continue;
    }
    const targetCwd = normalizeWorkspacePath(target.cwd);
    if (!targetCwd) {
      continue;
    }
    const matches = cwd === targetCwd || cwd.startsWith(`${targetCwd}/`);
    if (matches && targetCwd.length > bestLength) {
      best = target;
      bestLength = targetCwd.length;
    }
  }
  return best;
}

/**
 * The project the form is targeting: the explicitly picked one, else the
 * project owning the selected workspace, else the project containing the cwd
 * (a plain checkout, or a prefill from a tab whose workspace is not loaded).
 */
function resolveSelectedProjectTarget(input: {
  targets: readonly ScheduleProjectTarget[];
  targetByOptionId: ReadonlyMap<string, ScheduleProjectTarget>;
  projectOptionId: string;
  serverId: string;
  cwd: string;
  workspaces: ReadonlyMap<string, WorkspaceDescriptor> | undefined;
}): ScheduleProjectTarget | null {
  const picked = input.targetByOptionId.get(input.projectOptionId);
  if (picked) {
    return picked;
  }
  const projectKey = resolveProjectKeyForWorkspaceCwd(input.workspaces, input.cwd);
  if (projectKey) {
    const owner = input.targets.find(
      (target) => target.serverId === input.serverId && target.projectKey === projectKey,
    );
    if (owner) {
      return owner;
    }
  }
  return resolveProjectTargetForCwd({
    targets: input.targets,
    serverId: input.serverId,
    cwd: input.cwd,
  });
}

/** The host whose workspaces the form reads — the picked one, else the prefill's. */
function resolveSessionServerId(
  selectedServerId: string | null,
  prefillServerId: string | undefined,
): string {
  return selectedServerId ?? prefillServerId ?? "";
}

/**
 * Where the orchestration actually runs: the picked workspace, else whatever
 * directory the form holds, else the project root.
 */
function resolveEffectiveCwd(input: {
  workspaceCwd: string | undefined;
  workingDir: string;
  projectCwd: string | undefined;
}): string {
  return input.workspaceCwd ?? (input.workingDir.trim() || input.projectCwd || "");
}

/**
 * The workspace the designer tab should open in for a project target: the
 * workspace whose directory (or project root) matches the target cwd. Needed
 * only by the "Create & design" flow — executing flows get the workspace back
 * from the daemon in runs.start.response.
 */
function resolveWorkspaceIdForCwd(
  workspaces: ReadonlyMap<
    string,
    { id: string; workspaceDirectory: string; projectRootPath: string }
  >,
  cwd: string,
): string | null {
  const normalized = normalizeWorkspacePath(cwd);
  if (!normalized) {
    return null;
  }
  let projectMatch: string | null = null;
  for (const workspace of workspaces.values()) {
    if (normalizeWorkspacePath(workspace.workspaceDirectory) === normalized) {
      return workspace.id;
    }
    if (!projectMatch && normalizeWorkspacePath(workspace.projectRootPath) === normalized) {
      projectMatch = workspace.id;
    }
  }
  return projectMatch;
}

function buildSeatFields(input: {
  selectedPersonalityId: string | null;
  selectedProvider: string | null;
  selectedModel: string;
  selectedThinkingOptionId: string;
}): Partial<StartOrchestrationInput> {
  // Team sentinel → no seat fields; the daemon resolves the team's Orchestrator.
  if (input.selectedPersonalityId === TEAM_ORCHESTRATOR_ENTRY_ID) {
    return {};
  }
  if (input.selectedPersonalityId) {
    return { orchestratorPersonalityId: input.selectedPersonalityId };
  }
  if (input.selectedProvider) {
    return {
      orchestratorProvider: input.selectedProvider,
      ...(input.selectedModel ? { orchestratorModel: input.selectedModel } : {}),
      ...(input.selectedThinkingOptionId
        ? { orchestratorThinkingOptionId: input.selectedThinkingOptionId }
        : {}),
    };
  }
  return {};
}

function canSubmitOrchestrationForm(input: {
  nameTrimmed: string;
  descriptionTrimmed: string;
  hasSeat: boolean;
  hasProject: boolean;
  isSubmitting: boolean;
  flavor: OrchestrationFlavor;
  promptTrimmed: string;
  graphId: string;
  selectedGraph: OrchestrationGraph | null;
  requiredInputsMissing: boolean;
}): boolean {
  if (input.isSubmitting || !input.hasSeat || !input.hasProject) {
    return false;
  }
  if (input.nameTrimmed.length === 0 || input.descriptionTrimmed.length === 0) {
    return false;
  }
  if (input.flavor === "ai") {
    return input.promptTrimmed.length > 0;
  }
  if (input.graphId === NEW_GRAPH_VALUE) {
    return true;
  }
  return input.selectedGraph !== null && !input.requiredInputsMissing;
}

function resolveSubmitLabel(flavor: OrchestrationFlavor, graphId: string): string {
  if (flavor === "ai") {
    return "Start";
  }
  return graphId === NEW_GRAPH_VALUE ? "Create & design" : "Run";
}

function resolveInitialSelection(
  targets: readonly ScheduleProjectTarget[],
  prefill: NewOrchestrationPrefill | undefined,
): { serverId: string | null; cwd: string; projectOptionId: string } {
  if (!prefill) {
    return { serverId: null, cwd: "", projectOptionId: "" };
  }
  const target = resolveProjectTargetForCwd({
    targets,
    serverId: prefill.serverId,
    cwd: prefill.projectCwd,
  });
  return {
    serverId: target?.serverId ?? prefill.serverId,
    // The designer tab's own workspace, not the project root — the run should
    // land back where it was designed.
    cwd: prefill.projectCwd || (target?.cwd ?? ""),
    projectOptionId: target?.optionId ?? "",
  };
}

function resolveMutationServerId(input: {
  selectedTarget: ScheduleProjectTarget | null;
  selectedServerId: string | null;
  prefillServerId: string | undefined;
}): string {
  return input.selectedTarget?.serverId ?? input.selectedServerId ?? input.prefillServerId ?? "";
}

function resolveFlavorHint(flavor: OrchestrationFlavor): string {
  return flavor === "ai"
    ? "An orchestrator plans and runs the orchestration from your prompt."
    : "A graph runs deterministically, exactly as drawn.";
}

function openKey(props: NewOrchestrationSheetProps): string {
  const mode = props.prefill?.draft ? "edit" : "create";
  return `${mode}:${props.prefill?.serverId ?? ""}:${props.prefill?.graphId ?? ""}:${props.prefill?.runId ?? ""}`;
}

/** Mount gate — same shape as ArtifactCreateSheet / ScheduleFormSheet, so a
 * cancelled form never leaks its state into the next open. */
export function NewOrchestrationSheet(props: NewOrchestrationSheetProps): ReactElement | null {
  const [renderedProps, setRenderedProps] = useState<NewOrchestrationSheetProps | null>(() =>
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
    <OpenNewOrchestrationSheet
      key={openKey(renderedProps)}
      {...renderedProps}
      visible={sheetVisible}
      onClose={requestClose}
      onDismiss={handleDismiss}
    />
  );
}

function OpenNewOrchestrationSheet({
  visible,
  onClose,
  onDismiss,
  prefill,
}: NewOrchestrationSheetProps & { onDismiss: () => void }): ReactElement {
  const { projects } = useProjects();
  const projectOptions = useMemo(() => buildOrchestrationProjectOptions(projects), [projects]);
  const onlineServerIds = useMemo(
    () => Array.from(new Set(projectOptions.targets.map((target) => target.serverId))),
    [projectOptions.targets],
  );

  const {
    serverId: resolvedInitialServerId,
    cwd: resolvedInitialCwd,
    projectOptionId: resolvedInitialProjectOptionId,
  } = useMemo(
    () => resolveInitialSelection(projectOptions.targets, prefill),
    [projectOptions.targets, prefill],
  );

  const initialFormValues = useMemo<FormInitialValues | undefined>(
    () => (resolvedInitialCwd ? { workingDir: resolvedInitialCwd } : undefined),
    [resolvedInitialCwd],
  );

  const form = useAgentFormState({
    initialServerId: resolvedInitialServerId,
    initialValues: initialFormValues,
    isVisible: visible,
    isCreateFlow: true,
    onlineServerIds,
  });
  const {
    selectedServerId,
    selectedProvider,
    selectedModel,
    selectedThinkingOptionId,
    setThinkingOptionFromUser,
    availableThinkingOptions,
    workingDir,
    setProviderAndModelFromUser,
    applyPersonalityValues,
    clearProviderSelectionFromUser,
    setSelectedServerIdFromUser,
    setWorkingDirFromUser,
    modelSelectorProviders,
    allProviderEntries,
    isAllModelsLoading,
    persistFormPreferences,
  } = form;

  // The project is chosen explicitly rather than derived from the cwd: an Otto
  // worktree lives outside its repo root, so once a workspace is selected the
  // path alone no longer names the project.
  const [projectOptionId, setProjectOptionId] = useState(resolvedInitialProjectOptionId);
  const sessionServerId = resolveSessionServerId(selectedServerId, prefill?.serverId);
  const workspacesForServer = useSessionStore(
    (state) => state.sessions[sessionServerId]?.workspaces,
  );

  const selectedTarget = useMemo(
    () =>
      resolveSelectedProjectTarget({
        targets: projectOptions.targets,
        targetByOptionId: projectOptions.targetByOptionId,
        projectOptionId,
        serverId: sessionServerId,
        cwd: workingDir,
        workspaces: workspacesForServer,
      }),
    [projectOptions, projectOptionId, sessionServerId, workingDir, workspacesForServer],
  );
  const selectedProjectOptionId = selectedTarget?.optionId ?? "";
  const mutationServerId = resolveMutationServerId({
    selectedTarget,
    selectedServerId,
    prefillServerId: prefill?.serverId,
  });
  const graphsServerId = mutationServerId || null;

  const applyPersonality = useCallback(
    (values: PersonalityFormValues) => {
      applyPersonalityValues({
        provider: values.provider,
        model: values.model,
        thinkingOptionId: values.thinkingOptionId,
      });
    },
    [applyPersonalityValues],
  );
  const personalityCurrentSelection = useMemo(
    () => ({
      provider: selectedProvider,
      model: selectedModel,
      thinkingOptionId: selectedThinkingOptionId,
    }),
    [selectedProvider, selectedModel, selectedThinkingOptionId],
  );
  // "Team's Orchestrator" rides as a role-slot entry: unlike the artifact
  // form's resolve-now Artificer, the sentinel stays selected and the daemon
  // re-resolves the seat at start time (buildSeatFields sends nothing for it).
  const personality: RolePersonality = useFormRolePersonality({
    serverId: mutationServerId || null,
    role: "orchestrator",
    entries: allProviderEntries ?? [],
    onApply: applyPersonality,
    currentSelection: personalityCurrentSelection,
    team: {
      entryId: TEAM_ORCHESTRATOR_ENTRY_ID,
      label: "Team's Orchestrator",
      roleLabel: "Orchestrator",
    },
    autoSelectDefault: "always",
  });
  const {
    selectedPersonalityId,
    selectedName: selectedPersonalityName,
    selectedSpinner: selectedPersonalitySpinner,
    selectedRoleIcon: selectedPersonalityRoleIcon,
  } = personality;

  const handleSelectProject = useCallback(
    (target: ScheduleProjectTarget) => {
      if (selectedServerId && selectedServerId !== target.serverId) {
        clearProviderSelectionFromUser();
      }
      setProjectOptionId(target.optionId);
      setSelectedServerIdFromUser(target.serverId);
      // Switching project resets the workspace to that project's root; the
      // Workspace picker below narrows it to a worktree.
      setWorkingDirFromUser(target.cwd);
    },
    [
      clearProviderSelectionFromUser,
      selectedServerId,
      setSelectedServerIdFromUser,
      setWorkingDirFromUser,
    ],
  );

  const workspaceTargets = useMemo(
    () =>
      buildOrchestrationWorkspaceTargets({
        workspaces: workspacesForServer,
        project: selectedTarget,
      }),
    [selectedTarget, workspacesForServer],
  );
  const selectedWorkspaceTarget = useMemo(
    () => resolveSelectedWorkspaceTarget(workspaceTargets, workingDir),
    [workspaceTargets, workingDir],
  );
  const handleSelectWorkspace = useCallback(
    (target: OrchestrationWorkspaceTarget) => {
      setWorkingDirFromUser(target.cwd);
    },
    [setWorkingDirFromUser],
  );
  const effectiveCwd = resolveEffectiveCwd({
    workspaceCwd: selectedWorkspaceTarget?.cwd,
    workingDir,
    projectCwd: selectedTarget?.cwd,
  });

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
    }): ReactNode => (
      <ModelTrigger
        label={selectedPersonalityName ?? selectedModelLabel}
        provider={selectedProvider}
        hasPersonality={Boolean(selectedPersonalityName)}
        personalitySpinner={selectedPersonalitySpinner}
        roleIcon={selectedPersonalityRoleIcon}
        disabled={disabled}
        active={hovered || pressed || isOpen}
        isPlaceholder={!selectedModel && !selectedPersonalityName}
      />
    ),
    [
      selectedModel,
      selectedProvider,
      selectedPersonalityName,
      selectedPersonalitySpinner,
      selectedPersonalityRoleIcon,
    ],
  );

  // Editing a Draft: the record is the source of truth for Name/Description/
  // inputs, and the flavor is fixed (only graph orchestrations have drafts).
  const draftSeed = prefill?.draft;
  const isEditingDraft = Boolean(draftSeed);

  const seed = resolveDraftSeedValues(draftSeed);

  const [flavor, setFlavor] = useState<OrchestrationFlavor>(prefill ? "graph" : "ai");
  const [name, setName] = useState(seed.title);
  const [description, setDescription] = useState(seed.description);
  const [prompt, setPrompt] = useState("");
  const [graphId, setGraphId] = useState<string>(prefill?.graphId ?? NEW_GRAPH_VALUE);
  const [graphInputs, setGraphInputs] = useState<Record<string, string>>(seed.graphInputs);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const graphsQuery = useOrchestrationGraphs(graphsServerId);
  const graphs = useMemo(() => graphsQuery.data ?? [], [graphsQuery.data]);
  const selectedGraph = useMemo(
    () => graphs.find((graph) => graph.id === graphId) ?? null,
    [graphs, graphId],
  );
  const saveGraph = useSaveOrchestrationGraph(graphsServerId);
  const startOrchestration = useStartOrchestration(graphsServerId);

  // Designer Run… flow: seed Name/Description from the prefilled graph once it
  // loads (editable before running).
  const prefillSeededRef = useRef(false);
  useEffect(() => {
    // Edit mode already carries the draft's own Name/Description — the graph's
    // identity must not overwrite what the user named this orchestration.
    if (!prefill || draftSeed || !selectedGraph || prefillSeededRef.current) {
      return;
    }
    prefillSeededRef.current = true;
    setName((current) => current || selectedGraph.name);
    setDescription((current) => current || (selectedGraph.description ?? ""));
  }, [prefill, draftSeed, selectedGraph]);

  const handleGraphChange = useCallback((value: string) => {
    setGraphId(value);
    setGraphInputs({});
  }, []);
  const handleGraphInputChange = useCallback((key: string, value: string) => {
    setGraphInputs((previous) => ({ ...previous, [key]: value }));
  }, []);

  const handleOpenDesigner = useCallback(() => {
    if (!selectedTarget || !selectedGraph || !workspacesForServer) {
      return;
    }
    const workspaceId = resolveWorkspaceIdForCwd(workspacesForServer, effectiveCwd);
    if (!workspaceId) {
      setSubmitError("Open this project in a workspace first to design its graphs.");
      return;
    }
    onClose();
    openOrchestrationGraphTab({
      serverId: selectedTarget.serverId,
      workspaceId,
      graphId: selectedGraph.id,
    });
  }, [selectedTarget, selectedGraph, workspacesForServer, effectiveCwd, onClose]);

  const nameTrimmed = name.trim();
  const descriptionTrimmed = description.trim();
  const promptTrimmed = prompt.trim();

  const requiredInputsMissing = useMemo(() => {
    if (flavor !== "graph" || !selectedGraph) {
      return false;
    }
    return (selectedGraph.inputs ?? []).some(
      (input) => input.required && !(graphInputs[input.key] ?? input.defaultValue)?.trim(),
    );
  }, [flavor, selectedGraph, graphInputs]);

  const canSubmit = canSubmitOrchestrationForm({
    nameTrimmed,
    descriptionTrimmed,
    hasSeat: Boolean(selectedPersonalityId ?? selectedProvider),
    hasProject: Boolean(selectedTarget),
    isSubmitting,
    flavor,
    promptTrimmed,
    graphId,
    selectedGraph,
    requiredInputsMissing,
  });

  const handleSubmit = useCallback(
    async (intent: SubmitIntent) => {
      if (!selectedTarget || !nameTrimmed || !descriptionTrimmed) {
        return;
      }
      setSubmitError(null);
      setIsSubmitting(true);
      try {
        await persistFormPreferences();
        await submitOrchestrationForm({
          intent,
          flavor,
          target: selectedTarget,
          cwd: effectiveCwd,
          name: nameTrimmed,
          description: descriptionTrimmed,
          prompt: promptTrimmed,
          graphId,
          graphInputs,
          selectedGraph,
          prefillRunId: prefill?.runId,
          seatFields: buildSeatFields({
            selectedPersonalityId,
            selectedProvider,
            selectedModel,
            selectedThinkingOptionId,
          }),
          workspaces: workspacesForServer,
          start: startOrchestration.mutateAsync,
          saveGraph: saveGraph.mutateAsync,
          onClose,
        });
      } catch (error) {
        setSubmitError(toErrorMessage(error));
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      selectedTarget,
      effectiveCwd,
      nameTrimmed,
      descriptionTrimmed,
      persistFormPreferences,
      flavor,
      promptTrimmed,
      graphId,
      graphInputs,
      selectedGraph,
      prefill?.runId,
      selectedPersonalityId,
      selectedProvider,
      selectedModel,
      selectedThinkingOptionId,
      workspacesForServer,
      startOrchestration.mutateAsync,
      saveGraph.mutateAsync,
      onClose,
    ],
  );
  const handleSubmitPress = useCallback(() => {
    void handleSubmit("run");
  }, [handleSubmit]);
  const handleSaveDraftPress = useCallback(() => {
    void handleSubmit("save-draft");
  }, [handleSubmit]);

  const header = useMemo<SheetHeader>(
    () => ({ title: resolveSheetTitle(isEditingDraft) }),
    [isEditingDraft],
  );

  const submitLabel = resolveSubmitLabel(flavor, graphId);
  const footer = useMemo(
    () => (
      <OrchestrationSheetFooter
        isEditingDraft={isEditingDraft}
        canSubmit={canSubmit}
        isSubmitting={isSubmitting}
        submitLabel={submitLabel}
        onCancel={onClose}
        onSaveDraft={handleSaveDraftPress}
        onSubmit={handleSubmitPress}
      />
    ),
    [
      isEditingDraft,
      canSubmit,
      isSubmitting,
      submitLabel,
      onClose,
      handleSaveDraftPress,
      handleSubmitPress,
    ],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      onDismiss={onDismiss}
      footer={footer}
      webScrollbar
      testID="new-orchestration-sheet"
    >
      {/* A draft is always a graph orchestration — editing one can't change
          that, so the flavor switch is a create-time control only. */}
      <FlavorField hidden={isEditingDraft} value={flavor} onChange={setFlavor} />

      <View style={styles.field}>
        <Text style={styles.label}>Name</Text>
        <AdaptiveTextInput
          testID="orchestration-name-input"
          accessibilityLabel="Orchestration name"
          initialValue={name}
          value={name}
          onChangeText={setName}
          placeholder="Release notes sweep"
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Description</Text>
        <TextAreaScrollFrame>
          <AdaptiveTextInput
            testID="orchestration-description-input"
            accessibilityLabel="Description"
            initialValue={description}
            value={description}
            onChangeText={setDescription}
            placeholder="What is this orchestration for?"
            style={styles.multilineInput}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
        </TextAreaScrollFrame>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Project</Text>
        {/* A draft belongs to the project it was created in — moving it there
            would orphan its graph and its workspace, so editing shows the
            project rather than offering it. The Workspace picker below still
            moves the run between that project's worktrees. */}
        {isEditingDraft ? (
          <ReadOnlyProjectField selectedTarget={selectedTarget} fallbackCwd={workingDir} />
        ) : (
          <ProjectField
            options={projectOptions.options}
            targetByOptionId={projectOptions.targetByOptionId}
            value={selectedProjectOptionId}
            selectedTarget={selectedTarget}
            fallbackCwd={workingDir}
            onSelect={handleSelectProject}
          />
        )}
      </View>

      <WorkspaceFieldSection
        hasProject={Boolean(selectedTarget)}
        targets={workspaceTargets}
        selectedTarget={selectedWorkspaceTarget}
        onSelect={handleSelectWorkspace}
      />

      <View style={styles.field}>
        <Text style={styles.label}>Agent Personality or Model</Text>
        <RoleModelSelector
          providers={modelSelectorProviders}
          selectedProvider={selectedProvider ?? ""}
          selectedModel={selectedModel}
          onSelect={setProviderAndModelFromUser}
          isLoading={isAllModelsLoading}
          renderTrigger={renderModelTrigger}
          triggerFill
          serverId={mutationServerId}
          personality={personality}
        />
      </View>

      <EffortFieldSection
        personalitySelected={Boolean(selectedPersonalityId)}
        model={selectedModel}
        options={availableThinkingOptions}
        value={selectedThinkingOptionId}
        onSelect={setThinkingOptionFromUser}
      />

      {flavor === "ai" ? (
        <View style={styles.field}>
          <Text style={styles.label}>Prompt</Text>
          <TextAreaScrollFrame>
            <AdaptiveTextInput
              testID="orchestration-prompt-input"
              accessibilityLabel="Prompt"
              initialValue={prompt}
              value={prompt}
              onChangeText={setPrompt}
              placeholder="What should the orchestration accomplish?"
              style={styles.multilineInput}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
          </TextAreaScrollFrame>
        </View>
      ) : (
        <GraphFlavorFields
          graphs={graphs}
          graphId={graphId}
          selectedGraph={selectedGraph}
          graphInputs={graphInputs}
          requiredInputsMissing={requiredInputsMissing}
          canOpenDesigner={Boolean(selectedTarget)}
          onGraphChange={handleGraphChange}
          onGraphInputChange={handleGraphInputChange}
          onOpenDesigner={handleOpenDesigner}
        />
      )}

      {submitError ? <Text style={styles.error}>{submitError}</Text> : null}
    </AdaptiveModalSheet>
  );
}

/** AI vs Graph. Hidden while editing a draft — a draft is always a graph
 * orchestration, so the flavor switch is a create-time control only. */
function FlavorField({
  hidden,
  value,
  onChange,
}: {
  hidden: boolean;
  value: OrchestrationFlavor;
  onChange: (flavor: OrchestrationFlavor) => void;
}): ReactElement | null {
  if (hidden) {
    return null;
  }
  return (
    <View style={styles.field}>
      <SegmentedControl<OrchestrationFlavor>
        options={FLAVOR_OPTIONS}
        value={value}
        onValueChange={onChange}
        stretch
        size="sm"
      />
      <Text style={styles.hint}>{resolveFlavorHint(value)}</Text>
    </View>
  );
}

/** Cancel + submit, plus the edit-mode-only Save Draft between them. Saving is
 * the non-committal action; running stays primary — a draft exists to be run. */
function OrchestrationSheetFooter({
  isEditingDraft,
  canSubmit,
  isSubmitting,
  submitLabel,
  onCancel,
  onSaveDraft,
  onSubmit,
}: {
  isEditingDraft: boolean;
  canSubmit: boolean;
  isSubmitting: boolean;
  submitLabel: string;
  onCancel: () => void;
  onSaveDraft: () => void;
  onSubmit: () => void;
}): ReactElement {
  return (
    <View style={styles.footer}>
      <Button
        style={styles.footerButton}
        variant="secondary"
        onPress={onCancel}
        disabled={isSubmitting}
      >
        Cancel
      </Button>
      {isEditingDraft ? (
        <Button
          style={styles.footerButton}
          variant="outline"
          onPress={onSaveDraft}
          disabled={!canSubmit}
          loading={isSubmitting}
          testID="edit-orchestration-save-draft"
        >
          Save Draft
        </Button>
      ) : null}
      <Button
        style={styles.footerButton}
        variant="default"
        onPress={onSubmit}
        disabled={!canSubmit}
        loading={isSubmitting}
        testID="new-orchestration-submit"
      >
        {submitLabel}
      </Button>
    </View>
  );
}

// The whole submit path, module-level (complexity + readability, same shape as
// submitArtifactForm).
async function submitOrchestrationForm(input: {
  /** "run" executes; "save-draft" rewrites the edited draft and stays put. */
  intent: SubmitIntent;
  flavor: OrchestrationFlavor;
  target: ScheduleProjectTarget;
  /** The selected workspace directory — the project root when none was picked. */
  cwd: string;
  name: string;
  description: string;
  prompt: string;
  graphId: string;
  graphInputs: Record<string, string>;
  selectedGraph: OrchestrationGraph | null;
  prefillRunId: string | undefined;
  seatFields: Partial<StartOrchestrationInput>;
  workspaces:
    | ReadonlyMap<string, { id: string; workspaceDirectory: string; projectRootPath: string }>
    | undefined;
  start: (request: StartOrchestrationInput) => Promise<{
    runId?: string;
    agentId?: string;
    workspaceId?: string;
  }>;
  saveGraph: (graph: OrchestrationGraph) => Promise<OrchestrationGraph>;
  onClose: () => void;
}): Promise<void> {
  const common = {
    cwd: input.cwd || input.target.cwd,
    title: input.name,
    description: input.description,
    ...input.seatFields,
  };

  if (input.flavor === "ai") {
    const result = await input.start({ flavor: "ai", ...common, prompt: input.prompt });
    input.onClose();
    navigateToOrchestratorChat(input.target.serverId, result);
    return;
  }

  if (input.graphId === NEW_GRAPH_VALUE) {
    // Create the graph (Name + Description become its identity) + a Draft
    // orchestration, then land in the designer. The designer tab needs a
    // workspace; a project without one can't host the canvas yet.
    const workspaceId = input.workspaces
      ? resolveWorkspaceIdForCwd(input.workspaces, input.cwd || input.target.cwd)
      : null;
    if (!workspaceId) {
      throw new Error("Open this project in a workspace first to design its graphs.");
    }
    const graph = await input.saveGraph(
      buildEmptyOrchestrationGraph(input.name, input.description),
    );
    const draft = await input.start({
      flavor: "graph",
      ...common,
      graphId: graph.id,
      draft: true,
    });
    input.onClose();
    openOrchestrationGraphTab({
      serverId: input.target.serverId,
      workspaceId,
      graphId: graph.id,
      ...(draft.runId ? { runId: draft.runId } : {}),
    });
    return;
  }

  const answers: Record<string, string> = {};
  for (const declared of input.selectedGraph?.inputs ?? []) {
    const value = (input.graphInputs[declared.key] ?? declared.defaultValue ?? "").trim();
    if (value) {
      answers[declared.key] = value;
    }
  }

  // Save Draft (edit mode only): the daemon rewrites that draft record in place
  // — same id, no execution, no navigation.
  if (input.intent === "save-draft" && input.prefillRunId) {
    await input.start({
      flavor: "graph",
      ...common,
      graphId: input.graphId,
      graphInputs: answers,
      draft: true,
      runId: input.prefillRunId,
    });
    input.onClose();
    return;
  }

  const result = await input.start({
    flavor: "graph",
    ...common,
    graphId: input.graphId,
    graphInputs: answers,
    ...(input.prefillRunId ? { runId: input.prefillRunId } : {}),
  });
  input.onClose();
  navigateToOrchestratorChat(input.target.serverId, result);
}

function navigateToOrchestratorChat(
  serverId: string,
  result: { agentId?: string; workspaceId?: string },
): void {
  if (!result.agentId || !result.workspaceId) {
    return;
  }
  navigateToPreparedWorkspaceTab({
    serverId,
    workspaceId: result.workspaceId,
    target: { kind: "agent", agentId: result.agentId },
  });
}

function GraphFlavorFields({
  graphs,
  graphId,
  selectedGraph,
  graphInputs,
  requiredInputsMissing,
  canOpenDesigner,
  onGraphChange,
  onGraphInputChange,
  onOpenDesigner,
}: {
  graphs: OrchestrationGraph[];
  graphId: string;
  selectedGraph: OrchestrationGraph | null;
  graphInputs: Record<string, string>;
  requiredInputsMissing: boolean;
  canOpenDesigner: boolean;
  onGraphChange: (graphId: string) => void;
  onGraphInputChange: (key: string, value: string) => void;
  onOpenDesigner: () => void;
}): ReactElement {
  return (
    <>
      <View style={styles.field}>
        <Text style={styles.label}>Graph</Text>
        <GraphField graphs={graphs} value={graphId} onSelect={onGraphChange} />
        {graphId !== NEW_GRAPH_VALUE && selectedGraph && canOpenDesigner ? (
          <Button size="sm" variant="outline" style={styles.inlineButton} onPress={onOpenDesigner}>
            Open in designer
          </Button>
        ) : null}
      </View>
      {(selectedGraph?.inputs ?? []).map((declared) => (
        <GraphAnswerField
          // Graph-scoped key: AdaptiveTextInput seeds from initialValue on
          // mount, so switching graphs must remount same-named fields.
          key={`${graphId}:${declared.key}`}
          declared={declared}
          value={graphInputs[declared.key] ?? declared.defaultValue ?? ""}
          missing={Boolean(
            declared.required && requiredInputsMissing && !graphInputs[declared.key]?.trim(),
          )}
          onValueChange={onGraphInputChange}
        />
      ))}
    </>
  );
}

// One answer field per declared graph input.
function GraphAnswerField({
  declared,
  value,
  missing,
  onValueChange,
}: {
  declared: NonNullable<OrchestrationGraph["inputs"]>[number];
  value: string;
  missing: boolean;
  onValueChange: (key: string, value: string) => void;
}): ReactElement {
  const handleChange = useCallback(
    (next: string) => onValueChange(declared.key, next),
    [onValueChange, declared.key],
  );
  const input = (
    <AdaptiveTextInput
      accessibilityLabel={declared.label}
      initialValue={value}
      value={value}
      onChangeText={handleChange}
      placeholder={declared.description ?? ""}
      style={declared.multiline ? styles.multilineInput : styles.input}
      {...(declared.multiline
        ? { multiline: true, numberOfLines: 4, textAlignVertical: "top" as const }
        : {})}
    />
  );
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{declared.label}</Text>
      {declared.multiline ? <TextAreaScrollFrame>{input}</TextAreaScrollFrame> : input}
      {missing ? <Text style={styles.error}>Required</Text> : null}
    </View>
  );
}

function GraphField({
  graphs,
  value,
  onSelect,
}: {
  graphs: OrchestrationGraph[];
  value: string;
  onSelect: (graphId: string) => void;
}): ReactElement {
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);

  const options = useMemo<ComboboxOption[]>(
    () => [
      {
        id: NEW_GRAPH_VALUE,
        label: "New graph…",
        description: "Create an empty graph and open the designer",
      },
      ...graphs.map((graph) => ({
        id: graph.id,
        label: graph.name,
        description: graph.description,
      })),
    ],
    [graphs],
  );

  const handleSelect = useCallback(
    (id: string) => {
      onSelect(id);
      setOpen(false);
    },
    [onSelect],
  );
  const handlePress = useCallback(() => setOpen((current) => !current), []);
  const triggerStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.selectTrigger,
      (Boolean(hovered) || pressed || open) && styles.selectTriggerActive,
    ],
    [open],
  );

  const selected = options.find((option) => option.id === value) ?? null;
  const displayValue = selected?.label ?? "Select graph";

  const renderOption = useCallback(
    ({
      option,
      selected: isSelected,
      active,
      onPress,
    }: {
      option: ComboboxOption;
      selected: boolean;
      active: boolean;
      onPress: () => void;
    }) => (
      <GraphOptionItem option={option} selected={isSelected} active={active} onPress={onPress} />
    ),
    [],
  );

  return (
    <>
      <View ref={anchorRef} collapsable={false}>
        <Pressable
          onPress={handlePress}
          style={triggerStyle}
          accessibilityRole="button"
          accessibilityLabel={`Select graph (${displayValue})`}
          testID="orchestration-graph-trigger"
        >
          <Schema size={16} color={styles.chevron.color} />
          <Text
            style={selected ? styles.selectTriggerText : styles.selectTriggerPlaceholder}
            numberOfLines={1}
          >
            {displayValue}
          </Text>
          <ChevronDown size={16} color={styles.chevron.color} />
        </Pressable>
      </View>
      <Combobox
        options={options}
        value={value}
        onSelect={handleSelect}
        searchable={options.length > 6}
        searchPlaceholder="Search graphs..."
        emptyText="No graphs found"
        title="Select graph"
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        desktopPlacement="bottom-start"
        renderOption={renderOption}
      />
    </>
  );
}

function GraphOptionItem({
  option,
  selected,
  active,
  onPress,
}: {
  option: ComboboxOption;
  selected: boolean;
  active: boolean;
  onPress: () => void;
}): ReactElement {
  const leadingSlot = useMemo(
    () => (
      <View style={styles.optionIconBox}>
        <Schema size={16} color={styles.chevron.color} />
      </View>
    ),
    [],
  );
  return (
    <ComboboxItem
      label={option.label}
      description={option.description}
      selected={selected}
      active={active}
      onPress={onPress}
      leadingSlot={leadingSlot}
    />
  );
}

// A project holds its checkout plus any worktrees; the run lands in exactly
// one of them. Nothing to narrow until a project is chosen.
function WorkspaceFieldSection({
  hasProject,
  targets,
  selectedTarget,
  onSelect,
}: {
  hasProject: boolean;
  targets: readonly OrchestrationWorkspaceTarget[];
  selectedTarget: OrchestrationWorkspaceTarget | null;
  onSelect: (target: OrchestrationWorkspaceTarget) => void;
}): ReactElement | null {
  if (!hasProject) {
    return null;
  }
  return (
    <View style={styles.field}>
      <Text style={styles.label}>Workspace</Text>
      <WorkspaceField targets={targets} selectedTarget={selectedTarget} onSelect={onSelect} />
    </View>
  );
}

function WorkspaceField({
  targets,
  selectedTarget,
  onSelect,
}: {
  targets: readonly OrchestrationWorkspaceTarget[];
  selectedTarget: OrchestrationWorkspaceTarget | null;
  onSelect: (target: OrchestrationWorkspaceTarget) => void;
}): ReactElement {
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);

  const options = useMemo<ComboboxOption[]>(
    () =>
      targets.map((target) => ({
        id: target.id,
        label: target.name,
        description: target.branch
          ? `${target.branch} - ${shortenPath(target.cwd)}`
          : shortenPath(target.cwd),
      })),
    [targets],
  );

  const handleSelect = useCallback(
    (id: string) => {
      const target = targets.find((candidate) => candidate.id === id);
      if (!target) {
        return;
      }
      onSelect(target);
      setOpen(false);
    },
    [onSelect, targets],
  );
  const handlePress = useCallback(() => setOpen((current) => !current), []);
  const triggerStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.selectTrigger,
      (Boolean(hovered) || pressed || open) && styles.selectTriggerActive,
    ],
    [open],
  );

  const displayValue = selectedTarget?.name ?? "Select workspace";
  const description = selectedTarget ? shortenPath(selectedTarget.cwd) : null;

  const renderOption = useCallback(
    ({
      option,
      selected,
      active,
      onPress,
    }: {
      option: ComboboxOption;
      selected: boolean;
      active: boolean;
      onPress: () => void;
    }) => (
      <WorkspaceOptionItem
        option={option}
        isProjectRoot={targets.find((target) => target.id === option.id)?.isProjectRoot ?? false}
        selected={selected}
        active={active}
        onPress={onPress}
      />
    ),
    [targets],
  );

  return (
    <>
      <View ref={anchorRef} collapsable={false}>
        <Pressable
          onPress={handlePress}
          style={triggerStyle}
          accessibilityRole="button"
          accessibilityLabel={`Select workspace (${displayValue})`}
          testID="orchestration-workspace-trigger"
        >
          <Text
            style={selectedTarget ? styles.selectTriggerText : styles.selectTriggerPlaceholder}
            numberOfLines={1}
          >
            {displayValue}
          </Text>
          <ChevronDown size={16} color={styles.chevron.color} />
        </Pressable>
      </View>
      {description ? <Text style={styles.hint}>{description}</Text> : null}
      <Combobox
        options={options}
        value={selectedTarget?.id ?? ""}
        onSelect={handleSelect}
        searchable={options.length > 6}
        searchPlaceholder="Search workspaces..."
        emptyText="No workspaces found"
        title="Select workspace"
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        desktopPlacement="bottom-start"
        renderOption={renderOption}
      />
    </>
  );
}

function WorkspaceOptionItem({
  option,
  isProjectRoot,
  selected,
  active,
  onPress,
}: {
  option: ComboboxOption;
  isProjectRoot: boolean;
  selected: boolean;
  active: boolean;
  onPress: () => void;
}): ReactElement {
  const leadingSlot = useMemo(
    () => (
      <View style={styles.optionIconBox}>
        {isProjectRoot ? (
          <Folder size={16} color={styles.chevron.color} />
        ) : (
          <GitBranch size={16} color={styles.chevron.color} />
        )}
      </View>
    ),
    [isProjectRoot],
  );
  return (
    <ComboboxItem
      label={option.label}
      description={option.description}
      selected={selected}
      active={active}
      onPress={onPress}
      leadingSlot={leadingSlot}
    />
  );
}

/** The project as a statement of fact — same row shape as the picker trigger,
 * minus the chevron and the press target, so edit mode reads as "this is where
 * it lives" instead of a control that refuses to do anything. */
function ReadOnlyProjectField({
  selectedTarget,
  fallbackCwd,
}: {
  selectedTarget: ScheduleProjectTarget | null;
  fallbackCwd: string;
}): ReactElement {
  const storedPath = fallbackCwd.trim();
  const displayValue = selectedTarget?.projectName ?? (storedPath ? shortenPath(storedPath) : "—");
  const description = selectedTarget
    ? `${selectedTarget.serverName} - ${shortenPath(selectedTarget.cwd)}`
    : null;
  return (
    <>
      <View style={styles.readOnlyValue} testID="orchestration-project-readonly">
        <Text style={styles.selectTriggerText} numberOfLines={1}>
          {displayValue}
        </Text>
      </View>
      {description ? <Text style={styles.hint}>{description}</Text> : null}
    </>
  );
}

function ProjectField({
  options,
  targetByOptionId,
  value,
  selectedTarget,
  fallbackCwd,
  onSelect,
}: {
  options: ComboboxOption[];
  targetByOptionId: Map<string, ScheduleProjectTarget>;
  value: string;
  selectedTarget: ScheduleProjectTarget | null;
  fallbackCwd: string;
  onSelect: (target: ScheduleProjectTarget) => void;
}): ReactElement {
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);

  const handleSelect = useCallback(
    (id: string) => {
      const target = targetByOptionId.get(id);
      if (!target) {
        return;
      }
      onSelect(target);
      setOpen(false);
    },
    [onSelect, targetByOptionId],
  );
  const handlePress = useCallback(() => setOpen((current) => !current), []);
  const triggerStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.selectTrigger,
      (Boolean(hovered) || pressed || open) && styles.selectTriggerActive,
    ],
    [open],
  );

  const storedPath = fallbackCwd.trim();
  const displayValue =
    selectedTarget?.projectName ?? (storedPath ? shortenPath(storedPath) : "Select project");
  const isPlaceholder = !selectedTarget && !storedPath;
  const description = selectedTarget
    ? `${selectedTarget.serverName} - ${shortenPath(selectedTarget.cwd)}`
    : null;

  const renderOption = useCallback(
    ({
      option,
      selected,
      active,
      onPress,
    }: {
      option: ComboboxOption;
      selected: boolean;
      active: boolean;
      onPress: () => void;
    }) => (
      <ProjectOptionItem option={option} selected={selected} active={active} onPress={onPress} />
    ),
    [],
  );

  return (
    <>
      <View ref={anchorRef} collapsable={false}>
        <Pressable
          onPress={handlePress}
          style={triggerStyle}
          accessibilityRole="button"
          accessibilityLabel={`Select project (${displayValue})`}
          testID="orchestration-project-trigger"
        >
          <Text
            style={isPlaceholder ? styles.selectTriggerPlaceholder : styles.selectTriggerText}
            numberOfLines={1}
          >
            {displayValue}
          </Text>
          <ChevronDown size={16} color={styles.chevron.color} />
        </Pressable>
      </View>
      {description ? <Text style={styles.hint}>{description}</Text> : null}
      <Combobox
        options={options}
        value={value}
        onSelect={handleSelect}
        searchable
        searchPlaceholder="Search projects..."
        emptyText="No projects found"
        title="Select project"
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        desktopPlacement="bottom-start"
        renderOption={renderOption}
      />
    </>
  );
}

// A personality already fixes its own effort, so the picker hides while one
// is selected — the whole point is not having to choose it.
function EffortFieldSection({
  personalitySelected,
  model,
  options,
  value,
  onSelect,
}: {
  personalitySelected: boolean;
  model: string;
  options: ThinkingOptions;
  value: string;
  onSelect: (thinkingOptionId: string) => void;
}): ReactElement | null {
  if (personalitySelected || !model || options.length === 0) {
    return null;
  }
  return (
    <View style={styles.field}>
      <Text style={styles.label}>Effort</Text>
      <ThinkingField options={options} value={value} onSelect={onSelect} />
    </View>
  );
}

function ThinkingField({
  options,
  value,
  onSelect,
}: {
  options: ThinkingOptions;
  value: string;
  onSelect: (thinkingOptionId: string) => void;
}): ReactElement {
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);

  const comboboxOptions = useMemo<ComboboxOption[]>(
    () =>
      options.map((option) => ({
        id: option.id,
        label: formatThinkingOptionLabel(option),
      })),
    [options],
  );

  const handleSelect = useCallback(
    (id: string) => {
      onSelect(id);
      setOpen(false);
    },
    [onSelect],
  );
  const handlePress = useCallback(() => setOpen((current) => !current), []);
  const triggerStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.selectTrigger,
      (Boolean(hovered) || pressed || open) && styles.selectTriggerActive,
    ],
    [open],
  );

  const selectedOption = options.find((option) => option.id === value);
  const selectedLabelSource = selectedOption ?? (value ? { id: value } : null);
  const displayValue = selectedLabelSource
    ? formatThinkingOptionLabel(selectedLabelSource)
    : "Select effort";
  const isPlaceholder = !selectedLabelSource;

  const renderOption = useCallback(
    ({
      option,
      selected,
      active,
      onPress,
    }: {
      option: ComboboxOption;
      selected: boolean;
      active: boolean;
      onPress: () => void;
    }) => (
      <ThinkingOptionItem option={option} selected={selected} active={active} onPress={onPress} />
    ),
    [],
  );

  return (
    <>
      <View ref={anchorRef} collapsable={false}>
        <Pressable
          onPress={handlePress}
          style={triggerStyle}
          accessibilityRole="button"
          accessibilityLabel={`Select effort (${displayValue})`}
          testID="orchestration-thinking-trigger"
        >
          <Text
            style={isPlaceholder ? styles.selectTriggerPlaceholder : styles.selectTriggerText}
            numberOfLines={1}
          >
            {displayValue}
          </Text>
          <ChevronDown size={16} color={styles.chevron.color} />
        </Pressable>
      </View>
      <Combobox
        options={comboboxOptions}
        value={value}
        onSelect={handleSelect}
        searchable={comboboxOptions.length > 6}
        searchPlaceholder="Search effort options..."
        emptyText="No effort options found"
        title="Select effort"
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        desktopPlacement="bottom-start"
        renderOption={renderOption}
      />
    </>
  );
}

function ThinkingOptionItem({
  option,
  selected,
  active,
  onPress,
}: {
  option: ComboboxOption;
  selected: boolean;
  active: boolean;
  onPress: () => void;
}): ReactElement {
  const leadingSlot = useMemo(
    () => (
      <View style={styles.optionIconBox}>
        <Brain size={16} color={styles.chevron.color} />
      </View>
    ),
    [],
  );
  return (
    <ComboboxItem
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
}: {
  option: ComboboxOption;
  selected: boolean;
  active: boolean;
  onPress: () => void;
}): ReactElement {
  const leadingSlot = useMemo(
    () => (
      <View style={styles.optionIconBox}>
        <Folder size={16} color={styles.chevron.color} />
      </View>
    ),
    [],
  );
  return (
    <ComboboxItem
      label={option.label}
      description={option.description}
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

function ModelTrigger({
  label,
  provider,
  hasPersonality,
  personalitySpinner,
  roleIcon: RoleIcon,
  disabled,
  active,
  isPlaceholder,
}: {
  label: string;
  provider: string | null;
  hasPersonality: boolean;
  personalitySpinner?: { glowA: string; glowB: string };
  roleIcon?: SelectorPersonality["roleIcon"];
  disabled: boolean;
  active: boolean;
  isPlaceholder: boolean;
}): ReactElement {
  const containerStyle = useMemo(
    () => [
      styles.selectTrigger,
      active && styles.selectTriggerActive,
      disabled && styles.selectTriggerDisabled,
    ],
    [active, disabled],
  );
  // A role-slot entry (Team's Orchestrator) wears its neutral role glyph, not
  // the current holder's colored provider icon; a concrete personality keeps
  // its colored glyph; otherwise the plain provider glyph.
  let leadingIcon: ReactElement | null;
  if (RoleIcon) {
    leadingIcon = <RoleIcon size={16} color={styles.providerIcon.color} />;
  } else if (hasPersonality && provider) {
    leadingIcon = (
      <PersonalityProviderIcon
        provider={provider}
        size={16}
        glowA={personalitySpinner?.glowA}
        glowB={personalitySpinner?.glowB}
      />
    );
  } else {
    leadingIcon = <ProviderGlyph provider={provider} />;
  }
  return (
    <View pointerEvents="none" style={containerStyle} testID="orchestration-model-trigger">
      {leadingIcon}
      <Text
        style={isPlaceholder ? styles.selectTriggerPlaceholder : styles.selectTriggerText}
        numberOfLines={1}
      >
        {label}
      </Text>
      <ChevronDown size={16} color={styles.chevron.color} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  field: {
    gap: theme.spacing[2],
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  input: {
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    color: theme.colors.foreground,
    borderWidth: 1,
    borderColor: theme.colors.border,
    fontSize: theme.fontSize.base,
  },
  multilineInput: {
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    color: theme.colors.foreground,
    borderWidth: 1,
    borderColor: theme.colors.border,
    fontSize: theme.fontSize.base,
    minHeight: 96,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  error: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.xs,
  },
  inlineButton: {
    alignSelf: "flex-start",
  },
  selectTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    minHeight: 44,
  },
  selectTriggerActive: {
    borderColor: theme.colors.borderAccent,
  },
  // The picker row minus its affordances: no chevron, no hover/active border,
  // no press target — a value the form states rather than asks for.
  readOnlyValue: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    minHeight: 44,
  },
  selectTriggerDisabled: {
    opacity: theme.opacity[50],
  },
  selectTriggerText: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  selectTriggerPlaceholder: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
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
  providerIcon: {
    color: theme.colors.foregroundMuted,
  },
  chevron: {
    color: theme.colors.foregroundMuted,
  },
}));
