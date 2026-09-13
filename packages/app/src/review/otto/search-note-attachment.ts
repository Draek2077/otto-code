import type { AgentAttachment } from "@otto-code/protocol/messages";
import type { ComposerAttachment } from "@/attachments/types";
import { buildReviewableDiffTargetKey } from "@/utils/diff-layout";
import type { ReviewDraftComment } from "../state";

type ReviewAttachment = Extract<AgentAttachment, { type: "review" }>;
type ReviewAttachmentContextLine = ReviewAttachment["comments"][number]["context"]["targetLine"];
type ReviewComposerAttachment = Extract<ComposerAttachment, { kind: "review" }>;

export interface BuildSearchNoteAttachmentSnapshotInput {
  reviewDraftKey: string;
  cwd: string;
  comments: readonly ReviewDraftComment[];
  /** Line text for the notes that still have a visible hit, by target key. */
  lineTextByTarget: ReadonlyMap<string, string>;
}

/**
 * The composer attachment for search notes.
 *
 * The diff builder quotes a hunk around the commented line; a search hit has no
 * hunk, so the context is the matched line itself - the one line the reader was
 * actually looking at. A note whose line is no longer in the results is skipped,
 * exactly as a diff comment with no surviving target is.
 */
export function buildSearchNoteAttachmentSnapshot(
  input: BuildSearchNoteAttachmentSnapshotInput,
): ReviewComposerAttachment | null {
  const comments: ReviewAttachment["comments"] = [];
  for (const draftComment of input.comments) {
    const targetKey = buildReviewableDiffTargetKey({
      filePath: draftComment.filePath,
      side: draftComment.side,
      lineNumber: draftComment.lineNumber,
    });
    const content = input.lineTextByTarget.get(targetKey);
    if (content === undefined) {
      continue;
    }
    const targetLine: ReviewAttachmentContextLine = {
      oldLineNumber: null,
      newLineNumber: draftComment.lineNumber,
      type: "context",
      content,
    };
    comments.push({
      filePath: draftComment.filePath,
      side: draftComment.side,
      lineNumber: draftComment.lineNumber,
      body: draftComment.body,
      context: {
        hunkHeader: `@@ -${draftComment.lineNumber},1 +${draftComment.lineNumber},1 @@`,
        targetLine,
        lines: [targetLine],
      },
    });
  }

  if (comments.length === 0) {
    return null;
  }

  return {
    kind: "review",
    reviewDraftKey: input.reviewDraftKey,
    commentCount: comments.length,
    attachment: {
      type: "review",
      mimeType: "application/otto-review",
      cwd: input.cwd,
      mode: "uncommitted",
      baseRef: null,
      comments,
    },
  };
}
