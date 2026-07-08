import { buildWorkspaceTabPersistenceKey } from "@/stores/workspace-tabs-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";

export interface OpenArtifactTabInput {
  serverId: string;
  workspaceId: string;
  artifactId: string;
  /** Route to the workspace after opening (for opens from outside it). */
  navigate?: boolean;
}

/**
 * Open (or focus) an artifact as a workspace tab. Reuses the same layout store
 * the New Browser / preview buttons use, so artifact tabs live in the tab strip
 * and are switchable like any other tab.
 */
export function openArtifactTab(input: OpenArtifactTabInput): boolean {
  const workspaceKey = buildWorkspaceTabPersistenceKey({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  if (!workspaceKey) {
    return false;
  }
  useWorkspaceLayoutStore
    .getState()
    .openTabFocused(workspaceKey, { kind: "artifact", artifactId: input.artifactId });
  if (input.navigate) {
    navigateToWorkspace(input.serverId, input.workspaceId);
  }
  return true;
}
