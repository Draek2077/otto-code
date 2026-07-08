# Observed subagents: provider adapters

**Status:** planned, not started. Follows the shipped Claude proof — read [observed-subagents.md](./observed-subagents.md) first for the model, the protocol contract, and the Claude implementation landmarks. This doc plans the generalization to the remaining providers and the closing documentation pass.

The core promise of the design was: **generalizing is adapter-only work.** The protocol (`attend`, `features.observedSubagents`, `agent.subagent.stop.*`), the daemon projection (`AgentManager.observedSubagents` registry, `toObservedSubagentPayload`, observed timeline routing, the stop RPC plumbing), and the entire client (track, read-only pane, Stop button) are already provider-neutral. Nothing in them says "claude". A new provider only has to emit two events and (optionally) implement one method.

## The adapter contract

A provider session participates by emitting on its normal `AgentStreamEvent` stream (`packages/server/src/server/agent/agent-sdk-types.ts`):

| Surface                      | Shape                                                                                           | Notes                                                                                                                                                                                                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `observed_subagent_updated`  | `{ key, taskId?, sessionId?, subAgentType?, description?, status, requiresAttention?, usage? }` | `key` is any provider-local stable id for the subagent (Claude: the Task `tool_use` id). Status machine: `initializing/running → idle \| error \| closed`. `status: "error"` + `requiresAttention: true` is the failure signal — surfacing it is the point of the feature. |
| `observed_subagent_timeline` | `{ key, item, turnId?, timestamp? }`                                                            | Regular `AgentTimelineItem`s belonging to the subagent. The daemon records them under `${parentAgentId}::sub::${key}` and the pane renders them with zero provider-specific client code.                                                                                   |
| `stopTask?(taskId)`          | optional method on `AgentSession`                                                               | Wire it if the provider can stop a subagent; the Stop button appears either way and error-toasts if the RPC fails. Omit it and `AgentManager.stopObservedSubagent` throws a clear error.                                                                                   |

Rules learned from the Claude adapter (apply to every port):

- **Announce before timeline.** Emit the first `observed_subagent_updated` before (or with) the first timeline event; the manager tolerates timeline-first by materializing a placeholder `running` row, but announce-first gives the row its type/description immediately.
- **History replay must stay inert.** Guard announcements with a live-only set (Claude: `announcedObservedSubagents`) so persisted-history re-ingestion cannot materialize ghost rows for long-finished subagents.
- **Settle every path.** Completion, failure, provider-side stop, _and parent interrupt_ must all drive the row out of `running`. A row stuck at `running` is a bug (Claude closes in-flight rows in `flushPendingToolCalls`).
- **Keep the existing flattened `sub_agent` tool-call detail.** It is the old-client fallback per the feature contract — observed events are additive, not a replacement.
- Test stubs of `AgentManager` need `getObservedSubagentPayload()` (see `wire-compat.test.ts`).

## Per-provider work

Ordered by expected value and current signal quality (recon of the current mappers, 2026-07-08):

### 1. OpenCode — richest candidate

Today `deriveOpencodeTaskDetail` (`providers/opencode/tool-call-detail-parser.ts`) flattens the `task` tool into a `sub_agent` log, but it already extracts a **real child session id** (`ses_…`, via `extractOpenCodeTaskSessionId`). OpenCode child sessions are first-class sessions on the OpenCode server, and the daemon already consumes OpenCode's global event stream (see [docs/opencode-global-event-baseline.md](../../docs/opencode-global-event-baseline.md)).

- Adapter: on `task` tool start, announce (`key` = tool call id, `sessionId` = child `ses_…` once extractable); subscribe/filter the global event stream for the child session's message events and map them to `observed_subagent_timeline`; settle from the task tool result.
- Stop: investigate OpenCode's session abort API for child sessions (`session.abort` equivalent) → `stopTask`.
- Open question: whether child-session events arrive on the already-subscribed global stream (likely, per the baseline doc) or need a per-session subscription.

