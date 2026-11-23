import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";
import { parseMarkdownPreviewDocument } from "@/file-pane/markdown-preview/document";
export interface MarkdownNoteTarget {
  title: string;
  level: number;
  from: number;
  to: number;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  excerpt: string;
}
function title(node: Nodes): string {
  if ("value" in node) return node.value;
  return "children" in node ? node.children.map(title).join("") : "";
}
/** Top-level source headings only. HTML fragments, converted documents and
 * fenced examples never acquire a guessed source locator. */
export function markdownNoteTargets(source: string): MarkdownNoteTarget[] {
  const { body } = parseMarkdownPreviewDocument(source);
  const offset = source.length - body.length;
  const lineOffset = source.slice(0, offset).split(/\r\n|\r|\n/u).length - 1;
  return fromMarkdown(body)
    .children.flatMap((node) => {
      const position = node.position;
      if (
        node.type !== "heading" ||
        position?.start.offset === undefined ||
        position.end.offset === undefined
      )
        return [];
      const from = offset + position.start.offset,
        to = offset + position.end.offset;
      return [
        {
          title: title(node),
          level: node.depth,
          from,
          to,
          excerpt: source.slice(from, to),
          range: {
            start: {
              line: position.start.line - 1 + lineOffset,
              character: position.start.column - 1,
            },
            end: { line: position.end.line - 1 + lineOffset, character: position.end.column - 1 },
          },
        },
      ];
    })
    .slice(0, 2000);
}
