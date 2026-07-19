# History Management — charter

> Point-in-time build plan. Give archived chats a **way out**. Today archive is a soft delete with no
> counterpart: `archivedAt` gets set, the record stays on disk forever, and no app surface can remove
> it. This charter adds **per-row delete**, **bulk clear**, and an honest answer to the orphaned
> provider-transcript problem — plus fixes five retention bugs found while mapping the ground truth.
>
> **Status: charter only — no code yet.** Decisions marked **[PROPOSED]** need a user call before
> Phase 1; everything else is grounded in the code as it stands (2026-07-19, working tree).

## 1. Mission

Otto's archive is a one-way door. A user can archive a chat, unarchive it, and… that's the whole
vocabulary. There is no delete in the app, no bulk clear, no retention, and no telling the user any of
this. Meanwhile the newest subsystem in the same area — the usage ledger — has a documented 30-day
window and a Reset button behind a destructive confirm. **The oldest data store has the weakest
policy.** This charter closes that gap and makes the retention story consistent across the two places
Otto accumulates history: agent records and the metrics ledger.

Framing: [total-token-accounting](../total-token-accounting/total-token-accounting.md) owns "what did
this chat cost"; [usage-ledger](../usage-ledger/usage-ledger.md) owns "itemize the spend"; History
Management owns **"how do I get rid of it."**

## 2. Ground truth (from exploration)

### 2.1 Archive is purely a flag — nothing is removed

- [agent-archive.ts:10-24](../../packages/server/src/server/agent/agent-archive.ts) — `buildArchivedAgentRecord()`
  spreads the record unchanged and stamps `archivedAt`; normalizes `lastStatus` (:26-30), clears
  attention flags. No payload dropped.
- [agent-manager.ts:2174-2190](../../packages/server/src/server/agent/agent-manager.ts) —
  `markRecordArchived()` does `registry.upsert(...)`, **not** a remove.
- [agent-storage.ts:297-315](../../packages/server/src/server/agent/agent-storage.ts) —
  `applySnapshot()` explicitly preserves `archivedAt` across every later persist.
- [docs/agent-lifecycle.md:37](../../docs/agent-lifecycle.md) states the intent outright: "Archive is a
  **soft delete**". That's correct and stays correct — this charter adds the _hard_ delete beside it,
  it does not change what archive means.

### 2.2 A hard-delete path already exists — it just has no UI

| Path                       | Where                                                                                                                                                 | Status                                                                                                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `delete_agent_request` RPC | schema [messages.ts:1225-1230](../../packages/protocol/src/messages.ts) · handler [session.ts:2707-2751](../../packages/server/src/server/session.ts) | **Works.** Delete-fence → `closeAgentCommand` → `flush()` → `agentStorage.remove()` (:2732) → `deleteCommittedTimeline` (:2733) → emits `agent_deleted` (:2738) |
| `AgentStorage.remove()`    | [agent-storage.ts:258-282](../../packages/server/src/server/agent/agent-storage.ts)                                                                   | Unlinks every indexed JSON path + drops caches. Sole non-test caller is `session.ts:2732`                                                                       |
| `otto delete <id>`         | [cli/src/commands/agent/delete.ts](../../packages/cli/src/commands/agent/delete.ts)                                                                   | Works **by ID only** — see §2.4                                                                                                                                 |
| `client.deleteAgent()`     | [daemon-client.ts:2305-2326](../../packages/client/src/daemon-client.ts)                                                                              | Works, awaits `agent_deleted`                                                                                                                                   |
| `_deleteAgent` (app)       | [session-context.tsx:1939-1947](../../packages/app/src/contexts/session-context.tsx)                                                                  | **Dead code** — underscore-prefixed, never exported, never called                                                                                               |

So Phase 1 is mostly _wiring_, not new plumbing. That's the good news.

### 2.3 No retention for agent records, anywhere

No `purge` / `prune` / `retention` / `maxAge` / `ttl` / `gc` handler exists for agents in
`packages/server` or `packages/protocol`. `bootstrap.ts` has no agent sweep. Retention that _does_
exist — and pointedly does not cover agents:

