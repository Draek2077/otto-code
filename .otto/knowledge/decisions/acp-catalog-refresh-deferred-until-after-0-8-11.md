---
id: "acp-catalog-refresh-deferred-until-after-0-8-11"
kind: "decision"
title: "Defer ACP catalog refresh until after 0.8.11"
status: "proposed"
tags: ["release","acp","catalog"]
created_at: "2026-08-20T03:41:14.180Z"
updated_at: "2026-09-04T01:35:11.909Z"
---
# Defer ACP catalog refresh until after 0.8.11

<!-- compiled_truth -->

The 12 stale package-runner pins reported by the 0.9.0 release preflight are intentionally deferred from the 0.9.0 stability release. They must be refreshed in a separately scoped follow-up rather than folded into this release as last-minute third-party catalog changes.

## Timeline

- time: "2026-08-20T03:41:14.180Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-20T03:41:14.180Z"
  kind: "evidence"
  summary: "On 2026-08-19, `npm run acp:version-drift:check` reported 12 stale pins; the user directed: “Can we wait until after the next release.”"
- time: "2026-09-04T01:35:11.909Z"
  kind: "decision"
  summary: "The user explicitly approved deferring the 12 stale ACP catalog pins from the 0.9.0 stability release. Status returned to proposed for review."
  source: "User direction, 2026-09-03."
