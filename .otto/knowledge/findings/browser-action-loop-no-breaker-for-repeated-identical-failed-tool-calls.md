---
id: "browser-action-loop-no-breaker-for-repeated-identical-failed-tool-calls"
kind: "finding"
title: "Browser action loop: no breaker for repeated identical failed tool calls"
status: "proposed"
tags: ["brain", "openai-compat", "tool-loop", "reliability", "browser"]
created_at: "2026-08-15T17:51:24.528Z"
updated_at: "2026-08-15T17:51:24.528Z"
---

# Browser action loop: no breaker for repeated identical failed tool calls

<!-- compiled_truth -->

The openai-compat tool loop executes every tool call the model emits in a round with no per-call failure budget. When a small local model degenerates (Qwen3.8-27B, session "Session resume" d231e037, 2026-08-15), it can emit the same invalid browser_navigate({}) call in the thousands within one round; each call fails zod validation with a ~600-char JSON error, all of which is appended verbatim to messages, until the next request exceeds the context window (491964 > 401408) and the turn fails. Auto-compaction could not recover because the retained tail was dominated by the repeated identical errors. The agent then sits in error/idle state while the timeline shows thousands of browser actions - the brain is idle because the model finished generating; the loop is tool execution, not generation.

## Timeline

- time: "2026-08-15T17:51:24.528Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-15T17:51:24.528Z"
  kind: "evidence"
  summary: "Persisted session ~/.otto/agents/C-Users-phili-Projects-otto-code/d231e037-\*.json: 2993 messages, browser_navigate called 2912 times, all with arguments \"{}\"; every tool result is the same zod error (url and browserId required); lastError is the exceed_context_size 400 from llama.cpp; runToolLoop in packages/server/src/server/agent/providers/openai-compat-agent.ts has no repetition breaker, and maxToolRounds (default 50) caps rounds, not calls per round."
