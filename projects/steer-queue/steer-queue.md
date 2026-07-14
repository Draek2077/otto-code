# Charter: Queued steering messages

**Status:** Not started — charter drafted 2026-07-13.
**Lineage:** Extends the existing agent-coordination surface (`send_agent_prompt`, `cancel_agent`) in
[otto-tools.ts](../../packages/server/src/server/agent/tools/otto-tools.ts) and the turn lifecycle in
[agent-manager.ts](../../packages/server/src/server/agent/agent-manager.ts). Sibling in spirit to the
shipped subagents-cleanup work (folded into [docs/agent-lifecycle.md](../../docs/agent-lifecycle.md#the-subagents-track))
— legibility + control over agents you're supervising, not new agent kinds.

## Why

Otto already lets you **interrupt-and-steer** a running agent without killing it: `send_agent_prompt`
routes through `sendPromptToAgent` with `replaceRunning: true`, which calls `replaceAgentRun`
([agent-manager.ts:2272](../../packages/server/src/server/agent/agent-manager.ts:2272)) — cancel the
in-flight turn, immediately start the new prompt **in the same provider session** (history/context
intact, process alive). `cancel_agent` is the interrupt-only variant ("abort the current run but keep
the agent alive").

The missing mode is a **non-interrupting queued nudge**: "let it finish what it's doing, then hand it
this next thing." Today every prompt to a busy agent clobbers the current turn — there is no way to
say _append this as the next turn_. That's the gap the user asked to close.

Concrete motivating cases:

- **Supervising a long turn.** You're watching an agent grind through a refactor and think of a
  follow-up constraint. You want it applied next, not to blow away the turn in progress.
- **Batching guidance.** Drop two or three steering notes while it works; they run in order once it's
  free.
- **System-injected prompts that shouldn't clobber.** Chat @mentions, schedule fires, and
  notify-on-finish all currently go through `sendPromptToAgent` → `replaceRunning: true`
  ([agent-prompt.ts:200](../../packages/server/src/server/agent/agent-prompt.ts:200)). A mention
  interrupting a running turn is arguably a bug; queue-by-default would fix it (see Open questions).

## Design

One new delivery mode layered onto the existing send path. `send_agent_prompt` gains a `delivery`
selector:

| `delivery`  | Busy target                                                    | Idle target       |
| ----------- | -------------------------------------------------------------- | ----------------- |
| `interrupt` | cancel current turn, run now (**today's behavior — default**)  | run now           |
| `queue`     | buffer as the next turn; drain when the turn finalizes to idle | run now (no wait) |

`interrupt` stays the default so existing behavior and callers are unchanged.

**The whole feature lives above the provider, in the turn lifecycle** — so it's provider-agnostic for
free. No per-provider adapters, unlike observed-subagents. Same code path steers Claude, Codex,
OpenCode, openai-compat, and any future provider identically. Strong fit for the fork mission.

### Where it hooks

- **Queue state (per agent).** A FIFO buffer of `{ prompt, runOptions, enqueuedAt, source }` on the
  managed agent, owned by `AgentManager` alongside `foregroundRuns`. Either a field on `ManagedAgent`
  or a small sibling to
  [foreground-run-state.ts](../../packages/server/src/server/agent/foreground-run-state.ts)
  (`steer-queue-state.ts`) — prefer the sibling so the queue's invariants are testable in isolation.
- **Enqueue.** New `AgentManager.enqueueSteerMessage(agentId, prompt, options)`. If the agent is idle
  _synchronously at enqueue time_, dispatch immediately (`streamAgent`) — the degenerate "no wait
  needed" case. Otherwise push onto the buffer.
- **Drain.** In `finalizeForegroundTurn`
  ([agent-manager.ts:2229](../../packages/server/src/server/agent/agent-manager.ts:2229)): today it
  computes `nextLifecycle = "idle"` when there's no error and no pending replacement. Insert a check
  **before** emitting idle — if the queue is non-empty and there's no terminal error, pop the head and
  dispatch it as the next turn instead of going idle. Reuse the exact `shouldHoldBusyForReplacement`
  pattern (`pendingReplacement` holds lifecycle at `running` across the handoff) so the row never
  flickers idle→running between queued turns.
- **Send-path plumbing.** `sendPromptToAgent` / `startAgentRun`
  ([agent-prompt.ts](../../packages/server/src/server/agent/agent-prompt.ts)) gain a `delivery`
  option. `queue` calls `enqueueSteerMessage` instead of setting `replaceRunning: true`. Every surface
  (WS/Session, MCP, CLI, chat mentions, notify-on-finish) already funnels through this one function —
  so the mode is available everywhere the moment it's wired, and behavior can't drift.
- **Tool arg.** `send_agent_prompt` in
  [otto-tools.ts:2064](../../packages/server/src/server/agent/tools/otto-tools.ts:2064) gains
  `delivery: z.enum(["interrupt", "queue"]).optional().default("interrupt")`, with a description that
  spells out interrupt-vs-queue so the model picks correctly.

### Race safety

The enqueue/drain boundary is the only sharp edge. JS is single-threaded, so both the
`finalizeForegroundTurn` drain check and the `enqueueSteerMessage` lifecycle check run to completion
without interleaving; the risk is only across `await` points once dispatch (`streamAgent`) goes async.
Mitigations:

- Drain decision is **synchronous** inside `finalizeForegroundTurn`, before `emitState`.
- Enqueue reads lifecycle **synchronously** to choose dispatch-now vs buffer.
- A `pendingSteerDrain` hold flag (mirroring `pendingReplacement`) keeps the agent `running` during
  the async handoff, so a message enqueued in that window is buffered (agent looks busy), not raced
  into a second concurrent turn.
- On **terminal error**, do **not** auto-drain into a broken session — hold the queue, surface it, let
  the supervisor decide (see Open questions). Same for `closed`.

### Visibility & control

- **Protocol (additive).** `queuedMessageCount?: number` on the agent snapshot in
  [messages.ts](../../packages/protocol/src/messages.ts) — additive `.optional()` leaf per the
  protocol contract, no capability gate, old clients ignore it. Optionally a small `queuedPreviews?:
string[]` (first N chars each) for a hover/expand.
- **Row surface.** A "1 queued" badge on the agent/subagent row; tap to expand/clear. Mirrors the
  subagents-cleanup row-action pattern.
- **Clear.** Need a way to drop queued items. Options: fold into `cancel_agent` (stopping the agent's
  planned work clears its queue) plus a dedicated `clear_agent_queue` / per-item removal. Lean:
  `cancel_agent` clears the queue **and** aborts the run (one "stop everything" verb), with a distinct
  tool for surgical queue edits later.

## Build sequence

**Phase 1 — daemon core (provider-agnostic).**

1. `steer-queue-state.ts` FIFO buffer + `ManagedAgent` wiring + `pendingSteerDrain` flag.
2. `AgentManager.enqueueSteerMessage` (dispatch-now-if-idle, else buffer).
3. Drain in `finalizeForegroundTurn` with the `shouldHoldBusyForReplacement`-style hold.
4. `delivery` option threaded through `startAgentRun` / `sendPromptToAgent`.
5. `delivery` arg on the `send_agent_prompt` tool. `interrupt` default → zero behavior change.
6. `cancel_agent` clears the queue.
7. Tests in `agent-manager.test.ts`: enqueue-while-running drains on idle; enqueue-while-idle runs
   immediately; FIFO order across multiple; interrupt path unchanged; error turn holds (doesn't drain)
   the queue; the enqueue-at-idle-boundary race. Context preserved across queued turns (same session).

**Phase 2 — protocol + client surface.** 8. `queuedMessageCount?` (+ optional previews) on the snapshot protocol + projection. 9. Row badge + clear action; send-UI delivery toggle (Interrupt vs Queue) shown when the target is
running. Trace the client @mention/composer send path to place the toggle. 10. CLI parity (`packages/cli`) if the send command exposes delivery.

**Phase 3 — polish / decisions.** 11. Coalesce-vs-separate-turns for multiple queued messages (default: separate FIFO turns). 12. Reorder / preview / per-item removal. 13. Decide + wire whether system-injected prompts (mentions, schedule fires, notify-on-finish) switch
to queue-by-default.

## Open questions

- **Multiple queued messages:** deliver as separate FIFO turns (predictable, simplest) or coalesce
  into one turn? Lean separate.
- **Error/closed while queued:** hold and surface (lean) vs auto-drain vs auto-clear. A queued turn
  shouldn't run into a broken session unprompted.
- **System-injected prompts default:** should @mentions / schedule fires / notify-on-finish queue
  instead of interrupt? It's the strongest correctness argument for the feature, but it's a
  behavior change to existing paths — gate it explicitly, don't fold it silently into Phase 1.
- **Envelope:** queued user steering delivers as a normal user turn (no `<otto-system>` wrapper);
  agent-to-agent queued sends keep the caller's existing envelope choice. Confirm.

## Cross-cutting

- **Protocol contract:** the one new snapshot field is an additive optional leaf — no gate, no
  fallback. The `delivery` tool arg is per-daemon (MCP schema is served by the daemon), so a client
  talking to an older daemon simply won't see the arg; no wire-compat concern.
- **Provider parity (fork mission):** because the queue lives in the turn lifecycle above the
  provider, it ships for **all** providers at once in Phase 1 — no observed→native→rest rollout.
- **Rebuild:** Phase 1/2 touch the daemon → `npm run build:server` + daemon restart to serve.
- **Fold-in on ship:** fold the durable "interrupt vs queue" delivery semantics into
  [docs/agent-lifecycle.md](../../docs/agent-lifecycle.md) (turn lifecycle / steering section), then
  delete this folder.
