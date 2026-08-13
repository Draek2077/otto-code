import {
  buildIndentationAwareInlineLineFragments,
  type InlineDiffFragment,
} from "./inline-diff-fragments";
import {
  buildStructuralDiffBlocks,
  diffCode,
  filterStructuralDiffBlocks,
  type DiffDocument,
  type StructuralDiffBlock,
} from "./diff-document";
import type { DiffLine } from "./tool-call-parsers";

/**
 * The exact review meaning consumed by the Structural renderer. Keeping this
 * separate from React means fixtures can assert what changed, not merely that
 * every source line survived a layout pass.
 */
export type StructuralRenderRow =
  | { kind: "header"; line: DiffLine }
  | { kind: "line"; line: DiffLine; tone?: "move" }
  | {
      kind: "inline-change";
      before: DiffLine;
      after: DiffLine;
      spans: readonly InlineDiffFragment[];
    }
  | {
      kind: "paired-change";
      before: DiffLine | null;
      after: DiffLine | null;
      tone: "formatting";
    };

export interface StructuralRenderPlan {
  readonly rows: readonly StructuralRenderRow[];
}

function appendLine(rows: StructuralRenderRow[], line: DiffLine, tone?: "move"): void {
  rows.push({ kind: "line", line, ...(tone ? { tone } : null) });
}

function appendReplacement(
  rows: StructuralRenderRow[],
  before: readonly DiffLine[],
  after: readonly DiffLine[],
): void {
  const count = Math.max(before.length, after.length);
  for (let index = 0; index < count; index += 1) {
    const left = before[index] ?? null;
    const right = after[index] ?? null;
    if (left && right) {
      rows.push({
        kind: "inline-change",
        before: left,
        after: right,
        spans: buildIndentationAwareInlineLineFragments(
          left.segments,
          right.segments,
          diffCode(left),
          diffCode(right),
        ),
      });
    } else if (left) {
      appendLine(rows, left);
    } else if (right) {
      appendLine(rows, right);
    }
  }
}

function appendBlock(rows: StructuralRenderRow[], block: StructuralDiffBlock): void {
  if (block.kind === "header" || block.kind === "shared" || block.kind === "addition") {
    for (const line of block.lines) appendLine(rows, line);
    return;
  }
  if (block.kind === "removal") {
    for (const line of block.lines) appendLine(rows, line);
    return;
  }
  if (block.kind === "move") {
    // Reviewers need the destination, not a duplicate previous location.
    if (block.direction === "to") {
      for (const line of block.lines) appendLine(rows, line, "move");
    }
    return;
  }
  if (block.kind === "replacement") {
    appendReplacement(rows, block.before, block.after);
    return;
  }
  const count = Math.max(block.before.length, block.after.length);
  for (let index = 0; index < count; index += 1) {
    rows.push({
      kind: "paired-change",
      before: block.before[index] ?? null,
      after: block.after[index] ?? null,
      tone: "formatting",
    });
  }
}

export function buildStructuralRenderPlan(
  document: DiffDocument,
  { showFormattingChanges = true }: { showFormattingChanges?: boolean } = {},
): StructuralRenderPlan {
  const rows: StructuralRenderRow[] = [];
  for (const block of filterStructuralDiffBlocks(
    buildStructuralDiffBlocks(document),
    showFormattingChanges,
  )) {
    appendBlock(rows, block);
  }
  return { rows };
}
