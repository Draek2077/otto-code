---
id: "otto-agentic-mcp-uses-task-chat-and-orchestration-language"
kind: "decision"
title: "Otto agentic MCP uses task, chat, and orchestration language"
status: "confirmed"
tags: ["orchestration","mcp","ux","terminology","compatibility"]
created_at: "2026-08-21T06:10:45.042Z"
updated_at: "2026-08-21T06:15:26.416Z"
---
# Otto agentic MCP uses task, chat, and orchestration language

<!-- compiled_truth -->

Otto’s agentic MCP vocabulary is lifecycle-first and distinct from harness-native terminology. `suggest_task` creates a deferred suggested-task card and does not start work. A `chat` is Otto’s active chat session; child relationships may exist internally but are described as child chats in Otto guidance. `start_orchestration` starts a managed multi-chat orchestration. Schedules start background chats; heartbeats send prompts and do not start chats. Public tool descriptions and Otto-enabled system guidance must explain these concepts together. The old MCP tool names are removed rather than retained as compatibility aliases. `list_personalities` remains the single personality discovery operation and gains multi-role filtering instead of a duplicate role-specific list tool.

## Timeline

- time: "2026-08-21T06:10:45.042Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-21T06:10:45.042Z"
  kind: "evidence"
  summary: "Explicit user direction, 2026-08-21: rename `spawn_task` to `suggest_task`; rename agent-management family to chat vocabulary; rename `start_run` / `get_run_status` to orchestration vocabulary; add role-filtered personality discovery without confusing duplicate operations; and embed shared terminology guidance whenever Otto tools are enabled. The user rejected the terms “worker” and reusing “run” for schedules."
- time: "2026-08-21T06:15:26.416Z"
  kind: "decision"
  summary: "The user explicitly rejected retaining old tool names: the rename is intended to remove the old vocabulary rather than preserve it as aliases."
  source: "Explicit user direction, 2026-08-21"
