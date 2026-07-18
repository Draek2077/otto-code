# Visualizer Node Richness

Two fully-built visualizer render features are wired-but-dormant in Otto's embed
because the adapter never feeds them data. This project lights them up,
provider-neutrally, following the fork's leveling-up pattern (Claude as the
trend-setting proof, graceful degradation for everyone else).

- **A. Context composition** — the main node's context **ring** and every node's
  context **bar** draw colored blocks from a 5-way breakdown
  (`systemPrompt · userMessages · toolResults · reasoning · subagentResults`).
  Today both are blank because the adapter omits `contextBreakdown` — see
  [docs/visualizer.md](../../docs/visualizer.md) "Context ring". Locked decision:
  **real daemon accounting** with a provider fallback ladder.
- **B. Discovery cards** — notable tool outcomes render as floating labeled cards
  (`file · pattern · finding · code`) near the node. The whole render subsystem
  exists (draw, hit-detection, popup, theming) and the mock scenario emits
  `discovery` on `tool_call_end`, but **no handler consumes it** — nothing writes
  to the page's `discoveries[]` array. Locked decision: **heuristic on notable
  tool results**.

## Why these / status snapshot

The visualizer already exercises every one of its 12 `SimulationEvent` types and
almost every node/action visual (states, personality colors, cost pill, tool
cards, message bubbles, subagent particles, timeline, file-attention heatmap).
These two are the only genuinely-dormant node/action surfaces. Discoveries turn
the graph from "what agents are _doing_" into "what they're _finding_"; the
context composition turns the ring from a near-invisible faint circle into a
live readout of what's filling the window.

## Decisions (locked)

1. **Context breakdown source = real daemon accounting, richest-available per
   provider, graceful fall-through.** Attribute the current context window's
   tokens to categories daemon-side, as richly as each provider's data allows;
   degrade to a coarser split when a provider gives less; if nothing is
   attributable, omit → the adapter omits `breakdown` → today's behavior
   (occupancy-only fill, no color). Never worse than today. Claude is the
   reference implementation (Tier 1).
2. **Discovery triggers = heuristic on notable results.** Search match counts
   (Grep/Glob), files created/edited (Write/Edit), test pass/fail/coverage
   (Bash), key file reads — type-classified, tuned for signal-to-noise. Not every
   tool becomes a card.

## Feature A — Context composition (ring + bar)

### Data model (protocol, backward-compatible)

Add an optional composition to `AgentUsage` (`packages/protocol/src/agent-types.ts`):

```ts
export interface ContextComposition {
  systemPrompt?: number; // system prompt + tool definitions
  userMessages?: number; // user-role input
  toolResults?: number; // file contents, search output, tool_result blocks
  reasoning?: number; // the agent's own thinking/reasoning blocks
  subagentResults?: number; // content returned by child/observed agents
}
export interface AgentUsage {
  // …existing totals…
  contextComposition?: ContextComposition; // each field optional: absent = not attributable
}
```

