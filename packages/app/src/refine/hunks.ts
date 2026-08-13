// The pure core of Refine: turn a flat line diff into reviewable groups, and
// replay that diff with a per-group keep/drop decision. No React, no wire -
// everything that decides what gets written lives here, unit-tested in
// isolation, because this is the module the "nothing is written until Accept"
// invariant actually rests on.
//
// `buildLineDiff` (utils/tool-call-parsers) returns a flat DiffLine[] with no
// `@@` headers and no line numbers. That is enough to render, but not to accept
// half of it, which is why this module exists.

import { buildLineDiff, type DiffLine } from "@/utils/tool-call-parsers";

/** A contiguous run of changes, with its surrounding context, as one decision. */
export interface RefineHunk {
  /**
   * Stable within one proposal - the index is enough. Nothing carries across
   * regenerations by design (see the charter's §3.2): each round rebuilds the
   * diff from `base`, so there is no hunk identity to match.
   */
  id: string;
  /** The lines to render, including up to `contextLines` on each side. */
  lines: DiffLine[];
  /** Inclusive index of the hunk's first changed line in the flat diff. */
  changeStart: number;
  /** Inclusive index of the hunk's last changed line in the flat diff. */
  changeEnd: number;
  additions: number;
  removals: number;
}

/** A proposal, pre-diffed against the pinned base and grouped for review. */
export interface RefineDiff {
  /** The full flat diff - the authority for replay; hunks index into it. */
  lines: DiffLine[];
  hunks: RefineHunk[];
}

export const DEFAULT_REFINE_CONTEXT_LINES = 3;

function isChange(line: DiffLine): boolean {
  return line.type === "add" || line.type === "remove";
}

/**
 * `DiffLine.content` carries its own leading `+`/`-`/space; the document text
 * is what is left after it. Getting this wrong is silent and total - every line
 * of the accepted file would gain a stray character - so it lives in one place
 * and the round-trip properties in the tests prove it.
 */
function lineText(line: DiffLine): string {
  return line.content.slice(1);
}

/**
 * Group a flat diff into hunks: a hunk opens at the first changed line and
 * closes once `contextLines` consecutive context lines have gone by. Interior
 * context runs shorter than that stay inside the hunk rather than splitting it.
 *
 * The returned hunks never overlap: a hunk only closes after `contextLines`
 * unchanged lines, so the next hunk's leading context starts past this one's
 * trailing context.
 */
export function groupDiffHunks(
  lines: DiffLine[],
  contextLines: number = DEFAULT_REFINE_CONTEXT_LINES,
): RefineHunk[] {
  const padding = Math.max(0, contextLines);
  const hunks: RefineHunk[] = [];
  let changeStart: number | null = null;
  let changeEnd = -1;
  // Where the previous hunk's rendered window ended, so two hunks separated by
  // exactly `contextLines` never render the same context lines twice.
  let renderedThrough = -1;

  const close = (): void => {
    if (changeStart === null) {
      return;
    }
    const start = Math.max(renderedThrough + 1, changeStart - padding);
    const end = Math.min(lines.length - 1, changeEnd + padding);
    renderedThrough = end;
    const slice = lines.slice(start, end + 1);
    hunks.push({
      id: `h${hunks.length}`,
      lines: slice,
      changeStart,
      changeEnd,
      additions: slice.filter((line) => line.type === "add").length,
      removals: slice.filter((line) => line.type === "remove").length,
    });
    changeStart = null;
    changeEnd = -1;
  };

  for (const [index, line] of lines.entries()) {
    if (isChange(line)) {
      if (changeStart === null) {
        changeStart = index;
      }
      changeEnd = index;
      continue;
    }
    // A context line: close the open hunk once enough of them have passed.
    if (changeStart !== null && index - changeEnd >= padding) {
      close();
    }
  }
  close();

  return hunks;
}

/**
 * Diff a proposal against the pinned base and group it in one step. The diff is
 * always against `base`, never against the previous proposal - the user's
 * reference point is the file as it was, so total drift stays visible however
 * many rounds have run.
 */
export function buildRefineDiff(
  base: string,
  proposal: string,
  contextLines: number = DEFAULT_REFINE_CONTEXT_LINES,
): RefineDiff {
  // Refine replays this diff back into file text, so the trailing newline has
  // to survive the split: `applyRefineDecisions` rejoins with "\n", and the
  // display-oriented default would silently drop the file's terminator.
  const lines = buildLineDiff(base, proposal, { preserveTrailingNewline: true });
  return { lines, hunks: groupDiffHunks(lines, contextLines) };
}

/**
 * Replay the diff with the given hunks kept: context lines are always taken,
 * a kept hunk contributes its additions, a dropped hunk contributes its
 * removals (i.e. the base text stays). The result is LF-normalized, matching
 * the editor buffer and the daemon's write contract - the daemon re-applies the
 * file's detected EOL.
 *
 * Two properties pin this down, and both are tested:
 * - keeping nothing reproduces the base exactly;
 * - keeping everything reproduces the proposal exactly.
 *
 * Note there is no `base` parameter: the diff already contains it (context +
 * removals *is* the base), so a caller cannot pass a base the diff was not
 * built from.
 */
/** Flat-diff indices covered by a kept hunk. */
function collectKeptIndices(diff: RefineDiff, keptIds: ReadonlySet<string>): Set<number> {
  const kept = new Set<number>();
  for (const hunk of diff.hunks) {
    if (!keptIds.has(hunk.id)) {
      continue;
    }
    for (let index = hunk.changeStart; index <= hunk.changeEnd; index += 1) {
      kept.add(index);
    }
  }
  return kept;
}

export function applyRefineDecisions(diff: RefineDiff, keptIds: ReadonlySet<string>): string {
  const keptIndices = collectKeptIndices(diff, keptIds);

  const out: string[] = [];
  for (const [index, line] of diff.lines.entries()) {
    if (line.type === "context") {
      out.push(lineText(line));
      continue;
    }
    if (line.type === "header") {
      // buildLineDiff never emits these; a unified-diff source might.
      continue;
    }
    const kept = keptIndices.has(index);
    if (line.type === "add" ? kept : !kept) {
      out.push(lineText(line));
    }
  }
  return out.join("\n");
}

/** Every hunk id - the default selection after each round (see §3.2). */
export function allHunkIds(diff: RefineDiff): Set<string> {
  return new Set(diff.hunks.map((hunk) => hunk.id));
}

export interface RefineChangeCounts {
  additions: number;
  removals: number;
}

/** Totals across the kept hunks, for the "what am I about to accept" header. */
export function countKeptChanges(
  diff: RefineDiff,
  keptIds: ReadonlySet<string>,
): RefineChangeCounts {
  let additions = 0;
  let removals = 0;
  for (const hunk of diff.hunks) {
    if (!keptIds.has(hunk.id)) {
      continue;
    }
    for (let index = hunk.changeStart; index <= hunk.changeEnd; index += 1) {
      const line = diff.lines[index];
      if (line?.type === "add") {
        additions += 1;
      } else if (line?.type === "remove") {
        removals += 1;
      }
    }
  }
  return { additions, removals };
}