| What                   | Where                                                                                                          | Rule                                                                                                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Usage ledger           | [usage-log-store.ts:14, 101-105](../../packages/server/src/server/activity-stats/usage-log-store.ts)           | 30-day age window, **no row cap** (deliberate, test-locked at [usage-log-store.test.ts:79-101](../../packages/server/src/server/activity-stats/usage-log-store.test.ts)) |
| Activity stats dailies | [activity-stats-store.ts:95, 302-308](../../packages/server/src/server/activity-stats/activity-stats-store.ts) | 35 **buckets** (not days — see §6.2), trimmed on every `increment()`                                                                                                     |
| Artifact run history   | [artifact-store.ts:127](../../packages/server/src/server/artifact/artifact-store.ts)                           | oldest attempts pruned                                                                                                                                                   |
| Download tokens        | [token-store.ts:29, 56](../../packages/server/src/server/file-download/token-store.ts)                         | expiry-based                                                                                                                                                             |

**Cost of no retention is not just disk.** [agent-storage.ts:334-417](../../packages/server/src/server/agent/agent-storage.ts)
`load()`/`scanDisk()` reads **every** `*.json` under `$OTTO_HOME/agents/**` into memory at daemon start
with no age filter. A large archive is a permanent startup-latency and RAM tax.

### 2.4 The CLI actively refuses to clear the archive

[delete.ts:66](../../packages/cli/src/commands/agent/delete.ts) — `--all` filters `!a.archivedAt`;
[:69](../../packages/cli/src/commands/agent/delete.ts) — `--cwd` does the same. By-ID delete
([:71-81](../../packages/cli/src/commands/agent/delete.ts)) uses `fetchAgent` with no archived filter,
so it _does_ work on archived agents. Net: the one bulk command deliberately skips exactly the rows a
user most wants gone. **This is a bug, not a design** — §6.3.

### 2.5 What's actually on disk per archived chat

1. **Agent record** — `$OTTO_HOME/agents/<sanitized-cwd>/<agent-id>.json`
   ([agent-storage.ts:430-433, 453-464](../../packages/server/src/server/agent/agent-storage.ts)).
   Single-digit KB, **bounded** — does not grow with conversation length. One file per agent, forever.
2. **Message history** — **not persisted by Otto in production.** The durable timeline store is
   optional ([agent-manager.ts:331, 1043, 1152](../../packages/server/src/server/agent/agent-manager.ts))
   and **never constructed in `bootstrap.ts`**; the live store is `InMemoryAgentTimelineStore`
   ([:1036](../../packages/server/src/server/agent/agent-manager.ts)). History is rehydrated from the
   provider (`streamHistory()`, :4145-4160). ⇒ `deleteCommittedTimeline` is a **no-op in production**.
3. **Provider-native transcripts** — the real bulk, growing linearly with conversation length,
   referenced only by `persistence.sessionId`
   ([agent-types.ts:174-180](../../packages/protocol/src/agent-types.ts)). **Otto never deletes these.**
   There is an `archiveNativeSessionBestEffort()`
   ([agent-manager.ts:5916-5931](../../packages/server/src/server/agent/agent-manager.ts), Codex-only
   today) but **no delete counterpart**. Hard-deleting an agent today _orphans_ its transcripts.

## 3. The load-bearing decision — orphaned native transcripts

This is the one thing that must be settled before code, because it changes the RPC shape, the confirm
copy, and the trust model.

**The daemon can compute the path.** For Claude, deterministically from `cwd` + `sessionId`:

- [project-dir.ts:18-31](../../packages/server/src/server/agent/providers/claude/project-dir.ts) —
  `claudeProjectDir(cwd)` → `<configDir>/projects/<encoded>`; encoder at :53-67; config dir resolution
  at :69-71 (`CLAUDE_CONFIG_DIR ?? ~/.claude`). A verbatim port of the SDK's encoding, with tests.
- [agent.ts:5558-5580](../../packages/server/src/server/agent/providers/claude/agent.ts) —
  `resolveHistoryPath(sessionId)` → `<projectDir>/<sessionId>.jsonl`, trying `cwd` then `realpath`.
