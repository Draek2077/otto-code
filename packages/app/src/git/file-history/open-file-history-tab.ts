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
}

/**
 * Open (or focus) the git investigation tab for a file. Whole-file and
 * line-scoped histories are separate tabs — asking "who changed these three
 * lines" does not replace the answer to "what happened to this file" — and each
 * lands next to the tab the user is looking at, like the git operation logs.
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
  useWorkspaceLayoutStore.getState().openTabFocused(
    workspaceKey,
    {
      kind: "fileHistory",
      path: input.path,
      ...(hasRange ? { startLine: input.startLine, endLine: input.endLine } : {}),
    },
    { insertAfterFocusedTab: true },
  );
  return true;
}
