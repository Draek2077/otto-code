# Observed subagents

**Status:** design / charter. Not yet implemented. Claude is the first proof; the model is deliberately provider-agnostic so Codex, Copilot, OpenCode, and Pi can adopt it once Claude ships.

Bridge the gap between an agent's **provider-managed subagents** (spawned by the CLI/SDK inside the agent's own process — Claude's `Task` tool, "ultracode" fan-out, etc.) and Otto's ability to **track and watch each of them separately**. Today Otto flattens all of a Claude subagent's activity into a single log string inside the parent's `Task` tool-call row and drops its failure signals entirely. This doc defines how to promote each provider-managed subagent to a first-class, separately-watchable — but **read-only / unattended** — entry in the parent's subagents track.

Read [agent-lifecycle.md](./agent-lifecycle.md) first: it defines the existing **Otto-native** subagent (the thing we are _not_ changing) and the track/tab/pane/archive machinery we are reusing.

---

## Two kinds of subagent

Otto already has one notion of subagent and is gaining a second. They must not be conflated.

|                   | **Otto-native subagent** (exists)                                                          | **Observed subagent** (this doc)                                                         |
| ----------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Created by        | The agent calling Otto's `create_agent` MCP tool with `relationship: { kind: "subagent" }` | The provider's own CLI/SDK (Claude `Task` tool, ultracode fan-out) — Otto is never asked |
| Runtime           | A real Otto-managed agent process                                                          | Lives **inside the parent's** process; Otto has no separate runtime for it               |
| Identity          | Full `Agent` record, `otto.parent-agent-id` label                                          | Provider task id + provider subagent session id; **no** independent Otto runtime         |
| Attendability     | **Attended** — user can prompt it, change model/mode/thinking, approve permissions         | **Unattended, always** — user can only watch, and stop it                                |
| Lifecycle control | create / prompt / archive / detach / cascade                                               | observe + stop/background only (see [Hard constraints](#hard-constraints))               |
| Today's tracking  | Full track row + tab + pane                                                                | A log string inside the parent's `Task` row; failures dropped                            |

The whole point of this feature: an **observed subagent** should sit in the same subagents track, open in the same tab/pane, and render in the same message UI as everything else — just with every interactive affordance disabled.

---

## What the provider actually gives us (Claude)

The `@anthropic-ai/claude-agent-sdk` surface is rich; Otto currently consumes almost none of it. Grounding refs are in [`sdk.d.ts`](../packages/server/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts) and the current, deliberately-lossy consumer [`sidechain-tracker.ts`](../packages/server/src/server/agent/providers/claude/sidechain-tracker.ts).

| Capability                   | SDK surface                                                                                                                                                                                                                                    | Otto today                                                                                                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subagent lifecycle           | `task_started` / `task_progress` / `task_notification` system messages — each carries `task_id`, `tool_use_id`, `subagent_type`, `usage`, `output_file`, and `status: completed \| failed \| stopped`                                          | `task_started`/`task_progress` ignored; `task_notification` **dropped** for subagent tool names (`agent.ts` `appendTaskNotificationEvents`, the `TODO: subagent timelines are best-effort` comment) |
| Per-subagent identity        | Subagent messages carry `session_id` + `parent_tool_use_id` + `subagent_type` + `task_description`; `SubagentStart`/`SubagentStop` hooks carry `agent_id`, `agent_type`, `agent_transcript_path`, `last_assistant_message`, `background_tasks` | not used                                                                                                                                                                                            |
| Full nested transcript       | `forwardSubagentText: true` query option (off by default — only tool_use/tool_result heartbeats come through)                                                                                                                                  | **off**                                                                                                                                                                                             |
| Periodic AI progress summary | `agentProgressSummaries: true` → `summary` on `task_progress`                                                                                                                                                                                  | **off**                                                                                                                                                                                             |
| On-disk transcript           | `~/.claude/projects/<dir>/<sessionId>/subagents/agent-<agentId>.jsonl`; helpers `listSubagents(sessionId)`, `getSubagentMessages(sessionId, agentId)`                                                                                          | not used                                                                                                                                                                                            |
| **Control**                  | `query.stopTask(taskId)`, `query.backgroundTasks(toolUseId)`                                                                                                                                                                                   | not wired                                                                                                                                                                                           |

**Turning on `forwardSubagentText` + `agentProgressSummaries`** (in the query config at `agent.ts` `base: ClaudeOptions`, currently only `includePartialMessages: true`) is the single change that upgrades the flattened log into a real transcript + live summaries. It is the foundation this feature builds on.

---

## Target model: the observed subagent is a read-only agent record

The subagents track, tabs, and message pane already render from `Agent` records in the client session store, filtered by `parentAgentId` ([`subagents/select.ts`](../packages/app/src/subagents/select.ts), [`subagents/track.tsx`](../packages/app/src/subagents/track.tsx)). **We reuse that pipeline instead of building a parallel one.** The daemon materializes each provider-managed subagent as an `Agent` snapshot that:

- has `parentAgentId` set to the parent agent → it appears in the parent's track automatically;
- carries a new **attendability marker** (below) → the client renders it read-only and the daemon refuses attended operations;
- streams a normal timeline (built from `forwardSubagentText` messages) → the message pane "just works".

### The attendability marker

Add one field to the agent record and the protocol agent snapshot:

```
attend: "attended" | "observed"   // default "attended" (COMPAT: absent ⇒ "attended")
```

`"observed"` is the whole contract:

- **Daemon** rejects/へ no-ops attended RPCs for the agent: prompt/send, setModel, setPermissionMode, setThinking, rewind, slash commands. Only **stop** (→ provider `stopTask`) is honored. There is no Otto runtime to prompt anyway; the marker makes the refusal explicit and typed rather than an accidental crash.
- **Client** treats `attend === "observed"` as the single source of truth for hiding/disabling interactive UI. Not a separate screen or "read-only mode toggle" — the same pane, same message list, with affordances removed.

Keep `attend` provider-agnostic. Claude populates it from `Task`/sidechain streams; other providers populate it from their own subagent signals later. Nothing in the protocol or client should say "claude".

### Identity & storage

- **Otto agent id:** deterministic from the parent — e.g. `${parentAgentId}:sub:${providerTaskId}` — so repeated `task_progress` updates converge on one record and reconnects are idempotent.
- **Provider linkage:** store `task_id`, the subagent `session_id`, and `agent_transcript_path` on the record (in `runtimeInfo.extra` or a typed sub-object) so **stop** can call `stopTask(task_id)` and a future "load full transcript" can read the jsonl.
- **Persistence:** observed subagents are **ephemeral by default** — they are a projection of the parent's live/replayable stream, not independent durable agents. Do **not** write them to `$OTTO_HOME/agents/**` as standalone files. They are reconstructed when the parent's timeline is (re)streamed. This avoids polluting cwd-keyed agent storage with records that have no runtime. (Open question: durability across daemon restarts — see below.)

### Lifecycle

Driven entirely by the provider's task stream, mapped onto the existing `AgentLifecycleStatus`:

| Provider signal (Claude)                                 | Observed-subagent status      | Notes                                                       |
| -------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------- |
| `task_started` / first `SubagentStart`                   | `initializing` → `running`    | create the record, add row to track                         |
| `task_progress` (+ `summary`, `usage`, `last_tool_name`) | `running`                     | update title/summary/usage; drive live activity             |
| `task_notification status: completed`                    | `idle` (terminal-ish)         | done; row stays until parent archived                       |
| `task_notification status: failed` / usage-exhaustion    | `error` + `requiresAttention` | **the failure that is invisible today** — must surface here |
| `task_notification status: stopped`                      | `closed`                      | user-initiated stop or parent stop                          |

- **Archive/cascade:** observed subagents cascade-archive with the parent exactly like Otto-native subagents (they cannot outlive it — they live in its process). They are **not** independently archivable in a way that kills a runtime (there is none); the row's "X" simply drops the projection.
- **Detach:** **not supported** — detach means "keep running as an independent root agent," which is impossible for something with no runtime. The track row must hide the detach affordance for `attend === "observed"`.
- **Stop:** supported → `query.stopTask(task_id)`. This is the one write operation an observed subagent allows and should be the primary action in its pane header.

---

## Client: read-only pane

Requirement (from the fork owner): **do not build a different mode.** Open the observed subagent in the same tab and the same message UI as any agent; hide or visually-disable every part of the conversation the user cannot interact with, and make the disabled state legible.

Interactive affordances to hide/disable when `attend === "observed"` (single gate, read off the agent record):

- **Composer** ([`agent-panel.tsx`](../packages/app/src/panels/agent-panel.tsx) `AgentComposerSection` / `ActiveAgentComposer`): hide the input, send, and attachment controls. Prefer a slim, clearly-disabled banner ("Observed subagent — read only") over an empty focusable box.
- **Parameter controls:** model / mode / thinking pickers, rewind, slash-command entry — hidden or rendered visibly disabled (reduced opacity + no press target), never silently inert.
- **Permission prompts:** none exist for observed subagents (the provider handles permissions inside its own process), so there is nothing to approve — ensure no permission UI can appear.
- **Track row actions:** show **archive/drop**; hide **detach**.
- **Pane header:** the one live action is **Stop** (when `running`), plus read-only status/usage.

Everything read-only — the transcript, tool calls, usage, status — renders through the existing components unchanged. The disabling must be **visually apparent** (dimmed, no cursor affordance), not just non-functional.

Gate all of the above behind a capability flag so old daemons/clients degrade cleanly (below).

---

## Protocol

Follow the [CLAUDE.md](../CLAUDE.md) protocol contract and [rpc-namespacing.md](./rpc-namespacing.md).

- **New agent field** `attend` on the agent snapshot ([`agent-types.ts`](../packages/protocol/src/agent-types.ts) / the session-store `Agent`): optional, default `"attended"`. Old clients ignore it (they render the record as a normal — attended — agent, which is a graceful, if not read-only, fallback; the capability gate below prevents that on capable clients).
- **Capability flag** `server_info.features.observedSubagents` ([`messages.ts`](../packages/protocol/src/messages.ts) features block) with `// COMPAT(observedSubagents): added in vX.Y, drop the gate when daemon floor >= vX.Y`. Client shows the read-only track rows/pane only when the flag is present; otherwise it falls back to **today's behavior** (the embedded `sub_agent` log in the parent Task row) — which is exactly the "update the host to use this" degradation the fork's feature contract calls for. **No fallback path** that simulates observed subagents on an old daemon.
- **Stop RPC** for an observed subagent: `agent.subagent.stop.request` / `.response`, resolved by the daemon to the owning provider session's `stopTask`. Reuse the existing stop path if one already targets provider tasks; do not add a Claude-specific RPC.

Backward-compat rules apply verbatim: `attend` is additive/optional, never flips to required, and the embedded-log path stays parseable so a 6-month-old client still renders _something_.

---

## Provider-agnostic layer

Claude ships first, but the seams are drawn so the next providers slot in without touching the protocol or client:

1. **Daemon core** owns an `ObservedSubagent` projection: `{ id, parentAgentId, providerTaskId, sessionId, transcriptPath, status, title, summary, usage, attend: "observed" }` and the reducer that maps provider lifecycle signals → agent snapshots + timeline. This is provider-neutral.
2. **Each provider adapter** implements a small interface — "given my raw subagent stream, emit ObservedSubagent lifecycle + timeline events, and expose stop(taskId)." Claude's adapter is the sidechain/task-stream consumer (replacing the lossy `ClaudeSidechainTracker` write-only log with events that feed the projection). Codex/Copilot/OpenCode/Pi implement the same interface against their own subagent mechanisms later.
3. **Client** never branches on provider — it reads `attend` and the normal agent/timeline shapes.

When we generalize, the only per-provider work is the adapter + turning on that provider's equivalent of `forwardSubagentText`; the protocol, store, track, pane, and read-only gating are written once here.

---

## Hard constraints

Set expectations before building — these bound what "bridge the gap" can deliver:

- **You cannot re-prompt an observed subagent.** The SDK drives subagents from the parent's Task loop; there is no API to send a fresh prompt to one in isolation. "Watch separately" is achievable; "converse with it independently" is not. This is _why_ the model is read-only, not a limitation of our implementation.
- **Control is stop/background only** (`stopTask`, `backgroundTasks`). No model/mode/thinking/rewind.
- **Usage-exhaustion / mid-subagent failure surfaces only as `task_notification status: failed`** (plus `SubagentStop`). That single signal must become the `error` + `requiresAttention` state — it is the concrete symptom the fork owner hit ("if they run out of usage they will not interact with Otto"). Capturing it is a primary acceptance criterion.

---

## Non-goals

- Making observed subagents attended (promptable). Not possible; not this feature.
- Persisting observed subagents as standalone durable agents in `$OTTO_HOME/agents/**`.
- A separate "read-only viewer" screen. It is the normal pane with affordances disabled.
- Touching Otto-native subagent behavior (create/detach/cascade), except to share the track/tab/pane.

---

## Open questions

1. **Durability across daemon restart / reconnect.** Observed subagents are a projection of the parent's stream. If the parent is idle and the client reconnects, do we replay enough to reconstruct in-flight/finished subagents, or read `listSubagents()` + `getSubagentMessages()` from disk to rehydrate? Leaning: rehydrate from the parent's replayable timeline; fall back to the on-disk jsonl for full transcript on demand.
2. **Glossary term.** "Observed subagent" is the working name (internal). The UI label wins per [glossary.md](./glossary.md) — pick the user-facing label before shipping and record it there. Candidates: "watched subagent", "observed subagent", "read-only subagent".
3. **Track density.** Ultracode fan-out can spawn many subagents; the track already flags accumulation for Otto-native subagents. Do observed subagents need grouping/auto-collapse of completed ones sooner?
4. **Nested subagents.** A subagent that itself spawns subagents — do we flatten to the top parent or preserve depth? (SDK `parent_tool_use_id` chains make depth recoverable.) Leaning: flatten for v1.
5. **Token economy.** `forwardSubagentText` multiplies streamed volume. Confirm the coalescing/backpressure story (see [terminal-performance.md](./terminal-performance.md) for the existing invariants) holds for many concurrent subagent transcripts.

---

## Build sequence (Claude proof first)

1. **Daemon, observation:** enable `forwardSubagentText` + `agentProgressSummaries`; add the provider adapter that consumes `task_started`/`task_progress`/`task_notification` + `SubagentStart`/`SubagentStop` and builds the `ObservedSubagent` projection (replacing the write-only sidechain log). Prove the **failed** notification surfaces.
2. **Protocol:** add `attend` to the agent snapshot + `features.observedSubagents` gate + the stop RPC. Keep the embedded-log path intact for old clients.
3. **Client, tracking:** materialize observed subagents as `attend: "observed"` agent records → they appear in the track and open in tabs with zero track/tab changes beyond hiding **detach**.
4. **Client, read-only pane:** gate the composer + parameter controls + permission UI off `attend === "observed"`, visibly disabled; add the **Stop** action.
5. **Verify** end-to-end with a real ultracode run that fans out subagents and one that fails on usage; confirm each is watchable and the failure is visible.
6. **Generalize:** lift the adapter interface and repeat per provider.
