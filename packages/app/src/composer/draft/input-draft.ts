import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UserComposerAttachment } from "@/attachments/types";
import type { DraftAgentControlsProps } from "@/composer/agent-controls";
import type { MaterializedAgentProfile } from "@/agent-profiles";
import type { DraftCommandConfig } from "@/hooks/use-agent-commands-query";
import {
  useAgentFormState,
  type CreateAgentInitialValues,
  type UseAgentFormStateResult,
} from "@/hooks/use-agent-form-state";
import { useDraftAgentFeatures } from "@/hooks/use-draft-agent-features";
import {
  buildDraftAgentControls,
  hasDraftContent,
  resolveDraftKey,
  type DraftKeyInput,
} from "@/composer/draft/input-draft-core";
import {
  buildDraftCommandConfig,
  resolveEffectiveComposerModelId,
  resolveEffectiveComposerThinkingOptionId,
  type ProviderSelectionState,
} from "@/provider-selection/provider-selection";
import { useDraftStore } from "@/stores/draft-store";
import { toDraftInputIfReady } from "@/stores/draft-store/state";
import type { RolePersonality } from "@/provider-selection/role-model-personality";

type AttachmentUpdater =
  | UserComposerAttachment[]
  | ((prev: UserComposerAttachment[]) => UserComposerAttachment[]);

interface AgentInputDraftComposerOptions {
  initialServerId: string | null;
  initialValues?: CreateAgentInitialValues;
  initialFeatureValues?: Record<string, unknown>;
  isVisible?: boolean;
  onlineServerIds?: string[];
  lockedWorkingDir?: string;
  /** Personality identity inherited from a fork / "new tab from this agent". */
  initialPersonalityId?: string | null;
}

interface UseAgentInputDraftInput {
  draftKey: DraftKeyInput;
  composer?: AgentInputDraftComposerOptions;
}

type DraftAgentControlsWithProfileCompatibility = DraftAgentControlsProps & {
  /**
   * COMPAT(agentProfiles): added in v0.8.12, remove after 2027-02-21 once creation
   * accepts profileId directly. This is a legacy wire bridge, not a second picker.
   */
  personality: RolePersonality | null;
};

type DraftComposerState = UseAgentFormStateResult & {
  workingDir: string;
  effectiveModelId: string;
  effectiveThinkingOptionId: string;
  featureValues: Record<string, unknown> | undefined;
  agentControls: DraftAgentControlsWithProfileCompatibility;
  commandDraftConfig: DraftCommandConfig | undefined;
};

export interface AgentInputDraft {
  text: string;
  setText: (text: string) => void;
  attachments: UserComposerAttachment[];
  setAttachments: (updater: AttachmentUpdater) => void;
  clear: (lifecycle: "sent" | "abandoned") => void;
  isHydrated: boolean;
  attachmentFocusRequestId: number;
  composerState: DraftComposerState | null;
}

function buildAgentProfileCompatibility(
  profileId: string | null,
  profile: MaterializedAgentProfile | null,
): RolePersonality | null {
  if (!profileId) return null;
  const selectedProfile = profile?.id === profileId ? profile : null;
  const selectedName = selectedProfile?.name || profileId;
  return {
    personalities: selectedProfile
      ? [
          {
            id: profileId,
            name: selectedName,
            provider: selectedProfile.provider,
            subtitle: "",
            glowA: selectedProfile.spinner?.glowA,
            glowB: selectedProfile.spinner?.glowB,
            available: true,
          },
        ]
      : undefined,
    selectedPersonalityId: profileId,
    spawnPersonalityId: profileId,
    onSelectPersonality: undefined,
    onClearPersonality: undefined,
    hasBoundPersonality: true,
    isSwitching: false,
    selectedName,
    selectedSpinner: selectedProfile?.spinner,
  };
}

