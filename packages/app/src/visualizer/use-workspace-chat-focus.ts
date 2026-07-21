// Which chat the Visualizer should be showing, and which chat tabs exist.
//
// BUG THIS FIXES (2026-07-20): both were read from `useWorkspaceTabsStore`'s
// `uiTabsByWorkspace` / `focusedTabIdByWorkspace`. Nothing writes those fields —
// grep the app and the Visualizer is their ONLY reader, while every real tab
// open/focus/close goes through `useWorkspaceLayoutStore` (panes own their tabs
// and their `focusedTabId`). So follow-the-active-chat was watching dead state:
// switching chats never moved the Visualizer, and because it never moved, the
// Pin toggle had nothing observable to freeze. The tabs store is still the right
// home for its persistence concerns; it is simply not the source of truth for
// what is on screen.
//
// Both hooks return primitives / referentially-stable values so they can be used
// in effects without re-subscribing on every layout push.
import { useMemo } from "react";
import {
  collectAllTabs,
  createDefaultLayout,
  findPaneById,
  normalizeLayout,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import type { WorkspaceTab } from "@/stores/workspace-tabs-store";

const EMPTY_TABS: readonly WorkspaceTab[] = [];

/** Every tab in the workspace, across every pane in the split tree. */
export function useWorkspaceTabsFromLayout(workspaceKey: string | null): readonly WorkspaceTab[] {
  const layout = useWorkspaceLayoutStore((state) =>
    workspaceKey ? state.layoutByWorkspace[workspaceKey] : undefined,
  );
  return useMemo(() => {
    if (!layout) {
      return EMPTY_TABS;
    }
    return collectAllTabs(normalizeLayout(layout).root);
  }, [layout]);
}

/**
 * The tab that currently holds focus — the focused pane's own focused tab.
 *
 * Falls back to the single pane's focused tab when `focusedPaneId` hasn't been
 * set yet (a fresh workspace, or the mobile/fallback single-pane layout), so
 * this works on every layout shape rather than only after a pane click.
 */
export function useFocusedTabIdFromLayout(workspaceKey: string | null): string | null {
  const layout = useWorkspaceLayoutStore((state) =>
    workspaceKey ? state.layoutByWorkspace[workspaceKey] : undefined,
  );
  return useMemo(() => {
    const normalized = normalizeLayout(layout ?? createDefaultLayout());
    const focusedPane = findPaneById(normalized.root, normalized.focusedPaneId);
    if (focusedPane) {
      return focusedPane.focusedTabId ?? null;
    }
    const panes = collectAllTabs(normalized.root);
    // No focused pane yet: with exactly one tab in the whole workspace there is
    // no ambiguity about what the user is looking at.
    return panes.length === 1 ? (panes[0]?.tabId ?? null) : null;
  }, [layout]);
}
