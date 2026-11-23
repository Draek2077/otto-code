import { describe, expect, it } from "vitest";
import { createForgeResolver } from "../../forge-resolver.js";
import { createBitbucketService } from "./service.js";

function pull(overrides: Record<string, unknown> = {}) {
  return {
    id: 17,
    title: "Work report",
    state: "OPEN",
    description: "Description",
    updated_on: "2026-10-30T00:00:00Z",
    source: {
      branch: { name: "feature/work" },
      commit: { hash: "abc" },
      repository: { full_name: "team/repo" },
    },
    destination: { branch: { name: "main" }, repository: { full_name: "team/repo" } },
    participants: [{ approved: true, state: "approved" }],
    ...overrides,
  };
}
function fixture(
  options: {
    remote?: string;
    replies?: (url: URL, init?: RequestInit) => Response | Promise<Response>;
  } = {},
) {
  const requests: { url: URL; init?: RequestInit }[] = [];
  let revision = "account-a";
  const service = createBitbucketService({
    credential: async () => ({ email: "test@example.test", apiToken: "fixture-only", revision }),
    resolveRemoteUrl: async () => options.remote ?? "git@bitbucket.org:team/repo.git",
    resolveSshHostname: async () => "bitbucket.org",
    fetch: async (input, init) => {
      const url = new URL(String(input));
      requests.push({ url, init });
      if (options.replies) return options.replies(url, init);
      if (url.pathname.endsWith("/statuses"))
        return Response.json({
          values: [
            {
              key: "build",
              name: "Build",
              state: "SUCCESSFUL",
              url: "https://bitbucket.org/team/repo/pipelines/results/1",
            },
          ],
        });
      if (url.pathname.endsWith("/pullrequests/17")) return Response.json(pull());
      return Response.json({ values: [pull()] });
    },
  });
  return {
    service,
    requests,
    rotate() {
      revision = "account-b";
    },
  };
}
describe("Bitbucket forge integration", () => {
  it("resolves the registered forge and reads PR status, approvals and checks", async () => {
    const { service, requests } = fixture();
    const resolver = createForgeResolver({
      resolveRemoteUrl: async () => "git@bitbucket.org:team/repo.git",
      createService: () => service,
    });
    const resolved = await resolver.resolve("/fixture");
    expect(resolved?.forge).toBe("bitbucket-cloud");
    expect(
      await resolved!.service.getCurrentPullRequestStatus({
        cwd: "/fixture",
        headRef: "feature/work",
        headSha: "abc",
      }),
    ).toMatchObject({
      number: 17,
      checksStatus: "success",
      reviewDecision: "approved",
      forgeSpecific: { forge: "bitbucket" },
    });
    expect(requests.map((request) => request.url.pathname)).toEqual([
      "/2.0/repositories/team/repo/pullrequests",
      "/2.0/repositories/team/repo/pullrequests/17/statuses",
    ]);
    expect(requests[0].url.searchParams.getAll("state")).toEqual([
      "OPEN",
      "MERGED",
      "DECLINED",
      "SUPERSEDED",
    ]);
  });
  it("does not attach a terminal PR to a reused branch with a different head SHA", async () => {
    const { service, requests } = fixture({
      replies: () => Response.json({ values: [pull({ state: "MERGED" })] }),
    });
    expect(
      await service.getCurrentPullRequestStatus({
        cwd: "/fixture",
        headRef: "feature/work",
        headSha: "new-head",
      }),
    ).toBeNull();
    expect(requests).toHaveLength(1);
  });
  it("keeps an open PR attached while its checkout has unpushed commits", async () => {
    const { service } = fixture();
    expect(
      await service.getCurrentPullRequestStatus({
        cwd: "/fixture",
        headRef: "feature/work",
        headSha: "new-unpushed-head",
      }),
    ).toMatchObject({ number: 17, state: "open" });
  });
  it("separates cache entries when the selected account changes", async () => {
    const { service, requests, rotate } = fixture();
    await service.listPullRequests({ cwd: "/fixture" });
    await service.listPullRequests({ cwd: "/fixture" });
    expect(requests).toHaveLength(1);
    rotate();
    await service.listPullRequests({ cwd: "/fixture" });
    expect(requests).toHaveLength(2);
  });
  it.each(["git@work-bitbucket:team/repo.git", "ssh://git@altssh.bitbucket.org:443/team/repo.git"])(
    "supports an existing SSH connection without changing Git auth: %s",
    async (remote) => {
      const { service } = fixture({ remote });
      expect(await service.getPullRequest({ cwd: "/fixture", number: 17 })).toMatchObject({
        number: 17,
      });
    },
  );
  it("prepares cross-repository checkout using the actual source branch and repository", async () => {
    const { service } = fixture({
      replies: () =>
        Response.json(
          pull({
            source: { branch: { name: "feature/work" }, repository: { full_name: "fork/repo" } },
          }),
        ),
    });
    expect(await service.getPullRequestCheckoutTarget({ cwd: "/fixture", number: 17 })).toEqual({
      number: 17,
      baseRefName: "main",
      headRefName: "feature/work",
      headOwnerLogin: "fork",
      headRepositorySshUrl: "git@bitbucket.org:fork/repo.git",
      headRepositoryUrl: "https://bitbucket.org/fork/repo.git",
      isCrossRepository: true,
      checkoutRefs: [{ remoteRef: "refs/heads/feature/work" }],
    });
  });
  it("creates through the official REST endpoint and never auto-retries a write", async () => {
    const { service, requests } = fixture({
      replies: () => new Response("unavailable", { status: 503 }),
    });
    await expect(
      service.createPullRequest({
        cwd: "/fixture",
        title: "Report",
        head: "feature/work",
        base: "main",
      }),
    ).rejects.toMatchObject({ kind: "uncertain" });
    expect(requests).toHaveLength(1);
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({
      title: "Report",
      description: "",
      source: { branch: { name: "feature/work" } },
      destination: { branch: { name: "main" } },
      close_source_branch: false,
    });
  });
  it("rechecks remote PR state before merge and refuses a closed request without writing", async () => {
    const { service, requests } = fixture({
      replies: () => Response.json(pull({ state: "DECLINED" })),
    });
    await expect(
      service.mergePullRequest({ cwd: "/fixture", prNumber: 17, mergeMethod: "merge" }),
    ).rejects.toMatchObject({ kind: "invalid" });
    expect(requests.map((request) => request.init?.method)).toEqual(["GET"]);
  });
  it("checks the actual merged response before reporting success", async () => {
    const { service, requests } = fixture({
      replies: (_url, init) =>
        Response.json(pull({ state: init?.method === "POST" ? "MERGED" : "OPEN" })),
    });
    expect(
      await service.mergePullRequest({ cwd: "/fixture", prNumber: 17, mergeMethod: "squash" }),
    ).toEqual({ success: true });
    expect(JSON.parse(String(requests[1].init?.body))).toEqual({
      merge_strategy: "squash",
      close_source_branch: false,
    });
  });
  it("keeps review comments, inline location, resolved state and approval history", async () => {
    const user = { display_name: "Reviewer" };
    const { service } = fixture({
      replies: (url) =>
        Response.json({
          values: url.pathname.endsWith("/comments")
            ? [
                {
                  id: 8,
                  user,
                  content: { raw: "Please update" },
                  created_on: "2026-10-30T00:00:00Z",
                  inline: { path: "src/work.ts", to: 4 },
                  resolution: { user },
                },
              ]
            : [{ approval: { user, date: "2026-10-30T01:00:00Z" } }],
        }),
    });
    expect(
      await service.getPullRequestTimeline({
        cwd: "/fixture",
        prNumber: 17,
        repoOwner: "team",
        repoName: "repo",
      }),
    ).toMatchObject({
      error: null,
      truncated: false,
      items: [
        {
          kind: "comment",
          body: "Please update",
          location: { path: "src/work.ts", line: 4, isResolved: true },
        },
        { kind: "review", reviewState: "approved", author: "Reviewer" },
      ],
    });
  });
  it("does not send credentials or requests to a foreign remote", async () => {
    const { service, requests } = fixture({ remote: "https://elsewhere.example/team/repo.git" });
    await expect(service.listPullRequests({ cwd: "/fixture" })).rejects.toMatchObject({
      kind: "invalid",
    });
    expect(requests).toHaveLength(0);
  });
  it.each([
    { resolved: true, method: "POST" },
    { resolved: false, method: "DELETE" },
  ])("updates discussion resolution with one explicit $method", async ({ resolved, method }) => {
    const { service, requests } = fixture({ replies: () => new Response(null, { status: 204 }) });
    await service.setThreadResolved({ cwd: "/fixture", number: 17, commentId: 42, resolved });
    expect(requests).toHaveLength(1);
    expect(requests[0].url.pathname).toBe(
      "/2.0/repositories/team/repo/pullrequests/17/comments/42/resolve",
    );
    expect(requests[0].init?.method).toBe(method);
  });
});
