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
import { ChevronDown, Folder } from "@/components/icons/material-icons";
import { StyleSheet } from "react-native-unistyles";
import type { ArtifactMetadata } from "@otto-code/protocol/artifacts/types";
import {
  AdaptiveModalSheet,
  AdaptiveTextInput,
  type SheetHeader,
} from "@/components/adaptive-modal-sheet";
import { Combobox, ComboboxItem, type ComboboxOption } from "@/components/ui/combobox";
import { Button } from "@/components/ui/button";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import { getProviderIcon } from "@/components/provider-icons";
import { useAgentFormState, type FormInitialValues } from "@/hooks/use-agent-form-state";
import { useProjects } from "@/hooks/use-projects";
import { useArtifactMutations } from "@/artifacts/use-artifact-mutations";
import {
  buildScheduleProjectTargets,
  type ScheduleProjectTarget,
} from "@/schedules/schedule-project-targets";
import { shortenPath } from "@/utils/shorten-path";
import { normalizeWorkspacePath } from "@/utils/workspace-identity";
import { toErrorMessage } from "@/utils/error-messages";
import type { ProjectSummary } from "@/utils/projects";

/** The existing artifact being edited, when the sheet is in "edit" mode. */
export interface ArtifactEditTarget {
  id: string;
  serverId: string;
  projectId: string;
  name: string;
  description: string;
  provider: string | null;
  model: string | null;
}

export interface ArtifactCreateSheetProps {
  visible: boolean;
  onClose: () => void;
  /** "create" (default) starts blank; "edit" prefills from `artifact` and, on
   * save, regenerates the existing artifact instead of creating a new one. */
  mode?: "create" | "edit";
  /** The artifact to edit. Required when `mode` is "edit". */
  artifact?: ArtifactEditTarget;
  /** Preselect a host + project (e.g. opened from a workspace). */
  initialServerId?: string;
  initialProjectCwd?: string;
  /** Fired with the created/regenerated (generating) artifact so callers can auto-open it. */
  onCreated?: (input: { serverId: string; artifact: ArtifactMetadata }) => void;
}

interface ArtifactProjectOptions {
  targets: ScheduleProjectTarget[];
  options: ComboboxOption[];
  targetByOptionId: Map<string, ScheduleProjectTarget>;
}

function buildArtifactProjectOptions(projects: readonly ProjectSummary[]): ArtifactProjectOptions {
  const targets = buildScheduleProjectTargets(projects);
  const targetByOptionId = new Map(targets.map((target) => [target.optionId, target]));
  const options: ComboboxOption[] = targets.map((target) => ({
    id: target.optionId,
    label: target.projectName,
    description: `${target.serverName} - ${shortenPath(target.cwd)}`,
  }));
  return { targets, options, targetByOptionId };
}

function resolveSelectedTarget(input: {
  targets: readonly ScheduleProjectTarget[];
  serverId: string | null;
  cwd: string;
}): ScheduleProjectTarget | null {
  const cwd = normalizeWorkspacePath(input.cwd);
  if (!input.serverId || !cwd) {
    return null;
  }
  return (
    input.targets.find(
      (target) => target.serverId === input.serverId && normalizeWorkspacePath(target.cwd) === cwd,
    ) ?? null
  );
}

/**
 * Map an arbitrary workspace directory to the project it belongs to. Project
 * targets are keyed by repo root, but a workspace cwd may be a worktree path
 * under it (and carries OS-native separators), so match by normalized path
 * containment and prefer the longest (most specific) repo-root match.
 */
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

function buildArtifactFormInitialValues(input: {
  cwd: string;
  isEdit: boolean;
  provider: string | null | undefined;
  model: string | null | undefined;
}): FormInitialValues | undefined {
  const values: FormInitialValues = {};
  if (input.cwd) {
    values.workingDir = input.cwd;
  }
  if (input.isEdit && input.provider) {
    values.provider = input.provider as FormInitialValues["provider"];
    values.model = input.model ?? undefined;
  }
  return Object.keys(values).length > 0 ? values : undefined;
}

