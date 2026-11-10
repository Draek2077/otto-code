import { collectAllTabs, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { useVisualizerBackgroundState } from "./background-state";

/** The window owner observes descriptor removal, not panel unmount. Eviction
 * and A/B workspace retention therefore preserve deliberate graph-only state. */
export function retainVisualizerBackgrounds() {
  return useWorkspaceLayoutStore.subscribe((next, previous) => {
    if (
      next.layoutByWorkspace === previous.layoutByWorkspace &&
      next.sheetsByWorkspace === previous.sheetsByWorkspace
    )
      return;
    const state = useVisualizerBackgroundState.getState();
    if (!Object.keys(state.hidden).length) return;
    const open = new Set<string>();
    for (const [workspace, layout] of Object.entries(next.layoutByWorkspace)) {
      for (const tab of collectAllTabs(layout.root)) open.add(`${workspace}:${tab.tabId}`);
    }
    for (const [workspace, sheets] of Object.entries(next.sheetsByWorkspace)) {
      for (const { tab } of sheets) open.add(`${workspace}:${tab.tabId}`);
    }
    state.prune(open);
  });
}
