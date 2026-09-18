import { createContext, useContext } from "react";
import {
  collectAllTabs,
  useWorkspaceLayoutStore,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-store";

export function getVisualizerTabs(layouts: Record<string, WorkspaceLayout>) {
  return Object.entries(layouts).flatMap(([workspaceKey, layout]) =>
    collectAllTabs(layout.root)
      .filter((tab) => tab.target.kind === "visualizer")
      .map((tab) => ({ workspaceKey, tab })),
  );
}

export function visualizerTabOwnerKey(workspaceKey: string, tabId: string): string {
  return JSON.stringify([workspaceKey, tabId]);
}

export const VisualizerActiveWorkspaceContext = createContext<string | null>(null);

/** Only the active workspace can own a live tab guest. Other workspaces keep
 * their tab descriptors, but those tabs never allocate a renderer. */
export function useVisualizerTabOwnerKey(): string | null {
  const activeWorkspaceKey = useContext(VisualizerActiveWorkspaceContext);
  return useWorkspaceLayoutStore((state) => {
    const owner = getVisualizerTabs(state.layoutByWorkspace).find(
      (entry) => entry.workspaceKey === activeWorkspaceKey,
    );
    return owner ? visualizerTabOwnerKey(owner.workspaceKey, owner.tab.tabId) : null;
  });
}

export function closeVisualizerTabs(workspaceKey: string, exceptTabId?: string): void {
  const store = useWorkspaceLayoutStore.getState();
  for (const { workspaceKey: tabWorkspaceKey, tab } of getVisualizerTabs(store.layoutByWorkspace)) {
    if (tabWorkspaceKey === workspaceKey && tab.tabId !== exceptTabId) {
      store.closeTab(workspaceKey, tab.tabId);
    }
  }
}
