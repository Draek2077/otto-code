# Suggested Tasks — charter

Bring Claude Desktop's **suggested background task** system into Otto, using the same
agent-facing mechanism and nomenclature so it feels identical to Claude Desktop, then
render it natively in the Otto session UI and wire it into Otto's own agent-creation +
worktree machinery.

An agent running in an Otto session surfaces a suggestion by calling `spawn_task`. A
**chip** appears for the user in that session. The user can then start the task one of
three ways — a **new worktree workspace**, **locally** (same repo/cwd, no worktree), or
**in this session** (send the prompt to the current agent) — or **dismiss** it. Either
way, the spawning agent's current turn continues uninterrupted.

This is the same leveling-up pattern the fork has already shipped for previews, artifacts,
and observed subagents: design provider-agnostic first, prove on one provider. Because Otto
injects its native tool catalog into every provider, registering the two tools once makes
them available to Claude (over the injected `/mcp/agents` server) **and** the
openai-compatible provider (natively via `launchContext.ottoTools`) with zero per-provider
work — so the two-tool contract ships for all providers at once by construction.

## Fidelity to Claude Desktop

The **agent-facing contract** matches Claude Desktop exactly — same tool names, field
names, and (where reasonable) tool-description / result wording:

- **`spawn_task`** — args:
  - `title` — under 60 chars, imperative verb phrase. Chip label + spawned session title.
  - `prompt` — self-contained initial message for the spawned session. **Not shown to the
    user directly**; stays server-side and is used verbatim when the task is started.
  - `tldr` — 1–2 sentence plain-English summary shown in the chip tooltip.
  - `cwd` — optional absolute path to a different project root; defaults to the current
    project (the caller agent's cwd).
  - Returns `{ task_id }`.
- **`dismiss_task`** — args: `task_id`, optional `reason`. Withdraws a chip the user has
  not acted on yet. If the task was already started or dismissed, it reports that and
  no-ops (idempotent).

The **user-facing chip** is Otto's rendering of that system. It matches Claude Desktop's
look/feel and "suggested task" framing as closely as Otto's design system allows, but the
**three start modes are an Otto superset** (Claude Desktop only spawns a new session).
Start-mode labels follow Otto's glossary — **New worktree** / **Local** / **This session**
(the `Isolation` vocabulary), never "checkout".

## How it maps onto Otto (proven code paths)

Every piece below mirrors an existing, shipped Otto subsystem. The closest analog is the
**Background Tasks track** (`background_shell_tasks_changed`), which is a per-parent-agent
in-memory list pushed via a dedicated `*_changed` notification with dotted-namespace action
RPCs — exactly the shape this feature needs. We mirror it end-to-end.

### 1. Agent-facing tools (all providers, one registration)

Register `spawn_task` and `dismiss_task` in the shared tool catalog —
`createOttoToolCatalog` in `packages/server/src/server/agent/tools/otto-tools.ts` (template:
the `cancel_agent` tool). Handlers use the closed-over `callerAgentId` as the parent agent
and the `resolveScopedCwd` helper for the optional `cwd` (honoring `lockedCwd` /
`allowCustomCwd`, same as `create_agent`). No provider files change; the catalog loop feeds
both the Claude MCP transport and the openai-compat native path.

Tool group: `spawn_task` / `dismiss_task` match no prefix in `ottoToolGroupForName`
(`packages/protocol/src/provider-config.ts`) so they land in the existing **`agents`** group
by default — the right home for orchestration tools, no new toggle required.

### 2. Daemon store (in-memory, mirrors `backgroundShellTasks`)

Add a `Map<taskId, SuggestedTaskEntry>` to `AgentManager`
(`packages/server/src/server/agent/agent-manager.ts`), alongside `backgroundShellTasks`.
Entry: `{ id, parentAgentId, title, prompt, tldr, cwd?, state, createdAt, updatedAt,
startedAgentId?, startMode?, dismissReason? }` where `state ∈ pending | started | dismissed`.

Methods (mirroring the `backgroundShellTasks` methods one-for-one):

- `spawnSuggestedTask({ parentAgentId, title, prompt, tldr, cwd? }) → taskId` — create a
  `pending` entry, emit state, return the id.
- `dismissSuggestedTask({ taskId, reason? }) → { dismissed, alreadyResolved, state }` —
  idempotent; flips `pending → dismissed`, or reports the existing terminal state.
- `markSuggestedTaskStarted({ taskId, mode, startedAgentId? })` — flips `pending → started`.
- `getSuggestedTask(taskId)`, `currentSuggestedTasksFor(parentAgentId)`,
  `emitSuggestedTaskState(parentAgentId)` → dispatches the internal
  `{ type: "suggested_task_state", parentAgentId, tasks }` event
  (added to `AgentManagerEvent`).

The emitted `changed` list carries only **`pending`** tasks — resolved entries are retained
in the map purely so `dismiss_task` / start stay idempotent and can report "already acted
on," and are dropped from the wire so the chip disappears on resolution. This is the same
"filter terminal entries out of the emitted list" rule `currentBackgroundShellTasksFor`
uses. The `state` enum is still on the wire schema for honesty + forward use.

In-memory only for the proof (like `backgroundShellTasks` and subagents): chips are
inherently ephemeral "act on it now" affordances, and Claude Desktop's are session-scoped
too. Cleared on daemon restart. Persistence is a deferred item, not a v1 requirement.

### 3. Start orchestration — reuse existing machinery, no parallel spawner

User clicks a start option → `tasks.suggested.start` RPC → session handler
(`packages/server/src/server/session.ts`) orchestrates via the **same commands the MCP tools
and the app's own create flows already use**:

| Mode             | Reuses                                                                                                                  | Notes                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **new worktree** | `createAgentCommand` with `workspace: { kind: "create", source: { kind: "worktree", target: { kind: "branch-off" } } }` | Triggers `createOttoWorktreeWorkflow`; new agent stamped with the fresh workspaceId; `title` → session title |
| **local**        | `createAgentCommand` with `workspace: { kind: "current" }` (or a directory workspace when `cwd` differs)                | Same repo/cwd, no worktree, no bootstrap continuation                                                        |
| **this session** | `sendPromptToAgent({ agentId: parentAgentId, prompt })` → `startAgentRun(replaceRunning: true)`                         | Steers the current agent with the task prompt (existing send path)                                           |

`create_agent` requires an explicit provider/personality — there is no silent inheritance.
The start handler therefore **resolves the parent agent's brain** (provider/model, and
personality if set, via `agentManager.getAgent(parentAgentId)`) and passes it explicitly, so
a started task feels like a continuation of the agent that suggested it. On success it calls
`markSuggestedTaskStarted`, which drops the chip.

