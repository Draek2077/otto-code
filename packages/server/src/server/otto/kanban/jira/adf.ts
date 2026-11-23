import { z } from "zod";
import { failure, type Result } from "@getpaseo/plugin/otto/kanban";
const NodeSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
  content: z.array(z.unknown()).optional(),
});
const blocks = new Set(["paragraph", "heading", "listItem", "codeBlock", "blockquote", "tableRow"]);
/** Read strings or structured Atlassian documents without executing HTML or silently truncating them. */
export function jiraDescription(value: unknown): Result<string> {
  if (value === null || value === undefined) return { ok: true, value: "" };
  if (typeof value === "string") return { ok: true, value };
  const stack: Array<{ value: unknown; depth: number; end: boolean }> = [
    { value, depth: 0, end: false },
  ];
  let count = 0;
  let text = "";
  while (stack.length) {
    const row = stack.pop()!;
    if (row.end) {
      if (text && !text.endsWith("\n")) text += "\n";
      continue;
    }
    if (++count > 10_000 || row.depth > 64)
      return failure(
        "read_limit",
        "This Jira description exceeds Otto's document depth or node limit.",
      );
    const node = NodeSchema.safeParse(row.value);
    if (!node.success)
      return failure("invalid_response", "Jira returned an invalid description document.");
    if (node.data.text) text += node.data.text;
    if (node.data.type === "hardBreak") text += "\n";
    if (blocks.has(node.data.type)) stack.push({ value: null, depth: row.depth, end: true });
    for (const child of (node.data.content ?? []).toReversed())
      stack.push({ value: child, depth: row.depth + 1, end: false });
  }
  return { ok: true, value: text.trimEnd() };
}
/** Explicit plain-text edits replace the description; unrelated rich fields are never rewritten. */
export function jiraDocument(text: string): { version: 1; type: "doc"; content: unknown[] } | null {
  if (!text) return null;
  return {
    version: 1,
    type: "doc",
    content: text
      .split(/\r?\n/)
      .map((line) => ({ type: "paragraph", content: line ? [{ type: "text", text: line }] : [] })),
  };
}
