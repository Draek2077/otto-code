import { useCallback } from "react";
import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import {
  ProjectKnowledgeWorkspace,
  ProjectKnowledgeScreen,
  ProjectKnowledgeSettings,
} from "@getpaseo/plugin/client/otto-knowledge";
function KnowledgeSidebar({ currentScreen, openScreen }: PluginSidebarItemProps) {
  const open = useCallback(() => openScreen({ screenId: "knowledge" }), [openScreen]);
  return (
    <SidebarRow
      icon="BookOpen"
      label="Project Knowledge"
      active={currentScreen?.screenId === "knowledge"}
      onPress={open}
    />
  );
}
export default function contribute(client: PluginClientContext) {
  const cleanups = [
    client.addWorkspacePanel({
      id: "knowledge",
      title: "Project Knowledge",
      icon: "BookOpen",
      context: "workspace",
      Component: ProjectKnowledgeWorkspace,
    }),
    client.addScreen({
      id: "knowledge",
      title: "Project Knowledge",
      Component: ProjectKnowledgeScreen,
    }),
    client.addSettingsScreen({
      id: "knowledge",
      title: "Project Knowledge",
      icon: "BookOpen",
      Component: ProjectKnowledgeSettings,
    }),
    client.addSidebarHeaderItem({
      id: "knowledge",
      title: "Project Knowledge",
      Component: KnowledgeSidebar,
    }),
    client.addCommandCenterItem({
      id: "open-knowledge",
      title: "Open Project Knowledge",
      icon: "BookOpen",
      context: "workspace",
      onSelect({ openPanel }) {
        openPanel("knowledge");
      },
    }),
  ];
  return async () => {
    for (const cleanup of cleanups.toReversed()) await cleanup();
  };
}
