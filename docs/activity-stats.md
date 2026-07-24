# Activity Stats

A lightweight "how much has Otto done" dashboard: daemon-tracked lifetime usage counters surfaced as preset time-range rollups, plus an app setting for which screen the app opens to. Deliberately **not** a telemetry/analytics product — no session tracking, no charts, no external reporting; a small local counter store for the user's own curiosity. Gated behind `server_info.features.activityStats` (`COMPAT(activityStats)`, added in v0.5.3).

## The counter store

`ActivityStatsStore` (`packages/server/src/server/activity-stats/activity-stats-store.ts`) follows the "tiny file-backed daemon-wide counter" pattern — cf. `PushTokenStore` (`push/token-store.ts`) and `PersonalityStatsStore` (`agent/personality-stats-store.ts`). Persisted at `$OTTO_HOME/activity-stats.json`, atomic writes via `writeJsonFileAtomic`, with a serialized in-memory queue so concurrent increments never lose counts.

Stats are bucketed by **calendar day** (`YYYY-MM-DD`, local daemon date) plus running all-time totals — no session start/end lifecycle and no crash-recovery bookkeeping. The day bucket is decided at increment time, so counting survives daemon restarts, multiple concurrent clients, and the phone app backgrounding/foregrounding. The `daily` map is trimmed to ~35 days on each persist (comfortably covers the 30-day rollup).

```ts
interface ActivityCounters {
  messagesSent: number;
  messagesReceived: number;
  tokensSent: number;
  tokensReceived: number;
  agentsCreated: number;
  runsOrchestrated: number;
  subagentsInvoked: number;
  backgroundTasksInvoked: number;
  thoughts: number;
  toolsCalled: number;
  artifactsCreated: number;
  schedulesExecuted: number;
}

interface ActivityStatsFile {
  version: 1;
  allTime: ActivityCounters;
  daily: Record<string, ActivityCounters>; // "YYYY-MM-DD", local date
}
```

Each of the 12 counters is an individually optional, additive leaf on both the stored JSON and the protocol schema, so new counters can be added — or existing ones dropped from the UI — in later passes without a migration or a breaking change. `increment(field, by = 1)` bumps both `allTime[field]` and today's bucket, then persists; `getRollups()` sums the map into the preset windows on read.

## The usage log

Sibling store to the counters: `UsageLogStore` (`packages/server/src/server/activity-stats/usage-log-store.ts`), mirroring `ActivityStatsStore`'s serialized-queue + atomic-write + coalesce shape. It backs the **Log** tab on the Metrics screen (Summary | Log) — the itemized rows behind the tiles, so a user can scroll every token-costing activity with its model and cost rather than only reading aggregates. Gated behind `server_info.features.usageLog` (`COMPAT(usageLog)`, added in v0.6.4).

**One event, two sinks.** At the existing `AgentManager.recordUsageActivity` chokepoint the daemon builds one `UsageEvent`, then (1) appends it to the capped log and (2) folds it into the day-bucketed counters above. The tiles are therefore the log's rollup **by construction** — one source event, so the two surfaces cannot structurally disagree. The dual-write is **best-effort, with no transactional coupling** between the two files: if they drift by a row, that is accepted rather than defended against.

**Why the counters stay their own durable store** (rather than being recomputed from the log on read): the log is rotated to a **30-day age window**, while the cumulative "All Time" tiles must outlive trimmed rows. Row = bounded detail; counter = cumulative summary, persisted forever as tiny running totals. Retention is the age window only — there is no row cap, so every row inside 30 days is kept.

**What earns a row:** only the token/cost-_bearing_ activities — chat turns, sub-agent turns, and generations (bare completions: titles, names, commit/PR messages, summaries). Compaction is a slice _within_ a turn's usage (openai-compat folds it into the turn's reported usage, so billing it separately would double-count), so it rides its turn's row as a sub-figure rather than standing as its own row. The pure tallies — `messagesSent`, `agentsCreated`, `toolsCalled`, `artifactsCreated`, `schedulesExecuted` — are cost-free counts and are never log rows.

