# WP-B · Generation subsystem — findings

Status: **implemented**, typecheck + lint green, scoped tests green. Working tree left
uncommitted for review, alongside the pre-existing changeset. No config-chain files touched
(WP-A owns those) — WP-B only **reads** `metadataGeneration.{enabled,preferWriterPersonalities}`.

---

## 1. What shipped

### Part 1 — full bare-completion refactor

The generation path no longer spawns an agent. `generateStructuredAgentResponse`
(`agent-response-loop.ts`) — previously `manager.createAgent → runAgent → closeAgent` — now
drives `getStructuredAgentResponse`'s retry loop over a single new manager entry:

- **`AgentManager.generateBareCompletion(config, prompt)`** — normalizes the config
  (resolves the default model), checks the provider is enabled + available, then calls the
  provider client's optional `generateBareCompletion`. **No** `prepareSessionConfig` /
  `buildLaunchContext` (those inject the Otto tool catalog + MCP with no internal-agent
  exemption), **no** agent lifecycle. A provider without the method throws here; the fallback
  ladder catches it and moves on (parity by fall-through, never a hard error).

- **`AgentClient.generateBareCompletion?(options)`** — new optional method +
  `AgentBareCompletionOptions` type in `agent-sdk-types.ts`.
  - **Claude** (`providers/claude/agent.ts`): a minimal `claudeQuery` with
    `settingSources: []` (no CLAUDE.md), **no** `claude_code` preset, `allowedTools: []`,
    `maxTurns: 1`, no MCP. Auth still flows through the Claude Code CLI, so no separate API
    key is needed. Collects the success `result` (fallback: concatenated assistant text).
  - **openai-compat** (`providers/openai-compat-agent.ts`): a plain non-streaming
    `POST /chat/completions` with only system+user messages and **no `tools` payload** —
    so the daemon tool loop / Otto tools / MCP never engage.

The **contract is preserved**: identical JSON schemas, identical `maxRetries` handling, and
the provider fallback ladder in `generateStructuredAgentResponseWithFallback` is unchanged
(only its default runner is now the bare path). All callers
(`agent-title-generator`, `worktree-branch-name-generator`, `git-metadata-generator`
commit/PR, `voice-cue-generator`, orchestration run summary) are **untouched** — they route
through the same functions and now get bare completions for free.

The pre-existing **bare-spawn** feature (`resolveBareSpawnTitleAndPrompt`, `create_agent`
opening an empty chat) is a different concern (agent creation, not generation) and was left
alone.

### Part 2 — cheap-tier-default routing

`resolveStructuredGenerationProviders` (`structured-generation-providers.ts`): role-matched
Writer personalities are no longer tried first by default. New order (default,
`preferWriterPersonalities === false`):

1. pinned `metadataGeneration.providers` (honored above the ladder, as before),
2. the built-in cheap ladder — curated cheapest substrings (haiku → gpt-5.4-mini@low →
   minimax-m3 → nemotron), **then** a new tier-aware backstop `resolveCheapestTierProvider`
   (cheapest advertised `.tier`, capped at `standard` so a `deep` model is never elected;
   untiered models skipped — no guessing),
3. Writer personalities,
4. current selection.

When `preferWriterPersonalities === true`, personalities move back to the front (the exact
pre-WP-B order). Reading `.tier` required adding `tier?: ModelTier` to the server's
`AgentModelDefinition` (the snapshot manager already stamps it at ingest; the field was
runtime-present but type-invisible).

### Part 3 — `metadataGeneration.enabled` gate

When `enabled === false`, auto-title (`agent-auto-title.ts` `run`) and workspace/branch
auto-name (`workspace-auto-name.ts` both `maybeAutoName*` methods) return early. User-initiated
generations (commit/PR/voice/run-summary) are deliberately unaffected.

### Part 4 — double-generation bug

`workspace-auto-name.ts:maybeAutoNameWorkspaceBranchForFirstAgent`: previously a `null`
result from a generation that **did** run re-triggered the entire ladder a second time (the
guard was `if (!generated)`). Now a `generatorInvoked` flag distinguishes "callback never
ran" (short-circuit → still need a title, so generate) from "ran and returned null" (don't
re-run). One generation, not two.

---

## 2. Token cost — before / after

