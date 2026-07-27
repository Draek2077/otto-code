# Chat lifecycle

How a chat is created, runs, becomes a subagent, gets archived, and disappears from the UI. The model spans the daemon (lifecycle, archive) and the client (tabs, the subagents track).

**Chat vs agent.** A **chat** is the wrapper you interact with and view through — the durable conversation surface with a tab, a title, a timeline, and an archive gesture. An **agent** is the AI session running inside it: one provider, one model, one effort, one running process. You archive a chat; you stop an agent. This doc is about the chat.

Code identifiers and wire names stay historical and are **not** renamed — `AgentManager`, `agentId`, `AgentSnapshotPayload`, `otto.parent-agent-id`, `create_agent`, `archiveAgent`. Only human-facing language distinguishes the two. Workspaces and worktrees are a separate concern with their own lifecycle — see [workspace-lifecycle.md](workspace-lifecycle.md); the only coupling is that archiving a workspace archives the chats it owns.

## States

```
initializing → idle → running → idle (or error → closed)
                 ↑        │
                 └────────┘  (the agent completes a turn, awaits next prompt)
```

Each chat in `AgentManager` carries a `lastStatus` of `initializing`, `idle`, `running`, `error`, or `closed`, reflecting the state of the agent session behind it. State transitions persist to disk and stream to subscribed clients via WebSocket.

## Delivery — how a prompt reaches a busy agent

Every prompt entrypoint (composer, MCP `send_agent_prompt`, CLI, chat mentions, schedule fires, notify-on-finish) funnels through `sendPromptToAgent` → `startAgentRun`, which takes a `delivery` mode. It only matters when the target is **busy**; against an idle agent both modes run the prompt immediately.

| `delivery`            | Busy target                                                              |
| --------------------- | ------------------------------------------------------------------------ |
| `interrupt` (default) | Cancel the in-flight turn, run this now **in the same provider session** |
| `queue`               | Let the turn finish; run this as the next turn                           |

