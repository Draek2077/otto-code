import type { PluginClientContext } from "@getpaseo/plugin/client";
import {
  VisualizerWorkspace,
  VisualizerSettings,
  activateVisualizerTab,
} from "@getpaseo/plugin/client/otto-visualizer";
export default function contribute(client: PluginClientContext) {
  const cleanups = [
    client.addWorkspacePanel({
      id: "visualizer",
      title: "Visualizer",
      icon: "Waypoints",
      context: "workspace",
      Component: VisualizerWorkspace,
    }),
    client.addSettingsScreen({
      id: "visualizer",
      title: "Visualizer",
      icon: "Waypoints",
      Component: VisualizerSettings,
    }),
    client.addCommandCenterItem({
      id: "visualizer",
      title: "Open Visualizer",
      icon: "Waypoints",
      context: "workspace",
      async onSelect({ openPanel }) {
        await activateVisualizerTab();
        openPanel("visualizer");
      },
    }),
  ];
  return async () => {
    for (const cleanup of cleanups.toReversed()) await cleanup();
  };
}
