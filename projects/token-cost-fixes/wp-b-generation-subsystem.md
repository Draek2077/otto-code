# WP-B · Generation subsystem — bare-completion refactor + cheap routing

> Wave 2 (after WP-A). Reads `metadataGeneration.enabled` /
> `metadataGeneration.preferWriterPersonalities` (added by WP-A) — do **not** edit the
> config chain or Host settings. Parent: [token-cost-fixes.md](token-cost-fixes.md),
> audit §5.

## Goal

Every generation (chat auto-title, workspace/branch auto-name, commit message, PR text,
voice cues, run summary) currently spawns a **full agent session**
(`createAgent → runAgent → closeAgent`) carrying the entire Otto tool catalog and, on
Claude, the `claude_code` preset + all CLAUDE.md — 15–25K input tokens to emit a few words.
Replace that with a **direct provider completion call** (the locked decision: full
bare-completion refactor), and make routing **cheap-tier by default**.

## Part 1 — Bare-completion path

- Entry runner: `packages/server/src/server/agent/agent-response-loop.ts:366-399`
  (`generateStructuredAgentResponse` does `manager.createAgent → runAgent → closeAgent`).
  Replace with a direct, tool-less completion against the resolved provider/model — no
  agent lifecycle, no MCP mount, no `claude_code` preset, no CLAUDE.md/settingSources.
- The prompts already contain everything needed (contract + schema + seed); they explicitly
  say "do not read/write files or run tools," so no tools are required.
- Preserve the existing behavior contract: structured JSON output with the same schemas,
  `maxRetries` handling, and the provider **fallback ladder**
  (`generateStructuredAgentResponseWithFallback`). Retry/fallback still apply — just over
  bare completions instead of full spawns.
- This likely needs a minimal per-provider "structured completion" capability. Claude,
  openai-compat, and any provider used for generations must expose a lightweight
  completion entry that does not build the full session config
  (`prepareSessionConfig`/`buildLaunchContext` inject the catalog with no internal-agent
  exemption — bypass them entirely for this path). Design a small provider method or a
  direct API call per provider; keep it behind the same `resolveStructuredGenerationAgent`
  result so callers are unchanged.
- Callers to keep working unchanged: `agent-title-generator.ts`,
  `worktree-branch-name-generator.ts`, `session/checkout/git-metadata-generator.ts`
  (commit/PR), `agent/voice-cue-generator.ts`, orchestration run summary
  (`run-engine.ts`/`bootstrap.ts:1414`).

## Part 2 — Cheap-tier-default routing

- Single chokepoint: `packages/server/src/server/agent/structured-generation-providers.ts`
  `resolveStructuredGenerationProviders` (~:68-145). Today role-matched **Writer
  personalities are tried first** (~:106-114), preempting the cheapness-ordered built-in
  ladder (`DEFAULT_STRUCTURED_GENERATION_PROVIDERS` ~:41-47: haiku → gpt-5.4-mini@low →
  minimax-m3 → nemotron).
- New default (locked decision): **cheapest-capable first.** Put the cheap ladder ahead of
  Writer personalities. Only prefer Writer personalities when
  `metadataGeneration.preferWriterPersonalities === true` (WP-A's flag, default false).
  Models already carry `.tier` (`AgentModelDefinition.tier`, from `model-tiers.ts`) — use it
  to pick the cheapest capable model where a tier choice exists.
- `metadataGeneration.providers` (existing) still lets a user pin explicit providers; honor
  it above the built-in ladder as today.

## Part 3 — `metadataGeneration.enabled` gate

- When `metadataGeneration.enabled === false` (WP-A's flag), skip auto-title and
  workspace/branch auto-name entirely (`agent-auto-title.ts`, `workspace-auto-name.ts`).
  User-initiated generations (commit/PR/voice/artifact) are unaffected by this flag.

## Part 4 — Fix the double-generation bug

- `packages/server/src/server/workspace-auto-name.ts:111-133`: when the rename-path
  generation returns null, the entire ladder runs a second time. Guard so a null/empty
  result does not re-trigger the whole generation.

## Constraints

- No behavior regression: titles/branches/commits/PRs/voice-cues/summaries still produced,
  same schemas, retries + fallback intact.
- Provider parity: the bare-completion path must work for every provider that can be routed
  a generation; if a provider genuinely can't do a tool-less structured completion, it
  falls through the ladder (never errors).
- Heads-up: WP-D and WP-E also touch `agent-manager.ts` / `claude/agent.ts` this wave —
  keep changes localized to the generation path; coordinate if you must edit shared funcs.
- Do **not** commit. `npm run typecheck` + `npm run lint -- <changed files>`. Verify against
  the user's running dev instance (don't start a second one) — create a chat and confirm a
  title still generates and is cheap.

## Deliverable

Bare-completion generation path, cheap-tier-default routing behind the WP-A flags, the
enable gate, and the double-gen fix. Note in `wp-b-findings.md` the measured before/after
token cost of one auto-title (the audit baseline is 15–25K input tokens → target a few
hundred).
