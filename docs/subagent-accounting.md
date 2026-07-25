# Sub-agent accounting

Real, per-sub-agent token + cost accounting in the Metrics ledger: every sub-agent a provider runs gets its **own** itemized row — real in/out/cache split, its **own** model, its **own** priced cost — grouped under the chat that spawned it, with the parent de-inflated so nothing is double-counted. It is **accounting, not a dashboard**: every cost respects its own query, no roll-ups, no inflation, and an honest blank wherever a number can't be had for real.

Claude is the shipped **reference implementation** (Task fan-out + workflows). This doc is the adapter guide for giving the same to every other provider — the core is provider-neutral, so a new provider is fill-in-the-blanks, not a re-derivation.

Companion to the **track-row / read-only-pane** adapter contract in [projects/observed-subagents/provider-adapters.md](../projects/observed-subagents/provider-adapters.md) (the `observed_subagent_updated` + `observed_subagent_timeline` events). Accounting rides on those same events; this doc covers only the token/cost half.

## The boundary (why porting is cheap)

Everything downstream of a provider is already neutral — no provider's field names, model ids, or prices appear in it:

| Layer                      | Where                                                                                                                                                                       | Neutral?                                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Token-accounting core      | `packages/server/src/server/agent/subagent-usage.ts`                                                                                                                        | **Yes** — `SubagentUsageTotals`, `SubagentUsageAccumulator`, `grandTotalTokens`, `subagentUsageToAgentUsage` (no cost) |
| Wire fields                | `ObservedSubagentUpdate.usage` (`AgentUsage`), `.model`, `.cumulativeTokens` in `agent/agent-sdk-types.ts`                                                                  | **Yes**                                                                                                                |
| Ledger + de-inflation sink | `AgentManager`: `recordObservedSubagentUsageIfSettled`, `residualParentCostMicroUsd`, `recordUsageActivity`'s `costOverrideMicroUsd`, `pendingSubagentCostMicroUsdByParent` | **Yes** — reads only `usage.totalCostUsd` and does neutral arithmetic                                                  |
| Log grouping               | `app/src/components/usage-format.ts` `groupUsageRowsByParent` + `usage-log-list.tsx` indent                                                                                 | **Yes** — groups by `agentId`, indents `kind === "subagent"`                                                           |
| Anthropic parsing          | `providers/claude/claude-subagent-usage.ts` `readUsageTotals`                                                                                                               | Claude-specific                                                                                                        |
| Pricing                    | `providers/claude/claude-pricing.ts`                                                                                                                                        | Claude-specific                                                                                                        |

A provider touches **only the bottom two rows** — its own usage parsing and (if it has real costs) its own pricing.

## The adapter contract (three things a provider does)

A provider that surfaces sub-agents gives them accounting by doing this on its normal event stream:

1. **Parse its own wire usage → the neutral split.** Map whatever shape the provider reports (Anthropic `cache_read_input_tokens…`, OpenAI `prompt_tokens/completion_tokens`, …) onto `SubagentUsageTotals { inputTokens, cacheReadInputTokens, cacheCreationInputTokens, outputTokens }`. Missing classes are `0` (e.g. a provider with no prompt cache leaves the two cache fields at 0 — reads as all-fresh, which is honest there).

2. **Accumulate across frames.** Feed each assistant frame to a `SubagentUsageAccumulator` (`observe({ messageId, usage, model })`). It dedups by message id (keeping the final, max-output frame — the one carrying the complete split), sums across messages, and remembers the model (first seen). Providers that report one usage per turn still work; each id is just seen once.

3. **Emit it on `observed_subagent_updated`.** Set `update.usage` from the accumulator (via `subagentUsageToAgentUsage(totals)`), `update.model` from the accumulator's model, and — **only if the provider can price it** — `update.usage.totalCostUsd`, priced on the **sub-agent's own model**. Leave cost unset when unpriceable: the row shows an honest blank and that spend stays on the parent residual.

That's it. When the sub-agent reaches a terminal status (`idle`/`error`/`closed`), the neutral sink writes exactly one ledger row from the carried-forward `usage`, attributes it to the owning chat (`agentId`), tags it `kind: "subagent"` / `subtype: <name>`, and stages its cost for parent de-inflation. No per-provider code runs for any of that.

### What the neutral sink guarantees (so a provider need not)