I could **not take a live measurement**: the standing project rule is to never start a second
daemon/Expo instance (the user runs their own), so a real end-to-end token capture has to come
from the user's running instance. The numbers below are analytical, from exactly what the two
paths put into the model's input context.

**Before (full spawn, per the audit): ~15–25K input tokens.** A generation spawned a real
Claude session, which loaded:

- the `claude_code` **preset** system prompt (large),
- **CLAUDE.md** via `settingSources: ["user","project","local"]` — in this repo the global +
  project CLAUDE.md are very large on their own,
- the full **Otto MCP tool catalog** (dozens of tools with schemas) injected by
  `buildLaunchContext`,
  plus the actual title/branch prompt (a few hundred tokens).

**After (bare completion): a few hundred input tokens.** The Claude path sends only the
self-contained prompt (contract + JSON schema + seed, ~300–600 tokens) with
`settingSources: []`, no preset, and `allowedTools: []`. The preset, CLAUDE.md, and the entire
tool catalog — i.e. essentially all of the 15–25K — are gone. The openai-compat path is a
single `messages: [system?, user]` request with no `tools` array. This lands in the audit's
target band.

**Suggested user verification** (on the already-running dev instance): create a new chat, let
the auto-title fire, and read the input-token count for the "Chat title generator" work in
`$OTTO_HOME/daemon.log` — it should now read hundreds, not tens of thousands.

---

## 3. Provider parity

`generateBareCompletion` is implemented for **Claude** and **openai-compat** (and every
endpoint provider that extends openai-compat). Providers that cannot do a tool-less structured
completion and were left without it: **Codex, GitHub Copilot, OpenCode, Pi** (CLI/ACP
providers with no lightweight completion surface). Per the locked design they **fall through
the ladder** — `manager.generateBareCompletion` throws `does not support tool-less
completion`, the fallback loop catches it and tries the next provider, and only if _every_
routed provider lacks support does generation fail (callers then degrade to their existing
fallback text / null, exactly as on any other generation failure).

**Heads-up / behavior change to flag:** on a host whose _only_ routable providers are
Codex/Copilot/OpenCode/Pi (no Claude, no openai-compat), automatic metadata generation now
produces nothing (fallback text) where the old full-spawn path could have generated via those
CLIs. This is the intended trade of the "no fallback paths" rule, but it is a real regression
surface for CLI-only hosts and is the natural next slice if we want those providers covered.

---

## 4. Verification

- `npm run typecheck` (all packages) — **clean**.
- `npm run lint -- <all 10 changed files>` — **0 warnings, 0 errors**.
- `npm run format:files` — applied to all changed files.
- Scoped tests: `structured-generation-providers.test.ts` + `agent-response-loop.test.ts` —
  **27 passed**. Updated the two routing tests that asserted the old "personalities first"
  order, added coverage for `preferWriterPersonalities: true` and the tier backstop.
- Updated the Codex case in `agent-response-loop.real.e2e.test.ts` (real-API, not run here) to
  assert the new fall-through contract instead of the removed spawn behavior.

### Not caused by WP-B

`mcp-server.test.ts` still has the **2 pre-existing failures** flagged by WP-A
(`create_agent requires title/initialPrompt`) from the bare-spawn feature — not touched.

## 5. Files touched

- `packages/server/src/server/agent/agent-sdk-types.ts` — `AgentBareCompletionOptions`,
  `AgentClient.generateBareCompletion?`, `AgentModelDefinition.tier?`.
- `packages/server/src/server/agent/agent-manager.ts` — `generateBareCompletion` method.
- `packages/server/src/server/agent/agent-response-loop.ts` — bare rewrite of
  `generateStructuredAgentResponse`.
- `packages/server/src/server/agent/structured-generation-providers.ts` — cheap-tier default
  reorder + tier backstop + `preferWriterPersonalities` read + config-type extension.
- `packages/server/src/server/agent/providers/claude/agent.ts` — Claude bare completion.
- `packages/server/src/server/agent/providers/openai-compat-agent.ts` — openai-compat bare
  completion.
- `packages/server/src/server/agent/agent-auto-title.ts` — enable gate.
- `packages/server/src/server/workspace-auto-name.ts` — enable gate + double-gen fix.
- `packages/server/src/server/agent/structured-generation-providers.test.ts` — updated/added.
- `packages/server/src/server/agent/agent-response-loop.real.e2e.test.ts` — Codex case updated.
