# WP-G · Usage & Cost page — findings

Status: **implemented**, full `npm run typecheck` clean, `npm run lint` clean on all changed
files, scoped tests green (activity-stats-store 8, openai-compat 89, claude 55). Working tree
left uncommitted for review alongside the pre-existing changeset. Built on top of WP-A
(feature flags / COMPAT), WP-B (bare-completion refactor) and WP-D (honest billing usage).

Version tag for the new COMPAT flag: **v0.6.4**.

---

## 1. Counter fields shipped (the additive data model)

All new leaves are `.default(0)` on `ActivityCountersSchema` (protocol) and mirrored on the
store's `ActivityCounters` interface + `COUNTER_FIELDS`, so they flow through all five rollup
windows, `zeroCounters`/`addCounters`/`sanitizeCounters`, atomic persist, and the
`stats.activity.get` response (which spreads the whole counters object — no field mapping) with
zero extra plumbing. Old daemons emit 0; old clients drop the unknown leaves. Cost is stored as
an **integer count of micro-USD** (`usd * 1e6`, rounded) so it stays summable like every other
counter — never a float in the store.

| Field                                                                      | Meaning                                            | Populated by                                                   |
| -------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------- |
| `costMicroUsd`                                                             | Grand real spend across all categories, micro-USD  | any turn/gen with a real provider cost (Claude `totalCostUsd`) |
| `mainChatTokensIn` / `mainChatTokensOut` / `mainChatCostMicroUsd`          | User-facing agent turns (compaction slice removed) | `recordTurnUsage`, non-subagent                                |
| `generationsTokensIn` / `generationsTokensOut` / `generationsCostMicroUsd` | Bare-completion metadata generation                | `generateBareCompletion`                                       |
| `subagentTokensIn` / `subagentTokensOut` / `subagentCostMicroUsd`          | Child/observed subagent turns                      | `recordTurnUsage`, agent has parent label                      |
| `compactionTokensIn` / `compactionTokensOut`                               | openai-compat auto-compaction summarizer           | folded slice reported on turn usage                            |
| `claudeTokensIn` / `claudeTokensOut`                                       | Provider split (real-cost provider)                | any Claude turn/gen; "other" derived in UI as grand − claude   |

"In" = `inputTokens + cachedInputTokens + cacheCreationInputTokens`; "Out" = `outputTokens`
(the same split `tokensSent`/`tokensReceived` already use). The existing `tokensSent` /
`tokensReceived` grand totals are unchanged in meaning and now **also** fed by generations, so
the headline totals finally include bare-completion spend.

## 2. Category taxonomy — what's real cost, token-only, or estimated

- **Main chat / Generations / Sub-agents** — have a **real USD cost** whenever the provider
  reports one, which today means **Claude** (`totalCostUsd`). Their `*CostMicroUsd` leaves are
  populated for Claude turns/gens and 0 otherwise.
- **Compaction** — **token-only** (openai-compat-only feature; that provider reports no dollar
  cost). No cost leaf.
- **Provider split** — `claudeTokensIn/Out` is the real-cost provider; the UI derives "other
  providers" as the grand total minus Claude (a clean 2-way split; a finer Claude/openai-compat/
  others split is deferred because `AgentProvider` is an arbitrary string and openai-compat
  endpoint ids are dynamic — there is no clean family signal at the increment site).
