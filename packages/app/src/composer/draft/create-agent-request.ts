import type { AgentSessionConfig } from "@otto-code/protocol/agent-types";
import type { AgentSnapshotPayload, CreateAgentRequestMessage } from "@otto-code/protocol/messages";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import { encodeImages } from "@/utils/encode-images";
import type { UserMessageImageAttachment } from "@/types/stream";

export interface WorkspaceDraftAgentRequest {
  workspaceId: string;
  config: AgentSessionConfig;
  text: string;
  clientMessageId: string;
  images?: UserMessageImageAttachment[];
  attachments?: CreateAgentRequestMessage["attachments"];
  personality?: CreateAgentRequestMessage["personality"];
  architecturalViewDraft?: CreateAgentRequestMessage["architecturalViewDraft"];
}

/**
 * Shared by the workspace draft tab and by the new-workspace screen when it finishes creation
 * after the user has already navigated away and no draft tab will ever mount.
 */
export async function requestWorkspaceDraftAgent(
  client: DaemonClient,
  request: WorkspaceDraftAgentRequest,
): Promise<AgentSnapshotPayload> {
  const images = await encodeImages(request.images);
  return await client.createAgent({
    config: request.config,
    workspaceId: request.workspaceId,
    clientMessageId: request.clientMessageId,
    ...(request.personality ? { personality: request.personality } : {}),
    ...(request.architecturalViewDraft
      ? { architecturalViewDraft: request.architecturalViewDraft }
      : {}),
    ...(request.text ? { initialPrompt: request.text } : {}),
    ...(images && images.length > 0 ? { images } : {}),
    ...(request.attachments && request.attachments.length > 0
      ? { attachments: request.attachments }
      : {}),
  });
}