- Sibling **directory**, not just the file:
  `<projectDir>/<sessionId>/subagents/agent-<id>.jsonl`
  ([task-transcript-watcher.ts:13, 270-283](../../packages/server/src/server/agent/providers/claude/task-transcript-watcher.ts))
  and `<projectDir>/<sessionId>/subagents/workflows/<wf_runId>/…` + `<projectDir>/<sessionId>/workflows/<wf_runId>.json`
  ([workflow-transcript-watcher.ts:9-13, 194-198](../../packages/server/src/server/agent/providers/claude/workflow-transcript-watcher.ts)).

**[PROPOSED] Opt-in, off by default, via `confirmDialogWithCheckbox`.** Delete removes Otto's record
always; the native transcript tree only when the user ticks "Also delete the provider's transcript
files." Reasons: (a) those files are the provider's, not Otto's — Otto never created them and
`claude --resume` reads them; (b) they're shared ground with the Claude CLI, and silently deleting
another tool's state is the kind of thing that destroys trust once and permanently; (c) the checkbox
variant already exists ([confirm-dialog.ts:3-13, 50-55](../../packages/app/src/utils/confirm-dialog.ts)),
so it's free. Rejected alternatives: _always delete_ (surprising, unrecoverable, cross-tool); _never
delete_ (leaves the actual disk growth unaddressed and makes "delete" a lie).

**Ordering constraint for the implementation:** `handleDeleteAgentRequest` calls
`agentStorage.remove(agentId)` at [session.ts:2732](../../packages/server/src/server/session.ts) and
fences at :2716 — the transcript path must be resolved from the record **before** :2732.

## 4. Protocol

Follows [rpc-namespacing.md](../../docs/rpc-namespacing.md). Note `delete_agent_request` is an existing
**flat** name and stays as-is (back-compat); new RPCs use dotted namespaces.

- **Feature gate:** `serverInfo.features.historyDelete: z.boolean().optional()` in
  [messages.ts:~3806](../../packages/protocol/src/messages.ts) beside `statsReset`, with
  `// COMPAT(historyDelete): added in vX.Y, drop the gate when floor >= vX.Y`. Advertised in
  [websocket-server.ts:~1409](../../packages/server/src/server/websocket-server.ts) using the same
  derive-from-wired-handler idiom (`this.deleteAgents !== undefined`), not a literal `true`.
- **Bulk delete:** `history.agents.delete.request` / `.response`, mirroring
  `close_items_request` ([messages.ts:1237-1242](../../packages/protocol/src/messages.ts)) but with
  **per-item success reporting** — `close_items_response` silently omits failures
  ([session.ts:2853-2892](../../packages/server/src/server/session.ts)), which is wrong for a
  destructive action where the UI must say "3 of 5 deleted":
  ```ts
  request  { type, agentIds: z.array(z.string()).default([]), deleteNativeTranscripts: z.boolean().optional(), requestId }
  response { type, payload: { agents: z.array(z.object({ agentId, deleted: z.boolean(), error: z.string().optional() })), requestId } }
  ```
  Handler modeled on `handleCloseItemsRequest` (`Promise.allSettled` + one response), per-agent body
  reusing `handleDeleteAgentRequest`'s internals (:2707-2751).
- **Sweep RPC (Phase 3):** `history.agents.sweep.request` / `.response` —
  `{ olderThanDays: number, scope: "archived" | "all", dryRun: boolean }` → `{ matched, deleted, freedBytes }`.
  `dryRun` first so the confirm can say "this will delete 143 chats."
- **Single delete** keeps using the existing `delete_agent_request`; the bulk RPC is not a replacement.

## 5. App surface

### 5.1 Per-row delete

The archive/history screen is [sessions-screen.tsx](../../packages/app/src/screens/sessions-screen.tsx)
(`useAgentHistory` at :34-37) rendering [agent-list.tsx](../../packages/app/src/components/agent-list.tsx).
Rows are `SessionRow` (:206-359); archived rows are distinguished **only** by a badge (:170-172), with
no dimming and no trailing affordance.

Long-press today ([:425-441](../../packages/app/src/components/agent-list.tsx)): running → action
sheet; otherwise → **archive immediately, no confirm** (:438). **[PROPOSED] seam:** branch on
`agent.archivedAt != null` — an already-archived row opens a sheet whose action is **Delete**
(destructive) rather than re-archiving a no-op. This is the minimal change and it reads correctly:
long-press means "remove this from my list," and what that means depends on where it already is.

