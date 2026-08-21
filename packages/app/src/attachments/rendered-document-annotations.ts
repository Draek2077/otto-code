import type { WorkspaceComposerAttachment } from "./types";

/**
 * The preview-owned projection of comment attachments. Keeping it derived from
 * the same workspace attachment list as Composer means removing a pill also
 * removes the matching heading glyph without a second source of truth.
 */
export function collectAnnotatedHeadingSourceLines(input: {
  attachments: readonly WorkspaceComposerAttachment[];
  path: string | null;
}): number[] {
  return input.attachments.flatMap((attachment) =>
    attachment.kind === "rendered_document" &&
    attachment.path === input.path &&
    attachment.locator.kind === "heading"
      ? [attachment.locator.lineStart]
      : [],
  );
}

/** The saved note used to reopen the shared editor when its heading glyph is clicked. */
export function collectAnnotatedHeadingComments(input: {
  attachments: readonly WorkspaceComposerAttachment[];
  path: string | null;
}): ReadonlyMap<number, string> {
  const comments = new Map<number, string>();
  for (const attachment of input.attachments) {
    if (
      attachment.kind === "rendered_document" &&
      attachment.path === input.path &&
      attachment.locator.kind === "heading"
    ) {
      comments.set(attachment.locator.lineStart, attachment.comment);
    }
  }
  return comments;
}
