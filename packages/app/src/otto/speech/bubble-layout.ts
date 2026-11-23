import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmTable } from "micromark-extension-gfm-table";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
import type { PhrasingContent } from "mdast";

function intrinsicInline(node: PhrasingContent): boolean {
  switch (node.type) {
    case "text":
    case "inlineCode":
    case "break":
      return true;
    case "strong":
    case "emphasis":
    case "link":
      return node.children.every(intrinsicInline);
    default:
      // Images, embedded HTML, extensions and unknown nodes need a containing
      // column. Never infer that an unfamiliar renderer can shrink to its text.
      return false;
  }
}

/** Layout only: the original source always goes to Paseo's renderer unchanged.
 * Full width is the default, including during streaming. Only small, completed
 * inline-prose paragraphs opt into intrinsic sizing. Reuse the same mdast/GFM
 * syntax as Paseo's source adapter; do not parse on the reveal hot path or scan
 * large replies again merely to choose a background width.
 */
export function canFitAssistantProse(source: string, settled: boolean): boolean {
  if (!settled || source.length > 4096) return false;
  const tree = fromMarkdown(source, {
    extensions: [gfmTable()],
    mdastExtensions: [gfmTableFromMarkdown()],
  });
  if (tree.children.length !== 1) return false;
  const block = tree.children[0];
  return block.type === "paragraph" && block.children.every(intrinsicInline);
}
