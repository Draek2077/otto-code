import { z } from "zod";

/**
 * Otto git-operation wire schemas: the checkout.git.* commit, rollback, operation-log, blame and file-history RPCs and pushes. Fork-only capability, so it owns its schemas; messages.ts re-exports them. The checkout.git.file_* and fetch RPCs stay in messages.ts because they embed Paseo's ParsedDiffFileSchema and CheckoutErrorSchema.
 */

// One entry in a git operation log (the "Git Commit"/"Git Push" log panes).
// `seq` is a per-(cwd, operation) monotonic counter used for client-side
// dedup between backfill and live pushes.
export const GitOperationLogEntrySchema = z.object({
  seq: z.number(),
  timestamp: z.string(),
  level: z.enum(["info", "output", "error"]),
  text: z.string(),
});

// Backfill for a git operation log pane. `operation` is an open string on the
// wire ("commit" | "pull" | "push" today) so newly watchable operations don't
// break old peers. Gated by server_info.features.checkoutGitLog.
export const CheckoutGitGetOperationLogRequestSchema = z.object({
  type: z.literal("checkout.git.get_operation_log.request"),
  cwd: z.string(),
  operation: z.string(),
  requestId: z.string(),
});

export const CheckoutGitGetOperationLogResponseSchema = z.object({
  type: z.literal("checkout.git.get_operation_log.response"),
  payload: z.object({
    cwd: z.string(),
    operation: z.string(),
    entries: z.array(GitOperationLogEntrySchema),
    requestId: z.string(),
  }),
});

// Live append notification, broadcast to connected clients while a watched git
// operation runs. Carries only the appended entries; `seq` orders them against
// the backfill.
export const CheckoutGitLogAppendedNotificationSchema = z.object({
  type: z.literal("checkout.git.log_appended.notification"),
  payload: z.object({
    cwd: z.string(),
    operation: z.string(),
    entries: z.array(GitOperationLogEntrySchema),
  }),
});

// Namespaced successor to checkout_commit_request: per-file selection and
// structured errors. Gated by server_info.features.checkoutGitCommit; the flat
// RPC stays accepted for old clients.
export const CheckoutGitCommitRequestSchema = z.object({
  type: z.literal("checkout.git.commit.request"),
  cwd: z.string(),
  message: z.string(),
  // Repo-relative paths to stage and commit. Only these paths land in the
  // commit, even if other changes are already staged.
  paths: z.array(z.string()),
  // Set after the user confirms committing while agents are running in this
  // workspace; without it the daemon refuses with kind "agents_running".
  allowWithRunningAgents: z.boolean().optional(),
  requestId: z.string(),
});

// Resolve which agent the daemon would use to author a commit message for this
// checkout (the "writer" role) so the client can name it in a confirmation
// before running the AI-authored commit. A pure query - it never commits. Gated
// by server_info.features.checkoutGitCommitAgent.
export const CheckoutGitCommitAgentRequestSchema = z.object({
  type: z.literal("checkout.git.commit_agent.request"),
  cwd: z.string(),
  requestId: z.string(),
});

// Discard uncommitted working-tree changes for specific repo-relative paths
// (restore tracked files from HEAD, delete newly-added files). Gated by
// server_info.features.checkoutGitRollback.
export const CheckoutGitRollbackRequestSchema = z.object({
  type: z.literal("checkout.git.rollback.request"),
  cwd: z.string(),
  // Repo-relative paths whose uncommitted changes should be discarded.
  paths: z.array(z.string()),
  // Set after the user confirms rolling back while agents are running in this
  // workspace; without it the daemon refuses with kind "agents_running", since
  // discarding a live agent's uncommitted edits mid-run can destroy its work.
  allowWithRunningAgents: z.boolean().optional(),
  requestId: z.string(),
});

export const CheckoutGitCommitRunningAgentSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
});

export const CheckoutGitCommitErrorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("agents_running"),
    agents: z.array(CheckoutGitCommitRunningAgentSchema),
  }),
  z.object({
    kind: z.literal("identity_missing"),
    missingName: z.boolean(),
    missingEmail: z.boolean(),
  }),
  z.object({
    kind: z.literal("hook_failed"),
    output: z.string(),
    exitCode: z.number().nullable(),
  }),
  z.object({
    kind: z.literal("signing_failed"),
    detail: z.string(),
  }),
  z.object({
    kind: z.literal("nothing_to_commit"),
  }),
  z.object({
    kind: z.literal("git_failed"),
    detail: z.string(),
  }),
]);