### 2. Codex — lifecycle-first

`mapCollabAgentToolCallItem` (`providers/codex/tool-call-mapper.ts`) already models collab sub-agents with id, prompt, and running/failed/completed status — a ready-made lifecycle source, currently flattened into a `sub_agent` row with an empty log.

- Adapter phase 1 (cheap): announce/settle from collab item status transitions; `description` = prompt. This alone delivers track rows + failure visibility.
- Adapter phase 2: investigate the codex app-server protocol for sub-thread/delegated-thread event streams to feed `observed_subagent_timeline`; also whether an interrupt/abort exists for a single collab agent → `stopTask`.
- If phase 2 comes up empty, ship phase 1 — a row with status/description and an empty transcript is still strictly better than today.

### 3. Copilot / Cursor / Kiro (ACP family) — investigation first

The ACP agents (`generic-acp-agent.ts` and wrappers) show no subagent surface in the current mappers. Task: check the ACP spec/stream for sidechain or delegated-session notifications. If ACP has nothing, these providers simply don't emit observed events — the feature degrades to nothing cleanly, no fallback path needed.

### 4. Pi — investigation first

Same shape as ACP: survey `providers/pi/` and the Pi wire protocol for any subagent signal; adopt if present, skip cleanly if not.

### Non-goal: openai-compat

The openai-compat provider delegates via Otto's native `create_agent` MCP tools — its subagents are already real, **attended** Otto agents in the track. No observed work applies.

## Suggested extraction before the second adapter

The Claude adapter keeps its observed bookkeeping inline (announce set, taskId→key map, pending settle queue). When the second provider lands, extract the common pattern into a small provider-neutral helper (e.g. `providers/observed-subagent-emitter.ts`: announce-once, key mapping, settle queue) so the third+ adapters are declarative. Don't pre-build it now — two data points first.

## Documentation pass (required, ships with this project)

Per the repo convention (CLAUDE.md → Docs), once this ships the durable facts must be folded into **official architectural documentation** in `docs/` — this task is part of the project, not optional cleanup:

1. **[docs/agent-lifecycle.md](../../docs/agent-lifecycle.md)** — add an "Observed subagents" section: the attended/observed split, the `attend` field, membership in the subagents track, why detach is hidden, stop semantics, ephemeral (non-persisted) lifecycle, cascade behavior with the parent.
2. **[docs/architecture.md](../../docs/architecture.md)** — data-flow addendum: provider observed events → `AgentManager` registry/projection → `observed_agent_state` → `forwardLiveAgentPayload` → client store; observed timeline ids (`${parentAgentId}::sub::${key}`) flowing through the normal timeline store and fetch path.
3. **[docs/glossary.md](../../docs/glossary.md)** — add **"Observed subagent"** as the authoritative term (UI label wins; no synonyms like "watched"/"read-only subagent" in code or UI).
4. **[docs/providers.md](../../docs/providers.md)** — extend the "adding a provider" guide with the adapter contract table above (the two events + `stopTask`), including the announce-before-timeline and history-inertness rules.
5. **[docs/data-model.md](../../docs/data-model.md)** — one paragraph: observed subagents are ephemeral projections, deliberately **not** persisted under `$OTTO_HOME/agents/**`.
6. After folding: slim this project folder down to a historical record (or delete it), per the projects convention.

## Acceptance criteria (per provider)

1. A run that fans out provider-managed subagents shows one track row per subagent with live status and type/description.
2. Opening a row gives the read-only pane with that subagent's own transcript (where the provider has a transcript stream).
3. A subagent failure (usage exhaustion or provider error) turns the row `error` + attention — never silently vanishes.
4. Stop works where the provider supports it; otherwise the Stop action fails with a clear error.
5. Parent interrupt/close settles all of that parent's observed rows.
6. Old clients still get the flattened `sub_agent` tool-call row; old daemons make the client fall back to it (capability gate, no fallback paths).
