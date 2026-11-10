import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { persistAppSettings } from "@/hooks/use-settings";
export function activateVisualizerTab() {
  return persistAppSettings({
    visualizerPipOpen: false,
    visualizerBackgroundOpen: false,
    visualizerSurface: "tab",
  });
}
export async function openVisualizerPanel(serverId: string, workspaceId: string) {
  await activateVisualizerTab();
  return useWorkspaceLayoutStore.getState().openTab({
    workspaceKey: `${serverId}:${workspaceId}`,
    target: {
      kind: "plugin",
      pluginId: "otto-visualizer",
      panelId: "visualizer",
      context: "workspace",
    },
    intent: "reveal",
  });
}
