import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  type CollapsedProjectsState,
  mergePersistedCollapsedProjects,
  serializeCollapsedProjects,
  setProjectCollapsed,
  setSectionsCollapsed,
  toggleProjectCollapsed,
  toggleStatusGroupCollapsed,
} from "./state";

interface SidebarCollapsedSectionsState extends CollapsedProjectsState {
  toggleProjectCollapsed: (projectKey: string) => void;
  setProjectCollapsed: (projectKey: string, collapsed: boolean) => void;
  setSectionsCollapsed: (input: {
    projectKeys?: readonly string[];
    statusGroupKeys?: readonly string[];
    collapsed: boolean;
  }) => void;
  toggleStatusGroupCollapsed: (statusGroupKey: string) => void;
}

export const useSidebarCollapsedSectionsStore = create<SidebarCollapsedSectionsState>()(
  persist(
    (set) => ({
      collapsedProjectKeys: new Set(),
      collapsedStatusGroupKeys: new Set(),
      toggleProjectCollapsed: (projectKey) =>
        set((state) => toggleProjectCollapsed(state, projectKey)),
      setProjectCollapsed: (projectKey, collapsed) =>
        set((state) => setProjectCollapsed(state, projectKey, collapsed)),
      setSectionsCollapsed: (input) => set((state) => setSectionsCollapsed(state, input)),
      toggleStatusGroupCollapsed: (statusGroupKey) =>
        set((state) => toggleStatusGroupCollapsed(state, statusGroupKey)),
    }),
    {
      name: "sidebar-collapsed-sections",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => serializeCollapsedProjects(state),
      merge: (persistedState, currentState) =>
        mergePersistedCollapsedProjects(
          persistedState as { collapsedProjectKeys?: unknown } | undefined,
          currentState,
        ),
    },
  ),
);