**Reuse `confirmDialog`, not the bespoke sheet.** [agent-list.tsx:553-587](../../packages/app/src/components/agent-list.tsx)
is a raw RN `<Modal>` bottom sheet with a two-button flex row (styles :788-817) that predates the
shared primitive. The delete confirm goes through
[confirm-dialog.ts](../../packages/app/src/utils/confirm-dialog.ts) (`destructive: true`, plus
`confirmDialogWithCheckbox` for §3), rendered by `ConfirmDialogHost` — the same path the Metrics Reset
button uses ([stats-screen.tsx:380-391](../../packages/app/src/screens/stats-screen.tsx)).

### 5.2 The cache-reconcile gap — highest-value single fix

`agent_deleted` **is** handled in the store:
[session-context.tsx:1654-1726](../../packages/app/src/contexts/session-context.tsx) removes the agent
from `agents`, `agentLastActivity`, `agentStreamTail`, stream head, `agentTimelineCursor`, draft input,
`pendingPermissions`, and `initializingAgents`.

**But it never touches the react-query caches** — no invalidate of `agentHistoryQueryKey(serverId)` /
`allAgentHistoryQueryRootKey()`, no removal from `["sidebarAgentsList", serverId]` / `["allAgents", serverId]`.
Compare `applyArchivedAgentCloseResults` in
[use-archive-agent.ts](../../packages/app/src/hooks/use-archive-agent.ts), which patches all four.
⇒ **A deleted row will linger in the history list until manual refresh.** Fix this in Phase 1 or the
feature will look broken on first use. `applyArchivedAgentCloseResults` already takes an array of
results, so a `applyDeletedAgentResults` sibling is the shape.

### 5.3 Bulk clear

Mirror the [clear-completed-subagents](../../packages/app/src/subagents/clear-completed-subagents.ts)
pattern — pure `resolveClearCompletedDialog(count)` (:11-22) + pure core fn (:51-69) + thin hook
injecting `confirmDialog`/toast ([use-clear-completed-subagents.ts:26-50](../../packages/app/src/subagents/use-clear-completed-subagents.ts)).
**One difference that matters:** that helper loops `Promise.all` over rows the client already holds.
History is **cursor-paginated** (`useInfiniteQuery`, `AGENT_HISTORY_PAGE_LIMIT = 200`,
[use-agent-history.ts:14, 198-219](../../packages/app/src/hooks/use-agent-history.ts)) across multiple
hosts — the client does **not** hold all archived rows. ⇒ bulk clear **must** be the server-side sweep
RPC (§4), not a client loop. This is exactly why Phase 3 exists.

### 5.4 Gating

Client reads `features?.historyDelete === true` via a `useHistoryDeleteFeature` hook mirroring
[use-activity-stats.ts:59-65](../../packages/app/src/hooks/use-activity-stats.ts) (`useStatsResetFeature`).
Per the feature contract: **no fallback path** — an old daemon simply doesn't offer delete. No gated
`feature-catalog.ts` entry needed; this is a small surface, not a lazy-split panel.

## 6. Bugs to fix alongside (found while mapping)

Each is independent, small, and defensible on its own.

### 6.1 Ledger pruning never runs at rest

`trim()` runs only inside `append()`
([usage-log-store.ts:148-157](../../packages/server/src/server/activity-stats/usage-log-store.ts));
`load()` (:127-141) and `sanitizePersisted` (:83-99) do no age filtering, and `getPage()` (:216-227) is
a pure slice. A daemon that boots and records no new usage **serves rows arbitrarily older than 30
days**. Fix: trim in `load()`.

### 6.2 Activity-stats trims by bucket count, not age

[activity-stats-store.ts:302-308](../../packages/server/src/server/activity-stats/activity-stats-store.ts)
`trimOldDays()` sorts keys lexically and drops `keys.length - 35`. A daemon idle for months keeps its
last 35 **non-empty** day keys even if a year old — inert (`getRollups()` :284-290 finds nothing
recent) but retained. Cosmetic; fix by also dropping keys older than `DAILY_RETENTION_DAYS`.

### 6.3 `otto delete --all` skips archived agents

