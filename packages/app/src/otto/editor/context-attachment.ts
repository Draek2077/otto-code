import type { AgentAttachment } from "@getpaseo/protocol/messages";
/** Workspace context, independent of any provider or chat. A captured excerpt
 * identifies what was reviewed; it never pretends an unsaved draft is on disk. */
export interface EditorContextAttachment {
  kind: "editor_context";
  id: string;
  file: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  } | null;
  excerpt: string;
  note: string;
  locator: "source" | "markdown-heading";
}
export function sourceExcerpt(text: string, range: NonNullable<EditorContextAttachment["range"]>) {
  const lines = text.split(/\r\n|\r|\n/u);
  const captured = lines
    .slice(range.start.line, range.end.line + 1)
    .map((line, index) => {
      const from = index === 0 ? range.start.character : 0;
      const end = range.start.line + index === range.end.line ? range.end.character : line.length;
      return line.slice(from, end);
    })
    .join("\n");
  return captured.length > 20000
    ? `${captured.slice(0, 20000)}\n[Captured excerpt limited to 20,000 characters; requested range is shown above.]`
    : captured;
}
export function editorContextText(
  value: EditorContextAttachment,
): Extract<AgentAttachment, { type: "text" }> {
  const range = value.range
    ? `\nSource: ${value.range.start.line + 1}:${value.range.start.character + 1}-${value.range.end.line + 1}:${value.range.end.character + 1}`
    : "";
  return {
    type: "text",
    mimeType: "text/plain",
    title: value.note ? "File review note" : value.file.split(/[\\/]/u).at(-1),
    text: `Workspace file: ${value.file}${range}\nLocator: ${value.locator}\n${value.note ? `Review note: ${value.note}\n` : ""}${value.excerpt ? `Captured source (may include unsaved edits):\n${value.excerpt}` : ""}`,
  };
}
