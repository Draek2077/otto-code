import { buildWorkspaceTabPersistenceKey } from "@/stores/workspace-tabs-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
export function openProjectKnowledgeTab(input: {
  serverId: string;
  workspaceId: string;
  navigate?: boolean;
}): boolean {
  const key = buildWorkspaceTabPersistenceKey(input);
  if (!key) return false;
  useWorkspaceLayoutStore
    .getState()
    .openTabFocused(key, { kind: "projectKnowledge" }, { insertAfterFocusedTab: true });
  if (input.navigate) navigateToWorkspace(input);
  return true;
}
