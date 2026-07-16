import { z } from "zod";
import { parseBitbucketCloudRemoteUrl } from "@otto-code/protocol/git-remote";
import type { GitHostingCapabilities } from "@otto-code/protocol/messages";
import type {
  GetGitHubCheckDetailsOptions,
  GetGitHubPullRequestOptions,
  GetGitHubPullRequestTimelineOptions,
  GitHubCheckDetails,
  HostingCurrentPullRequestStatus,
  GitHubIssueSummary,
  GitHubPullRequestCheckoutTarget,
  GitHubPullRequestCreateResult,
  HostingPullRequestSummary,
  GitHubPullRequestTimeline,
  GitHubPullRequestTimelineError,
  GitHubSearchResult,
  ListGitHubIssuesOptions,
  ListHostingPullRequestsOptions,
  PullRequestCheck,
  PullRequestChecksStatus,
  PullRequestCheckStatus,
  PullRequestReviewDecision,
  PullRequestTimelineItem,
  SearchGitHubIssuesAndPrsOptions,
} from "../github-service.js";
import { createHostingHttpClient, type HostingHttpClient } from "./hosting-http-client.js";
import { createHostingRequestCache } from "./request-cache.js";
import { createPullRequestStatusPoller, type PullRequestStatusPoller } from "./status-poller.js";
import {
  BITBUCKET_CLOUD_CAPABILITIES,
  GitHostingRequestError,
  GitHostingUnsupportedCapabilityError,
  type BitbucketPullRequestStatusFacts,
  type GitHostingService,
} from "./types.js";

const BITBUCKET_CLOUD_PROVIDER_ID = "bitbucket-cloud" as const;

const BITBUCKET_API_BASE_URL = "https://api.bitbucket.org/2.0";
const DEFAULT_TTL_MS = 30_000;
// Bitbucket Cloud budgets ~1000 API requests/hour: poll more conservatively
// than GitHub (whose gh-CLI path polls 20s/120s).
export const BITBUCKET_POLL_FAST_INTERVAL_MS = 30_000;
export const BITBUCKET_POLL_SLOW_INTERVAL_MS = 180_000;
export const BITBUCKET_POLL_ERROR_BACKOFF_CAP_MS = 300_000;
const MAX_TIMELINE_COMMENT_PAGES = 2;

export interface BitbucketCloudCredentials {
  email: string;
  apiToken: string;
}

export interface BitbucketCloudServiceOptions {
  credentials: BitbucketCloudCredentials;
  // cwd → git remote URL. Injected for tests; defaults to `git remote get-url origin`.
  resolveRemoteUrl: (cwd: string) => Promise<string | null>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  ttlMs?: number;
}

const BitbucketUserSchema = z
  .object({
    display_name: z.string().catch(""),
    nickname: z.string().optional().catch(undefined),
    links: z
      .object({
        html: z
          .object({ href: z.string().catch("") })
          .optional()
          .catch(undefined),
        avatar: z
          .object({ href: z.string().catch("") })
          .optional()
          .catch(undefined),
      })
      .optional()
      .catch(undefined),
  })
  .nullable()
  .catch(null);

const BitbucketBranchRefSchema = z
  .object({
    branch: z
      .object({ name: z.string().catch("") })
      .optional()
      .catch(undefined),
    commit: z
      .object({ hash: z.string().catch("") })
      .nullable()
      .optional()
      .catch(null),
    repository: z
      .object({
        full_name: z.string().optional().catch(undefined),
        uuid: z.string().optional().catch(undefined),
      })
      .nullable()
      .optional()
      .catch(null),
  })
  .optional()
  .catch(undefined);

const BitbucketParticipantSchema = z.object({
  approved: z.boolean().catch(false),
  state: z.string().nullable().catch(null),
});

const BitbucketPullRequestSchema = z.object({
  id: z.number(),
  title: z.string().catch(""),
  state: z.string().catch(""),
  draft: z.boolean().optional().catch(false),
  summary: z
    .object({ raw: z.string().catch("") })
    .nullable()
    .optional()
    .catch(null),
  links: z
    .object({
      html: z
        .object({ href: z.string().catch("") })
        .optional()
        .catch(undefined),
    })
    .optional()
    .catch(undefined),
  source: BitbucketBranchRefSchema,
  destination: BitbucketBranchRefSchema,
  participants: z.array(BitbucketParticipantSchema).optional().catch([]),
  updated_on: z.string().catch(""),
});

