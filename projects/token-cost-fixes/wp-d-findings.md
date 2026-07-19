# WP-D · openai-compat efficiency + usage capture — findings

Status: **implemented**, full typecheck clean, lint clean on all changed files, scoped
tests green (openai-compat 89, claude 55, agent-projections 31, agent-manager 127). Working
tree left uncommitted for review alongside the pre-existing changeset. Built on top of WP-B
(read its `generateBareCompletion` + `AgentModelDefinition.tier` additions first; my regions
are disjoint from those).

---

## Part 1 — openai-compat efficiency (`providers/openai-compat-agent.ts`)

### 1. Prompt caching

- **Request:** every `/chat/completions` streaming call now sends a stable
  `prompt_cache_key: this.id` (session id, constant across rounds/turns). Servers that
  support prompt caching (OpenAI + compatible gateways) can reuse the large shared prefix —
  system prompt + ~10-15K-token tool catalog + history — instead of re-billing it every
  round. It is a standard Chat Completions field; servers that don't support it ignore it, so
  it's sent unconditionally (no config gate needed, per the "send it and let servers ignore
  it" guidance — WP-A owns config and I didn't add a field). LM Studio and vLLM tolerate
  unknown body params.
- **Response:** `parseStreamChunk` now reads `usage.prompt_tokens_details.cached_tokens`
  (extracted into a new `parseStreamUsage` helper to stay under the complexity limit). Cache
  hits flow through as `cachedInputTokens`.

### 2. Auto-compact fallback window

`maybeAutoCompact` no longer returns early when `resolveContextWindowMaxTokens()` is null.
It falls back to `AUTO_COMPACT_FALLBACK_CONTEXT_TOKENS = 8192` **for the threshold math
only** — the real (null) max is still what the client sees, so no ring is fabricated for
windowless endpoints. History can no longer grow unbounded until the server errors.

### 3. Re-arm the disarm trap

Added `autoCompactDisarmedAtTokens` (context size at the moment of disarm) plus
`armAutoCompact()` / `disarmAutoCompact(atTokens)` helpers (replacing the scattered
`autoCompactDisarmed = true/false` writes so the marker stays consistent). A disarmed trigger
now **re-arms once context grows `AUTO_COMPACT_REARM_GROWTH_TOKENS = 8000` past the disarm
point** — enough fresh material has accumulated that a retry has something new to summarize.
A single failed/low-yield compaction can no longer disarm auto-compaction forever (the old
behavior required usage to drop below threshold, which never happens when the retained tail
alone exceeds it).

### 4. Prune/age images

New `pruneAgedImages()`, called at the end of `pruneToolOutputs` (which runs at every
compaction). It drops base64 `image_url` parts from all but the most recent
`PRUNE_PROTECT_RECENT_IMAGE_MESSAGES = 2` image-bearing user messages, replacing them with a
text marker so the model still knows an image was there. Stops old screenshots from being
re-uploaded on every round (base64 images dwarf the text payload). Recent images that live
work depends on are untouched; tool_call ordering is never changed.

---

## Part 2 — usage capture (feeds WP-G's cost ledger)

### New field: `AgentUsage.cacheCreationInputTokens?`

Added additively (`.optional()`) in **four** places so it survives from provider mapping to
the wire:

1. `packages/server/src/server/agent/agent-sdk-types.ts` — server provider-facing `AgentUsage`.
2. `packages/protocol/src/agent-types.ts` — protocol `AgentUsage` interface.
3. `packages/protocol/src/messages.ts` — `AgentUsageSchema` Zod (`build:client` regenerated
   the AOT validators, `ws-outbound.aot.ts`).
4. `packages/server/src/server/agent/agent-projections.ts` — `sanitizeUsage` field list (a
   field not listed here is silently stripped before it reaches the client).

Semantics: it is the **cache-write** slice of input — Anthropic's
`cache_creation_input_tokens`, billed at a premium over normal input and **disjoint** from
`inputTokens` (non-cached) and `cachedInputTokens` (cache-read). The three input categories
sum to total input. **Claude-specific**; every other provider simply omits it (provider
parity by fall-through). `sumTurnUsageTokens` in agent-manager now includes it, so the
lifetime `cumulativeTokens` total and the "tokens sent" activity counter no longer
under-count cache-write spend.

Claude mapping: `claude/agent.ts buildResultUsage` now maps
`message.usage.cache_creation_input_tokens → cacheCreationInputTokens` (previously dropped).

### openai-compat multi-round accumulation

The bug: `turn.usage = delta.usage` (per-round **replace**) meant a 50-round tool-loop turn
reported only the last round's spend. Naively accumulating into `turn.usage` was **not**
safe — that field is also the context-window occupancy source for the ring, the auto-compact
threshold, and `getContextUsage`; summing it would balloon occupancy past the window and
trigger compaction every round. So the two quantities are now tracked separately:

