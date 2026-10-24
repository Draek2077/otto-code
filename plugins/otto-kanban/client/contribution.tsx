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

function screenFor(client: PluginClientContext) {
  return function Screen(props: PluginScreenProps) {
    const selectProject = useCallback(
      (selection: ProjectSelection) =>
        client.openScreen({
          screenId: "board",
          params: { projectHostId: selection.hostId, projectId: selection.projectId },
        }),
      [],
    );
    return <KanbanScreen {...props} onProjectSelection={selectProject} />;
  };
}

// Intentionally not an index.client entry. Registration and the host bridge
// remain a separately reviewed integration step.
export function createKanbanClientContribution(): PluginClientContribution {
  return (client) => {
    const removeScreen = client.addScreen({
      id: "board",
      title: "Kanban",
      Component: screenFor(client),
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
        // A workspace command has no public host identity in its context.
        // The selected installation remains authoritative; a typed host hint
        // must be supplied by the navigation bridge before auto-selecting.
        openScreen({ screenId: "board", params: { workspaceId: workspace.id } });
      },
    });
    return async () => {
      await removeCommand();
      await removeSidebar();
      await removeScreen();
    };
  };
}
