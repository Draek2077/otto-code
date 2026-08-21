---
id: "pull-request-review-write-path-and-no-checkout-diff-read-are-git-hosting-gaps"
kind: "finding"
title: "Pull-request review write path and no-checkout diff read are git-hosting gaps"
status: "proposed"
tags: ["git-hosting","bitbucket","pull-requests","code-review","agent-tools"]
created_at: "2026-08-21T04:47:05.589Z"
updated_at: "2026-08-21T04:47:05.589Z"
---
# Pull-request review write path and no-checkout diff read are git-hosting gaps

<!-- compiled_truth -->

Otto's provider-neutral git-hosting layer covers pull-request lifecycle well and in several respects better than the operator tooling it was compared against: capability descriptors so no provider fakes parity, credentials in daemon-private config, auth headers built per request and never logged, mutation preconditions re-checked daemon-side before a merge, and bounded retry with rate-limit cooldown falling back to cache.

Five capabilities present in the audited corpus have no equivalent in the layer.

1. **Posting a line-anchored review comment.** The layer reads PR timelines but exposes no write path for a comment bound to a file path and line number, nor for a threaded reply to an existing comment id. This is the difference between observing a review and participating in one.
2. **Reading review comments grouped by file and line**, with resolved threads excluded by default.
3. **Fetching a PR's diff, diffstat, and a single changed file's content at the source commit, without checking the branch out.** This is the primitive that lets a reviewer, human or agent, review a pull request that was never cloned.
4. **Resolving a pull request from a tracker card key** by matching source branch names across recently active repositories.
5. **Partial-response field selection.** The Bitbucket Cloud API accepts a `fields` parameter that trims the response payload server-side. Whether the existing Bitbucket service uses it was not checked. If it does not, this is free token economy on a surface that is about to matter more.

Repository enumeration is a related efficiency note rather than a gap: the audited corpus lists a workspace once and filters on last-updated timestamp against a cutoff, scanning only recently active repositories rather than the whole workspace on each pass.

Gaps 1 through 3 are the ones that matter for agent-driven review, and 3 is a precondition for 1 being useful.

## Timeline

- time: "2026-08-21T04:47:05.589Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["daemon-owned-tracker-and-pull-request-capabilities-are-not-exposed-to-agents","diff-review-experience"]
- time: "2026-08-21T04:47:05.589Z"
  kind: "evidence"
  summary: "Comparison performed 2026-08-20 between `docs/git-providers.md` (the durable architecture record for the git-hosting layer, including the full `GitHostingService` method list and the GitHub versus Bitbucket Cloud capability matrix) and the 6 Bitbucket-targeting scripts in an audited 41-script operator corpus.\n\nThe layer's documented interface is: listPullRequests, listIssues, getPullRequest, getPullRequestCheckoutTarget, getCurrentPullRequestStatus, getPullRequestTimeline, searchIssuesAndPrs, createPullRequest, mergePullRequest, enable/disablePullRequestAutoMerge, getGitHubCheckDetails, isAuthenticated, plus the three account-level methods that bypass the router (listRepositories, listOwners, createRepository).\n\nNone of the five listed capabilities appears in that interface. The absence of a line-anchored comment write path was confirmed by reading the interface list rather than by grepping the implementation, so it is verified at the documented-architecture level and should be confirmed against `bitbucket-cloud-service.ts` and the GitHub adapter before any build.\n\nWhether the Bitbucket service already uses partial-response field selection was not checked and is stated here as an open question, not a defect.\n\nThe corpus scripts providing the comparison points cover: PR creation, PR fetch for review (metadata, diffstat, unified diff, single-file content at the source commit), PR lookup by branch, single inline or general comment posting with threaded-reply support, comment listing grouped by file and line, and an open-PR digest scoped to recently active repositories."
