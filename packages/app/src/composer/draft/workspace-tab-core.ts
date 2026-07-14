import { resolveSubmissionReadiness } from "@/provider-selection/provider-selection";
import type { SelectorPersonality } from "@/components/combined-model-selector";

export interface WorkspaceDraftAutoSubmitConfig {
  provider: string;
  model: string | null;
}

export interface DraftAutoSubmitConfig {
  provider: string;
  modeId: string | null;
  model: string | null;
  thinkingOptionId: string | null;
  featureValues: Record<string, unknown>;
  personality: string | null;
}

export function resolveAutoSubmitConfig(
  pending: {
    provider: string;
    modeId?: string | null;
    model?: string | null;
    thinkingOptionId?: string | null;
    featureValues?: Record<string, unknown>;
    personality?: string | null;
  } | null,
): DraftAutoSubmitConfig | null {
  if (!pending) return null;
  return {
    provider: pending.provider,
    modeId: pending.modeId ?? null,
    model: pending.model ?? null,
    thinkingOptionId: pending.thinkingOptionId ?? null,
    featureValues: pending.featureValues ?? {},
    personality: pending.personality ?? null,
  };
}

/**
 * Personality identity carried through the draft send. An auto-submit (e.g. a
 * brand-new workspace's first message, handed off from the new-workspace
 * composer) carries its personality id on the pending submission itself,
 * since that composer's own picker state isn't the one live here; otherwise it
 * comes straight from this tab's composer. Either way the daemon re-resolves
 * the id to the authoritative snapshot, but we also read the picker's spinner
 * colors here so the optimistic draft agent shows the personality's spinner
 * instantly, before the created-agent payload arrives.
 */
export function resolveDraftPersonality(input: {
  autoSubmitConfig: DraftAutoSubmitConfig | null;
  agentControls: {
    personality?: {
      selectedPersonalityId?: string | null;
      personalities?: SelectorPersonality[];
    } | null;
  };
}): { id: string; spinner: { glowA: string; glowB: string } | null } | null {
  const id = input.autoSubmitConfig
    ? input.autoSubmitConfig.personality
    : input.agentControls.personality?.selectedPersonalityId;
  if (!id) {
    return null;
  }
  const personality = input.agentControls.personality?.personalities?.find(
    (entry) => entry.id === id,
  );
  const spinner =
    personality?.glowA && personality.glowB
      ? { glowA: personality.glowA, glowB: personality.glowB }
      : null;
  return { id, spinner };
}

export function shouldAllowEmptyDraftText(input: {
  allowsEmptyAutoSubmit: boolean;
  attachments: readonly unknown[];
}): boolean {
  return input.allowsEmptyAutoSubmit || input.attachments.length > 0;
}

export function validateDraftSubmission(input: {
  text: string;
  allowsEmptyAutoSubmit: boolean;
  composerState: {
    providerDefinitions: unknown[];
    selectedProvider: string | null;
    isModelLoading: boolean;
    effectiveModelId: string | null;
    availableModels: unknown[];
  };
  autoSubmitConfig: WorkspaceDraftAutoSubmitConfig | null;
  workspaceDirectory: string | null;
  hasClient: boolean;
}): string | null {
  const {
    text,
    allowsEmptyAutoSubmit,
    composerState,
    autoSubmitConfig,
    workspaceDirectory,
    hasClient,
  } = input;
  const readiness = resolveSubmissionReadiness({
    text,
    allowsEmptyAutoSubmit,
    providerCount: composerState.providerDefinitions.length,
    selection: {
      provider: composerState.selectedProvider,
      modelId: composerState.effectiveModelId ?? "",
      availableModels: composerState.availableModels,
      isModelLoading: composerState.isModelLoading,
    },
    autoSubmitConfig,
    workspaceDirectory,
    hasClient,
  });
  return readiness.ok ? null : (readiness.reason ?? null);
}
