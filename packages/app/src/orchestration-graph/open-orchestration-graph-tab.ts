import { isDev } from "@/constants/platform";
import {
  buildWorkspaceTabPersistenceKey,
  type WorkspaceTabTarget,
} from "@/stores/workspace-tabs-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";

export interface OpenOrchestrationGraphTabInput {
  serverId: string;
  workspaceId: string;
  graphId: string;
  /** The Draft orchestration the dialog minted, so the designer can run it. */
  runId?: string;
}

/**
 * Open (or focus) the graph designer tab for a graph in a workspace, and
 * navigate there. One designer tab per graph (identity ignores runId — opening
 * with a fresh draft retargets the same tab). Unlike the Visualizer this is a
 * primary working surface, not a companion view, so it opens in place rather
 * than splitting a pane.
 */
export function openOrchestrationGraphTab(input: OpenOrchestrationGraphTabInput): boolean {
  // Dev builds only while the designer is under construction — the last door
  // into it, so release bundles can never end up with a graph tab open.
  if (!isDev) {
    return false;
  }
  const workspaceKey = buildWorkspaceTabPersistenceKey({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  if (!workspaceKey) {
    return false;
  }
  const target: WorkspaceTabTarget = {
    kind: "orchestrationGraph",
    graphId: input.graphId,
    ...(input.runId ? { runId: input.runId } : {}),
  };
  useWorkspaceLayoutStore
    .getState()
    .openTabFocused(workspaceKey, target, { insertAfterFocusedTab: true });
  navigateToWorkspace(input.serverId, input.workspaceId);
  return true;
}
