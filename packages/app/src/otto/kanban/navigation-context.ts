import type { PluginOpenScreenInput } from "@getpaseo/plugin/client";

interface Selection {
  serverId: string;
  workspaceId: string;
}
interface Context {
  active: Selection | null;
  last: Selection | null;
  projectForWorkspace(serverId: string, workspaceId: string): string | null;
}

/** A missing hint may use app-owned workspace context, never an arbitrary project or another host. */
export function kanbanProjectContext(
  plugin: { id: string; serverId: string },
  input: PluginOpenScreenInput,
  context: Context,
): PluginOpenScreenInput {
  if (plugin.id !== "otto-kanban" || input.screenId !== "board") return input;
  const params = input.params ?? {};
  if (params.projectId || params.projectHostId) return input;
  const candidates = params.workspaceId
    ? [{ serverId: plugin.serverId, workspaceId: params.workspaceId }]
    : [context.active, context.last];
  for (const selection of candidates) {
    if (!selection || selection.serverId !== plugin.serverId) continue;
    const projectId = context.projectForWorkspace(selection.serverId, selection.workspaceId);
    if (projectId)
      return {
        ...input,
        params: { ...params, projectHostId: plugin.serverId, projectId },
      };
  }
  return input;
}
