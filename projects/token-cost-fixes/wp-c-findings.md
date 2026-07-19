# WP-C · Result caps + description dedup — findings

> Deliverable for [wp-c-result-caps-dedup.md](wp-c-result-caps-dedup.md). Consumes the catalog
> review's §5 / §7-8 handoff ([wp-catalog-language-review-findings.md](wp-catalog-language-review-findings.md)).
> **Nothing here is committed** — working tree left for review. Measured 2026-07-18.

## What shipped (working tree)

All caps truncate head-first with a visible marker (`[... N characters truncated ...]`) — nothing is
ever silently dropped, and the head (which carries structure/summary) is always kept, plus a tail
where recency matters.

|   # | Change                                          | File                                                    | Cap value                       |
| --: | ----------------------------------------------- | ------------------------------------------------------- | ------------------------------- |
|  A1 | Otto tool-result cap (openai-compat)            | `openai-compat-agent.ts` `ottoResultToText`             | 26K head + 4K tail = **30K**    |
|  A2 | Otto tool-result cap (MCP structured)           | `agent/mcp-server.ts` `formatStructuredContentForModel` | 26K head + 4K tail = **30K**    |
|  A3 | 2-space JSON → compact                          | A1, A2, and `preview-tools.ts` `success()`              | —                               |
|   B | `get_agent_activity` default limit              | `otto-tools.ts`                                         | **50** items (arg still opt-in) |
|   C | Console log per-message length cap              | `desktop/.../browser-automation/ipc.ts`                 | **2,000** chars/message         |
|   D | Dev-server log per-line length cap              | `preview/dev-server-manager.ts` `appendLog`             | **1,000** chars/line            |
|   E | Fork attachment size cap                        | `activity-curator.ts` `buildAgentForkContextAttachment` | 48K head + 12K tail = **60K**   |
|   F | Browser boilerplate short-forms                 | `browser-tools/tools.ts` (24 tools)                     | —                               |
|   G | Strip `maximum`/`minimum` safe-integer artifact | `openai-compat-agent.ts` `ottoToolParameters`           | —                               |

## Cap-value rationale

- **A (30K, 26K/4K split).** Matches the builtin/MCP tool-result ceiling (30K) the brief cites, so
  Otto tools are no longer the one uncapped result class. Head-heavy because the head of an Otto
  result (activity summary, snapshot root, log head) carries the signal; the 4K tail preserves the
  most recent lines (latest log output, tail of a transcript). The openai-compat path
  (`ottoResultToText`) was fully uncapped; the MCP path's `formatStructuredContentForModel` produces
  the model-visible text for **structuredContent-only** tools (`get_agent_activity`, `list_agents`,
  provider dumps) and was uncapped there. Browser/text-content tools on the MCP path are already
  capped by the provider harness (30K), so no gap there.
- **B (50).** `limit ?? 0` meant "entire child transcript" — unbounded for a long-running agent and
  replayed every round. 50 recent curated items is a useful default window; the `limit` arg still
  opts into more (or all, via a large value). The count header is now truthful about the default
  (`Showing the N most recent of M activities (default limit 50; pass \`limit\` for more)`).
- **C (2,000).** The tab already keeps ≤200 entries; the missing axis was _width_. A single serialized
  object / stack trace / data-URL console line could be enormous and enters the transcript verbatim
  via `browser_logs`.
- **D (1,000).** `preview_logs` (≤500 lines) / `preview_start` logTail (20 lines) bounded line _count_
  but not width; one minified path or serialized error blew a line up. Capping in `appendLog` covers
  every consumer (logTail, `logs()`, readiness-failure tails) at the source.
- **E (60K, 48K/12K split).** Fork context curated the _entire_ parent timeline with untruncated
  message text (`maxItems: 0`), baking an unbounded blob into the forked agent's first message. This
  is a one-shot attachment (not replayed every round), so the window is generous; the larger tail
  (12K) is deliberate — the recent messages are what you continue from — while the head keeps how the
  conversation started. Middle elided with a `history truncated: N characters of earlier chat omitted`
  note.

## Representative token savings

### 1. Maxed `browser_snapshot` over a 10-round turn (Task A, openai-compat path)

A rich page's accessibility snapshot commonly serializes to 50–80K chars. Take a 60K-char snapshot:

- **Before:** 60,000 chars enter the transcript verbatim (~15,000 tok) and are re-sent on each
  subsequent request of the turn.
- **After:** capped to 30,000 chars (~7,500 tok) + a one-line marker.
- **Saving:** ~30,000 chars ≈ **~7,500 tok per occurrence**, paid on every request that still
  carries that result in the turn (≈ ×9 more sends across a 10-round turn before compaction), i.e.
  the dominant single-result win. Pathological snapshots (>80K) save proportionally more.

### 2. Browser description dedup (Task F, every request of every browser-enabled agent)

