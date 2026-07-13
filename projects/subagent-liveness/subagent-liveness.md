# Charter: Subagent liveness signals (subagents-cleanup Phase 6)

**Status:** Phase 6a (elapsed time) SHIPPED uncommitted 2026-07-13, client-only. Phases 6b/6c not started (daemon work).
**Lineage:** Extends the shipped [subagents-cleanup](../subagents-cleanup/subagents-cleanup.md) track (Items 1–6 done). Same track/row/tab surface — this adds per-row liveness, not new structure.

## Why

Otto's subagent track matches Claude Code's own background-task panel on control legibility
(status-aware Stop/Archive, attention rows never buried) and beats it on depth-on-click (a full
watchable timeline vs. a transcript viewer) and on the header token aggregate. The gap is
**at-a-glance liveness**. Claude's panel shows, per row:

> `Phase 1: dontAsk unattended target · Agent · 14m 09s · 183.1k tokens · 89 tool uses · Bash · View transcript`

Otto's row shows title + status dot + cumulative tokens. It can't answer "is this thing alive or
hung?" without opening it. The three missing signals — **elapsed time**, **tool-use count**, and
**current/last tool** — are exactly the "still working vs. stuck" reassurance a monitoring app
exists to provide. This charter closes that gap.

Scorecard going in (per-row):

| Signal                                              | Claude panel    | Otto (before) | Otto (after 6a) |
| --------------------------------------------------- | --------------- | ------------- | --------------- |
| Title, status, tokens, Stop, Finished-group + Clear | ✅              | ✅            | ✅              |
| Header aggregate token total                        | ❌              | ✅            | ✅              |
| Open full live pane                                 | transcript only | ✅            | ✅              |
| **Elapsed time**                                    | ✅              | ❌            | ✅ (6a)         |
| **Tool-use count**                                  | ✅              | ❌            | ⬜ (6c)         |
| **Current/last tool**                               | ✅              | ❌            | ⬜ (6b)         |

## Phase 6a — Elapsed time (SHIPPED, client-only)

Live-ticking run time while the subagent works, frozen at its `createdAt → updatedAt` duration once
terminal. Data was already on the agent projection; no daemon or protocol change.

- `SubagentRow` gained `updatedAt` ([select.ts](../../packages/app/src/subagents/select.ts)).
- `formatSubagentElapsed` + `isSubagentRowRunning` in
  [track-presentation.ts](../../packages/app/src/subagents/track-presentation.ts) — running rows
  return null (the row live-ticks), terminal rows return the frozen `formatDuration` string,
  non-monotonic `updatedAt` clamps to `0s`.
- `LiveElapsed` extracted from the monolithic `message.tsx` into
  [components/live-elapsed.tsx](../../packages/app/src/components/live-elapsed.tsx) (re-exported
  from `message.tsx` so `turn-footer` keeps resolving it) and rendered per row via a small
  `SubagentElapsed` component in [track.tsx](../../packages/app/src/subagents/track.tsx).
- Tests in `track-presentation.test.ts` (elapsed + running helpers) and `select.test.ts` (row shape
  now carries `updatedAt`). 46 tests green, typecheck + lint clean.

Not yet live-verified in the app (needs a running subagent to observe; standing no-preview
instruction). Client-only, so no daemon rebuild.

## Phase 6b — Current/last tool (daemon work)

Render the subagent's most-recent tool name (`Bash`, `Edit`, `Read`) in the row's currently-empty
`subtitle` slot (`buildSubagentRowPresentationData` already emits `subtitle: ""`). This is the
single highest-value signal — it's what turns "spinning" into "spinning _on a 90s Bash_".

**Tractability note (better than first feared):** for **observed** Claude subagents the tool name is
_already resolved daemon-side_ — `appendObservedSubagentTaskEvent` looks up
`this.toolUseCache.get(input.toolUseId)?.name`
([agent.ts ~4094](../../packages/server/src/server/agent/providers/claude/agent.ts)). It's computed
and thrown away; it just isn't carried onto the projection.

Build sequence:

1. Add optional `currentTool?: string` to `ObservedSubagentUpdate`
   ([agent-sdk-types.ts ~490](../../packages/server/src/server/agent/agent-sdk-types.ts)), populated
   from the resolved `cachedTool?.name` in `appendObservedSubagentTaskEvent`.
2. Thread it through `resolveObservedSubagentDerivedState` and the projection builder
   ([agent-manager.ts ~326](../../packages/server/src/server/agent/agent-manager.ts),
   [agent-projections.ts ~360](../../packages/server/src/server/agent/agent-projections.ts)) —
   mirror the exact `cumulativeTokens` plumbing (additive, `undefined` when absent). Unlike tokens,
   this is **not** monotonic: it should reflect the _latest_ tool, and clear when the subagent goes
   idle/terminal (a finished agent isn't "running Bash").
3. Add optional `currentTool?: string` to the agent snapshot protocol (`server_info` capability
   gate not needed — it's an additive optional leaf; old clients ignore it). Follow the protocol
   contract: `.optional()`, no narrowing.
4. Client: surface it on `Agent` + `SubagentRow`, set `subtitle` in
   `buildSubagentRowPresentationData`, render it dimmed under/next to the title. The row
   presentation already has a `subtitle` field wired to nothing.
5. **Native subagents** (`create_agent`): different source — derive from the last `tool_call`
   timeline item with `status: "executing"`. Provider-agnostic goal per the fork mission; observed
   (Claude) is the proof, native is the second provider.

Open question: current-tool churns fast (every tool call). Decide throttle/debounce so the row
doesn't strobe — likely render latest-on-render (the projection already coalesces) rather than a
per-event push. Do **not** let it mutate the title (Phase 3 explicitly froze the title against
`task_progress.summary`); subtitle is its own slot.

## Phase 6c — Tool-use count (daemon work)

A monotonic per-subagent tool-invocation counter, rendered in the row's metadata line
(`14m 09s · 12.3k · 89 tools`) and optionally summed into the header aggregate beside tokens.

Build sequence (mirror the Phase 4 `cumulativeTokens` accumulator precisely):

1. Observed: increment on each distinct `input.toolUseId` seen in `appendObservedSubagentTaskEvent`
   (dedupe by tool-use id — `task_started` + `task_progress` for the same tool must count once).
   Keep it monotonic like `cumulativeTokens` (`Math.max(existing, next)` semantics) so a late
   terminal notification without a count can't drop the readout.
2. Native: count `tool_call` timeline items.
3. Additive optional `toolUseCount?: number` on the snapshot protocol + projection + `SubagentRow`.
4. Format helper beside `formatCompactTokenCount` (raw count, no k/M until large); render in the
   row and, if it reads well, add a `sumSubagentToolUses` header clause next to `sumSubagentTokens`.

## Cross-cutting

- **Protocol:** every new field is an additive `.optional()` leaf on the agent snapshot — no
  capability gate required, no fallback path. A 6-month-old client simply doesn't render them.
- **Provider parity (fork mission):** ship Claude (observed) first as the proof, then native
  `create_agent`, then the remaining providers as their observed-subagent adapters land
  (tracked in [observed-subagents/provider-adapters.md](../observed-subagents/provider-adapters.md)).
- **Rebuild:** 6b/6c touch the daemon → `npm run build:server` + daemon restart to serve.
- **Fold-in on ship:** when 6b/6c land, fold the durable row-anatomy facts into
  [docs/agent-lifecycle.md](../../docs/agent-lifecycle.md) (subagents track section) and retire the
  parent `subagents-cleanup/` folder (already pending fold-in per its own charter), then delete this
  folder.
