import { buildWorkspaceTabPersistenceKey } from "@/stores/workspace-tabs-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import type { ProjectKnowledgeTabSelection } from "./file-target";
export function openProjectKnowledgeTab(input: {
  serverId: string;
  workspaceId: string;
  navigate?: boolean;
  selection?: ProjectKnowledgeTabSelection;
}): boolean {
  const key = buildWorkspaceTabPersistenceKey(input);
  if (!key) return false;
  useWorkspaceLayoutStore
    .getState()
    .openTabFocused(
      key,
      { kind: "projectKnowledge", ...(input.selection ? { selection: input.selection } : {}) },
      { insertAfterFocusedTab: true },
    );
  if (input.navigate) navigateToWorkspace(input);
  return true;
}
