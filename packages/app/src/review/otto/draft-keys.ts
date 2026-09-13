import type { ReviewDraftMode, ReviewDraftStoreState } from "../state";

interface BuildReviewDraftScopeKeyInput {
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
