import { z } from "zod";

// ── Git hosting providers ────────────────────────────────────────────────
// A project's git hosting provider (GitHub, Bitbucket Cloud, ...) is chosen
// per project in otto.json; all PR/issue functionality follows that choice.
// Shared by messages.ts (wire schemas) and otto-config-schema.ts (project
// config) - lives here to avoid a module cycle between those two.
export const GitHostingProviderIdSchema = z.enum(["github", "bitbucket-cloud"]);

// Wire form of the provider id. Deliberately an OPEN string, not the enum, so a
// newer peer that adds a third provider (e.g. "gitlab") never makes an older
// peer's validator drop the whole message. Consumers normalize to the known set
// with normalizeGitHostingProviderId (mirrors normalizeProfileRoles) and
// degrade gracefully for unknown ids. Keep the enum for otto.json config and the
// GIT_HOSTING_PROVIDER_IDS known-set.
export const GitHostingProviderIdWireSchema = z.string();

// What a provider can do. The client renders only capability-true actions -
// no emulation of missing features (feature contract).
export const GitHostingCapabilitiesSchema = z.object({
  autoMerge: z.boolean().optional().default(false),
  mergeQueue: z.boolean().optional().default(false),
  checkAnnotations: z.boolean().optional().default(false),
  checkDetails: z.boolean().optional().default(false),
  draftPrs: z.boolean().optional().default(false),
  reviewDecisions: z.boolean().optional().default(false),
  // Pull-request discussion capabilities. A provider advertises only what its
  // own API supports; clients must not emulate a missing forge operation.
  reviewThreads: z.boolean().optional().default(false),
  commentReactions: z.boolean().optional().default(false),
  issues: z.boolean().optional().default(false),
  // COMPAT(projectScaffold): added in v0.6.9. Repository-level operations used
  // by the New project page - enumerate the repos/owners you can reach, and
  // create a brand-new remote repository. Absent on older daemons, which is
  // read as "can't", so the page hides those choices rather than emulating them.
  listRepositories: z.boolean().optional().default(false),
  createRepository: z.boolean().optional().default(false),
});

export type GitHostingProviderId = z.infer<typeof GitHostingProviderIdSchema>;
export type GitHostingCapabilities = z.infer<typeof GitHostingCapabilitiesSchema>;

export const PullRequestCommentReactionContentSchema = z.enum([
  "THUMBS_UP",
  "THUMBS_DOWN",
  "LAUGH",
  "HOORAY",
  "CONFUSED",
  "HEART",
  "ROCKET",
  "EYES",
]);

// Provider-neutral mutations for a change-request discussion. `threadId` and
// `commentId` are opaque provider identifiers returned by the timeline; the
// selected adapter owns their interpretation.
export const HostingPullRequestThreadSetResolvedRequestSchema = z.object({
  type: z.literal("hosting.pull_request_thread.set_resolved.request"),
  cwd: z.string(),
  prNumber: z.number().int().positive(),
  threadId: z.string().min(1),
  resolved: z.boolean(),
  requestId: z.string(),
});

