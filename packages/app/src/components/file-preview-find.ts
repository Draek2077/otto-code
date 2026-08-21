import type { HighlightToken } from "@otto-code/highlight";

// Find-in-file for the read-only preview. The preview renders plain data (a
// token stream per line, or rendered markdown), so search runs here as a pure
// text scan over the file contents - no CodeMirror involved. Matching mirrors
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
    for (const { start, end } of matchesWithin(lines[index] ?? "", pattern, query.wholeWord)) {
      matches.push({ line: index + 1, start, end });
      if (matches.length >= MAX_PREVIEW_FIND_MATCHES) {
        return matches;
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

// ---------------------------------------------------------------------------
// Rendered documents (markdown, mermaid, AsciiDoc)
//
// The rendered view has no line grid to highlight against - prose reflows, and
// a heading is not "line 12" of anything you can see. So find runs over the
// *rendered* text runs instead: the same query, the same match semantics, and
// the same highlight tones as the code view, keyed by the text each rendered
// node actually shows.
// ---------------------------------------------------------------------------

/** A run of one rendered text node, flagged when it carries a find decoration. */
export interface MatchedTextSegment {
  text: string;
  /** Which find decoration this run carries, if any. */
  highlight: "match" | "active" | null;
}

/**
 * Cut a rendered node's text so match ranges become their own segments. The
 * plain-text twin of {@link splitTokensForMatches}, which does the same job for
 * a syntax-highlighted line.
 */
export function splitTextForMatches(
  text: string,
  ranges: readonly PreviewLineMatchRange[],
): MatchedTextSegment[] {
  if (ranges.length === 0) {
    return [{ text, highlight: null }];
  }
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const segments: MatchedTextSegment[] = [];
  let cursor = 0;
  for (const range of sorted) {
    if (range.start >= text.length || range.end <= cursor) {
      continue;
    }
    const start = Math.max(range.start, cursor);
    const end = Math.min(range.end, text.length);
    if (start > cursor) {
      segments.push({ text: text.slice(cursor, start), highlight: null });
    }
    segments.push({
      text: text.slice(start, end),
      highlight: range.active ? "active" : "match",
    });
    cursor = end;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), highlight: null });
  }
  return segments.filter((segment) => segment.text.length > 0);
}

export interface RenderedFindIndex {
  /** Matches across the whole rendered document, in reading order. */
  total: number;
  /**
   * Highlight ranges for each distinct rendered text run.
   *
   * Keyed by the run's text rather than by its position in the document: a
   * render rule is handed its node's content and nothing that identifies where
   * that node sits, and the ranges are a pure function of (content, query)
   * anyway. Two runs showing the same words therefore share one entry, which
   * is right for the match tint - see {@link buildRenderedFindIndex}.
   */
  byContent: ReadonlyMap<string, PreviewLineMatchRange[]>;
  /**
   * Where the active match sits, as a fraction of the document's rendered text.
   * The rendered view has no line height to scroll by, so the caller turns this
   * into a proportional scroll - the same estimate the outline already uses to
   * jump around a rendered document.
   */
  activeFraction: number | null;
}

const EMPTY_RENDERED_FIND_INDEX: RenderedFindIndex = {
  total: 0,
  byContent: new Map(),
  activeFraction: null,
};

/** Every match of `pattern` inside one run, honoring whole-word. */
function matchesWithin(
  text: string,
  pattern: RegExp,
  wholeWord: boolean,
): { start: number; end: number }[] {
  const found: { start: number; end: number }[] = [];
  pattern.lastIndex = 0;
  let hit: RegExpExecArray | null;
  while ((hit = pattern.exec(text)) !== null) {
    if (hit[0].length === 0) {
      // A zero-width regexp match would loop forever; step past it.
      pattern.lastIndex += 1;
      continue;
    }
    const start = hit.index;
    const end = start + hit[0].length;
    if (!wholeWord || isWholeWordMatch(text, start, end)) {
      found.push({ start, end });
    }
  }
  return found;
}

/**
 * Index a rendered document's text runs for find.
 *
 * `contents` is every text run the renderer will show, in reading order. The
 * count and the active match are resolved over that whole sequence, so
 * "3/17" means the same thing here as it does in the code view.
 *
 * One honest limitation: because ranges are keyed by content, two runs showing
 * identical words both wear the active tint when the active match lands in
 * either. The count, the ordering and the scroll target stay correct; only the
 * stronger tint is shared, and only between runs that read identically anyway.
 */
export function buildRenderedFindIndex(
  contents: readonly string[],
  query: PreviewFindQuery,
  activeMatchIndex: number,
): RenderedFindIndex {
  if (!query.search) {
    return EMPTY_RENDERED_FIND_INDEX;
  }
  const pattern = buildPattern(query);
  if (!pattern) {
    return EMPTY_RENDERED_FIND_INDEX;
  }

  // Ranges are a pure function of (content, query), so each distinct run is
  // scanned once however many times the document repeats it.
  const rangesByContent = new Map<string, PreviewLineMatchRange[]>();
  // Reading order, which is what the match ordinals and the scroll estimate
  // are both counted in.
  const ordered: { content: string; start: number; charOffset: number }[] = [];
  let charsSoFar = 0;
  let capped = false;

  for (const content of contents) {
    let found = rangesByContent.get(content);
    if (!found) {
      found = matchesWithin(content, pattern, query.wholeWord).map(({ start, end }) => ({
        start,
        end,
        active: false,
      }));
      rangesByContent.set(content, found);
    }
    if (!capped) {
      for (const range of found) {
        ordered.push({ content, start: range.start, charOffset: charsSoFar + range.start });
        if (ordered.length >= MAX_PREVIEW_FIND_MATCHES) {
          capped = true;
          break;
        }
      }
    }
    charsSoFar += content.length;
  }

  const active = ordered[activeMatchIndex] ?? null;
  if (active) {
    const hit = rangesByContent.get(active.content)?.find((range) => range.start === active.start);
    if (hit) {
      hit.active = true;
    }
  }

  return {
    total: ordered.length,
    byContent: rangesByContent,
    activeFraction: active && charsSoFar > 0 ? active.charOffset / charsSoFar : null,
  };
}
