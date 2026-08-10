---
id: "paseo-v031-upstream-integration"
kind: "requirement"
title: "Integrate the latest stable Paseo release"
status: "confirmed"
tags: ["upstream", "paseo", "integration", "v0-3-1"]
created_at: "2026-08-10T01:33:47.519Z"
updated_at: "2026-08-10T01:47:29.530Z"
---

# Integrate the latest stable Paseo release

<!-- compiled_truth -->

Otto must integrate Paseo v0.3.1 (`bfec7ac3`) from the v0.2.5 merge baseline (`6fc491e62`) on an isolated merge worktree. It must not merge the three post-v0.3.1 commits currently on upstream/main.

The integration has 205 upstream commits across 1,389 paths: 568 overlap with Otto, 19 delete/modify hazards, and 49 large hand-merge hotspots. Resolve against the v0.3.1 SHA or a namespaced upstream tag because Otto’s local `v0.3.0` and `v0.3.1` release tags collide with Paseo’s; fix `scripts/upstream-status.mjs` so it correctly identifies upstream releases in future.

Mandatory safeguards:

- Preserve Otto package versions; only `UPSTREAM_BASE_VERSION` becomes `0.3.1`.
- Retain the permanent Hub exclusion and prove no daemon runtime import reaches `server/hub/`.
- Preserve the provider-subagent split: accept upstream daemon ingestion/reliability fixes; retain Otto’s richer presentation and controls.
- Keep upstream Forge as the base while preserving Otto’s Bitbucket Cloud adapter and capability-driven UI.
- Apply all protocol changes additively, preserve old parsing in both directions, and generate validators before typechecking.
- Rebrand every merged upstream naming artifact, including new package/module names.
- Treat rebranding as semantic classification, never a blanket replacement. Paseo attribution, upstream references, legal notices, external project names/URLs, the About base indicator, and the marketing-site credit/sponsorship content must retain Paseo. Every remaining occurrence must be explicitly allowlisted with its reason; every other merged occurrence must be Otto.

Presentation is a first-class workstream. Integrate useful capabilities into Otto’s own model and hierarchy, not as a wholesale UI replacement. Evaluate global pure-black theme, status ring, history search, chat outline, shortcut overrides, sidebar display preferences, Command Center contributions, and HTML preview. The HTML preview must be reconciled with Otto’s existing Preview/browser-tools architecture rather than introducing a parallel browser stack.

Execution is gated: first create an isolated worktree, merge v0.3.1, resolve by subsystem, then verify targeted unit/browser/Playwright/desktop cases plus protocol, Hub, rebrand, typecheck, lint, and CI. Existing uncommitted work on main is out of scope and must remain untouched.

## Timeline

- time: "2026-08-10T01:33:47.519Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-10T01:33:47.519Z"
  kind: "evidence"
  summary: "User request on 2026-08-09 to update Otto to the latest Paseo. `git fetch upstream`, `scripts/upstream-status.mjs --verbose`, and upstream release tag inspection found v0.3.1 at bfec7ac3 (205 commits / 1,389 changed files after the v0.2.5 baseline). docs/upstream-merges.md sets the integration policy and standing Hub, forge, and subagent decisions."
- time: "2026-08-10T01:38:53.678Z"
  kind: "decision"
  summary: "The user specified the presentation integration strategy: examine Paseo's presentation changes and enhance Otto's existing presentation with applicable capabilities, rather than replacing it."
  source: "User statement, 2026-08-09"
- time: "2026-08-10T01:42:37.840Z"
  kind: "decision"
  summary: "The completed investigation established the stable target, quantitative merge surface, compulsory safeguards, and execution order."
  source: "Merge-readiness investigation, 2026-08-10"
- time: "2026-08-10T01:47:29.530Z"
  kind: "decision"
  summary: "The user identified prior false-positive rebranding, especially in website attribution, as a release-blocking risk."
  source: "User statement, 2026-08-09"
