import { buildWorkspaceTabPersistenceKey } from "@/stores/workspace-tabs-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";

export interface OpenCodeRenameTabInput {
  serverId: string;
  workspaceId: string;
  path: string;
  line: number;
  column: number;
  symbol: string;
  newName: string;
}

/**
 * Set the rename up as a job in its own tab.
 *
 * The new name is decided BEFORE the tab opens, which is what makes the tab a dry run of a
 * specific job rather than a form: everything in it describes one concrete edit set, and the
 * only decision left is whether to run it.
 *
 * One tab per (path, line, column): renaming the same symbol again reuses its job tab, since
 * the second request supersedes the first rather than sitting beside it — the opposite of
 * references, where two searches are two questions.
 */
export function openCodeRenameTab(input: OpenCodeRenameTabInput): boolean {
  const workspaceKey = buildWorkspaceTabPersistenceKey({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  if (!workspaceKey || input.symbol.length === 0 || input.newName.length === 0) {
    return false;
  }

  useWorkspaceLayoutStore.getState().openTabFocused(
    workspaceKey,
    {
      kind: "codeRename",
      path: input.path,
      line: input.line,
      column: input.column,
      symbol: input.symbol,
      newName: input.newName,
    },
    { insertAfterFocusedTab: true },
  );
  return true;
}
