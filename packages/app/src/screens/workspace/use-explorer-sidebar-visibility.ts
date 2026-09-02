import { useEffect, useLayoutEffect } from "react";
import { usePanelStore } from "@/stores/panel-store";

/**
 * Publishes whether the workspace explorer sidebar is actually painted under the
 * window controls so the overlay color can follow the sidebar's real on-screen
 * state instead of predicting from route alone. The `painted` gate mirrors what
 * the user actually sees in the top-right: the sidebar is shown for this route,
 * the workspace directory has loaded (so it isn't the load pause), AND the
 * explorer is open (it collapses its width when toggled off, returning the
 * corner to the default surface). This makes the chrome stay on the default
 * surface through the load pause and track the open/close toggle. Resets to
 * false on unmount so leaving the workspace returns the chrome to the default
 * surface immediately.
 */
export function usePublishExplorerSidebarVisibility(input: {
  showExplorerSidebar: boolean;
  workspaceDirectory: string | null;
  explorerOpen: boolean;
}): void {
  const painted =
    input.showExplorerSidebar && Boolean(input.workspaceDirectory) && input.explorerOpen;
  const setExplorerSidebarVisible = usePanelStore((state) => state.setExplorerSidebarVisible);
  // This ownership feeds the root-level desktop chrome. Publishing it in a
  // passive effect leaves the caption strip one paint behind a restored open
  // Explorer; toggling the sidebar happens to repair that stale first frame.
  useLayoutEffect(() => {
    setExplorerSidebarVisible(painted);
  }, [painted, setExplorerSidebarVisible]);
  useEffect(
    () => () => {
      setExplorerSidebarVisible(false);
    },
    [setExplorerSidebarVisible],
  );
}

/**
 * Publishes whether the focus-mode tab strip is the top strip painted under the
 * window controls, so the overlay color can match the tab-row gutter
 * (surfaceSidebar) instead of the default surface0. True only in focus mode on a
 * non-compact layout - the case where the workspace screen hides its header and
 * the desktop tab row becomes the topmost strip beneath the native caption. On
 * compact layouts the mobile tab switcher, not the desktop tab row, sits up top,
 * so this stays false. Resets to false on unmount so leaving the workspace
 * returns the chrome to the default surface immediately.
 */
export function usePublishFocusModeTabStripVisibility(input: {
  isFocusModeEnabled: boolean;
  isCompact: boolean;
}): void {
  const visible = input.isFocusModeEnabled && !input.isCompact;
  const setFocusModeTabStripVisible = usePanelStore((state) => state.setFocusModeTabStripVisible);
  // The focus-mode tab strip has the same top-right chrome ownership rule.
  useLayoutEffect(() => {
    setFocusModeTabStripVisible(visible);
  }, [visible, setFocusModeTabStripVisible]);
  useEffect(
    () => () => {
      setFocusModeTabStripVisible(false);
    },
    [setFocusModeTabStripVisible],
  );
}
