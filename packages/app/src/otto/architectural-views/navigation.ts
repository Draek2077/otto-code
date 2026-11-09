import { router } from "expo-router";
import { buildPluginSurfaceRoute } from "@/plugins/routes";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { rememberPluginContributionHost, pluginScreensHostKey } from "@/plugins/contribution-host";
import type {
  ViewIdentity,
  ViewReference,
  ViewScope,
  ViewSelection,
} from "@getpaseo/plugin/otto/architectural-views";
export interface ViewDestination {
  reference?: ViewReference;
  identity?: ViewIdentity;
  selection?: ViewSelection;
}
class ViewNavigationIntents {
  private readonly entries = new Map<string, ViewDestination>();
  private readonly listeners = new Set<() => void>();
  private version = 0;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.version;
  get(hostId: string, workspaceId: string) {
    return this.entries.get(JSON.stringify([hostId, workspaceId]));
  }
  set(hostId: string, workspaceId: string, target: ViewDestination) {
    const key = JSON.stringify([hostId, workspaceId]);
    if (!this.entries.has(key) && this.entries.size >= 256)
      this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, target);
    this.version++;
    for (const listener of this.listeners) listener();
  }
}
export const viewNavigationIntents = new ViewNavigationIntents();
/** Existing plugin/workspace routing and native chat targets remain authoritative. */
export function openArchitecturalViews(scope: ViewScope, target: ViewDestination = {}) {
  if (scope.target.kind === "workspace") {
    viewNavigationIntents.set(scope.hostId, scope.target.id, target);
    navigateToWorkspace({
      serverId: scope.hostId,
      workspaceId: scope.target.id,
      target: {
        kind: "plugin",
        pluginId: "otto-architectural-views",
        panelId: "views",
        context: "workspace",
      },
    });
    return;
  }
  rememberPluginContributionHost(pluginScreensHostKey("otto-architectural-views"), scope.hostId);
  router.push(
    buildPluginSurfaceRoute(
      scope.hostId,
      "otto-architectural-views",
      { kind: "surface", id: "views" },
      { projectId: scope.target.id, projectHostId: scope.hostId, target: JSON.stringify(target) },
    ),
  );
}
export function openViewChat(hostId: string, workspaceId: string, agentId: string) {
  navigateToWorkspace({ serverId: hostId, workspaceId, target: { kind: "agent", agentId } });
}
