// Moves the Visualizer between mutually-exclusive tab, picture-in-picture,
// and fixed chat-background surfaces. Every placement control goes through here.
//
// BUG THIS FIXES (2026-07-20): the header's PIP button used to flip
// `visualizerPipOpen` blind, while `visualizer-pip-host.tsx` silently refused to
// render whenever a Visualizer tab existed. So the moment a tab appeared by any
// route (the header's Visualizer button, the Runs "Visualize" action, a restored
// layout) the setting stayed `true` but parked, and the button became dead
// chrome: click, click, click, nothing on screen. Mutual exclusion enforced by
// *hiding* one surface is unobservable state; enforced by a transition - retire
// one, start the other - it is always visible in the UI. That is the shape here,
// and `useReconcileVisualizerSurface` below sweeps up any tab opened by a caller
// that never had a hook to call.
import { useCallback, useEffect, useMemo } from "react";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useAppSettings } from "@/hooks/use-settings";
import type { VisualizerSurface } from "@/hooks/use-settings/storage";
import { collectAllTabs, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/stores/workspace-tabs-store";
import { openVisualizerTab } from "@/visualizer/open-visualizer-tab";
import {
  useFocusedTabIdFromLayout,
  useWorkspaceTabsFromLayout,
} from "@/visualizer/use-workspace-chat-focus";

/** Close every Visualizer tab in the workspace. Plural on purpose: run-scoped
 * Visualizer tabs (`target.runId`) are the same surface as the general one, and
 * leaving one behind would re-park the PIP the instant it opened. */
function closeVisualizerTabs(workspaceKey: string): void {
  const store = useWorkspaceLayoutStore.getState();
  const layout = store.layoutByWorkspace[workspaceKey];
  if (!layout) {
    return;
  }
  for (const tab of collectAllTabs(layout.root)) {
    if (tab.target.kind === "visualizer") {
      store.closeTab(workspaceKey, tab.tabId);
    }
  }
}

/** The tab wins when both somehow exist: it is the surface the user can see and
 * interact with, and the reconcile effect is about to retire the PIP anyway. */
function resolveShowing(input: {
  hasTab: boolean;
  pipOpen: boolean;
  backgroundOpen: boolean;
}): VisualizerSurface | null {
  if (input.hasTab) {
    return "tab";
  }
  if (input.backgroundOpen) return "background";
  return input.pipOpen ? "pip" : null;
}

export interface VisualizerSurfaceControls {
  /** Which surface is on screen right now, or null when the Visualizer is closed. */
  showing: VisualizerSurface | null;
  /** The surface the header button will open - the last one used. */
  remembered: VisualizerSurface;
  /** Header button: close what's showing, or open the remembered surface. */
  toggle: () => void;
  /** Tab toolbar: retire the tab, start the PIP, and remember PIP. */
  collapseToPip: () => void;
  /** PIP control strip: retire the PIP, open the tab, and remember tab. */
  expandToTab: () => void;
  /** PIP close button: hide it without changing which surface is remembered. */
  closePip: () => void;
  /** Background placement needs an existing chat or draft destination. */
  canShowAsBackground: boolean;
  showAsBackground: (preferredTabId?: string) => void;
  closeBackground: () => void;
}

export function useVisualizerSurface(
  serverId: string,
  workspaceId: string | null | undefined,
): VisualizerSurfaceControls {
  const { settings, updateSettings } = useAppSettings();
  // The PIP does not exist on a compact layout (see visualizer-pip-host.tsx), so
  // a remembered "pip" must fall back to the tab there. Without this the toggle
  // would set `visualizerPipOpen` on a surface that never mounts - the same
  // dead-button state this hook exists to kill. The setting is left untouched,
  // so crossing back to a wide layout still gets the PIP back.
  const isCompact = useIsCompactFormFactor();
  const workspaceKey = useMemo(
    () => (workspaceId ? buildWorkspaceTabPersistenceKey({ serverId, workspaceId }) : ""),
    [serverId, workspaceId],
  );
  const tabs = useWorkspaceTabsFromLayout(workspaceKey);
  const focusedTabId = useFocusedTabIdFromLayout(workspaceKey);
  const hasTab = tabs.some((tab) => tab.target.kind === "visualizer");
  const canShowAsBackground = tabs.some(
    (tab) => tab.target.kind === "agent" || tab.target.kind === "draft",
  );
  const pipOpen = settings.visualizerPipOpen && !isCompact;
  const backgroundOpen = settings.visualizerBackgroundOpen;
  const remembered =
    isCompact && settings.visualizerSurface === "pip" ? "tab" : settings.visualizerSurface;

  const showing: VisualizerSurface | null = resolveShowing({ hasTab, pipOpen, backgroundOpen });

  const showAsBackground = useCallback(
    (preferredTabId?: string) => {
      if (!workspaceKey) return;
      const store = useWorkspaceLayoutStore.getState();
      const chats = store
        .getWorkspaceTabs(workspaceKey)
        .filter((tab) => tab.target.kind === "agent" || tab.target.kind === "draft");
      if (chats.length === 0) return;
      closeVisualizerTabs(workspaceKey);
      // Closing the visualizer may focus a file or terminal in its old pane.
      // Make the destination concrete instead of parking an enabled background.
      const destination =
        chats.find((tab) => tab.tabId === preferredTabId) ??
        chats.find((tab) => tab.tabId === focusedTabId) ??
        chats[0]!;
      store.focusTab(workspaceKey, destination.tabId);
      void updateSettings({
        visualizerPipOpen: false,
        visualizerBackgroundOpen: true,
        visualizerSurface: "background",
      });
    },
    [focusedTabId, updateSettings, workspaceKey],
  );

  const closeBackground = useCallback(() => {
    void updateSettings({ visualizerBackgroundOpen: false });
  }, [updateSettings]);

  const collapseToPip = useCallback(() => {
    if (workspaceKey) {
      closeVisualizerTabs(workspaceKey);
    }
    void updateSettings({
      visualizerPipOpen: true,
      visualizerBackgroundOpen: false,
      visualizerSurface: "pip",
    });
  }, [updateSettings, workspaceKey]);

  const expandToTab = useCallback(() => {
    // Order matters - retire the PIP first so only one guest is ever alive.
    void updateSettings({
      visualizerPipOpen: false,
      visualizerBackgroundOpen: false,
      visualizerSurface: "tab",
    });
    if (workspaceId) {
      openVisualizerTab({ serverId, workspaceId });
    }
  }, [serverId, updateSettings, workspaceId]);

  const closePip = useCallback(() => {
    void updateSettings({ visualizerPipOpen: false });
  }, [updateSettings]);

  const toggle = useCallback(() => {
    if (hasTab) {
      if (workspaceKey) {
        closeVisualizerTabs(workspaceKey);
      }
      return;
    }
    if (pipOpen) {
      closePip();
      return;
    }
    if (backgroundOpen) {
      closeBackground();
      return;
    }
    if (remembered === "background") {
      showAsBackground();
      return;
    }
    if (remembered === "pip") {
      void updateSettings({ visualizerPipOpen: true });
      return;
    }
    if (workspaceId) {
      openVisualizerTab({ serverId, workspaceId });
    }
  }, [
    closePip,
    closeBackground,
    showAsBackground,
    backgroundOpen,
    hasTab,
    pipOpen,
    remembered,
    serverId,
    updateSettings,
    workspaceId,
    workspaceKey,
  ]);

  return {
    showing,
    remembered,
    toggle,
    collapseToPip,
    expandToTab,
    closePip,
    canShowAsBackground,
    showAsBackground,
    closeBackground,
  };
}

/**
 * Keeps `visualizerPipOpen` honest when a Visualizer tab appears by a route that
 * never went through `useVisualizerSurface` - the Runs "Visualize" action, a
 * restored workspace layout, a dropped tab. Without this the PIP setting would
 * sit `true`-but-parked again, which is the exact state the old bug lived in.
 * Mount once per workspace (the PIP host does it).
 */
export function useReconcileVisualizerSurface(hasVisualizerTab: boolean, isVisible: boolean): void {
  const { settings, updateSettings } = useAppSettings();
  const pipOpen = settings.visualizerPipOpen;
  const backgroundOpen = settings.visualizerBackgroundOpen;
  useEffect(() => {
    // Self-extinguishing: the patch makes the condition false, so this can't loop
    // even if `updateSettings` is not referentially stable.
    if (isVisible && hasVisualizerTab && (pipOpen || backgroundOpen)) {
      void updateSettings({
        visualizerPipOpen: false,
        visualizerBackgroundOpen: false,
        visualizerSurface: "tab",
      });
    }
  }, [isVisible, hasVisualizerTab, pipOpen, backgroundOpen, updateSettings]);
}