[delete.ts:66, 69](../../packages/cli/src/commands/agent/delete.ts). **[PROPOSED]** add `--archived`
(only archived) and `--include-archived` (both), leaving the bare `--all` default unchanged so nobody's
muscle memory becomes destructive.

### 6.4 `usageLogStore.flush()` never runs on shutdown

Documented as "graceful shutdown / tests"
([usage-log-store.ts:196](../../packages/server/src/server/activity-stats/usage-log-store.ts)) but the
shutdown path ([bootstrap.ts:1971-1992](../../packages/server/src/server/bootstrap.ts)) flushes
`agentManager`/`agentStorage` only, and the write timer is `unref()`'d (:193). Up to ~2s of appended
ledger rows are lost on every daemon exit. One-line fix.

### 6.5 Undocumented retention

Neither [docs/activity-stats.md](../../docs/activity-stats.md) nor
[docs/subagent-accounting.md](../../docs/subagent-accounting.md) states the ledger's 30-day window —
the only written statement of intent is the code comment at `usage-log-store.ts:6-13`. Also
`docs/activity-stats.md:12-25, 34` is **stale**: it documents 12 `ActivityCounters` fields; the code
now has 26 ([activity-stats-store.ts:19-49, 64-91](../../packages/server/src/server/activity-stats/activity-stats-store.ts)).

## 7. Phased build plan

- **Phase 0 — retention bugs + docs.** §6.1, §6.2, §6.4, §6.5, §6.3. No protocol change, no UI. Ships
  standalone and de-risks the rest.
- **Phase 1 — per-row delete (the proof).** Wire the existing `delete_agent_request` into the app:
  un-dead `_deleteAgent`, `features.historyDelete` gate, the long-press-on-archived → destructive
  confirm seam (§5.1), **and the cache reconcile of §5.2**. Native transcripts untouched in this phase.
- **Phase 2 — native transcript opt-in.** `deleteNativeTranscripts` flag, Claude path resolution
  (§3), the `<sessionId>/` sibling tree, `confirmDialogWithCheckbox` copy. Claude is the proof
  provider; Codex/others get the "not supported on this provider" branch per the fork's
  single-provider-as-proof rule.
- **Phase 3 — bulk clear + sweep.** `history.agents.delete.request` (multi-select) and
  `history.agents.sweep.request` with `dryRun`. An archived-vs-active filter on the history screen
  (there is none today, §5.1) is a prerequisite for multi-select to feel sane.
