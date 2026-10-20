---
id: "orchestration-tool-language-collides-across-agent-task-and-spawn"
kind: "finding"
title: "Orchestration tool language collides across agent, task, spawn, and create"
status: "proposed"
tags: ["orchestration","ux","tooling","terminology"]
created_at: "2026-08-21T02:33:35.495Z"
updated_at: "2026-08-21T02:33:35.495Z"
---
# Orchestration tool language collides across agent, task, spawn, and create

<!-- compiled_truth -->

The current orchestration vocabulary makes it difficult to distinguish immediate agent execution from deferred task creation. `spawn_agent` starts a child agent immediately, `create_agent` starts an Otto-managed agent, and `spawn_task` creates a user-actionable task card without starting work. Because collaboration tools are presented before Otto MCP tools for Codex and likely other provider harnesses, familiar early-listed verbs can overshadow the intended Otto action. The product should use distinct user-facing verbs and descriptions that make object and lifecycle explicit: agent/chat versus task card, and start now versus suggest for later.

## Timeline

- time: "2026-08-21T02:33:35.495Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-21T02:33:35.495Z"
  kind: "evidence"
  summary: "User feedback, 2026-08-20: “you can't tell whats an agent, whats a task, whats a spawn whats a create”; collaboration catalog appears first in Codex/Claude-like harnesses, making the terminology competition material. Observed tool contracts: `collaboration.spawn_agent` immediately launches a child; `mcp__otto__create_agent` immediately launches an Otto agent; `mcp__otto__spawn_task` creates a deferred task card."
