import type { EditorSelection } from "./editor-contract";

// What the find strip should be pre-filled with when it opens. Split out of the
// host component so the rule is testable without rendering an editor.

/**
 * Longest selection that still reads as a search *term*. Matches the cap
 * CM6's own search panel applies when it seeds itself (`defaultQuery` in
 * @codemirror/search), so the two agree about what is a term and what is just
 * a lot of selected text.
 */
const MAX_SEED_LENGTH = 100;

/**
 * The search term a selection seeds, or `null` to keep whatever the strip
 * already had.
 *
 * Only a single-line, non-empty selection seeds. A selection spanning lines is
 * a *region* — what you mean by it is "search inside here", never "search for
 * this whole block" — so clobbering the last search term with it would throw
 * away something useful in exchange for a term that matches once, at the
 * selection itself.
 */
export function resolveFindSeed(selection: EditorSelection): string | null {
  if (selection.isEmpty || selection.lineStart !== selection.lineEnd) {
    return null;
  }
  if (selection.text.length === 0 || selection.text.length > MAX_SEED_LENGTH) {
    return null;
  }
  return selection.text;
}