Protocol contract: new **optional** leaf, old clients ignore it, old daemons
never send it (protocol stays back-compatible; the feature degrades). No hard
capability flag needed — **absence is the graceful-degrade signal** (the "no
fallback paths" rule is about not simulating a missing daemon capability with
legacy RPCs; here the daemon simply enriches an existing usage payload, and the
adapter reads whatever's present). Regenerate zod-aot inbound validation after
the schema change (see [docs/protocol-validation.md](../../docs/protocol-validation.md)).

### Source ladder (daemon-side, per provider)

- **Tier 1 — Claude (trend-setter):** the daemon/provider assembles the request
  and knows the message list. Categorize the tokens that make up the _current
  context window_ by message/block type (system + tools, user text, tool_result,
  thinking, observed-subagent returns). Count per category with the best signal
  available (provider-reported counts where present, else a tokenizer/char-ratio
  estimate). This is the honest accounting.
- **Tier 2 — structured-history providers without a counting API
  (openai-compat, others):** same categorization by role/block, token counts
  approximated (char/4 or a local tokenizer). Coarser but real.
- **Tier 3 — occupancy-only providers:** omit `contextComposition` entirely →
  today's behavior. (Optionally a single-bucket fill later; not the floor.)

Design the accounting behind one provider-neutral seam so each provider fills as
much as it can; the shared path scales/clamps and the adapter consumes one shape.

### Adapter wiring (host)

`buildContextUpdateEvent` (`visualizer-event-adapter.ts`) currently hard-omits
`contextBreakdown`. Change: when `usage.contextComposition` is present, emit
`breakdown` on the `context_update` payload, **scaled so the categories sum to
the authoritative `contextWindowUsedTokens`** (occupancy drives the ring fill;
the composition just apportions it). Missing categories → 0. Drop the "no Otto
source — omit it" comment. Pure-mapper change + a unit test; no vendor build.

Result: the main node's ring and every node's bar light up with real color
blocks. At low usage the ring is a small (accurate) arc that grows as context
fills; glow/percentage still gated at 80 %/70 % as today.

## Feature B — Discovery cards

### Adapter (host, pure mapper + stateful throttle)

`deriveDiscovery(toolName, detail, result) → { type, label, content } | null`:

| Tool            | Type      | Card                                             |
| --------------- | --------- | ------------------------------------------------ |
| Grep / Glob     | `pattern` | "N matches in M files" + top paths               |
| Write           | `code`    | "NEW: &lt;relative path&gt;" + created summary   |
| Edit            | `code`    | edited file + hunk summary                       |
| Bash (test run) | `finding` | pass/fail/coverage parsed from output            |
| Read (key file) | `file`    | file + short summary (throttled to reduce noise) |

Emit as `payload.discovery` on the existing `tool_call_end` `SimulationEvent`
(`payload` is `Record<string, unknown>` — no type change). Paths run through the
existing `relativizeStringPaths`. Signal-to-noise: only notable outcomes; dedupe
/ rate-limit per node so a burst of Reads doesn't spray cards.

### Vendor patch (needs `build:visualizer`)

`handleToolCallEnd` (`hooks/simulation/handle-tool-events.ts`) does **not** read
`payload.discovery` today, and nothing else writes `state.discoveries`. Add the
wire: construct a `Discovery` from `payload.discovery`, position it near the
agent node, push to `state.discoveries` (reusing the existing draw / hit-test /
`discovery-detail-popup` / theming, and the existing `DISCOVERY_HOLD_S` fade +
`settle-visual-state` hydrate handling). Log in `OTTO-PATCHES.md`.

## Phasing / order

1. **Discovery cards — ✅ SHIPPED (uncommitted 2026-07-17).** Adapter
   `deriveToolCallDiscovery` (pure, 11 unit tests) emits `payload.discovery` on
   `tool_call_end`; vendor `pushDiscovery` in `handle-tool-events.ts` renders it
   (OTTO-PATCHES entry, built). Read excluded, sub_agent skipped, cards fan by
   the golden angle. Follow-ups if noise shows up live: per-node discovery cap /
   rate-limit; tune which tools qualify.
2. **Context composition — ✅ SHIPPED (uncommitted 2026-07-17).** Protocol +
   accounting + adapter wiring landed, and the accounting came out **provider-
   neutral in one shot** rather than Claude-only:
   - Protocol: `ContextComposition` type + optional `AgentUsage.contextComposition`
     (`agent-types.ts` + `messages.ts` zod, backward-compat leaf, zod-aot regen).
     Server keeps its own copy in `agent-sdk-types.ts`.
   - Accounting: `estimateContextComposition(timeline)` (`context-composition.ts`,
     5 unit tests) buckets the daemon's **own per-agent timeline** by item type
     (user+assistant→userMessages, reasoning→reasoning, tool_call→toolResults,
     sub_agent→subagentResults; systemPrompt untracked→omitted). Because every
     provider populates the timeline, this is the fallback ladder by construction
     — Claude is richest, sparse timelines are coarser, empty ⇒ omit ⇒ occupancy
     only. `withContextComposition` (full scan, turn boundary) +
     `carryContextComposition` (cheap per-delta carry-forward) in `agent-manager`;
     `sanitizeUsage` (`agent-projections.ts`) carries the nested object through the
     snapshot→client path. Never overwrites a provider-supplied composition, so a
     future provider that reports true per-category counts (or systemPrompt) just
     fills the field directly and wins.
   - Adapter: `buildContextUpdateEvent` forwards a full 5-key `breakdown` scaled to
     occupancy (`buildContextBreakdown`, 3 unit tests). The page requires the
     object to carry `systemPrompt`, so all five keys are always present.
   - No vendor build needed — the page already consumed `payload.breakdown`.
3. **Remaining (next):** live verification of the ring on a real Claude session
   (bridge-log loop); optional per-provider enrichment where a provider can report
   a truer split or the system-prompt size (fills the field directly, Tier-1+).
   Known approximation: the timeline is full history while the window is post-
   compaction — proportions can skew; the scale-to-occupancy keeps the total honest.

## Verification

Both are hard to unit-verify visually (canvas in a CSP-locked webview); rely on
the pure-mapper unit tests (`visualizer-event-adapter.test.ts`) for the adapter
heuristics + scaling, and the live bridge-log loop from
[docs/visualizer.md](../../docs/visualizer.md) "Debugging & iterating" for the
on-canvas result. Per standing repo instruction, no auto-preview.

## When it ships

Fold the durable facts into [docs/visualizer.md](../../docs/visualizer.md)
(context ring now data-backed; discovery derivation + the vendor consume patch),
note the new `OTTO-PATCHES.md` entry, and delete this project folder.
