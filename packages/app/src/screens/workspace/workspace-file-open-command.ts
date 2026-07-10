import {
  createWorkspaceFileTabTarget,
  normalizeWorkspaceFileLocation,
} from "@/workspace/file-open";
import { setFileViewModeFor } from "@/stores/file-view-store";
import type { WorkspaceTabTarget } from "@/stores/workspace-tabs-store";

interface OpenWorkspaceFileFromExplorerInput {
  filePath: string;
  /** Open the file tab in editor view instead of the read-only preview. */
  edit?: boolean;
  /** Preview view only: highlight and scroll to this 1-based line. */
  lineStart?: number;
  persistenceKey: string | null;
  showMobileAgent: () => void;
  openWorkspaceTabFocused: (workspaceKey: string, target: WorkspaceTabTarget) => string | null;
  focusWorkspaceTab: (workspaceKey: string, tabId: string) => void;
}

export function openWorkspaceFileFromExplorer(input: OpenWorkspaceFileFromExplorerInput): void {
  input.showMobileAgent();
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
  const tabId = input.openWorkspaceTabFocused(
    input.persistenceKey,
    createWorkspaceFileTabTarget(location),
  );
  if (tabId) {
    input.focusWorkspaceTab(input.persistenceKey, tabId);
  }
}
