import { isLanguageSupported, type HighlightToken } from "@otto-code/highlight";
import type { FileSearchMatch } from "@otto-code/protocol/messages";
import {
  splitTokensForMatches,
  type MatchedTokenSegment,
  type PreviewLineMatchRange,
} from "@/components/file-preview-find";
import { extensionFromPath, tokenizeToLines } from "@/utils/highlight-cache";

/**
 * One rendered code row. Several matches on the same source line collapse into
 * a single row - a code view shows a line once, with every hit on it lit up,
 * rather than repeating the line per match.
 */
export interface SearchDisplayLine {
  key: string;
  /** 1-based source coordinate for the gutter. */
  line: number;
  /** Display text, which the daemon may have truncated around the first match. */
  text: string;
  /** Hit spans within `text`, in the shape the shared find renderer takes. */
  ranges: PreviewLineMatchRange[];
  /** Every match key this row stands for, so selection stays per-match. */
  matchKeys: string[];
}

/**
 * The absolute (0-based) column where a match's preview window starts in the
 * full source line. Matches on one line can carry different windows - the
 * daemon centers each one on its own hit - so a shared row has to re-project
 * the others into the window it actually renders.
 */
function windowStartOf(match: FileSearchMatch): number {
  return match.column - 1 - match.previewStart;
}

export function buildSearchDisplayLines(
  matches: readonly FileSearchMatch[],
  buildMatchKey: (match: FileSearchMatch) => string,
): SearchDisplayLine[] {
  const rows = new Map<number, { row: SearchDisplayLine; windowStart: number }>();
  const order: number[] = [];
  for (const match of matches) {
    let entry = rows.get(match.line);
    if (!entry) {
      entry = {
        row: {
          key: `${match.line}`,
          line: match.line,
          text: match.lineText,
          ranges: [],
          matchKeys: [],
        },
        windowStart: windowStartOf(match),
      };
      rows.set(match.line, entry);
      order.push(match.line);
    }
    entry.row.matchKeys.push(buildMatchKey(match));
    // Re-project onto the window this row actually renders. A hit that falls
    // outside it keeps its selection key but has nothing to light up. Project
    // search has no "current" hit to step through, so no range is ever active.
    const start = match.column - 1 - entry.windowStart;
    if (match.length > 0 && start >= 0 && start + match.length <= entry.row.text.length) {
      entry.row.ranges.push({ start, end: start + match.length, active: false });
    }
  }
  return order.map((line) => rows.get(line)!.row);
}

/**
 * The token stream to cut match ranges out of. Falls back to one unstyled token
 * when the highlighter did not run or disagrees with the preview text: tokens
 * that do not reconstruct the line would shift where the match is drawn.
 */
export function resolveSearchLineTokens(
  text: string,
  tokens: readonly HighlightToken[] | null | undefined,
): HighlightToken[] {
  if (tokens && tokens.map((token) => token.text).join("") === text) {
    return [...tokens];
  }
  return [{ text, style: null }];
}

/**
 * The grammar extension to highlight a result file's hits with, or null when
 * the highlighter has no grammar for it (those lines render as plain text).
 */
export function searchHighlightExtension(filePath: string): string | null {
  const ext = extensionFromPath(filePath);
  return ext !== null && isLanguageSupported(`x.${ext}`) ? ext : null;
}

/**
 * A line's rendered segments, tokenized on first sight and then kept for as
 * long as the line itself is (the session holds the result objects the display
 * lines hang off, so a line is tokenized at most once per search).
 *
 * This has to be a cache of its own rather than a lean on `tokenizeToLines`:
 * that cache holds 200 entries shared across the whole app, and a wide search
 * carries thousands of lines, so it would thrash and re-parse every line on
 * every scroll pass. Resolving lazily per line also means only the lines the
 * reader has actually scrolled past are ever parsed.
 */
const segmentCache = new WeakMap<SearchDisplayLine, MatchedTokenSegment[]>();

export function getSearchLineSegments(
  line: SearchDisplayLine,
  ext: string | null,
): MatchedTokenSegment[] {
  const cached = segmentCache.get(line);
  if (cached) {
    return cached;
  }
  // Each hit is tokenized on its own. They are disjoint lines lifted out of a
  // file, so joining them would let an unterminated string or comment on one
  // bleed into the next.
  const tokens = ext === null ? null : tokenizeToLines(line.text, ext)?.[0];
  const segments = splitTokensForMatches(resolveSearchLineTokens(line.text, tokens), line.ranges);
  segmentCache.set(line, segments);
  return segments;
}
