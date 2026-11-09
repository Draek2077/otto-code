import { useCallback } from "react";
import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import {
  ArchitecturalViewsScreen,
  ArchitecturalViewsWorkspace,
} from "@getpaseo/plugin/client/otto-architectural-views";
function Navigation({ currentScreen, openScreen }: PluginSidebarItemProps) {
  const open = useCallback(() => openScreen({ screenId: "views" }), [openScreen]);
  return (
    <SidebarRow
      icon="Network"
      label="Architectural Views"
      active={currentScreen?.screenId === "views"}
      onPress={open}
    />
  );
}
export default function contribute(client: PluginClientContext) {
  const cleanups = [
    client.addScreen({
      id: "views",
      title: "Architectural Views",
      Component: ArchitecturalViewsScreen,
    }),
    client.addSidebarHeaderItem({
      id: "views",
      title: "Architectural Views",
      Component: Navigation,
    }),
    client.addWorkspacePanel({
      id: "views",
      title: "Architectural Views",
      icon: "Network",
      context: "workspace",
      Component: ArchitecturalViewsWorkspace,
    }),
    client.addCommandCenterItem({
      id: "open-views",
      title: "Open Architectural Views",
      icon: "Network",
      context: "workspace",
      onSelect({ openPanel }) {
        openPanel("views");
      },
    }),
  ];
  return async () => {
    for (const cleanup of cleanups.toReversed()) await cleanup();
  };
}
