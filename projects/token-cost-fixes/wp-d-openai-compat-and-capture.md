# WP-D · openai-compat efficiency + usage capture

> Wave 2 (after WP-A). Two halves: efficiency fixes in the openai-compat loop, and the
> usage-capture corrections that WP-G's cost accounting depends on. Parent:
> [token-cost-fixes.md](token-cost-fixes.md), audit §4.1 and §7.

## Part 1 — openai-compat efficiency

All in `packages/server/src/server/agent/providers/openai-compat-agent.ts`:

1. **Prompt caching.** The request body (~:2602-2613) has **no `prompt_cache_key`/
   `cache_control`** — the full ~10–15K-token tool catalog + full history are re-sent raw
   every round. Add a stable `prompt_cache_key` (and honor
   `prompt_tokens_details.cached_tokens` in usage parsing) for endpoints that support it.
   This is opt-in-shaped: send it and let servers that ignore it ignore it; do not break
   endpoints that reject unknown fields (guard behind a capability/provider setting if
   needed).
2. **Auto-compact fallback when no context length is reported.** `maybeAutoCompact`
   (~:1655-1662) returns early when `resolveContextWindowMaxTokens()` is null → history
   grows unbounded until the server errors. Add a configurable/assumed fallback window so
   auto-compaction can still fire.
3. **Re-arm the disarm trap.** One failed/low-yield compaction disarms auto-compact until
   usage drops (~:1674-1723). Add re-arm logic so a single bad compaction doesn't let the
   context grow forever.
4. **Prune/age images.** Base64 image `image_url` parts persist and are re-sent every round
   (~:315-331); `pruneToolOutputs` only touches `role:"tool"` messages. Age images out
   (drop or downscale) beyond the recent window.

## Part 2 — Usage capture (feeds WP-G)

The audit found Otto's accounting can't see the multiplier. Fix the capture so the cost
page has honest data:

1. **openai-compat multi-round undercount.** `turn.usage = delta.usage`
   (~:2680-2681) **replaces** each round's usage, so a 50-round turn is counted as one
   round. Change to **accumulate** across rounds (sum input/output; handle the
   compaction reset at :1706 correctly).
2. **Claude cache-write tokens.** `claude/agent.ts:1980-1985` maps input/cache-read/output
   but **drops `cache_creation_input_tokens`**. Add it to `AgentUsage` (a new
   `cacheCreationInputTokens?` field on the interface at `agent-sdk-types.ts:245-253`, additive)
   so cache-write spend is visible.
3. **Failed/canceled turns.** `onStreamTurnFailed` (`agent-manager.ts:4108-4145`) and
   `onStreamTurnCanceled` (~:4147-4173) never record usage. Where the provider reports
   usage on a failed/canceled turn, feed it into the same accounting path so retry storms
   aren't invisible.

## Constraints

- Additive protocol changes only (new `AgentUsage` field `.optional()`); no breaking usage
  shape changes.
- Provider parity: cache-write capture is Claude-specific; other providers simply don't set
  the new field.
- Heads-up: WP-E also edits `claude/agent.ts` (options block ~:3305-3309) and WP-B may touch
  `agent-manager.ts` spawn path this wave — you edit the usage-mapping region of
  `claude/agent.ts` (~:1980) and the turn-completed/failed region of `agent-manager.ts`
  (~:4071-4173). Distinct regions; coordinate if you collide.
- Do **not** commit. `npm run typecheck` + `npm run lint -- <changed files>`.

## Deliverable

The efficiency fixes + corrected capture. `wp-d-findings.md` documents the new
`AgentUsage.cacheCreationInputTokens` field, the round-accumulation change, and confirms
what the cost ledger (WP-G) can now populate accurately (input/cache-read/cache-write/output
per turn, including multi-round openai-compat turns and failed turns).
