---
id: "git-fetch-control"
kind: "requirement"
title: "Git fetch is host-configurable with a manual workspace action"
status: "confirmed"
tags: ["git","workspaces","host-settings","developer-experience"]
created_at: "2026-08-14T16:22:59.474Z"
updated_at: "2026-08-20T06:58:11.132Z"
---
# Git fetch is host-configurable with a manual workspace action

<!-- compiled_truth -->

Otto provides a Host Settings → Workspaces Git-fetch policy: automatic fetch of active workspaces can be enabled or disabled globally for the Host and, when enabled, uses a controlled interval. Workspace Git tools always expose a manual Fetch action for Git workspaces with an origin remote. Automatic and manual fetches for the same repository share one in-flight operation, so they never create concurrent Git fetch processes.

## Timeline

- time: "2026-08-14T16:22:59.474Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-14T16:22:59.474Z"
  kind: "evidence"
  summary: "User direction on 2026-08-14 after a developer tester reported unwanted automatic fetches. Current implementation performs `git fetch origin --prune` immediately and every three minutes for active workspaces with origin."
- time: "2026-08-14T16:39:28.825Z"
  kind: "evidence"
  summary: "Implemented daemon-owned Git fetch policy with default enabled / 180-second interval, persisted in mutable daemon config and applied live to the workspace Git service. Added a capability-gated Fetch action to workspace Git tools, shared in-flight fetch coordination, and host Settings controls. Verified with `npx vitest run packages/server/src/server/workspace-git-service.test.ts --bail=1` (28 passed, 1 skipped), `npx vitest run packages/app/src/git/policy.test.ts --bail=1` (48 passed), app and server typechecks, targeted lint, and `npm run build:server`."
  source: "Implementation verification, 2026-08-14"
- time: "2026-08-20T06:58:11.132Z"
  kind: "evidence"
  summary: "Audited reported automatic fetch after the Host Settings policy was disabled. `setFetchPolicy` cleared registered timers, but a callback already queued by the event loop could still enter `runBackgroundRepoFetch` and start `git fetch`. The background entry point now rechecks the live enabled policy and active-workspace ownership before fetching; manual fetch remains unchanged. Added a focused queued-callback regression case in `packages/server/src/server/workspace-git-service.test.ts`. Focused Vitest (29 passed, 1 skipped), repository typecheck, targeted lint, and format passed."
  source: "Implementation verification, 2026-08-20"
