---
id: "agentic-tool-evaluation-covers-existing-chat-handoffs"
kind: "requirement"
title: "Agentic tool evaluation covers existing-chat handoffs"
status: "proposed"
tags: ["orchestration","agentic-mcp","evaluation","inter-agent-communication"]
created_at: "2026-08-21T14:35:19.869Z"
updated_at: "2026-08-21T14:35:19.869Z"
---
# Agentic tool evaluation covers existing-chat handoffs

<!-- compiled_truth -->

The live Otto tool-selection evaluator must test English-prose delegation across named, pre-existing chats: a conductor discovers a research chat, prompts it, waits for it, and the research chat discovers and prompts an execution chat. The report must preserve each chat’s tool trace and identify the failed hop, so tool-language regressions can be distinguished from generic model failures.

## Timeline

- time: "2026-08-21T14:35:19.869Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["otto-agentic-mcp-uses-task-chat-and-orchestration-language"]
- time: "2026-08-21T14:35:19.869Z"
  kind: "evidence"
  summary: "User request, 2026-08-21: test the three-chat collaboration use case used in a TMUX/Claude Code split, including research launched in an existing chat and execution launched by that research chat. Implemented as the costly `existing-chat-research-handoff` scenario in `packages/server/scripts/evaluate-otto-tool-selection.ts`; it has not yet been run against live profiles."
