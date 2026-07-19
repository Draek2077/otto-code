# Usage Ledger — itemized activity/cost log

> **Status: BUILT (uncommitted), 2026-07-18.** All 5 layers implemented; server +
> app typecheck clean, all touched files lint/format clean, store test green (6).
> Not yet verified against a running instance (user runs their own daemon; the
> daemon must be on this new code for the Log tab to appear — `features.usageLog`).

Follow-on to the token-cost-fixes initiative ([../token-cost-fixes](../token-cost-fixes/)).
WP-G shipped **aggregate** usage tiles; users need to _scroll the actual rows_ — see every
token-costing activity, its model, and its cost — so they can eyeball their spend, understand
why Otto costs more than a bare chat client (the ~14K MCP catalog rides every request), and
spot anomalies to report as bugs.

## Locked design (from the design conversation)

**One event, two sinks.** The event is the unit of truth. At the existing chokepoint
`AgentManager.recordUsageActivity` we build one `UsageEvent`, then:

1. **append it to a capped log** → the itemized rows a user scrolls; and
2. **fold it into the durable day-bucketed counters** → the tiles (unchanged WP-G path).

Tiles become the log's rollup _by construction_ — one source event, so they can't structurally
disagree. **Best-effort dual-write**, no transactional coupling between the two files: if they
drift by a row, that's acceptable (explicit user call).

**Why the counters stay their own durable store** (not recomputed from the log): the log is
**capped/rotated** (last 30 days). The cumulative "All Time" tiles must outlive
trimmed rows, so the counters persist forever as tiny running totals. Row = bounded detail;
counter = cumulative summary.

**What is a row:** the token/cost-_bearing_ activities only — chat turns, sub-agent turns, and
generations (bare completions: titles, names, commit/PR, summaries). Compaction is a _slice
within_ a turn's usage (openai-compat folds it into the turn's reported usage; making it a
separate billed row would double-count), so it rides its turn's row as a sub-figure, not its own
row. The left-column pure tallies (messagesSent, agentsCreated, toolsCalled, artifacts,
schedules) are cost-free counts and are NOT log rows.

### Decisions

- **Retention:** the 30-day age window only (no row cap) — every row in the last 30 days is kept.
- **Surface:** a **tab on the Metrics screen** (Summary | Log), sharing the screen.
- **In-chat entry:** _skipped_ — no inline "a title was generated" conversation line.

## Build layers

1. **Protocol** (`packages/protocol/src/messages.ts`): `UsageEventSchema` (id, at, kind,
   subtype?, provider, model?, tokensIn, tokensOut, costMicroUsd, compaction{In,Out}?, agentId?);
   `usage.log.get.request` `{limit?, before?}` / `.response` `{events[], hasMore}`;
   `features.usageLog` (COMPAT(usageLog) v0.6.4). Kind/provider are `z.string()` not enum so an
   old client parses new daemon kinds. Reuses the existing `activity_stats_changed` push for live
   refresh (the log writes at the same chokepoint that moves counters). `build:client` regen.
2. **Server store** (`activity-stats/usage-log-store.ts`): in-memory cache + coalesced atomic
   whole-file rewrite (JSON array), mirrors `ActivityStatsStore` (queue + load + atomic write +
   coalesce). `append(event)` trims by age(30d) only; `getPage({limit,before})` slices
   newest-first from cache. Plus a store test.
3. **Chokepoint** (`agent-manager.ts`): `recordUsageActivity` also builds a `UsageEvent` and
   calls `onUsageEvent?.(event)` (new fire-and-forget option, wired like `onActivity`). Kind from
   category (mainChat→chat, subagent→subagent, generations→generation); model from
   `agent.config.model`/`normalized.model`; agentId from the agent. Skip zero-usage events.
4. **Bootstrap/wire**: `usageLogStore`; `onUsageEvent` into AgentManager; `getUsageLogPage`
   threaded through websocket-server → session (mirrors `getActivityRollups`); `usageLog` flag.
5. **App**: `use-usage-log.ts` (RPC + `useUsageLogFeature`, refetch on `activity_stats_changed`);
   Metrics screen Summary|Log tab; a row-list component (time · kind · model · in→out · cost,
   expand for compaction slice / provider / agent).

## Deferred (documented, not in v1)

- **Per-row context composition** (View B: catalog/personality/team/CLAUDE.md breakdown on a
  turn row's expand) — needs the exact-injected instrumentation discussed but not yet built; the
  billed row stands alone first.
- Cursor pagination UI beyond "load more"; provider/kind filters.
