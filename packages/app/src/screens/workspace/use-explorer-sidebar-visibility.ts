import { useEffect } from "react";
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
  useEffect(() => {
    setExplorerSidebarVisible(painted);
  }, [painted, setExplorerSidebarVisible]);
  useEffect(
    () => () => {
      setExplorerSidebarVisible(false);
    },
    [setExplorerSidebarVisible],
  );
}
