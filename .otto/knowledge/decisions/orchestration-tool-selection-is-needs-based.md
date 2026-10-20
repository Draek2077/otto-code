---
id: "orchestration-tool-selection-is-needs-based"
kind: "decision"
title: "Orchestration tool selection is needs-based"
status: "confirmed"
tags: ["agent-orchestration", "prompt-design", "tool-selection"]
created_at: "2026-08-13T06:09:56.566Z"
updated_at: "2026-08-13T06:11:24.659Z"
---

# Orchestration tool selection is needs-based

<!-- compiled_truth -->

Agents choose direct work, `create_agent`, `spawn_task`, and `start_workflow` only when the task needs that tool's specific capability. `start_workflow` is reserved for declared multi-agent plans requiring daemon-managed fan-out, gathering, judging, loops, or approval gates; it is not the default merely because orchestration tooling is available.

## Timeline

- time: "2026-08-13T06:09:56.566Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["agent-orchestration"]
- time: "2026-08-13T06:09:56.566Z"
  kind: "evidence"
  summary: "Product-owner direction in chat on 2026-08-13: tools should be used for the appropriate tasks rather than runs being favored in language and prompt context. Implemented in `packages/protocol/src/agent-personalities.ts` and documented in `docs/agent-personalities.md` and `docs/agent-teams.md`."
- time: "2026-08-13T06:11:24.659Z"
  kind: "evidence"
  summary: "The `start_run` MCP tool description in `packages/server/src/server/agent/tools/otto-tools.ts` now describes its required capabilities and explicitly excludes discrete work suited to direct execution or one dedicated agent. Protocol and server typechecks, targeted lint, and the protocol role-directive test pass."
  source: "Implementation verification on 2026-08-13"