export const HostingPullRequestThreadSetResolvedResponseSchema = z.object({
  type: z.literal("hosting.pull_request_thread.set_resolved.response"),
  payload: z.object({
    success: z.boolean(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const HostingPullRequestCommentSetReactionRequestSchema = z.object({
  type: z.literal("hosting.pull_request_comment.set_reaction.request"),
  cwd: z.string(),
  prNumber: z.number().int().positive(),
  commentId: z.string().min(1),
  content: PullRequestCommentReactionContentSchema,
  reacted: z.boolean(),
  requestId: z.string(),
});

export const HostingPullRequestCommentSetReactionResponseSchema = z.object({
  type: z.literal("hosting.pull_request_comment.set_reaction.response"),
  payload: z.object({
    success: z.boolean(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const GIT_HOSTING_PROVIDER_IDS = GitHostingProviderIdSchema.options;

export function isGitHostingProviderId(value: unknown): value is GitHostingProviderId {
  return GitHostingProviderIdSchema.safeParse(value).success;
}

// Narrow an open wire provider id to the known set, or null when it's a provider
// this build doesn't recognize (a message from a newer peer). Callers render a
// neutral fallback for null rather than dropping the message.
export function normalizeGitHostingProviderId(
  value: string | null | undefined,
): GitHostingProviderId | null {
  return isGitHostingProviderId(value) ? value : null;
}

// COMPAT(hostingAttachments): added in v0.7.6, remove after 2027-02-01.
// These were the provider-neutral successors to github_pr/github_issue. The
// forge merge replaced them with forge_change_request/forge_issue, so no
// current client sends them - they stay accepted (protocol contract) purely so
// a client from before that merge can still attach a PR or an issue. The
// daemon renders them at
// server/src/server/agent/prompt-attachments.ts; retire both halves together.
export const HostingPrAttachmentSchema = z.object({
  type: z.literal("hosting_pr"),
  mimeType: z.literal("application/otto-hosting-pr"),
  provider: GitHostingProviderIdWireSchema,
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
  body: z.string().nullable().optional(),
  baseRefName: z.string().nullable().optional(),
  headRefName: z.string().nullable().optional(),
});

export const HostingIssueAttachmentSchema = z.object({
  type: z.literal("hosting_issue"),
  mimeType: z.literal("application/otto-hosting-issue"),
  provider: GitHostingProviderIdWireSchema,
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
  body: z.string().nullable().optional(),
});

// Provider-neutral successor to github_search_request. Resolves the project's
// configured hosting provider from cwd. Gated by server_info
// features.gitHostingProviders.
export const HostingSearchKindSchema = z.enum(["issue", "pr"]);

export const HostingSearchRequestSchema = z.object({
  type: z.literal("hosting.search.request"),
  cwd: z.string(),
  query: z.string(),
  limit: z.number().int().min(1).max(50).optional(),
  kinds: z.array(HostingSearchKindSchema).optional(),
  requestId: z.string(),
});

// Reports whether a host-level provider's credentials are valid - drives the
// connection-status row in the host Git providers settings section.
export const HostingAuthStatusRequestSchema = z.object({
  type: z.literal("hosting.auth_status.request"),
  provider: GitHostingProviderIdWireSchema,
  requestId: z.string(),
});

// Repository enumeration for the clone picker, and owner enumeration for the
// "create a new remote" form. Both are host-level (no repo cwd exists yet), so
// they address a provider directly instead of resolving one from a checkout.
export const HostingListRepositoriesRequestSchema = z.object({
  type: z.literal("hosting.list_repositories.request"),
  provider: GitHostingProviderIdWireSchema,
  // Substring filter applied by the provider where it supports one.
  query: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  requestId: z.string(),
});

export const HostingListOwnersRequestSchema = z.object({
  type: z.literal("hosting.list_owners.request"),
  provider: GitHostingProviderIdWireSchema,
  requestId: z.string(),
});

export const HostingRepositorySummarySchema = z.object({
  // Provider-unique identifier, e.g. "owner/name" or "workspace/slug".
  fullName: z.string(),
  name: z.string(),
  owner: z.string(),
  cloneUrl: z.string(),
  isPrivate: z.boolean(),
  description: z.string().nullable(),
  // ISO-8601. Clients sort most-recent-first when present.
  updatedAt: z.string().nullable(),
});

export const HostingOwnerSummarySchema = z.object({
  // Value to send back as `owner` when creating a repository.
  id: z.string(),
  label: z.string(),
  // Open string: providers name this differently (org, workspace, team).
  kind: z.string(),
});

// COMPAT(projectScaffold): added in v0.6.9.
export const HostingListRepositoriesResponseSchema = z.object({
  type: z.literal("hosting.list_repositories.response"),
  payload: z.object({
    requestId: z.string(),
    provider: GitHostingProviderIdWireSchema,
    repositories: z.array(HostingRepositorySummarySchema),
    error: z.string().nullable(),
  }),
});

// COMPAT(projectScaffold): added in v0.6.9.
export const HostingListOwnersResponseSchema = z.object({
  type: z.literal("hosting.list_owners.response"),
  payload: z.object({
    requestId: z.string(),
    provider: GitHostingProviderIdWireSchema,
    owners: z.array(HostingOwnerSummarySchema),
    error: z.string().nullable(),
  }),
});

export const HostingAuthStatusResponseSchema = z.object({
  type: z.literal("hosting.auth_status.response"),
  payload: z.object({
    provider: GitHostingProviderIdWireSchema,
    authenticated: z.boolean(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export type HostingRepositorySummary = z.infer<typeof HostingRepositorySummarySchema>;

export type HostingOwnerSummary = z.infer<typeof HostingOwnerSummarySchema>;

export type HostingListRepositoriesResponse = z.infer<typeof HostingListRepositoriesResponseSchema>;

export type HostingListOwnersResponse = z.infer<typeof HostingListOwnersResponseSchema>;

export type HostingSearchKind = z.infer<typeof HostingSearchKindSchema>;

export type HostingSearchRequest = z.infer<typeof HostingSearchRequestSchema>;

export type HostingAuthStatusRequest = z.infer<typeof HostingAuthStatusRequestSchema>;

export type HostingAuthStatusResponse = z.infer<typeof HostingAuthStatusResponseSchema>;

export type HostingPrAttachment = z.infer<typeof HostingPrAttachmentSchema>;

export type HostingIssueAttachment = z.infer<typeof HostingIssueAttachmentSchema>;

export type HostingListRepositoriesRequest = z.infer<typeof HostingListRepositoriesRequestSchema>;

export type HostingListOwnersRequest = z.infer<typeof HostingListOwnersRequestSchema>;

export type HostingPullRequestThreadSetResolvedRequest = z.infer<
  typeof HostingPullRequestThreadSetResolvedRequestSchema
>;

export type HostingPullRequestCommentSetReactionRequest = z.infer<
  typeof HostingPullRequestCommentSetReactionRequestSchema
>;
