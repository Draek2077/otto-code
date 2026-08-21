# Token economy

Otto costs more tokens than running the same model bare, and the difference is **structural** - it
follows from what a supervision layer is, not from any one bug. This page states the shape of that
cost, the principles that govern what we fight and what we expose, and where the levers live.

Measured accounting lives in the activity store ([activity-stats.md](activity-stats.md)); real
per-subagent attribution in [subagent-accounting.md](subagent-accounting.md).

## The five structural multipliers

In descending order of impact. Treat these as the standing cost model when designing anything that
rides in a request.

1. **The openai-compat daemon loop re-sends everything, every round.** One user turn is up to
   `maxToolRounds` API requests, and each re-sends the system prompt, the full tools array **and the
   entire conversation history**. Cost per turn is therefore quadratic in rounds. On a local endpoint
   this is re-prefill compute; on a paid OpenAI-compatible endpoint it is billed input every round.
   Prompt caching (`prompt_cache_key` / `cache_control`) is the lever, and its absence is why this
   ranks first.

2. **The Otto tool catalog is a fixed tax on every request of every agent.** With Otto tools enabled
   the full catalog rides in every model request of every provider - Claude, Codex, OpenCode,
   Copilot, ACP, Pi, openai-compat. Measured over a real `tools/list` round-trip: the default config
   is ~48 tools ≈ **9.7K tokens**; with browser tools, ~74 tools ≈ **14.9K tokens**. A 20-round
   openai-compat turn pays roughly 206K–304K input tokens in _fixed overhead alone_. The lever is
   per-group gating (`mcp.toolGroups`, over the `OTTO_TOOL_GROUPS` taxonomy) and per-agent scoping.

3. **Every "generation" is a full agent spawn carrying the full injection stack.** Titles, branch
   names, commit messages, PR text, voice cues and run summaries all went through the agent path
   originally: a 3-word chat title paid the provider's preset system prompt, all `CLAUDE.md` files
   and the whole injected catalog - **15K–25K input tokens for ~10 output tokens** - multiplied by
   retries and a fallback ladder several providers deep. Every new chat fires one; a new chat in a
   fresh workspace fires two. The lever is a **bare-completion path** (`generateBareCompletion`) plus
   cheap-tier-default routing.

4. **Some provider features are always-on hidden calls.** Claude sessions carry `promptSuggestions`
   (a separate forked request after each turn from the 2nd turn on, billed at cache-read rates over
   the conversation prefix - cheap per call, but it scales with context size _and_ turn count) and
   `agentProgressSummaries` (a model call per running subagent every ~30 s, so a 30-minute 3-subagent
   fan-out is ~180 extra calls). `notifyOnFinish` injects a child's entire last message into the
   parent and buys a full parent turn. Each needs an exposed off switch, not a hardcoded `true`.

   `promptSuggestions` gained a second, sharper edge on the client. **Follow prompt suggestions**
   (Settings -> General, device-local, default off) accepts that predicted next prompt the moment it
   arrives instead of waiting for the user to press Tab, which multiplies whole turns rather than
   adding a call to one. It is deliberately **not** part of Auto mode, and it is bounded: Otto
   follows at most `FOLLOW_PROMPT_SUGGESTION_MAX_CONSECUTIVE` (3) suggestions in a row per chat, and
   the count only resets when the user sends a message of their own. The guards and the bound live
   in `packages/app/src/composer/follow-suggestion/decide.ts` as one pure function, and a band above
   the message box says when a prompt was accepted by Otto rather than typed.

