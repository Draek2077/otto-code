import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UserComposerAttachment } from "@/attachments/types";
import type { DraftAgentControlsProps } from "@/composer/agent-controls";
import type { DraftCommandConfig } from "@/hooks/use-agent-commands-query";
import {
  useAgentFormState,
  type CreateAgentInitialValues,
  type UseAgentFormStateResult,
} from "@/hooks/use-agent-form-state";
import { useFormRolePersonality } from "@/provider-selection/role-model-personality";
import { useDraftAgentFeatures } from "@/hooks/use-draft-agent-features";
import {
  areAttachmentsEqual,
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

type DraftComposerState = UseAgentFormStateResult & {
  workingDir: string;
  effectiveModelId: string;
  effectiveThinkingOptionId: string;
  featureValues: Record<string, unknown> | undefined;
  agentControls: DraftAgentControlsProps;
  commandDraftConfig: DraftCommandConfig | undefined;
};

export interface AgentInputDraft {
  text: string;
  setText: (text: string) => void;
  attachments: UserComposerAttachment[];
  setAttachments: (updater: AttachmentUpdater) => void;
  clear: (lifecycle: "sent" | "abandoned") => void;
  isHydrated: boolean;
  composerState: DraftComposerState | null;
}

// The synthetic "Team's Chatter" picker entry — the composer's binding of the
// shared team-role picker pattern (mirrors the artifact sheet's "Team's
// Artificer"). New chat runs immediately, so there is no persisted sentinel;
// selecting it resolves the active team's Chatter NOW and applies its values.
// Its id never leaves the draft form.
const TEAM_CHATTER_ENTRY_ID = "__team-chatter__";

export function useAgentInputDraft(input: UseAgentInputDraftInput): AgentInputDraft {
  const composerOptions = input.composer ?? null;
  const formState = useAgentFormState({
    initialServerId: composerOptions?.initialServerId ?? null,
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

  // New-chat (Chatter) personality picker. Applies a personality's
  // provider/model/mode/effort to the draft form; mode matters here because
  // chat is attended (unlike artifacts/schedules).
  const applyPersonality = formState.applyPersonalityValues;
  const personalityCurrentSelection = useMemo(
    () => ({
      provider: formState.selectedProvider,
      model: formState.selectedModel,
      modeId: formState.selectedMode,
      thinkingOptionId: formState.selectedThinkingOptionId,
    }),
    [
      formState.selectedProvider,
      formState.selectedModel,
      formState.selectedMode,
      formState.selectedThinkingOptionId,
    ],
  );
  const personalitySelection = useFormRolePersonality({
    serverId: formState.selectedServerId,
    role: "chatter",
    entries: formState.allProviderEntries ?? [],
    onApply: applyPersonality,
    currentSelection: personalityCurrentSelection,
    team: {
      entryId: TEAM_CHATTER_ENTRY_ID,
      label: "Team's Chatter",
      roleLabel: "Chatter",
    },
    // The chat composer runs the full ladder like every other apply-now
    // surface: team's Chatter, else the remembered Chatter, else the first
    // available one. Seeing a bare model here means you have no Chatter at all.
    autoSelectDefault: "always",
    initialPersonalityId: composerOptions?.initialPersonalityId ?? null,
  });
  const [text, setText] = useState("");
  const [attachments, setAttachmentsState] = useState<UserComposerAttachment[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const draftGenerationRef = useRef(0);
  const hydratedGenerationRef = useRef(0);

  const setAttachments = useCallback((updater: AttachmentUpdater) => {
    setAttachmentsState((previousAttachments) => {
      if (typeof updater === "function") {
        return updater(previousAttachments);
      }
      return updater;
    });
  }, []);

  const clear = useCallback(
    (lifecycle: "sent" | "abandoned") => {
      const store = useDraftStore.getState();
      store.clearDraftInput({ draftKey, lifecycle });

      const generation = store.beginDraftGeneration(draftKey);
      draftGenerationRef.current = generation;
      hydratedGenerationRef.current = generation;

      setText("");
      setAttachmentsState([]);
      setIsHydrated(true);
    },
    [draftKey],
  );

  useEffect(() => {
    const store = useDraftStore.getState();
    const generation = store.beginDraftGeneration(draftKey);
    draftGenerationRef.current = generation;
    hydratedGenerationRef.current = 0;

    setText("");
    setAttachmentsState([]);
    setIsHydrated(false);

    let cancelled = false;

    void (async () => {
      const draft = await store.hydrateDraftInput({
        draftKey,
      });
      if (cancelled) {
        return;
      }
      if (!useDraftStore.getState().isDraftGenerationCurrent({ draftKey, generation })) {
        return;
      }

      if (draft) {
        setText(draft.text);
        setAttachmentsState(draft.attachments);
      }

      hydratedGenerationRef.current = generation;
      setIsHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [draftKey]);

  useEffect(() => {
    const currentGeneration = draftGenerationRef.current;
    if (currentGeneration <= 0) {
      return;
    }

    const store = useDraftStore.getState();
    const isCurrentGeneration = store.isDraftGenerationCurrent({
      draftKey,
      generation: currentGeneration,
    });
    if (!isCurrentGeneration) {
      return;
    }
    if (hydratedGenerationRef.current !== currentGeneration) {
      return;
    }

    const existing = store.getDraftInput(draftKey);
    const isSameDraft =
      existing !== undefined &&
      existing.text === text &&
      areAttachmentsEqual({
        left: existing.attachments,
        right: attachments,
      });
    if (isSameDraft) {
      return;
    }

    if (!hasDraftContent({ text, attachments })) {
      if (existing) {
        store.clearDraftInput({ draftKey, lifecycle: "abandoned" });
      }
      return;
    }

    store.saveDraftInput({
      draftKey,
      draft: {
        text,
        attachments,
      },
    });
  }, [attachments, draftKey, text]);

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
  } = useDraftAgentFeatures({
    serverId: formState.selectedServerId,
    provider: formState.selectedProvider,
    cwd: workingDir,
    modeId: formState.selectedMode,
    modelId: effectiveModelId,
    thinkingOptionId: effectiveThinkingOptionId,
    initialFeatureValues: composerOptions?.initialFeatureValues,
  });

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
      agentControls: buildDraftAgentControls({
        formState,
        features: draftFeatures,
        onSetFeature: setDraftFeatureValue,
        personality: personalitySelection,
      }),
      commandDraftConfig,
    };
  }, [
    commandDraftConfig,
    composerOptions,
    effectiveModelId,
    effectiveThinkingOptionId,
    draftFeatures,
    draftFeatureValues,
    formState,
    personalitySelection,
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
};