const BitbucketPullRequestPageSchema = z.object({
  values: z.array(z.unknown()).catch([]),
  next: z.string().optional().catch(undefined),
});

const BitbucketCommitStatusSchema = z.object({
  key: z.string().catch(""),
  name: z.string().nullable().optional().catch(null),
  state: z.string().nullable().catch(null),
  url: z.string().nullable().optional().catch(null),
});

const BitbucketCommentSchema = z.object({
  id: z.number(),
  deleted: z.boolean().optional().catch(false),
  content: z
    .object({ raw: z.string().catch("") })
    .optional()
    .catch(undefined),
  user: BitbucketUserSchema,
  created_on: z.string().nullable().optional().catch(null),
  links: z
    .object({
      html: z
        .object({ href: z.string().catch("") })
        .optional()
        .catch(undefined),
    })
    .optional()
    .catch(undefined),
  inline: z
    .object({
      path: z.string().catch(""),
      to: z.number().nullable().optional().catch(null),
      from: z.number().nullable().optional().catch(null),
    })
    .nullable()
    .optional()
    .catch(null),
});

const BitbucketActivityEntrySchema = z.object({
  approval: z
    .object({
      date: z.string().nullable().optional().catch(null),
      user: BitbucketUserSchema,
    })
    .nullable()
    .optional()
    .catch(null),
  changes_requested: z
    .object({
      date: z.string().nullable().optional().catch(null),
      user: BitbucketUserSchema,
    })
    .nullable()
    .optional()
    .catch(null),
});

const BitbucketCreatedPullRequestSchema = z.object({
  id: z.number(),
  links: z
    .object({
      html: z
        .object({ href: z.string().catch("") })
        .optional()
        .catch(undefined),
    })
    .optional()
    .catch(undefined),
});

interface BitbucketRepoIdentity {
  workspace: string;
  slug: string;
}

type BitbucketPullRequest = z.infer<typeof BitbucketPullRequestSchema>;

// Lowercase to match the GitHub service's wire shape — the client compares
// state === "open" exactly, so Bitbucket's uppercase "OPEN" rendered as a red
// "Closed" badge on open PRs.
function mapPullRequestState(state: string): { state: string; isMerged: boolean } {
  switch (state) {
    case "OPEN":
      return { state: "open", isMerged: false };
    case "MERGED":
      return { state: "merged", isMerged: true };
    default:
      // DECLINED / SUPERSEDED
      return { state: "closed", isMerged: false };
  }
}

function mapCommitStatusState(state: string | null): PullRequestCheckStatus {
  switch (state) {
    case "SUCCESSFUL":
      return "success";
    case "FAILED":
      return "failure";
    case "STOPPED":
      return "cancelled";
    case "INPROGRESS":
    default:
      return "pending";
  }
}

export function computeBitbucketChecksStatus(checks: PullRequestCheck[]): PullRequestChecksStatus {
  if (checks.length === 0) {
    return "none";
  }
  if (checks.some((check) => check.status === "failure" || check.status === "cancelled")) {
    return "failure";
  }
  if (checks.some((check) => check.status === "pending")) {
    return "pending";
  }
  return "success";
}

export function computeBitbucketReviewDecision(
  participants: Array<{ approved: boolean; state: string | null }>,
): PullRequestReviewDecision {
  if (participants.some((participant) => participant.state === "changes_requested")) {
    return "changes_requested";
  }
  if (participants.some((participant) => participant.approved)) {
    return "approved";
  }
  return null;
}

