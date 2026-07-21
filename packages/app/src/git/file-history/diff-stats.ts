import type { DiffLine } from "@/utils/tool-call-parsers";

/**
 * Count changed *blocks*, not changed lines.
 *
 * A five-line replacement is one difference to someone stepping through a diff
 * — it is one edit — and that is what the count in the diff header is for. A
 * line count would report "10 differences" for a single renamed variable and
 * tell the reader nothing about how much work reviewing it is.
 *
 * Kept in its own module (no JSX) so it stays cheaply unit-testable.
 */
export function countDifferences(lines: DiffLine[]): number {
  let count = 0;
  let insideBlock = false;
  for (const line of lines) {
    const changed = line.type === "add" || line.type === "remove";
    if (changed && !insideBlock) {
      count += 1;
    }
    insideBlock = changed;
  }
  return count;
}