Measured byte deltas on the actual clauses (24 browser tools):

| Clause group                                         | Occurrences | Before → after |                   Saved |
| ---------------------------------------------------- | ----------: | -------------- | ----------------------: |
| browserId + ref-expiry (combined)                    |           9 | 220 → 140 B    |                   720 B |
| browserId standalone (period)                        |           5 | 127 → 72 B     |                   275 B |
| browserId + continuation (wait/nav/logs/eval/scroll) |           5 | 127 → 72 B     |                   275 B |
| `browser_screenshot` fullPage/ref/zoom prose trim    |           1 | —              |                    61 B |
| **Total**                                            |             |                | **~1,331 B ≈ ~333 tok** |

This _exceeds_ the review's ~225-tok estimate because the standardization also collapsed the "long"
form in the continuation variants, not just the standalone ones. Both boilerplate clauses are now the
short forms in **every** browser tool: `Use browserId from preview_start, browser_new_tab, or
browser_list_tabs.` and `Refs are from the latest browser_snapshot and expire on navigation.` No
unique per-tool action wording changed; the server-enforced guardrails (preview-tab redirect,
workspace-context checks) are untouched — they're enforced in code, per docs/preview.md:66-89. Kept
in-description (not moved to the workflow prompt) so MCP providers — which get no injected workflow
prompt — keep the steer.

### 3. `maximum`/`minimum` serialization strip (Task G, every request)

`.int()` in Zod v4 clamps to the safe-integer range, so `z.toJSONSchema` emits
`"minimum":-9007199254740991` and/or `"maximum":9007199254740991` on every integer field. Measured on
the catalog's real int fields (githubPrNumber, maxRuns, browser_logs.maxEntries, page_text.maxChars,
browser_wait.timeoutMs, browser_resize.width/height, preview_logs.lines):

- Most use `.int().positive()` → only the spurious `"maximum"` (27 B each) is emitted and stripped;
  `.positive()` yields `exclusiveMinimum:0` (kept, legit) and `.max(30000)` yields a real `maximum`
  (kept — `browser_wait.timeoutMs` correctly strips **nothing**).
- **~189 B ≈ ~47 tok** across those 8 fields on the openai-compat path; higher in practice because
  `create_agent` serializes `githubPrNumber` on both the agent and top-level variants.
- The strip is exact-sentinel-only (`=== Number.MAX_SAFE_INTEGER` / `-Number.MAX_SAFE_INTEGER`), so
  no real `.min()`/`.max()` bound is ever removed; `.int()` validation is untouched.

**Note on the MCP path (Task G scope).** The MCP SDK serializes tool schemas internally via
`zod/v4-mini`'s `toJSONSchema` (`@modelcontextprotocol/sdk/.../zod-json-schema-compat.js`), so
Claude/Codex/OpenCode/Pi/ACP also receive the safe-integer artifact. There is no clean public hook to
post-process the SDK's `tools/list` output without wrapping the schema (which would risk the SDK's own
runtime validation), so the strip is applied on the openai-compat path only — the leaner, universal
serialization the review measured. A shared MCP-path fix would need an SDK-level interception point and
is left as a follow-up (it does not change any provider's behavior, only payload size).

## Combined effect

Per-request catalog savings (Tasks F + G, paid on every model request of every agent once tools are
injected): **~380 tok** on top of the language review's applied ~337 tok → **~717 tok / ~5.8%** off
the agent-scope catalog. Result/attachment caps (A–E) are situational but remove the unbounded tail
cases (a maxed snapshot ≈ 7,500 tok/occurrence; an unbounded `get_agent_activity` dump; a giant fork
blob) that could otherwise dominate a turn.

## Verification

- `npm run typecheck` — clean across all packages (server + desktop included).
- `npm run lint -- <8 changed files>` — 0 warnings, 0 errors.
- Existing MCP summary assertions (`providers_count=`, `providers_ids=`, `"providers"`) still hold —
  the summary block is preserved; only the trailing JSON went compact.
- Not run: full test suite (per repo rule). The 2 known-pre-existing `mcp-server.test.ts`
  create_agent title/initialPrompt failures (bare-spawn) are unrelated to this WP.

## Files changed

- `packages/server/src/server/agent/providers/openai-compat-agent.ts` (A1, A3, G)
- `packages/server/src/server/agent/mcp-server.ts` (A2, A3)
- `packages/server/src/server/agent/tools/otto-tools.ts` (B)
- `packages/desktop/src/features/browser-automation/ipc.ts` (C)
- `packages/server/src/server/preview/dev-server-manager.ts` (D)
- `packages/server/src/server/agent/activity-curator.ts` (E)
- `packages/server/src/server/preview/preview-tools.ts` (A3)
- `packages/server/src/server/browser-tools/tools.ts` (F)
