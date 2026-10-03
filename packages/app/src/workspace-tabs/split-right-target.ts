import {
  collectAllTabs,
  createDefaultLayout,
  findPaneById,
  findPaneContainingTab,
  normalizeLayout,
} from "@/stores/workspace-layout-actions";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";

/** The caller's chat pane (otherwise the focused pane) to open beside. */
export function findSplitRightTarget(workspaceKey: string, agentId?: string): string | null {
  const layout = normalizeLayout(
    useWorkspaceLayoutStore.getState().layoutByWorkspace[workspaceKey] ?? createDefaultLayout(),
  );
  const callerTab = agentId
    ? collectAllTabs(layout.root).find(
        (tab) => tab.target.kind === "agent" && tab.target.agentId === agentId,
      )
    : null;
  const focusedPaneId =
    (callerTab ? findPaneContainingTab(layout.root, callerTab.tabId)?.id : null) ??
    layout.focusedPaneId;
  // A pane holding only the New tab placeholder is empty for this purpose: the
  // default layout seeds one, and counting it would split every fresh workspace
  // rather than letting the preview take the pane that is already there.
  const focusedPaneTabIds = new Set(findPaneById(layout.root, focusedPaneId)?.tabIds ?? []);
  const focusedPaneHadTabs = collectAllTabs(layout.root).some(
    (tab) => focusedPaneTabIds.has(tab.tabId) && tab.target.kind !== "new_tab",
  );
  return focusedPaneId && focusedPaneHadTabs ? focusedPaneId : null;
}
