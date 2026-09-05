import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UserComposerAttachment } from "@/attachments/types";
import type { DraftAgentControlsProps } from "@/composer/agent-controls";

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
import type { PersonalityFormValues } from "@/provider-selection/personality-form";
import { useDraftStore } from "@/stores/draft-store";
import { toDraftInputIfReady } from "@/stores/draft-store/state";
import {
  useFormRolePersonality,
  type RolePersonality,
} from "@/provider-selection/role-model-personality";

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

// The synthetic "Team's Chatter" picker entry - the composer's binding of the
// shared team-role picker pattern (mirrors the artifact sheet's "Team's
// Artificer"). New chat runs immediately, so there is no persisted sentinel;
// selecting it resolves the active team's Chatter NOW and applies its values.
// Its id never leaves the draft form.
const TEAM_CHATTER_ENTRY_ID = "__team-chatter__";

interface UseAgentInputDraftInput {
  draftKey: DraftKeyInput;
  composer?: AgentInputDraftComposerOptions;
}

/**
 * New-chat (Chatter) Personality picker. Applies a Personality's
 * provider/model/mode/effort/features to the draft form; mode matters here
 * because chat is attended, unlike artifacts and schedules.
 */
function useChatterPersonalitySelection(input: {
  formState: UseAgentFormStateResult;
  onApply: (values: PersonalityFormValues) => void;
  initialPersonalityId: string | null;
}): RolePersonality {
  const { formState } = input;
  const currentSelection = useMemo(
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
  return useFormRolePersonality({
    serverId: formState.selectedServerId,
    role: "chatter",
    entries: formState.allProviderEntries ?? [],
    onApply: input.onApply,
    currentSelection,
    team: {
      entryId: TEAM_CHATTER_ENTRY_ID,
      label: "Team's Chatter",
      roleLabel: "Chatter",
    },
    // The chat composer runs the full ladder like every other apply-now
    // surface: team's Chatter, else the remembered Chatter, else the first
    // available one. Seeing a bare model here means you have no Chatter at all.
    autoSelectDefault: "always",
    initialPersonalityId: input.initialPersonalityId,
  });
}

type DraftAgentControlsWithProfileCompatibility = DraftAgentControlsProps & {
  /**
   * The draft's bound identity, which creation sends as `personality`. Since the
   * two stored-template systems converged this is a real roster binding, not a
   * bridge: the id names an entry in `daemon.agentProfiles` and the daemon
   * resolves it at spawn.
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
  /** Ordinary typing: debounced, never remounts the input. */
  editText: (text: string) => void;
  /**
   * A programmatic rewrite (dictation refine, a template applied to the draft).
   * Writes through immediately and bumps {@link textReplacementKey}.
   */
  replaceText: (text: string) => void;
  /** Changes on every {@link replaceText}. Consumers key the text input off it
   *  so a rewrite remounts rather than fighting the caret. */
  textReplacementKey: string;
  attachments: UserComposerAttachment[];
  setAttachments: (updater: AttachmentUpdater) => void;
  clear: (lifecycle: "sent" | "abandoned") => void;
  isHydrated: boolean;
  attachmentFocusRequestId: number;
  composerState: DraftComposerState | null;
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
  const [textReplacementRevision, setTextReplacementRevision] = useState(0);
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

  const replaceText = useCallback(
    (nextText: string) => {
      textEditedRef.current = true;
      textRef.current = nextText;
      setTextState(nextText);
      // A replacement is authoritative: drop the debounce a keystroke may have
      // left pending so it cannot overwrite the new text a moment later.
      if (textPersistTimerRef.current !== null) {
        clearTimeout(textPersistTimerRef.current);
        textPersistTimerRef.current = null;
      }
      flushText(nextText);
      setTextReplacementRevision((revision) => revision + 1);
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
      setTextReplacementRevision((revision) => revision + 1);
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

  // Applying a Personality is one form transition: its provider/model/mode/
  // effort through the form's own personality path (which deliberately skips
  // the last-used-model preference), plus the provider feature toggles it pins.
  const { applyPersonalityValues } = formState;
  const applyChatterPersonality = useCallback(
    (values: PersonalityFormValues) => {
      applyPersonalityValues(values);
      applyProfileFeatureValues(values.featureValues ?? {});
    },
    [applyPersonalityValues, applyProfileFeatureValues],
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

  const profileSelection = useChatterPersonalitySelection({
    formState,
    onApply: applyChatterPersonality,
    initialPersonalityId: composerOptions?.initialPersonalityId ?? null,
  });

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
        }),
        personality: profileSelection,
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
    formState,
    profileSelection,
    setDraftFeatureValue,
    workingDir,
  ]);

  return {
    text,
    setText,
    editText: setText,
    replaceText,
    textReplacementKey: `${draftKey}:${textReplacementRevision}`,
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
};
