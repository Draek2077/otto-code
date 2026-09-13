import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { selectHostFeature } from "@/runtime/host-features";
import { useSessionStore } from "@/stores/session-store";
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
export async function openArtifactTab(input: OpenArtifactTabInput): Promise<boolean> {
  const workspaceKey = buildWorkspaceTabPersistenceKey({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  if (!workspaceKey) {
    return false;
  }
  // COMPAT(artifactWorkspaceDiscovery): added in v0.9.11, remove after 2027-03-12.
  if (
    !selectHostFeature(useSessionStore.getState(), input.serverId, "artifactWorkspaceDiscovery")
  ) {
    throw new Error("Update the host to add artifacts to a shared workspace.");
  }
  const client = getHostRuntimeStore().getClient(input.serverId);
  if (!client)
    throw new Error("Host is disconnected. Reconnect and try adding the artifact again.");
  const response = await client.artifactAttachWorkspace({
    workspaceId: input.workspaceId,
    artifactId: input.artifactId,
  });
  if (!response.success) throw new Error(response.error ?? "Failed to add artifact to workspace");
  useWorkspaceLayoutStore
    .getState()
    .openTabFocused(workspaceKey, { kind: "artifact", artifactId: input.artifactId });
  if (input.navigate) {
    navigateToWorkspace({ serverId: input.serverId, workspaceId: input.workspaceId });
  }
  return true;
}
