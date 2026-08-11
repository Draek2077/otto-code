import { describe, expect, it } from "vitest";
import { sortPullRequestsLatestFirst, type PullRequestSummary } from "./forge-service.js";

function pullRequest(
  overrides: Partial<PullRequestSummary> & { number: number },
): PullRequestSummary {
  return {
    title: `PR ${overrides.number}`,
    url: `https://example.com/pull/${overrides.number}`,
    state: "open",
    body: null,
    baseRefName: "main",
    headRefName: "feature",
    labels: [],
    updatedAt: "",
    ...overrides,
  };
}

describe("sortPullRequestsLatestFirst", () => {
  it("orders pull requests by most recent update with a deterministic number tie-breaker", () => {
    const oldest = pullRequest({ number: 2, updatedAt: "2026-08-01T10:00:00.000Z" });
    const newest = pullRequest({ number: 1, updatedAt: "2026-08-03T10:00:00.000Z" });
    const sameTime = pullRequest({ number: 3, updatedAt: newest.updatedAt });

    expect(
      sortPullRequestsLatestFirst([oldest, newest, sameTime]).map((item) => item.number),
    ).toEqual([3, 1, 2]);
  });
});
