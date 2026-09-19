import { isWeb } from "@/constants/platform";

// Longer than any sensible search term; a selection this size is a block of
// code the user highlighted for some other reason, not a query.
const MAX_SEARCH_SEED_LENGTH = 500;

/**
 * Turns highlighted text into a find-in-project query, the way an IDE seeds
 * its search box. Multi-line selections do not seed: the search is line-based,
 * so a query spanning lines can never match.
 */
export function normalizeSearchSeed(text: string | null | undefined): string | null {
  if (!text) {
    return null;
  }
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_SEARCH_SEED_LENGTH || /[\r\n]/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/**
 * Reads the text highlighted right now, wherever it is: a text field (whose
 * selection the document selection does not report), the code editor, or
 * rendered content such as a chat message. Read it before the shortcut moves
 * focus, which is what collapses the selection.
 */
export function readSearchSeedFromSelection(): string | null {
  if (!isWeb || typeof document === "undefined") {
    return null;
  }
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    const start = active.selectionStart;
    const end = active.selectionEnd;
    if (start !== null && end !== null && end > start) {
      return normalizeSearchSeed(active.value.slice(start, end));
    }
    return null;
  }
  return normalizeSearchSeed(window.getSelection()?.toString());
}
