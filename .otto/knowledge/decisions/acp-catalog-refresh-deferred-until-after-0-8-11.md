---
id: "acp-catalog-refresh-deferred-until-after-0-8-11"
kind: "decision"
title: "Defer ACP catalog refresh until after 0.8.11"
status: "confirmed"
tags: ["release","acp","catalog"]
created_at: "2026-08-20T03:41:14.180Z"
updated_at: "2026-08-20T03:41:14.180Z"
---
# Defer ACP catalog refresh until after 0.8.11

<!-- compiled_truth -->

The 12 stale package-runner pins found by the 0.8.11 release preflight are intentionally deferred until after the 0.8.11 stable release. They must not be folded into that release as last-minute catalog changes.

## Timeline

- time: "2026-08-20T03:41:14.180Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-20T03:41:14.180Z"
  kind: "evidence"
  summary: "On 2026-08-19, `npm run acp:version-drift:check` reported 12 stale pins; the user directed: “Can we wait until after the next release.”"
