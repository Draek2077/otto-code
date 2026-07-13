import type { WorkspaceTab, WorkspaceTabTarget } from "@/stores/workspace-tabs-store";

/**
 * Tab kinds that only belong to the Developer interface mode. In User mode the
 * tab strip and pane content filter these out so the workspace reads chat-first
 * (agents, browsers, artifacts) — see the surface inventory (#4) in
 * projects/first-time-wizard/interface-modes.md.
 *
 * This is a *render* filter only: it never mutates the tab/layout stores. The
 * terminals keep running daemon-side, the file tabs stay open in the store, and
 * switching back to Developer restores the strip exactly. Feed the unfiltered
 * list to anything that reconciles or persists store state; feed the filtered
 * list only to what renders.
 */
const DEVELOPER_ONLY_TAB_KINDS: ReadonlySet<WorkspaceTabTarget["kind"]> = new Set([
  "terminal",
  "file",
]);

export function isDeveloperOnlyTabKind(kind: WorkspaceTabTarget["kind"]): boolean {
  return DEVELOPER_ONLY_TAB_KINDS.has(kind);
}

/**
 * In Developer mode returns the input array unchanged (same reference, so
 * downstream memos don't churn). In User mode returns a new array with the
 * developer-only tab kinds removed. The focused-tab fallback is handled for free
 * by `deriveWorkspacePaneState` (getActiveTabId falls back to the first surviving
 * tab when the focused one is filtered away).
 */
export function hideDeveloperTabs(tabs: WorkspaceTab[], isDeveloperMode: boolean): WorkspaceTab[] {
  if (isDeveloperMode) {
    return tabs;
  }
  return tabs.filter((tab) => !isDeveloperOnlyTabKind(tab.target.kind));
}
