import { supportsDesktopPaneSplits } from "@/constants/layout";
import { getFeatureEnabledSnapshot } from "@/features/use-feature-enabled";
import {
  buildWorkspaceTabPersistenceKey,
  type WorkspaceTabTarget,
} from "@/stores/workspace-tabs-store";
import {
  collectAllTabs,
  createDefaultLayout,
  findPaneById,
  findPaneContainingTab,
  normalizeLayout,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { workspaceTabTargetsEqual } from "@/workspace-tabs/identity";

export interface OpenVisualizerTabInput {
  serverId: string;
  workspaceId: string;
  /** Scope the tab to an orchestration Run's agent set (see the Runs
   * "Visualize" action in runs-screen.tsx). Omit for the general,
   * workspace-wide Visualizer tab. */
  runId?: string;
}

/**
 * Pane to split the Visualizer out of, or null when it should just open/focus
 * in place: pane splits are unsupported (native), the focused pane has nothing
 * else to watch alongside, or the tab already lives in a different pane.
 */
function findVisualizerSplitTarget(
  workspaceKey: string,
  target: WorkspaceTabTarget,
): string | null {
  if (!supportsDesktopPaneSplits()) {
    return null;
  }
  const layout = normalizeLayout(
    useWorkspaceLayoutStore.getState().layoutByWorkspace[workspaceKey] ?? createDefaultLayout(),
  );
  const focusedPane = findPaneById(layout.root, layout.focusedPaneId);
  if (!focusedPane) {
    return null;
  }
  const existingTab = collectAllTabs(layout.root).find((tab) =>
    workspaceTabTargetsEqual(tab.target, target),
  );
  if (existingTab && findPaneContainingTab(layout.root, existingTab.tabId)?.id !== focusedPane.id) {
    return null;
  }
  const hasCompanionTabs = focusedPane.tabIds.some((tabId) => tabId !== existingTab?.tabId);
  return hasCompanionTabs ? focusedPane.id : null;
}

/**
 * Open (or focus) the Visualizer tab for a workspace. One instance per
 * workspace (or per run, when `runId` is given) — reopening focuses the
 * existing tab. The Visualizer is a companion view — the user watches it
 * alongside the chat or orchestration that's beginning — so it opens in a
 * split to the right of the focused pane rather than covering it. When it's
 * already split out into another pane, or there's nothing in the focused pane
 * to watch alongside, it opens/focuses in place.
 */
export function openVisualizerTab(input: OpenVisualizerTabInput): boolean {
  // Central gate: the Visualizer feature must be enabled to open its tab. Every
  // entry point (header button, Runs "Visualize") funnels through here, so this
  // one check covers them all even if a caller forgets to hide its control.
  if (!getFeatureEnabledSnapshot("visualizer")) {
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
    kind: "visualizer",
    ...(input.runId ? { runId: input.runId } : {}),
  };
  const splitTargetPaneId = findVisualizerSplitTarget(workspaceKey, target);
  const tabId = useWorkspaceLayoutStore
    .getState()
    .openTabFocused(workspaceKey, target, { insertAfterFocusedTab: true });
  if (tabId && splitTargetPaneId) {
    // Depth-capped splits return null; the tab then simply stays in place.
    useWorkspaceLayoutStore.getState().splitPane(workspaceKey, {
      tabId,
      targetPaneId: splitTargetPaneId,
      position: "right",
    });
  }
  return true;
}
