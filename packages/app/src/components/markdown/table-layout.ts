import type { ASTNode } from "react-native-markdown-display";

/** Whether a table node is the final child of its immediate expected parent. */
export function isLastMarkdownTableChild(
  node: ASTNode,
  parentNodes: ASTNode[],
  parentType: "tbody" | "tr",
): boolean {
  const parent = parentNodes[0];
  return parent?.type === parentType && node.index === parent.children.length - 1;
}
