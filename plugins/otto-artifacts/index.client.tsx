import { useCallback } from "react";
import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import {
  ArtifactsScreen,
  ArtifactsWorkspace,
  ArtifactsSettings,
} from "@getpaseo/plugin/client/otto-artifacts";
function ArtifactsNavigation({ currentScreen, openScreen }: PluginSidebarItemProps) {
  const open = useCallback(() => openScreen({ screenId: "artifacts" }), [openScreen]);
  return (
    <SidebarRow
      icon="PanelsTopLeft"
      label="Artifacts"
      active={currentScreen?.screenId === "artifacts"}
      onPress={open}
    />
  );
}
export default function contribute(client: PluginClientContext) {
  const cleanups = [
    client.addScreen({ id: "artifacts", title: "Artifacts", Component: ArtifactsScreen }),
    client.addSidebarHeaderItem({
      id: "artifacts",
      title: "Artifacts",
      Component: ArtifactsNavigation,
    }),
    client.addWorkspacePanel({
      id: "artifacts",
      title: "Artifacts",
      icon: "PanelsTopLeft",
      context: "workspace",
      Component: ArtifactsWorkspace,
    }),
    client.addSettingsScreen({
      id: "artifacts",
      title: "Artifacts",
      icon: "PanelsTopLeft",
      Component: ArtifactsSettings,
    }),
    client.addCommandCenterItem({
      id: "open-artifacts",
      title: "Open Artifacts",
      icon: "PanelsTopLeft",
      context: "workspace",
      onSelect({ openPanel }) {
        openPanel("artifacts");
      },
    }),
  ];
  return async () => {
    for (const cleanup of cleanups.toReversed()) await cleanup();
  };
}
