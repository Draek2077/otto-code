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
  const { pluginRegistry } = await import("@/plugins/registry");
  const plugin = pluginRegistry
    .getSnapshot()
    .find((entry) => entry.serverId === serverId && entry.id === "otto-visualizer");
  if (
    !plugin?.workspacePanels.some(
      (panel) => panel.id === "visualizer" && panel.context === "workspace",
    )
  ) {
    throw new Error("Update or reconnect the host to use Visualizer.");
  }
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
