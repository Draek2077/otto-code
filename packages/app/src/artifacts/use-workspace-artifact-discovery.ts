import {
  useWorkspaceArtifactDiscoveryStore,
  useArtifactDiscoveryStoreHydrated,
} from "@/artifacts/workspace-artifact-discovery-store";
import { useEffect } from "react";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { useWorkspaceLayoutStoreHydrated } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

export function useWorkspaceArtifactDiscovery(serverId: string, workspaceId: string): void {
  const artifactIds = useWorkspaceFields(
    serverId,
    workspaceId,
    (workspace) => workspace.artifactIds,
  );
  const layoutHydrated = useWorkspaceLayoutStoreHydrated();
  const discoveryHydrated = useArtifactDiscoveryStoreHydrated();
  useEffect(() => {
    const key = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
    // Missing is an old host or an unavailable snapshot, never an empty library.
    if (!layoutHydrated || !discoveryHydrated || !key || !artifactIds) return;
    useWorkspaceArtifactDiscoveryStore.getState().discover(key, artifactIds);
  }, [serverId, workspaceId, artifactIds, layoutHydrated, discoveryHydrated]);
}
