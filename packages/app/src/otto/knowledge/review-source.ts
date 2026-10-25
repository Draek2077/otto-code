import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";
import type { ReviewSelection } from "./review-model";
export interface ReviewTextRun {
  text: string;
  start: number;
  end: number;
}
export function reviewSourceBlocks(source: string) {
  return fromMarkdown(source).children.flatMap((node) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    return start === undefined || end === undefined
      ? []
      : [{ start, end, source: source.slice(start, end) }];
  });
}
/** Only exact source-backed text is selectable. Transformed/ambiguous text is refused. */
export function reviewTextRuns(source: string): ReviewTextRun[] {
  const runs: ReviewTextRun[] = [];
  const visit = (node: Nodes) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (
      (node.type === "text" || node.type === "inlineCode" || node.type === "code") &&
      start !== undefined &&
      end !== undefined
    ) {
      const raw = source.slice(start, end);
      const value = node.value;
      const offset = raw.indexOf(value);
      if (value && offset >= 0 && raw.indexOf(value, offset + 1) < 0)
        runs.push({ text: value, start: start + offset, end: start + offset + value.length });
    }
    if ("children" in node) for (const child of node.children) visit(child);
  };
  visit(fromMarkdown(source));
  return runs;
}
export function uniqueReviewSelection(source: string, text: string): ReviewSelection | null {
  if (!text.trim()) return null;
  const start = source.indexOf(text);
  if (start < 0 || source.indexOf(text, start + 1) >= 0) return null;
  return { start, end: start + text.length, selectedText: text };
}