On the wire, `UsageEvent` `kind`/`provider` are `z.string()` rather than enums so an old client still parses kinds a newer daemon invents. The log reuses the existing `activity_stats_changed` push for live refresh instead of adding its own notification, since it writes at the same chokepoint that moves the counters.

## Chokepoints

`ActivityStatsStore` is instantiated once in `bootstrap.ts` and threaded into `AgentManager`, `RunService`, `ScheduleService`, and `ArtifactService`, which call `increment(field)` at:

| Counter                                                          | Chokepoint                                                                                                                                            |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agentsCreated`                                                  | `AgentManager.createAgent` → `createAgentInternal`                                                                                                    |
| `subagentsInvoked`                                               | Same `createAgent` path when `relationship.kind === "subagent"`, plus `appendObservedSubagentTaskEvent` on `task_started` (observed Claude subagents) |
| `backgroundTasksInvoked`                                         | The `background: true` resolution point in `agent/tools/otto-tools.ts` (create_agent / send_message handlers)                                         |
| `runsOrchestrated`                                               | `RunService.startRun`                                                                                                                                 |
| `schedulesExecuted`                                              | `ScheduleService.runSchedule`                                                                                                                         |
| `artifactsCreated`                                               | `ArtifactService.create`                                                                                                                              |
| `messagesSent` / `messagesReceived` / `thoughts` / `toolsCalled` | `AgentManager.recordAndDispatchTimelineItem` — switch on `item.type`                                                                                  |
| `tokensSent` / `tokensReceived`                                  | `AgentManager.onStreamTurnCompleted` — same per-turn `event.usage` already summed by `accumulateAgentTokens`                                          |

## Protocol & client

RPC pair `stats.activity.get.request` / `stats.activity.get.response` (per [rpc-namespacing.md](rpc-namespacing.md), modeled on `provider.usage.list`). The client never sees raw daily buckets — the daemon computes five preset rollup windows on request: **Today, Yesterday, Last 7 Days, Last 30 Days, All Time** — a fixed-shape payload with no date math on the client. The client queries on focus + manual refresh (`use-activity-stats.ts`), rendering a stat-tile grid at the `/stats` route (`stats-screen.tsx`), reached from a `Sparkles` button in the sidebar footer.

**Reset:** the `stats.activity.reset.request`/`.response` RPC pair wipes both usage sinks in one shot — `ActivityStatsStore.reset()` (all-time totals + every day bucket) and the sibling `UsageLogStore.reset()` (the itemized ledger behind the Log tab) — so the tiles and rows start fresh together. Wired in `bootstrap.ts` as a single callback threaded through `websocket-server` → `session` alongside `getActivityRollups`. Gated behind `server_info.features.statsReset` (`COMPAT(statsReset)`, added in v0.6.4): the app's Metrics screen only shows its **Reset** button (behind a destructive confirm dialog) when the daemon advertises the capability, so an old daemon with no handler never receives a request that would hang. `ActivityStatsStore.reset()` fires the coalesced change notification, so the same `activity_stats_changed` ping re-syncs every client (the client also invalidates both queries locally for an instant wipe).

**Live updates:** the daemon also broadcasts a payload-free `activity_stats_changed` notification whenever any counter moves, coalesced in `ActivityStatsStore` (`onDidChange`, max one per ~2s) so bursts stay quiet. The client (session-context) invalidates the stats query on that ping — a focused Metrics screen refetches immediately (consistent with the invalidation-only react-query convention), an unmounted one just goes stale. Tiles flash a brief accent highlight when their displayed value changes. Purely additive: old clients drop the unknown message type, old daemons never send it (screen degrades to focus/manual refresh), so it rides the existing `activityStats` capability with no new feature flag.

## App start screen

`appStartScreen: "dashboard" | "home" | "workspaces"` on `AppSettings` (`use-settings/storage.ts`, default `"workspaces"` — today's restore behavior, unchanged) chooses the app's landing screen, branched in `resolveHostIndexRoute` (`host-runtime-bootstrap.ts`) after the existing restore computation: `dashboard` → `/stats`, `home` → `/open-project`, `workspaces` → restore. This keeps the `/` → `/h/[serverId]` → leaf two-hop shape from [expo-router.md](expo-router.md) intact. Configured via a `SegmentedControl` row in the General settings section.
