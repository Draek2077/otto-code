import { buildWorkspaceTabPersistenceKey } from "@/stores/workspace-tabs-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";

export interface OpenCodeReferencesTabInput {
  serverId: string;
  workspaceId: string;
  /** The file the symbol was asked about, as the editor holds it. */
  path: string;
  /** 1-based caret position the search was made from. */
  line: number;
  column: number;
  /** Identifier under the caret — the tab's name. */
  symbol: string;
}

/**
 * Open (or focus) the references tab for one symbol.
 *
 * One tab per (path, line, column), so a second search sits beside the first rather than
 * replacing it: comparing two symbols' call sites is a real thing to want, and it is exactly
 * what a single reused results pane makes impossible. Same reasoning as whole-file vs
 * line-scoped git history.
 *
 * Opens next to the tab in focus, like the git logs — the results belong beside the code
 * they came from, not at the far end of the tab strip.
 */
export function openCodeReferencesTab(input: OpenCodeReferencesTabInput): boolean {
  const workspaceKey = buildWorkspaceTabPersistenceKey({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  if (!workspaceKey || input.symbol.length === 0) {
    return false;
  }

  useWorkspaceLayoutStore.getState().openTabFocused(
    workspaceKey,
    {
      kind: "codeReferences",
      path: input.path,
      line: input.line,
      column: input.column,
      symbol: input.symbol,
    },
    { insertAfterFocusedTab: true },
  );
  return true;
}