### 4. Protocol (additive, backward-compatible)

All in `packages/protocol/src/messages.ts`, mirroring the `BackgroundShellTask*` block:

- `SuggestedTaskInfoSchema` = `{ taskId, parentAgentId, title, tldr, cwd?, state:
z.enum(["pending","started","dismissed"]), createdAt, updatedAt }`. **`prompt` is never
  sent to the client** (Claude Desktop: "not shown directly").
- `SuggestedTasksChangedSchema` = `{ type: "suggested_tasks_changed", payload: {
parentAgentId, tasks: SuggestedTaskInfo[] } }` — full-list reconciliation, added to
  `SessionOutboundMessageSchema`.
- RPC pairs (dotted, per `docs/rpc-namespacing.md`), added to the inbound/outbound unions.
  **Array-based** so one mechanism serves both individual and collective actions (see
  §6):
  - `tasks.suggested.start.request { parentAgentId, taskIds: string[], mode:
z.enum(["worktree","local","in_session"]), requestId }` / `.response` — aggregate payload
    `{ requestId, parentAgentId, accepted, succeeded, failed, error }`.
  - `tasks.suggested.dismiss.request { parentAgentId, taskIds: string[], requestId }` /
    `.response` (same aggregate payload).
- Capability flag `features.suggestedTasks: z.boolean().optional()` with a
  `COMPAT(suggestedTasks)` comment in `ServerInfoStatusPayloadSchema`, set `true` in
  `buildServerInfoStatusPayload` (`websocket-server.ts`).
- Regenerate the zod-aot validators (runs automatically under `npm run typecheck`).

Protocol contract: every new field optional / additive; feature gated in
`server_info.features.suggestedTasks`; no fallback path for old daemons (client shows
nothing when the flag is absent).

### 5. Client + app

- `packages/client/src/daemon-client.ts`: `startSuggestedTasks(parent, taskIds, mode)` and
  `dismissSuggestedTasks(parent, taskIds)` via `sendNamespacedCorrelatedSessionRequest`.
