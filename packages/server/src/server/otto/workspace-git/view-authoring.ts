import {
  VIEW_AUTHORING_LABEL,
  viewAuthoringContext,
} from "@getpaseo/plugin/otto/architectural-views";
import type { ArchitecturalViewsService } from "../architectural-views/service.js";
import { readDraft } from "../architectural-views/records.js";
import type { WorkspaceRegistry } from "../../workspace-registry.js";

export async function releaseMovedViewAuthor(input: {
  views: ArchitecturalViewsService | null;
  workspaces: Pick<WorkspaceRegistry, "get">;
  agentId: string;
  workspaceId: string;
  hostId: string;
  labels: Record<string, string>;
}) {
  const binding = viewAuthoringContext(input.labels, input.hostId);
  if (!binding) return null;
  if (!input.views)
    throw new Error("Architecture must be available before moving this authoring chat.");
  const workspace = await input.workspaces.get(input.workspaceId);
  if (!workspace || binding.workspaceId !== workspace.workspaceId) {
    throw new Error("Detach this chat from its Architecture draft before moving it.");
  }
  const { projectId } = workspace;
  const store = await input.views.library.store(projectId, binding.identity);
  const draft = await readDraft(store, binding.identity.viewId, binding.draftId);
  if (draft?.value.authoringAgentId === input.agentId)
    await input.views.drafts.bindAuthor(
      projectId,
      binding.identity,
      binding.draftId,
      draft.revision,
      null,
    );
  return VIEW_AUTHORING_LABEL;
}
