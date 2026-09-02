import { buildWorkspaceTabPersistenceKey } from "@/stores/workspace-tabs-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";

export interface OpenGitLogTabInput {
  serverId: string;
  workspaceId: string;
  operation: string;
  /** New logs prefer this pane without moving an existing user-placed tab. */
  defaultPaneId?: string;
}

/**
 * Open (or focus) the log pane for a git operation. One tab per operation per
 * workspace - reopening the same operation focuses the existing tab. A caller
 * may give new tabs a preferred pane without moving an existing user-placed log.
 */
export function openGitLogTab(input: OpenGitLogTabInput): boolean {
  const workspaceKey = buildWorkspaceTabPersistenceKey({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  if (!workspaceKey) {
    return false;
  }
  const target = { kind: "gitLog" as const, operation: input.operation };
  const layout = useWorkspaceLayoutStore.getState();
  if (input.defaultPaneId) {
    layout.openTab({
      workspaceKey,
      target,
      intent: "reveal",
      placement: { mode: "prefer", paneId: input.defaultPaneId },
    });
  } else {
    layout.openTabFocused(workspaceKey, target, { insertAfterFocusedTab: true });
  }
  return true;
}
