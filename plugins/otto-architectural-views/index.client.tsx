import { useCallback } from "react";
import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import {
  ArchitecturalViewsScreen,
  ArchitecturalViewsWorkspace,
} from "@getpaseo/plugin/client/otto-architectural-views";
const ARCHITECTURE_ICON = "Network";
function Navigation({ currentScreen, openScreen }: PluginSidebarItemProps) {
  const open = useCallback(() => openScreen({ screenId: "views" }), [openScreen]);
  return (
    <SidebarRow
      icon={ARCHITECTURE_ICON}
      label="Architecture"
      active={currentScreen?.screenId === "views"}
      onPress={open}
    />
  );
}
export default function contribute(client: PluginClientContext) {
  const cleanups = [
    client.addScreen({
      id: "views",
      title: "Architecture",
      Component: ArchitecturalViewsScreen,
    }),
    client.addSidebarHeaderItem({
      id: "views",
      title: "Architecture",
      icon: ARCHITECTURE_ICON,
      Component: Navigation,
    }),
    client.addWorkspacePanel({
      id: "views",
      title: "Architecture",
      icon: "Network",
      context: "workspace",
      Component: ArchitecturalViewsWorkspace,
    }),
    client.addCommandCenterItem({
      id: "open-views",
      title: "Open Architecture",
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
