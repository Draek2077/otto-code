# Agent lifecycle

How an agent is created, runs, becomes a subagent, gets archived, and disappears from the UI. The model spans the daemon (lifecycle, archive) and the client (tabs, the subagents track).

## States

```
initializing → idle → running → idle (or error → closed)
                 ↑        │
                 └────────┘  (agent completes a turn, awaits next prompt)
```

Each agent in `AgentManager` carries a `lastStatus` of `initializing`, `idle`, `running`, `error`, or `closed`. State transitions persist to disk and stream to subscribed clients via WebSocket.

## Relationships

Agents can launch other agents via the agent-scoped `create_agent` MCP tool. Agent-scoped creation is always asynchronous. `relationship` and `workspace` are separate decisions:

- `relationship` decides whether the new agent belongs under the caller.
- `workspace` decides where the new agent lives and whether a new workspace/worktree is created.

`relationship: { kind: "subagent" }` stamps the created agent with `otto.parent-agent-id`, pointing back at the creating agent. The client surfaces that as `agent.parentAgentId`. This requires an agent-scoped MCP session.

`relationship: { kind: "detached" }` creates a sibling/root agent (e.g. handoffs, fire-and-forget delegations). The daemon may still use the creating agent for cwd/config inheritance, but it does not write `otto.parent-agent-id`.

- **Subagents** — exist as part of the creating agent's work, appear in that agent's subagent track, and are archived with it.
- **Detached agents** — stand on their own, do not appear in the creating agent's subagent track, and are not archived with it.

`workspace: { kind: "current" }` uses the caller's workspace and can optionally override the runtime cwd. It requires an agent-scoped MCP session. `workspace: { kind: "create", source: { kind: "directory" | "worktree", ... } }` creates a new workspace for the new agent; worktree creation goes through the Otto worktree workflow and stamps the agent with that fresh workspace id.

Users can also detach an existing subagent from the subagents track. Detach removes the `otto.parent-agent-id` label only: it does not stop, archive, move, or restart the agent. The agent keeps its current `cwd` and `workspaceId`, leaves the former parent's track, and behaves like a root agent for tab close, workspace activity, and future parent archive.

`notifyOnFinish` defaults to `true` for agent-scoped creation and background prompt follow-ups because most delegated work needs to report back to the creating agent. Set it to `false` only for truly fire-and-forget agents or prompts.

## Archive

Archive is a **soft delete**: the agent record stays on disk with `archivedAt` set, the runtime is closed, and the agent disappears from active lists. Archive is **global** — it lives on the server and propagates to every connected client.

`create_agent_request` can opt an agent into `autoArchive`. In that mode the daemon archives the agent after the first terminal turn event (`turn_completed`, `turn_failed`, or `turn_canceled`). If the same request created a Otto worktree through its `worktree` field, auto-archive archives that worktree too, which removes the agent records inside the worktree.

Archiving runs through `AgentManager.archiveAgent` (`packages/server/src/server/agent/agent-manager.ts`):

1. Snapshot the current session into the registry
2. Set `archivedAt` and normalize `lastStatus` away from `running`/`initializing`
3. Notify subscribers
4. Close the runtime (kills the process if still running)
5. **Cascade-archive children** — any agent whose `otto.parent-agent-id` label matches the archived agent gets archived too, recursively

Cascade is what keeps subagent fleets from outliving their orchestrator.

## Tabs vs archive

These are two distinct concepts that used to be conflated:

| Concept                    | Scope      | Triggers                   |
| -------------------------- | ---------- | -------------------------- |
| **Tab** (workspace layout) | Per-client | User opens/closes a view   |
| **Archive** (lifecycle)    | Global     | Explicit lifecycle gesture |

Closing a tab on a **root agent** still archives — the tab is the agent's home, so closing it means "I'm done with this agent." A confirm dialog protects against archiving a running agent by accident.

