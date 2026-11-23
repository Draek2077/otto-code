import { collectAllTabs, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { useSessionStore } from "@/stores/session-store";
import { createVisualizerFeed, type VisualizerFeedState } from "./feed-owner";
import type { VisualizerBridge } from "./transport";
import type { VisualizerFeedSelection } from "./session-source";
export type { VisualizerFeedState } from "./feed-owner";
export function connectVisualizerFeed(
  serverId: string,
  workspaceId: string,
  bridge: VisualizerBridge,
  publish: (state: VisualizerFeedState) => void,
  demo = false,
  selection?: () => VisualizerFeedSelection,
) {
  const key = serverId + ":" + workspaceId;
  return createVisualizerFeed(
    workspaceId,
    bridge,
    publish,
    {
      readSession: () => useSessionStore.getState().sessions[serverId],
      readTabs: () => {
        const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace[key];
        return layout ? collectAllTabs(layout.root) : [];
      },
      subscribe: useSessionStore.subscribe,
      subscribeLayout: useWorkspaceLayoutStore.subscribe,
    },
    demo,
    selection,
  );
}