- `packages/app/src/stores/session-store.ts`: a `suggestedTasks: Map<taskId, ...>` leaf +
  `setSuggestedTasksForParent` setter, ingested from `suggested_tasks_changed` (mirror
  `setBackgroundShellTasksForParent`).
- `packages/app/src/suggested-tasks/`: `select.ts` (selector + `useSuggestedTasksForParent`),
  `use-suggested-task-actions.ts` (one hook exposing `startTasks`/`dismissTasks`, both
  array-based, with toast feedback), `track.tsx` (the chip UI + collective header),
  `index.ts` barrel — mirroring `packages/app/src/background-tasks/`.
- Mount `<SuggestedTasksTrack>` as a sibling above `<Composer>` in `ActiveAgentComposer`
  (`packages/app/src/panels/agent-panel.tsx`), gated on
  `useHostFeature(serverId, "suggestedTasks")`, alongside the Subagents and Background Tasks
  tracks. Each chip: title, tldr tooltip, a **Start** `DropdownMenu` (New worktree / Local /
  This session) with in-flight `pending`/`success` states, and a Dismiss icon button (every
  icon button wrapped in a `Tooltip`). Reuse the track card styles verbatim so it seats into
  the composer top like the sibling tracks.

### 6. Queue & collective actions

Suggested tasks form a **queue**: `spawn_task` is a synchronous tool call that returns a
`task_id` immediately and never waits for the user, so an agent can fire several back to
back and each becomes a pending chip. They collect inline in the track (no modals pop up);
the store's full-list reconciliation on `suggested_tasks_changed` keeps the set current.

The user answers the queue **individually or collectively**, with one array-based mechanism:

- **Individually** — each chip has its own **Start** menu (New worktree / Local / This
  session) + Dismiss; these call the RPC with a single-element `taskIds`.
- **Collectively** — when 2+ tasks are queued, the track header shows **Start all** (New
  worktree / Local) + **Dismiss all**, calling the RPC with the whole pending queue.

Collective start applies the **same mode to each task independently — one agent/chat each,
never combining prompts**. "New worktree" ⇒ N new worktree workspaces under this project
(a worktree _is_ its own workspace — `workspaceKind: "worktree"`, one project, many
workspaces); "Local" ⇒ N new chats in the current workspace. **"This session" is offered
per-chip but not in the collective menu** — steering N tasks into one running chat can't
produce "one chat each" and would clobber turns (that's steer-queue territory). The daemon
loops the pending `taskIds`, applies the mode per task (sequential worktree creation),
marks each started, and returns aggregate `{ succeeded, failed, error }`; partial failures
leave the failed chips pending. The spawning agent's turn is never interrupted by any of
this.

## Deliverable / definition of done

- Agents in Otto sessions can call `spawn_task` / `dismiss_task`; both available to every
  provider by construction, proven end-to-end on **Claude** (heaviest-used here) — the same
  registration serves openai-compat with no extra wiring.
- Chips render in the session and **queue** (agents can suggest back to back without
  waiting); the user can launch each into a worktree-backed new workspace, locally, or
  in-session, or dismiss — **individually or collectively** (Start all / Dismiss all); the
  spawning turn is never interrupted.
- `npm run typecheck` and `npm run lint` clean.

## Non-goals / deferred

- **Persistence across daemon restarts** — in-memory for v1.
- **Surfacing `started` / `dismissed` states on the wire** — schema supports them; the wire
  emits only `pending` today (chip-disappears UX). Revisit if we want a "recently started"
  affordance.
- **Queue-vs-interrupt for "this session"** — v1 uses the existing steer (`replaceRunning`)
  path; the separate steer-queue project may later let it queue instead.
- **A dedicated `tasks` tool group / toggle** — lives in the `agents` group for now.
- i18n string extraction for the new UI (English-first per the repo convention; locale
  parity is type-enforced, so extract before release).

## Provider proof matrix

| Provider                        | Tool injection path               | Status                                        |
| ------------------------------- | --------------------------------- | --------------------------------------------- |
| Claude                          | injected `/mcp/agents` MCP server | **proof target**                              |
| openai-compat                   | native `launchContext.ottoTools`  | ships by construction (same catalog)          |
| Codex / Copilot / OpenCode / Pi | provider tool-injection support   | inherits when their Otto-tool injection is on |

Once shipped, fold the durable design facts into `docs/` (likely a short section in
`docs/agent-lifecycle.md` or a new `docs/suggested-tasks.md`) and delete this folder, per the
projects/ lifecycle rule.