Closing a tab on a **subagent** (any agent with `parentAgentId`) is **layout-only**. The agent stays unarchived and stays in its parent's track. The user can re-open the tab from the track at any time. This is implemented in `handleCloseAgentTab` (`packages/app/src/screens/workspace/workspace-screen.tsx`).

The asymmetry is intentional: a subagent's home is the parent's track, not the tab. Tabs are ephemeral viewing slots; the track is the persistent record of the parent's children.

## Workspace activity

Agent lifecycle status stays literal: a parent agent is `idle` when its own turn is idle, even if a child is running.

Workspace status is an aggregate activity signal computed **per `workspaceId`**: a workspace's status reflects only records whose `workspaceId === workspace.id`. Ownership is never derived from `cwd` — many workspaces may share one directory, and same-`cwd` siblings do not clump under one status. A root agent contributes its normal state bucket to its owning workspace only. Running subagents contribute `running` to their root parent's owning workspace (by the parent agent's `workspaceId`), not to the subagent's current `cwd` or worktree. Non-running subagent attention, permission, and error states stay in the parent's subagents track and do not escalate the workspace bucket.

## The subagents track

The collapsible track above the composer in an agent's pane (`packages/app/src/subagents/track.tsx`). Membership rule (`packages/app/src/subagents/select.ts`):

```
parentAgentId === thisAgent.id  AND  !archivedAt
```

Archived subagents disappear from the track, by design. To remove a subagent from the track without closing its tab, use the **archive button (X)** on the row — it opens a confirm dialog and archives the subagent on confirm. That same archive shows the subagent leave the track on every connected client.

To keep the agent alive but remove it from the parent's track, use **detach**. The daemon clears the parent label, emits the normal agent update, and every client reclassifies the agent from subagent to root/sibling from that updated snapshot.

### Row actions, names, and cost

Row actions are **status-aware** — the primary action matches the row's state. A running or initializing subagent shows **Stop** (transitions it to a terminal state without removing the row); a terminal subagent (`idle` after completion, `error`, or `closed`) shows **Archive** (drops it from the track). Archive is never offered on a running agent. Stop and the pane's stop control are the _only_ callers of the stop path — tab lifecycle can never reach it, so closing a tab is always layout-only (see [Tabs vs archive](#tabs-vs-archive)). Detach stays a native-subagent-only affordance.

Row names are **frozen labels**, not summaries. A short, stable name is derived once when the subagent starts (from its type, plus an optional truncated slice of the initial task) and never mutates afterward — a provider's streaming progress summary updates the pane's live subtitle, never the row's title, and the projection enforces a hard single-line length cap. This keeps the track readable like a list of tabs.

Each row shows **honest cumulative token cost** right of the name — the running Σ(input + output) the daemon accumulates across the subagent's turns (not a last-turn or estimated number), plus `totalCostUsd` when the provider reports one. The accumulator is universal: it works for any provider and any spawn path, including cost-less local models. The collapsed track header sums the total across all rows, so a fan-out's cost is legible at a glance.

Completed subagents **tidy themselves without being destroyed**: terminal rows move into a collapsed **"Completed (N)"** group at the bottom of the track, keeping their frozen name and final token total, while the active list shows only in-flight subagents. A manual **"Clear all completed"** gesture archives every terminal row at once (never a running one). Nothing is destroyed until the user clears it or the parent is archived (which cascades), so cost and transcript survive the tidy.

### Auto-clear completed subagents

A device-local **General settings** toggle (`autoClearCompletedSubagents`, default off) turns the manual clear into an automatic one: while a chat's panel is mounted, tidy-eligible completed rows archive themselves once they've been terminal for a short settle (`SUBAGENT_AUTO_CLEAR_SETTLE_MS`), so a fan-out's finished rows don't accumulate in the Completed group. It's purely visual decluttering — scoped to a chat's subagents track (root chats are untouched), settle-delayed so a row is visibly finished before it vanishes, and it never retries a row whose archive fails (the manual clear stays available).

Clearing a row (auto **or** manual) would otherwise silently drop its token total from the header's honest fan-out sum, which only counts in-track rows. To prevent that, every cleared row's `cumulativeTokens` is rolled into a per-parent tally (`subagents/cleared-subagent-tokens-store.ts`) that `formatHeaderLabel` adds back in, so **"N tokens"** stays honest after the clear. Like the daemon's `cumulativeTokens` accumulator the tally is in-memory (resets on app reload); the planned per-chat total ([projects/total-token-accounting](../projects/total-token-accounting/total-token-accounting.md)) can read the same tally so cleared descendants keep counting toward the chat total.

## The Background Tasks track

A sibling track (`packages/app/src/background-tasks/track.tsx`), also above the composer, that lists **background shell processes** a provider launched itself — Claude's own `Bash` tool used with `run_in_background: true` — never AI subagents. It renders independently of the subagents track: each is `null` when empty, so either, both, or neither can show at once.

Unlike an observed subagent, a background shell task is **not** an `Agent` record — no tab, no pane, no transcript. The daemon (`AgentManager.backgroundShellTasks`, `packages/server/src/server/agent/agent-manager.ts`) projects it as a lightweight `{ id, command, status, ... }` row and pushes the full current list for a parent agent on every change (`background_shell_tasks_changed`, mirroring `terminals_changed`'s reconciliation shape). Row actions: **Stop** while running (resolves to the provider's `stopTask`), **Clear** once terminal (single row or bulk "Clear all"; entries are retired in place with `archivedAt`, never deleted, so a late provider update can't resurrect a cleared row).

On the Claude adapter (`packages/server/src/server/agent/providers/claude/agent.ts`), background shell tasks ride the exact same `task_started`/`task_progress`/`task_notification` system-message stream as observed subagents — see [observed-subagents.md](../projects/observed-subagents/observed-subagents.md) — discriminated by the originating tool being `Bash` rather than `Task`/`Agent`. Gated behind `server_info.features.backgroundShellTasks`.

## Why this shape

The decision was to **decouple "close tab" from "archive" only for subagents**, rather than universally:

- **Closing a tab on a root agent still archives** — preserves the existing UX users are trained on
- **Closing a tab on a subagent is layout-only** — fixes the lossy "click to read, close to dismiss view, lose the row" flow
- **Archive button on track rows** — gives subagents an explicit lifecycle gesture in their home surface
- **Detach button on track rows** — lets a subagent continue independently without killing its work
- **Cascade archive on parent** — keeps subagents from leaking when the parent is archived

We considered universal decoupling (no tab close ever archives, archive is always explicit) but rejected it: it changes a behavior root-agent users rely on.

## Limitations

### Cross-client tab dismissal

Closing a subagent's tab on one client doesn't affect other clients' layouts. This is the expected behavior of decoupled tabs and is consistent with how layouts have always worked. Archive remains the global gesture for cross-client cleanup.

## Storage

```
$OTTO_HOME/agents/{cwd-with-dashes}/{agent-id}.json
```

`{cwd-with-dashes}` is derived from the agent's filesystem `cwd`. It is not the workspace id; agent storage stays cwd-keyed while workspace identity is the opaque workspace id.

Each agent is a single JSON file. Fields relevant to this doc:

| Field                            | Type          | Meaning                                                                                      |
| -------------------------------- | ------------- | -------------------------------------------------------------------------------------------- |
| `id`                             | `string`      | Stable identifier                                                                            |
| `archivedAt`                     | `string?`     | Soft-delete timestamp (ISO 8601)                                                             |
| `labels["otto.parent-agent-id"]` | `string?`     | Parent agent ID, set automatically by `create_agent` when `relationship.kind === "subagent"` |
| `lastStatus`                     | `AgentStatus` | `initializing` / `idle` / `running` / `error` / `closed`                                     |

See [`docs/data-model.md`](./data-model.md) for the full agent record.
