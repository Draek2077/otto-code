import { useEffect, useMemo } from "react";
import { useWorkspaceAttachmentsStore } from "@/attachments/workspace-attachments-store";
import { useCheckoutStatusQuery } from "@/git/use-status-query";
import {
  buildSearchNoteDraftKey,
  useInlineReviewController,
  useSearchNoteAttachmentSnapshot,
  type InlineReviewActions,
} from "@/review";
import { buildReviewableDiffTargetKey } from "@/utils/diff-layout";
import type { SearchDisplayLine } from "@/components/project-search-code-lines";

/** Stable empty result, so a note-free search never changes this identity. */
const NO_LINE_TEXT: ReadonlyMap<string, string> = new Map();

export interface SearchNoteLineSource {
  filePath: string;
  lines: readonly SearchDisplayLine[];
}

/**
 * Inline notes on search hits.
 *
 * The same review surface Changes uses - gutter button, editor, composer pill -
 * pointed at a bucket of its own, because a hit is usually a line nobody
 * changed and the diff snapshot would drop such a note on the way to the
 * composer (see `buildSearchNoteDraftKey`).
 */
export function useProjectSearchNotes(input: {
  serverId: string;
  workspaceId?: string | null;
  workspaceRoot: string;
  attachmentScopeKey: string;
  /** The hits currently on screen, which is what a note can quote. */
  sources: readonly SearchNoteLineSource[];
}): InlineReviewActions {
  const { attachmentScopeKey, serverId, sources, workspaceId, workspaceRoot } = input;
  const { status } = useCheckoutStatusQuery({ serverId, cwd: workspaceRoot });
  const branch =
    status?.isGit && status.currentBranch && status.currentBranch !== "HEAD"
      ? status.currentBranch
      : null;
  const noteDraftKey = useMemo(
    () => buildSearchNoteDraftKey({ serverId, workspaceId, cwd: workspaceRoot, branch }),
    [branch, serverId, workspaceId, workspaceRoot],
  );
  const reviewActions = useInlineReviewController({ reviewDraftKey: noteDraftKey });

  // A note quotes the line it was written on, so the snapshot needs that line's
  // text. Only the lines carrying a note are looked up: a wide search holds
  // thousands of hits and this runs again on every streamed batch, so building
  // a target key for all of them would cost the whole result set per flush.
  // A note whose line has left the results is dropped from the attachment, not
  // from the store.
  const { commentsByTarget } = reviewActions;
  const lineTextByTarget = useMemo(() => {
    if (commentsByTarget.size === 0) {
      return NO_LINE_TEXT;
    }
    const byTarget = new Map<string, string>();
    for (const source of sources) {
      for (const line of source.lines) {
        const key = buildReviewableDiffTargetKey({
          filePath: source.filePath,
          side: "new",
          lineNumber: line.line,
        });
        if (commentsByTarget.has(key)) {
          byTarget.set(key, line.text);
        }
      }
    }
    return byTarget;
  }, [commentsByTarget, sources]);

  const noteAttachment = useSearchNoteAttachmentSnapshot({
    key: noteDraftKey,
    cwd: workspaceRoot,
    lineTextByTarget,
  });

  // Only this pane's own note pill is replaced. Everything else in the scope -
  // file-context pills, the Changes review pill - is left alone.
  useEffect(() => {
    const syncNoteAttachment = (attachment: typeof noteAttachment) => {
      const store = useWorkspaceAttachmentsStore.getState();
      const current = store.attachmentsByScope[attachmentScopeKey] ?? [];
      const others = current.filter(
        (existing) => existing.kind !== "review" || existing.reviewDraftKey !== noteDraftKey,
      );
      store.setWorkspaceAttachments({
        scopeKey: attachmentScopeKey,
        attachments: attachment ? [...others, attachment] : others,
      });
    };
    syncNoteAttachment(noteAttachment);
    return () => syncNoteAttachment(null);
  }, [attachmentScopeKey, noteAttachment, noteDraftKey]);

  return reviewActions;
}