- **Phase 4 — optional auto-retention.** A daemon config `historyRetentionDays` (default **off** —
  Otto should never silently delete a user's history), hot-reloadable via `MutableDaemonConfig` like
  rate-limit-warnings/speech, with a settings UI. Runs the Phase 3 sweep on a timer.

Phases 0 and 1 are independently shippable and together answer the original question.

## 8. Testing

- Pure units for `resolveDeleteAgentDialog` / sweep matching, in the
  [clear-completed-subagents.test.ts](../../packages/app/src/subagents/clear-completed-subagents.test.ts)
  style.
- Transcript path resolution: temp fixture tree asserting `<projectDir>/<sessionId>.jsonl` **and** the
  `<sessionId>/` sibling dir are both resolved, plus the realpath fallback — beside
  [project-dir.test.ts](../../packages/server/src/server/agent/providers/claude/project-dir.test.ts).
- Delete ordering: assert the transcript path is captured **before** `agentStorage.remove()` (§3).
- Retention: extend `usage-log-store.test.ts` with a load-time-trim case (§6.1) — note the existing
  no-row-cap test at :79-101 must keep passing.
- Protocol round-trip via the [ad-hoc daemon harness](../../docs/ad-hoc-daemon-testing.md).
- Back-compat: old client parses `features.historyDelete`; old daemon (no flag) → client hides delete.
- Per CLAUDE.md: `npx vitest run <file> --bail=1` on changed files only; full suite via CI.

## 9. Open questions

- **§3 transcript opt-in** — proposed opt-in-checkbox; alternatives are always/never.
- **§5.1 long-press seam** — proposed archived-row-opens-delete-sheet; alternative is a trailing icon
  button on the row, or a third button in the existing sheet (needs a vertical restack, styles :788-817).
- **Should delete be reachable for _non_-archived chats?** Proposed **no** — archive first, then
  delete. Two-step destruction is the right friction, and it keeps `handleAgentLongPress`'s fast-path
  archive intact.
- **Cross-provider transcript deletion** — Codex threads, OpenCode sessions. Claude is the proof;
  the rest is a per-provider registry like `archiveNativeSessionBestEffort`.
- **Should the sweep report freed bytes?** Requires stat-ing transcripts; nice for the confirm copy
  ("frees ~1.2 GB"), costs a walk. Probably worth it — it's the number that motivates the action.

## 10. Concrete file-touch map

**Daemon**

- [session.ts:2707-2751](../../packages/server/src/server/session.ts) — extend `handleDeleteAgentRequest`
  with transcript deletion (resolve **before** :2732); add `handleHistoryAgentsDeleteRequest` /
  `handleHistoryAgentsSweepRequest` modeled on `handleCloseItemsRequest` (:2853-2892); dispatch beside :1996-2000.
- `packages/server/src/server/agent/native-transcript-delete.ts` — **new**, per-provider transcript
  path resolution + delete, sibling to `archiveNativeSessionBestEffort` ([agent-manager.ts:5916-5931](../../packages/server/src/server/agent/agent-manager.ts)).
- [providers/claude/project-dir.ts](../../packages/server/src/server/agent/providers/claude/project-dir.ts) · [agent.ts:5558-5580](../../packages/server/src/server/agent/providers/claude/agent.ts) — reuse `claudeProjectDirSync` / `resolveHistoryPath`.
- [websocket-server.ts:~1409](../../packages/server/src/server/websocket-server.ts) — advertise `features.historyDelete`.
- [activity-stats/usage-log-store.ts](../../packages/server/src/server/activity-stats/usage-log-store.ts) · [activity-stats-store.ts](../../packages/server/src/server/activity-stats/activity-stats-store.ts) · [bootstrap.ts:1971](../../packages/server/src/server/bootstrap.ts) — §6.1/6.2/6.4.

**Protocol**

- [messages.ts](../../packages/protocol/src/messages.ts) — `history.agents.delete.*`, `history.agents.sweep.*`
  (inbound + outbound unions + exported types), `features.historyDelete` (COMPAT-tagged, beside :3806).
  Regenerate `generated/validation/ws-outbound.aot.ts` per [protocol-validation.md](../../docs/protocol-validation.md).

**Client**

- [daemon-client.ts:2305-2326](../../packages/client/src/daemon-client.ts) — `deleteAgents()` / `sweepHistory()` beside `deleteAgent()`.

**App**

- [session-context.tsx:1654-1726](../../packages/app/src/contexts/session-context.tsx) — add react-query
  reconcile to the `agent_deleted` handler (§5.2); un-dead `_deleteAgent` at :1939-1947.
- `packages/app/src/hooks/use-delete-agent.ts` — **new**, mirroring [use-archive-agent.ts](../../packages/app/src/hooks/use-archive-agent.ts) incl. an `applyDeletedAgentResults`.
- [agent-list.tsx:425-441, 553-587](../../packages/app/src/components/agent-list.tsx) — the archived-row delete seam; route through `confirmDialog`.
- [sessions-screen.tsx](../../packages/app/src/screens/sessions-screen.tsx) — archived/active filter + multi-select (Phase 3).
- `packages/app/src/hooks/use-history-delete-feature.ts` — **new**, mirroring `useStatsResetFeature` ([use-activity-stats.ts:59-65](../../packages/app/src/hooks/use-activity-stats.ts)).
- [i18n/resources/en.ts](../../packages/app/src/i18n/resources/en.ts) — `agentList.deleteSheet.*`, sweep copy. English-only until verified.

**CLI**

- [commands/agent/delete.ts:66, 69](../../packages/cli/src/commands/agent/delete.ts) — `--archived` / `--include-archived` (§6.3).

**Docs (on ship)**

- [docs/agent-lifecycle.md:37](../../docs/agent-lifecycle.md) — document hard delete beside soft delete.
- [docs/activity-stats.md](../../docs/activity-stats.md) — ledger retention + the stale counter list (§6.5).
