import { Facet } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { openSearchPanel } from "@codemirror/search";

/** Web delegates to Paseo's floating Find owner; the offline native document
 * retains CodeMirror's own search panel. Neither path creates a second query. */
export const editorFindTarget = Facet.define<(view: EditorView) => boolean>();

export function openEditorFind(view: EditorView): boolean {
  const target = view.state.facet(editorFindTarget)[0];
  return target ? target(view) : openSearchPanel(view);
}
