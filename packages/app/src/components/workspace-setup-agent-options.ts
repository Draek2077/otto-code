import { resolveSpawnPersonalityId } from "@/composer/draft/workspace-tab-core";
import type { CreateAgentRequestOptions } from "@otto-code/client/internal/daemon-client";

export function buildWorkspaceSetupCreateAgentOptions({
  composerState,
  text,
  attachments,
  encodedImages,
  workspaceDirectory,
  workspaceId,
  provider,
  clientMessageId,
}: {
  composerState: {
    modeOptions: { id: string }[];
    selectedMode: string;
    effectiveModelId: string | null;
    effectiveThinkingOptionId: string | null;
    agentControls: {
      personality?: {
        selectedProfileId?: string | null;
        spawnProfileId?: string | null;
      } | null;
    };
  };
  text: string;
  attachments: NonNullable<CreateAgentRequestOptions["attachments"]>;
  encodedImages: NonNullable<CreateAgentRequestOptions["images"]> | null;
  workspaceDirectory: string;
  workspaceId: string;
  provider: CreateAgentRequestOptions["provider"];
  clientMessageId?: string;
}): CreateAgentRequestOptions {
  const spawnProfileId = resolveSpawnPersonalityId(composerState.agentControls.personality);
  // Reconcile the selected mode against the discovered modes. The mode picker
  // shows modeOptions[0] when the stored mode isn't in the list (e.g. a stale
  // globally-remembered mode this workspace's provider config no longer
  // defines), so the submitted mode must match that display rather than send a
  // stale mode the provider would reject.
  const modeOptionIds = composerState.modeOptions.map((mode) => mode.id);
  const reconciledMode = modeOptionIds.includes(composerState.selectedMode)
    ? composerState.selectedMode
    : (modeOptionIds[0] ?? "");
  return {
    provider,
    cwd: workspaceDirectory,
    workspaceId,
    ...(reconciledMode !== "" ? { modeId: reconciledMode } : {}),
    ...(composerState.effectiveModelId ? { model: composerState.effectiveModelId } : {}),
    ...(composerState.effectiveThinkingOptionId
      ? { thinkingOptionId: composerState.effectiveThinkingOptionId }
      : {}),
    ...(spawnProfileId ? { personality: spawnProfileId } : {}),
    ...(text.trim() ? { initialPrompt: text.trim() } : {}),
    ...(clientMessageId ? { clientMessageId } : {}),
    ...(encodedImages && encodedImages.length > 0 ? { images: encodedImages } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}