- **No estimates shipped.** Per the audit §7 warning, the UI does **not** invent a USD figure
  for token-only providers (showing `$0.00` for real spend would be exactly the visualizer's
  estimate-as-truth mistake). Category tiles are therefore **token-denominated** — tokens are
  the one honest unit every provider reports — and the single real-USD tile ("Total spend
  (real)") is `costMicroUsd`. The per-category `*CostMicroUsd` counters are captured in the
  ledger for a future per-category-USD view but not surfaced as tiles yet, precisely to avoid
  a half-populated `$0.00` cost grid.

### Deferred (documented, not shipped)

- **Aux (Claude prompt-suggestions / progress-summaries)** — these are internal Claude SDK
  behaviors inside the live session; their tokens fold into the main turn and there is no clean
  separable manager increment site without provider-side rework. Left in `mainChat`.
- **Per-category USD tiles** — data captured (`mainChat/generations/subagentCostMicroUsd`),
  tile rendering deferred to avoid `$0.00`-for-token-only-providers.

## 3. Capture / tagging — how spend is recorded

Single chokepoint `AgentManager.recordUsageActivity(usage, { category, provider })`
(agent-manager.ts) writes: grand totals (`tokensSent`/`tokensReceived`/`costMicroUsd`, full
spend), the Claude provider split, the compaction slice, and the category buckets (via a
branch-light `USAGE_CATEGORY_FIELDS` table + a `bump()` guard, extracted to stay under the
cyclomatic-complexity cap). `usdToMicroUsd` converts real cost to summable micro-USD.

- **Turn path** — `recordTurnUsage` (called from `onStreamTurnCompleted` / `onStreamTurnFailed`
  / `onStreamTurnCanceled`, i.e. WP-D's shared path) derives the category from the agent's kind:
  a child agent (has `PARENT_AGENT_ID_LABEL`) → `subagent`, else `mainChat`, and passes the
  provider. Failed/canceled turns still record (WP-D's retry-storm visibility carries through).
- **Generations (bare completions)** — the headline fix. WP-B routed all generations
  (auto-title, branch/workspace name, commit, PR, voice cues, run summary) through
  `AgentManager.generateBareCompletion` → `AgentClient.generateBareCompletion`, which **bypasses
  the turn path** (no `createAgent`/`onStreamTurnCompleted`), so their spend was invisible. Fixed
  by:
  - `AgentClient.generateBareCompletion` now returns `AgentBareCompletionResult { text, usage? }`
    instead of a bare `string`.
  - **Claude** (`claude/agent.ts`) maps the `result` message's usage (`buildBareCompletionUsage`:
    input/cache-read/cache-write/output + real `total_cost_usd`).
  - **openai-compat** (`openai-compat-agent.ts`) parses the non-streaming response's `usage`
    (`parseBareCompletionUsage`, splitting `prompt_tokens` into non-cached + cache-read to keep
    the input categories disjoint; token-only).
  - `AgentManager.generateBareCompletion` records the returned usage under `generations` and
    returns just `.text`, so the `agent-response-loop.ts` caller (and every generation) is
    unchanged.
- **Compaction** — `openai-compat` accumulates the mid-turn summarizer's spend into a per-turn
  `compactionUsage` (`foldCompactionUsage`, alongside WP-D's existing billed fold) and surfaces
  it on the turn usage as server-internal `compactionInputTokens` / `compactionOutputTokens`
  (added to the **server-internal** `AgentUsage` only — deliberately NOT on the wire, so
  `sanitizeUsage` drops it; the client reads compaction from the daemon-computed counters).
  `recordUsageActivity` attributes that slice to `compaction` and **backs it out** of the
  turn's `mainChat`/`subagent` share, so the categories partition the total instead of
  double-counting (the grand total still gets the full spend, WP-D's fold unchanged).

## 4. Feature gating

- New `server_info.features.usageCostCategories` — `COMPAT(usageCostCategories)` v0.6.4, set
  `true` when the daemon can serve activity rollups (same store that populates the category
  counters). App hook `useUsageCostCategoriesFeature` (use-activity-stats.ts).
- The Usage & Cost column's category grid renders only when this is true; an old daemon (base
  `activityStats` on but no categories) shows "Update the host to see the usage & cost
  breakdown" instead of a column of zeros. The token-total tiles (top row) always render since
  `tokensSent`/`tokensReceived` exist at the `activityStats` floor.

## 5. The two-column page (`stats-screen.tsx`)

- Two columns via a flex row (`columns`) with a **divider** between them (vertical rule side-by-
  side, horizontal when **stacked on compact** via `useIsCompactFormFactor`). Each column has a
  **centered header** (`columnTitle` foreground/16/700/uppercase) + a one-line `columnSubtitle`
  ("What you did" / "Where the tokens went") so the split is self-explaining. Both driven by the
  one existing `SegmentedControl` window selector.
- **Tile sizing is intentional, not uniform.** The "boring" stat grids use a responsive
  `TileGrid` (2–3 per row via measured width, `resolveColumns`); an **incomplete last row is
  centered** with symmetric flex edge-spacers (`gridSpacer` flex:1 / `gridSpacerHalf` flex:0.5),
  never left-hugging with a dead cell. The "special" rows stay **2-up** (bigger, draws the eye):
  artifacts+schedules on the left, tokens-in/out on the right. **Real cost** is a **full-width**
  single tile under the totals, shown only when `costMicroUsd > 0`.
- **LEFT "Activity"** — the non-token counters (`messagesSent`, `messagesReceived`,
  `agentsCreated`, `subagentsInvoked`, `runsOrchestrated`, `backgroundTasksInvoked`, `thoughts`,
  `toolsCalled`) in a responsive `TileGrid`, with `artifactsCreated` + `schedulesExecuted`
  alone together in their own bottom `FixedRow`.
- **RIGHT "Usage & Cost"** — top `FixedRow` = **"Tokens in"** (`tokensSent`) + **"Tokens out"**
  (`tokensReceived`), kept 2-up so they read big; then the full-width **"Real cost"** tile
  (`costMicroUsd`, only when > 0 — omitted for token-only providers, never a misleading `$0`);
  then the breakdown grid.
- **Breakdown taxonomy (revised after user review).** The grid is now **one partition of the
  total, by why the tokens were spent** — the four disjoint buckets that sum to the grand total:
  **Your conversations** (mainChat), **Sub-agents**, **Background generations**, **Context
  compaction**. The original design also rendered a **provider slice** ("Claude tokens" / "Other
  provider tokens") in the same grid — dropped, because it re-slices the _same_ tokens a second
  way (so the grid looked like 7 parallel categories when only 4 partition the total) and reads
  as `0`/"other" noise for anyone not on Claude. `claudeTokensIn/Out` counters stay populated
  daemon-side (additive, harmless) but are no longer surfaced. Builders: `buildTotalsTiles`
  (was `buildTokenTiles`) + `buildBreakdownTiles` (was `buildCostTiles`).
- `StatTile` gained `format?: "count" | "tokens" | "usd"` (default `"count"`). `usd` routes
  through a new `formatMicroUsd` (`$0` / `<$0.01` / `$X.XX` / `$1.2k`); `count`/`tokens` keep
  `formatTokenCount`. Component not forked, per brief.

## 6. Files touched

Protocol:

- `packages/protocol/src/messages.ts` — 14 additive `ActivityCounters` leaves;
  `features.usageCostCategories`. `build:client` regenerated `ws-outbound.aot.ts` (new leaves
  present).

Server:

- `packages/server/src/server/activity-stats/activity-stats-store.ts` — `ActivityCounters`
  interface + `COUNTER_FIELDS` (the only store change needed; rollup/persist machinery iterates
  the list).
- `packages/server/src/server/websocket-server.ts` — `usageCostCategories` capability flag.
- `packages/server/src/server/agent/agent-sdk-types.ts` — `AgentUsage.compaction{Input,Output}Tokens`
  (server-internal); `generateBareCompletion` returns `AgentBareCompletionResult`.
- `packages/server/src/server/agent/agent-manager.ts` — `USAGE_CATEGORY_FIELDS`, `usdToMicroUsd`,
  `recordUsageActivity`, `recordTurnUsage` category tagging, generations capture in
  `generateBareCompletion`.
- `packages/server/src/server/agent/providers/claude/agent.ts` — `buildBareCompletionUsage`,
  bare-completion returns usage.
- `packages/server/src/server/agent/providers/openai-compat-agent.ts` — `parseBareCompletionUsage`,
  bare-completion returns usage; per-turn `compactionUsage` accumulator + `foldCompactionUsage` +
  surfaced on `buildTurnUsage`.

App:

- `packages/app/src/hooks/use-activity-stats.ts` — `useUsageCostCategoriesFeature`.
- `packages/app/src/screens/stats-screen.tsx` — two-column layout, token/cost tile builders,
  `StatTile` `format` prop + `formatMicroUsd`.

## 7. Verification

- `npm run build:client` + `npm run build:server` — clean.
- `npm run typecheck` (all packages) — clean.
- `npm run lint -- <all 9 changed files>` — 0 warnings, 0 errors.
- Scoped tests: `activity-stats-store.test.ts` (8), `openai-compat-agent.test.ts` (89),
  `claude/agent.test.ts` (55) — all pass.

### Pre-existing failures NOT caused by WP-G

`agent-manager.test.ts` has **3 failures** — all the identical launch-context assertion
(`createAgent` / `resumeAgentFromPersistence` / `reloadAgentSession` "passes daemon launch env
through the provider launch context"): the expected `launchContext` lacks `agentBehaviors`, but
the uncommitted changeset (WP-A/WP-E) now populates it from the daemon config. WP-G never touches
`buildLaunchContext` or `agentBehaviors`; my agent-manager edits are the token-accounting helpers
only. These are WP-E's tests to refresh. The remaining 124 agent-manager tests pass.

`mcp-server.test.ts`'s 2 bare-spawn `create_agent` title/initialPrompt failures remain the
known pre-existing failures (WP-A/WP-B), untouched here.
