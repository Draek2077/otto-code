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
  type DiffModeOverride,
  expireStaleDiffModeOverridesInState,
  normalizePersistedState,
  resolveDiffMode,
  type ReviewDraftComment,
  type ReviewDraftScopeSummary,
  type ReviewDraftMode,
  type ReviewDraftSide,
  type ReviewDraftStoreState,
  serializeReviewDraftState,
  SerializedReviewDraftStateSchema,
  setDiffModeOverrideInState,
  summarizeReviewDraftsForPrefix,
  updateCommentInState,
} from "@/review/state";
import { generateMessageId } from "@/types/stream";
import {
  buildNumberedDiffHunks,
  buildReviewableDiffTargetKey,
  type NumberedDiffLine,
} from "@/utils/diff-layout";
import type { AgentAttachment } from "@otto-code/protocol/messages";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

export type {
  DiffModeOverride,
  ReviewDraftComment,
  ReviewDraftMode,
  ReviewDraftScopeSummary,
  ReviewDraftSide,
} from "@/review/state";

// v2 dropped persisted activeModesByScope (diff mode overrides are in-memory only).
// v3 added branch scoping to draft keys; pre-branch drafts are pruned on migrate
// because their branch can't be recovered (see prunePreBranchDraftKeys).
const STORE_VERSION = 3;
const CONTEXT_RADIUS = 3;
const EMPTY_REVIEW_DRAFT_COMMENTS: ReviewDraftComment[] = [];

type ReviewAttachment = Extract<AgentAttachment, { type: "review" }>;
type ReviewAttachmentContextLine = ReviewAttachment["comments"][number]["context"]["targetLine"];
type ReviewComposerAttachment = Extract<ComposerAttachment, { kind: "review" }>;

export interface BuildReviewDraftScopeKeyInput {
  serverId: string;
  workspaceId?: string | null;
  cwd: string;
  baseRef?: string | null;
  ignoreWhitespace: boolean;
}

export interface BuildReviewDraftBranchKeyPrefixInput {
  serverId: string;
  workspaceId?: string | null;
  cwd: string;
  branch?: string | null;
}

export interface BuildReviewDraftKeyInput extends BuildReviewDraftScopeKeyInput {
  mode: ReviewDraftMode;
  /**
   * The checkout's current branch. Comments anchor to line numbers in a specific
   * diff, so drafts are scoped to the branch they were written on - switching
   * branches must not carry comments onto an unrelated diff (baseRef is the
   * repository default branch and does not change on branch switch). Null/absent
   * covers detached HEAD, where all detached states share one bucket.
   */
  branch?: string | null;
}

export interface BuildSearchNoteDraftKeyInput {
  serverId: string;
  workspaceId?: string | null;
  cwd: string;
  /** Search notes anchor to working-tree line numbers, so they follow the branch. */
  branch?: string | null;
}

export interface BuildSearchNoteAttachmentSnapshotInput {
  reviewDraftKey: string;
  cwd: string;
  comments: readonly ReviewDraftComment[];
  /** Line text for the notes that still have a visible hit, by target key. */
  lineTextByTarget: ReadonlyMap<string, string>;
}

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
  setDiffModeOverride: (input: { scopeKey: string; override: DiffModeOverride }) => void;
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

function encodeKeyPart(value: string): string {
  return encodeURIComponent(value.trim());
}

function normalizeCwd(cwd: string): string {
  const trimmed = cwd.trim();
  if (trimmed === "/") {
    return trimmed;
  }
  return trimmed.replace(/\/+$/, "");
}

function normalizeBaseRef(baseRef: string | null | undefined): string {
  return baseRef?.trim() ?? "";
}

function normalizeBranch(branch: string | null | undefined): string {
  return branch?.trim() ?? "";
}

// The leading parts every draft and scope key shares: which host, and which
// workspace (falling back to the checkout path for payloads without one).
function buildReviewDraftIdentityParts(input: {
  serverId: string;
  workspaceId?: string | null;
  cwd: string;
}): string[] {
  const workspaceId = input.workspaceId?.trim();
  // workspaceId is opaque; do not parse this key back into a path.
  const workspacePart = workspaceId
    ? `workspace=${encodeKeyPart(workspaceId)}`
    : `cwd=${encodeKeyPart(normalizeCwd(input.cwd))}`;

  return ["review", `server=${encodeKeyPart(input.serverId)}`, workspacePart];
}

function buildReviewDraftScopeParts(input: BuildReviewDraftScopeKeyInput): string[] {
  return [
    ...buildReviewDraftIdentityParts(input),
    `base=${encodeKeyPart(normalizeBaseRef(input.baseRef))}`,
    `ignoreWhitespace=${input.ignoreWhitespace ? "true" : "false"}`,
  ];
}