- **`turn.usage`** — unchanged meaning: the _latest_ round's measurement = current context
  occupancy. Drives the live `usage_updated` ring events, the auto-compact threshold, and
  `contextWindowUsedTokens`.
- **`turn.billedUsage`** — new accumulator `{ inputTokens, cachedInputTokens, outputTokens }`,
  summed across **every** round in `accumulateBilledUsage` (OpenAI's `prompt_tokens` is split
  into non-cached input + cache-read so the categories stay disjoint). A mid-turn compaction
  call's own tokens are folded into `billedUsage` before `turn.usage` is reset to null (the
  "compaction reset" handled correctly), so compaction spend is no longer invisible.

`buildTurnUsage` (turn_completed) now reports **billed** `inputTokens`/`cachedInputTokens`/
`outputTokens` (the sum) while keeping `contextWindowUsedTokens` = last round. A new test
locks this: two rounds of (50/10) + (80/4) → turn_completed reports input 130, output 14,
occupancy 84.

### Failed / canceled turns

- `AgentStreamEvent` `turn_failed` and `turn_canceled` gained an optional `usage?: AgentUsage`
  (server-internal event type — not a wire message, so no protocol change).
- openai-compat `settleTurnFailure` now attaches a synchronous `buildBilledUsageSnapshot`
  (the tokens already spent across the turn's rounds) to both the failed and canceled events.
- agent-manager: extracted `recordTurnUsage(agent, usage, provider)` (the cumulative-tokens +
  activity-counter path shared with turn_completed) and now calls it from
  `onStreamTurnFailed` and `onStreamTurnCanceled`. No-op when usage is absent, so other
  providers that don't report failed-turn usage are unaffected. Retry storms and interrupted
  long turns are no longer invisible to the ledger.

---

## What the cost ledger (WP-G) can now populate accurately, per turn

| Category                                           | Claude                       | openai-compat                            | Notes                             |
| -------------------------------------------------- | ---------------------------- | ---------------------------------------- | --------------------------------- |
| Non-cached input (`inputTokens`)                   | ✅                           | ✅ (summed across rounds)                |                                   |
| Cache-read input (`cachedInputTokens`)             | ✅                           | ✅ when server honors `prompt_cache_key` |                                   |
| **Cache-write input (`cacheCreationInputTokens`)** | ✅ (newly captured)          | ➖ (field omitted)                       | Claude-specific                   |
| Output (`outputTokens`)                            | ✅                           | ✅ (summed across rounds)                |                                   |
| Multi-round tool-loop turns                        | n/a (single result)          | ✅ every round billed, not just last     | the headline fix                  |
| Mid-turn compaction spend                          | n/a                          | ✅ folded into billed total              |                                   |
| Failed / canceled turns                            | ➖ (not wired provider-side) | ✅ accrued spend recorded                | manager path is provider-agnostic |

`contextWindowUsedTokens` / `contextWindowMaxTokens` remain the ring's occupancy figures
(last-round, not billed) and are intentionally **not** the cost numbers — WP-G should read
`inputTokens` / `cachedInputTokens` / `cacheCreationInputTokens` / `outputTokens` for billing
and the `contextWindow*` pair only for occupancy.

---

## Files touched

- `packages/server/src/server/agent/agent-sdk-types.ts` — `AgentUsage.cacheCreationInputTokens`;
  optional `usage` on `turn_failed` / `turn_canceled` events.
- `packages/server/src/server/agent/agent-manager.ts` — `sumTurnUsageTokens` counts
  cache-write; `recordTurnUsage` helper; failed/canceled now record usage.
- `packages/server/src/server/agent/agent-projections.ts` — `sanitizeUsage` passes the new field.
- `packages/server/src/server/agent/providers/claude/agent.ts` — map cache-write tokens.
- `packages/server/src/server/agent/providers/openai-compat-agent.ts` — prompt_cache_key,
  cached_tokens parsing, auto-compact fallback window + re-arm, image aging, per-round billed
  accumulation, compaction-cost folding, failed/canceled usage snapshot.
- `packages/protocol/src/agent-types.ts`, `packages/protocol/src/messages.ts` — additive
  `cacheCreationInputTokens` on `AgentUsage` (+ regenerated `ws-outbound.aot.ts`).
- Tests updated: `openai-compat-agent.test.ts` (billed-accumulation assertion),
  `claude/agent.test.ts` (5 usage blocks now include the surfaced cache-write field).

## Not caused by WP-D

The 2 `mcp-server.test.ts` failures (`create_agent` title/initialPrompt, bare-spawn) are the
known pre-existing failures flagged by WP-A/WP-B — untouched here.
