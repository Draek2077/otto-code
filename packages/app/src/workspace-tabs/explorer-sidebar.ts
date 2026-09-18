import { supportsDesktopPaneSplits } from "@/constants/layout";
import {
  selectIsCompactFileExplorerOpen,
  usePanelStore,
  type ExplorerTab,
} from "@/stores/panel-store";
import type { ExplorerCheckoutContext } from "@/stores/explorer-checkout-context";
import {
  collectAllTabs,
  findPaneById,
  selectExplorerSidebarPaneId,
  selectIsExplorerSidebarVisible,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import type { WorkspaceTab, WorkspaceTabTarget } from "@/workspace-tabs/model";

export type ExplorerSidebarView = "changes" | "files" | "pr";
export type ExplorerSidebarPresentation = "overlay" | "dock" | "pane";

const VIEW_TARGETS: Record<ExplorerSidebarView, WorkspaceTabTarget> = {
  changes: { kind: "changes_tree" },
  files: { kind: "files" },
  pr: { kind: "pull_request" },
};

const TAB_TARGETS: Record<ExplorerTab, WorkspaceTabTarget> = {
  changes: VIEW_TARGETS.changes,
  files: VIEW_TARGETS.files,
  search: { kind: "project_search" },
  pr: { kind: "pull_request" },
};

// Search is Otto's workspace-navigation addition, not a Git/developer operation.
// User mode keeps it beside Files while continuing to hide Git-only surfaces.
const USER_MODE_HIDDEN_EXPLORER_KINDS = new Set(["changes_tree", "pull_request"]);

export function filterExplorerSidebarTabs(
  tabs: WorkspaceTab[],
  isDeveloperMode: boolean,
  hasPullRequest = true,
): WorkspaceTab[] {
  return tabs.filter(
    (tab) =>
      (isDeveloperMode || !USER_MODE_HIDDEN_EXPLORER_KINDS.has(tab.target.kind)) &&
      (hasPullRequest || tab.target.kind !== "pull_request"),
  );
}

export interface ExplorerSidebarQuery {
  isCompact: boolean;
  isDeveloperMode?: boolean;
  workspaceKey: string | null;
  supportsPaneSplits?: boolean;
}

export interface ExplorerSidebarInput extends ExplorerSidebarQuery {
  checkout: ExplorerCheckoutContext | null;
}

export function resolveExplorerSidebarPresentation(
  input: Pick<ExplorerSidebarQuery, "isCompact" | "supportsPaneSplits">,
): ExplorerSidebarPresentation {
  if (input.isCompact) {
    return "overlay";
  }
  return (input.supportsPaneSplits ?? supportsDesktopPaneSplits()) ? "pane" : "dock";
}

export function usesCompactExplorerSidebar(
  input: Pick<ExplorerSidebarQuery, "isCompact" | "supportsPaneSplits">,
): boolean {
  return resolveExplorerSidebarPresentation(input) !== "pane";
}

function canUseExplorerSidebar(
  input: Pick<ExplorerSidebarQuery, "isCompact" | "supportsPaneSplits">,
): boolean {
  return resolveExplorerSidebarPresentation(input) === "pane";
}

/** Reveals the Explorer sidebar and selects one of its tabs. */
export function openExplorerSidebarTab(input: ExplorerSidebarInput & { tab: ExplorerTab }): void {
  const requestedTab = input.tab;
  const tab =
    input.checkout && !input.checkout.isGit && (requestedTab === "changes" || requestedTab === "pr")
      ? "files"
      : requestedTab;
  if (usesCompactExplorerSidebar(input)) {
    if (!input.checkout) return;
    const panel = usePanelStore.getState();
    panel.setExplorerTabForCheckout({ ...input.checkout, tab });
    panel.openCompactFileExplorer(input.checkout);
    return;
  }
  if (!input.workspaceKey) return;
  const store = useWorkspaceLayoutStore.getState();
  const paneId = store.showExplorerSidebar(input.workspaceKey);
  store.openTab({
    workspaceKey: input.workspaceKey,
    target: TAB_TARGETS[tab],
    intent: "reveal",
    placement: paneId ? { mode: "pane", paneId } : undefined,
  });
}

/** Reveals one of the Explorer's singleton navigation trees. */
export function openExplorerSidebarView(
  input: ExplorerSidebarInput & { view: ExplorerSidebarView },
): void {
  openExplorerSidebarTab({ ...input, tab: input.view });
}

export function showExplorerSidebar(input: ExplorerSidebarInput): void {
  if (usesCompactExplorerSidebar(input)) {
    if (input.checkout) usePanelStore.getState().openCompactFileExplorer(input.checkout);
    return;
  }
  if (input.workspaceKey && canUseExplorerSidebar(input)) {
    useWorkspaceLayoutStore.getState().showExplorerSidebar(input.workspaceKey);
  }
}

export function hideExplorerSidebar(input: ExplorerSidebarInput): void {
  if (usesCompactExplorerSidebar(input)) {
    usePanelStore.getState().showMobileAgent();
    return;
  }
  if (input.workspaceKey && canUseExplorerSidebar(input)) {
    useWorkspaceLayoutStore.getState().hideExplorerSidebar(input.workspaceKey);
  }
}

export function toggleExplorerSidebar(input: ExplorerSidebarInput): void {
  if (usesCompactExplorerSidebar(input)) {
    if (input.checkout) usePanelStore.getState().toggleCompactFileExplorer(input.checkout);
    return;
  }
  if (!input.workspaceKey) return;
  if (isExplorerSidebarOpen(input)) {
    hideExplorerSidebar(input);
  } else if (explorerSidebarFocusesGitOnlyTree(input)) {
    // OTTO: a fresh Explorer pane focuses Changes, which User mode and non-Git
    // checkouts cannot show. Reveal Files instead so the pane opens on a tree
    // the user can see. Any visible tab they picked is still preserved.
    openExplorerSidebarTab({ ...input, tab: "files" });
  } else {
    showExplorerSidebar(input);
  }
}

function explorerSidebarFocusesGitOnlyTree(input: ExplorerSidebarInput): boolean {
  if (input.isDeveloperMode !== false && input.checkout?.isGit !== false) {
    return false;
  }
  if (!input.workspaceKey) {
    return false;
  }
  const state = useWorkspaceLayoutStore.getState();
  const layout = state.layoutByWorkspace[input.workspaceKey];
  const paneId = layout ? selectExplorerSidebarPaneId(state, input.workspaceKey) : null;
  const pane = paneId && layout ? findPaneById(layout.root, paneId) : null;
  if (!layout || !pane?.focusedTabId) {
    // No Explorer pane yet: creating one focuses its default Changes tree.
    return true;
  }
  const focusedTab = collectAllTabs(layout.root).find((tab) => tab.tabId === pane.focusedTabId);
  return !focusedTab || USER_MODE_HIDDEN_EXPLORER_KINDS.has(focusedTab.target.kind);
}

export function useIsExplorerSidebarOpen(input: ExplorerSidebarQuery): boolean {
  const compactOpen = usePanelStore(selectIsCompactFileExplorerOpen);
  const paneOpen = useWorkspaceLayoutStore((state) =>
    input.workspaceKey && canUseExplorerSidebar(input)
      ? selectIsExplorerSidebarVisible(state, input.workspaceKey)
      : false,
  );
  return usesCompactExplorerSidebar(input) ? compactOpen : paneOpen;
}

export function isExplorerSidebarOpen(input: ExplorerSidebarQuery): boolean {
  if (usesCompactExplorerSidebar(input)) {
    return selectIsCompactFileExplorerOpen(usePanelStore.getState());
  }
  return Boolean(
    input.workspaceKey &&
    canUseExplorerSidebar(input) &&
    selectIsExplorerSidebarVisible(useWorkspaceLayoutStore.getState(), input.workspaceKey),
  );
}
