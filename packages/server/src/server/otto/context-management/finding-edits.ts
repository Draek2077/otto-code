import { ContextConflict } from "./source-write.js";
export interface FindingRemoval {
  start: number;
  end: number;
  snippet: string;
}
/** Plan every removal against the same base before applying anything; never tidy unrelated text. */
export function removeFindingRanges(text: string, removals: readonly FindingRemoval[]): string {
  const ranges = removals
    .map((item) => removalRange(text, item))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: { start: number; end: number }[] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start < previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  let result = text;
  for (const range of merged.toReversed())
    result = result.slice(0, range.start) + result.slice(range.end);
  return result;
}
function removalRange(text: string, item: FindingRemoval): { start: number; end: number } {
  if (
    !Number.isInteger(item.start) ||
    !Number.isInteger(item.end) ||
    item.start < 0 ||
    item.end > text.length ||
    item.start >= item.end ||
    text.slice(item.start, item.end) !== item.snippet
  )
    throw new ContextConflict(
      "The finding no longer matches its reviewed source span. Refresh before applying fixes.",
    );
  const start = text.lastIndexOf("\n", item.start - 1) + 1;
  const newline = text.indexOf("\n", item.end);
  const end = newline < 0 ? text.length : newline;
  const remainder = (text.slice(start, item.start) + text.slice(item.end, end)).trim();
  if (!remainder || /^(?:[-*+]|\d+[.)])$/u.test(remainder))
    return { start, end: newline < 0 ? end : end + 1 };
  // Collapse only the new adjacent space at this deletion seam, preserving CRLF and all other formatting.
  return {
    start: item.start,
    end: item.end + (text[item.start - 1] === " " && text[item.end] === " " ? 1 : 0),
  };
}
