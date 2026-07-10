import type { normalizeWorkspaceDescriptor } from "@/stores/session-store";
import type { AgentAttachment } from "@otto-code/protocol/messages";
import type { DaemonClient } from "@otto-code/client/internal/daemon-client";
import { navigateToPreparedWorkspaceTab } from "@/utils/workspace-navigation";
import { createWorkspaceFileTabTarget } from "@/workspace/file-open";
import { toErrorMessage } from "@/utils/error-messages";
import { buildWorkspaceTabPersistenceKey } from "@/stores/workspace-tabs-store";
import { setFileViewModeFor } from "@/stores/file-view-store";

const README_FILENAME_PATTERN = /^readme(\.md)?$/i;

export interface ResolveReadmeFileNameInput {
  sourceDirectory: string | null;
  getClient: () => Pick<DaemonClient, "listDirectory">;
}

export async function resolveReadmeFileName(
  input: ResolveReadmeFileNameInput,
): Promise<string | null> {
  const { sourceDirectory, getClient } = input;
  if (!sourceDirectory) {
    throw new Error("Choose a project");
  }
  const directory = await getClient().listDirectory(sourceDirectory, ".");
  const readmeEntry = directory.entries.find(
    (entry) => entry.kind === "file" && README_FILENAME_PATTERN.test(entry.name),
  );
  return readmeEntry?.name ?? null;
}

export interface RunViewDocumentationInput {
  readmeFileName: string;
  ensureWorkspace: (input: {
    cwd: string;
    prompt: string;
    attachments: AgentAttachment[];
    withInitialAgent: boolean;
  }) => Promise<ReturnType<typeof normalizeWorkspaceDescriptor>>;
  serverId: string;
  sourceDirectory: string | null;
  onError: (message: string) => void;
}

export async function runViewDocumentation(input: RunViewDocumentationInput): Promise<void> {
  const { readmeFileName, ensureWorkspace, serverId, sourceDirectory, onError } = input;
  try {
    const ensuredWorkspace = await ensureWorkspace({
      cwd: sourceDirectory ?? "",
      prompt: "",
      attachments: [],
      withInitialAgent: false,
    });
    const persistenceKey = buildWorkspaceTabPersistenceKey({
      serverId,
      workspaceId: ensuredWorkspace.id,
    });
    if (persistenceKey) {
      setFileViewModeFor({ persistenceKey, path: readmeFileName, mode: "preview" });
    }
    navigateToPreparedWorkspaceTab({
      serverId,
      workspaceId: ensuredWorkspace.id,
      target: createWorkspaceFileTabTarget({ path: readmeFileName }),
    });
  } catch (error) {
    onError(toErrorMessage(error));
  }
}
