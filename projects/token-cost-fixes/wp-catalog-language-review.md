# WP · Otto tool catalog — language & bulk review

> Standalone task, meant to run in its own session. Read-first, then propose (and
> optionally apply) tightening edits. Parent context: the token-cost audit at
> [projects/token-cost-audit/token-cost-audit.md](../token-cost-audit/token-cost-audit.md).

## Goal

The Otto tool catalog is the single largest **fixed** injection surface Otto adds — it
rides in every model request of every agent, on every provider, once tools are injected.
Reduce its token bulk (tool **names + titles + descriptions + input-schema field text**)
**without losing clarity and without removing any feature**. Otto is deliberately
feature-rich; the target is waste, not capability. A description that changes model
behavior stays; a description that repeats a sentence 20 times gets stated once.

## Measured baseline (from the audit — re-measure to confirm, don't trust blindly)

- Agent-scoped full catalog: **74 tools ≈ 59,649 chars ≈ ~14.9K tokens** (browser on);
  **48 tools ≈ 38,950 chars ≈ ~9.7K tokens** at default config (browser off).
- Per-group (native serialization): agents 21/18.8K chars · browser 26/18.8K ·
  schedules 9/5.3K · artifacts 5/4.9K · workspace 4/2.8K · preview 4/2.6K · terminals 5/1.8K.
- Known fat:
  - **`create_agent` ≈ 6,008 chars (~1.5K tokens)** agent-scoped from nested discriminated
    unions; the top-level variant is 7,243 chars and carries **9 legacy duplicate fields**
    (`cwd, mode, thinking, features, worktreeName, branchName, baseBranch, refName,
githubPrNumber`) kept only for back-compat.
  - **~700 tokens of one boilerplate sentence** ("Use browserId from preview_start when
    verifying a dev server, or from browser_new_tab / browser_list_tabs…") repeated across
    24 browser descriptions, plus a second repeated ref-expiry sentence.
  - Tool RESULTS pretty-printed as 2-space JSON (+15–25% vs compact) — a serialization
    choice, in scope to note but see coordination below.

## Method

1. **Measure per tool.** Instantiate the real catalog (the audit used `tsx` against
   `createAgentMcpServer` with stub deps and serialized each tool as
   `openai-compat`'s `ottoToolParameters` / `z.toJSONSchema` does — replicate that).
   Produce a ranked table: tool → name+title+description chars, input-schema chars, total,
   est tokens (chars/4). Rank worst-first.
2. **Classify each tool's text** into: load-bearing (changes model behavior / is a real
   guardrail), clarifying (helpful, keep but can tighten), and waste (repetition,
   over-explanation, restating the schema in prose, filler, redundant field descriptions,
   verbose enums).
3. **Propose tightened rewrites** that preserve meaning and every feature. For each,
   show before/after char + token counts and the % saved. Aim for the big wins first
   (create_agent schema, browser boilerplate, the longest descriptions).
4. **Check the schema side, not just prose:** redundant `.describe()` on self-evident
   fields, over-specified enums, deeply nested unions that serialize large, optional
   fields that could collapse. `create_agent` is the prime target.
5. **Re-measure** the whole catalog after proposed edits; report total tokens saved at
   default config and with browser on.

## Hard constraints

- **No feature removal.** Every tool and every capability stays callable.
- **Keep load-bearing guardrails.** The browser/preview tab-binding and workspace-context
  guardrails are deliberate and documented — read [docs/preview.md](../../docs/preview.md)
  ("token economy is a first-class design axis" and the guardrail rationale) before
  touching browser/preview descriptions. Tighten wording, don't gut the guard.
- **Protocol back-compat for `create_agent`.** The 9 legacy top-level fields are for old
  clients; they can only be removed under the `COMPAT(...)` convention with a dated
  cleanup tag (see CLAUDE.md "protocol stays backward-compatible"). Prefer trimming their
  **descriptions** over removing the fields unless you confirm the removal path.
- Names are model-facing anchors — rename only with clear justification (renames can hurt
  tool-selection reliability and break the `mcp__otto__<name>` prefix expectations).

## Coordination (avoid double-work with the fixes project)

- **WP-C** owns the browser-description dedup and the result-payload caps. If you rewrite
  browser descriptions here, flag it so WP-C doesn't collide — ideally this review
  produces the _language_ and WP-C wires the single-source-of-truth (state the boilerplate
  once in the workflow prompt).
- **WP-A** owns tool **categories/grouping** (which tools are injected), not their wording.
  This review is orthogonal: it shrinks each tool's text regardless of grouping.
- The 2-space-JSON result inflation is a serialization choice in `mcp-server.ts` /
  `ottoResultToText` — note it and hand the fix to WP-C (result formatting) rather than
  changing it here.

## Deliverable

A findings doc (`wp-catalog-language-review-findings.md` in this folder) with: the ranked
per-tool measurement table, the classification, concrete before/after rewrites with token
savings, the re-measured catalog total, and a prioritized edit list. Optionally apply the
non-controversial tightenings directly (descriptions/schema `.describe()` text) — but
**do not commit** (the user cuts releases); run `npm run typecheck` and
`npm run lint -- <changed files>` and leave the working tree for review.
