// Identifier-under-the-caret resolution for go-to-definition. Pure and
// language-agnostic on purpose: the daemon's symbol index is ctags-style and
// name-based (no type resolution), so all the editor has to contribute is the
// bare token the caret is sitting in. Anything smarter here would imply a
// precision the lookup on the other end cannot honour.
//
// This module is imported by editor-core.ts, which is bundled into the native
// webview — keep it free of React, React Native, and app-store imports.

/**
 * `$` and `_` are word characters in every language we index; `-` deliberately
 * is not, so `foo-bar` in a template reads as two identifiers rather than one
 * name that exists nowhere.
 */
function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_$]/.test(char);
}

/**
 * The identifier at a caret position, or `""` when the caret is not in one.
 *
 * `column` is 1-based and counted in UTF-16 code units — the same unit CM6 uses
 * for offsets (see `EditorCursorPosition`), so the caret sits *before* the
 * character at index `column - 1`.
 *
 * A caret touching a word on either side resolves to that word, matching what
 * every IDE does: `foo|` and `|foo` both mean `foo`. The character to the right
 * wins when both sides are word characters, which only happens mid-word.
 *
 * A token starting with a digit is rejected rather than looked up: it is a
 * number literal, never a definition, so asking the daemon about it would spend
 * a round trip to learn nothing.
 */
export function findWordAtCursor(lineText: string, column: number): string {
  const caret = Math.max(0, Math.min(column - 1, lineText.length));
  let index = caret;
  if (!isWordChar(lineText[index])) {
    index = caret - 1;
    if (index < 0 || !isWordChar(lineText[index])) {
      return "";
    }
  }
  let start = index;
  while (start > 0 && isWordChar(lineText[start - 1])) {
    start -= 1;
  }
  let end = index;
  while (end + 1 < lineText.length && isWordChar(lineText[end + 1])) {
    end += 1;
  }
  const word = lineText.slice(start, end + 1);
  return /^[0-9]/.test(word) ? "" : word;
}
