# WP-C · Result caps + description dedup

> Wave 2 (after WP-A, because WP-A also edits `mcp-server.ts`). Parent:
> [token-cost-fixes.md](token-cost-fixes.md), audit §3.4 and §6. Pure waste-trimming; no
> settings, no config chain.

## Goal

Cap the uncapped dynamic payloads that enter transcripts and get replayed on every
subsequent request, and remove the repeated boilerplate in browser tool descriptions.

## Tasks

1. **Cap Otto tool results.** `ottoResultToText` (`openai-compat-agent.ts:1025-1040`) and
   `formatStructuredContentForModel` (`mcp-server.ts:16-62`) have **no truncation**, unlike
   builtins (30K/16K) and MCP (30K). Add a sane cap with head/tail truncation and a
   "truncated" marker. Also address the 2-space pretty-print inflation
   (`JSON.stringify(..., null, 2)`) and the duplicate `*_ids=` list — compact where it
   doesn't hurt model comprehension.
2. **`get_agent_activity` default limit.** `otto-tools.ts:3886-3927` defaults `limit ?? 0`
   = the **entire** child transcript. Change the default to a bounded window (e.g. last 50
   items); keep the arg so callers can opt into more.
3. **Console log line length.** `browser_logs` caps entry count (50/200) but has **no
   per-message length cap** (`ipc.ts:253-263`). Add a per-message char cap.
4. **Dev-server log line length.** `preview_logs` (≤500 lines) and `preview_start`
   `logTail` (20 lines) have **no per-line length cap**
   (`dev-server-manager.ts:379-385`). Add a per-line char cap.
5. **Fork attachment size.** `agent.fork_context` curates the whole parent timeline with
   `maxItems: 0` and untruncated message text (`activity-curator.ts:269-304`, :155-161;
   `session.ts:6559-6580`). Add a size cap / item limit with a "history truncated" note.
6. **Browser description dedup.** ~700 tokens of one boilerplate sentence repeated across
   24 browser descriptions ("Use browserId from preview_start…"), plus a repeated
   ref-expiry sentence (`browser-tools/tools.ts`). State it **once** in the workflow prompt
   (`openai-compat-agent.ts` `buildPreviewWorkflowPrompt` ~:1363-1392) and strip the
   repetition from the per-tool descriptions. Coordinate with the standalone catalog
   language review — if that session has already rewritten these, consume its output
   instead of re-doing it.

## Constraints

- Caps must not break tool usefulness — truncate with clear markers, keep the head (and a
  tail where it matters), never silently drop.
- Keep the load-bearing browser/preview guardrail text (read `docs/preview.md`); only the
  _repeated_ boilerplate moves to the workflow prompt, the guard stays.
- Heads-up: WP-A edits `mcp-server.ts` registration; you edit its result-formatting
  functions — run after WP-A and rebase your view of the file.
- Do **not** commit. `npm run typecheck` + `npm run lint -- <changed files>`.

## Deliverable

The caps + dedup, with `wp-c-findings.md` listing each cap value chosen and the token
saved on a representative case (e.g. a maxed browser_snapshot replayed over a 10-round
turn; the deduped browser block).
