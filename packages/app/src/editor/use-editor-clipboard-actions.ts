import * as Clipboard from "expo-clipboard";
import { type RefObject, useCallback } from "react";

import type { EditorController } from "./editor-contract";

export interface EditorClipboardActions {
  copy: () => void;
  cut: () => void;
  paste: () => void;
  selectAll: () => void;
  selectLine: () => void;
}

/**
 * The editor context menu's edit actions. The host owns the clipboard (one API
 * across web and native), so cut is copy plus a selection overwrite and paste is
 * a clipboard read plus the same overwrite.
 *
 * These live here rather than inline in the file tab pane so the pane's editor
 * view stays under the complexity budget.
 */
export function useEditorClipboardActions(
  controllerRef: RefObject<EditorController | null>,
): EditorClipboardActions {
  // Cut and copy read the live selection rather than the cursor readout: the
  // readout is a render behind, and a wrong clipboard is worse than a slow one.
  const copySelectionText = useCallback(async (): Promise<string | null> => {
    const controller = controllerRef.current;
    if (!controller) return null;
    const selection = await controller.getSelection();
    if (selection.isEmpty) return null;
    await Clipboard.setStringAsync(selection.text);
    return selection.text;
  }, [controllerRef]);

  const copy = useCallback(() => {
    void copySelectionText();
  }, [copySelectionText]);

  const cut = useCallback(() => {
    void copySelectionText().then((text) => {
      if (text !== null) {
        controllerRef.current?.replaceSelection("");
      }
      return undefined;
    });
  }, [controllerRef, copySelectionText]);

  // A clipboard read can be refused (browser permission) — that is a no-op, not
  // an error worth a dialog. The keyboard's own Paste is unaffected either way.
  const paste = useCallback(() => {
    void Clipboard.getStringAsync()
      .then((text) => {
        if (text) {
          controllerRef.current?.replaceSelection(text);
        }
        return undefined;
      })
      .catch(() => undefined);
  }, [controllerRef]);

  const selectAll = useCallback(() => {
    controllerRef.current?.selectAll();
  }, [controllerRef]);

  // Expands to WHOLE lines rather than taking the caret's line only: with a
  // selection already spanning three lines, squaring it off is what the user
  // means, and with an empty one the range is that single line.
  const selectLine = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    void controller.getSelection().then((selection) => {
      controller.selectLines(selection.lineStart, selection.lineEnd, { reveal: false });
      return undefined;
    });
  }, [controllerRef]);

  return { copy, cut, paste, selectAll, selectLine };
}
