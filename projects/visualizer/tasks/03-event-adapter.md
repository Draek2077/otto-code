# Task 03 — Otto → Visualizer event adapter

Feed the embedded page from Otto's normalized client-side agent data. Provider-neutral by construction: consume only the normalized stream/snapshots, never provider-specific data. New module: `packages/app/src/visualizer/` (e.g. `visualizer-event-adapter.ts` + a hook the panel uses).

## Read first

- [projects/visualizer/visualizer.md](../visualizer.md) — full SimulationEvent payload table + bridge contract + node-identity gotchas
- docs/timeline-sync.md — live events vs timeline backfill
- Protocol shapes in `packages/protocol/src/messages.ts`: stream union `AgentStreamEventPayloadSchema` (~L904), timeline items `AgentTimelineItemPayloadSchema` (~L863), tool calls `ToolCall*PayloadSchema` (~L825) + `ToolCallDetailPayloadSchema` (~L726), usage `AgentUsageSchema` (~L618), snapshot `AgentSnapshotPayloadSchema` (~L985), permissions `AgentPermissionRequestPayloadSchema` (~L675)
- Client holders: `packages/app/src/stores/session-store.ts` (Agent interface ~L97: `status`, `parentAgentId`, `attend`, `lastUsage`, `cumulativeTokens`, `model`), `packages/app/src/runtime/host-runtime.ts` (`getClient(serverId)`, `client.on("agent.stream", ...)`), `packages/app/src/timeline/session-stream-reducers.ts` (backfill/cursor pattern), `packages/app/src/subagents/` (observed-subagent helpers)

## Sessions

One visualizer session per **attended root agent in the workspace**: `session-started {session:{id: agentId, label: agent title, status, startTime, lastActivityTime}}`; `session-updated` on rename; `session-ended` when the agent completes/archives. Observed subagents do NOT get their own session — they appear inside the parent's session as child nodes.

## Event mapping (target shapes in the charter table)

| Otto source                                                       | → SimulationEvent (sessionId = root agent id)                                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| root agent snapshot appears                                       | `agent_spawn {name, isMain:true, model, runtime}`                                                                        |
| observed subagent snapshot (`attend:"observed"`, `parentAgentId`) | `agent_spawn {name, parent, task}`                                                                                       |
| timeline `tool_call` status `running`                             | `tool_call_start {agent, tool:name, args: short summary from detail, inputData:{file_path} for read/edit/write details}` |
| timeline `tool_call` `completed`/`failed`/`canceled`              | `tool_call_end {agent, tool, result: detail summary, isError, errorMessage}`                                             |
| timeline `tool_call` with `sub_agent` detail                      | additionally `subagent_dispatch` on start / `subagent_return` on end (`{parent, child, task/summary}`)                   |
| timeline `user_message` / `assistant_message` / `reasoning`       | `message {agent, content, role: user/assistant/thinking}`                                                                |
| `turn_completed.usage` / snapshot `lastUsage`                     | `context_update {agent, tokens: contextWindowUsedTokens, tokensMax: contextWindowMaxTokens}`                             |
| stream `permission_requested` / `permission_resolved`             | `permission_requested {agent}` / `agent_idle {name}`                                                                     |
| `turn_completed` / `turn_canceled` / `turn_failed`                | `agent_idle {name}`                                                                                                      |
| agent terminal (completed/archived; observed subagent finished)   | `agent_complete {name}`                                                                                                  |
| snapshot `model` change                                           | `model_detected {agent, model}`                                                                                          |

Notes:

- **Node names must be stable and unique** — the page keys agents by `name`. Use the agent's display title with a short id suffix on collision; observed ids (`parent::sub::key`) need the same special-casing as everywhere else (subagents-cleanup gotcha).
- `runtime` only picks the node logo: map provider `claude`→`"claude"`, codex-family→`"codex"`, else omit (defaults to claude logo; extensible mapping is task 04).
- `contextBreakdown` has no Otto source — omit it; the page tolerates missing fields.
- `time` is epoch ms; ordering matters more than absolute values (handlers mostly use sim-time).

## Backfill + liveness

- On tab open (or session select): replay the agent's existing timeline (same source chat backfill uses — see `session-stream-reducers.ts` cursor logic) as **one `agent-event-batch`** with original timestamps, then stream live events. Use the timeline cursor to avoid double-feeding the live/backfill overlap (the page has a 3s tool-call dedup window as a safety net, don't rely on it).
- Batch live events on a ~100–250 ms tick — the page throttles UI updates internally anyway.
- **Re-flush on visibility regain:** hidden webviews stop rAF and the page may drop pending events while paused; when the Visualizer tab regains focus/visibility, re-send `session-list`/re-select the session so the page's buffer flush rebuilds state. Cheapest correct approach: treat the page as stateless and replay the session buffer from the adapter on every reattach (`reset` message, then full batch).

## Proof

Claude first (incl. observed subagents fan-out), then verify at least one other provider (openai-compat or OpenCode) renders identically — it should be free, same normalized schema. Typecheck/lint/format; unit-test the pure mapping functions (timeline item → SimulationEvent) in `packages/app/src/visualizer/*.test.ts`, run only that file.
