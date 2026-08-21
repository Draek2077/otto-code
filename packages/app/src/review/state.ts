import { z } from "zod";

export type ReviewDraftMode = "uncommitted" | "base";
export type ReviewDraftSide = "old" | "new";

export interface ReviewDraftComment {
  id: string;
  filePath: string;
  side: ReviewDraftSide;
  lineNumber: number;
  body: string;
  createdAt: string;
  updatedAt: string;
}

// A manual mode selection belongs to the checkout, not its momentary dirty
// state. A commit can make an Uncommitted view empty, but it must not also move
// the reader to Committed behind their back.
export interface DiffModeOverride {
  serverId: string;
  cwd: string;
  mode: ReviewDraftMode;
  isDirtyAtSelection: boolean;
}

export interface ReviewDraftStoreState {
  drafts: Record<string, ReviewDraftComment[]>;
  // In-memory only - not persisted. Keyed by scope key.
  diffModeOverrides: Record<string, DiffModeOverride>;
}

// Only drafts are persisted; diffModeOverrides is intentionally excluded.
export interface SerializedReviewDraftState {
  drafts: Record<string, ReviewDraftComment[]>;
  activeModesByScope?: Record<string, ReviewDraftMode>;
}

const IsoDateTimeSchema = z.string().datetime({ offset: true });
export const ReviewDraftCommentSchema: z.ZodType<ReviewDraftComment> = z.strictObject({
  id: z.string(),
  filePath: z.string(),
  side: z.enum(["old", "new"]),
  lineNumber: z.number().int().positive(),
  body: z.string(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export const SerializedReviewDraftStateSchema: z.ZodType<SerializedReviewDraftState> =
  z.strictObject({
    drafts: z.record(z.string(), z.array(ReviewDraftCommentSchema)),
    // COMPAT(reviewDraftModes): v1 persisted this field; v2 discards it during migration.
    activeModesByScope: z.record(z.string(), z.enum(["uncommitted", "base"])).optional(),
  });

export function setDiffModeOverrideInState(
  state: ReviewDraftStoreState,
  input: { scopeKey: string; override: DiffModeOverride },
): ReviewDraftStoreState {
  return {
    ...state,
    diffModeOverrides: {
      ...state.diffModeOverrides,
      [input.scopeKey]: input.override,
    },
  };
}

// Kept as a data-boundary no-op while old callers continue to report status
// transitions. Manual selection now persists across dirty/clean transitions.
export function expireStaleDiffModeOverridesInState(
  state: ReviewDraftStoreState,
  input: { serverId: string; cwd: string; isDirty: boolean },
): ReviewDraftStoreState {
  void input;
  return state;
}

// Pure read - returns the effective mode without mutating state. A user-selected
// mode deliberately wins even when a commit or a new edit flips the dirty bit.
export function resolveDiffMode(input: {
  override: DiffModeOverride | undefined;
  hasUncommittedChanges: boolean;
}): ReviewDraftMode {
  const { override, hasUncommittedChanges } = input;
  if (override) {
    return override.mode;
  }
  return hasUncommittedChanges ? "uncommitted" : "base";
}

export function addCommentToState(
  state: ReviewDraftStoreState,
  input: { key: string; comment: ReviewDraftComment },
): ReviewDraftStoreState {
  return {
    ...state,
    drafts: {
      ...state.drafts,
      [input.key]: [...(state.drafts[input.key] ?? []), input.comment],
    },
  };
}

export function updateCommentInState(
  state: ReviewDraftStoreState,
  input: {
    key: string;
    id: string;
    updates: Partial<Pick<ReviewDraftComment, "body">>;
    updatedAt: string;
  },
): ReviewDraftStoreState {
  const comments = state.drafts[input.key] ?? [];
  if (!comments.some((comment) => comment.id === input.id)) {
    return state;
  }
  return {
    ...state,
    drafts: {
      ...state.drafts,
      [input.key]: comments.map((comment) =>
        applyCommentUpdates(comment, input.id, input.updates, input.updatedAt),
      ),
    },
  };
}

export function deleteCommentFromState(
  state: ReviewDraftStoreState,
  input: { key: string; id: string },
): ReviewDraftStoreState {
  const comments = state.drafts[input.key] ?? [];
  if (!comments.some((comment) => comment.id === input.id)) {
    return state;
  }
  return {
    ...state,
    drafts: {
      ...state.drafts,
      [input.key]: comments.filter((comment) => comment.id !== input.id),
    },
  };
}

export interface ReviewDraftScopeSummary {
  commentCount: number;
  fileCount: number;
}

/**
 * Counts every draft comment stored under a key prefix, and the distinct files
 * they sit on. The pair is what a bulk-clear confirmation has to state: how many
 * comments, and across how many files. Callers pass a prefix that ends on a key
 * separator so `branch=main:` cannot also match `branch=main-2:`.
 */
export function summarizeReviewDraftsForPrefix(
  drafts: Record<string, ReviewDraftComment[]>,
  keyPrefix: string,
): ReviewDraftScopeSummary {
  const filePaths = new Set<string>();
  let commentCount = 0;
  for (const [key, comments] of Object.entries(drafts)) {
    if (!key.startsWith(keyPrefix)) {
      continue;
    }
    for (const comment of comments) {
      commentCount += 1;
      filePaths.add(comment.filePath);
    }
  }
  return { commentCount, fileCount: filePaths.size };
}

/**
 * Drops every draft bucket under a key prefix. A single draft key pins one diff
 * mode and one whitespace setting, so clearing only the visible key would strand
 * comments in the buckets the reader is not currently looking at - which is the
 * whole reason a bulk clear exists.
 */
export function clearReviewScopeInState(
  state: ReviewDraftStoreState,
  input: { keyPrefix: string },
): ReviewDraftStoreState {
  const matchedKeys = Object.keys(state.drafts).filter((key) => key.startsWith(input.keyPrefix));
  if (matchedKeys.length === 0) {
    return state;
  }
  const nextDrafts = { ...state.drafts };
  for (const key of matchedKeys) {
    delete nextDrafts[key];
  }
  return { ...state, drafts: nextDrafts };
}

export function clearReviewInState(
  state: ReviewDraftStoreState,
  input: { key: string },
): ReviewDraftStoreState {
  if (!state.drafts[input.key]) {
    return state;
  }
  const nextDrafts = { ...state.drafts };
  delete nextDrafts[input.key];
  return { ...state, drafts: nextDrafts };
}

export function serializeReviewDraftState(
  state: ReviewDraftStoreState,
): SerializedReviewDraftState {
  return {
    drafts: state.drafts,
  };
}

export function normalizePersistedState(state: unknown): ReviewDraftStoreState {
  const result = SerializedReviewDraftStateSchema.safeParse(state);
  return {
    drafts: result.success ? result.data.drafts : {},
    diffModeOverrides: {},
  };
}

function applyCommentUpdates(
  comment: ReviewDraftComment,
  targetId: string,
  updates: Partial<Pick<ReviewDraftComment, "body">>,
  updatedAt: string,
): ReviewDraftComment {
  if (comment.id !== targetId) {
    return comment;
  }
  return {
    id: comment.id,
    filePath: comment.filePath,
    side: comment.side,
    lineNumber: comment.lineNumber,
    body: updates.body ?? comment.body,
    createdAt: comment.createdAt,
    updatedAt,
  };
}
