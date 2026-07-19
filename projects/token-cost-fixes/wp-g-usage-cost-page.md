# WP-G · Usage & Cost metrics page (two-column redesign)

> Wave 3 — depends on **WP-D** (usage-capture fixes: cache-write mapping, failed-turn
> accounting, openai-compat round accumulation) and on **WP-A**'s category taxonomy.
> Do not start until WP-D has landed the capture fixes, or the cost categories will be
> populated from broken data. Parent: [token-cost-audit.md](../token-cost-audit/token-cost-audit.md).

## Goal

Turn the current Metrics screen into a two-column usage **and cost** accounting view, so a
user can see at a glance where their millions of tokens are going — daemon-wide, outside
any single workspace or chat, day-bucketed and lightweight. This is the central accounting
surface the audit called for.

## Layout (user-specified)

Split the screen into two columns (stack vertically on compact form factors):

- **Left column — existing activity stats.** The current non-token counters:
  `messagesSent, messagesReceived, agentsCreated, subagentsInvoked, runsOrchestrated,
backgroundTasksInvoked, thoughts, toolsCalled` above, and **`artifactsCreated` +
  `schedulesExecuted` alone together in their own bottom row** (two tiles, that row to
  themselves). Reuse the existing `StatTile` and responsive chunking within this column.
- **Right column — tokens & cost.** **Tokens in / tokens out as two tiles at the top row**
  (promote `tokensSent` → "Tokens in", `tokensReceived` → "Tokens out" here; they move out
  of the left column). Below them, the **cost categories** (see taxonomy) laid out in
  whatever grid fits the column width.

Keep the existing `SegmentedControl` time-window selector (Today/Yesterday/7d/30d/All)
driving both columns from the same `rollups[window]`.

## Current state (from the metrics map — trust but re-read)

- Screen: `packages/app/src/screens/stats-screen.tsx` (326 lines). Grid today is
  `STAT_TILES` (a flat 12-entry array, `stats-screen.tsx:62-75`) → `chunk()` →
  `resolveColumns(gridWidth)` responsive rows (`:114-176`). Replace the single grid with
  two column containers.
- Reusable tile: `StatTile` (`stats-screen.tsx:197-234`), props `{Icon, label, value}`.
  **Caveat:** it formats every value with `formatTokenCount` (`:206`) which abbreviates
  numerics (`1.2k`) — a **USD cost tile needs a different formatter or a new prop**
  (e.g. `format?: "count" | "tokens" | "usd"`). Add that prop; don't fork the component.
- Data hook: `useActivityStats(serverId)` (`packages/app/src/hooks/use-activity-stats.ts:51`),
  gated by `useActivityStatsFeature` → `serverInfo.features.activityStats`
  (`COMPAT(activityStats)`, v0.5.3). RPC `stats.activity.get` returns
  `{ today, yesterday, last7Days, last30Days, allTime }`, each a full `ActivityCounters`.
- Live refresh already wired via the `activity_stats_changed` push (session-context).

## Data model extension (additive, protocol-safe)

Per the metrics map, `ActivityCountersSchema` (`packages/protocol/src/messages.ts:1753-1766`)
has every leaf `.default(0)`, and the store's `COUNTER_FIELDS` / `zeroCounters` /
`addCounters` machinery (`activity-stats-store.ts:34-47`) flows any new counter through all
five windows automatically. So:

- Add new per-category **token** counters (and, where a real cost exists, **cost** in
  micro-USD integers to keep them additive — never floats in the counter store) to
  `ActivityCountersSchema` + `ActivityCounters` interface. They ride the existing response;
  old clients ignore them, old daemons default them to 0 (back-compat rule 5).
- New increment sites tag each turn's usage with its category (see taxonomy). The existing
  token increment site is `agent-manager.ts:4096-4098` (`onStreamTurnCompleted`); category
  tagging keys off the agent's kind (main / internal-generation / subagent) and provider.
- USD cost: only Claude sets `AgentUsage.totalCostUsd` today and it is currently persisted
  nowhere. Persist it as micro-USD when present; for providers without a real cost, either
  omit the cost tile or derive an estimate from tokens × a price table **clearly labeled
  "estimated"** (do not repeat the visualizer's mistake of presenting an estimate as truth —
  see audit §7). Prefer showing real cost where we have it and tokens-only where we don't.

## Cost category taxonomy (right column)

Attribute token/cost spend by source so the user sees where it goes:

1. **Main chat** — user-facing agent turns.
2. **Generations** — auto-title, auto-name/branch, commit message, PR text, voice cues,
   run summaries (one bucket, ideally with a sub-breakdown; these are the "hidden" spend
   from the audit).
3. **Compaction** — the openai-compat summarizer calls (once WP-D counts them).
4. **Subagents** — observed subagent / workflow spend.
5. **Aux (Claude)** — prompt suggestions + progress summaries, if separable.
6. **By provider** — a secondary split (Claude / openai-compat / others) for the in/out
   totals.

Start with whatever categories have a clean tag at the increment site; land the rest as
capture improves. Every category must be individually optional/additive.

## Constraints

- **Lightweight.** No per-API-request persistence — stay at the store's per-turn,
  day-bucketed, coalesced-write model (`CHANGE_NOTIFY_COALESCE_MS`). Categories are just
  more additive counters, not an event log.
- **Daemon setting** (`activityStats` feature + any new sub-flags) belongs in **Host
  settings** per the placement rule; the screen itself is App-side.
- Protocol back-compat: additive fields only; gate any new capability behind
  `server_info.features.*` with a `COMPAT(...)` tag if the client must detect it.
- Do **not** commit; run `npm run typecheck` and `npm run lint -- <changed files>`.

## Deliverable

The redesigned two-column `stats-screen.tsx`, the additive protocol/store extensions with
category counters, the increment-site tagging, and the `StatTile` cost-format prop —
verified against the running app (the user runs their own dev instance; do not start a
second one).
