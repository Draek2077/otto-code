import type {
  PluginClientContext,
  PluginClientContribution,
  PluginScreenProps,
  PluginSidebarItemProps,
} from "@getpaseo/plugin/client";
import { useCallback } from "react";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { KanbanScreen } from "./screen.js";
import type { ProjectSelection } from "./project-selection.js";
import { ProjectTargetDrafts } from "./target-drafts.js";
import { KanbanProjectSettings } from "./project-settings.js";
import { BoardActionDrafts } from "./action-drafts.js";

function KanbanSidebar({ currentScreen, openScreen }: PluginSidebarItemProps) {
  const openBoard = useCallback(() => openScreen({ screenId: "board" }), [openScreen]);
  return (
    <SidebarRow
      icon="Kanban"
      label="Kanban"
      active={currentScreen?.screenId === "board"}
      onPress={openBoard}
    />
  );
}

function screenFor(client: PluginClientContext, actionDrafts: BoardActionDrafts) {
  return function Screen(props: PluginScreenProps) {
    const selectProject = useCallback(
      (selection: ProjectSelection) =>
        client.openScreen({
          screenId: "board",
          params: { projectHostId: selection.hostId, projectId: selection.projectId },
        }),
      [],
    );
    return (
      <KanbanScreen {...props} onProjectSelection={selectProject} actionDrafts={actionDrafts} />
    );
  };
}

export function createKanbanClientContribution(): PluginClientContribution {
  return (client) => {
    const drafts = new ProjectTargetDrafts();
    const actionDrafts = new BoardActionDrafts();
    function ProjectSettings(props: PluginScreenProps) {
      return <KanbanProjectSettings {...props} drafts={drafts} />;
    }
    const removeSettings = client.addScreen({
      id: "project-settings",
      title: "Kanban project settings",
      Component: ProjectSettings,
    });
    const removeScreen = client.addScreen({
      id: "board",
      title: "Kanban",
      Component: screenFor(client, actionDrafts),
    });
    const removeSidebar = client.addSidebarHeaderItem({
      id: "kanban",
      title: "Kanban",
      Component: KanbanSidebar,
    });
    const removeCommand = client.addCommandCenterItem({
      id: "open-board",
      context: "workspace",
      title: "Open project Kanban",
      icon: "Kanban",
      onSelect({ workspace, openScreen }) {
        // The app resolves this workspace against the selected installation and
        // supplies its host/project identity. No client filesystem path travels.
        openScreen({ screenId: "board", params: { workspaceId: workspace.id } });
      },
    });
    return async () => {
      await removeCommand();
      await removeSidebar();
      await removeScreen();
      await removeSettings();
      drafts.dispose();
      actionDrafts.dispose();
    };
  };
}