`interrupt` is the wire default. UI label: **Interrupt** / **Queue** (Settings → Default send, and the composer's Queue track). `cancel_agent` remains interrupt-only — abort the run, keep the agent alive.

The whole feature lives in the turn lifecycle **above** every provider adapter, so it behaves identically for Claude, Codex, Copilot, OpenCode, Pi, and the openai-compatible provider. There are no per-provider adapters.

### Which delivery each entrypoint picks

The default is the wire default, not the right answer for every sender. A person typing into the composer has decided to interrupt by typing; Otto injecting a message on someone's behalf has decided nothing.

| Entrypoint                                   | Delivery            | Why                                                                                                                                                                           |
| -------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Composer, CLI `otto agent send`              | user's choice       | Settings → Default send; the alternate send action does the other one                                                                                                         |
| MCP `send_agent_prompt`                      | caller's choice     | Explicit `delivery` arg, `interrupt` default — the calling agent knows whether its prompt is a correction or a follow-up                                                      |
| **Chat @mention**                            | **`queue`**         | A room mention is a message, not an emergency. Interrupting discarded work on behalf of someone who only meant to say something — and `@everyone` did it to a roomful at once |
| **Notify-on-finish**                         | **`queue`**         | "Your child finished" is a report. Interrupting killed the turn the parent ran while the child worked, and a fan-out of N children interrupted it N times in a row            |
| Schedule fire → existing chat                | neither (**fails**) | `executeSchedule` pre-checks `hasInFlightRun` and fails the run with "already has an active run"; it has never interrupted. Open question — see below                         |
| Schedule fire → new chat, `/loop` iterations | n/a                 | Each runs a freshly created agent, which cannot be busy                                                                                                                       |

Both flipped paths already carried `source: "system"`, so each injected message still arrives as **its own turn** — queueing changes when a mention or a report lands, never how many there are or what they say. (The mention path was untagged until the flip; tagging it was part of the change, because two mentions merging into one turn would have lost each one's envelope.)

`delivery: "queue"` can never be the reason a prompt fails to arrive: an agent with no live session cannot be busy, so `enqueueSteerMessage` reports "not queued" and the caller dispatches normally. That matters most for exactly these senders, whose target may be closed or not yet revived.

**Still open — a schedule firing into a chat that is already busy.** Unlike the other two this is not a delivery-flag flip: `executeSchedule` runs the prompt through `runAgent`, which blocks to collect the timeline and final text for the run record, and the steer queue's dispatch is fire-and-forget. It is also a product question rather than a correctness one — whether a schedule is a _deadline_ ("run at 09:00, or not at all", which the cadence/next-run UI implies) or a _task_ ("run this, whenever you can"). Queueing means a run record sits `running` for an unbounded time, possibly past its own next fire. The candidates are: keep fail-fast; queue with a bounded wait; or record the run as **skipped** rather than failed, which fixes the misleading part of today's behavior without changing when anything runs. Decide it as a schedule question, not a queue one.

### How the queue drains

- **State.** `ManagedAgent.steerQueue` is a FIFO of `SteerQueueEntry` (`steer-queue-state.ts` owns the pure logic). Ephemeral by design — a queued nudge is about the run in progress, so it does not survive a daemon restart.
- **Enqueue.** `AgentManager.enqueueSteerMessage` does the busy check and the push in one synchronous block and reports whether it took the prompt, so the answer cannot go stale between them. Not busy ⇒ the caller dispatches normally.
- **Drain.** `finalizeForegroundTurn` decides synchronously, before it emits state, whether to pop a batch instead of going idle. `pendingSteerDrain` then holds the agent visibly `running` across the async handoff — mirroring `pendingReplacement` — so the row never flickers idle→running between queued turns and a message sent in that window is buffered rather than raced into a second concurrent turn.
- **Terminal error or `closed`.** Do **not** drain. A queued turn must never run unprompted into a broken session: the queue is held and stays visible so the supervisor decides.
- **Cancel holds it, and never clears it.** `cancelAgentRunCommand` (the shared verb behind the client's stop button, ESC, and the `cancel_agent` tool) calls `holdSteerQueue`, which sets `steerQueueHeld` so the cancelled turn's finalize skips the drain. Nothing new starts by itself, and the entries survive: the Queue track keeps rendering them with their edit and send-now actions, so stopping the run is how you make room for the messages you already typed. The hold covers that one finalize only; `streamAgent` clears it, so the queue drains behind the next turn like any other. Cancel used to empty the queue on a "stop everything" reading, which threw away work the user had typed. Interrupt-and-steer never cleared it either: those queued notes are separate instructions. Only `agent.queue.clear` (and closing the agent, which has no next turn to hand anything to) empties it.

### Several messages queued at once merge into one turn

Consecutive **user** messages in the queue are delivered as a **single** turn, joined in FIFO order with a blank line between them; images and attachments concatenate in the same order and the head entry's `runOptions` (including `messageId`) win.

Three notes dropped while an agent grinds through a refactor are one instruction set, not three turns. Delivering them separately makes the agent act on note 1 before it has seen the constraint in note 3, and pays a full context re-send per turn. System-injected entries (`source: "system"` — mentions, schedule fires, notify-on-finish, agent-to-agent sends) never merge: each carries its own envelope and means something on its own.

### Editing the queue

Order is what a FIFO means, so the queue supports three edits: **take one back** (`agent.queue.remove`, behind the Queue track's edit and send-now actions), **re-order** (`agent.queue.reorder`), and **drop everything** (`agent.queue.clear`).

Re-order is exposed as per-row **move earlier / move later** controls rather than drag-and-drop. The track is a two-to-three-row stack pinned above the composer on phone, tablet, and web; a drag gesture there competes with the scroll and the keyboard for a list that is almost never long enough to need one, and buttons are the affordance that works identically on all three. Both are complete — any order is reachable either way.

The daemon re-resolves the entry by id and **clamps** the destination rather than rejecting it, because the client is rendering a snapshot that may already be one drain stale; a move that lands at the end of a shorter queue is what the user meant. `moved: false` (already drained, or already there) is not an error — the authoritative order arrives on the agent snapshot regardless.

### Interrupts the provider did not fully honour

Claude Agent SDK ≥ 0.3.212 resolves `query.interrupt()` with an **interrupt receipt** (`still_queued`, feature-detected via `interrupt_receipt_v1` in `system/init`): uuids of async user messages that survive the interrupt and will still run. The Claude adapter filters it to uuids **it stamped itself**, since the receipt also carries ids the CLI enqueued (cron triggers, auto-resume continuations) that a client is told to ignore rather than treat as errors. Anything left means an interrupt Otto reported as complete left one of Otto's own messages live in the CLI, and it is logged at `warn` as `provider.claude.interrupt.still_queued`.

The reconcile is deliberately **diagnostic, not corrective**, and that follows from the queue's shape: Otto's queue is daemon-owned and sits above every adapter, so there is no provider-side queue for the daemon to re-sync against — the daemon already decides what runs next for every provider. The SDK also exposes no `cancel_async_message` on `Query`, so a survivor could not be withdrawn even if there were something to repair. Revisit if that lands.

### Wire surface

`server_info.features.steerQueue` gates the daemon-owned queue (`COMPAT(steerQueue)`, v0.6.8); `features.steerQueueReorder` gates re-ordering separately (`COMPAT(steerQueueReorder)`, v0.6.9), because a 0.6.8 daemon owns a queue it cannot re-order — against one, the move controls are simply absent and the rest of the queue works. With it the client sends `delivery: "queue"` on `send_agent_message_request`, reads `AgentSnapshotPayload.queuedMessages` (id + truncated preview + `enqueuedAt`), and edits the queue via `agent.queue.remove` / `agent.queue.reorder` / `agent.queue.clear`. Without it the composer keeps its own client-held queue drained on the running→idle edge — the behavior Otto has always had, not a degraded build of the daemon feature. Attachments live only in the client, so the daemon-backed path keeps a local sidecar keyed by the daemon's entry id purely so "edit" can restore them; losing it costs the attachments on edit, nothing else.

## Relationships

A chat's agent can launch other chats via the agent-scoped `create_agent` MCP tool. Agent-scoped creation is always asynchronous. `relationship` and `workspace` are separate decisions:

- `relationship` decides whether the new chat belongs under the caller.
- `workspace` decides where the new chat lives and whether a new workspace/worktree is created.

`relationship: { kind: "subagent" }` stamps the created chat with `otto.parent-agent-id`, pointing back at the creating chat. The client surfaces that as `agent.parentAgentId`. This requires an agent-scoped MCP session.

`relationship: { kind: "detached" }` creates a sibling/root chat (e.g. handoffs, fire-and-forget delegations). The daemon may still use the creating chat for cwd/config inheritance, but it does not write `otto.parent-agent-id`.

- **Subagents** — exist as part of the creating chat's work, appear in that chat's subagents track, and are archived with it.
- **Detached chats** — stand on their own, do not appear in the creating chat's subagents track, and are not archived with it.

`workspace: { kind: "current" }` uses the caller's workspace and can optionally override the runtime cwd. It requires an agent-scoped MCP session. `workspace: { kind: "create", source: { kind: "directory" | "worktree", ... } }` creates a new workspace for the new chat; worktree creation goes through the Otto worktree workflow and stamps the chat with that fresh workspace id.

Users can also detach an existing subagent from the subagents track. Detach removes the `otto.parent-agent-id` label only: it does not stop, archive, move, or restart anything. The chat keeps its current `cwd` and `workspaceId`, leaves the former parent's track, and behaves like a root chat for tab close, workspace activity, and future parent archive.

`notifyOnFinish` defaults to `true` for agent-scoped creation and background prompt follow-ups because most delegated work needs to report back to the creating chat. Set it to `false` only for truly fire-and-forget chats or prompts.

## Archive

Archive is a **soft delete**: the chat record stays on disk with `archivedAt` set, the runtime is closed, and the chat disappears from active lists. Archive is **global** — it lives on the server and propagates to every connected client. The hard counterpart is [Delete](#delete), which archive is the required first step for.

`create_agent_request` can opt a chat into `autoArchive`. In that mode the daemon archives the chat after the first terminal turn event (`turn_completed`, `turn_failed`, or `turn_canceled`). If the same request created an Otto worktree through its `worktree` field, auto-archive archives that worktree too, which removes the chat records inside the worktree.

Archiving runs through `AgentManager.archiveAgent` (`packages/server/src/server/agent/agent-manager.ts`):

1. Snapshot the current session into the registry
2. Set `archivedAt` and normalize `lastStatus` away from `running`/`initializing`
3. Notify subscribers
4. Close the runtime (kills the agent process if still running)
5. **Cascade-archive children** — any chat whose `otto.parent-agent-id` label matches the archived chat gets archived too, recursively

Cascade is what keeps subagent fleets from outliving their orchestrator.

## Delete

Archive is a soft delete. **Delete** is the hard one, and it is the counterpart archive spent a long time without: `archivedAt` got set, the record stayed on disk forever, and no app surface could remove it.

### What delete removes, and what it deliberately does not

Deleting a chat removes **Otto's record of it** — the JSON at `$OTTO_HOME/agents/{cwd-with-dashes}/{agent-id}.json`, its committed timeline, and the row from every list. That is the whole of it.

It does **not** remove the provider's own transcript. Claude's `<configDir>/projects/<encoded-cwd>/<sessionId>.jsonl` and its sibling `<sessionId>/` subagent tree, Codex's threads, OpenCode's sessions — those stay exactly where the provider wrote them. Three reasons, in order of weight:

1. **They are not Otto's files.** Otto never created them; it holds a `persistence.sessionId` pointing at them.
2. **Another tool still reads them.** `claude --resume` resolves that path. Silently deleting another tool's state is the kind of thing that costs trust once and permanently.
3. **Leaving them is the recoverable option.** A user who deletes a chat by mistake still has the conversation.

An **opt-in switch** to also delete provider data was considered and **rejected** — the product owner's call, 2026-07-25 ("that seems dangerous grounds"). There is deliberately no wire field for it, no setting, and no disabled placeholder. If a future version wants it, that is a decision to retake with fresh eyes, not a hook to leave lying around.

### Which means the UI has to say so

Reason 3 is worthless if nobody knows the data is there, so **the confirm dialog names where the conversation survives** — "Claude Code's own transcript on the host is left in place, so the conversation itself stays on disk and can still be read or resumed outside Otto" — and scopes its irreversibility claim honestly: _Otto's side_ of this can't be undone. Copy lives in `packages/app/src/history/delete-dialogs.ts`, pure and asserted on, because this is the one place where getting the wording wrong is the same as lying.

Bulk clear repeats the same disclosure rather than assuming it was read once. Clearing many at a time must not become a back door that deletes provider data in aggregate.

### Reaching it

**Delete is unreachable for a chat that has not been archived first.** Two-step destruction is the friction this deserves, and it keeps the history list's fast-path archive gesture intact.

| Surface                     | Gesture                                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| History list (`agent-list`) | Long-press an **archived** row → destructive confirm → delete. Long-pressing an unarchived row still archives, as it always has         |
| History screen              | An **All / Active / Archived** filter, plus **Clear archived** — dry run, confirm with the real count, then sweep                       |
| CLI                         | `otto agent delete <id>` (works on archived rows already); `--archived` / `--include-archived` widen the bulk `--all` / `--cwd` filters |

Long-press on an archived row used to re-archive it — a no-op that read as a broken gesture. That is the seam delete took over.

The CLI's bare `--all` and `--cwd` still mean **active only**, unchanged, so nobody's muscle memory becomes destructive. `--archived` and `--include-archived` together is refused rather than guessed.

### Wire surface

| RPC                                      | Shape                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `delete_agent_request` → `agent_deleted` | Existing flat name, one chat. Kept as-is for back-compat                                         |
| `history.agents.clear_archived.request`  | `{ olderThanDays = 0, dryRun = true }` → `{ matched, deleted, failed, agentIds, dryRun, error }` |

Both are gated by `server_info.features.historyDelete` (`COMPAT(historyDelete)`, v0.7.0). Per the feature contract there is no fallback path: against an older daemon the client says "Update the host" instead of simulating delete. Archive keeps working on every daemon — that is the protocol contract, not a degraded build of this feature.

Three shape decisions worth keeping:

- **Bulk clear is server-side, necessarily.** The history list is cursor-paginated across hosts (`AGENT_HISTORY_PAGE_LIMIT = 200`), so the client never holds the whole archived set. A client-side loop would silently clear only the pages it happened to have fetched, which is the worst possible failure mode for a destructive action.
- **`dryRun` defaults to `true`.** A request that omits the flag previews instead of deleting. It is the one field where the safe answer and the convenient answer differ.
- **Per-item outcome is reported.** `close_items_response` silently omits failures; a destructive batch cannot, so the response carries `deleted`/`failed` counts and the ids that actually went, and the UI can say "deleted 12, 3 could not be deleted."

### Selection is the load-bearing part

`selectArchivedForDeletion` (`packages/server/src/server/agent/history-retention.ts`) is pure and separately tested, because it is the only part of the sweep where a boundary mistake is silent — every id it returns has its record unlinked with no undo.

- A chat with **no `archivedAt` is never selected**, whatever the cutoff. An active chat cannot be swept.
- An **unparseable `archivedAt`** counts as archived but ageless: taken at `olderThanDays: 0`, skipped under any age cutoff, because the safe answer to "how old is this?" is to keep it.
- The cutoff is **inclusive** — archived exactly `olderThanDays` ago is that old.
- A **future** `archivedAt` (clock skew) is not older than any positive cutoff.
- Ids come back **oldest-first**, so a sweep that fails partway through has deleted the chats the user cared least about.

Observed subagents have no stored record, so they are never swept.

### Client-side reconcile

`agent_deleted` always cleaned the Zustand slices thoroughly and never touched react-query, so a deleted row lingered in the history list and sidebar until a manual refresh — which reads as the delete having failed. `applyDeletedAgentResults` (`packages/app/src/history/use-delete-agent.ts`) patches the same four caches `applyArchivedAgentCloseResults` does for archive (`sidebarAgentsList`, `allAgents`, and both history keys), and the push handler calls it for the single and bulk paths alike.

### There is no automatic retention for chat records

Nothing deletes a chat record on a timer. Delete is always a gesture someone made. A daemon-config `historyRetentionDays` was scoped and deliberately not built — Otto should not silently delete a user's history — and the sweep RPC it would drive already exists if that changes.

## Tabs vs archive

These are two distinct concepts that used to be conflated:

| Concept                    | Scope      | Triggers                   |
| -------------------------- | ---------- | -------------------------- |
| **Tab** (workspace layout) | Per-client | User opens/closes a view   |
| **Archive** (lifecycle)    | Global     | Explicit lifecycle gesture |

Closing a tab on a **root chat** still archives — the tab is the chat's home, so closing it means "I'm done with this chat." A confirm dialog protects against archiving a chat with a running agent by accident.

Closing a tab on a **subagent** (any chat with `parentAgentId`) is **layout-only**. The chat stays unarchived and stays in its parent's track. The user can re-open the tab from the track at any time. This is implemented in `handleCloseAgentTab` (`packages/app/src/screens/workspace/workspace-screen.tsx`).

The asymmetry is intentional: a subagent's home is the parent's track, not the tab. Tabs are ephemeral viewing slots; the track is the persistent record of the parent's children.

## The subagents track

The collapsible track above the composer in a chat's pane (`packages/app/src/subagents/track.tsx`). Membership rule (`packages/app/src/subagents/select.ts`):

```
parentAgentId === thisAgent.id  AND  !archivedAt
```

Archived subagents disappear from the track, by design. To remove a subagent from the track without closing its tab, use the **archive button (X)** on the row — it opens a confirm dialog and archives the subagent on confirm. That same archive shows the subagent leave the track on every connected client.

To keep the chat alive but remove it from the parent's track, use **detach**. The daemon clears the parent label, emits the normal agent update, and every client reclassifies the chat from subagent to root/sibling from that updated snapshot.

### Row actions, names, and cost

Row actions are **status-aware** — the primary action matches the row's state. A running or initializing subagent shows **Stop** (transitions it to a terminal state without removing the row); a terminal subagent (`idle` after completion, `error`, or `closed`) shows **Archive** (drops it from the track). Archive is never offered while its agent is running. Stop and the pane's stop control are the _only_ callers of the stop path — tab lifecycle can never reach it, so closing a tab is always layout-only (see [Tabs vs archive](#tabs-vs-archive)). Detach stays a native-subagent-only affordance.

Row names are **frozen labels**, not summaries. A short, stable name is derived once when the subagent starts (from its type, plus an optional truncated slice of the initial task) and never mutates afterward — a provider's streaming progress summary updates the pane's live subtitle, never the row's title, and the projection enforces a hard single-line length cap. This keeps the track readable like a list of tabs.

Each row shows **honest cumulative token cost** right of the name — the running Σ(input + output) the daemon accumulates across the subagent's turns (not a last-turn or estimated number), plus `totalCostUsd` when the provider reports one. The accumulator is universal: it works for any provider and any spawn path, including cost-less local models. The collapsed track header sums the total across all rows, so a fan-out's cost is legible at a glance.

### Row liveness — "alive or hung?" without opening the row

Beyond name and cost, a row carries three signals that answer whether the subagent is still working, in the order Claude Code's own background-task panel uses them: **elapsed time · tokens · tool uses · current tool**. Each renders only when its source reports it, so a row degrades to exactly what it can honestly say — a missing signal is absent, never a zero or a guess.

- **Elapsed** is client-derived: a live ticker while the row is running, frozen at `createdAt → updatedAt` once terminal.
- **`toolUseCount`** is cumulative work done and stays on a finished row (`89 tools` is what it _did_). The daemon keeps it monotonic, so a status-only settle can never walk it back.
- **`currentTool`** is the tool it is running or ran last — the signal that turns "spinning" into "spinning _on a Bash_". Unlike the counters it is **not** monotonic (latest wins) and it is **sticky** across an update that omits it, so a scalar-only progress refresh can't blank it. The projection **drops it on any terminal row**: a finished agent isn't running Bash.

Both wire fields are additive optional leaves on the agent snapshot (`COMPAT(subagentLiveness)`), so old clients ignore them and no capability gate is needed.

The two sources are deliberately different, and that split is the provider-neutrality rule:

- **Observed rows** get both from the provider, through the neutral `ObservedSubagentUpdate` — the same plumbing as `cumulativeTokens`. A provider fills them in its adapter (Claude reads `usage.tool_uses` and `last_tool_name` off the SDK's per-task messages; the adapter contract is in [projects/observed-subagents/provider-adapters.md](../projects/observed-subagents/provider-adapters.md)); one that can't leaves them absent and the row simply omits the readout. Nothing daemon-side infers a tool name.
- **Rows with no provider task report** — native `create_agent` children, and a Workflow run's internal agents (whose fan-out carries no per-agent identity on the live stream) — derive both from the subagent's own timeline: count distinct `tool_call` ids, take the latest name. That derivation lives at the daemon's single timeline chokepoint (`recordAndDispatchTimelineItem`), which both the direct stream path and the stream coalescer's flush pass through. The coalescer is also the anti-strobe mechanism: running tool calls arrive batched, so the row re-emits at the coalesce window's rate rather than per event. Native derivation is scoped to agents carrying a parent-agent label — a main chat renders no track row, so counting one would be pure overhead.

The header aggregate deliberately sums **tokens only**. A tool-use total would silently shrink whenever rows are cleared (only `cumulativeTokens` survives a clear, via the tally below), and a number that quietly drops is worse than no number.

Completed subagents **tidy themselves without being destroyed**: terminal rows move into a collapsed **"Completed (N)"** group at the bottom of the track, keeping their frozen name and final token total, while the active list shows only in-flight subagents. A manual **"Clear all completed"** gesture archives every terminal row at once (never a running one). Nothing is destroyed until the user clears it or the parent is archived (which cascades), so cost and transcript survive the tidy.

### Auto-clear completed subagents

A device-local **Settings → General → Agents** toggle (`autoClearCompletedSubagents`, default off) turns the manual clear into an automatic one: while a chat's panel is mounted, tidy-eligible completed rows archive themselves once they've been terminal for a short settle (`SUBAGENT_AUTO_CLEAR_SETTLE_MS`), so a fan-out's finished rows don't accumulate in the Completed group. It's purely visual decluttering — scoped to a chat's subagents track (root chats are untouched), settle-delayed so a row is visibly finished before it vanishes, and it never retries a row whose archive fails (the manual clear stays available).

Clearing a row (auto **or** manual) would otherwise silently drop its token total from the header's honest fan-out sum, which only counts in-track rows. To prevent that, every cleared row's `cumulativeTokens` is rolled into a per-parent tally (`subagents/cleared-subagent-tokens-store.ts`) that `formatHeaderLabel` adds back in, so **"N tokens"** stays honest after the clear. Like the daemon's `cumulativeTokens` accumulator the tally is in-memory (resets on app reload); the planned per-chat total ([projects/total-token-accounting](../projects/total-token-accounting/total-token-accounting.md)) can read the same tally so cleared descendants keep counting toward the chat total.

## The Background Tasks track

A sibling track (`packages/app/src/background-tasks/track.tsx`), also above the composer, that lists **background shell processes** a provider launched itself — Claude's own `Bash` tool used with `run_in_background: true` — never AI subagents. It renders independently of the subagents track: each is `null` when empty, so either, both, or neither can show at once.

Unlike an observed subagent, a background shell task is **not** an `Agent` record — no chat, no tab, no pane, no transcript. The daemon (`AgentManager.backgroundShellTasks`, `packages/server/src/server/agent/agent-manager.ts`) projects it as a lightweight `{ id, command, status, ... }` row and pushes the full current list for a parent chat on every change (`background_shell_tasks_changed`, mirroring `terminals_changed`'s reconciliation shape). Row actions: **Stop** while running (resolves to the provider's `stopTask`), **Clear** once terminal (single row or bulk "Clear all"; entries are retired in place with `archivedAt`, never deleted, so a late provider update can't resurrect a cleared row).

### Three groups: active, Completed, Failed

Rows partition three ways (`partitionBackgroundTaskRows`), and `status` is the **only** grouping signal: `running` is active, `error` is failed, `idle`/`closed` are completed. Each terminal group collapses into its own header (`Completed (N)`, `Failed (N)`) with its own bulk "Clear all", and the track header summarizes all three ("1 active background task · 2 completed background tasks · 1 failed background task"). A failed row also **renders red** throughout — icon, command, elapsed — so the failure is legible on the row itself rather than inferred from which group it sits in.

The wire also sets `requiresAttention` on a failure, and grouping deliberately ignores it. Reading that flag instead of `status` is what the first version did: failures were pinned in the active list and excluded from auto-clear, but nothing on the row said why, so they read as ordinary finished tasks that had mysteriously refused to tidy. If you add a new signal here, put it on the row before you let it change where the row lives.

### Auto-clearing the terminal groups

Two device-local **Settings → General → Agents** toggles, `autoClearCompletedBackgroundTasks` and `autoClearFailedBackgroundTasks` (both default off), turn the manual clear into an automatic one: while a chat's panel is mounted, rows in an enabled group clear themselves once they've been terminal for a short settle (`BACKGROUND_TASK_AUTO_CLEAR_SETTLE_MS`), so a chatty build's finished shells don't accumulate. One driver instance per group (`useAutoClearCompletedBackgroundTasks({ group })`), each with its own attempted-id set, so neither sweep can ever take the other group's rows. They are **split on purpose**: a finished shell is throwaway (its output is already in the chat), while a failed one is a result you may not have read yet.

Same shape as the sub-agents auto-clear above — settle-delayed, panel-scoped, never retried on failure (the manual clear stays available) — and a **separate setting and separate driver** from it on purpose too: a cleared sub-agent is an archived chat, which is a heavier thing to discard. There is no token tally to preserve here: background task rows carry no `cumulativeTokens`, so clearing one loses nothing the header was counting.

All three auto-clear toggles sit in **General**, not Appearance, because they change what the tracks _do_ rather than how they look. They are device-local `AppSettings` (`use-settings/storage.ts`), never synced to the daemon: the daemon-owned equivalents live under the Host group instead. When adding a setting here, sort it by that split first.

On the Claude adapter (`packages/server/src/server/agent/providers/claude/agent.ts`), background shell tasks ride the exact same `task_started`/`task_progress`/`task_notification` system-message stream as observed subagents — see [observed-subagents.md](../projects/observed-subagents/observed-subagents.md) — discriminated by the originating tool being `Bash` rather than `Task`/`Agent`. Gated behind `server_info.features.backgroundShellTasks`.

### Edge events vs. the native level signal (Claude)

The `task_*` edge stream is the provider-neutral spine — it owns row creation and rich terminal status, and it is the shape other providers are mapped onto. On Claude it has one structural weakness: a lost or garbled `task_notification` leaves a row running forever. Foreground `Task` rows are covered by the turn-end sweep (a foreground task cannot outlive its turn), but backgrounded rows — Workflow runs, background shells — are exempt from the sweep and had no other safety net.

Claude Agent SDK ≥ 0.3.212 emits `system/background_tasks_changed`: a **level signal** carrying the full set of live background tasks with REPLACE semantics, fired on every membership change. `appendBackgroundTasksChangedEvents` reconciles against it: any task id present in the previous payload but absent from the current one is settled (`idle`), covering the lost-edge case. The reconcile never creates rows and never touches foreground rows (only ids seen in a prior payload are eligible; foreground tasks never appear in the level set), and a late-arriving edge for the same transition still lands to refine the status (`idle` → `error`/`closed`). Keep this division when extending: **edges create and describe, the level signal guarantees eventual settle**. Other providers without a level signal keep the edge-only behavior.

## Why this shape

The decision was to **decouple "close tab" from "archive" only for subagents**, rather than universally:

- **Closing a tab on a root chat still archives** — preserves the existing UX users are trained on
- **Closing a tab on a subagent is layout-only** — fixes the lossy "click to read, close to dismiss view, lose the row" flow
- **Archive button on track rows** — gives subagents an explicit lifecycle gesture in their home surface
- **Detach button on track rows** — lets a subagent continue independently without killing its work
- **Cascade archive on parent** — keeps subagents from leaking when the parent is archived

We considered universal decoupling (no tab close ever archives, archive is always explicit) but rejected it: it changes a behavior root-chat users rely on.

## Limitations

### Cross-client tab dismissal

Closing a subagent's tab on one client doesn't affect other clients' layouts. This is the expected behavior of decoupled tabs and is consistent with how layouts have always worked. Archive remains the global gesture for cross-client cleanup.

## Storage

```
$OTTO_HOME/agents/{cwd-with-dashes}/{agent-id}.json
```

`{cwd-with-dashes}` is derived from the chat's filesystem `cwd`. It is not the workspace id; chat storage stays cwd-keyed (under the historical `agents/` directory name) while workspace identity is the opaque workspace id.

Each agent is a single JSON file. Fields relevant to this doc:

| Field                            | Type          | Meaning                                                                                      |
| -------------------------------- | ------------- | -------------------------------------------------------------------------------------------- |
| `id`                             | `string`      | Stable identifier                                                                            |
| `archivedAt`                     | `string?`     | Soft-delete timestamp (ISO 8601). Also the sweep's selector — see [Delete](#delete)          |
| `labels["otto.parent-agent-id"]` | `string?`     | Parent agent ID, set automatically by `create_agent` when `relationship.kind === "subagent"` |
| `lastStatus`                     | `AgentStatus` | `initializing` / `idle` / `running` / `error` / `closed`                                     |

See [`docs/data-model.md`](./data-model.md) for the full agent record.
