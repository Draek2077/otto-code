import { useCallback, useRef, useState, type RefObject } from "react";
import type { EditorController, EditorCursorPosition } from "@/editor/editor-contract";
import { openCodeRenameTab } from "./open-code-rename-tab";

/**
 * "Rename symbol…" from the editor: read the identifier under the caret, ask for the new
 * name, then set the job up in its own tab.
 *
 * The caret position is captured when the dialog OPENS, not when it is submitted. Between
 * those two moments the user has been typing in a text field, and re-reading the editor's
 * caret afterwards is how a rename ends up aimed at whatever the caret drifted to. The
 * position that was under the pointer when they chose "Rename" is the one they meant.
 *
 * Like find-references, the search is by position: the word is only used to seed the field
 * and name the tab.
 */

export interface RenameSymbolController {
  /** Open the dialog for whatever is under the caret. */
  request: (() => void) | null;
  dialogOpen: boolean;
  /** The identifier being renamed; seeds the dialog. */
  symbol: string;
  closeDialog: () => void;
  submit: (newName: string) => void;
}

export function useRenameSymbol(input: {
  serverId: string;
  workspaceId: string;
  path: string;
  controllerRef: RefObject<EditorController | null>;
  cursor: EditorCursorPosition | null;
  enabled: boolean;
}): RenameSymbolController {
  const { serverId, workspaceId, path, controllerRef, cursor, enabled } = input;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [symbol, setSymbol] = useState("");
  // Frozen at request time - see the note above on why this is not read at submit.
  const positionRef = useRef<{ line: number; column: number } | null>(null);

  const request = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller || cursor === null) {
      return;
    }
    positionRef.current = { line: cursor.line, column: cursor.column };
    void controller.getWordAtCursor().then((word) => {
      if (word.length === 0) {
        // Not on an identifier. Nothing to rename and nothing worth interrupting for.
        return undefined;
      }
      setSymbol(word);
      setDialogOpen(true);
      return undefined;
    });
  }, [controllerRef, cursor]);

  const closeDialog = useCallback(() => setDialogOpen(false), []);

  const submit = useCallback(
    (newName: string) => {
      const position = positionRef.current;
      setDialogOpen(false);
      if (position === null || symbol.length === 0) {
        return;
      }
      openCodeRenameTab({
        serverId,
        workspaceId,
        path,
        line: position.line,
        column: position.column,
        symbol,
        newName,
      });
    },
    [path, serverId, symbol, workspaceId],
  );

  return { request: enabled ? request : null, dialogOpen, symbol, closeDialog, submit };
}
