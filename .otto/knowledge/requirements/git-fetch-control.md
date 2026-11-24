---
id: "git-fetch-control"
kind: "requirement"
title: "Git fetch is host-configurable with a manual workspace action"
status: "confirmed"
tags: ["git","workspaces","host-settings","developer-experience"]
created_at: "2026-08-14T16:22:59.474Z"
updated_at: "2026-11-12T17:53:31.884Z"
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
- time: "2026-11-12T17:53:31.884Z"
  kind: "evidence"
  summary: "2026-11-12 Otto 0.10 safe-addition checkpoint at pushed otto-0.10/phase-0 commit e9cc4d3ed3f7bb9cd88e751dad2f147947561f14.\n\nPhilippe's CI-first gate was satisfied at 2b6db984ec8175ff8fd3ac679e36e87a0cdaef70 (full CI 43237843713, 21/21; app acceptance 43237819422, 88/88; editor acceptance 43237819400). Only then was the confirmed Git-fetch-control requirement restored. Current Host Settings > Workspaces has explicit-save automatic-fetch/interval controls; manual Fetch is in existing workspace Git menus and Command Center, including the existing compact Changes toolbar. Old 0.9 daemon.gitFetch preferences and unknown data are preserved without rewriting legacy files. Both manual and automatic work reuse Paseo's Git service/helper and canonical common-directory single-flight ownership. A queued automatic admission rechecks current policy and active workspace ownership immediately before Git starts; manual Fetch remains repeatable after success and exposes failure until explicit retry. The reserved host RPC loads no extra plugin worker. No new idle polling, chat/session/transcript/memory owner, chat rendering or provider-startup customization was introduced. docs/otto-workspace-git.md and its indexed coverage describe the contract; Otto implementation is separate with marked base seams.\n\nFinal exact-source full CI https://github.com/Draek2077/otto-code/actions/runs/43266928686 passed 21/21 jobs. Full app acceptance https://github.com/Draek2077/otto-code/actions/runs/43266923452 passed 46+44=90 journeys without retries. Editor/runtime acceptance https://github.com/Draek2077/otto-code/actions/runs/43266923668 passed. Dedicated wide/compact Git journeys https://github.com/Draek2077/otto-code/actions/runs/43266935022 passed 2/2: isolated real host/RPC and file origin, inherited opt-out, explicit settings Save, conflicting peer revision and confirmed Reload, real remote-ref advancement, visible failed Fetch and explicit recovery, repeatable success and Command Center execution. Screenshots were inspected for existing layout gutters/controls. Normal format/lint and all-workspace typechecks passed through normal hooks. Changed native observation integration passed 3/3 locally; Artifact service passed 32/32 after waiting for the generation's exposed transaction lock before a single data edit. Pure Git control/store/host/service/form/action/boundary fixtures passed their focused checks; unchanged successful fixtures were not repeated.\n\nThe macOS observation CI job now runs its native stress fixtures serially, retaining all concurrency within each fixture, all assertions and original liveness deadlines. It passed 83/83 cases across seven files. Test interference was an investigation hypothesis, not a proven production FSEvents root cause; no speculative native backend fix or assertion removal was added. Failure diagnostics now retain per-subscription events, starts and warnings.\n\nBuild-only matrix: desktop https://github.com/Draek2077/otto-code/actions/runs/43259974266 passed Windows/Linux, both unsigned macOS architectures and installed-Linux smoke; Android https://github.com/Draek2077/otto-code/actions/runs/43259981391 passed verified APK+AAB (both artifacts retained); Docker https://github.com/Draek2077/otto-code/actions/runs/43259989196 and Nix https://github.com/Draek2077/otto-code/actions/runs/43259997336 passed. These builds use 9538f3d8fdcb794ddbee5980af5019bc743f2d99. Git comparison with final head shows differences only in CI configuration, docs and E2E/unit fixtures: identical production/packaging inputs, not a rebuild of the final test-only SHA. Publishing was disabled; existing iOS signing gate remains accepted.\n\nNo local app/daemon/model launch, installed-Otto change, main landing, public release, new agent/worktree, unrelated cleanup or deferred feature restoration occurred. Employer-specific remote access and physical-device interaction remain user/environment acceptance. F22 provider-only older-history recovery and the separate parked Context isolation investigation remain open. Overall Phase 1 and phase-level 1/3 progress stay open; this closes only the bounded implementation/verification checkpoint, ready for Philippe's product review."
  source: "https://github.com/Draek2077/otto-code/commit/e9cc4d3ed3f7bb9cd88e751dad2f147947561f14"
  affects: ["otto-0-10-clean-paseo-rebuild"]
