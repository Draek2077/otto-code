---
id: "a-failed-git-measurement-is-never-reported-as-a-non-git-checkout"
kind: "requirement"
title: "A failed git measurement is never reported as a non-git checkout"
status: "proposed"
tags: ["git","checkout-status","reliability"]
created_at: "2026-08-19T02:42:53.955Z"
updated_at: "2026-08-19T02:42:53.955Z"
---
# A failed git measurement is never reported as a non-git checkout

<!-- compiled_truth -->

`isGit` is the single switch the entire Git and PR control cluster hangs off, so it must only ever answer the question "is this a repository", never "did the measurement succeed". A checkout status payload whose measurement failed carries `error` with a code other than `NOT_GIT_REPO`, and both client doors (the fetch in `fetchCheckoutStatus` and the push in `applyCheckoutStatusUpdateFromEvent`) must refuse it rather than cache it, keeping the last known-good status and retrying. On the daemon, the worktree-root probe that decides `isGit` throws on a failed measurement and returns null only when git says not-a-repository or the directory no longer exists.

## Timeline

- time: "2026-08-19T02:42:53.955Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-19T02:42:53.955Z"
  kind: "evidence"
  summary: "Diagnosed from a report that the workspace Git status and the whole Git/PR tool menu vanished after a fetch or update, and stayed gone.\n\nChain, all verified in code at 0.8.10:\n1. `packages/server/src/utils/checkout-git.ts` `getWorktreeRoot` swallowed every failure into `null`, so `getCheckoutSnapshotFacts` returned `{ isGit: false }` for a timeout, a spawn failure, or a corrupt gitfile just as it did for a plain directory.\n2. `packages/server/src/server/session/checkout/checkout-session.ts` `handleStatusRequest` answers any thrown error with a well-formed `isGit: false` payload plus `error`, because the wire shape has no third state.\n3. `packages/app/src/git/policy.ts:196` returns `{ primary: null, secondary: [], menu: [] }` for a non-git checkout, and `packages/app/src/git/actions-split-button.tsx:166` unmounts the button entirely. The PR status query is gated on the same `isGit`, so PR actions go with it.\n4. `packages/app/src/git/use-status-query.ts` caches that answer with `staleTime: Infinity`, `refetchOnReconnect: false`, and `refetchOnWindowFocus: false`. Freshness is push-only, so a single bad measurement was cached as truth for the life of the app.\n\nThe daemon half self-heals within a second (`WORKSPACE_GIT_FACTS_REUSE_TTL_MS` is 1000ms); the client cache was the half that made it permanent. Fetch is the trigger because it forces a fresh measurement and runs `git fetch` through the same 8-slot limiter and 30s command timeout as the status reads.\n\nRegression coverage: `packages/app/src/git/checkout-status-cache.test.ts` (rejects a failed measurement, accepts `NOT_GIT_REPO`, ignores a failed push) and `packages/server/src/utils/checkout-git.test.ts` (non-git directory and deleted directory still answer `isGit: false`; a corrupt gitfile throws)."
