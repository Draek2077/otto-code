import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import {
  useWorkspaceLayoutStore,
  type WorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";

const DiscoveryStateSchema = z.object({
  acknowledgedByWorkspace: z.record(z.string(), z.array(z.string())),
});

interface DiscoveryState {
  acknowledgedByWorkspace: Record<string, string[]>;
  discover: (workspaceKey: string, artifactIds: readonly string[]) => void;
}

// Keep discovery receipts separate from the layout blob: released clients use a
// strict layout schema and would discard their entire layout on an unknown key.
export function createWorkspaceArtifactDiscoveryStore(layoutStore: {
  getState(): Pick<WorkspaceLayoutStore, "reconcileArtifacts">;
}) {
  return create<DiscoveryState>()(
    persist(
      (set, get) => ({
        acknowledgedByWorkspace: {},
        discover: (workspaceKey, artifactIds) => {
          const previous = get().acknowledgedByWorkspace[workspaceKey] ?? [];
          const current = [...new Set(artifactIds)];
          if (
            previous.length === current.length &&
            previous.every((id, index) => id === current[index])
          )
            return;
          layoutStore.getState().reconcileArtifacts(workspaceKey, current, previous);
          set((state) => ({
            acknowledgedByWorkspace: { ...state.acknowledgedByWorkspace, [workspaceKey]: current },
          }));
        },
      }),
      {
        name: "workspace-artifact-discovery-state",
        storage: createValidatedPersistStorage(AsyncStorage, DiscoveryStateSchema),
        partialize: (state) => ({ acknowledgedByWorkspace: state.acknowledgedByWorkspace }),
      },
    ),
  );
}

export const useWorkspaceArtifactDiscoveryStore =
  createWorkspaceArtifactDiscoveryStore(useWorkspaceLayoutStore);

export function useArtifactDiscoveryStoreHydrated(): boolean {
  return useSyncExternalStore(
    useWorkspaceArtifactDiscoveryStore.persist.onFinishHydration,
    useWorkspaceArtifactDiscoveryStore.persist.hasHydrated,
    () => false,
  );
}
