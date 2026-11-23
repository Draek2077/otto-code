import { buildLineDiff, type DiffLine } from "@/utils/tool-call-parsers";

export interface ReviewHunk {
  id: string;
  start: number;
  end: number;
  lines: DiffLine[];
}
export interface ReviewDiff {
  base: string;
  proposal: string;
  lines: DiffLine[];
  hunks: ReviewHunk[];
}
export function buildReviewDiff(base: string, proposal: string): ReviewDiff {
  if (base === proposal) return { base, proposal, lines: [], hunks: [] };
  const original = base.split("\n");
  const updated = proposal.split("\n");
  // The existing display diff uses LCS. Bound its matrix before entering it;
  // large articles get one fully visible whole-article decision instead.
  const wordWork =
    original.reduce((sum, line) => sum + line.length * line.length, 0) +
    updated.reduce((sum, line) => sum + line.length * line.length, 0);
  const lines =
    original.length * updated.length <= 1000000 &&
    wordWork <= 1000000 &&
    original.every((line) => line.length <= 2000) &&
    updated.every((line) => line.length <= 2000)
      ? buildLineDiff(base, proposal)
      : [
          ...original.map((line): DiffLine => ({ type: "remove", content: `-${line}` })),
          ...updated.map((line): DiffLine => ({ type: "add", content: `+${line}` })),
        ];
  const hunks: ReviewHunk[] = [];
  let start = -1;
  let end = -1;
  const close = () => {
    if (start < 0) return;
    hunks.push({
      id: `h${hunks.length}`,
      start,
      end,
      lines: lines.slice(Math.max(0, start - 2), end + 3),
    });
    start = -1;
  };
  for (const [index, line] of lines.entries()) {
    if (line.type === "add" || line.type === "remove") {
      if (start < 0) start = index;
      end = index;
    } else if (start >= 0 && index - end >= 3) close();
  }
  close();
  return { base, proposal, lines, hunks };
}
export function applyReviewHunks(diff: ReviewDiff, kept: ReadonlySet<string>): string {
  if (!kept.size) return diff.base;
  if (diff.hunks.every((hunk) => kept.has(hunk.id))) return diff.proposal;
  const included = new Set<number>();
  for (const hunk of diff.hunks) {
    if (kept.has(hunk.id))
      for (let index = hunk.start; index <= hunk.end; index++) included.add(index);
  }
  const base = diff.base.split("\n");
  const proposal = diff.proposal.split("\n");
  let originalIndex = 0;
  let proposalIndex = 0;
  const output: string[] = [];
  for (const [index, line] of diff.lines.entries()) {
    if (line.type === "context") {
      output.push(base[originalIndex++]);
      proposalIndex++;
    } else if (line.type === "remove") {
      const value = base[originalIndex++];
      if (!included.has(index)) output.push(value);
    } else if (line.type === "add") {
      const value = proposal[proposalIndex++];
      if (included.has(index)) output.push(value);
    }
  }
  return output.join("\n");
}
