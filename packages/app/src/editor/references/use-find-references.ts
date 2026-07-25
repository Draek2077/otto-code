import { useCallback, type RefObject } from "react";
import type { EditorController, EditorCursorPosition } from "@/editor/editor-contract";
import { openCodeReferencesTab } from "./open-code-references-tab";

/**
 * "Find references" from the editor: read the identifier under the caret, open a results tab
 * for that position.
 *
 * The symbol name is read here only to NAME the tab. The search itself is by position — the
 * daemon resolves the reference under the caret, which is what makes it answer "what refers
 * to *this* `foo`" instead of "what is spelled `foo`". Sending the word would be the ctags
 * question wearing a language server's clothes.
 *
 * Returns null when disabled, so the caller can hide the menu item outright rather than
 * offering an action that does nothing.
 */
export function useFindReferences(input: {
  serverId: string;
  workspaceId: string;
  /** The file the editor is showing, as the tab holds it. */
  path: string;
  controllerRef: RefObject<EditorController | null>;
  cursor: EditorCursorPosition | null;
  enabled: boolean;
}): (() => void) | null {
  const { serverId, workspaceId, path, controllerRef, cursor, enabled } = input;

  const find = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller || cursor === null) {
      return;
    }
    void controller.getWordAtCursor().then((symbol) => {
      if (symbol.length === 0) {
        // Not on an identifier. Silent rather than a toast: the user right-clicked in
        // whitespace, which is a miss, not an error worth interrupting them for.
        return undefined;
      }
      openCodeReferencesTab({
        serverId,
        workspaceId,
        path,
        line: cursor.line,
        column: cursor.column,
        symbol,
      });
      return undefined;
    });
  }, [controllerRef, cursor, path, serverId, workspaceId]);

  return enabled ? find : null;
}
