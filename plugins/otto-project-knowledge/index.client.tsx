import { useCallback } from "react";
import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import {
  ProjectKnowledgeWorkspace,
  ProjectKnowledgeScreen,
  ProjectKnowledgeSettings,
} from "@getpaseo/plugin/client/otto-knowledge";
import * as knowledgeUi from "@getpaseo/plugin/client/otto-knowledge";
function KnowledgeSidebar({ currentScreen, openScreen }: PluginSidebarItemProps) {
  const open = useCallback(() => openScreen({ screenId: "knowledge" }), [openScreen]);
  return (
    <SidebarRow
      icon="BookOpen"
      label="Knowledge"
      active={currentScreen?.screenId === "knowledge"}
      onPress={open}
    />
  );
}
function ContextSidebar({ currentScreen, openScreen }: PluginSidebarItemProps) {
  const open = useCallback(() => openScreen({ screenId: "context-management" }), [openScreen]);
  return (
    <SidebarRow
      icon="Layers"
      label="Context"
      active={currentScreen?.screenId === "context-management"}
      onPress={open}
    />
  );
}
function registerContext(client: PluginClientContext) {
  const { ContextManagementWorkspace, ContextManagementScreen } = knowledgeUi;
  // COMPAT(ottoContextUi): added v0.10.0; remove after 2027-04-25 when app floor includes this bridge.
  // Older apps keep Knowledge usable without importing an unknown private module.
  if (!ContextManagementWorkspace || !ContextManagementScreen) return [];
  return [
    client.addSidebarHeaderItem({
      id: "context-management",
      title: "Context",
      Component: ContextSidebar,
    }),
    client.addWorkspacePanel({
      id: "context-management",
      title: "Context Management",
      icon: "Layers",
      context: "workspace",
      Component: ContextManagementWorkspace,
    }),
    client.addScreen({
      id: "context-management",
      title: "Context Management",
      Component: ContextManagementScreen,
    }),
    client.addCommandCenterItem({
      id: "open-context-management",
      title: "Open Context Management",
      icon: "Layers",
      context: "workspace",
      onSelect({ openPanel }) {
        openPanel("context-management");
      },
    }),
  ];
}
export default function contribute(client: PluginClientContext) {
  const cleanups = [
    ...registerContext(client),
    client.addWorkspacePanel({
      id: "knowledge",
      title: "Knowledge",
      icon: "BookOpen",
      context: "workspace",
      Component: ProjectKnowledgeWorkspace,
    }),
    client.addScreen({
      id: "knowledge",
      title: "Knowledge",
      Component: ProjectKnowledgeScreen,
    }),
    client.addSettingsScreen({
      id: "knowledge",
      title: "Knowledge",
      icon: "BookOpen",
      Component: ProjectKnowledgeSettings,
    }),
    client.addSidebarHeaderItem({
      id: "knowledge",
      title: "Knowledge",
      Component: KnowledgeSidebar,
    }),
    client.addCommandCenterItem({
      id: "open-knowledge",
      title: "Open Knowledge",
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