function resolveFormSeed(input: {
  isEdit: boolean;
  artifact: ArtifactEditTarget | undefined;
  initialServerId: string | undefined;
  initialProjectCwd: string | undefined;
}): { seedServerId: string | undefined; seedProjectCwd: string | undefined } {
  if (input.isEdit && input.artifact) {
    return { seedServerId: input.artifact.serverId, seedProjectCwd: input.artifact.projectId };
  }
  return { seedServerId: input.initialServerId, seedProjectCwd: input.initialProjectCwd };
}

function resolveInitialSelection(input: {
  target: ScheduleProjectTarget | null;
  seedServerId: string | undefined;
  seedProjectCwd: string | undefined;
}): { serverId: string | null; cwd: string } {
  return {
    serverId: input.target?.serverId ?? input.seedServerId ?? null,
    cwd: input.target?.cwd ?? input.seedProjectCwd ?? "",
  };
}

function resolveMutationServerId(input: {
  selectedTarget: ScheduleProjectTarget | null;
  selectedServerId: string | null;
  initialServerId: string | undefined;
}): string {
  return input.selectedTarget?.serverId ?? input.selectedServerId ?? input.initialServerId ?? "";
}

async function submitArtifactForm(input: {
  isEdit: boolean;
  editTarget: ArtifactEditTarget | undefined;
  createServerId: string;
  name: string;
  description: string;
  projectId: string;
  provider: string;
  model: string;
  modeId: string;
  thinkingOptionId: string;
  createArtifact: ReturnType<typeof useArtifactMutations>["createArtifact"];
  updateArtifact: ReturnType<typeof useArtifactMutations>["updateArtifact"];
}): Promise<{ serverId: string; artifact: ArtifactMetadata }> {
  // Editing only saves metadata — it never regenerates. The user re-runs
  // generation separately once they're happy with the changes.
  if (input.isEdit && input.editTarget) {
    const artifact = await input.updateArtifact({
      serverId: input.editTarget.serverId,
      artifactId: input.editTarget.id,
      updates: {
        name: input.name,
        description: input.description,
        projectId: input.projectId,
        provider: input.provider,
        model: input.model || undefined,
      },
    });
    return { serverId: input.editTarget.serverId, artifact };
  }
  const artifact = await input.createArtifact({
    serverId: input.createServerId,
    input: {
      name: input.name,
      description: input.description,
      projectId: input.projectId,
      provider: input.provider,
      model: input.model || undefined,
      modeId: input.modeId || undefined,
      thinkingOptionId: input.thinkingOptionId || undefined,
    },
  });
  return { serverId: input.createServerId, artifact };
}

function canSubmitArtifactForm(input: {
  nameTrimmed: string;
  descriptionTrimmed: string;
  hasProvider: boolean;
  hasProject: boolean;
  isCreating: boolean;
}): boolean {
  if (input.isCreating || !input.hasProvider || !input.hasProject) {
    return false;
  }
  return input.nameTrimmed.length > 0 && input.descriptionTrimmed.length > 0;
}

