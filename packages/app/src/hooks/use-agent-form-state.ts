import { defaultChatter } from "@/otto/agent-profiles/chat-choices";
import { activeTeam } from "@getpaseo/protocol/otto/agent-teams"; // OTTO(agent-teams)
import { materializeAgentProfile } from "@/agent-profiles/internal/materialize-profile";
import { useDaemonConfig } from "./use-daemon-config";
import { useHostFeature } from "@/runtime/host-features";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { AgentProviderDefinition } from "@getpaseo/protocol/provider-manifest";
import type {
  AgentMode,
  AgentModelDefinition,
  AgentProvider,
  ProviderSnapshotEntry,
} from "@getpaseo/protocol/agent-types";
import { buildProviderDefinitions } from "@/utils/provider-definitions";
import {
  buildSelectableProviderSelectorProviders,
  type ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";
import { filterSelectableModels } from "@/provider-selection/model-catalog";
import { OptimisticFormPreferences } from "@/create-agent-preferences/optimistic-preferences";
import { applyAgentProfilePreferences } from "@/create-agent-preferences/preferences";
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
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import type { MaterializedAgentProfile } from "@/agent-profiles";
import { useDraftChatProfile } from "@/otto/chat/identity/draft-profile"; // OTTO(chat-profile): identity follows explicit selection, never a provider/model guess.
import type { ChatProfileBinding } from "@/otto/chat/identity/profile-binding";

export type { FormInitialValues } from "@/provider-selection/resolve-agent-form";

export interface UseAgentFormStateOptions {
  serverId: string | null;
  workingDir: string;
  initialValues?: FormInitialValues;
  initialChatProfile?: { provider: string; binding: ChatProfileBinding } | null; // OTTO(chat-profile): restored draft selection.
  isVisible?: boolean;
  isCreateFlow?: boolean;
}

export interface UseAgentFormStateResult {
  chatProfile?: ChatProfileBinding;
  selectedServerId: string | null;
  selectedProvider: AgentProvider | null;
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
  clearProviderSelectionFromUser: () => void;
  workingDirIsEmpty: boolean;
  persistFormPreferences: () => Promise<void>;
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
    map.set(entry.provider, filterSelectableModels(entry.models ?? []) ?? []);
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
  const { serverId, initialValues, workingDir, isVisible = true, isCreateFlow = true } = options;

  const supportsTeams = useHostFeature(serverId, "ottoAgentTeams");
  const { config: roster } = useDaemonConfig(supportsTeams ? serverId : null);
  const explicit = useRef<string | null>(null);
  const automatic = useRef<string | null>(null);
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

  const [{ form: formState, userModified, resolution }, dispatch] = useReducer(resolveAgentForm, {
    form: { provider: null, modeId: "", model: "", thinkingOptionId: "" },
    userModified: INITIAL_USER_MODIFIED,
    resolution: INITIAL_AGENT_FORM_RESOLUTION,
  });
  const draftProfile = useDraftChatProfile(
    serverId,
    formState.provider,
    options.initialChatProfile,
  );
  const { binding: chatProfile, select: selectChatProfile, clear: clearChatProfile } = draftProfile;

  const {
    entries: snapshotEntries,
    isLoading: snapshotIsLoading,
    isRefreshing: snapshotIsRefreshing,
    error: snapshotError,
    refresh: refreshSnapshot,
    refetchIfStale: refetchSnapshotIfStale,
  } = useProvidersSnapshot(serverId, { cwd: workingDir });

  const isConnected = useHostRuntimeIsConnected(serverId ?? "");

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
    () => buildSelectableProviderSelectorProviders(snapshotEntries, isConnected),
    [snapshotEntries, isConnected],
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
  const modeOptions = snapshotSelectedProviderModes;
  const isModelSelectionLoading =
    isConnected &&
    (resolution.status === "pending" || snapshotIsLoading || selectedProviderIsLoading);
  const isAllModelsLoading = isModelSelectionLoading;

  const refreshFormInputs = useCallback(() => {
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

  useEffect(refreshFormInputs, [refreshFormInputs]);

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
      explicit.current = serverId;
      clearChatProfile(); // OTTO(chat-profile): choosing a raw model explicitly leaves the Profile.

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
      clearChatProfile,
      selectableProviderDefinitionMap,
      serverId,
      updateCurrentPreferences,
    ],
  );

  const clearProviderSelectionFromUser = useCallback(() => {
    explicit.current = serverId;
    clearChatProfile();
    dispatch({ type: "CLEAR_PROVIDER_SELECTION_FROM_USER" });
  }, [clearChatProfile, serverId]);

  const applyProfileFromUser = useCallback(
    (profile: MaterializedAgentProfile, fromTeam = false) => {
      const provider = profile.provider as AgentProvider;
      if (!selectableProviderDefinitionMap.has(provider)) {
        return;
      }

      const previousProvider = formState.provider;
      const providerDef = selectableProviderDefinitionMap.get(provider);
      const providerModels = allProviderModels.get(provider) ?? null;
      const providerPrefs = preferenceOverlayRef.current.current().providerPreferences?.[provider];
      const action = {
        type: "APPLY_PROFILE_FROM_USER" as const,
        provider,
        modelId: profile.modelId,
        modeId: profile.modeId,
        thinkingOptionId: profile.thinkingOptionId,
        providerDef,
        providerModels,
        providerPrefs,
      };
      const nextState = resolveAgentForm({ form: formState, userModified, resolution }, action);
      const previousProviderModeIds = previousProvider
        ? (providerDefinitionMap.get(previousProvider)?.modes.map((mode) => mode.id) ?? [])
        : [];

      dispatch(action);
      selectChatProfile(provider, profile.chatProfile);
      if (fromTeam) return;
      explicit.current = serverId;
      // OTTO(agent-teams): roleless Paseo presets still apply their provider preferences.
      if (serverId && profile.rememberAsChatter && profile.chatProfile?.hostBinding) {
        const id = profile.chatProfile.id;
        void updateCurrentPreferences((current) => ({
          ...current,
          chatterByHost: { ...current.chatterByHost, [serverId]: id },
        })).catch((error) => console.warn("[useAgentFormState] remember Chatter failed", error));
        return;
      }
      void updateCurrentPreferences((current) => {
        const { model, modeId, thinkingOptionId } = nextState.form;
        return applyAgentProfilePreferences({
          preferences: current,
          previousProvider,
          previousProviderModeIds,
          provider,
          modelId: model,
          modeId,
          thinkingOptionId,
          featureValues: profile.featureValues,
        });
      }).catch((error) => {
        console.warn("[useAgentFormState] persist profile preference failed", error);
      });
    },
    [
      allProviderModels,
      formState,
      providerDefinitionMap,
      resolution,
      selectableProviderDefinitionMap,
      updateCurrentPreferences,
      userModified,
      selectChatProfile,
      serverId,
    ],
  );

  const presetDraft = Boolean(options.initialChatProfile || initialValues?.provider);
  // OTTO(agent-teams): resolve only fresh, unconfigured drafts. Remembered preferences never select a Profile.
  useEffect(() => {
    if (
      !serverId ||
      !isVisible ||
      !isCreateFlow ||
      isPreferencesLoading ||
      explicit.current === serverId ||
      presetDraft ||
      !roster
    )
      return;
    const team = activeTeam(roster.agentTeams);
    const available = (roster.agentProfiles ?? []).filter(
      (p) =>
        selectableProviderDefinitionMap.has(p.provider) &&
        (!p.model || allProviderModels.get(p.provider)?.some((m) => m.id === p.model)),
    );
    const member = defaultChatter(team, available, preferences.chatterByHost?.[serverId]);
    const key = JSON.stringify([serverId, team?.id, member?.id, member?.model]);
    if (automatic.current === key) return;
    if (!member) {
      if (automatic.current && chatProfile?.hostBinding) {
        clearChatProfile();
        dispatch({ type: "RESET" });
        refreshFormInputs();
      }
      automatic.current = key;
      return;
    }
    const selection = materializeAgentProfile(member);
    if (selection.chatProfile) selection.chatProfile.hostBinding = true;
    automatic.current = key;
    applyProfileFromUser(selection, true);
  }, [
    allProviderModels,
    applyProfileFromUser,
    chatProfile,
    clearChatProfile,
    presetDraft,
    preferences.chatterByHost,
    refreshFormInputs,
    isCreateFlow,
    isPreferencesLoading,
    isVisible,
    roster,
    selectableProviderDefinitionMap,
    serverId,
  ]);

  const setModeFromUser = useCallback(
    (modeId: string) => {
      dispatch({ type: "SET_MODE_FROM_USER", modeId });
      const provider = formState.provider;
      if (provider) {
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
    [formState.provider, updateCurrentPreferences],
  );

  const setModelFromUser = useCallback(
    (modelId: string) => {
      explicit.current = serverId;
      clearChatProfile();
      const provider = formState.provider;
      const providerPrefs = provider
        ? preferenceOverlayRef.current.current().providerPreferences?.[provider]
        : undefined;
      dispatch({
        type: "SET_MODEL_FROM_USER",
        modelId,
        availableModels,
        providerPrefs,
      });
      if (provider) {
        const normalizedModelId = normalizeSelectedModelId(modelId);
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
    [availableModels, clearChatProfile, formState.provider, serverId, updateCurrentPreferences],
  );

  const setThinkingOptionFromUser = useCallback(
    (thinkingOptionId: string) => {
      dispatch({ type: "SET_THINKING_OPTION_FROM_USER", thinkingOptionId });
      const { provider, model: modelId } = formState;
      if (provider && modelId) {
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
    [formState, updateCurrentPreferences],
  );

  const refreshProviderModels = useCallback(
    (provider?: AgentProvider) => {
      void refreshSnapshot(provider ? [provider] : undefined);
    },
    [refreshSnapshot],
  );

  const refetchProviderModelsIfStale = useCallback(() => {
    refetchSnapshotIfStale(formState.provider);
  }, [formState.provider, refetchSnapshotIfStale]);

  const persistFormPreferences = useCallback(async () => {
    if (chatProfile?.hostBinding || !formState.provider) {
      return;
    }
    await persistProviderPreferences({
      provider: formState.provider,
      formState,
      availableModels,
      updatePreferences: updateCurrentPreferences,
    });
  }, [availableModels, chatProfile?.hostBinding, formState, updateCurrentPreferences]);

  const agentDefinition = formState.provider
    ? providerDefinitionMap.get(formState.provider)
    : undefined;
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
      chatProfile,
      selectedServerId: serverId,
      selectedProvider: formState.provider,
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
      clearProviderSelectionFromUser,
      workingDirIsEmpty,
      persistFormPreferences,
    }),
    [
      chatProfile,
      serverId,
      formState.provider,
      formState.modeId,
      formState.model,
      formState.thinkingOptionId,
      workingDir,
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
      clearProviderSelectionFromUser,
      workingDirIsEmpty,
      persistFormPreferences,
    ],
  );
}

export type CreateAgentInitialValues = FormInitialValues;
