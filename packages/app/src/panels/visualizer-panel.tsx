import { useCallback } from "react";
import invariant from "tiny-invariant";
import { usePaneContext, usePaneFocus } from "@/panels/pane-context";
import { VisualizerSurface } from "@/visualizer/visualizer-surface";
import type { WorkspaceFileOpenRequest } from "@/workspace/file-open";

// The Visualizer TAB. Everything real lives in `VisualizerSurface`, which the
// picture-in-picture viewport renders too — the two surfaces differ only in
// chrome and camera framing (visualizer-chrome-profile.ts), so they must not be
// two implementations that drift.
//
// This wrapper's whole job is the pane binding: pane context supplies the
// workspace + the side-disposition file opener, pane focus supplies visibility.
// PIP has no pane of its own and supplies those itself.
//
// Exported so the thin registration module (visualizer-panel-registration.tsx)
// can pull it via React.lazy — the boundary that keeps the vendored render
// bundle out of the startup graph.
export function VisualizerPanel() {
  const { serverId, workspaceId, target, openFileInWorkspace } = usePaneContext();
  invariant(target.kind === "visualizer", "VisualizerPanel requires visualizer target");
  // The Visualizer is a companion view — the user watches it in a split while
  // working in the chat pane, so it must keep tracking agents whenever it's on
  // screen, NOT only when it holds focus. Gate on visibility, not focus:
  // `isInteractive` (isPaneFocused) went false the instant you clicked into the
  // chat, disposing the adapter and freezing the graph / session tabs until you
  // clicked back or reopened the tab.
  const { isVisible } = usePaneFocus();

  const handleOpenFile = useCallback(
    (request: WorkspaceFileOpenRequest) => {
      openFileInWorkspace(request);
    },
    [openFileInWorkspace],
  );

  return (
    <VisualizerSurface
      serverId={serverId}
      workspaceId={workspaceId}
      surface="tab"
      isVisible={isVisible}
      {...(target.runId ? { runId: target.runId } : {})}
      onOpenFile={handleOpenFile}
    />
  );
}
