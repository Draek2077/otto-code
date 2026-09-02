import { buildWorkspaceTabPersistenceKey } from "@/stores/workspace-tabs-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";

export interface OpenFileHistoryTabInput {
  serverId: string;
  workspaceId: string;
  /** Workspace-relative path, as the file is named today. */
  path: string;
  /** 1-based inclusive line scope. Both or neither. */
  startLine?: number;
  endLine?: number;
  /** New histories prefer this pane without moving an existing user-placed tab. */
  defaultPaneId?: string;
}

/**
 * Open (or focus) the git investigation tab for a file. Whole-file and
 * line-scoped histories are separate tabs - asking "who changed these three
 * lines" does not replace the answer to "what happened to this file" - and each
 * defaults to the requesting pane when supplied, while preserving an existing
 * tab where the user moved it.
 */
export function openFileHistoryTab(input: OpenFileHistoryTabInput): boolean {
  const workspaceKey = buildWorkspaceTabPersistenceKey({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  if (!workspaceKey) {
    return false;
  }
  const hasRange =
    typeof input.startLine === "number" &&
    typeof input.endLine === "number" &&
    input.endLine >= input.startLine;
  const target = {
    kind: "fileHistory" as const,
    path: input.path,
    ...(hasRange ? { startLine: input.startLine, endLine: input.endLine } : {}),
  };
  const layout = useWorkspaceLayoutStore.getState();
  if (input.defaultPaneId) {
    layout.openTab({
      workspaceKey,
      target,
      intent: "reveal",
      placement: { mode: "prefer", paneId: input.defaultPaneId },
    });
  } else {
    layout.openTabFocused(workspaceKey, target, { insertAfterFocusedTab: true });
  }
  return true;
}
