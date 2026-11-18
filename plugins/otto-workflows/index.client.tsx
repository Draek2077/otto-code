import { useCallback } from "react";
import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import {
  WorkflowsScreen,
  WorkflowsWorkspace,
  WorkflowsSettings,
} from "@getpaseo/plugin/client/otto-workflows";
const WORKFLOW_ICON = "Workflow";
function Navigation({ currentScreen, openScreen }: PluginSidebarItemProps) {
  const open = useCallback(() => openScreen({ screenId: "workflows" }), [openScreen]);
  return (
    <SidebarRow
      icon={WORKFLOW_ICON}
      label="Workflows"
      active={currentScreen?.screenId === "workflows"}
      onPress={open}
    />
  );
}
export default function contribute(client: PluginClientContext) {
  const releases = [
    client.addScreen({ id: "workflows", title: "Workflows", Component: WorkflowsScreen }),
    client.addSidebarHeaderItem({
      id: "workflows",
      title: "Workflows",
      icon: WORKFLOW_ICON,
      Component: Navigation,
    }),
    client.addWorkspacePanel({
      id: "workflows",
      title: "Workflows",
      icon: "Workflow",
      context: "workspace",
      Component: WorkflowsWorkspace,
    }),
    client.addSettingsScreen({
      id: "workflows",
      title: "Workflows",
      icon: "Workflow",
      Component: WorkflowsSettings,
    }),
    client.addCommandCenterItem({
      id: "open-workflows",
      title: "Open Workflows",
      icon: "Workflow",
      context: "workspace",
      onSelect({ openPanel }) {
        openPanel("workflows");
      },
    }),
  ];
  return async () => {
    for (const release of releases.toReversed()) await release();
  };
}
