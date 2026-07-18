# Charter: Total token accounting — one honest number per chat

**Status:** Deep-dive audit in progress — charter drafted 2026-07-16, audit findings added 2026-07-17.
**Lineage:** Builds on the universal `cumulativeTokens` accumulator (shipped 2026-07-13, any
provider/spawn path — see [docs/agent-lifecycle.md](../../docs/agent-lifecycle.md)) and the subagents
track's per-row/header token readouts.

## 2026-07-17 audit — why the numbers feel wrong (they mostly are)

Live-audited this exact session (agent `99ea86a`, "Evening check-in") against the daemon's real
`get_agent_status` snapshot rather than trusting the display. Confirmed the visualizer's number is
**not lying about the accumulator** — `cumulativeTokens: 1,287,817` matched the displayed "1.3M"
essentially exactly, and $7.7 ≈ 1,287,817 × the hardcoded $6/M blended Sonnet rate. The problem is
what the accumulator and the rate both **mean**, not arithmetic. Four independent, stacking sources
of distortion, found by tracing `accumulateAgentTokens` in `agent-manager.ts` and the rate table in
`vendor/agent-flow/web/lib/canvas-constants.ts`:

1. **`cumulativeTokens` sums resent context, not distinct spend.** The Messages API is stateless —
   every turn resends the _entire_ conversation so far as input. `accumulateAgentTokens` does
   `existing + turnTokens` every turn (`agent-manager.ts:488-501`), so a long chat's total isn't "how
   much this chat cost," it's "how many tokens got reprocessed across every resend of an
   ever-growing prefix." A chat that loads one big document early (this session loaded the entire
   `claude-api` skill, tens of thousands of tokens) pays for that document again on every subsequent
   turn, compounding fast with no ceiling — the number never goes down (no compaction ran this
   session).
2. **One logical "turn" can be many billed round-trips.** A single user message that triggers several
   sequential tool/MCP calls is _several_ separate API requests, each resending the full (growing)
   context independently. Confirmed empirically: one reply that made 4 tool calls (`ToolSearch`,
   `list_agents`, `get_agent_activity`, `get_agent_status`) jumped the total from 1.3M → 4.2M tokens
   (+2.9M) in that single exchange — partly because one tool result (`get_agent_activity`) quoted
   most of the conversation back into context as a JSON blob, inflating every subsequent resend in
   the same turn. Tool-heavy turns spike the total far harder than plain conversational turns, for
   reasons invisible to the user.
3. **The accumulator discards the input/cached/output split before it's ever priced.**
   `sumTurnUsageTokens(usage)` collapses a turn's usage to one scalar before `accumulateAgentTokens`
   adds it in — the breakdown needed to price cache reads at their ~10%-of-input rate exists on
   `lastUsage` for the _current_ turn only and is thrown away historically. The $/M rate is then
   applied to the flattened total as if every token were fresh input/output at full price. For a
   session shaped like this one (one large stable prefix, small per-turn deltas — exactly what
   prompt caching is for), the true cost is very plausibly a third or less of the displayed figure.
4. **The rate table itself is stale against live list pricing.** Separately verified (same session):
   `canvas-constants.ts`'s hardcoded blended rates (`0.75×input + 0.25×output`) matched Anthropic's
   published list price for Fable 5, Opus 4.6/4.7/4.8, and Haiku 4.5 exactly, but Sonnet 5 currently
   ships with a temporary intro discount ($2/$10 vs list $3/$15, through 2026-08-31) that the
   hardcoded `6` doesn't reflect — a further ~1.5x overstatement on top of (3).

**Net effect:** the displayed $ figure is compounding three multiplicative overestimates (stale rate,
no cache-discount accounting, no distinct-vs-resent token distinction) on top of a token _count_ that
already means something other than what the label implies. None of this is a display glitch — every
number is computed exactly as designed; the design just isn't answering "what did this chat cost."

**Full deep-dive scope (this pass), building on the design sketch below:**

- Confirm whether Claude Code's own reported per-turn `usage` (the thing `sumTurnUsageTokens` reads)
  is _itself_ the full resent-context count, or something smaller — trace it back to the SDK/CLI
  event that populates `event.usage` in `agent.ts` before assuming (2) generalizes to every provider.
- Decide the right _distinct_ metric: likely "tokens billed this session" needs either (a) per-turn
  cache-aware cost computed and summed at accumulation time (before the split is discarded), or (b)
  giving up on a derived $ figure client-side entirely per the open question below.
- Check whether other providers (Codex, ACP, OpenCode, openai-compat, Pi) have the same resend-sum
  behavior or something saner — Pi is already special-cased (`Math.max`, since its own stat is a
  lifetime total) per `accumulateAgentTokens`'s doc comment; audit the others before assuming Claude's
  shape is universal.
- Prototype a corrected per-turn cost calc: `cost = input_tokens × rate_in + cached_input_tokens ×
rate_in × 0.1 + output_tokens × rate_out`, summed at the point usage is first observed (not after
  flattening), and compare against today's number on a real long session to quantify the gap.

## The report