- **One row per sub-agent per run**, at first terminal status — idempotent against duplicate/late terminal updates (`usageRecorded` flag).
- **No split ⇒ no row.** A sub-agent that only ever reported a scalar total (never a real per-frame split) gets no fabricated row.
- **Parent-residual de-inflation.** When a provider reports a **whole-tree** cost on the parent turn (parent + in-process sub-agents) while the parent-turn tokens are parent-only, the parent row is booked as `tree cost − Σ sub-agent cost` (clamped at 0). The partition is exact by construction — any pricing drift lands on the parent residual, never inflates the grand total. Sub-agent costs are staged in `pendingSubagentCostMicroUsdByParent` as they settle and drained at the parent's next turn.
- **Grouped in the Log.** Rows cluster under their chat (`agentId`) with sub-agent rows indented. A chat-turn row that owns sub-agent rows additionally shows a whole-tree rollup — a `Σ ↑ fresh · cached · ↓ out` segment (the same split as the row's own figures, so the cache-read share stays visible) after its own token stats, and `Σ cost` left of its own cost (`computeParentRowTotals` in `usage-format.ts`). This is presentation-only: each sub-agent attributes to the nearest preceding turn of its chat (the same relationship the indenting shows), nested sub-agents flatten into the same rollup because every descendant row carries the owning chat's `agentId`, and the stored rows/totals are untouched — the Σ figures are a labeled sum of rows already on screen, not a re-count.

## Chat totals: one honest number per chat

Everything above accounts for one sub-agent. This section is the number a **user** asks for: _what did this chat cost?_ — the parent plus everything spawned under it, as one figure.

### Spend is not occupancy

Two quantities, no shared units, and conflating them is the single biggest reason the old numbers felt wrong:

|             | **Total tokens** (spend)                                                      | **Context** (occupancy)                                                        |
| ----------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Answers     | "what did this chat cost"                                                     | "how full is the window"                                                       |
| Direction   | only grows                                                                    | falls when compaction runs                                                     |
| Source      | `cumulativeTokens` / `cumulativeUsage` on the agent snapshot                  | `contextWindowUsedTokens`, `agent.context.get_usage`                           |
| Rendered by | the chat metrics toolbar, the Visualizer top bar, the sub-agents track header | the composer context indicator, `context-window-meter.tsx`, Context Management |

They must never appear in one readout. See [glossary.md](glossary.md).

### Normalize cumulative reporters at the boundary

**Not every provider reports per-turn spend.** Most do (Claude, Codex, ACP, openai-compat, and OpenCode's token leaves), so a lifetime total is a plain sum. But **Pi's session stats are a lifetime total for every leaf**, and **OpenCode's `totalCostUsd` is a running session total** even though its token leaves are per-turn. Adding those every turn double-books: turn 3 re-books turns 1 and 2, and the error grows with the chat.

`toTurnSpend` (`packages/server/src/server/agent/turn-usage.ts`) differences a cumulative reporter against a per-agent watermark **once**, at `recordTurnUsage`, so every sink below it — the lifetime total, the activity counters, the itemized ledger — is plain addition with no per-provider branch. `cumulativeUsageScopeFor` is where a provider declares its shape (`none` / `cost` / `all`); answer it for a new provider rather than letting it inherit the default. Claude is `none` because it already de-cumulates at its own boundary (`takeTurnCostUsd`, reset on each `system:init`).

### Keep the split, and book the cost that was actually charged

`cumulativeUsage` (`AgentCumulativeUsage`, `COMPAT(cumulativeUsage)`, gated on `server_info.features.cumulativeUsage`) carries the real in / cache-read / cache-write / out split plus `costUsd`, accumulated at the moment usage is first observed rather than flattened to one scalar first. That matters because a cache read bills at roughly a tenth of fresh input: a session with one large stable prefix and small per-turn deltas — exactly what prompt caching is for — is dramatically over-charged by any figure that prices the flattened total as fresh input.

`costUsd` is **the cost the manager actually booked**, which for a parent chat is the residual after de-inflation, not the raw whole-tree figure. That is what makes the roll-up below exact by construction instead of double-counting every sub-agent, and it means **a chat's total equals the sum of its own ledger rows**.

### The roll-up, defined once

`selectChatTotals` (`packages/app/src/subagents/chat-totals.ts`) is the only definition: the parent plus the same descendant set the sub-agents track shows (observed fan-out at any depth; an attended child breaks the chain because it is its own chat with its own total), plus the cleared-rows tally so tidying up never makes a chat look cheaper. Every surface reads it — the chat metrics toolbar (`chat-metrics-bar.tsx`, `settings.chatMetricsBar`) and, through `costUsd` on `context_update`, the Visualizer.

### Honest blanks beat confident wrong numbers

This is the rule the whole feature exists to enforce, and it is not negotiable:

- **Cost is reported, never estimated.** No surface may derive dollars from tokens × a rate. The Visualizer used to (`tokens × a hardcoded blended $/M rate`) and was wrong by three compounding multipliers — stale rate, no cache discount, and the pricing-invariant trap below. That code is gone; see the 2026-07-25 entry in `vendor/agent-flow/OTTO-PATCHES.md`.
- **Unpriceable ⇒ blank.** A local model or an OpenAI-compatible endpoint with no pricing shows tokens and no cost. That is the correct answer, not a gap to fill.
- **Partially priced ⇒ a floor, shown as one.** `costCoverage: "partial"` renders `≥ $X`. Presenting a floor as a total is the same lie in a smaller font.

### Known limits

- `cumulativeTokens` / `cumulativeUsage` are **ephemeral** — they reset with the daemon, like `lastUsage`. The itemized ledger is the durable record.
- After a daemon restart, the first report from a cumulative provider books that provider's whole session total at once (the watermark starts empty). Over-booking once beats re-booking every turn.
- The Visualizer's by-tool breakdown is **estimated tokens, never dollars**: `tokenCost` is a ~4-chars/token estimate over the serialized payload and no provider bills per tool call.

## Pricing invariant (the "a provider with claude in it" trap)

Cost is real only where a provider reports or can price it (today: Claude). **Never dispatch pricing by model id from neutral code.** A non-Claude provider (an OpenAI-compatible gateway or router) can legitimately serve a `claude-*` model id at entirely different prices — keying Anthropic rates off the id alone would misprice it. Pricing is invoked **only** from code that knows it is genuinely that provider. The neutral core stays pricing-free; each provider prices its own tree and writes the result into the neutral `totalCostUsd`. See the guard comment in `claude-pricing.ts`.

If a provider verifies its price table (Claude re-prices the turn's whole-tree token totals from the SDK's own per-model `modelUsage.costUSD` and logs drift — `verifyClaudeTreePricing`), that check is diagnostic only; the residual keeps the books balanced regardless.

## The Claude reference (two worked paths)

Claude sub-agents have no per-agent identity on the live SDK stream beyond two surfaces; both feed the same accumulator:

- **Plain `Task` fan-out — on-disk transcript, exact binding.** The live sidechain (`parent_tool_use_id`-tagged frames) only goes one level deep and only ever carries each message's `message_start` usage snapshot (output ≈ 1–2 tokens), so it is NOT the accounting source. Instead every Task/Agent `tool_result` (sync completion and async launch ack alike, at any depth — nested spawns' results ride the depth-1 sidechain) embeds `agentId: <id>`, which is the transcript filename: `TaskTranscriptWatcher` tails `<projectDir>/<sessionId>/subagents/agent-<id>.jsonl` per observed key and emits the split + model + priced cost; for nested keys (which have no live feed) it also emits the timeline. The live accumulator (`appendObservedSubagentUsage`) stands down once a key is disk-bound. Row lifecycle (announce/settle) stays on the live task events.
- **Workflows (ultracode) — on-disk transcript, heuristic binding.** The live stream carries no per-internal-agent identity at all, so `WorkflowTranscriptWatcher` discovers each run's `subagents/workflows/<wf_runId>/agent-<id>.jsonl` (heuristic dir bind, confirmed via run-state `taskId`), runs it through `WorkflowSubagentTranscriptMapper`, and emits the same events nested under the workflow row.

One more Claude wire fact the ledger depends on: **`total_cost_usd` on result messages is CUMULATIVE across the turns of one CLI process** (not per-turn). `ClaudeContextUsageState` de-cumulates it against a watermark reset on each `system:init` (new process), so `usage.totalCostUsd` reaching the neutral sink is genuinely the turn's tree cost.

Both call `toClaudeSubagentUsage(totals, model)` (`claude-subagent-usage.ts`) — the one place Claude parsing + pricing meet the neutral `AgentUsage`.

## Per-provider checklist

For each provider, answer these before writing code:

1. **Does it surface sub-agents at all?** If sub-agents are real, **attended** Otto agents (e.g. openai-compat spawns via the native `create_agent` tools), they already get their own `turn_completed` with their own usage/cost through the normal path — no observed-accounting work applies. Only providers with **provider-managed** (observed) sub-agents need this.
2. **Where is per-sub-agent usage?** A live sidechain/delegated-thread stream (map frames → `observe`), an on-disk transcript (tail + map), or a per-turn total only (scalar `cumulativeTokens`, no split — honest blank row, no ledger entry).
3. **What are the usage field names?** Write the provider's `readUsageTotals` equivalent.
4. **Is the parent turn's cost whole-tree or parent-only?** Whole-tree ⇒ the residual de-inflation applies automatically once sub-agent costs carry `totalCostUsd`. Parent-only ⇒ no de-inflation needed (sub-agent costs are simply additive).
5. **Does it have real costs to price?** If yes, add a provider price table + the pricing invariant guard, and price on the sub-agent's own model. If no (token-only provider), leave `totalCostUsd` unset — the ledger shows tokens with a blank cost, which is the honest picture.
6. **Is its reported `usage` per-turn or a running session total?** Per-turn is the assumption everything downstream makes, and assuming it wrongly double-books every turn (see [Chat totals](#chat-totals-one-honest-number-per-chat)). Declare the answer in `cumulativeUsageScopeFor` (`turn-usage.ts`) — `none`, `cost` (tokens per-turn, cost cumulative), or `all`. Check tokens and cost **separately**: OpenCode differs between them.

Reuse from `agent/subagent-usage.ts` in every case; only steps 3 and 5 are provider-specific.

## Cross-references

- [projects/observed-subagents/provider-adapters.md](../projects/observed-subagents/provider-adapters.md) — the track-row/pane adapter contract this rides on, and per-provider observed-subagent recon (OpenCode, Codex, ACP family, Pi).
- [activity-stats.md](activity-stats.md) — the daemon-wide counter store + the itemized `UsageEvent` ledger these rows land in.
- [providers.md](providers.md) — adding a provider end-to-end.