export const CheckoutGitCommitResponseSchema = z.object({
  type: z.literal("checkout.git.commit.response"),
  payload: z.object({
    cwd: z.string(),
    success: z.boolean(),
    commitSha: z.string().nullable(),
    error: CheckoutGitCommitErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

// The agent the daemon resolved to author a commit message. "personality" when
// an available role-matched Agent Personality wins the mini-task routing (its
// name plus the bound provider/model); "provider" when a bare provider/model is
// used instead; "none" when nothing is configured to run the task, in which case
// the client refuses the AI commit rather than falling back to placeholder text.
export const CommitMessageAgentSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("personality"),
    personalityId: z.string(),
    personalityName: z.string(),
    provider: z.string(),
    providerLabel: z.string(),
    model: z.string().nullable(),
    modelLabel: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("provider"),
    provider: z.string(),
    providerLabel: z.string(),
    model: z.string().nullable(),
    modelLabel: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("none"),
  }),
]);

export const CheckoutGitCommitAgentResponseSchema = z.object({
  type: z.literal("checkout.git.commit_agent.response"),
  payload: z.object({
    cwd: z.string(),
    agent: CommitMessageAgentSchema,
    requestId: z.string(),
  }),
});

export const CheckoutGitRollbackErrorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("nothing_to_rollback"),
  }),
  z.object({
    kind: z.literal("git_failed"),
    detail: z.string(),
  }),
  // Refused because agents are running in this workspace; discarding their
  // uncommitted edits mid-run risks destroying work. The client re-sends with
  // allowWithRunningAgents after confirming, mirroring the commit flow.
  z.object({
    kind: z.literal("agents_running"),
    agents: z.array(CheckoutGitCommitRunningAgentSchema),
  }),
]);

export const CheckoutGitRollbackResponseSchema = z.object({
  type: z.literal("checkout.git.rollback.response"),
  payload: z.object({
    cwd: z.string(),
    success: z.boolean(),
    // Repo-relative paths whose changes were discarded.
    rolledBackPaths: z.array(z.string()),
    error: CheckoutGitRollbackErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export const GitFileHistoryEntrySchema = z.object({
  sha: z.string(),
  shortSha: z.string(),
  subject: z.string(),
  body: z.string(),
  authorName: z.string(),
  authorEmail: z.string(),
  // Unix seconds.
  authoredAt: z.number(),
  committerName: z.string(),
  committedAt: z.number(),
  // The file's name at this commit - differs from the requested path across a
  // rename. Diff requests must echo this one back, not the current name.
  path: z.string(),
  previousPath: z.string().optional(),
  // Single-letter git status (A/M/D/R/C).
  changeKind: z.string().optional(),
  isMerge: z.boolean(),
  // Parent object names, so a diff view can name the revision it is comparing
  // against instead of writing "<sha>^". Empty for a root commit.
  parentShas: z.array(z.string()).optional(),
});

export const GitBlameLineSchema = z.object({
  line: z.number(),
  sha: z.string(),
  originalLine: z.number(),
});

// Blame commit metadata is deduped by sha rather than inlined per line: a
// thousand-line page usually references a handful of commits.
export const GitBlameCommitSchema = z.object({
  sha: z.string(),
  shortSha: z.string(),
  summary: z.string(),
  authorName: z.string(),
  authorEmail: z.string(),
  authoredAt: z.number(),
  path: z.string().optional(),
});

export type CheckoutGitCommitRequest = z.infer<typeof CheckoutGitCommitRequestSchema>;

export type CheckoutGitCommitResponse = z.infer<typeof CheckoutGitCommitResponseSchema>;

export type CheckoutGitCommitError = z.infer<typeof CheckoutGitCommitErrorSchema>;

export type CheckoutGitCommitAgentRequest = z.infer<typeof CheckoutGitCommitAgentRequestSchema>;

export type CheckoutGitCommitAgentResponse = z.infer<typeof CheckoutGitCommitAgentResponseSchema>;

export type CommitMessageAgent = z.infer<typeof CommitMessageAgentSchema>;

export type CheckoutGitRollbackRequest = z.infer<typeof CheckoutGitRollbackRequestSchema>;

export type CheckoutGitRollbackResponse = z.infer<typeof CheckoutGitRollbackResponseSchema>;

export type CheckoutGitRollbackError = z.infer<typeof CheckoutGitRollbackErrorSchema>;

export type GitFileHistoryEntry = z.infer<typeof GitFileHistoryEntrySchema>;

export type GitBlameLine = z.infer<typeof GitBlameLineSchema>;

export type GitBlameCommit = z.infer<typeof GitBlameCommitSchema>;

export type GitOperationLogEntry = z.infer<typeof GitOperationLogEntrySchema>;

export type CheckoutGitGetOperationLogRequest = z.infer<
  typeof CheckoutGitGetOperationLogRequestSchema
>;

export type CheckoutGitGetOperationLogResponse = z.infer<
  typeof CheckoutGitGetOperationLogResponseSchema
>;

export type CheckoutGitLogAppendedNotification = z.infer<
  typeof CheckoutGitLogAppendedNotificationSchema
>;