"Token usage at the top [of the visualizer] is not counting sub-agents … in fact, I don't know that
any one number right now sums up the chat's TOTAL tokens in and out."

The user is right, and it's worse than "not counting sub-agents" — today's numbers all measure
different things:

| Surface                       | What it actually shows                                                                                                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visualizer top bar "N tokens" | Σ of each node's **current context-window occupancy** (`context_update` → `tokensUsed`) — double-counts context, misses everything evicted/compacted, and is not usage at all |
| Chat context indicator        | the parent agent's context-window occupancy (by design — it answers "how full am I", not "what did I spend")                                                                  |
| Sub-agent panel header        | Σ `cumulativeTokens` across sub-agent rows only (parent excluded)                                                                                                             |
| Per-row token readout         | that sub-agent's own cumulative total                                                                                                                                         |

Nothing anywhere shows **parent cumulative + Σ children cumulative = what this chat cost in total**.

## Design sketch

1. **Define the number once.** `chatTotalTokens(parent) = parent.cumulativeTokens + Σ
descendants.cumulativeTokens` (walk `parentAgentId`, both observed and attended children — same set
   the subagents track shows). Client-side selector next to the existing subagents selectors; no new
   protocol (the per-agent field already flows).
2. **Chat surface — the metrics toolbar (user-decided 2026-07-16).** A slim toolbar at the top of
   the chat pane, visually a normal toolbar (same weight as the browser/editor toolbars): the
   chat's metrics **in one centered row, icon + number per metric**, styled like the big-screen
   (start-screen Activity Stats) metrics but scoped to **this chat and everything under its root** —
   sub-agents, workflows, anything spawned from it. Toggleable in **general settings**
   (device-local, e.g. `chatMetricsBar`, default TBD). Metric set to iron out here: total tokens
   (the number from step 1) is the anchor; candidates alongside it are active/completed sub-agent
   counts, elapsed time, tool-call count (needs subagent-liveness 6c's daemon counter), and cost —
   pick the few that are honest TODAY client-side for v1, grow as daemon counters land. The
   glossary rule (one label, no synonyms) applies — proposal: **"total tokens"** = cumulative
   spend, **"context"** = window occupancy, never mixed.
3. **Visualizer top bar.** ✅ SHIPPED 2026-07-16 (ahead of the rest of this charter, during the
   subagent-pipeline fixes): the adapter sends each agent's `cumulativeTokens` (the universal
   accumulator) on `context_update`; a vendor patch (`OTTO-PATCHES.md` "honest token/cost totals")
   makes the top-bar Σ and the cost surfaces prefer it over context occupancy and banks the totals
   of cleaned-up (faded) nodes in `SimulationState.retiredTokens`. The ring still reads occupancy.
   The remaining charter scope (chat metrics toolbar, in/out split, exact pricing) is unchanged.
   Original plan for reference: the adapter starts
   sending `tokenCost` on `tool_call_end` (the vendor already sums `tokenCost` into its cost model) or
   — simpler and provider-honest — a small vendor patch that renders a host-supplied
   `sessionTotalTokens` (from the same selector) instead of the Σ-of-context number. Lean: host-supplied
   total; the vendor's own per-event accounting can't be made honest from outside.
4. **In/out split (stretch).** `cumulativeTokens` is a single total today. If the user wants "in and
   out" separately, the daemon accumulator needs `cumulativeInputTokens`/`cumulativeOutputTokens`
   optional leaves (additive protocol change) — verify each provider can even report the split before
   promising it.

## Open questions

- ~~Where exactly does the chat-total live in the UI?~~ **Decided: the chat metrics toolbar**
  (step 2). Remaining detail: exact metric set for v1, default on/off, compact/native behavior
  (a centered icon+number row is naturally responsive, but confirm it earns its height on phones).
- Is the in/out split worth a protocol addition, or is one total enough? (User literally said "TOTAL
  token in and out" — ask.)
- Should the visualizer's `~$` cost estimate ride the new total or disappear (it's a guess at
  per-model rates)? **2026-07-17: leaning disappear-or-rebuild** — see audit above; today's figure is
  wrong by three stacking multipliers, not just "a guess."
- Is `cumulativeTokens` (sum-of-resends) salvageable as "total tokens," or does it need a rename/second
  metric once users see how fast it compounds on tool-heavy turns? Candidate: keep it as an internal
  "tokens processed" number but surface "current context" (`contextWindowUsedTokens`) as the
  headline instead, since that's the number that maps to intuition.
- Does a corrected per-turn cache-aware cost calc belong in the daemon accumulator (so it's available
  to every surface) or purely in the client selector? Daemon-side means the discarded-split problem
  (finding 3) gets fixed at the source instead of patched per-surface.

## Cross-cutting

- Steps 1–2 are client-only. Step 3 touches the vendor tree (OTTO-PATCHES.md entry + bundle rebuild)
  or adapter only, depending on the chosen shape. Step 4 is daemon + protocol (additive).
- Fold-in on ship: the "context vs total" vocabulary into [docs/glossary.md](../../docs/glossary.md),
  accounting mechanics into [docs/agent-lifecycle.md](../../docs/agent-lifecycle.md), then delete this
  folder.
