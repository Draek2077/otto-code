# Agent-to-agent flow tests

Otto can spawn agents that spawn agents, prompt each other, ask each other questions and hand back
answers. None of that is covered end to end. Every existing test exercises one hop: a tool call, a
single turn, a permission response. The failure found on 2026-07-28 lived in the seam between hops,
which is exactly where nothing was looking.

## The bug that prompted this

`send_agent_prompt` can report success for a prompt that never runs and is then thrown away.

1. The prompt arrives while the target agent is still finishing a turn, so it lands in the **steer
   queue** instead of dispatching.
2. The agent is archived or closed before that queue drains. The entry is **silently discarded** -
   no error, no notification to the sender, no dead letter.
3. The orphaned entry keeps rendering in the composer's send queue for an agent that no longer
   exists, which is how a human notices.

The tool returns `{"success":true,"status":"running"}` at _enqueue_ time. That is not a status, it
is a hope: the agent may be neither running nor ever going to run it. The snapshot evidence pattern
is `lastUserMessageAt` (prompt accepted), `archivedAt` a few seconds later, `lastError: null` -
accepted, then dropped, never failed.

Three or four orphans accumulated in a single session before anyone noticed, and the sender kept
reporting the work as in flight.

### Where it is

The drain is provider-agnostic and lives in `agent-manager.ts`, in run finalization:

```ts
const drainBatch =
  !shouldHoldBusyForReplacement && !terminalError && !mutableAgent.steerQueueHeld
    ? takeNextSteerQueueBatch(mutableAgent.steerQueue)
    : null;
```

It drains **at the end of a run**. An agent that never runs again never drains, and nothing
reconciles the queue when the agent goes away. `steerQueue: []` is initialised on the creation paths
and cleared nowhere on close or archive.

The attribution plumbing is _not_ the bug: `otto-tools.ts` correctly passes `source: "system"` so an
agent-to-agent prompt never merges into a user turn.

### Not yet established

Only ever observed in one session, and that session was also the first time agent-to-agent sends
were driven against a **local `openai-compatible` (qwen) agent**. Two variables changed at once. The
drain code above is provider-agnostic, which argues for a general bug, but whether Claude subagents
simply never sat in the queue long enough to hit it is unverified. **Establish this before fixing**,
because it decides whether the fix belongs in the shared lifecycle or in the openai-compat turn-end
path.

### The fix, in three independent parts

1. **Reconcile the steer queue when an agent closes or is archived.** Drain it or fail it, but never
   drop it silently.
2. **Make `send_agent_prompt` return the truth.** `StartAgentRunResult` already carries `queued` and
   `queuedMessageId`; the tool discards both and reports `status: "running"`. Surfacing them is the
   smallest change here and buys the most: a caller that knows it was queued can poll or resend, a
   caller told "running" cannot.
3. **Notify the sender when a queued entry is discarded**, so an agent-to-agent send fails loudly.

## The test method this needs

A harness for **complete flows between real agents**, not one hop at a time. It must be able to run
a scenario where two or more agents work on something while talking to each other, and assert on the
whole exchange rather than on individual calls.

The `mock` provider is the right vehicle and already has most of what is needed. It is a registered
provider with a real session lifecycle, it is deterministic, it costs nothing, and it already parses
prompt directives to trigger specific behaviours - including **asking questions**
(`MockQuestionPromptRequest` / `MockQuestionPromptQuestion`), which is what makes a question/answer
round trip testable without a model.

A scenario the harness must be able to express, and which would have caught the bug:

1. Agent A spawns agent B via `create_agent`.
2. A sends B a task with `send_agent_prompt` **while B is mid-turn**, so the prompt is queued rather
   than dispatched. This is the case nothing currently covers.
3. B asks a question; A answers it; B continues.
4. B finishes and A observes the completion.
5. Assert: every prompt A sent was either dispatched or explicitly reported as queued, the queue
   drained, and **nothing was silently dropped**. Then archive B mid-queue and assert the sender is
   told, rather than the entry evaporating.

Design notes worth honouring:

- **Drive it through the real MCP tool surface** (`create_agent`, `send_agent_prompt`,
  `respond_to_permission`), not by calling `AgentManager` directly. The bug was in the tool's
  reporting, which a manager-level test would have walked straight past.
- **Assert on the sender's view, not only the receiver's state.** "B eventually did the work" would
  have passed on some of the orphaned sends; "A was told the truth about what happened to its
  prompt" would not.
- **Cover the busy path deliberately.** An idle target dispatches immediately and exercises none of
  this. The queue is only reachable against a busy agent, so the harness needs a reliable way to
  hold an agent busy, which the mock provider's long-running stream models already provide.
- Tier placement and the coverage-matrix row belong in [docs/testing.md](../../docs/testing.md); add
  the row in the same change as the spec.

## Working around it until then

Verify the artifacts after every agent-to-agent send; never trust the return value. A file left
untouched plus a cheerful `success: true` is this bug, not a model that stopped early - an early
stop leaves work on disk with a truncated reply. Check `get_agent_status` for `status: "closed"` or
a non-null `archivedAt` before re-prompting, and respawn rather than boot when the agent is gone.
