import { z } from "zod";

/**
 * Otto worktree-operation wire schemas: base-ref selection and the branch-aware archive RPCs. Fork-only capability, so it owns its schemas; messages.ts re-exports them. The reattach and otto.worktree.* RPCs stay in messages.ts because they embed Paseo's WorkspaceDescriptorPayloadSchema and CheckoutErrorSchema.
 */

// Read-only pre-archive inspection for a worktree-backed workspace: what branch
// it is on, whether that branch is merged into its base, and whether archiving
// will actually free the branch (last reference, not checked out elsewhere). The
// client uses this to render the "delete the leftover branch?" confirmation.
// COMPAT(worktreeArchiveBranchCleanup): added in v0.6.7.
export const WorkspaceArchivePreflightRequestSchema = z.object({
  type: z.literal("workspace.archive.preflight.request"),
  requestId: z.string(),
  workspaceId: z.string(),
});

// Where the Changes view's base branch came from. Surfaced so the chip can say *why* it is
// comparing against this branch: an inferred parent is a heuristic over a graph that does not
// record the answer, and it has to look like one or a wrong guess reads as a bug in the diff.
// COMPAT(checkoutDiffBaseAnyRepo): added in v0.7.4.
export const CheckoutBaseSourceSchema = z.enum(["user", "inferred", "worktree", "default"]);

// Repoint a worktree-backed workspace's base branch - what the Changes view diffs
// against, and what merge-into-base and PR creation target. On a stacked branch the
// useful base is the parent branch, not the repo default, the same way a forge PR
// carries an explicit base. A null baseRef resets to the repository default branch.
// COMPAT(worktreeDiffBase): added in v0.6.8.
export const WorktreeBaseRefSetRequestSchema = z.object({
  type: z.literal("worktree.baseRef.set.request"),
  requestId: z.string(),
  workspaceId: z.string(),
  // Branch name; null resets to the default branch. An `origin/` prefix is meaningful and is
  // kept - `main` and `origin/main` are different comparisons whenever the two have drifted.
  baseRef: z.string().nullable(),
  // Forget the remembered base and detect the branch's parent again, ignoring `baseRef`.
  // The escape hatch for a wrong guess: parent detection is a heuristic over a graph that does
  // not record the answer, and the result is sticky, so it has to be re-runnable on demand.
  // COMPAT(checkoutDiffBaseAnyRepo): added in v0.7.4.
  redetect: z.boolean().optional(),
});

// Whether/how a worktree-backed workspace's local branch can be cleaned up when
// the workspace is archived. See WorkspaceArchivePreflightRequestSchema.
export const WorktreeArchiveBranchDetectionSchema = z.object({
  // True only for Otto-owned worktrees whose branch we can offer to delete.
  // False for local checkouts, plain directories, and non-owned worktrees - the
  // client then skips the branch-cleanup UI entirely.
  isOttoWorktree: z.boolean(),
  // The local branch checked out in the worktree, or null when detached/unknown.
  branchName: z.string().nullable(),
  // The base ref the branch was created from (origin/ stripped), or null.
  baseBranch: z.string().nullable(),
  mergeState: z.enum(["merged", "unmerged", "unknown"]),
  // Commits on the branch not contained in the base ref; null when unknown.
  unmergedCommitCount: z.number().int().nonnegative().nullable(),
  // A matching origin/<branch> exists - deleting the local branch keeps the
  // remote copy. Purely informational for the confirmation copy.
  hasRemoteBranch: z.boolean(),
  // The branch is checked out in another worktree too, so git will refuse to
  // delete it even after this worktree is removed. The client hides the option.
  branchCheckedOutElsewhere: z.boolean(),
  // Archiving will actually remove the backing directory (this is the last
  // active workspace referencing it). Branch cleanup is only offered when true.
  directoryWillBeRemoved: z.boolean(),
});

export const WorkspaceArchivePreflightResponseSchema = z.object({
  type: z.literal("workspace.archive.preflight.response"),
  payload: z.object({
    requestId: z.string(),
    workspaceId: z.string(),
    // Null when detection failed (see error) or the workspace is gone.
    detection: WorktreeArchiveBranchDetectionSchema.nullable(),
    error: z.string().nullable(),
  }),
});

// COMPAT(worktreeDiffBase): added in v0.6.8.
export const WorktreeBaseRefSetResponseSchema = z.object({
  type: z.literal("worktree.baseRef.set.response"),
  payload: z.object({
    requestId: z.string(),
    workspaceId: z.string(),
    // The stored base branch after the write; null when the write failed.
    baseRef: z.string().nullable(),
    // The stored base is the repository default branch (no stacked-branch override).
    isDefault: z.boolean(),
    // Where the resulting base came from, so the client can label it without a refetch.
    // COMPAT(checkoutDiffBaseAnyRepo): added in v0.7.4.
    baseSource: CheckoutBaseSourceSchema.optional(),
    error: z.string().nullable(),
  }),
});

export type WorkspaceArchivePreflightRequest = z.infer<
  typeof WorkspaceArchivePreflightRequestSchema
>;

export type WorkspaceArchivePreflightResponse = z.infer<
  typeof WorkspaceArchivePreflightResponseSchema
>;

export type WorktreeArchiveBranchDetection = z.infer<typeof WorktreeArchiveBranchDetectionSchema>;

export type WorktreeBaseRefSetRequest = z.infer<typeof WorktreeBaseRefSetRequestSchema>;

export type WorktreeBaseRefSetResponse = z.infer<typeof WorktreeBaseRefSetResponseSchema>;

export type CheckoutBaseSource = z.infer<typeof CheckoutBaseSourceSchema>;