5. **Accounting cannot see most of this, so users discover it on their bill.** Everything keys off
   `turn_completed`, so: openai-compat records only the **last** round of a multi-round turn;
   auto-compaction usage is counted nowhere; failed and cancelled turns are counted nowhere; Claude
   cache-write tokens were dropped; and pricing the resend-sum at full input rates overstates dollars
   on one screen while real spend stays invisible on another. **An unmeasured multiplier is worse
   than a known one** - this is why instrumentation ranks as a fix, not as reporting.
   Accounting can also be wrong in the other direction. Codex reported OpenAI-shaped usage into
   leaves that are defined as disjoint, which counted the cached prefix twice and made every Codex
   token figure read about 2x real. Codex now de-duplicates the cached slice, sums every request in
   a turn rather than the last one, and reports what a failed or interrupted turn burned. The
   per-provider questions that catch this class of bug are the checklist in
   [subagent-accounting.md](subagent-accounting.md#per-provider-checklist).

> The specific numbers above are from a dated measurement pass and will drift. The _shapes_ - fixed
> per-request tax, quadratic-in-rounds resend, spawn-per-generation, hidden per-turn calls, blind
> accounting - are the durable part.

## Principles

- **Genuine waste gets cut; feature-inherent cost gets a toggle.** We do not fight a cost that is how
  a feature fundamentally works. We expose it and let the user choose.
- **Claude is the reference tier.** Every behaviour toggle maps to a capability. A provider that
  cannot honour a setting **silently ignores it** - never errors, never degrades.
- **Token economy is a first-class design axis, not an optimization pass.** This is the same principle
  the Preview subsystem is built on ([preview.md](preview.md)): pruned accessibility trees instead of
  DOM dumps, reader-mode page text, network summaries with bodies fetched on demand, screenshots
  fitted to a vision-model budget. Design the cheap shape first.
- **Instrument before optimizing.** Every multiplier above was found by measurement; none was
  obvious from reading the code.

## Settings placement

The rule that keeps this coherent:

- **Daemon settings live in Host settings** - `MutableDaemonConfig`, via `useDaemonConfig` /
  `patchConfig`. Anything that changes what the daemon sends or spawns.
- **Frontend and presentation settings live in App settings** - `AppSettings` via `useAppSettings`,
  device-local. Anything that only changes what this device draws.

Getting this backwards produces a setting that appears to work and silently does nothing on another
client.

## The levers

| Lever                 | Field                                                                                          | Governs                                                                                                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-group tool gating | `mcp.toolGroups` (`OttoToolGroup[]`, **undefined = all enabled**)                              | Multiplier 2. Groups are `preview, browser, web, agents, terminals, schedules, artifacts, workspace`. `browserTools.enabled` remains the authoritative browser master for back-compat |
| Metadata generation   | `metadataGeneration.enabled`                                                                   | Multiplier 3 - turns generations off entirely                                                                                                                                         |
| Generation routing    | `metadataGeneration.preferWriterPersonalities` (default **false** - cheap tier is the default) | Multiplier 3 - which tier writes titles and commit messages                                                                                                                           |
| Prompt suggestions    | `agentBehaviors.promptSuggestions`                                                             | Multiplier 4                                                                                                                                                                          |
| Progress summaries    | `agentBehaviors.agentProgressSummaries`                                                        | Multiplier 4 - the expensive one on long fan-outs                                                                                                                                     |
| Notify on finish      | `agentBehaviors.notifyOnFinishDefault`                                                         | Multiplier 4 - the agent-to-agent default                                                                                                                                             |

All are additive protocol fields with `.default()` and a `COMPAT(...)` tag, per the back-compat
contract in [`CLAUDE.md`](../CLAUDE.md).

## Known open questions

Tracked in the [projects ledger](../projects/README.md#providers--accounting):

- A **pinned metadata-generation provider silently falls through** when it cannot do a tool-less
  completion, so the pin is bypassed and another provider is billed. Product question: warn, or keep
  re-routing silently?
- The mock provider has no `generateBareCompletion`, so **no E2E can pin metadata generation
  deterministically** - the auto-title spec is not hermetic.
- **Per-row context composition** (which of catalog / personality / team / `CLAUDE.md` cost what on a
  given turn) needs exact-injected instrumentation that does not exist yet. It is shared with the
  Visualizer's context-composition ring - build it once.