export function ArtifactCreateSheet({
  visible,
  onClose,
  mode = "create",
  artifact,
  initialServerId,
  initialProjectCwd,
  onCreated,
}: ArtifactCreateSheetProps): ReactElement {
  const isEdit = mode === "edit" && artifact !== undefined;
  const { projects } = useProjects();
  const projectOptions = useMemo(() => buildArtifactProjectOptions(projects), [projects]);
  const onlineServerIds = useMemo(
    () => Array.from(new Set(projectOptions.targets.map((target) => target.serverId))),
    [projectOptions.targets],
  );

  // In edit mode the host + project come from the artifact itself; otherwise
  // from the workspace we were opened from (if any).
  const { seedServerId, seedProjectCwd } = resolveFormSeed({
    isEdit,
    artifact,
    initialServerId,
    initialProjectCwd,
  });

  // Resolve the seed cwd to a known project target so the picker shows the
  // project name (and stores a canonical repo-root projectId) instead of the
  // raw, OS-native worktree path.
  const initialTarget = useMemo(
    () =>
      seedProjectCwd
        ? resolveProjectTargetForCwd({
            targets: projectOptions.targets,
            serverId: seedServerId,
            cwd: seedProjectCwd,
          })
        : null,
    [projectOptions.targets, seedServerId, seedProjectCwd],
  );
  const { serverId: resolvedInitialServerId, cwd: resolvedInitialCwd } = resolveInitialSelection({
    target: initialTarget,
    seedServerId,
    seedProjectCwd,
  });

  const initialFormValues = useMemo<FormInitialValues | undefined>(
    () =>
      buildArtifactFormInitialValues({
        cwd: resolvedInitialCwd,
        isEdit,
        provider: artifact?.provider,
        model: artifact?.model,
      }),
    [resolvedInitialCwd, isEdit, artifact?.provider, artifact?.model],
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
    selectedMode,
    selectedThinkingOptionId,
    workingDir,
    setProviderAndModelFromUser,
    clearProviderSelectionFromUser,
    setModeFromUser,
    setSelectedServerId,
    setSelectedServerIdFromUser,
    setWorkingDir,
    setWorkingDirFromUser,
    modeOptions,
    modelSelectorProviders,
    isAllModelsLoading,
    persistFormPreferences,
  } = form;

  const selectedTarget = useMemo(
    () =>
      resolveSelectedTarget({
        targets: projectOptions.targets,
        serverId: selectedServerId,
        cwd: workingDir,
      }),
    [projectOptions.targets, selectedServerId, workingDir],
  );
  const selectedProjectOptionId = selectedTarget?.optionId ?? "";
  const mutationServerId = resolveMutationServerId({
    selectedTarget,
    selectedServerId,
    initialServerId,
  });

  const handleSelectProject = useCallback(
    (target: ScheduleProjectTarget) => {
      if (selectedServerId && selectedServerId !== target.serverId) {
        clearProviderSelectionFromUser();
      }
      setSelectedServerIdFromUser(target.serverId);
      setWorkingDirFromUser(target.cwd);
    },
    [
      clearProviderSelectionFromUser,
      selectedServerId,
      setSelectedServerIdFromUser,
      setWorkingDirFromUser,
    ],
  );

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
        label={selectedModelLabel}
        provider={selectedProvider}
        disabled={disabled}
        active={hovered || pressed || isOpen}
        isPlaceholder={!selectedModel}
      />
    ),
    [selectedModel, selectedProvider],
  );

  const { createArtifact, updateArtifact, isCreating, isUpdating } = useArtifactMutations();
  const isSubmitting = isCreating || isUpdating;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldResetKey, setFieldResetKey] = useState(0);

  const initialName = isEdit ? artifact.name : "";
  const initialDescription = isEdit ? artifact.description : "";

  const wasVisibleRef = useRef(false);
  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      setName(initialName);
      setDescription(initialDescription);
      setSubmitError(null);
      setFieldResetKey((key) => key + 1);
      setSelectedServerId(resolvedInitialServerId);
      setWorkingDir(resolvedInitialCwd);
    }
    wasVisibleRef.current = visible;
  }, [
    visible,
    initialName,
    initialDescription,
    resolvedInitialServerId,
    resolvedInitialCwd,
    setSelectedServerId,
    setWorkingDir,
  ]);

  const nameTrimmed = name.trim();
  const descriptionTrimmed = description.trim();
  const trimmedWorkingDir = workingDir.trim();
  const canSubmit = canSubmitArtifactForm({
    nameTrimmed,
    descriptionTrimmed,
    hasProvider: Boolean(selectedProvider),
    hasProject: Boolean(selectedTarget),
    isCreating: isSubmitting,
  });

  const handleSubmit = useCallback(async () => {
    if (!nameTrimmed || !descriptionTrimmed || !selectedProvider || !trimmedWorkingDir) {
      return;
    }
    setSubmitError(null);
    try {
      await persistFormPreferences();
      const result = await submitArtifactForm({
        isEdit,
        editTarget: artifact,
        createServerId: mutationServerId,
        name: nameTrimmed,
        description: descriptionTrimmed,
        projectId: trimmedWorkingDir,
        provider: selectedProvider,
        model: selectedModel,
        modeId: selectedMode,
        thinkingOptionId: selectedThinkingOptionId,
        createArtifact,
        updateArtifact,
      });
      onCreated?.(result);
      onClose();
    } catch (error) {
      setSubmitError(toErrorMessage(error));
    }
  }, [
    artifact,
    createArtifact,
    descriptionTrimmed,
    isEdit,
    mutationServerId,
    nameTrimmed,
    onClose,
    onCreated,
    persistFormPreferences,
    updateArtifact,
    selectedMode,
    selectedModel,
    selectedProvider,
    selectedThinkingOptionId,
    trimmedWorkingDir,
  ]);

  const handleSubmitPress = useCallback(() => {
    void handleSubmit();
  }, [handleSubmit]);

  const header = useMemo<SheetHeader>(
    () => ({ title: isEdit ? "Edit artifact" : "New artifact" }),
    [isEdit],
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
          testID="artifact-form-submit"
        >
          {isEdit ? "Save" : "Create artifact"}
        </Button>
      </View>
    ),
    [canSubmit, handleSubmitPress, isEdit, isSubmitting, onClose],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      footer={footer}
      webScrollbar
      testID="artifact-create-sheet"
    >
      <View style={styles.field}>
        <Text style={styles.label}>Name</Text>
        <AdaptiveTextInput
          testID="artifact-name-input"
          accessibilityLabel="Artifact name"
          initialValue={name}
          resetKey={`artifact-name-${fieldResetKey}`}
          value={name}
          onChangeText={setName}
          placeholder="Dashboard prototype"
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Description</Text>
        <AdaptiveTextInput
          testID="artifact-description-input"
          accessibilityLabel="Description"
          initialValue={description}
          resetKey={`artifact-description-${fieldResetKey}`}
          value={description}
          onChangeText={setDescription}
          placeholder="Describe the HTML artifact you want generated"
          style={styles.multilineInput}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Project</Text>
        <ProjectField
          options={projectOptions.options}
          targetByOptionId={projectOptions.targetByOptionId}
          value={selectedProjectOptionId}
          selectedTarget={selectedTarget}
          fallbackCwd={workingDir}
          onSelect={handleSelectProject}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Model</Text>
        <CombinedModelSelector
          providers={modelSelectorProviders}
          selectedProvider={selectedProvider ?? ""}
          selectedModel={selectedModel}
          onSelect={setProviderAndModelFromUser}
          isLoading={isAllModelsLoading}
          renderTrigger={renderModelTrigger}
          triggerFill
          serverId={mutationServerId}
        />
      </View>

      {modeOptions.length > 0 ? (
        <ModeField options={modeOptions} selectedMode={selectedMode} onSelect={setModeFromUser} />
      ) : null}

      {submitError ? <Text style={styles.error}>{submitError}</Text> : null}
    </AdaptiveModalSheet>
  );
}

