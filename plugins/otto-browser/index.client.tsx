import type { PluginClientContext } from "@getpaseo/plugin/client";
import { PreviewWorkspace } from "@getpaseo/plugin/client/otto-preview";
export default function contribute(client: PluginClientContext) {
  const cleanups = [
    client.addWorkspacePanel({
      id: "preview",
      title: "Preview Servers",
      icon: "MonitorPlay",
      context: "workspace",
      Component: PreviewWorkspace,
    }),
    client.addCommandCenterItem({
      id: "open-preview",
      title: "Manage Preview servers",
      icon: "MonitorPlay",
      context: "workspace",
      onSelect({ openPanel }) {
        openPanel("preview");
      },
    }),
  ];
  return async () => {
    for (const cleanup of cleanups.toReversed()) await cleanup();
  };
}
