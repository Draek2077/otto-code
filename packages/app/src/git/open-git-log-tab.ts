import { buildWorkspaceTabPersistenceKey } from "@/stores/workspace-tabs-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";

export interface OpenGitLogTabInput {
  serverId: string;
  workspaceId: string;
  operation: string;
}

/**
 * Open (or focus) the log pane for a git operation. One tab per operation per
 * workspace — reopening the same operation focuses the existing tab. New tabs
 * land right next to the tab the user is looking at.
 */
export function openGitLogTab(input: OpenGitLogTabInput): boolean {
  const workspaceKey = buildWorkspaceTabPersistenceKey({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  if (!workspaceKey) {
    return false;
  }
  useWorkspaceLayoutStore
    .getState()
    .openTabFocused(
      workspaceKey,
      { kind: "gitLog", operation: input.operation },
      { insertAfterFocusedTab: true },
    );
  return true;
}
