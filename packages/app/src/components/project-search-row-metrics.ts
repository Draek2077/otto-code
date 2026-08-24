/**
 * Row geometry for the Search results list.
 *
 * A virtualized list that cannot say how tall a row is has to guess: the rows
 * outside the window are replaced by spacers sized from the average height of
 * whatever has been measured so far, and that average is re-taken as rows
 * mount. Search rows are a 28px file header one moment and a 300px code well
 * the next, so the average is never close, and every batch that mounts resizes
 * the content above the reader - the list lurches, and the correction storms
 * the next batch in turn.
 *
 * These rows are computable: a chunk is its lines times the code line height
 * plus the hairline the outer chunks draw. So the list is told exactly where
 * every row sits (`getItemLayout`) instead of guessing, and the rows whose
 * height cannot be computed - a wrapped line, an open review thread - report
 * what they measured so the answer converges on the first render rather than
 * on every scroll pass.
 */

export interface SearchRowGeometry {
  /** A file header row. They are uniform, so one measurement covers them all. */
  fileRowHeight: number;
  /** One code line: the row's min height, and its text's line height. */
  codeLineHeight: number;
  /** The hairline the first and last chunk of a file draw around the well. */
  chunkBorderWidth: number;
}

/**
 * The part of a results row its height depends on. Structural, so the pane can
 * pass its own row objects without building a second shape for every row on
 * every recount.
 */
export interface SearchRowShape {
  kind: "file" | "matches";
  /** The chunk's matched lines. A file row carries none. */
  lines?: readonly unknown[];
  isFirstChunk?: boolean;
  isLastChunk?: boolean;
}

/** What a row will measure, before it has ever been rendered. */
export function estimateSearchRowHeight(row: SearchRowShape, geometry: SearchRowGeometry): number {
  if (row.kind === "file") {
    return geometry.fileRowHeight;
  }
  const frame =
    (row.isFirstChunk === true ? geometry.chunkBorderWidth : 0) +
    (row.isLastChunk === true ? geometry.chunkBorderWidth : 0);
  return (row.lines?.length ?? 0) * geometry.codeLineHeight + frame;
}

/**
 * Prefix offsets over `heights`: entry `i` is row `i`'s y, and the last entry
 * is the whole list's height.
 *
 * Built once per height change rather than summed per lookup, because the list
 * asks for the layout of every row it considers and a linear sum there is
 * quadratic over a result set that runs to thousands of rows.
 */
export function buildSearchRowOffsets(heights: readonly number[]): number[] {
  const offsets: number[] = Array.from({ length: heights.length + 1 }, () => 0);
  let offset = 0;
  for (let index = 0; index < heights.length; index += 1) {
    offsets[index] = offset;
    offset += heights[index] ?? 0;
  }
  offsets[heights.length] = offset;
  return offsets;
}
