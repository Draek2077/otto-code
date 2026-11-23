import type { Text } from "@codemirror/state";
export interface SourceLocation {
  lineStart?: number;
  lineEnd?: number;
  columnStart?: number;
  columnEnd?: number;
}
/** UI positions are one-based UTF-16. Clamp to the actual file, never select
 * an entire line when a language server supplied an exact symbol range. */
export function editorLocationSelection(doc: Text, location: SourceLocation) {
  const start = doc.line(Math.min(location.lineStart ?? 1, doc.lines));
  const end = doc.line(
    Math.min(Math.max(start.number, location.lineEnd ?? start.number), doc.lines),
  );
  const anchor = start.from + Math.min(start.length, Math.max(0, (location.columnStart ?? 1) - 1));
  let head = anchor;
  if (location.columnEnd !== undefined)
    head = end.from + Math.min(end.length, Math.max(0, location.columnEnd - 1));
  else if (end.number > start.number) head = end.to;
  return { anchor, head: Math.max(anchor, head) };
}
