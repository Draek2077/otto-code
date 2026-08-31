import {
  createWorkspaceFileTabTarget,
  normalizeWorkspaceFileLocation,
} from "@/workspace/file-open";
import { setFileViewModeFor } from "@/stores/file-view-store";
import {
  FOCUSED_PANE_PLACEMENT,
  type WorkspaceTabPlacement,
} from "@/stores/workspace-layout-store";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

interface OpenWorkspaceFileFromExplorerInput {
  filePath: string;
  /** Open the file tab in editor view instead of the read-only preview. */
  edit?: boolean;
  /** Preview view only: highlight and scroll to this 1-based line. */
  lineStart?: number;
  persistenceKey: string | null;
  closeExplorerAfterOpen: boolean;
  showMobileAgent: () => void;
  openWorkspaceTabInFocusedPane: (
    workspaceKey: string,
    target: WorkspaceTabTarget,
    placement?: WorkspaceTabPlacement,
  ) => string | null;
  focusWorkspaceTab: (workspaceKey: string, tabId: string) => void;
}

export function openWorkspaceFileFromExplorer(input: OpenWorkspaceFileFromExplorerInput): void {
  if (input.closeExplorerAfterOpen) {
    input.showMobileAgent();
  }
  if (!input.persistenceKey) {
    return;
  }
  const location = normalizeWorkspaceFileLocation({
    path: input.filePath,
    lineStart: input.lineStart,
  });
  if (!location) {
    return;
  }
  if (input.edit) {
    // One tab per file: "Edit" opens the same file tab in editor view.
    setFileViewModeFor({
      persistenceKey: input.persistenceKey,
      path: location.path,
      mode: "editor",
    });
  }
  const tabId = input.openWorkspaceTabInFocusedPane(
    input.persistenceKey,
    createWorkspaceFileTabTarget(location),
    FOCUSED_PANE_PLACEMENT,
  );
  if (tabId) {
    input.focusWorkspaceTab(input.persistenceKey, tabId);
  }
}
