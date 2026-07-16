# Charter: Total token accounting — one honest number per chat

**Status:** Not started — charter drafted 2026-07-16.
**Lineage:** Builds on the universal `cumulativeTokens` accumulator (shipped 2026-07-13, any
provider/spawn path — see [docs/agent-lifecycle.md](../../docs/agent-lifecycle.md)) and the subagents
track's per-row/header token readouts.

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
3. **Visualizer top bar.** Feed real usage instead of summed context occupancy: the adapter starts
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
  per-model rates)?

## Cross-cutting

- Steps 1–2 are client-only. Step 3 touches the vendor tree (OTTO-PATCHES.md entry + bundle rebuild)
  or adapter only, depending on the chosen shape. Step 4 is daemon + protocol (additive).
- Fold-in on ship: the "context vs total" vocabulary into [docs/glossary.md](../../docs/glossary.md),
  accounting mechanics into [docs/agent-lifecycle.md](../../docs/agent-lifecycle.md), then delete this
  folder.
