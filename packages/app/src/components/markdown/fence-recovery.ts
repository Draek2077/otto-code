/**
 * Recovers a common model-output mistake: a whole reply is wrapped in
 * ```markdown, but its literal contents contain plain ``` fences. CommonMark
 * correctly closes the outer fence at the first of those lines, so the reply
 * alternates between code and live markdown. A longer outer marker preserves
 * the author's apparent intent.
 *
 * This is deliberately narrow. Markdown has no syntax for nesting equal
 * fences, so a general rewrite cannot distinguish this mistake from a series
 * of intentional adjacent blocks. Only a document that starts with a
 * `markdown` fence opts into recovery.
 */
const LEADING_MARKDOWN_FENCE_RE = /^( {0,3})(`{3,})(?:[ \t]+)?markdown[ \t]*(?:\r?\n|$)/i;

interface FenceLine {
  markerStart: number;
  markerEnd: number;
}

export function recoverMisnestedMarkdownFence(source: string): string {
  const opening = LEADING_MARKDOWN_FENCE_RE.exec(source);
  if (!opening?.[2]) {
    return source;
  }

  const marker = opening[2];
  const openingMarkerStart = opening[0].indexOf(marker);
  const candidates = findClosingFenceLines(source, opening[0].length, marker);

  // An inner open/close pair plus the intended outer close produces three
  // candidate delimiters after the opening marker. Fewer are unambiguous
  // CommonMark and must be left alone.
  if (candidates.length < 3) {
    return source;
  }

  const closing = candidates.at(-1);
  if (!closing) {
    return source;
  }

  const replacement = `${marker}\``;
  return `${source.slice(0, openingMarkerStart)}${replacement}${source.slice(
    openingMarkerStart + marker.length,
    closing.markerStart,
  )}${replacement}${source.slice(closing.markerEnd)}`;
}

function findClosingFenceLines(source: string, start: number, marker: string): FenceLine[] {
  const lines: FenceLine[] = [];
  const lineRe = /^ {0,3}(`{3,})[ \t]*(?:\r?\n|$)/gm;
  lineRe.lastIndex = start;

  while (true) {
    const match = lineRe.exec(source);
    if (!match) {
      return lines;
    }

    const candidate = match[1];
    if (candidate && candidate.length >= marker.length) {
      const markerStart = match.index + match[0].indexOf(candidate);
      lines.push({
        markerStart,
        markerEnd: markerStart + candidate.length,
      });
    }
  }
}