function ModeField({
  options,
  selectedMode,
  onSelect,
}: {
  options: { id: string; label: string }[];
  selectedMode: string;
  onSelect: (modeId: string) => void;
}): ReactElement {
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);

  const comboboxOptions = useMemo<ComboboxOption[]>(
    () => options.map((option) => ({ id: option.id, label: option.label })),
    [options],
  );
  const selectedLabel =
    options.find((option) => option.id === selectedMode)?.label ?? "Default mode";

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

  return (
    <View style={styles.field}>
      <Text style={styles.label}>Mode</Text>
      <View ref={anchorRef} collapsable={false}>
        <Pressable
          onPress={handlePress}
          style={triggerStyle}
          accessibilityRole="button"
          accessibilityLabel={`Select mode (${selectedLabel})`}
          testID="artifact-mode-trigger"
        >
          <Text style={styles.selectTriggerText} numberOfLines={1}>
            {selectedLabel}
          </Text>
          <ChevronDown size={16} color={styles.chevron.color} />
        </Pressable>
      </View>
      <Combobox
        options={comboboxOptions}
        value={selectedMode}
        onSelect={handleSelect}
        searchable={comboboxOptions.length > 6}
        title="Select mode"
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        desktopPlacement="bottom-start"
      />
    </View>
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
          testID="artifact-project-trigger"
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
  disabled,
  active,
  isPlaceholder,
}: {
  label: string;
  provider: string | null;
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
  return (
    <View pointerEvents="none" style={containerStyle} testID="artifact-model-trigger">
      <ProviderGlyph provider={provider} />
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
