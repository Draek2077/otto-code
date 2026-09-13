import { prunePreBranchDraftKeys } from "./otto/draft-keys";
import { buildSearchNoteAttachmentSnapshot } from "./otto/search-note-attachment";
export {
  buildReviewDraftKey,
  buildReviewDraftBranchKeyPrefix,
  buildSearchNoteDraftKey,
  prunePreBranchDraftKeys,
  type BuildReviewDraftKeyInput,
  type BuildReviewDraftBranchKeyPrefixInput,
  type BuildSearchNoteDraftKeyInput,
} from "./otto/draft-keys";
export {
  buildSearchNoteAttachmentSnapshot,
  type BuildSearchNoteAttachmentSnapshotInput,
} from "./otto/search-note-attachment";
import { useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ComposerAttachment } from "@/attachments/types";
import type { ParsedDiffFile } from "@/git/use-diff-query";
import {
  addCommentToState,
  clearReviewInState,
  clearReviewScopeInState,
  deleteCommentFromState,
  normalizePersistedState,
  type ReviewDraftComment,
  type ReviewDraftScopeSummary,
  type ReviewDraftMode,
  type ReviewDraftSide,
  type ReviewDraftStoreState,
  serializeReviewDraftState,
  SerializedReviewDraftStateSchema,
  summarizeReviewDraftsForPrefix,
  updateCommentInState,
} from "@/review/state";
import { generateMessageId } from "@/types/stream";
import { buildNumberedDiffHunks, type NumberedDiffLine } from "@/utils/diff-layout";
import type { AgentAttachment } from "@otto-code/protocol/messages";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

export type {
  ReviewDraftComment,
  ReviewDraftMode,
  ReviewDraftScopeSummary,
  ReviewDraftSide,
} from "@/review/state";

// v2 dropped the legacy persisted activeModesByScope field.
// v3 added branch scoping to draft keys; pre-branch drafts are pruned on migrate
// because their branch can't be recovered (see prunePreBranchDraftKeys).
const STORE_VERSION = 3;
const CONTEXT_RADIUS = 3;
const EMPTY_REVIEW_DRAFT_COMMENTS: ReviewDraftComment[] = [];

type ReviewAttachment = Extract<AgentAttachment, { type: "review" }>;
type ReviewAttachmentContextLine = ReviewAttachment["comments"][number]["context"]["targetLine"];
type ReviewComposerAttachment = Extract<ComposerAttachment, { kind: "review" }>;

export interface BuildReviewAttachmentSnapshotInput {
  reviewDraftKey: string;
  cwd: string;
  mode: ReviewDraftMode;
  baseRef?: string | null;
  comments: readonly ReviewDraftComment[];
  diffFiles: readonly ParsedDiffFile[];
}

export type ReviewDraftCommentInput = Omit<ReviewDraftComment, "id" | "createdAt" | "updatedAt"> &
  Partial<Pick<ReviewDraftComment, "id" | "createdAt" | "updatedAt">>;

interface ReviewDraftStoreActions {
  addComment: (input: { key: string; comment: ReviewDraftCommentInput }) => ReviewDraftComment;
  updateComment: (input: {
    key: string;
    id: string;
    updates: Partial<Pick<ReviewDraftComment, "body">>;
    updatedAt?: string;
  }) => void;
  deleteComment: (input: { key: string; id: string }) => void;
  clearReview: (input: { key: string }) => void;
  clearReviewScope: (input: { keyPrefix: string }) => void;
}

type ReviewDraftStore = ReviewDraftStoreState & ReviewDraftStoreActions;

function createDraftComment(input: ReviewDraftCommentInput): ReviewDraftComment {
  const now = new Date().toISOString();
  return {
    id: input.id ?? generateMessageId(),
    filePath: input.filePath,
    side: input.side,
    lineNumber: input.lineNumber,
    body: input.body,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? input.createdAt ?? now,
  };
}

export const useReviewDraftStore = create<ReviewDraftStore>()(
  persist(
    (set) => ({
      drafts: {},
      addComment: ({ key, comment }) => {
        const nextComment = createDraftComment(comment);
        set((state) => addCommentToState(state, { key, comment: nextComment }));
        return nextComment;
      },
      updateComment: ({ key, id, updates, updatedAt }) => {
        set((state) =>
          updateCommentInState(state, {
            key,
            id,
            updates,
            updatedAt: updatedAt ?? new Date().toISOString(),
          }),
        );
      },
      deleteComment: (input) => {
        set((state) => deleteCommentFromState(state, input));
      },
      clearReview: (input) => {
        set((state) => clearReviewInState(state, input));
      },
      clearReviewScope: (input) => {
        set((state) => clearReviewScopeInState(state, input));
      },
    }),
    {
      name: "@otto:review-draft-store",
      version: STORE_VERSION,
      storage: createValidatedPersistStorage(AsyncStorage, SerializedReviewDraftStateSchema),
      partialize: (state) => serializeReviewDraftState(state),
      migrate: async (state) => prunePreBranchDraftKeys(normalizePersistedState(state)),
    },
  ),
);

function toContextLine(line: NumberedDiffLine): ReviewAttachmentContextLine | null {
  if (line.line.type === "header") {
    return null;
  }
  return {
    oldLineNumber: line.oldLineNumber,
    newLineNumber: line.newLineNumber,
    type: line.line.type,
    content: line.line.content,
  };
}

