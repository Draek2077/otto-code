/**
 * Run-collapsing for gutter blame.
 *
 * Forty consecutive lines from one commit should print its author once, not
 * forty times. The repetition is not just noise — it actively hides the only
 * thing blame is read for, which is *where authorship changes*.
 *
 * Pure and separate from the renderer so it can be tested without mounting
 * React Native.
 */

/** A line's position in the post-image, or null where blame does not apply. */
export interface BlameRunInput {
  /** Post-image line number; null for removed lines and hunk headers. */
  newLineNumber: number | null;
}

/**
 * For each row, the sha to annotate it with, or null when the row either has no
 * blame or repeats the row above it.
 */
export function buildBlameRunFlags(
  rows: readonly BlameRunInput[],
  shaForLine: (line: number) => string | undefined,
): (string | null)[] {
  let previousSha: string | null = null;
  return rows.map((row) => {
    // A removed line is absent from the post-image, so nothing blames it, and a
    // hunk header is not a line at all. Both break the run.
    if (row.newLineNumber === null) {
      previousSha = null;
      return null;
    }
    const sha = shaForLine(row.newLineNumber);
    if (!sha) {
      previousSha = null;
      return null;
    }
    const startsRun = sha !== previousSha;
    previousSha = sha;
    return startsRun ? sha : null;
  });
}
