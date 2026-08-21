import type { normalizeWorkspaceDescriptor } from "@/stores/session-store";
import type { MessagePayload } from "@/composer/types";
import type { AgentAttachment } from "@otto-code/protocol/messages";
import { navigateToPreparedWorkspaceTab } from "@/utils/workspace-navigation";

export function isEmptyWorkspaceSubmission(payload: MessagePayload): boolean {
  return !payload.text.trim() && payload.attachments.length === 0;
}

export interface CreateEmptyWorkspaceInput {
  payload: MessagePayload;
  ensureWorkspace: (input: {
    cwd: string;
    prompt: string;
    attachments: AgentAttachment[];
    withInitialAgent: boolean;
  }) => Promise<ReturnType<typeof normalizeWorkspaceDescriptor>>;
  serverId: string;
  navigate: (serverId: string, workspaceId: string) => void;
}

export async function runCreateEmptyWorkspace(input: CreateEmptyWorkspaceInput): Promise<void> {
  const { payload, ensureWorkspace, serverId, navigate } = input;
  const ensuredWorkspace = await ensureWorkspace({
    cwd: payload.cwd,
    prompt: "",
    attachments: [],
    withInitialAgent: false,
  });
  navigate(serverId, ensuredWorkspace.id);
}

export interface StartEmptyWorkspaceInput {
  ensureWorkspace: CreateEmptyWorkspaceInput["ensureWorkspace"];
  serverId: string;
  sourceDirectory: string | null;
}

export async function runStartEmptyWorkspace(input: StartEmptyWorkspaceInput): Promise<void> {
  const { ensureWorkspace, serverId, sourceDirectory } = input;
  const ensuredWorkspace = await ensureWorkspace({
    cwd: sourceDirectory ?? "",
    prompt: "",
    attachments: [],
    withInitialAgent: false,
  });
  navigateToPreparedWorkspaceTab({
    serverId,
    workspaceId: ensuredWorkspace.id,
    target: { kind: "draft", draftId: "new" },
  });
}
