import { describe, expect, it } from "vitest";
import {
  createBitbucketCloudService,
  sanitizeBitbucketQueryTerm,
} from "./bitbucket-cloud-service.js";
import { GitHostingAuthenticationError, GitHostingRateLimitError } from "./types.js";

interface RecordedRequest {
  method: string;
  url: URL;
  body: unknown;
}

function jsonResponse(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
}

function createFetchStub(handler: (request: RecordedRequest) => Response | Promise<Response>): {
  fetchImpl: typeof fetch;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const request: RecordedRequest = {
      method: init?.method ?? "GET",
      url,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    requests.push(request);
    return handler(request);
  }) as typeof fetch;
  return { fetchImpl, requests };
}

function createService(params: {
  handler: (request: RecordedRequest) => Response | Promise<Response>;
  remoteUrl?: string | null;
  now?: () => number;
}) {
  const { fetchImpl, requests } = createFetchStub(params.handler);
  const service = createBitbucketCloudService({
    credentials: { email: "dev@example.com", apiToken: "secret-token" },
    resolveRemoteUrl: async () =>
      params.remoteUrl === undefined ? "git@bitbucket.org:acme/widgets.git" : params.remoteUrl,
    fetchImpl,
    now: params.now,
  });
  return { service, requests };
}

const OPEN_PR = {
  id: 7,
  title: "Add widget flux capacitor",
  state: "OPEN",
  draft: false,
  summary: { raw: "Body text" },
  links: { html: { href: "https://bitbucket.org/acme/widgets/pull-requests/7" } },
  source: {
    branch: { name: "feature/flux" },
    commit: { hash: "abc123" },
    repository: { full_name: "acme/widgets", uuid: "{repo}" },
  },
  destination: {
    branch: { name: "main" },
    repository: { full_name: "acme/widgets", uuid: "{repo}" },
  },
  participants: [
    { approved: true, state: "approved" },
    { approved: false, state: "changes_requested" },
  ],
  updated_on: "2026-07-10T10:00:00.000000+00:00",
};

describe("sanitizeBitbucketQueryTerm", () => {
  it("strips quotes and backslashes so terms cannot escape the query", () => {
    expect(sanitizeBitbucketQueryTerm('foo" OR state="MERGED')).toBe("foo  OR state= MERGED");
    expect(sanitizeBitbucketQueryTerm("back\\slash")).toBe("back slash");
  });
});

