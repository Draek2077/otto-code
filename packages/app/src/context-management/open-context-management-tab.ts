import { buildWorkspaceTabPersistenceKey } from "@/stores/workspace-tabs-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";

export interface OpenContextManagementTabInput {
  serverId: string;
  workspaceId: string;
  /** Route to the workspace after opening (for opens from outside it). */
  navigate?: boolean;
}

/**
 * Open (or focus) the Context Management tab. One per workspace — the report
 * describes the workspace and its provider, so a second tab would only ever
 * show the same thing. Lands next to the tab the user is looking at, the same
 * as the git log pane.
 */
export function openContextManagementTab(input: OpenContextManagementTabInput): boolean {
  const workspaceKey = buildWorkspaceTabPersistenceKey({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  if (!workspaceKey) {
    return false;
  }
  useWorkspaceLayoutStore
    .getState()
    .openTabFocused(workspaceKey, { kind: "contextManagement" }, { insertAfterFocusedTab: true });
  // Opened from the sidebar the tab would otherwise land in a workspace the
  // user isn't looking at, which reads as "nothing happened".
  if (input.navigate) {
    navigateToWorkspace(input.serverId, input.workspaceId);
  }
  return true;
}
