---
id: "otto-brain-local-model-run-degenerated-into-an-unbounded-tool-call-announcement"
kind: "finding"
title: "Otto-brain local-model run degenerated into an unbounded tool-call announcement loop"
status: "proposed"
tags: ["brain", "local-model", "tool-calling", "run-loop", "reliability"]
created_at: "2026-08-17T00:33:52.758Z"
updated_at: "2026-08-17T01:33:00.938Z"
---

# Otto-brain local-model run degenerated into an unbounded tool-call announcement loop

<!-- compiled_truth -->

In session cf70dab5 (2026-08-17, provider `otto-brain`), after a long `dir /s /b node_modules` tool result, the local model stopped emitting structured tool calls entirely and produced ~840 consecutive 1-2-line text-only Assistant turns for 5+ minutes ("Going.", "I'll write them.", "Let me produce the three tool calls."), each re-announcing the same three intended tool calls (read_file repeat.d.ts, grep_search withRepeat, read_file brain-state-icon.tsx) without ever emitting them. A steering nudge ("Enough analysis. Write the complete answer now.") appears spliced into 14 long thoughts, suggesting the model began echoing a harness nudge. Nothing capped consecutive text-only turns, so the run only stopped when the user sent `/compact`. The fix it was verifying (ReduceMotion.Never on withRepeat in brain-state-icon.tsx) was actually applied correctly before the degeneration; verification was completed afterward: tsgo clean, oxlint 0/0, 42/42 brain tests pass.

## Timeline

- time: "2026-08-17T00:33:52.758Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-17T00:33:52.758Z"
  kind: "evidence"
  summary: "Uploaded transcript cf70dab5-880e-40a3-8927-47d017c443a1.md (5,335 lines): 880 Assistant vs 39 Tool vs 33 Thought entries; zero Tool entries after 00:19:07; burst from 00:19:39 to 00:24:42 at ~0.3-1.5s cadence; ends mid-word (\"I'll\") at user's /compact at 00:25:19."
- time: "2026-08-17T01:33:00.938Z"
  kind: "evidence"
  summary: "Correction from code-level forensics (2026-08-16): the burst was NOT ~840 consecutive text-only turns. It was ONE completion streaming for 5m40s. Evidence: (1) AGENT_STREAM_COALESCE_DEFAULT_WINDOW_MS = 60 in agent-stream-coalescer.ts - the daemon flushes streaming assistant text every ~60ms and each flush is its own timeline row, which chat-export.ts renders as a separate \"## Assistant\" block; the 80-160ms spacing between blocks is that window, not model latency. (2) The burst region (transcript lines 2400-5330, 00:19:39 to 00:25:19) contains 825 Assistant blocks and zero User, Tool, or Thought entries; only 2 User entries exist in the whole file, both outside the burst. (3) openai-compat-agent.ts runToolLoop returns on the first round yielding zero tool calls, so 825 tool-free rounds is structurally impossible. (4) streamCompletion sends no max_tokens (only the compaction call does), so a local llama-server generates until EOS or context exhaustion. Measured content volume in the burst: 66,384 characters, avg 80 chars per flush. The `maxToolRounds: 500` in the dev config.json is a red herring - the loop never reached round 2. Consequence for the fix: the daemon-wide stall guard (agent-stall-guard.ts) keys on messageId so a delta burst counts once, and openai-compat stamps one assistantMessageId per round - it reads 1 against this incident and would not have fired. The guard that catches this shape is the per-round assistant-text budget (maxRoundTextChars, default 32,000) added in openai-compat-agent.ts. The two are siblings: the counter catches a chain of messages that each stop without acting; the budget catches a single message that never stops at all."
  source: "Transcript cf70dab5-880e-40a3-8927-47d017c443a1.md re-analysis plus code read of agent-stream-coalescer.ts, chat-export.ts, openai-compat-agent.ts, session-stre"
