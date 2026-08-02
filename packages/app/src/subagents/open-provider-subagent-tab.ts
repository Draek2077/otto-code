import { buildWorkspaceTabPersistenceKey } from "@/stores/workspace-tabs-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";

export interface OpenProviderSubagentTabInput {
  serverId: string;
  workspaceId: string;
  parentAgentId: string;
  subagentId: string;
  /** Route to the workspace after opening (for opens from outside it). */
  navigate?: boolean;
}

/**
 * Open (or focus) a provider subagent as a workspace tab.
 *
 * Provider subagents are not agents. Otto's own observed subagents each have a
 * real agent id and open through `navigateToAgent`; a provider subagent (a
 * Claude sidechain, say) exists only as a row inside its parent's timeline and
 * is identified by the `(parentAgentId, subagentId)` pair. Sending one through
 * the agent route asks the daemon for an agent id that was never registered,
 * which is exactly what the track rows used to do.
 */
export function openProviderSubagentTab(input: OpenProviderSubagentTabInput): boolean {
  const workspaceKey = buildWorkspaceTabPersistenceKey({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  if (!workspaceKey) {
    return false;
  }
  useWorkspaceLayoutStore.getState().openTabFocused(workspaceKey, {
    kind: "provider_subagent",
    parentAgentId: input.parentAgentId,
    subagentId: input.subagentId,
  });
  if (input.navigate) {
    navigateToWorkspace({ serverId: input.serverId, workspaceId: input.workspaceId });
  }
  return true;
}