describe("bitbucket cloud service", () => {
  it("lists open pull requests with mapped fields", async () => {
    const { service, requests } = createService({
      handler: (request) => {
        if (request.url.pathname.endsWith("/pullrequests")) {
          return jsonResponse({ values: [OPEN_PR] });
        }
        throw new Error(`unexpected request ${request.url.pathname}`);
      },
    });

    const prs = await service.listPullRequests({ cwd: "C:/repo", query: "flux" });
    expect(prs).toEqual([
      {
        number: 7,
        title: "Add widget flux capacitor",
        url: "https://bitbucket.org/acme/widgets/pull-requests/7",
        state: "OPEN",
        body: "Body text",
        baseRefName: "main",
        headRefName: "feature/flux",
        labels: [],
        updatedAt: "2026-07-10T10:00:00.000000+00:00",
      },
    ]);
    const query = requests[0]?.url.searchParams.get("q") ?? "";
    expect(query).toContain('state = "OPEN"');
    expect(query).toContain('title ~ "flux"');
  });

  it("serves repeat reads from cache within the TTL (single flight)", async () => {
    const { service, requests } = createService({
      handler: () => jsonResponse({ values: [OPEN_PR] }),
    });

    await service.listPullRequests({ cwd: "C:/repo", query: "" });
    await service.listPullRequests({ cwd: "C:/repo", query: "" });
    expect(requests).toHaveLength(1);
  });

  it("builds current PR status with checks, review decision, and bitbucket facts", async () => {
    const { service } = createService({
      handler: (request) => {
        if (request.url.pathname.includes("/commit/abc123/statuses")) {
          return jsonResponse({
            values: [
              { key: "ci", name: "CI Build", state: "SUCCESSFUL", url: "https://ci.example" },
              { key: "lint", name: "Lint", state: "INPROGRESS", url: null },
            ],
          });
        }
        if (request.url.pathname.endsWith("/pullrequests")) {
          return jsonResponse({ values: [OPEN_PR] });
        }
        throw new Error(`unexpected request ${request.url.pathname}`);
      },
    });

    const status = await service.getCurrentPullRequestStatus({
      cwd: "C:/repo",
      headRef: "feature/flux",
    });
    expect(status).not.toBeNull();
    expect(status?.number).toBe(7);
    expect(status?.repoOwner).toBe("acme");
    expect(status?.repoName).toBe("widgets");
    expect(status?.state).toBe("OPEN");
    expect(status?.isMerged).toBe(false);
    expect(status?.mergeable).toBe("UNKNOWN");
    expect(status?.checksStatus).toBe("pending");
    expect(status?.checks).toEqual([
      { name: "CI Build", status: "success", url: "https://ci.example" },
      { name: "Lint", status: "pending", url: null },
    ]);
    expect(status?.reviewDecision).toBe("changes_requested");
    expect(status?.github).toBeUndefined();
    expect(status?.bitbucket).toEqual({
      mergeStrategiesAllowed: ["merge", "squash"],
      defaultMergeStrategy: "merge",
      approvalCount: 1,
      changesRequestedCount: 1,
    });
  });

  it("returns null status when the workspace has no Bitbucket remote", async () => {
    const { service, requests } = createService({
      handler: () => {
        throw new Error("should not hit the network");
      },
      remoteUrl: "git@github.com:acme/widgets.git",
    });

    const status = await service.getCurrentPullRequestStatus({
      cwd: "C:/repo",
      headRef: "feature/flux",
    });
    expect(status).toBeNull();
    expect(requests).toHaveLength(0);
  });

  it("reports a merged PR for a branch whose PR closed", async () => {
    const merged = { ...OPEN_PR, state: "MERGED" };
    const { service } = createService({
      handler: (request) => {
        if (request.url.pathname.includes("/statuses")) {
          return jsonResponse({ values: [] });
        }
        return jsonResponse({ values: [merged] });
      },
    });

    const status = await service.getCurrentPullRequestStatus({
      cwd: "C:/repo",
      headRef: "feature/flux",
    });
    expect(status?.isMerged).toBe(true);
    expect(status?.state).toBe("MERGED");
    expect(status?.checksStatus).toBe("none");
  });

  it("merges an open PR with the mapped strategy and never retries the mutation", async () => {
    const { service, requests } = createService({
      handler: (request) => {
        if (request.method === "POST" && request.url.pathname.endsWith("/merge")) {
          return jsonResponse({});
        }
        if (request.url.pathname.endsWith("/pullrequests/7")) {
          return jsonResponse(OPEN_PR);
        }
        throw new Error(`unexpected request ${request.url.pathname}`);
      },
    });

    const result = await service.mergePullRequest({
      cwd: "C:/repo",
      prNumber: 7,
      mergeMethod: "squash",
    });
    expect(result).toEqual({ success: true });
    const merge = requests.find((request) => request.method === "POST");
    expect(merge?.body).toEqual({ merge_strategy: "squash" });
    expect(requests.filter((request) => request.method === "POST")).toHaveLength(1);
  });

  it("refuses to merge a non-open PR", async () => {
    const { service } = createService({
      handler: (request) => {
        if (request.url.pathname.endsWith("/pullrequests/7")) {
          return jsonResponse({ ...OPEN_PR, state: "MERGED" });
        }
        throw new Error(`unexpected request ${request.url.pathname}`);
      },
    });

    await expect(
      service.mergePullRequest({ cwd: "C:/repo", prNumber: 7, mergeMethod: "merge" }),
    ).rejects.toThrow(/not report this pull request as open/u);
  });

  it("refuses rebase merges", async () => {
    const { service, requests } = createService({
      handler: () => {
        throw new Error("should not hit the network");
      },
    });

    await expect(
      service.mergePullRequest({ cwd: "C:/repo", prNumber: 7, mergeMethod: "rebase" }),
    ).rejects.toMatchObject({ kind: "unsupported-capability", capability: "rebase merges" });
    expect(requests).toHaveLength(0);
  });

  it("rejects auto-merge operations", async () => {
    const { service } = createService({ handler: () => jsonResponse({}) });
    await expect(
      service.enablePullRequestAutoMerge({ cwd: "C:/repo", prNumber: 7, mergeMethod: "merge" }),
    ).rejects.toMatchObject({ kind: "unsupported-capability", capability: "auto-merge" });
    await expect(
      service.disablePullRequestAutoMerge({ cwd: "C:/repo", prNumber: 7 }),
    ).rejects.toMatchObject({ kind: "unsupported-capability", capability: "auto-merge" });
  });

  it("searches pull requests only and never requests issues", async () => {
    const { service, requests } = createService({
      handler: (request) => {
        if (request.url.pathname.endsWith("/pullrequests")) {
          return jsonResponse({ values: [OPEN_PR] });
        }
        throw new Error(`unexpected request ${request.url.pathname}`);
      },
    });

    const result = await service.searchIssuesAndPrs({
      cwd: "C:/repo",
      query: "flux",
      kinds: ["github-issue", "github-pr"],
    });
    expect(result.githubFeaturesEnabled).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.kind).toBe("pr");
    expect(requests).toHaveLength(1);
  });

  it("maps 401 responses to an authentication error", async () => {
    const { service } = createService({
      handler: () => jsonResponse({ error: {} }, { status: 401 }),
    });

    await expect(
      service.isAuthenticated({ cwd: "C:/repo", force: true, reason: "test" }),
    ).rejects.toBeInstanceOf(GitHostingAuthenticationError);
  });

  it("enters a cooldown after rate limiting and fails fast without hitting the API", async () => {
    let currentTime = 1_000_000;
    const { service, requests } = createService({
      handler: () => jsonResponse({}, { status: 429, headers: { "Retry-After": "0" } }),
      now: () => currentTime,
    });

    await expect(service.listPullRequests({ cwd: "C:/repo", query: "" })).rejects.toBeInstanceOf(
      GitHostingRateLimitError,
    );
    const requestCountAfterFirst = requests.length;
    // Cooldown window: the next read must fail fast without a network call.
    currentTime += 1;
    await expect(
      service.listPullRequests({ cwd: "C:/repo", query: "", force: true, reason: "test" }),
    ).rejects.toBeInstanceOf(GitHostingRateLimitError);
    expect(requests.length).toBe(requestCountAfterFirst);
  });

  it("builds checkout targets for cross-repository PRs", async () => {
    const fork = {
      ...OPEN_PR,
      source: {
        branch: { name: "feature/flux" },
        commit: { hash: "abc123" },
        repository: { full_name: "contributor/widgets", uuid: "{fork}" },
      },
    };
    const { service } = createService({
      handler: (request) => {
        if (request.url.pathname.endsWith("/pullrequests/7")) {
          return jsonResponse(fork);
        }
        throw new Error(`unexpected request ${request.url.pathname}`);
      },
    });

    const target = await service.getPullRequestCheckoutTarget?.({ cwd: "C:/repo", number: 7 });
    expect(target).toEqual({
      number: 7,
      baseRefName: "main",
      headRefName: "feature/flux",
      headOwnerLogin: "contributor",
      headRepositorySshUrl: "git@bitbucket.org:contributor/widgets.git",
      headRepositoryUrl: "https://bitbucket.org/contributor/widgets",
      isCrossRepository: true,
    });
  });

  it("collects timeline comments and review activity in chronological order", async () => {
    const { service } = createService({
      handler: (request) => {
        if (request.url.pathname.endsWith("/comments")) {
          return jsonResponse({
            values: [
              {
                id: 11,
                content: { raw: "Looks good overall" },
                user: {
                  display_name: "Ana",
                  links: {
                    html: { href: "https://bitbucket.org/ana" },
                    avatar: { href: "https://bitbucket.org/ana/avatar" },
                  },
                },
                created_on: "2026-07-09T10:00:00.000000+00:00",
                links: { html: { href: "https://bitbucket.org/pr/7#comment-11" } },
              },
              {
                id: 12,
                deleted: true,
                content: { raw: "deleted" },
                created_on: "2026-07-09T10:30:00.000000+00:00",
              },
              {
                id: 13,
                content: { raw: "Rename this" },
                inline: { path: "src/widget.ts", to: 42 },
                user: { display_name: "Bo" },
                created_on: "2026-07-09T11:00:00.000000+00:00",
              },
            ],
          });
        }
        if (request.url.pathname.endsWith("/activity")) {
          return jsonResponse({
            values: [
              {
                approval: {
                  date: "2026-07-09T12:00:00.000000+00:00",
                  user: { display_name: "Cyd" },
                },
              },
              { update: {} },
            ],
          });
        }
        throw new Error(`unexpected request ${request.url.pathname}`);
      },
    });

    const timeline = await service.getPullRequestTimeline({
      cwd: "C:/repo",
      prNumber: 7,
      repoOwner: "acme",
      repoName: "widgets",
    });
    expect(timeline.error).toBeNull();
    expect(timeline.items.map((item) => item.kind)).toEqual(["comment", "comment", "review"]);
    const inline = timeline.items[1];
    expect(inline?.kind === "comment" && inline.location).toEqual({
      path: "src/widget.ts",
      line: 42,
    });
    const review = timeline.items[2];
    expect(review?.kind === "review" && review.reviewState).toBe("approved");
  });
});
