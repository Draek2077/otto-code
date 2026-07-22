import type { HighlightToken } from "@otto-code/highlight";

// Find-in-file for the read-only preview. The preview renders plain data (a
// token stream per line, or rendered markdown), so search runs here as a pure
// text scan over the file contents — no CodeMirror involved. Matching mirrors
// the editor's semantics (case toggle, whole word, regexp) so the same query
// finds the same things in both views.

/** What to search for; a subset of the editor's find state (no replace). */
export interface PreviewFindQuery {
  search: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;
}

export interface PreviewFindMatch {
  /** 1-based line number in the file. */
  line: number;
  /** Character offsets within that line, [start, end). */
  start: number;
  end: number;
}

/** A match's span within one line, flagged when it is the active match. */
export interface PreviewLineMatchRange {
  start: number;
  end: number;
  active: boolean;
}

/**
 * Matching stops here; the strip displays 999+ beyond the editor's cap. Keeps
 * a one-letter query against a huge file from building a million-entry array.
 */
export const MAX_PREVIEW_FIND_MATCHES = 1000;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildPattern(query: PreviewFindQuery): RegExp | null {
  const source = query.regexp ? query.search : escapeRegExp(query.search);
  try {
    return new RegExp(source, query.caseSensitive ? "g" : "gi");
  } catch {
    // An in-progress regexp (e.g. a lone "(") is simply not a query yet.
    return null;
  }
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;

/** Whole-word means the match is not butted against word characters. */
function isWholeWordMatch(line: string, start: number, end: number): boolean {
  const before = start > 0 ? line[start - 1] : "";
  const after = end < line.length ? line[end] : "";
  return !(before && WORD_CHAR.test(before)) && !(after && WORD_CHAR.test(after));
}

/**
 * All matches of `query` in `content`, per line, in document order. Matches
 * never span lines (same as typing the query into the editor's find strip for
 * anything you could actually see highlighted line-by-line).
 */
export function findPreviewMatches(content: string, query: PreviewFindQuery): PreviewFindMatch[] {
  if (!query.search) {
    return [];
  }
  const pattern = buildPattern(query);
  if (!pattern) {
    return [];
  }
  const matches: PreviewFindMatch[] = [];
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    pattern.lastIndex = 0;
    let hit: RegExpExecArray | null;
    while ((hit = pattern.exec(line)) !== null) {
      if (hit[0].length === 0) {
        // A zero-width regexp match would loop forever; step past it.
        pattern.lastIndex += 1;
        continue;
      }
      const start = hit.index;
      const end = start + hit[0].length;
      if (!query.wholeWord || isWholeWordMatch(line, start, end)) {
        matches.push({ line: index + 1, start, end });
        if (matches.length >= MAX_PREVIEW_FIND_MATCHES) {
          return matches;
        }
      }
    }
  }
  return matches;
}

/** One run of same-styled text within a rendered line. */
export interface MatchedTokenSegment {
  text: string;
  style: HighlightToken["style"];
  /** Which find decoration this run carries, if any. */
  highlight: "match" | "active" | null;
}

/**
 * Re-cut a line's syntax tokens so match ranges become their own segments,
 * keeping each segment's syntax style. Ranges must not overlap (regexp
 * matching never produces overlapping hits).
 */
export function splitTokensForMatches(
  tokens: readonly HighlightToken[],
  ranges: readonly PreviewLineMatchRange[],
): MatchedTokenSegment[] {
  if (ranges.length === 0) {
    return tokens.map((token) => ({ text: token.text, style: token.style, highlight: null }));
  }
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const segments: MatchedTokenSegment[] = [];
  let offset = 0;
  for (const token of tokens) {
    const tokenStart = offset;
    const tokenEnd = offset + token.text.length;
    let cursor = tokenStart;
    for (const range of sorted) {
      if (range.end <= cursor || range.start >= tokenEnd) {
        continue;
      }
      const highlightStart = Math.max(range.start, cursor);
      const highlightEnd = Math.min(range.end, tokenEnd);
      if (highlightStart > cursor) {
        segments.push({
          text: token.text.slice(cursor - tokenStart, highlightStart - tokenStart),
          style: token.style,
          highlight: null,
        });
      }
      segments.push({
        text: token.text.slice(highlightStart - tokenStart, highlightEnd - tokenStart),
        style: token.style,
        highlight: range.active ? "active" : "match",
      });
      cursor = highlightEnd;
    }
    if (cursor < tokenEnd) {
      segments.push({
        text: token.text.slice(cursor - tokenStart),
        style: token.style,
        highlight: null,
      });
    }
    offset = tokenEnd;
  }
  return segments.filter((segment) => segment.text.length > 0);
}
