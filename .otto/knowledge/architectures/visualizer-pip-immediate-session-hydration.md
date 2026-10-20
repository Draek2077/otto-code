---
id: "visualizer-pip-immediate-session-hydration"
kind: "architecture"
title: "Visualizer PIP registers a session before timeline backfill"
status: "proposed"
tags: ["visualizer", "pip", "hydration", "chat-switching"]
created_at: "2026-08-09T14:32:29.763Z"
updated_at: "2026-08-09T14:32:29.763Z"
---

# Visualizer PIP registers a session before timeline backfill

<!-- compiled_truth -->

The Visualizer adapter must publish a tracked chat's `session-started` message and root `agent_spawn` immediately after reconciliation, before awaiting the timeline backfill. This lets the PIP select a registered session promptly and avoids an empty renderer while slower history hydration continues in a subsequent hydrated batch.

## Timeline

- time: "2026-08-09T14:32:29.763Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-09T14:32:29.763Z"
  kind: "evidence"
  summary: "Observed user report 2026-08-09: some PIP chat switches showed 0 agents and “Waiting for agent activity”, with a long delay. Implementation and regression test: packages/app/src/visualizer/use-visualizer-event-adapter.ts and use-visualizer-event-adapter.test.tsx."
