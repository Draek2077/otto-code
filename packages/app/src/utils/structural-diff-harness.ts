import { buildLineDiff, type DiffLine } from "@/utils/tool-call-parsers";
import {
  buildStructuralDiffBlocks,
  buildStructuralDiffRows,
  getStructuralDiffAvailability,
  type DiffDocument,
  type StructuralAvailability,
  type StructuralDiffBlock,
  type StructuralDiffRow,
} from "./diff-document";

/**
 * The fast, pure seam for structural-diff fixtures. It deliberately takes two
 * complete source snapshots, not a unified hunk: structural comparison needs
 * the file context that a patch may have omitted.
 */
export interface StructuralDiffEvaluation {
  document: DiffDocument;
  lineDiff: readonly DiffLine[];
  rows: readonly StructuralDiffRow[];
  blocks: readonly StructuralDiffBlock[];
  availability: StructuralAvailability;
  pairedChanges: number;
  sharedContextRows: number;
  unpairedAdditions: number;
  unpairedRemovals: number;
}

export function evaluateStructuralSourcePair(input: {
  before: string;
  after: string;
  filePath: string;
}): StructuralDiffEvaluation {
  const lineDiff = buildLineDiff(input.before, input.after);
  const document: DiffDocument = {
    source: "before-after",
    filePath: input.filePath,
    lines: lineDiff,
    beforeSource: input.before,
    afterSource: input.after,
  };
  const rows = buildStructuralDiffRows(document);
  const blocks = buildStructuralDiffBlocks(document);
  const availability = getStructuralDiffAvailability(document);

  let pairedChanges = 0;
  let sharedContextRows = 0;
  let unpairedAdditions = 0;
  let unpairedRemovals = 0;
  for (const row of rows) {
    if (row.kind !== "pair") continue;
    if (row.left?.type === "context" && row.right?.type === "context") {
      // A final newline becomes an empty context row in the line-diff model,
      // but it is not a visible shared code row for review-quality metrics.
      if (row.left.content.trim().length > 0) sharedContextRows += 1;
    } else if (row.left?.type === "remove" && row.right?.type === "add") {
      pairedChanges += 1;
    } else if (row.left === null && row.right?.type === "add") {
      unpairedAdditions += 1;
    } else if (row.left?.type === "remove" && row.right === null) {
      unpairedRemovals += 1;
    }
  }

  return {
    document,
    lineDiff,
    rows,
    blocks,
    availability,
    pairedChanges,
    sharedContextRows,
    unpairedAdditions,
    unpairedRemovals,
  };
}
