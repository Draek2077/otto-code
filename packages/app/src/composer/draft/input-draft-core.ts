import type { UserComposerAttachment } from "@/attachments/types";
import type { DraftAgentControlsProps } from "@/composer/agent-controls";
import type { UseAgentFormStateResult } from "@/hooks/use-agent-form-state";
import type { MaterializedAgentProfile } from "@/agent-profiles";
import type { RolePersonality } from "@/provider-selection/role-model-personality";
import type { AgentProfile } from "@otto-code/protocol/messages";

export interface DraftKeyContext {
  selectedServerId: string | null;
}

export type DraftKeyInput = string | ((context: DraftKeyContext) => string);

export function resolveDraftKey(input: {
  draftKey: DraftKeyInput;
  selectedServerId: string | null;
}): string {
  if (typeof input.draftKey === "function") {
    return input.draftKey({ selectedServerId: input.selectedServerId });
  }
  return input.draftKey;
}

export function buildDraftAgentControls(input: {
  formState: UseAgentFormStateResult;
  features?: DraftAgentControlsProps["features"];
  onSetFeature?: DraftAgentControlsProps["onSetFeature"];
  onApplyAgentProfile: DraftAgentControlsProps["onApplyAgentProfile"];
  onDropdownClose?: DraftAgentControlsProps["onDropdownClose"];
}): DraftAgentControlsProps {
  const { formState, features, onSetFeature, onApplyAgentProfile, onDropdownClose } = input;
  return {
    providerDefinitions: formState.providerDefinitions,
    selectedProvider: formState.selectedProvider,
    modeOptions: formState.modeOptions,
    selectedMode: formState.selectedMode,
    onSelectMode: formState.setModeFromUser,
    models: formState.availableModels,
    selectedModel: formState.selectedModel,
    onSelectModel: formState.setModelFromUser,
    isModelLoading: formState.isModelLoading,
    modelSelectorProviders: formState.modelSelectorProviders,
    isAllModelsLoading: formState.isAllModelsLoading,
    onSelectProviderAndModel: formState.setProviderAndModelFromUser,
    thinkingOptions: formState.availableThinkingOptions,
    selectedThinkingOptionId: formState.selectedThinkingOptionId,
    onSelectThinkingOption: formState.setThinkingOptionFromUser,
    onApplyAgentProfile,
    features,
    onSetFeature,
    onDropdownClose,
    onModelSelectorOpen: formState.refetchProviderModelsIfStale,
    onRetryModelProvider: formState.refreshProviderModels,
    isRetryingModelProvider: formState.isProviderModelsRefreshing,
    modelSelectorServerId: formState.selectedServerId,
  };
}

export function hasDraftContent(input: {
  text: string;
  attachments: UserComposerAttachment[];
}): boolean {
  return input.text.trim().length > 0 || input.attachments.length > 0;
}

export function areAttachmentsEqual(input: {
  left: UserComposerAttachment[];
  right: UserComposerAttachment[];
}): boolean {
  if (input.left.length !== input.right.length) {
    return false;
  }

  return input.left.every((attachment, index) => {
    const other = input.right[index];
    return JSON.stringify(attachment) === JSON.stringify(other);
  });
}

/**
 * The composer's view of the draft's bound identity.
 *
 * `applied` is the profile the user just picked in this composer; `roster` is
 * the host's stored list. Both are consulted because the binding has two
 * sources: picking one here, and inheriting one (a fork, "new tab from this
 * agent", a workspace-setup initial value) where nothing was picked and only an
 * id is known. Resolving against the roster is what stops an inherited binding
 * rendering as its raw id with no colours.
 */
export function buildBoundPersonality(
  profileId: string | null,
  applied: MaterializedAgentProfile | null,
  roster: readonly AgentProfile[] | null,
): RolePersonality | null {
  if (!profileId) return null;
  const source =
    applied?.id === profileId ? applied : (roster?.find((entry) => entry.id === profileId) ?? null);
  const resolved = source
    ? { name: source.name, provider: source.provider, spinner: source.spinner }
    : null;
  // Falling back to the id keeps the chip labelled while the daemon config is
  // still loading, rather than blanking and then popping in.
  const selectedName = resolved?.name || profileId;
  return {
    personalities: resolved
      ? [
          {
            id: profileId,
            name: selectedName,
            provider: resolved.provider,
            subtitle: "",
            glowA: resolved.spinner?.glowA,
            glowB: resolved.spinner?.glowB,
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
    selectedSpinner: resolved?.spinner,
  };
}
