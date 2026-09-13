# Agent stream performance

How assistant text gets from a provider to the screen, and why it is paced on the way. Read this before changing `packages/server/src/server/agent/agent-stream-coalescer.ts`, the reducer queue in `packages/app/src/timeline/session-stream-reducers.ts`, or the reveal in `packages/app/src/hooks/use-revealed-text.ts`.

For terminal output, which is a separate pipeline with separate budgets, see [terminal-performance.md](terminal-performance.md).

## The pipeline

```
provider text events (incremental where the provider supports them)
  → AgentStreamCoalescer (daemon, leading + trailing, 60ms text coalescing window per agent)
  → recordTimeline: one canonical row per flushed item
  → agent_stream ws message
  → reducer queue (app, one commit per frame) → session store
  → paced reveal (app, per assistant/reasoning item) → markdown blocks → paint
```

Provider adapters normalize their stream contracts. Built-in incremental sources include Claude via `includePartialMessages`, Codex via `agent_message_delta`, ACP agents via `agent_message_chunk`, Pi and OMP via `text_delta`; plugin and OpenAI-compatible providers enter the same provider-neutral stream boundary. Do not infer incremental delivery from provider registration alone.

## Why the reveal is paced

Arrival is lumpy and there is no fixing that at the source. A 60ms coalescing window carries however many characters the model produced in those 60ms, which swings by an order of magnitude within a single turn. Painting each delta as it lands makes the size of those lumps visible, and that is what reads as jagged.

So arrival sets a _target_ and the reveal rate is derived from the backlog instead. A burst makes the text catch up faster; it does not make the text jump. Shrinking the coalescing window does not fix this — it makes the lumps smaller and more frequent, at the cost of message rate on a daemon loop that already contends with terminal frames and per-message relay encryption.

## Invariants

- **The coalescer is leading + trailing.** The first delta after an idle window flushes synchronously; only the rest of the burst waits for the trailing timer. Reverting to trailing-only adds a full window to the first character of every turn. Same shape and the same reason as `TerminalOutputCoalescer`.
- **The leading flush adds a canonical row, and that is fine.** A burst's first chunk lands as its own timeline row. `mergeAssistantChunks` / `mergeReasoningChunks` in `timeline-projection.ts` join contiguous same-turn rows, and clients read the projected timeline, so history is unaffected. Tests that assert on raw rows have to account for the extra row; tests that assert on what a client sees do not.
- **The store holds full text; rendering has its own budget.** `capAssistantMessageForRender` limits each rendered assistant message to 32,000 JavaScript string units at a safe grapheme boundary, then `useRevealedText` paces its growth. Full-message actions retain their source text; selection and scroll geometry follow the rendered slice. Neither the cap nor pacing truncates canonical storage.
- **First sight of a text is revealed whole.** Only growth is paced. This is what makes history hydration, timeline replay, a virtualized row remounting on scroll, and an already-finished message all render complete on first paint without a special case for each.
- **Leaving `phase: "streaming"` snaps the reveal.** Turn presentation comes from canonical agent liveness. A completed turn must never hold unrevealed characters. Otto retained panes pass an activity flag to the same reveal hook: hidden panes cancel their frame work and a resumed pane snaps its accumulated backlog. There is no second shared reveal ticker or user-row-based turn inference.
- **The reducer queue commits on a frame, with a timer as the ceiling.** A frame callback never fires in a hidden tab, so a timer races it and wins when nothing is painting — the store has to keep advancing either way.
- **A history row re-renders only when its item or layout item identity changes.** The inverted
  FlatList hands every mounted cell a new `index` and `ref` whenever a row is prepended, so without a
  memo boundary each coalesced tick re-rendered every mounted row (about 50 on a phone, 100–250 ms of
  JS per tick). `layoutStream` keeps a layout item's identity when nothing about it changed,
  `useRevisedHistoryRows` hands a fresh item identity to rows whose tool-call group, expanded state,
  or breakpoint changed, and `HistoryStreamRow` memoizes on both. Every viewport runs its history
  through that hook; the web viewport once skipped it and history hosts of a live tool group went
  stale. A new field on `StreamLayoutItem` must be added to `areLayoutItemsEquivalent`, or sharing
  silently stops.

## Measuring

- **Smoothness (user-perceived):** `packages/app/e2e/browser/agent-stream-smoothness.spec.ts`, gated behind `PASEO_AGENT_STREAM_PERF_E2E=1`. Drives the mock provider's `bursty-stream` model and reports coefficient of variation of characters painted per frame (smoothness) plus p95 gap between visible updates (stalls). Both numbers are needed: a stalled stream is perfectly smooth.
- **Reproducing bursty arrival:** the `bursty-stream` model in `mock-load-test-agent.ts` emits uneven runs of tokens separated by idle gaps. Burst sizes come from a seeded generator, so a run repeats exactly.
- **Rate policy in isolation:** `computeRevealStep` in `packages/app/src/agent-stream/text-reveal.ts` is pure; `text-reveal.test.ts` covers convergence and burst flattening without a renderer.

Historical upstream measurements (2026-08; not measurements of this integration, Expo web against a local dev daemon, real Claude Haiku agent, ~8.5s samples during active streaming). Setting `TEXT_REVEAL_HORIZON_MS` to 0 makes the reveal paint on arrival, which is how the baseline column was taken:

|                                  | paint on arrival | paced |
| -------------------------------- | ---------------- | ----- |
| frames that advanced the text    | 6%               | 87%   |
| chars-per-frame CV               | 4.11             | 1.86  |
| gap between visible updates, p50 | 317ms            | 17ms  |
| gap between visible updates, p95 | 383ms            | 17ms  |

Total characters painted is roughly the same either way — the reveal changes when they land, not how many arrive.

Measure the **total** length across every `assistant-message` element, not the last one. A turn emits many assistant messages, so the tail element keeps changing identity and its length is not monotonic; sampling only the tail reads those handovers as resets and reports almost no growth. `sampleStreamFrames` does this correctly.
