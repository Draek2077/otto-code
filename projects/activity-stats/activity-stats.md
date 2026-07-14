# Activity Stats

**Status:** Charter — build in progress. Drafted 2026-07-13.

A lightweight, fun "how much has Otto done" dashboard: daemon-tracked usage counters (messages,
tokens, agents created, runs orchestrated, sub-agents invoked, background tasks invoked, thoughts,
tool calls, artifacts created, schedules executed) shown as preset time-range rollups, plus a new
app setting for what screen the app opens to.

This is intentionally **not** a telemetry/analytics product — no session tracking, no charts, no
external reporting. It's a small daemon-side counter store and a simple client dashboard, purely
for the user's own fun/curiosity.

---

## Design

### Time-bucketed, not session-bucketed

Stats are bucketed by calendar day (`YYYY-MM-DD`, local daemon date) plus running all-time totals.
No session start/end lifecycle, no crash-recovery bookkeeping — just "which day's bucket does this
increment belong to," decided at increment time. This survives daemon restarts, multiple concurrent
clients, and the phone app backgrounding/foregrounding, since nothing depends on a connection
boundary.

The client never sees raw daily buckets. The daemon computes five preset rollup windows on
request — **Today, Yesterday, Last 7 Days, Last 30 Days, All Time** — by summing the relevant slice
of the `daily` map. Fixed-shape payload, no date math on the client.

### Counters are additive and extensible

Each of the 12 fields is an individually optional, additive leaf on both the stored JSON and the
protocol schema. New counters can be added, and existing ones dropped from the UI, in later passes
without a migration or a breaking change.

### Daemon: `ActivityStatsStore`

`packages/server/src/server/activity-stats/activity-stats-store.ts`, modeled on `PushTokenStore`
(`packages/server/src/server/push/token-store.ts`) and `PersonalityStatsStore`
(`packages/server/src/server/agent/personality-stats-store.ts`) — the existing "tiny file-backed
daemon-wide counter" pattern. Persisted at `$OTTO_HOME/activity-stats.json`, atomic writes via
`writeJsonFileAtomic`, serialized in-memory queue so concurrent increments can't lose counts.

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

`daily` is trimmed on every persist to ~35 days (comfortably covers the 30-day rollup).
`increment(field, by = 1)` bumps both `allTime[field]` and today's bucket, then persists.
`getRollups()` sums the map into the five preset windows on read (all-time reads `allTime`
directly, no summing).

### Chokepoints

| Counter                                                          | Chokepoint                                                                                                                                                                                               |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agentsCreated`                                                  | `AgentManager.createAgent` → `createAgentInternal` (`agent-manager.ts:1132`)                                                                                                                             |
| `subagentsInvoked`                                               | Same `createAgent` path when `relationship.kind === "subagent"`, plus `AgentManager.appendObservedSubagentTaskEvent` (`providers/claude/agent.ts:4080`, on `task_started`) for observed Claude subagents |
| `backgroundTasksInvoked`                                         | The `background: true` resolution point in `packages/server/src/server/agent/tools/otto-tools.ts` (create_agent/send_message tool handlers)                                                              |
| `runsOrchestrated`                                               | `RunService.startRun` (`packages/server/src/server/orchestration/run-service.ts:135`)                                                                                                                    |
| `schedulesExecuted`                                              | `ScheduleService.runSchedule` (`packages/server/src/server/schedule/service.ts:757`)                                                                                                                     |
| `artifactsCreated`                                               | `ArtifactService.create` (`packages/server/src/server/artifact/artifact-service.ts:194`)                                                                                                                 |
| `messagesSent` / `messagesReceived` / `thoughts` / `toolsCalled` | `AgentManager.recordAndDispatchTimelineItem` (`agent-manager.ts:4221`) — switch on `item.type`                                                                                                           |
| `tokensSent` / `tokensReceived`                                  | `AgentManager.onStreamTurnCompleted` (`agent-manager.ts:3818`) — same per-turn `event.usage` already summed by `accumulateAgentTokens`                                                                   |

`ActivityStatsStore` is instantiated once in `bootstrap.ts` and threaded into `AgentManager`,
`RunService`, `ScheduleService`, `ArtifactService`.

### Protocol

Per `docs/rpc-namespacing.md`, modeled on `provider.usage.list`:

```ts
stats.activity.get.request; // { type, requestId }
stats.activity.get.response; // { type, payload: { requestId, today, yesterday, last7Days, last30Days, allTime } }
```

`server_info.features.activityStats: z.boolean().optional()` capability flag,
`COMPAT(activityStats)` tagged. No live-push channel for v1 — client queries on focus + manual
refresh.

### Client

- `packages/app/src/hooks/use-activity-stats.ts`, modeled on `use-provider-usage.ts`.
- New route `/stats` (`stats.tsx` → `stats-screen.tsx`), mirroring `sessions.tsx`/`runs.tsx`.
- Stat-tile grid, one section per rollup window, selected via a small segmented control.
- New `Sparkles` icon button in `SidebarFooter` (`left-sidebar.tsx`), same row as Home/Settings.

### App start-screen setting

`appStartScreen: "dashboard" | "home" | "workspaces"` added to `AppSettings`
(`use-settings/storage.ts`), default `"workspaces"` (today's behavior, unchanged). `"home"` always
opens `/open-project`; `"dashboard"` always opens `/stats`. Wired into `resolveHostIndexRoute`
(`host-runtime-bootstrap.ts`) as a branch after the existing restore computation, keeping the
`/` → `/h/[serverId]` → leaf two-hop shape from `docs/expo-router.md` intact. Settings UI: new
`SegmentedControl` row in `GeneralSection` (`settings-screen.tsx`).

---

## Build sequence

1. Charter (this file).
2. Daemon store + chokepoints — verify via direct file inspection of `activity-stats.json`.
3. Protocol — RPC pair + capability flag.
4. Client dashboard — hook, screen, route, sidebar footer icon.
5. App start-screen setting — `AppSettings` field, settings UI, routing wiring, regression tests.
6. Docs fold-in — once shipped, fold into `docs/data-model.md` + a new `docs/activity-stats.md`
   (or fold into an existing doc), delete this folder.

## Non-goals

- Session/connection-based tracking (rejected in favor of daily buckets — simpler, survives
  disconnects).
- Charts, sparklines, or any analytics-product polish in v1.
- Live-push updates to the dashboard (poll/refresh is enough for a fun stats screen).
