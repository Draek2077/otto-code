import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { AgentProviderDefinition } from "@otto-code/protocol/provider-manifest";
import type {
  AgentMode,
  AgentModelDefinition,
  AgentProvider,
  ProviderSnapshotEntry,
} from "@otto-code/protocol/agent-types";
import { buildProviderDefinitions } from "@/utils/provider-definitions";
import { filterModesForModel, findModelDefinition } from "@/provider-selection/mode-support";
import { filterSelectableModels } from "@/provider-selection/model-catalog";
import { OptimisticFormPreferences } from "@/create-agent-preferences/optimistic-preferences";
import { applyAgentProfilePreferences } from "@/create-agent-preferences/preferences";
import type { MaterializedAgentProfile } from "@/agent-profiles";
import {
  buildSelectableProviderSelectorProviders,
  type ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";
import { useProvidersSnapshot } from "./use-providers-snapshot";
import {
  useFormPreferences,
  mergeProviderPreferences,
  type FormPreferences,
} from "./use-form-preferences";
import {
  resolveAgentForm,
  resolveEffectiveModel,
  normalizeSelectedModelId,
  resolveDefaultModelId,
  mergeSelectedComposerPreferences,
  buildProviderDefinitionMap,
  buildProviderDefinitionMapForStatuses,
  INITIAL_AGENT_FORM_RESOLUTION,
  INITIAL_USER_MODIFIED,
  RESOLVABLE_PROVIDER_STATUSES,
  SELECTABLE_PROVIDER_STATUSES,
  type FormInitialValues,
  type FormState,
  type ProviderModelsByProvider,
} from "@/provider-selection/resolve-agent-form";

export type { FormInitialValues } from "@/provider-selection/resolve-agent-form";

export interface UseAgentFormStateOptions {
  serverId: string | null;
  workingDir: string;
  /** Canonical profile id inherited by a forked draft. */
  initialAgentProfileId?: string | null;
  initialValues?: FormInitialValues;
  isVisible?: boolean;
  isCreateFlow?: boolean;
}

export interface UseAgentFormStateResult {
  selectedAgentProfileId: string | null;
  selectedAgentProfile: MaterializedAgentProfile | null;
  selectedServerId: string | null;
  selectedProvider: AgentProvider | null;
  setProviderFromUser: (provider: AgentProvider) => void;
  selectedMode: string;
  setModeFromUser: (modeId: string) => void;
  selectedModel: string;
  setModelFromUser: (modelId: string) => void;
  selectedThinkingOptionId: string;
  setThinkingOptionFromUser: (thinkingOptionId: string) => void;
  workingDir: string;
  providerDefinitions: AgentProviderDefinition[];
  providerDefinitionMap: Map<AgentProvider, AgentProviderDefinition>;
  agentDefinition?: AgentProviderDefinition;
  allProviderEntries?: ProviderSnapshotEntry[];
  modeOptions: AgentMode[];
  availableModels: AgentModelDefinition[];
  allProviderModels: Map<string, AgentModelDefinition[]>;
  modelSelectorProviders: ProviderSelectorProvider[];
  isAllModelsLoading: boolean;
  isProviderModelsRefreshing: boolean;
  availableThinkingOptions: NonNullable<AgentModelDefinition["thinkingOptions"]>;
  isModelLoading: boolean;
  modelError: string | null;
  refreshProviderModels: (provider?: AgentProvider) => void;
  refetchProviderModelsIfStale: () => void;
  setProviderAndModelFromUser: (provider: AgentProvider, modelId: string) => void;
  applyProfileFromUser: (profile: MaterializedAgentProfile) => void;
  /**
   * Apply a personality's (or the active team's holder's) resolved values. Same
   * form effect as picking the provider/model/mode/effort by hand, minus the
   * persistence: a personality outranks the last-used-model preference, so
   * writing itself into that preference would erase the very tier it is
   * supposed to beat - and then read back as the user's own last choice on the
   * next open. Only a real user pick may write there.
   */
  applyPersonalityValues: (values: {
    provider: string;
    model: string;
    /** Omit on unattended surfaces (artifacts) - they have no mode field. */
    modeId?: string;
    thinkingOptionId: string;
  }) => void;
  clearProviderSelectionFromUser: () => void;
  workingDirIsEmpty: boolean;
  persistFormPreferences: () => Promise<void>;
}

function normalizeAgentProfileId(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function resolveAgentProfileSelection(profile: MaterializedAgentProfile): {
  id: string | null;
  profile: MaterializedAgentProfile | null;
} {
  const id = normalizeAgentProfileId(profile.id);
  return id ? { id, profile } : { id: null, profile: null };
}

function resolveProviderModeIds(
  provider: AgentProvider | null,
  definitions: Map<AgentProvider, AgentProviderDefinition>,
): string[] {
  if (!provider) return [];
  return definitions.get(provider)?.modes.map((mode) => mode.id) ?? [];
}

function resolveAgentDefinition(
  provider: AgentProvider | null,
  definitions: Map<AgentProvider, AgentProviderDefinition>,
): AgentProviderDefinition | undefined {
  return provider ? definitions.get(provider) : undefined;
}

function resolveSelectedProviderModes(input: {
  selectedEntry: ProviderSnapshotEntry | null;
  provider: AgentProvider | null;
  providerDefinitionMap: Map<AgentProvider, AgentProviderDefinition>;
}): AgentMode[] {
  const { selectedEntry, provider, providerDefinitionMap } = input;
  if (selectedEntry?.modes) {
    return selectedEntry.modes;
  }
  if (provider) {
    return providerDefinitionMap.get(provider)?.modes ?? [];
  }
  return [];
}

function buildAllProviderModels(
  snapshotEntries: ProviderSnapshotEntry[] | undefined,
): Map<string, AgentModelDefinition[]> {
  const map = new Map<string, AgentModelDefinition[]>();
  for (const entry of snapshotEntries ?? []) {
    map.set(entry.provider, filterSelectableModels(entry.models ?? null) ?? []);
  }
  return map;
}

function buildProviderModelsByProvider(
  snapshotEntries: ProviderSnapshotEntry[] | undefined,
): ProviderModelsByProvider {
  const map: ProviderModelsByProvider = new Map();
  for (const entry of snapshotEntries ?? []) {
    map.set(
      entry.provider,
      entry.status === "ready" ? filterSelectableModels(entry.models ?? null) : null,
    );
  }
  return map;
}

async function persistProviderPreferences(input: {
  provider: AgentProvider;
  formState: FormState;
  availableModels: AgentModelDefinition[] | null;
  updatePreferences: (
    updates: Partial<FormPreferences> | ((current: FormPreferences) => FormPreferences),
  ) => Promise<FormPreferences>;
}): Promise<void> {
  const { provider, formState, availableModels, updatePreferences } = input;
  const resolvedModel = resolveEffectiveModel(availableModels, formState.model);
  const modelId = resolvedModel?.id ?? formState.model;
  await updatePreferences((current) =>
    mergeProviderPreferences({
      preferences: current,
      provider,
      updates: {
        model: modelId || undefined,
        mode: formState.modeId || undefined,
        ...(modelId && formState.thinkingOptionId
          ? { thinkingByModel: { [modelId]: formState.thinkingOptionId } }
          : {}),
      },
    }),
  );
}

export function useAgentFormState(options: UseAgentFormStateOptions): UseAgentFormStateResult {
  const {
    serverId,
    initialAgentProfileId = null,
    initialValues,
    workingDir,
    isVisible = true,
    isCreateFlow = true,
  } = options;

  const [selectedAgentProfileId, setSelectedAgentProfileId] = useState<string | null>(
    normalizeAgentProfileId(initialAgentProfileId),
  );
  const [selectedAgentProfile, setSelectedAgentProfile] = useState<MaterializedAgentProfile | null>(
    null,
  );

  const clearAgentProfileSelection = useCallback(() => {
    setSelectedAgentProfileId(null);
    setSelectedAgentProfile(null);
  }, []);

  const { preferences, isLoading: isPreferencesLoading, updatePreferences } = useFormPreferences();
  const preferenceOverlayRef = useRef(new OptimisticFormPreferences(preferences));

  useEffect(() => {
    preferenceOverlayRef.current.reconcile(preferences);
  }, [preferences]);

  const updateCurrentPreferences = useCallback(
    async (
      updates: Partial<FormPreferences> | ((current: FormPreferences) => FormPreferences),
    ): Promise<FormPreferences> => {
      const pendingId = preferenceOverlayRef.current.begin(updates);
      try {
        const persisted = await updatePreferences(updates);
        preferenceOverlayRef.current.commit(pendingId, persisted);
        return persisted;
      } catch (error) {
        preferenceOverlayRef.current.reject(pendingId);
        throw error;
      }
    },
    [updatePreferences],
  );

  const [reducerState, dispatch] = useReducer(resolveAgentForm, {
    form: { provider: null, modeId: "", model: "", thinkingOptionId: "" },
    userModified: INITIAL_USER_MODIFIED,
    resolution: INITIAL_AGENT_FORM_RESOLUTION,
  });
  const { form: formState, resolution } = reducerState;
  // True while the form's model/mode/effort came from a personality or the
  // active team rather than from the user. Gates every preference write for the
  // same reason applyPersonalityValues doesn't persist - see there.
  const appliedFromPersonalityRef = useRef(false);

  const reducerStateRef = useRef(reducerState);
  useEffect(() => {
    reducerStateRef.current = reducerState;
  }, [reducerState]);

  useEffect(() => {
    if (!isVisible) appliedFromPersonalityRef.current = false;
  }, [isVisible]);

  const {
    entries: snapshotEntries,
    isLoading: snapshotIsLoading,
    isRefreshing: snapshotIsRefreshing,
    error: snapshotError,
    refresh: refreshSnapshot,
    refetchIfStale: refetchSnapshotIfStale,
  } = useProvidersSnapshot(serverId, { cwd: workingDir });

  const allProviderEntries = useMemo(() => snapshotEntries ?? [], [snapshotEntries]);
  const snapshotProviderDefinitions = useMemo(
    () => buildProviderDefinitions(snapshotEntries),
    [snapshotEntries],
  );
  const snapshotProviderDefinitionMap = useMemo(
    () => buildProviderDefinitionMap(snapshotProviderDefinitions),
    [snapshotProviderDefinitions],
  );
  const snapshotResolvableProviderDefinitionMap = useMemo(
    () =>
      buildProviderDefinitionMapForStatuses({
        snapshotEntries,
        providerDefinitions: snapshotProviderDefinitions,
        statuses: RESOLVABLE_PROVIDER_STATUSES,
      }),
    [snapshotEntries, snapshotProviderDefinitions],
  );
  const snapshotSelectableProviderDefinitionMap = useMemo(() => {
    return buildProviderDefinitionMapForStatuses({
      snapshotEntries,
      providerDefinitions: snapshotProviderDefinitions,
      statuses: SELECTABLE_PROVIDER_STATUSES,
    });
  }, [snapshotEntries, snapshotProviderDefinitions]);
  const snapshotAllProviderModels = useMemo(
    () => buildAllProviderModels(snapshotEntries),
    [snapshotEntries],
  );
  const snapshotProviderModelsByProvider = useMemo(
    () => buildProviderModelsByProvider(snapshotEntries),
    [snapshotEntries],
  );
  const snapshotModelSelectorProviders = useMemo(
    () => buildSelectableProviderSelectorProviders(snapshotEntries),
    [snapshotEntries],
  );
  const snapshotSelectedEntry = useMemo(
    () =>
      formState.provider
        ? ((snapshotEntries ?? []).find((entry) => entry.provider === formState.provider) ?? null)
        : null,
    [formState.provider, snapshotEntries],
  );
  const snapshotSelectedProviderModels = filterSelectableModels(
    snapshotSelectedEntry?.models ?? null,
  );
  const selectedProviderIsLoading = snapshotSelectedEntry?.status === "loading";
  const snapshotSelectedProviderModes = resolveSelectedProviderModes({
    selectedEntry: snapshotSelectedEntry,
    provider: formState.provider,
    providerDefinitionMap: snapshotProviderDefinitionMap,
  });
  const providerDefinitions = snapshotProviderDefinitions;
  const providerDefinitionMap = snapshotProviderDefinitionMap;
  const selectableProviderDefinitionMap = snapshotSelectableProviderDefinitionMap;
  const allProviderModels = snapshotAllProviderModels;
  const modelSelectorProviders = snapshotModelSelectorProviders;
  const availableModels = snapshotSelectedProviderModels;
  // Modes are per-provider, but Auto support is per-model (daemon-stamped
  // supportsAutoMode: false, e.g. Claude Auto on Haiku) - intersect the two.
  const modeOptions = filterModesForModel(
    snapshotSelectedProviderModes,
    findModelDefinition(snapshotSelectedProviderModels, formState.model),
  );
  const isModelSelectionLoading =
    resolution.status === "pending" || snapshotIsLoading || selectedProviderIsLoading;
  const isAllModelsLoading = isModelSelectionLoading;

  useEffect(() => {
    dispatch({
      type: "INPUTS_CHANGED",
      serverId,
      isVisible,
      isCreateFlow,
      isPreferencesLoading,
      hasSnapshot: snapshotEntries !== undefined,
      initialValues,
      preferences,
      providerModelsByProvider: snapshotProviderModelsByProvider,
      allowedProviderMap: snapshotResolvableProviderDefinitionMap,
    });
  }, [
    serverId,
    isVisible,
    isCreateFlow,
    isPreferencesLoading,
    snapshotEntries,
    initialValues,
    preferences,
    snapshotProviderModelsByProvider,
    snapshotResolvableProviderDefinitionMap,
  ]);

  const setProviderFromUser = useCallback(
    (provider: AgentProvider) => {
      if (!selectableProviderDefinitionMap.has(provider)) {
        return;
      }
      const providerModels = allProviderModels.get(provider) ?? null;
      const providerDef = selectableProviderDefinitionMap.get(provider);
      const providerPrefs = preferenceOverlayRef.current.current().providerPreferences?.[provider];

      appliedFromPersonalityRef.current = false;
      clearAgentProfileSelection();
      dispatch({
        type: "SET_PROVIDER_FROM_USER",
        provider,
        providerModels,
        providerDef,
        providerPrefs,
      });
      void updateCurrentPreferences({ provider });
    },
    [
      allProviderModels,
      clearAgentProfileSelection,
      selectableProviderDefinitionMap,
      updateCurrentPreferences,
    ],
  );

  const setProviderAndModelFromUser = useCallback(
    (provider: AgentProvider, modelId: string) => {
      if (!selectableProviderDefinitionMap.has(provider)) {
        return;
      }
      const providerDef = selectableProviderDefinitionMap.get(provider);
      const providerModels = allProviderModels.get(provider) ?? null;
      const providerPrefs = preferenceOverlayRef.current.current().providerPreferences?.[provider];
      const normalizedModelId = normalizeSelectedModelId(modelId);
      const nextModelId = normalizedModelId || resolveDefaultModelId(providerModels);

      appliedFromPersonalityRef.current = false;
      clearAgentProfileSelection();
      dispatch({
        type: "SET_PROVIDER_AND_MODEL_FROM_USER",
        provider,
        modelId,
        providerDef,
        providerModels,
        providerPrefs,
      });
      void updateCurrentPreferences((current) =>
        mergeSelectedComposerPreferences({
          preferences: current,
          provider,
          updates: {
            model: nextModelId || undefined,
          },
        }),
      );
    },
    [
      allProviderModels,
      clearAgentProfileSelection,
      selectableProviderDefinitionMap,
      updateCurrentPreferences,
    ],
  );

  const applyPersonalityValues = useCallback(
    (values: { provider: string; model: string; modeId?: string; thinkingOptionId: string }) => {
      const provider = values.provider as AgentProvider;
      if (!selectableProviderDefinitionMap.has(provider)) {
        return;
      }
      appliedFromPersonalityRef.current = true;
      clearAgentProfileSelection();
      dispatch({
        type: "SET_PROVIDER_AND_MODEL_FROM_USER",
        provider,
        modelId: values.model,
        providerDef: selectableProviderDefinitionMap.get(provider),
        providerModels: allProviderModels.get(provider) ?? null,
        providerPrefs: preferenceOverlayRef.current.current().providerPreferences?.[provider],
      });
      if (values.modeId !== undefined) {
        dispatch({ type: "SET_MODE_FROM_USER", modeId: values.modeId });
      }
      dispatch({
        type: "SET_THINKING_OPTION_FROM_USER",
        thinkingOptionId: values.thinkingOptionId,
      });
    },
    [allProviderModels, clearAgentProfileSelection, selectableProviderDefinitionMap],
  );

  const applyProfileFromUser = useCallback(
    (profile: MaterializedAgentProfile) => {
      const provider = profile.provider as AgentProvider;
      if (!selectableProviderDefinitionMap.has(provider)) {
        return;
      }
      appliedFromPersonalityRef.current = false;
      const previousProvider = reducerStateRef.current.form.provider;
      const action = {
        type: "APPLY_PROFILE_FROM_USER" as const,
        provider,
        modelId: profile.modelId,
        modeId: profile.modeId,
        thinkingOptionId: profile.thinkingOptionId,
        providerDef: selectableProviderDefinitionMap.get(provider),
        providerModels: allProviderModels.get(provider) ?? null,
        providerPrefs: preferenceOverlayRef.current.current().providerPreferences?.[provider],
      };
      const nextState = resolveAgentForm(reducerStateRef.current, action);
      const previousProviderModeIds = resolveProviderModeIds(
        previousProvider,
        providerDefinitionMap,
      );

      const selectedProfile = resolveAgentProfileSelection(profile);
      setSelectedAgentProfileId(selectedProfile.id);
      setSelectedAgentProfile(selectedProfile.profile);
      dispatch(action);
      void updateCurrentPreferences((current) =>
        applyAgentProfilePreferences({
          preferences: current,
          previousProvider,
          previousProviderModeIds,
          provider,
          modelId: nextState.form.model,
          modeId: nextState.form.modeId,
          thinkingOptionId: nextState.form.thinkingOptionId,
          featureValues: profile.featureValues,
        }),
      );
    },
    [
      allProviderModels,
      providerDefinitionMap,
      selectableProviderDefinitionMap,
      updateCurrentPreferences,
    ],
  );

  const clearProviderSelectionFromUser = useCallback(() => {
    clearAgentProfileSelection();
    dispatch({ type: "CLEAR_PROVIDER_SELECTION_FROM_USER" });
  }, [clearAgentProfileSelection]);

  const setModeFromUser = useCallback(
    (modeId: string) => {
      dispatch({ type: "SET_MODE_FROM_USER", modeId });
      const provider = reducerStateRef.current.form.provider;
      // Under a personality the model half isn't the user's to remember, and
      // mode/effort ride with it - see applyPersonalityValues.
      if (provider && !appliedFromPersonalityRef.current) {
        void updateCurrentPreferences((current) =>
          mergeSelectedComposerPreferences({
            preferences: current,
            provider,
            updates: {
              mode: modeId || undefined,
            },
          }),
        );
      }
    },
    [updateCurrentPreferences],
  );

  const setModelFromUser = useCallback(
    (modelId: string) => {
      appliedFromPersonalityRef.current = false;
      clearAgentProfileSelection();
      const provider = reducerStateRef.current.form.provider;
      const normalizedModelId = normalizeSelectedModelId(modelId);
      const providerPrefs = provider
        ? preferenceOverlayRef.current.current().providerPreferences?.[provider]
        : undefined;
      dispatch({ type: "SET_MODEL_FROM_USER", modelId, availableModels, providerPrefs });
      if (provider) {
        const nextModelId = normalizedModelId || resolveDefaultModelId(availableModels);
        void updateCurrentPreferences((current) =>
          mergeSelectedComposerPreferences({
            preferences: current,
            provider,
            updates: {
              model: nextModelId || undefined,
            },
          }),
        );
      }
    },
    [availableModels, clearAgentProfileSelection, updateCurrentPreferences],
  );

  const setThinkingOptionFromUser = useCallback(
    (thinkingOptionId: string) => {
      dispatch({ type: "SET_THINKING_OPTION_FROM_USER", thinkingOptionId });
      const { provider, model: modelId } = reducerStateRef.current.form;
      // See setModeFromUser.
      if (provider && modelId && !appliedFromPersonalityRef.current) {
        void updateCurrentPreferences((current) =>
          mergeSelectedComposerPreferences({
            preferences: current,
            provider,
            updates: {
              thinkingByModel: {
                [modelId]: thinkingOptionId,
              },
            },
          }),
        );
      }
    },
    [updateCurrentPreferences],
  );

  const refreshProviderModels = useCallback(
    (provider?: AgentProvider) => {
      void refreshSnapshot(provider ? [provider] : undefined);
    },
    [refreshSnapshot],
  );

  const refetchProviderModelsIfStale = useCallback(() => {
    refetchSnapshotIfStale(reducerStateRef.current.form.provider);
  }, [refetchSnapshotIfStale]);

  const persistFormPreferences = useCallback(async () => {
    if (!formState.provider) {
      return;
    }
    // Submitting under a personality would write that personality's model into
    // the last-used-model preference - the tier it outranks - and it would read
    // back next open as the user's own choice. See applyPersonalityValues.
    if (appliedFromPersonalityRef.current) {
      return;
    }
    await persistProviderPreferences({
      provider: formState.provider,
      formState,
      availableModels,
      updatePreferences: updateCurrentPreferences,
    });
  }, [availableModels, formState, updateCurrentPreferences]);

  const agentDefinition = resolveAgentDefinition(formState.provider, providerDefinitionMap);
  const effectiveModel = resolveEffectiveModel(availableModels, formState.model);
  const availableThinkingOptionsRaw = effectiveModel?.thinkingOptions;
  const availableThinkingOptions = useMemo(
    () => availableThinkingOptionsRaw ?? [],
    [availableThinkingOptionsRaw],
  );
  const isModelLoading = isModelSelectionLoading;
  const modelError = snapshotError;

  const workingDirIsEmpty = !workingDir.trim();

  return useMemo(
    () => ({
      selectedAgentProfileId,
      selectedAgentProfile,
      selectedServerId: serverId,
      selectedProvider: formState.provider,
      setProviderFromUser,
      selectedMode: formState.modeId,
      setModeFromUser,
      selectedModel: formState.model,
      setModelFromUser,
      selectedThinkingOptionId: formState.thinkingOptionId,
      setThinkingOptionFromUser,
      workingDir,
      providerDefinitions,
      providerDefinitionMap,
      agentDefinition,
      allProviderEntries,
      modeOptions,
      availableModels: availableModels ?? [],
      allProviderModels,
      modelSelectorProviders,
      isAllModelsLoading,
      isProviderModelsRefreshing: snapshotIsRefreshing,
      availableThinkingOptions,
      isModelLoading,
      modelError,
      refreshProviderModels,
      refetchProviderModelsIfStale,
      setProviderAndModelFromUser,
      applyProfileFromUser,
      applyPersonalityValues,
      clearProviderSelectionFromUser,
      workingDirIsEmpty,
      persistFormPreferences,
    }),
    [
      selectedAgentProfileId,
      selectedAgentProfile,
      serverId,
      formState.provider,
      formState.modeId,
      formState.model,
      formState.thinkingOptionId,
      workingDir,
      setProviderFromUser,
      setModeFromUser,
      setModelFromUser,
      setThinkingOptionFromUser,
      providerDefinitions,
      providerDefinitionMap,
      agentDefinition,
      allProviderEntries,
      modeOptions,
      availableModels,
      allProviderModels,
      modelSelectorProviders,
      isAllModelsLoading,
      snapshotIsRefreshing,
      availableThinkingOptions,
      isModelLoading,
      modelError,
      refreshProviderModels,
      refetchProviderModelsIfStale,
      setProviderAndModelFromUser,
      applyProfileFromUser,
      applyPersonalityValues,
      clearProviderSelectionFromUser,
      workingDirIsEmpty,
      persistFormPreferences,
    ],
  );
}

export type CreateAgentInitialValues = FormInitialValues;