function findTarget(input: { comment: ReviewDraftComment; diffFiles: readonly ParsedDiffFile[] }): {
  hunkHeader: string;
  hunkLines: NumberedDiffLine[];
  targetIndex: number;
  targetLine: NumberedDiffLine;
} | null {
  const file = input.diffFiles.find((candidate) => candidate.path === input.comment.filePath);
  if (!file) {
    return null;
  }

  for (const hunk of buildNumberedDiffHunks(file)) {
    const targetIndex = hunk.lines.findIndex((line) => {
      const cell = input.comment.side === "old" ? line.oldCell : line.newCell;
      return cell?.lineNumber === input.comment.lineNumber;
    });
    const targetLine = hunk.lines[targetIndex];
    if (targetLine) {
      return {
        hunkHeader: hunk.hunkHeader,
        hunkLines: hunk.lines,
        targetIndex,
        targetLine,
      };
    }
  }

  return null;
}

export function buildReviewAttachmentSnapshot(
  input: BuildReviewAttachmentSnapshotInput,
): ReviewComposerAttachment | null {
  const comments: ReviewAttachment["comments"] = [];

  for (const draftComment of input.comments) {
    const target = findTarget({
      comment: draftComment,
      diffFiles: input.diffFiles,
    });
    if (!target) {
      continue;
    }

    const targetLine = toContextLine(target.targetLine);
    if (!targetLine) {
      continue;
    }

    const contextStart = Math.max(0, target.targetIndex - CONTEXT_RADIUS);
    const contextEnd = Math.min(target.hunkLines.length, target.targetIndex + CONTEXT_RADIUS + 1);
    const lines = target.hunkLines
      .slice(contextStart, contextEnd)
      .map(toContextLine)
      .filter((line): line is ReviewAttachmentContextLine => line !== null);

    comments.push({
      filePath: draftComment.filePath,
      side: draftComment.side,
      lineNumber: draftComment.lineNumber,
      body: draftComment.body,
      context: {
        hunkHeader: target.hunkHeader,
        targetLine,
        lines,
      },
    });
  }

  if (comments.length === 0) {
    return null;
  }

  const attachment: ReviewAttachment = {
    type: "review",
    mimeType: "application/otto-review",
    cwd: input.cwd,
    mode: input.mode,
    baseRef: input.baseRef?.trim() || null,
    comments,
  };

  return {
    kind: "review",
    reviewDraftKey: input.reviewDraftKey,
    commentCount: comments.length,
    attachment,
  };
}

export function useReviewDraftComments(key: string): ReviewDraftComment[] {
  return useReviewDraftStore((state) => state.drafts[key] ?? EMPTY_REVIEW_DRAFT_COMMENTS);
}

export function useSearchNoteAttachmentSnapshot(input: {
  key: string;
  cwd: string;
  lineTextByTarget: ReadonlyMap<string, string>;
}): ReviewComposerAttachment | null {
  const comments = useReviewDraftComments(input.key);
  return useMemo(
    () =>
      buildSearchNoteAttachmentSnapshot({
        reviewDraftKey: input.key,
        cwd: input.cwd,
        comments,
        lineTextByTarget: input.lineTextByTarget,
      }),
    [comments, input.cwd, input.key, input.lineTextByTarget],
  );
}

export function useClearReviewDraft(): ReviewDraftStoreActions["clearReview"] {
  return useReviewDraftStore((state) => state.clearReview);
}

export function useClearReviewScope(): ReviewDraftStoreActions["clearReviewScope"] {
  return useReviewDraftStore((state) => state.clearReviewScope);
}

export function addReviewDraftComment(input: {
  key: string;
  comment: ReviewDraftCommentInput;
}): ReviewDraftComment {
  return useReviewDraftStore.getState().addComment(input);
}

export function getReviewDraftComments(key: string): ReviewDraftComment[] | undefined {
  return useReviewDraftStore.getState().drafts[key];
}

export function resetReviewDraftStore(): void {
  useReviewDraftStore.setState({ drafts: {} });
}

export function useReviewDraftCommentsForAttachment(input: {
  key: string;
  enabled: boolean;
}): ReviewDraftComment[] {
  return useReviewDraftStore((state) =>
    input.enabled
      ? (state.drafts[input.key] ?? EMPTY_REVIEW_DRAFT_COMMENTS)
      : EMPTY_REVIEW_DRAFT_COMMENTS,
  );
}

export function useReviewCommentCount(key: string): number {
  return useReviewDraftStore((state) => state.drafts[key]?.length ?? 0);
}

/**
 * How many comments live under a key prefix, and how many files they touch.
 * Selects the stable `drafts` record and derives in a memo, so the returned
 * object identity only changes when the drafts themselves do.
 */
export function useReviewDraftScopeSummary(keyPrefix: string): ReviewDraftScopeSummary {
  const drafts = useReviewDraftStore((state) => state.drafts);
  return useMemo(() => summarizeReviewDraftsForPrefix(drafts, keyPrefix), [drafts, keyPrefix]);
}

export function useReviewAttachmentSnapshot(input: {
  key: string;
  diffFiles: readonly ParsedDiffFile[];
  cwd: string;
  mode: ReviewDraftMode;
  baseRef?: string | null;
}): ReviewComposerAttachment | null {
  const comments = useReviewDraftComments(input.key);
  return useMemo(
    () =>
      buildReviewAttachmentSnapshot({
        reviewDraftKey: input.key,
        cwd: input.cwd,
        mode: input.mode,
        baseRef: input.baseRef,
        comments,
        diffFiles: input.diffFiles,
      }),
    [comments, input.key, input.cwd, input.mode, input.baseRef, input.diffFiles],
  );
}
