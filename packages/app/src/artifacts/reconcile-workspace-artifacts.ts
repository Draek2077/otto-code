import {
  AMBIENT_PLACEMENT,
  closeTabInLayout,
  collectAllTabs,
  openTabInLayoutBackground,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-actions";

/** Discover membership once per client; later snapshots must respect local closes. */
export function reconcileWorkspaceArtifacts(input: {
  layout: WorkspaceLayout;
  artifactIds: readonly string[];
  acknowledgedIds: readonly string[];
  explorerSidebarPaneId: string | null;
}): { layout: WorkspaceLayout; acknowledgedIds: string[] } {
  const current = new Set(input.artifactIds);
  const acknowledged = new Set(input.acknowledgedIds);
  let layout = input.layout;
  for (const tab of collectAllTabs(layout.root)) {
    if (
      tab.target.kind === "artifact" &&
      acknowledged.has(tab.target.artifactId) &&
      !current.has(tab.target.artifactId)
    ) {
      layout = closeTabInLayout({ layout, tabId: tab.tabId }) ?? layout;
    }
  }
  for (const artifactId of current) {
    if (acknowledged.has(artifactId)) continue;
    layout =
      openTabInLayoutBackground({
        layout,
        target: { kind: "artifact", artifactId },
        now: Date.now(),
        placement: AMBIENT_PLACEMENT,
        explorerSidebarPaneId: input.explorerSidebarPaneId,
      })?.layout ?? layout;
  }
  return { layout, acknowledgedIds: [...current] };
}
