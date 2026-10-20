---
id: "stall-detection-is-structural-not-text-based"
kind: "decision"
title: "Stalled runs are detected structurally, never by text analysis"
status: "proposed"
tags: ["agent-runtime", "reliability", "run-loop", "tool-calling", "provider-neutral"]
created_at: "2026-08-17T01:30:03.678Z"
updated_at: "2026-08-17T01:30:03.678Z"
---

# Stalled runs are detected structurally, never by text analysis

<!-- compiled_truth -->

Otto stops a stalled agent run by counting **consecutive assistant messages that produce no tool call**, and never by analysing what those messages say. Repeat-phrase matching and similarity/fuzzy-text scoring were explicitly rejected: a working model legitimately repeats itself, and a degenerate one can vary its wording indefinitely, so content is not a usable signal.

The invariant behind the count: a healthy agent turn either **acts** (emits a tool call) or **hands back** to the user. A message that does neither has no side effect on the world.

Two resets keep the guard off the back of real work, and both are structural:

- **Any tool call** resets the count to zero. A 200-turn investigation with a tool call every few messages can never trip it, however long it runs.
- **Any user prompt** resets the count to zero, so ordinary conversation (text-only by design) can never trip it. A _system-injected_ prompt (todo nudge, idle reconcile pass) is deliberately **not** a reset: that is the daemon talking to itself, and an automated re-prompt loop is precisely what the guard must remain able to see.

**The counter spans turns, by necessity.** In the daemon-owned tool loop (openai-compat / Otto Brain) a round that emits no tool call _ends the turn_ (`runToolLoop`: `if (toolCalls.length === 0) return`), so a per-turn counter would top out at 1 and never fire. A chain of turns and a chain of messages inside one turn are the same failure at two granularities; one cross-turn counter catches both.

**Home: `AgentManager`, not any provider.** The counting sits on the live stream every provider feeds, so it is provider-neutral by construction (`agent-stall-guard.ts` holds the pure rules; `AgentManager.observeStallGuard` wires them). It must be fed from **both** live paths: assistant messages and tool calls are coalescable and arrive through the stream coalescer's `onFlush`, not through `onStreamTimelineEvent`, which only sees the non-coalescable items such as `user_message`. History replay is deliberately excluded so replaying a stalled transcript cannot re-stop a healthy agent.

On trip the guard **latches** (cleared only by a tool call or a real user prompt), writes an `error` row naming the count and the setting, and stops the run through the ordinary `cancelAgentRun` path - not a crash.

Threshold: `agentBehaviors.stallGuardThreshold`, daemon-wide, default 15, `0` disables, clamped to [3, 500] so a hand-edited config cannot make it a hair trigger.

This is a third guard, distinct from the two per-turn ones in the daemon-owned tool loop, which are unchanged: `maxToolRounds` bounds model→tool→model rounds within a turn, and the action circuit breaker stops a tool call that keeps failing with identical arguments. Those catch an agent doing the wrong thing repeatedly; this one catches an agent doing nothing at all.

## Timeline

- time: "2026-08-17T01:30:03.678Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["otto-brain-local-model-run-degenerated-into-an-unbounded-tool-call-announcement","brain-coding-capabilities"]
- time: "2026-08-17T01:30:03.678Z"
  kind: "evidence"
  summary: "Motivating incident: session cf70dab5 (2026-08-17, provider `otto-brain`), recorded in [[otto-brain-local-model-run-degenerated-into-an-unbounded-tool-call-announcement]] - ~840 consecutive text-only assistant messages over 5+ minutes (00:19:39→00:24:42), each re-announcing three tool calls that were never emitted; the run only stopped when the user sent `/compact`, and nothing in the runtime noticed.\n\nStructural fact established while designing the fix: openai-compat's `runToolLoop` returns as soon as a round yields zero tool calls, and `maxToolRounds` defaults to 50. A stall of this shape therefore cannot be an unbounded round loop inside a single turn for that provider, which is why the counter had to span turns rather than reset per turn. The exact re-prompt driver behind the ~840 messages was not identified from the recorded finding alone.\n\nImplementation and verification (2026-08-16): `packages/server/src/server/agent/agent-stall-guard.ts` (pure rules), `AgentManager.observeStallGuard` wired from both the coalescer `onFlush` and `onStreamTimelineEvent`, config in `agentBehaviors.stallGuardThreshold` with `STALL_GUARD_*` constants in `packages/protocol/src/provider-config.ts`. Tests: `agent-stall-guard.test.ts` (12 cases: trips at threshold on a text-only stream; 200-round interleaved working stream never trips; reset on tool call; reset on user prompt; system-injected prompt does not reset; 500 deltas of one messageId count once; reasoning/todo/error do not split a message; latch behaviour; threshold 0 disables) and `agent-manager.stall-guard.test.ts` (4 wiring cases, including that the stop goes through `cancelAgentRun` and writes exactly one error row for 40 stalled messages). Green: 16/16 stall-guard tests, 312/312 across the affected server suites, protocol + server typecheck clean, oxlint 0/0 on the changed files.\n\nDocumented in `docs/chat-lifecycle.md` (\"The stall guard\") with a row in `docs/README.md`."
