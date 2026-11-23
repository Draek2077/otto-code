import type { PluginOpenScreenInput } from "@getpaseo/plugin/client";
import { getLastWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import { parseHostWorkspaceRouteFromPathname } from "@/utils/host-routes";
import { resolveWorkspaceMapKeyByIdentity } from "@/utils/workspace-identity";
import { kanbanProjectContext } from "./navigation-context";

export function withKanbanProjectContext(
  plugin: { id: string; serverId: string },
  input: PluginOpenScreenInput,
  pathname?: string,
): PluginOpenScreenInput {
  if (plugin.id !== "otto-kanban") return input;
  return kanbanProjectContext(plugin, input, {
    active: pathname ? parseHostWorkspaceRouteFromPathname(pathname) : null,
    last: getLastWorkspaceSelection(),
    projectForWorkspace(serverId, workspaceId) {
      const workspaces = useSessionStore.getState().sessions[serverId]?.workspaces;
      const key = resolveWorkspaceMapKeyByIdentity({ workspaces, workspaceId });
      const workspace = key ? workspaces?.get(key) : null;
      return workspace && !workspace.archivingAt ? workspace.projectId : null;
    },
  });
}
