import { z } from "zod";
import { ParsedDiffFileSchema } from "@getpaseo/protocol/otto/checkout-diff"; // OTTO(file-history)
import { defineRpc } from "../rpc.js";

export const GIT_FETCH_INTERVALS = [60, 180, 300, 600, 900, 1800, 3600] as const;
export const GitFetchPreferencesSchema = z.object({
  enabled: z.boolean(),
  intervalSeconds: z.union([
    z.literal(60),
    z.literal(180),
    z.literal(300),
    z.literal(600),
    z.literal(900),
    z.literal(1800),
    z.literal(3600),
  ]),
});
export type GitFetchPreferences = z.infer<typeof GitFetchPreferencesSchema>;
export const DEFAULT_GIT_FETCH_PREFERENCES: GitFetchPreferences = Object.freeze({
  enabled: true,
  intervalSeconds: 180,
});
export const GitFetchPatchSchema = GitFetchPreferencesSchema.partial().strict();
export const GitFetchSettingsSchema = z.object({
  revision: z.string().min(1).max(256),
  preferences: GitFetchPreferencesSchema,
});
export type GitFetchSettings = z.infer<typeof GitFetchSettingsSchema>;
const Host = z.object({ hostId: z.string().min(1).max(256) });
const Failure = z.object({
  ok: z.literal(false),
  error: z.object({
    kind: z.enum(["conflict", "unavailable", "failed"]),
    message: z.string().max(1000),
  }),
});
function result<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion("ok", [z.object({ ok: z.literal(true), value }), Failure]);
}
export const readGitFetchPolicy = defineRpc({
  name: "workspace.git.fetch.settings.read.request",
  input: Host,
  output: result(GitFetchSettingsSchema),
});
export const saveGitFetchPolicy = defineRpc({
  name: "workspace.git.fetch.settings.save.request",
  input: Host.extend({ expectedRevision: z.string().min(1).max(256), patch: GitFetchPatchSchema }),
  output: result(GitFetchSettingsSchema),
});
export const fetchWorkspaceGit = defineRpc({
  name: "workspace.git.fetch.request",
  input: Host.extend({ workspaceId: z.string().min(1).max(256) }),
  output: result(z.object({ remote: z.literal("origin") })),
});
// OTTO(workspace-lifecycle): owner-bound operations over the existing workspace host route.
export const WorkspaceRecoveryTarget = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("archived"), workspaceId: z.string().min(1).max(256) }),
  z.object({ kind: z.literal("worktree"), path: z.string().min(1).max(4096) }),
]);
const workspaceChoice = z.object({ workspaceId: z.string(), label: z.string() });
export const listWorkspaceMoveTargets = defineRpc({
  name: "workspace.chat.list_move_targets.request",
  input: Host.extend({ workspaceId: z.string().min(1).max(256) }),
  output: result(z.array(workspaceChoice.extend({ project: z.string() }))),
});
export const moveWorkspaceChat = defineRpc({
  name: "workspace.chat.move.request",
  input: Host.extend({
    agentId: z.string().min(1).max(256),
    fromWorkspaceId: z.string().min(1).max(256),
    workspaceId: z.string().min(1).max(256),
  }),
  output: result(z.object({ workspaceId: z.string() })),
});
export const listReopenWorktrees = defineRpc({
  name: "workspace.recovery.list_worktrees.request",
  input: Host.extend({ projectId: z.string().min(1).max(256) }),
  output: result(
    z.array(
      z.object({
        target: WorkspaceRecoveryTarget,
        label: z.string(),
        branch: z.string().nullable(),
      }),
    ),
  ),
});
export const reopenWorktree = defineRpc({
  name: "workspace.recovery.reopen_worktree.request",
  input: listReopenWorktrees.input.extend({ target: WorkspaceRecoveryTarget }),
  output: result(z.object({ workspaceId: z.string() })),
});
const FileHistoryScope = Host.extend({
  workspaceId: z.string().min(1).max(256),
  file: z.string().min(1).max(4096),
});
const CommitSha = z.string().regex(/^[0-9a-fA-F]{40,64}$/);
const FileHistoryCommit = z.object({
  sha: CommitSha,
  shortSha: z.string(),
  subject: z.string(),
  body: z.string(),
  authorName: z.string(),
  authoredAt: z.number(),
  path: z.string(),
  previousPath: z.string().optional(),
});
export type FileHistoryCommit = z.infer<typeof FileHistoryCommit>;
const HistoryRange = z.object({
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
});
export const listFileRevisions = defineRpc({
  name: "workspace.git.list_file_revisions.request",
  input: FileHistoryScope.extend({
    offset: z.number().int().min(0).max(50000),
    range: HistoryRange.optional(),
  }),
  output: result(z.object({ entries: z.array(FileHistoryCommit), hasMore: z.boolean() })),
});
export const readFileRevisionDiff = defineRpc({
  name: "workspace.git.read_file_revision_diff.request",
  input: FileHistoryScope.extend({
    sha: CommitSha,
    revisionPath: z.string().min(1).max(4096),
    includeStructuralSource: z.literal(true).optional(),
  }),
  output: result(z.object({ file: ParsedDiffFileSchema, previousSha: CommitSha.optional() })),
});
export const readFileOrigin = defineRpc({
  name: "workspace.git.read_file_origin.request",
  input: FileHistoryScope,
  output: result(FileHistoryCommit.nullable()),
});
export const readFileBlame = defineRpc({
  name: "workspace.git.read_file_blame.request",
  input: FileHistoryScope.extend({
    sha: CommitSha.optional(),
    revisionPath: z.string().min(1).max(4096).optional(),
    startLine: z.number().int().positive(),
  }),
  output: result(
    z.object({
      lines: z.array(z.object({ line: z.number(), sha: z.string(), originalLine: z.number() })),
      commits: z.array(
        z.object({
          sha: z.string(),
          shortSha: z.string(),
          authorName: z.string(),
          summary: z.string(),
          authoredAt: z.number(),
          path: z.string().optional(),
        }),
      ),
      reachedEndOfFile: z.boolean(),
    }),
  ),
});
export const setWorkspaceComparisonBase = defineRpc({
  name: "workspace.git.set_comparison_base.request",
  input: Host.extend({
    workspaceId: z.string().min(1).max(256),
    branchName: z.string().min(1).max(1024),
    baseRef: z.string().min(1).max(1024).nullable(),
  }),
  output: result(z.object({ branchName: z.string(), baseRef: z.string() })),
});