// Bitbucket's query language wraps terms in double quotes; strip embedded
// quotes and backslashes from user text so it can't escape the term.
export function sanitizeBitbucketQueryTerm(term: string): string {
  return term.replace(/["\\]/gu, " ").trim();
}

function pullRequestSummaryFrom(pr: BitbucketPullRequest): HostingPullRequestSummary {
  const mapped = mapPullRequestState(pr.state);
  return {
    number: pr.id,
    title: pr.title,
    url: pr.links?.html?.href ?? "",
    state: mapped.state,
    body: pr.summary?.raw ?? null,
    baseRefName: pr.destination?.branch?.name ?? "",
    headRefName: pr.source?.branch?.name ?? "",
    labels: [],
    updatedAt: pr.updated_on,
  };
}

function timelineErrorFrom(error: unknown): GitHubPullRequestTimelineError {
  if (error instanceof GitHostingRequestError) {
    if (error.status === 404) {
      return { kind: "not_found", message: error.message };
    }
    if (error.status === 403) {
      return { kind: "forbidden", message: error.message };
    }
  }
  return { kind: "unknown", message: error instanceof Error ? error.message : "unknown error" };
}

function parseOptionalTime(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function timelineCommentItem(
  comment: z.infer<typeof BitbucketCommentSchema>,
): PullRequestTimelineItem {
  return {
    kind: "comment",
    id: String(comment.id),
    author: comment.user?.display_name ?? "",
    authorUrl: comment.user?.links?.html?.href ?? null,
    avatarUrl: comment.user?.links?.avatar?.href ?? null,
    body: comment.content?.raw ?? "",
    createdAt: parseOptionalTime(comment.created_on),
    url: comment.links?.html?.href ?? "",
    ...(comment.inline
      ? {
          location: {
            path: comment.inline.path,
            line: comment.inline.to ?? comment.inline.from ?? undefined,
          },
        }
      : {}),
  };
}

async function loadTimelineComments(params: {
  http: HostingHttpClient;
  prPath: string;
}): Promise<{ items: PullRequestTimelineItem[]; truncated: boolean }> {
  const items: PullRequestTimelineItem[] = [];
  let truncated = false;
  let commentsPath: string | null = `${params.prPath}/comments`;
  for (let pageIndex = 0; pageIndex < MAX_TIMELINE_COMMENT_PAGES && commentsPath; pageIndex += 1) {
    const raw: unknown = await params.http.request({
      method: "GET",
      path: commentsPath,
      query: pageIndex === 0 ? { pagelen: 100, sort: "created_on" } : undefined,
    });
    const page = BitbucketPullRequestPageSchema.parse(raw);
    for (const value of page.values) {
      const parsed = BitbucketCommentSchema.safeParse(value);
      if (!parsed.success || parsed.data.deleted) {
        continue;
      }
      items.push(timelineCommentItem(parsed.data));
    }
    if (page.next) {
      // `next` is an absolute URL; keep only the API-relative path.
      const nextUrl = new URL(page.next);
      commentsPath = nextUrl.pathname.replace(/^\/2\.0/u, "") + nextUrl.search;
      truncated = pageIndex + 1 >= MAX_TIMELINE_COMMENT_PAGES;
    } else {
      commentsPath = null;
    }
  }
  return { items, truncated };
}

type BitbucketActivityEntry = z.infer<typeof BitbucketActivityEntrySchema>;

function timelineReviewFromActivity(entry: BitbucketActivityEntry): PullRequestTimelineItem | null {
  let review: {
    entry: NonNullable<BitbucketActivityEntry["approval"]>;
    state: "approved" | "changes_requested";
  } | null = null;
  if (entry.approval) {
    review = { entry: entry.approval, state: "approved" };
  } else if (entry.changes_requested) {
    review = { entry: entry.changes_requested, state: "changes_requested" };
  }
  if (!review) {
    return null;
  }
  const createdAt = parseOptionalTime(review.entry.date);
  return {
    kind: "review",
    id: `${review.state}-${review.entry.user?.display_name ?? "unknown"}-${createdAt}`,
    author: review.entry.user?.display_name ?? "",
    authorUrl: review.entry.user?.links?.html?.href ?? null,
    avatarUrl: review.entry.user?.links?.avatar?.href ?? null,
    body: "",
    createdAt,
    url: "",
    reviewState: review.state,
  };
}

async function loadTimelineReviews(params: {
  http: HostingHttpClient;
  prPath: string;
}): Promise<{ items: PullRequestTimelineItem[]; truncated: boolean }> {
  const raw = await params.http.request({
    method: "GET",
    path: `${params.prPath}/activity`,
    query: { pagelen: 50 },
  });
  const page = BitbucketPullRequestPageSchema.parse(raw);
  const items: PullRequestTimelineItem[] = [];
  for (const value of page.values) {
    const parsed = BitbucketActivityEntrySchema.safeParse(value);
    if (!parsed.success) {
      continue;
    }
    const item = timelineReviewFromActivity(parsed.data);
    if (item) {
      items.push(item);
    }
  }
  return { items, truncated: Boolean(page.next) };
}

export function createBitbucketCloudService(
  options: BitbucketCloudServiceOptions,
): GitHostingService {
  const now = options.now ?? Date.now;
  const capabilities: GitHostingCapabilities = BITBUCKET_CLOUD_CAPABILITIES;
  const cache = createHostingRequestCache({ ttlMs: options.ttlMs ?? DEFAULT_TTL_MS, now });
  const identityCache = new Map<string, Promise<BitbucketRepoIdentity | null>>();

  const http: HostingHttpClient = createHostingHttpClient({
    providerId: "bitbucket-cloud",
    baseUrl: BITBUCKET_API_BASE_URL,
    buildAuthorizationHeader: () =>
      `Basic ${Buffer.from(`${options.credentials.email}:${options.credentials.apiToken}`).toString("base64")}`,
    fetchImpl: options.fetchImpl,
    now,
  });

  let api!: GitHostingService;

  const poller: PullRequestStatusPoller = createPullRequestStatusPoller({
    intervals: {
      fastIntervalMs: BITBUCKET_POLL_FAST_INTERVAL_MS,
      slowIntervalMs: BITBUCKET_POLL_SLOW_INTERVAL_MS,
      errorBackoffCapMs: BITBUCKET_POLL_ERROR_BACKOFF_CAP_MS,
    },
    poll: async (target) => {
      await api.getCurrentPullRequestStatus({
        cwd: target.cwd,
        headRef: target.headRef,
        headRepositoryOwner: target.headRepositoryOwner,
        force: true,
        reason: "self-heal-bitbucket",
      });
    },
  });

  async function resolveIdentity(cwd: string): Promise<BitbucketRepoIdentity | null> {
    const cached = identityCache.get(cwd);
    if (cached) {
      return cached;
    }
    const resolution = (async () => {
      const remoteUrl = await options.resolveRemoteUrl(cwd);
      if (!remoteUrl) {
        return null;
      }
      const identity = parseBitbucketCloudRemoteUrl(remoteUrl);
      if (!identity) {
        return null;
      }
      return { workspace: identity.owner, slug: identity.name };
    })();
    identityCache.set(cwd, resolution);
    return resolution;
  }

  async function requireIdentity(cwd: string): Promise<BitbucketRepoIdentity> {
    const identity = await resolveIdentity(cwd);
    if (!identity) {
      throw new GitHostingRequestError({
        method: "GET",
        path: "(remote)",
        status: null,
        detail: "workspace has no Bitbucket Cloud remote",
      });
    }
    return identity;
  }

  function repoPath(identity: BitbucketRepoIdentity): string {
    return `/repositories/${encodeURIComponent(identity.workspace)}/${encodeURIComponent(identity.slug)}`;
  }

  async function fetchPullRequests(params: {
    identity: BitbucketRepoIdentity;
    q: string;
    limit: number;
  }): Promise<BitbucketPullRequest[]> {
    const raw = await http.request({
      method: "GET",
      path: `${repoPath(params.identity)}/pullrequests`,
      query: {
        q: params.q,
        sort: "-updated_on",
        pagelen: Math.min(Math.max(params.limit, 1), 50),
      },
    });
    const page = BitbucketPullRequestPageSchema.parse(raw);
    const parsed: BitbucketPullRequest[] = [];
    for (const value of page.values) {
      const result = BitbucketPullRequestSchema.safeParse(value);
      if (result.success) {
        parsed.push(result.data);
      }
    }
    return parsed;
  }

  async function fetchPullRequest(params: {
    identity: BitbucketRepoIdentity;
    number: number;
  }): Promise<BitbucketPullRequest> {
    const raw = await http.request({
      method: "GET",
      path: `${repoPath(params.identity)}/pullrequests/${params.number}`,
    });
    return BitbucketPullRequestSchema.parse(raw);
  }

  async function fetchChecksForCommit(params: {
    identity: BitbucketRepoIdentity;
    commitHash: string;
  }): Promise<PullRequestCheck[]> {
    if (!params.commitHash) {
      return [];
    }
    const raw = await http.request({
      method: "GET",
      path: `${repoPath(params.identity)}/commit/${params.commitHash}/statuses`,
      query: { pagelen: 100 },
    });
    const page = BitbucketPullRequestPageSchema.parse(raw);
    const checks: PullRequestCheck[] = [];
    for (const value of page.values) {
      const parsed = BitbucketCommitStatusSchema.safeParse(value);
      if (!parsed.success) {
        continue;
      }
      checks.push({
        name: parsed.data.name || parsed.data.key,
        status: mapCommitStatusState(parsed.data.state),
        url: parsed.data.url ?? null,
      });
    }
    return checks;
  }

  async function buildCurrentStatus(params: {
    identity: BitbucketRepoIdentity;
    pr: BitbucketPullRequest;
  }): Promise<HostingCurrentPullRequestStatus> {
    const { identity, pr } = params;
    const mapped = mapPullRequestState(pr.state);
    const checks = await fetchChecksForCommit({
      identity,
      commitHash: pr.source?.commit?.hash ?? "",
    });
    const participants = (pr.participants ?? []).map((participant) => ({
      approved: participant.approved,
      state: participant.state,
    }));
    const bitbucket: BitbucketPullRequestStatusFacts = {
      mergeStrategiesAllowed: ["merge", "squash"],
      defaultMergeStrategy: "merge",
      approvalCount: participants.filter((participant) => participant.approved).length,
      changesRequestedCount: participants.filter(
        (participant) => participant.state === "changes_requested",
      ).length,
    };
    return {
      number: pr.id,
      repoOwner: identity.workspace,
      repoName: identity.slug,
      url: pr.links?.html?.href ?? "",
      title: pr.title,
      state: mapped.state,
      baseRefName: pr.destination?.branch?.name ?? "",
      headRefName: pr.source?.branch?.name ?? "",
      isMerged: mapped.isMerged,
      isDraft: pr.draft ?? false,
      mergeable: "UNKNOWN",
      checks,
      checksStatus: computeBitbucketChecksStatus(checks),
      reviewDecision: computeBitbucketReviewDecision(participants),
      bitbucket,
    };
  }

  api = {
    providerId: "bitbucket-cloud",
    capabilities,

    listPullRequests(input: ListHostingPullRequestsOptions): Promise<HostingPullRequestSummary[]> {
      return cache.cached({
        cwd: input.cwd,
        method: "listPullRequests",
        args: { query: input.query ?? "", limit: input.limit ?? 20 },
        readOptions: input,
        load: async () => {
          const identity = await requireIdentity(input.cwd);
          const term = sanitizeBitbucketQueryTerm(input.query ?? "");
          const q = term
            ? `state = "OPEN" AND (title ~ "${term}" OR description ~ "${term}")`
            : `state = "OPEN"`;
          const prs = await fetchPullRequests({ identity, q, limit: input.limit ?? 20 });
          return prs.map(pullRequestSummaryFrom);
        },
      });
    },

    listIssues(_input: ListGitHubIssuesOptions): Promise<GitHubIssueSummary[]> {
      // Bitbucket Cloud's native issue tracker is deprecated; capability is
      // false and search never requests issues for this provider.
      return Promise.resolve([]);
    },

    getPullRequest(input: GetGitHubPullRequestOptions): Promise<HostingPullRequestSummary> {
      return cache.cached({
        cwd: input.cwd,
        method: "getPullRequest",
        args: { number: input.number },
        readOptions: input,
        load: async () => {
          const identity = await requireIdentity(input.cwd);
          const pr = await fetchPullRequest({ identity, number: input.number });
          return pullRequestSummaryFrom(pr);
        },
      });
    },

    async getPullRequestHeadRef(input: GetGitHubPullRequestOptions): Promise<string> {
      const pullRequest = await api.getPullRequest(input);
      return pullRequest.headRefName;
    },

    getPullRequestCheckoutTarget(
      input: GetGitHubPullRequestOptions,
    ): Promise<GitHubPullRequestCheckoutTarget> {
      return cache.cached({
        cwd: input.cwd,
        method: "getPullRequestCheckoutTarget",
        args: { number: input.number },
        readOptions: input,
        load: async () => {
          const identity = await requireIdentity(input.cwd);
          const pr = await fetchPullRequest({ identity, number: input.number });
          const headFullName = pr.source?.repository?.full_name ?? null;
          const isCrossRepository =
            !!pr.source?.repository?.uuid &&
            !!pr.destination?.repository?.uuid &&
            pr.source.repository.uuid !== pr.destination.repository.uuid;
          return {
            number: pr.id,
            baseRefName: pr.destination?.branch?.name ?? "",
            headRefName: pr.source?.branch?.name ?? "",
            headOwnerLogin: headFullName ? (headFullName.split("/")[0] ?? null) : null,
            headRepositorySshUrl: headFullName ? `git@bitbucket.org:${headFullName}.git` : null,
            headRepositoryUrl: headFullName ? `https://bitbucket.org/${headFullName}` : null,
            isCrossRepository,
          };
        },
      });
    },

    getCurrentPullRequestStatus(input) {
      return cache
        .cached<HostingCurrentPullRequestStatus | null>({
          cwd: input.cwd,
          method: "getCurrentPullRequestStatus",
          args: { headRef: input.headRef, headRepositoryOwner: input.headRepositoryOwner },
          readOptions: input,
          load: async () => {
            const identity = await resolveIdentity(input.cwd);
            if (!identity) {
              return null;
            }
            const branch = sanitizeBitbucketQueryTerm(input.headRef);
            if (!branch) {
              return null;
            }
            const prs = await fetchPullRequests({
              identity,
              q: `source.branch.name = "${branch}" AND (state = "OPEN" OR state = "MERGED")`,
              limit: 20,
            });
            const open = prs.find((pr) => pr.state === "OPEN");
            const candidate =
              open ??
              [...prs].sort(
                (left, right) =>
                  parseOptionalTime(right.updated_on) - parseOptionalTime(left.updated_on),
              )[0];
            if (!candidate) {
              return null;
            }
            return buildCurrentStatus({ identity, pr: candidate });
          },
        })
        .then((status) => {
          poller.reportSuccess({
            target: {
              cwd: input.cwd,
              headRef: input.headRef,
              headRepositoryOwner: input.headRepositoryOwner,
            },
            status,
            notify: input.reason === "self-heal-bitbucket",
          });
          return status;
        });
    },

    getPullRequestTimeline(
      input: GetGitHubPullRequestTimelineOptions,
    ): Promise<GitHubPullRequestTimeline> {
      return cache.cached({
        cwd: input.cwd,
        method: "getPullRequestTimeline",
        args: { prNumber: input.prNumber },
        readOptions: input,
        load: async () => {
          const base = {
            prNumber: input.prNumber,
            repoOwner: input.repoOwner,
            repoName: input.repoName,
          };
          try {
            const identity = await requireIdentity(input.cwd);
            const prPath = `${repoPath(identity)}/pullrequests/${input.prNumber}`;
            const comments = await loadTimelineComments({ http, prPath });
            const reviews = await loadTimelineReviews({ http, prPath });
            const items = [...comments.items, ...reviews.items].sort(
              (left, right) => left.createdAt - right.createdAt,
            );
            return {
              ...base,
              items,
              truncated: comments.truncated || reviews.truncated,
              error: null,
            };
          } catch (error) {
            return {
              ...base,
              items: [],
              truncated: false,
              error: timelineErrorFrom(error),
            };
          }
        },
      });
    },

    getGitHubCheckDetails(_input: GetGitHubCheckDetailsOptions): Promise<GitHubCheckDetails> {
      // Capability-gated off; the RPC handler never routes here. Fail loudly
      // if something bypasses the gate.
      return Promise.reject(
        new GitHostingRequestError({
          method: "GET",
          path: "(check-details)",
          status: null,
          detail: "check details are not supported by Bitbucket Cloud",
        }),
      );
    },

    async searchIssuesAndPrs(input: SearchGitHubIssuesAndPrsOptions): Promise<GitHubSearchResult> {
      const kinds = input.kinds ?? ["github-issue", "github-pr"];
      if (!kinds.includes("github-pr")) {
        return { items: [], githubFeaturesEnabled: true };
      }
      const prs = input.force
        ? await api.listPullRequests({
            cwd: input.cwd,
            query: input.query,
            limit: input.limit,
            force: true,
            reason: input.reason,
          })
        : await api.listPullRequests({
            cwd: input.cwd,
            query: input.query,
            limit: input.limit,
          });
      return {
        items: prs.map((pr) => ({
          kind: "pr" as const,
          number: pr.number,
          title: pr.title,
          url: pr.url,
          state: pr.state,
          body: pr.body,
          labels: pr.labels,
          baseRefName: pr.baseRefName,
          headRefName: pr.headRefName,
          updatedAt: pr.updatedAt,
        })),
        githubFeaturesEnabled: true,
      };
    },

    async createPullRequest(input): Promise<GitHubPullRequestCreateResult> {
      const [workspace, slug] = input.repo.split("/");
      if (!workspace || !slug) {
        throw new GitHostingRequestError({
          method: "POST",
          path: "/pullrequests",
          status: null,
          detail: `invalid repository "${input.repo}"`,
        });
      }
      const raw = await http.request({
        method: "POST",
        path: `/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(slug)}/pullrequests`,
        body: {
          title: input.title,
          source: { branch: { name: input.head } },
          destination: { branch: { name: input.base } },
          ...(input.body ? { description: input.body } : {}),
        },
      });
      const created = BitbucketCreatedPullRequestSchema.parse(raw);
      return { url: created.links?.html?.href ?? "", number: created.id };
    },

    async mergePullRequest(input) {
      if (input.mergeMethod === "rebase") {
        throw new GitHostingUnsupportedCapabilityError({
          providerId: BITBUCKET_CLOUD_PROVIDER_ID,
          capability: "rebase merges",
        });
      }
      const identity = await requireIdentity(input.cwd);
      // Fresh precondition read — a merge is a user-initiated, single-shot
      // mutation; never retried.
      const pr = await fetchPullRequest({ identity, number: input.prNumber });
      if (pr.state !== "OPEN") {
        throw new Error("Bitbucket does not report this pull request as open for merge");
      }
      await http.request({
        method: "POST",
        path: `${repoPath(identity)}/pullrequests/${input.prNumber}/merge`,
        body: {
          merge_strategy: input.mergeMethod === "squash" ? "squash" : "merge_commit",
        },
      });
      return { success: true };
    },

    enablePullRequestAutoMerge() {
      return Promise.reject(
        new GitHostingUnsupportedCapabilityError({
          providerId: BITBUCKET_CLOUD_PROVIDER_ID,
          capability: "auto-merge",
        }),
      );
    },

    disablePullRequestAutoMerge() {
      return Promise.reject(
        new GitHostingUnsupportedCapabilityError({
          providerId: BITBUCKET_CLOUD_PROVIDER_ID,
          capability: "auto-merge",
        }),
      );
    },

    isAuthenticated(input) {
      return cache.cached({
        cwd: input.cwd,
        method: "isAuthenticated",
        args: {},
        readOptions: input,
        load: async () => {
          await http.request({ method: "GET", path: "/user" });
          return true;
        },
      });
    },

    retainCurrentPullRequestStatusPoll(input) {
      return poller.retain(input);
    },

    invalidate(input: { cwd: string }): void {
      cache.invalidate(input.cwd);
      identityCache.delete(input.cwd);
    },

    dispose(): void {
      poller.dispose();
      cache.clear();
      identityCache.clear();
    },
  };

  return api;
}