export function buildReviewDraftScopeKey(input: BuildReviewDraftScopeKeyInput): string {
  return buildReviewDraftScopeParts(input).join(":");
}

// Every draft key contains a branch part; migration prunes keys that predate it.
const DRAFT_KEY_BRANCH_MARKER = ":branch=";

export function buildReviewDraftKey(input: BuildReviewDraftKeyInput): string {
  const [prefix, serverPart, workspacePart, basePart, whitespacePart] =
    buildReviewDraftScopeParts(input);
  return [
    prefix,
    serverPart,
    workspacePart,
    `branch=${encodeKeyPart(normalizeBranch(input.branch))}`,
    `mode=${input.mode}`,
    basePart,
    whitespacePart,
  ].join(":");
}

/**
 * The prefix shared by every draft bucket for one workspace on one branch, across
 * both diff modes and both whitespace settings.
 *
 * Draft keys pin `mode` and `ignoreWhitespace`, so the comments a reader can see
 * are only ever one bucket of several. That is exactly how comments go missing:
 * commit the work, or toggle whitespace, and the bucket holding them stops being
 * the visible one. A bulk clear has to sweep the whole branch, so it needs this
 * prefix rather than the visible key.
 *
 * The trailing separator is load-bearing: without it `branch=main` would also
 * match `branch=main-2`, and clearing one branch would silently take another.
 */
export function buildReviewDraftBranchKeyPrefix(
  input: BuildReviewDraftBranchKeyPrefixInput,
): string {
  return [
    ...buildReviewDraftIdentityParts(input),
    `branch=${encodeKeyPart(normalizeBranch(input.branch))}`,
    "",
  ].join(":");
}

/**
 * The bucket for notes written on a search hit.
 *
 * Deliberately NOT a diff draft key. A diff bucket pins a mode, a base, and a
 * whitespace setting, and its attachment is built by resolving each comment
 * into a diff hunk - so a note on a line nobody changed would be written into a
 * bucket that silently drops it on the way to the composer. This bucket has its
 * own prefix and its own snapshot builder, and the two never share a pill.
 *
 * The `branch=` part is load-bearing twice over: line numbers mean something
 * different on another branch, and the v2 -> v3 migration prunes every draft key
 * that does not carry one.
 */
export function buildSearchNoteDraftKey(input: BuildSearchNoteDraftKeyInput): string {
  const [, serverPart, workspacePart] = buildReviewDraftIdentityParts(input);
  return [
    "search-note",
    serverPart,
    workspacePart,
    `branch=${encodeKeyPart(normalizeBranch(input.branch))}`,
  ].join(":");
}

/**
 * v2 -> v3 migration: drop draft buckets persisted before draft keys carried a
 * branch part. Their comments were written against some branch's diff, but which
 * branch is unrecoverable, so re-surfacing them anywhere would misanchor them.
 */
export function prunePreBranchDraftKeys(state: ReviewDraftStoreState): ReviewDraftStoreState {
  const staleKeys = Object.keys(state.drafts).filter(
    (key) => !key.includes(DRAFT_KEY_BRANCH_MARKER),
  );
  if (staleKeys.length === 0) {
    return state;
  }
  const drafts = { ...state.drafts };
  for (const key of staleKeys) {
    delete drafts[key];
  }
  return { ...state, drafts };
}

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
      diffModeOverrides: {},
      setDiffModeOverride: (input) => {
        set((state) => setDiffModeOverrideInState(state, input));
      },
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
    baseRef: normalizeBaseRef(input.baseRef) || null,
    comments,
  };

  return {
    kind: "review",
    reviewDraftKey: input.reviewDraftKey,
    commentCount: comments.length,
    attachment,
  };
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

export function useSetDiffModeOverride(): ReviewDraftStoreActions["setDiffModeOverride"] {
  return useReviewDraftStore((state) => state.setDiffModeOverride);
}

// Non-React entry point: called from the checkout-status data boundary, where dirty-state
// changes enter the app regardless of which screens are mounted.
export function expireStaleDiffModeOverrides(input: {
  serverId: string;
  cwd: string;
  isDirty: boolean;
}): void {
  useReviewDraftStore.setState((state) => expireStaleDiffModeOverridesInState(state, input));
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
  useReviewDraftStore.setState({ drafts: {}, diffModeOverrides: {} });
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

export function useResolvedDiffMode(input: {
  scopeKey: string;
  hasUncommittedChanges: boolean;
}): ReviewDraftMode {
  return useReviewDraftStore((state) =>
    resolveDiffMode({
      override: state.diffModeOverrides[input.scopeKey],
      hasUncommittedChanges: input.hasUncommittedChanges,
    }),
  );
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
