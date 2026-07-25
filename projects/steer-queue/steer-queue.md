# Charter: Queued steering messages

**Status:** **SHIPPED 2026-07-25** (uncommitted at time of writing). Phases 1 and 2 are
built end to end; Phase 3 is decided rather than deferred, except the two tail items in
[Remaining](#remaining) below. Durable semantics are folded into
[docs/chat-lifecycle.md](../../docs/chat-lifecycle.md#delivery--how-a-prompt-reaches-a-busy-agent)
and [docs/glossary.md](../../docs/glossary.md) — **those are the source of truth now**;
this file is kept only for the open tail.

## Why (unchanged — this is what shipped)

Otto already let you **interrupt-and-steer** a running agent without killing it, and
`cancel_agent` was the interrupt-only variant. The missing mode was the **non-interrupting
queued nudge**: "let it finish what it's doing, then hand it this next thing." Every
prompt to a busy agent clobbered the current turn.

## What shipped

**Delivery mode.** `startAgentRun` / `sendPromptToAgent` take
`delivery: "interrupt" | "queue"`. `interrupt` is the default everywhere, so no existing
caller changed behavior. Against an idle agent both modes run the prompt immediately —
"queue" means "don't interrupt", not "wait".

**Provider-neutral by construction.** The whole feature lives in the turn lifecycle
(`AgentManager`) above every provider adapter. There are no per-provider adapters; Claude,
Codex, Copilot, OpenCode, Pi and openai-compat all got it in the same commit.

| File                                | What it owns                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| `server/agent/steer-queue-state.ts` | `SteerQueueEntry`, batch selection, merge, preview, prompt↔parts — all pure, all unit-tested      |
| `server/agent/agent-manager.ts`     | `steerQueue` + `pendingSteerDrain` on `ManagedAgent`; enqueue / drain / remove / clear            |
| `server/agent/agent-prompt.ts`      | `delivery` + `source` threading; `StartAgentRunResult.queued` / `queuedMessageId`                 |
| `server/agent/lifecycle-command.ts` | `cancelAgentRunCommand` clears the queue — one "stop everything" verb                             |
| `server/agent/tools/otto-tools.ts`  | `delivery` arg on `send_agent_prompt`; agent-to-agent sends are `source: "system"`                |
| `protocol/messages.ts`              | `delivery` on the send request; `queuedMessages` on the snapshot; `agent.queue.remove` / `.clear` |
| `app/composer/queue.ts`             | `useComposerQueue` — daemon-backed or client-held, one interface either way                       |
| `cli/commands/agent/send.ts`        | `otto agent send --queue`                                                                         |

**Race safety.** The drain decision is synchronous inside `finalizeForegroundTurn`, before
the state emit; `enqueueSteerMessage` reads lifecycle synchronously to choose
dispatch-now vs buffer; `pendingSteerDrain` holds the agent visibly `running` across the
async handoff (mirroring `pendingReplacement`), so a message sent in that window is
buffered rather than raced into a second turn. If something else claims the turn slot
while the drain awaits the previous run's cleanup, the batch goes back at the head.

**On terminal error or `closed`:** hold, don't drain. A queued turn must never run
unprompted into a broken session.

## Decisions taken (the Open questions are now closed)

- **Multiple queued messages → MERGE.** Consecutive **user** entries are delivered as one
  turn, joined FIFO with a blank line; images/attachments concatenate; the head entry's
  `runOptions` (including `messageId`) win. This resolves the registry's separate "Queued
  messages should merge into one send" item. Rationale: three notes dropped while an agent
  grinds through a refactor are one instruction set, not three turns — separate turns make
  it act on note 1 before it has seen the constraint in note 3, and pay a full context
  re-send each time. The original charter leaned "separate FIFO turns"; that was wrong on
  both correctness and cost.
- **System-injected entries never merge.** `source: "system"` (mentions, schedule fires,
  notify-on-finish, agent-to-agent sends) each carry their own envelope and mean something
  on their own.
- **Error/closed while queued → hold and surface** (as leaned).
- **`cancel_agent` clears the queue** (as leaned). Interrupt-and-steer does **not** —
  those queued notes are separate instructions, not part of the turn being replaced.
- **System-injected prompts keep `delivery: "interrupt"`.** They are now _tagged_
  `source: "system"` so the queue never merges them, but flipping their default is a
  behavior change to existing paths and stays explicitly out of scope. See
  [Remaining](#remaining).
- **Envelope:** confirmed — queued user steering delivers as a normal user turn; callers
  keep their existing envelope choice.

## Client surface

`server_info.features.steerQueue` gates it (`COMPAT(steerQueue)`, v0.6.8). With it the
composer's Queue track is daemon-backed: sends carry `delivery: "queue"`, rows render from
`AgentSnapshotPayload.queuedMessages`, and Edit / Send now go through
`agent.queue.remove`. Without it the composer keeps its own client-held queue drained on
the running→idle edge — the behavior Otto has always had, **not** a degraded build of the
daemon feature. Both live behind one interface (`useComposerQueue`), so the capability
check happens in exactly one place.

The user-facing choice already existed: Settings → **Default send** is `Interrupt` /
`Queue`, and the composer's alternate send action does the other one. Those labels match
the wire enum exactly, so no new vocabulary was introduced.

Attachments only ever exist client-side. The daemon-backed path keeps a local sidecar
keyed by the daemon's entry id purely so Edit can put them back in the box; losing it
(reload, other device) costs the attachments on edit, nothing else.

## Tests

`server/agent/steer-queue.test.ts` — 13 tests: merge + FIFO order, system entries never
merging, images/attachments carried through, preview truncation, queued-while-running
drains on turn end, **no `idle` ever emitted between the finished turn and the queued
one**, several messages delivered as one turn, enqueue-while-idle runs immediately,
interrupt still clobbers, a failed turn holds the queue, remove, clear.

## Remaining

Not blocking; nothing else depends on them.

- **Reorder queued entries.** Preview and per-item removal shipped; drag-to-reorder did
  not. No UI affordance exists for it yet.
- **Consume the Claude interrupt receipt.** SDK ≥ 0.3.212 resolves `query.interrupt()` to
  `{ still_queued: string[] }` (feature-detected via `interrupt_receipt_v1` in
  `system/init`), already captured and debug-logged as
  `provider.claude.interrupt.still_queued` in `claude/agent.ts`. Otto's queue is
  daemon-owned and is the source of truth for every provider including Claude, so nothing
  is wrong today — reconciling against the receipt would only tighten the Claude case.
- **Should system-injected prompts queue by default?** Deliberately left as `interrupt`.
  It is the strongest correctness argument for the feature (a chat @mention interrupting a
  running turn is arguably a bug), but it changes existing behavior on paths nobody asked
  to change. Decide it on its own, not as a side effect of this charter.

Delete this folder once the three above are decided or done.
