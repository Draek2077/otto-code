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
      icon: "Orbit",
      context: "workspace",
      Component: VisualizerWorkspace,
    }),
    client.addSettingsScreen({
      id: "visualizer",
      title: "Visualizer",
      icon: "Orbit",
      Component: VisualizerSettings,
    }),
    client.addCommandCenterItem({
      id: "visualizer",
      title: "Open Visualizer",
      icon: "Orbit",
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