export function useAgentInputDraft(input: UseAgentInputDraftInput): AgentInputDraft {
  const composerOptions = input.composer ?? null;
  const formState = useAgentFormState({
    initialServerId: composerOptions?.initialServerId ?? null,
    initialAgentProfileId: composerOptions?.initialPersonalityId,
    initialValues: composerOptions?.initialValues,
    isVisible: composerOptions?.isVisible ?? false,
    isCreateFlow: true,
    onlineServerIds: composerOptions?.onlineServerIds ?? [],
  });
  const draftKey = useMemo(
    () =>
      resolveDraftKey({
        draftKey: input.draftKey,
        selectedServerId: formState.selectedServerId,
      }),
    [formState.selectedServerId, input.draftKey],
  );
  const draftRecord = useDraftStore((state) => state.drafts[draftKey]);
  const draft = useMemo(() => toDraftInputIfReady(draftRecord), [draftRecord]);
  const attachmentFocusRequestId = useDraftStore(
    (state) => state.attachmentFocusRequestByDraftKey[draftKey] ?? 0,
  );
  const [hydratedDraftKey, setHydratedDraftKey] = useState<string | null>(null);
  // Text is intentionally local while typing. Updating the draft store for
  // every keypress makes the entire composer tree (and, for an active agent,
  // its parent panel) participate in the input's urgent render path. Drafts
  // remain durable through the checkpoint below and are flushed on teardown.
  const [text, setTextState] = useState("");
  const textRef = useRef("");
  const textEditedRef = useRef(false);
  const textPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attachments = draft?.attachments ?? [];
  const isHydrated = hydratedDraftKey === draftKey;

  const flushText = useCallback(
    (nextText: string) => {
      if (textPersistTimerRef.current !== null) {
        clearTimeout(textPersistTimerRef.current);
        textPersistTimerRef.current = null;
      }
      const store = useDraftStore.getState();
      const current = store.getDraftInput(draftKey) ?? { text: "", attachments: [] };
      const next = { ...current, text: nextText };
      if (!hasDraftContent(next)) {
        store.clearDraftInput({ draftKey, lifecycle: "abandoned" });
        return;
      }
      store.saveDraftInput({ draftKey, draft: next });
    },
    [draftKey],
  );

  // Hydration is asynchronous. Adopt the hydrated value unless the user has
  // already started editing, in which case their live text is authoritative.
  useEffect(() => {
    if (hydratedDraftKey !== draftKey || textEditedRef.current) {
      return;
    }
    const hydratedText = draft?.text ?? "";
    textRef.current = hydratedText;
    setTextState(hydratedText);
  }, [draft?.text, draftKey, hydratedDraftKey]);

  useEffect(() => {
    textEditedRef.current = false;
    textRef.current = "";
    setTextState("");
  }, [draftKey]);

  useEffect(() => {
    return () => {
      if (textEditedRef.current) {
        flushText(textRef.current);
      }
    };
  }, [flushText]);

  const saveDraft = useCallback(
    (
      update: (draft: { text: string; attachments: UserComposerAttachment[] }) => {
        text: string;
        attachments: UserComposerAttachment[];
      },
    ) => {
      const store = useDraftStore.getState();
      const current = {
        ...(store.getDraftInput(draftKey) ?? { text: "", attachments: [] }),
        text: textRef.current,
      };
      const next = update(current);
      if (!hasDraftContent(next)) {
        store.clearDraftInput({ draftKey, lifecycle: "abandoned" });
        return;
      }
      store.saveDraftInput({ draftKey, draft: next });
    },
    [draftKey],
  );

  const setText = useCallback(
    (nextText: string) => {
      textEditedRef.current = true;
      textRef.current = nextText;
      setTextState(nextText);
      if (textPersistTimerRef.current !== null) {
        clearTimeout(textPersistTimerRef.current);
      }
      textPersistTimerRef.current = setTimeout(() => {
        textPersistTimerRef.current = null;
        flushText(nextText);
      }, 200);
    },
    [flushText],
  );

  const setAttachments = useCallback(
    (updater: AttachmentUpdater) => {
      saveDraft((current) => ({
        ...current,
        attachments: typeof updater === "function" ? updater(current.attachments) : updater,
      }));
    },
    [saveDraft],
  );

  const clear = useCallback(
    (lifecycle: "sent" | "abandoned") => {
      if (textPersistTimerRef.current !== null) {
        clearTimeout(textPersistTimerRef.current);
        textPersistTimerRef.current = null;
      }
      textEditedRef.current = false;
      textRef.current = "";
      setTextState("");
      useDraftStore.getState().clearDraftInput({ draftKey, lifecycle });
    },
    [draftKey],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await useDraftStore.getState().hydrateDraftInput({ draftKey });
      if (!cancelled) {
        setHydratedDraftKey(draftKey);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [draftKey]);

  const lockedWorkingDir = composerOptions?.lockedWorkingDir?.trim() ?? "";
  useEffect(() => {
    if (!composerOptions || !lockedWorkingDir) {
      return;
    }
    if (formState.workingDir.trim() === lockedWorkingDir) {
      return;
    }
    formState.setWorkingDir(lockedWorkingDir);
  }, [composerOptions, formState, lockedWorkingDir]);

  const providerSelection = useMemo<ProviderSelectionState>(
    () => ({
      provider: formState.selectedProvider,
      modelId: formState.selectedModel,
      modeId: formState.selectedMode,
      thinkingOptionId: formState.selectedThinkingOptionId,
      availableModels: formState.availableModels,
      modeOptions: formState.modeOptions,
    }),
    [
      formState.availableModels,
      formState.modeOptions,
      formState.selectedMode,
      formState.selectedModel,
      formState.selectedProvider,
      formState.selectedThinkingOptionId,
    ],
  );

  const effectiveModelId = useMemo(
    () => resolveEffectiveComposerModelId(providerSelection),
    [providerSelection],
  );

  const effectiveThinkingOptionId = useMemo(
    () => resolveEffectiveComposerThinkingOptionId(providerSelection, effectiveModelId),
    [effectiveModelId, providerSelection],
  );

  const workingDir = lockedWorkingDir || formState.workingDir;
  const {
    features: draftFeatures,
    featureValues: draftFeatureValues,
    setFeatureValue: setDraftFeatureValue,
    applyProfileFeatureValues,
  } = useDraftAgentFeatures({
    serverId: formState.selectedServerId,
    provider: formState.selectedProvider,
    cwd: workingDir,
    modeId: formState.selectedMode,
    modelId: effectiveModelId,
    thinkingOptionId: effectiveThinkingOptionId,
    initialFeatureValues: composerOptions?.initialFeatureValues,
  });

  const applyDraftAgentProfile = useCallback(
    (profile: Parameters<typeof formState.applyProfileFromUser>[0]) => {
      formState.applyProfileFromUser(profile);
      applyProfileFeatureValues(profile.featureValues);
    },
    [applyProfileFeatureValues, formState],
  );

  const commandDraftConfig = useMemo(
    () =>
      composerOptions
        ? buildDraftCommandConfig({
            selection: providerSelection,
            cwd: workingDir,
            effectiveModelId,
            effectiveThinkingOptionId,
            featureValues: draftFeatureValues,
          })
        : undefined,
    [
      composerOptions,
      effectiveModelId,
      effectiveThinkingOptionId,
      draftFeatureValues,
      providerSelection,
      workingDir,
    ],
  );

  const profileCompatibility = useMemo(
    () =>
      buildAgentProfileCompatibility(
        formState.selectedAgentProfileId,
        formState.selectedAgentProfile,
      ),
    [formState.selectedAgentProfile, formState.selectedAgentProfileId],
  );

  const composerState = useMemo<DraftComposerState | null>(() => {
    if (!composerOptions) {
      return null;
    }

    return {
      ...formState,
      workingDir,
      effectiveModelId,
      effectiveThinkingOptionId,
      featureValues: draftFeatureValues,
      agentControls: {
        ...buildDraftAgentControls({
          formState,
          features: draftFeatures,
          onSetFeature: setDraftFeatureValue,
          onApplyAgentProfile: applyDraftAgentProfile,
        }),
        personality: profileCompatibility,
      },
      commandDraftConfig,
    };
  }, [
    commandDraftConfig,
    composerOptions,
    effectiveModelId,
    effectiveThinkingOptionId,
    draftFeatures,
    draftFeatureValues,
    applyDraftAgentProfile,
    formState,
    profileCompatibility,
    setDraftFeatureValue,
    workingDir,
  ]);

  return {
    text,
    setText,
    attachments,
    setAttachments,
    clear,
    isHydrated,
    attachmentFocusRequestId,
    composerState,
  };
}

export const __private__ = {
  resolveDraftKey,
  resolveEffectiveComposerModelId,
  resolveEffectiveComposerThinkingOptionId,
  buildDraftCommandConfig,
  buildDraftComposerCommandConfig: buildDraftCommandConfig,
  buildDraftAgentControls,
  buildAgentProfileCompatibility,
};
