import type { FileContextAttachment, FileContextSelection } from "./types";

interface FileContextTarget {
  path: string;
  /** 1-based line, for the project-search "attach this match" case. */
  lineStart?: number;
  selection?: FileContextSelection;
}

/**
 * The one spelling of a file-context target.
 *
 * `file_context` attachments dedupe on `kind` + `id` (see
 * `appendWorkspaceAttachment`), and five surfaces now create them: the file
 * explorer, project search, the Changes pane, the editor toolbar, and `@`
 * mentions. If two of them spelled the same file differently the user would
 * get two pills for one file and have to remove both, so every producer builds
 * its id here.
 */
export function buildFileContextAttachmentId(target: FileContextTarget): string {
  if (target.selection) {
    return `${target.path}:${formatFileContextSelection(target.selection)}`;
  }
  if (target.lineStart != null) {
    return `${target.path}:${target.lineStart}`;
  }
  return target.path;
}

/**
 * `12:5-40:18` - the compact row:column form shown on the pill and sent to the
 * agent. Deliberately the same string in both places: the user should be able
 * to read the range off the pill and find it in the transcript.
 */
export function formatFileContextSelection(selection: FileContextSelection): string {
  return `${selection.startLine}:${selection.startColumn}-${selection.endLine}:${selection.endColumn}`;
}

/** A whole-file or line attachment, with the id derived rather than passed. */
export function createFileContextAttachment(
  target: FileContextTarget & { entryKind?: "file" | "directory" },
): FileContextAttachment {
  return {
    kind: "file_context",
    id: buildFileContextAttachmentId(target),
    path: target.path,
    ...(target.entryKind ? { entryKind: target.entryKind } : {}),
    ...(target.lineStart != null ? { lineStart: target.lineStart } : {}),
    ...(target.selection ? { selection: target.selection } : {}),
  };
}
