// Helpers for drawing a colored avatar circle with a short text label on top:
// a 1–3 character acronym from a name, and a dark/white text color picked to
// contrast against the circle's background. Used by the Active Team switcher;
// intentionally generic so other colored-avatar surfaces can reuse it.

import { accentFillInk } from "@/styles/theme";

// Leading articles carry no identity, so they're skipped when building the
// acronym ("The Otto Crew" → "OC", not "TO"). Dropped only when meaningful words
// remain, so a name that is *only* articles still yields a letter.
const ACRONYM_STOPWORDS = new Set(["the", "a", "an"]);

/**
 * Up-to-2-character badge label for an avatar (2 is the most that fits the
 * circle). Multi-word names become an acronym (first letter of each of the first
 * two significant words, skipping leading articles like "the"/"a"/"an"); a
 * single significant word uses its first letter. Leading punctuation/emoji are
 * ignored. Returns "" when nothing usable is found so the caller can fall back
 * to an icon.
 */
export function deriveAvatarAcronym(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((word) => word.length > 0);
  if (words.length === 0) {
    return "";
  }
  const significant = words.filter((word) => !ACRONYM_STOPWORDS.has(word.toLowerCase()));
  // Keep the articles only if that's all there is (e.g. a team literally named
  // "The"), otherwise the acronym would be empty.
  const source = significant.length > 0 ? significant : words;
  if (source.length === 1) {
    return source[0]!.slice(0, 1).toUpperCase();
  }
  return source
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
}

// Normalizes user-supplied color input ("#rrggbb", "rrggbb", 3-digit
// shorthand) to the "#rrggbb" shape `accentFillInk` expects; null when the
// input isn't a hex color.
function normalizeHexColor(value: string): string | null {
  let hex = value.trim().replace(/^#/, "");
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((channel) => channel + channel)
      .join("");
  }
  if (hex.length !== 6 || /[^0-9a-fA-F]/.test(hex)) {
    return null;
  }
  return `#${hex}`;
}

/**
 * Dark or white ink — whichever contrasts better against `hexColor`.
 * Delegates to the design system's `accentFillInk` formula so avatar badges
 * and accent chips always agree about black-vs-white ink on the same color.
 * Falls back to white for input that can't be parsed as a hex color.
 */
export function readableTextColor(hexColor: string): string {
  const normalized = normalizeHexColor(hexColor);
  if (!normalized) {
    return "#ffffff";
  }
  return accentFillInk(normalized);
}
