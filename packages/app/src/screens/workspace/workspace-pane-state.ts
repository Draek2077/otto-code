import {
  collectAllPanes,
  findPaneById,
  type SplitPane,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-store";
import type { WorkspaceTab, WorkspaceTabTarget } from "@/stores/workspace-tabs-store";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import {
  buildDeterministicWorkspaceTabId,
  normalizeWorkspaceTabTarget,
  workspaceTabTargetsEqual,
} from "@/workspace-tabs/identity";
import { findAdjacentPane } from "@/utils/split-navigation";

export interface WorkspaceDerivedTab {
  descriptor: WorkspaceTabDescriptor;
}

export interface WorkspacePaneState {
  pane: SplitPane | null;
  tabs: WorkspaceDerivedTab[];
  focusedTabId: string | null;
  activeTabId: string | null;
  activeTab: WorkspaceDerivedTab | null;
}

export type WorkspaceSideFileOpenPlacement =
  | { kind: "open-in-source" }
  | { kind: "focus-side-pane"; paneId: string }
  | { kind: "split-side-pane"; paneId: string };

interface NormalizeWorkspacePaneTabsResult {
  tabs: WorkspaceDerivedTab[];
  openTabIds: Set<string>;
}

function trimNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeWorkspaceTab(tab: WorkspaceTab): WorkspaceTab | null {
  if (!tab || typeof tab !== "object") {
    return null;
  }
  const tabId = trimNonEmpty(tab.tabId);
  if (!tabId) {
    return null;
  }
  const target = normalizeWorkspaceTabTarget(tab.target);
  if (!target) {
    return null;
  }
  return {
    tabId,
    target,
    createdAt: tab.createdAt,
  };
}

function orderPaneTabs(input: { pane: SplitPane | null; tabs: WorkspaceTab[] }): WorkspaceTab[] {
  if (!input.pane) {
    return input.tabs;
  }

  const tabsById = new Map<string, WorkspaceTab>();
  for (const tab of input.tabs) {
    tabsById.set(tab.tabId, tab);
  }

  const orderedTabs: WorkspaceTab[] = [];
  for (const tabId of input.pane.tabIds) {
    const tab = tabsById.get(tabId);
    if (tab) {
      orderedTabs.push(tab);
    }
  }
  return orderedTabs;
}

function normalizeWorkspacePaneTabs(tabs: WorkspaceTab[]): NormalizeWorkspacePaneTabsResult {
  const nextTabs: WorkspaceDerivedTab[] = [];
  const openTabIds = new Set<string>();

  for (const tab of tabs) {
    const normalizedTab = normalizeWorkspaceTab(tab);
    if (!normalizedTab || openTabIds.has(normalizedTab.tabId)) {
      continue;
    }

    openTabIds.add(normalizedTab.tabId);
    nextTabs.push({
      descriptor: {
        key: normalizedTab.tabId,
        tabId: normalizedTab.tabId,
        kind: normalizedTab.target.kind,
        target: normalizedTab.target,
      },
    });
  }

  return {
    tabs: nextTabs,
    openTabIds,
  };
}

function getActiveTabId(input: {
  tabs: WorkspaceDerivedTab[];
  openTabIds: Set<string>;
  focusedTabId?: string | null;
  preferredTarget?: WorkspaceTabTarget | null;
}): string | null {
  const focusedTabId = trimNonEmpty(input.focusedTabId);
  const preferredTarget = normalizeWorkspaceTabTarget(input.preferredTarget ?? null);
  const preferredTabId = (() => {
    if (!preferredTarget) {
      return null;
    }
    const matchingTab =
      input.tabs.find((tab) => workspaceTabTargetsEqual(tab.descriptor.target, preferredTarget)) ??
      null;
    return matchingTab?.descriptor.tabId ?? buildDeterministicWorkspaceTabId(preferredTarget);
  })();

  if (preferredTabId && input.openTabIds.has(preferredTabId)) {
    return preferredTabId;
  }
  if (focusedTabId && input.openTabIds.has(focusedTabId)) {
    return focusedTabId;
  }
  return input.tabs[0]?.descriptor.tabId ?? null;
}

function getPane(input: {
  layout: WorkspaceLayout | null;
  pane?: SplitPane | null;
  paneId?: string | null;
}): SplitPane | null {
  if (input.pane) {
    return input.pane;
  }

  const layout = input.layout;
  if (!layout) {
    return null;
  }

  const resolvedPaneId = trimNonEmpty(input.paneId) ?? layout.focusedPaneId;
  if (!resolvedPaneId) {
    return null;
  }

  return findPaneById(layout.root, resolvedPaneId);
}

export function deriveWorkspacePaneState(input: {
  layout?: WorkspaceLayout | null;
  pane?: SplitPane | null;
  paneId?: string | null;
  tabs: WorkspaceTab[];
  focusedTabId?: string | null;
  preferredTarget?: WorkspaceTabTarget | null;
}): WorkspacePaneState {
  const pane = getPane({
    layout: input.layout ?? null,
    pane: input.pane ?? null,
    paneId: input.paneId,
  });
  const orderedTabs = orderPaneTabs({
    pane,
    tabs: input.tabs,
  });
  const normalizedTabs = normalizeWorkspacePaneTabs(orderedTabs);
  const focusedTabId = pane?.focusedTabId ?? trimNonEmpty(input.focusedTabId) ?? null;
  const activeTabId = getActiveTabId({
    tabs: normalizedTabs.tabs,
    openTabIds: normalizedTabs.openTabIds,
    focusedTabId,
    preferredTarget: input.preferredTarget,
  });

  return {
    pane,
    tabs: normalizedTabs.tabs,
    focusedTabId,
    activeTabId,
    activeTab: activeTabId
      ? (normalizedTabs.tabs.find((tab) => tab.descriptor.tabId === activeTabId) ?? null)
      : null,
  };
}

export function getWorkspacePaneDescriptors(input: {
  layout?: WorkspaceLayout | null;
  pane?: SplitPane | null;
  paneId?: string | null;
  tabs: WorkspaceTab[];
}): WorkspaceTabDescriptor[] {
  return deriveWorkspacePaneState(input).tabs.map((tab) => tab.descriptor);
}

export function resolveSideFileOpenPlacement(input: {
  layout?: WorkspaceLayout | null;
  sourcePaneId?: string | null;
  tabs: WorkspaceTab[];
  target: WorkspaceTabTarget;
}): WorkspaceSideFileOpenPlacement {
  const targetTabId = buildDeterministicWorkspaceTabId(input.target);
  const existingTab = input.tabs.find(
    (tab) => tab.tabId === targetTabId || workspaceTabTargetsEqual(tab.target, input.target),
  );
  if (existingTab) {
    return { kind: "open-in-source" };
  }

  const layout = input.layout ?? null;
  const sourcePaneId = trimNonEmpty(input.sourcePaneId);
  if (!layout || !sourcePaneId) {
    return { kind: "open-in-source" };
  }

  // The Visualizer is a companion view that owns its own pane and must never be
  // displaced by a document. Detect which panes are Visualizer panes so we can
  // both refuse to reuse them and, when one sits immediately to the right, split
  // a fresh pane BETWEEN the chat and the Visualizer instead.
  const visualizerTabIds = new Set(
    input.tabs.filter((tab) => tab.target.kind === "visualizer").map((tab) => tab.tabId),
  );
  const isVisualizerPane = (paneId: string | null): boolean => {
    if (!paneId) {
      return false;
    }
    const pane = findPaneById(layout.root, paneId);
    return pane ? paneContainsVisualizer(pane, visualizerTabIds) : false;
  };

  // A document opened from chat belongs to the right of the chat. When the pane
  // to the right is the Visualizer, split a fresh pane off the source (chat) to
  // the right — that lands the new pane between the chat and the Visualizer,
  // rather than hijacking the Visualizer's own pane.
  const rightNeighbor = findAdjacentPane(layout.root, sourcePaneId, "right");
  if (rightNeighbor && isVisualizerPane(rightNeighbor)) {
    return { kind: "split-side-pane", paneId: sourcePaneId };
  }

  // Otherwise prefer reusing an already-on-screen pane over splitting a new one
  // — every pane in a split layout is visible at once, so any neighbor works.
  // Search right first (where a companion doc split usually sits), then the
  // other directions so a source pane that is itself the rightmost one (e.g. a
  // file opened from the Visualizer's own pane) still lands in the pane to its
  // left. Never reuse a Visualizer pane. Only split when the source pane is
  // truly alone (or its only neighbor is the Visualizer).
  const reusable = (candidate: string | null): string | null =>
    candidate && !isVisualizerPane(candidate) ? candidate : null;
  const sidePaneId =
    reusable(rightNeighbor) ??
    reusable(findAdjacentPane(layout.root, sourcePaneId, "left")) ??
    reusable(findAdjacentPane(layout.root, sourcePaneId, "down")) ??
    reusable(findAdjacentPane(layout.root, sourcePaneId, "up"));
  if (sidePaneId) {
    return { kind: "focus-side-pane", paneId: sidePaneId };
  }

  return { kind: "split-side-pane", paneId: sourcePaneId };
}

/**
 * Where a "New chat" (draft) tab should land, given the pane the action fired
 * from. The Visualizer is a companion view that owns its own pane — a new chat
 * must never displace it into a second tab there. When the draft would land in
 * the Visualizer's pane, redirect it: reuse an existing sibling pane if one is
 * already on screen (a neighbor to the left or right — where the chat usually
 * sits), otherwise split a fresh pane to the LEFT of the Visualizer.
 */
export type WorkspaceNewChatPlacement =
  | { kind: "open-in-pane" }
  | { kind: "reuse-pane"; paneId: string }
  | { kind: "split-left"; targetPaneId: string };

function paneContainsVisualizer(pane: SplitPane, visualizerTabIds: Set<string>): boolean {
  return pane.tabIds.some((tabId) => visualizerTabIds.has(tabId));
}

export function resolveWorkspaceNewChatPlacement(input: {
  layout?: WorkspaceLayout | null;
  tabs: WorkspaceTab[];
  requestedPaneId?: string | null;
  /** Pane splits are desktop-only; native/compact just opens in place. */
  supportsPaneSplits: boolean;
}): WorkspaceNewChatPlacement {
  const layout = input.layout ?? null;
  if (!layout || !input.supportsPaneSplits) {
    return { kind: "open-in-pane" };
  }

  const paneId = trimNonEmpty(input.requestedPaneId) ?? layout.focusedPaneId;
  if (!paneId) {
    return { kind: "open-in-pane" };
  }
  const targetPane = findPaneById(layout.root, paneId);
  if (!targetPane) {
    return { kind: "open-in-pane" };
  }

  const visualizerTabIds = new Set(
    input.tabs.filter((tab) => tab.target.kind === "visualizer").map((tab) => tab.tabId),
  );
  if (visualizerTabIds.size === 0 || !paneContainsVisualizer(targetPane, visualizerTabIds)) {
    return { kind: "open-in-pane" };
  }

  // The draft would land in the Visualizer's pane. Prefer reusing an existing
  // pane that isn't itself a Visualizer pane, scanning the on-screen neighbors
  // first (left, then right, then vertical) before falling back to any other
  // non-Visualizer pane in the tree.
  const reusablePaneIds = new Set(
    collectAllPanes(layout.root)
      .filter((pane) => !paneContainsVisualizer(pane, visualizerTabIds))
      .map((pane) => pane.id),
  );
  if (reusablePaneIds.size > 0) {
    const preferReusable = (candidate: string | null): string | null =>
      candidate && reusablePaneIds.has(candidate) ? candidate : null;
    const reusePaneId =
      preferReusable(findAdjacentPane(layout.root, paneId, "left")) ??
      preferReusable(findAdjacentPane(layout.root, paneId, "right")) ??
      preferReusable(findAdjacentPane(layout.root, paneId, "up")) ??
      preferReusable(findAdjacentPane(layout.root, paneId, "down")) ??
      [...reusablePaneIds][0];
    return { kind: "reuse-pane", paneId: reusePaneId };
  }

  return { kind: "split-left", targetPaneId: paneId };
}
