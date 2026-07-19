# Otto token-cost audit — the full accounting

> Investigation date: 2026-07-18. Method: every number below was measured from the actual
> strings in this repo (real MCP `tools/list` round-trips against `createAgentMcpServer`,
> byte-exact replication of `buildOttoToolPayload` serialization, literal prompt strings),
> then adversarially re-verified by an independent pass (24 verdicts: 11 confirmed,
> 13 corrected — corrected figures are used here). Token figures are **chars ÷ 4 estimates**
> (the same heuristic the daemon itself uses); real tokenizers vary ±20%.
>
> Nothing was changed. This document is the accounting plus a menu of options.
> Companion charter: [projects/total-token-accounting](../total-token-accounting/total-token-accounting.md)
> (display honesty); this audit covers where the tokens actually go.

## 1. Executive summary — why Otto burns tokens faster than "normal"

Users comparing Otto to running the same model bare are right. Five structural multipliers,
in descending order of impact:

1. **The openai-compat daemon loop re-sends everything, every round, with zero caching.**
   One user turn = up to 50 API requests (`maxToolRounds`, raisable to 1000). Each request
   re-sends the system prompt + the full tools array + the **entire conversation history**.
   There is no `prompt_cache_key`/`cache_control` anywhere in the request builder (grep:
   zero hits). On LM Studio this is re-prefill compute; on any **paid** OpenAI-compatible
   endpoint it is billed input every round. Cost per turn is quadratic in rounds.

2. **The Otto tool catalog is a ~10K–15K-token tax on every request of every agent, once enabled.**
   With "Enable Otto tools" on (default config: 48 tools ≈ **9.7K tokens**; +Browser Tools:
   74 tools ≈ **14.9K tokens**), the full catalog rides in every model request of every
   provider — Claude, Codex, OpenCode, Copilot, ACP, Pi, openai-compat — with no per-group
   trimming on the MCP path and no per-agent scoping. A 20-round openai-compat turn pays
   ~206K (default) to ~304K (browser on) input tokens in **fixed overhead alone**.

3. **Every "generation" (title, branch name, commit message, PR text, voice cues, run summary)
   is a full agent spawn carrying the full injection stack.** There is no lightweight
   completion path. A 3-word chat title on the Claude route pays the Claude Code preset
   system prompt + all CLAUDE.md files + the whole injected catalog — **15K–25K uncached
   cache-write input tokens for ~10 output tokens** — multiplied by up to 3 retries per
   provider and a fallback ladder up to 6+ providers deep. Every new chat fires one; a new
   chat in a fresh workspace fires **two**.

4. **Claude sessions carry always-on hidden calls Otto hard-codes without exposing the off
   switches:** `promptSuggestions: true` (a separate forked request after each turn from
   the 2nd turn on — billed at **cache-read rates (~10% of input)** over the conversation
   prefix with no cache write; cheap per call, but it scales with context size and turn
   count — see §4.2 for the decoded mechanics) and `agentProgressSummaries: true` (a model
   call per running subagent every ~30s — a 30-minute 3-subagent fan-out ≈ 180 extra
   calls). Plus `notifyOnFinish` (default **true** for agent-to-agent spawns): every child
   completion injects the child's entire last message into the parent and buys a full
   parent turn.

5. **Otto's own accounting cannot see any of this**, so users discover it on their bill,
   not in the UI. No per-API-request instrumentation exists (everything keys off
   `turn_completed`); openai-compat records only the **last** round of a multi-round turn;
   auto-compaction usage is counted nowhere; failed/canceled turns are counted nowhere;
   Claude cache-write tokens are dropped; and the visualizer prices the resend-sum at
   stale full-input rates — up to **3×+ overstated dollars** on one screen while real
   spend is invisible on another.

## 2. How to read the numbers

- **per-api-request** — paid on every model call, including every tool round inside a turn.
  This is the multiplier class that dominates.
- **per-turn** — once per user message.
- **per-session** — once at spawn (but for openai-compat, "once" content is still
  physically re-sent per request; it's cacheable only if the endpoint does implicit
  prefix caching).
- **per-event** — when something specific happens (a tool call, a compaction, a schedule fire).
- **auxiliary-call** — a hidden LLM call that is not the user's chat turn.

Dedup note: the tool catalog, browser tools, preview tools, and generation costs were
measured independently by several audit passes; this document counts each **once**, using
the verified figures.

## 3. The fixed injection surface: the Otto tool catalog

### 3.1 Master gates (verified against code, resolving an internal contradiction)

| Setting                                      | Effective default                      | Evidence                 |
| -------------------------------------------- | -------------------------------------- | ------------------------ |
| `mcp.injectIntoAgents` ("Enable Otto tools") | **OFF** on a fresh config (`?? false`) | `config.ts:441`          |
| `browserTools.enabled`                       | **OFF**                                | `config.ts:430`          |
| openai-compat `ottoToolGroups`               | **all 8 groups** when omitted          | `provider-config.ts:181` |

Two landmines found while resolving this:

- `bootstrap.ts:628` seeds the mutable store with `?? true` — currently **dead code**
  (the value is already resolved to a boolean), but if `config.ts` ever passes `undefined`
  through, injection silently defaults ON.
- The Host-settings switch renders `config?.mcp.injectIntoAgents !== false`
  (`host-page.tsx:1031`) — it displays **ON while config is still loading**, misrepresenting
  the default state.

Everything in 3.2–3.4 applies **only when injection is on** — but this fork's headline
features (orchestration, teams, spawning, schedules, artifacts) all require it, so treat
"injection on" as the operating condition for our real users.

### 3.2 Catalog size (measured over a real `tools/list` round-trip)

| Configuration                                     | Tools |  Chars | Est. tokens/request |
| ------------------------------------------------- | ----: | -----: | ------------------: |
| Default daemon config (browser off)               |    48 | 38,950 |          **~9,700** |
| Browser Tools enabled                             |    74 | 59,649 |         **~14,900** |
| Voice session (adds `speak`)                      |    75 |   +352 |                +~90 |
| openai-compat native form (74 tools + 8 builtins) |    82 | 58,830 |         **~14,700** |

Group breakdown (native serialization): agents 21 tools/18.8K chars; browser 26/18.8K;
schedules 9/5.3K; artifacts 5/4.9K; workspace 4/2.8K; preview 4/2.6K; terminals 5/1.8K.

Notable single items:

- **`create_agent` alone ≈ 1.4–1.5K tokens** (5,969 chars agent-scoped; the top-level
  variant is 7,243 chars and carries **9 legacy duplicate fields** kept only for back-compat).
- **26 browser tools ≈ 5.0K tokens**, of which **~700 tokens (12%) is one boilerplate
  sentence repeated in 24 descriptions** ("Use browserId from preview_start…"); a further
  repeated ref-expiry sentence brings dedup potential to ~15.5% of the block.
- **4 preview tools ≈ 671–740 tokens with no dedicated off switch** — `DevServerManager`
  is always constructed (`bootstrap.ts:697`) and registration gates only on its existence.
  Only openai-compat's group toggle or disabling injection entirely removes them.
- 41 core tools register **unconditionally** — schedules/artifacts/terminals/worktrees
  register even when their backing service is absent (guards are inside handlers, not
  around registration). Per-group gating exists **only** on the openai-compat native path;
  the MCP path (Claude/Codex/OpenCode/ACP/Pi) is all-or-nothing.

### 3.3 Frequency and cache behavior

The catalog lands in the provider's tools block on **every API request**. It is
prefix-stable within a session (deterministic order, no timestamps) so provider-side
caching _can_ cover it — but:

- Otto sets no cache parameters anywhere; openai-compat relies wholly on endpoint implicit
  caching (LM Studio/llama.cpp KV reuse; many hosted gateways: none).
- The tool list **changes** when `browserTools.enabled` is toggled (re-read live per
  catalog build) and when voice registers/unregisters `speak` — busting provider caches.
- Claude prefixes every tool `mcp__otto__` (+814 chars) and pays the catalog again as a
  fresh cache write per new session — including every hidden generation spawn.

### 3.4 Tool RESULTS (the dynamic half)

Results enter the transcript and are replayed on every subsequent request until compaction.

| Result                                   | Cap                                                                                                                                                                   |    Est. tokens/call |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------: |
| `browser_snapshot`                       | 80,000 chars, **no caller-side reduction knob**                                                                                                                       |       up to ~20,000 |
| `browser_evaluate`                       | 80,000 chars                                                                                                                                                          |       up to ~20,000 |
| `browser_page_text`                      | 20,000 default / 100,000 opt-in                                                                                                                                       |      ~5,000 default |
| `browser_network` body                   | 30,000 chars                                                                                                                                                          |        up to ~7,500 |
| `browser_logs`                           | 50–200 entries, **no per-message length cap**                                                                                                                         | unbounded per entry |
| `preview_logs` / `preview_start` logTail | 500 / 20 lines, **no per-line length cap**                                                                                                                            |  unbounded per line |
| `browser_screenshot`                     | ≤1568px/≤1.15MP (~1.6K vision tokens) — **image silently dropped for openai-compat** (model receives only "Captured browser screenshot (WxH)." and may loop retrying) |              ~1,600 |
| openai-compat builtins                   | read/grep 30K chars; run_command 16K; web_fetch 15K                                                                                                                   |  ~7.5K / 4K / 3.75K |
| **Otto catalog tool results**            | **UNCAPPED** (`ottoResultToText` has no truncation)                                                                                                                   |           unbounded |
| `get_agent_activity`                     | **defaults to the ENTIRE child transcript** (`limit ?? 0`)                                                                                                            |           unbounded |

Otto also inflates results structurally: tools returning only `structuredContent` get it
pretty-printed as 2-space JSON (+15–25% vs compact), and list tools additionally get a
duplicate full `*_ids=` line (MCP path only).

## 4. Provider-by-provider marginal cost (what Otto adds)

### 4.1 openai-compat (LM Studio, Z.AI, Qwen, custom endpoints) — the biggest burn surface

Cost formula for one user turn:

```
total_input ≈ Σ (r = 1..R) [ S + T + H₀ + U + Σ(i<r) round_i ]
  R  = rounds used (≤ maxToolRounds, default 50, max 1000)
  S  = system prompt (~94 base + 266 preview doctrine + personality/team/append)
  T  = tools payload (~950 builtins + ~8.7–13.8K Otto catalog + MCP servers, uncapped)
  H₀ = history at turn start (unbounded until compaction)
  U  = new user message (+ full-base64 images)
```

Facts (all verified):

- Full history resent every round; the 40-message cap was **deliberately removed**
  (`c425ae51d`, full-history resume). Reasoning is the one thing NOT replayed (stripped
  in `toWireMessage`) — that part is clean.
- Zero cache params. Prefix is append-only within a turn (implicit-cache friendly), but
  compaction, rewind, and live personality switches rewrite it and cold-start the cache.
- **Images**: base64 `image_url` parts persist in the message array and are re-sent every
  round and after resume; pruning touches only `role:"tool"` messages, so images survive
  until compaction happens to age them out. A 500KB image ≈ 683K chars of wire payload
  per request.
- **Compaction** (the only provider where Otto itself compacts): auto at 80% of the
  context window, checked at turn start **and before every tool round**; manual `/compact`.
  The compaction call is itself a hidden LLM completion whose input is the entire older
  region (potentially 80–100K tokens) with a prompt that explicitly forbids brevity.
  Traps: endpoints that don't report a context length **never auto-compact** (unbounded
  growth until the server errors); one failed/low-yield compaction **disarms** the trigger;
  each compaction busts the endpoint prefix cache (users see a long "hang" = full re-prefill).
  Post-compaction floor is still ~25K+ tokens/round (20K keep-recent tail + summary +
  system + tools).
- Resume after daemon restart replays the full persisted conversation into the model on
  the next turn (real cost — distinct from UI backfill, which is free).
- **Accounting is blind here**: `turn.usage = delta.usage` — each round **replaces** the
  previous, so a 50-round turn is recorded as one round. The provider whose loop multiplies
  hardest is the one Otto undercounts hardest.

### 4.2 Claude

Otto's choices on top of the SDK (all unconditional, none user-toggleable today):

- Opts every session into the **Claude Code preset prompt + user/project/local CLAUDE.md +
  skills** (`systemPrompt: {preset:'claude_code'}` + `settingSources`) — ~9K tokens on this
  repo (its root CLAUDE.md alone ≈ 6K). Paid as a fresh cache write by every session —
  **including every hidden generation spawn**.
- `promptSuggestions: true` — a **separate API request** per turn (verified by decoding
  CLI 2.1.212: a dedicated generator forks the conversation via the query machinery with
  its own `requestId` and `api_error` handling — it is _not_ piggybacked on the main
  query's result message, which is a common misreading). Cost profile, also verified:
  the fork reuses the parent's exact prefix (`cacheSafeParams`: same system prompt +
  messages) and sets `skipCacheWrite: true`, so input bills at **cache-read rates
  (~10% of input price)** with no cache-write premium; output is filtered to ≤12 words.
  Skips: first turn (<2 assistant messages), after API-error turns, on abort. Net: cents
  per turn on very large contexts, fractions of a cent typically — "nearly free" per
  call, but it is one extra billed request per turn scaling linearly with context.
  **A kill switch exists that Otto doesn't use**: the CLI honors
  `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false` in the session env.
- `agentProgressSummaries: true` — ~2 calls/min per running subagent.
- `notifyOnFinish` default **true** for agent-to-agent spawns — child's full last message
  injected into the parent + a full parent turn per child completion.
- No `maxTurns` cap; the unattended deny-responder has no denial-count circuit breaker
  (a looping model burns full-context rounds indefinitely).
- Cache-bust events: live personality switch and voice toggle (on **and** off) rewrite the
  system append → the entire conversation re-cached at cache-write rates (~150K tokens
  re-billed on a 150K conversation, per event).
- Genuinely free: subagent observation (file tailing, zero model calls), UI timeline
  backfill, rewind (`forkSession` — a saving).

### 4.3 Codex / OpenCode / Pi / ACP family

- All receive the full MCP catalog (per §3) — their CLIs then re-send it per request.
- Codex: personality/team prompt sent as `developerInstructions` every turn — and **twice**
  when collaboration modes are active (also inside `collaborationMode.settings`).
- OpenCode: prompt as `system` per turn; Pi: once per session via argv (most cache-stable).
- **ACP providers (Copilot, Cursor, Kiro, Trae, generic) receive NO system prompt at all** —
  personalities/teams silently do nothing there (zero token cost, but a functional gap) —
  while still receiving the full catalog.

### 4.4 Personalities & Teams — exonerated

The identity stack itself is small and well-behaved: team prompt (~84 tok) + personality
(~75–118 tok starter roster) + role directive (~66–288 tok) = **230–450 tokens**, frozen at
spawn, cache-stable. Two second-order costs: the orchestrator directive actively tells
agents to call `list_personalities` (each call appends a ~400–650-token roster JSON to
history forever), and live personality switches are cache-bust events. The token burn
attributed to "personalities" is really the mini-task spawn architecture below.

## 5. Generations — the hidden Writer economy

### 5.1 Inventory (all verified)

Every server-side generation is a **full spawned agent session**
(`createAgent → runAgent → closeAgent`, `agent-response-loop.ts:366-399`). No lightweight
completion path exists.

| Generation                 | Trigger                                                            | Static prompt | Dynamic payload                                        | Off switch       |
| -------------------------- | ------------------------------------------------------------------ | ------------: | ------------------------------------------------------ | ---------------- |
| Chat auto-title            | every new chat without explicit title                              |      ~363 tok | user's ENTIRE first message + all attachments verbatim | **none**         |
| Workspace/branch auto-name | every new workspace (same first message — a **second** generation) |      ~495 tok | same seed                                              | **none**         |
| Commit message             | commit with blank message                                          |      ~140 tok | full diff, cap **120K chars ≈ 30K tok**                | user-initiated   |
| PR title/body              | PR with blank text                                                 |      ~140 tok | base-ref diff, cap **200K chars ≈ 50K tok**            | user-initiated   |
| Voice cues                 | personality editor                                                 |      ~400 tok | up to **3 separate spawns** (per-moment path)          | editor-time only |
| Run summary                | every terminal orchestration run                                   |      ~155 tok | per-phase digests                                      | **none**         |
| Loop verifier              | per loop iteration with `--verify`                                 |       ~90 tok | fresh session per iteration                            | flags            |
| Artifact generator         | per create/regenerate                                              |      ~185 tok | description; large HTML output                         | user-initiated   |

Cleared: AI Refactor is a **visible** pre-filled composer draft (user reviews model and
sends); dictation-refine is a charter, not code; deny-responder and suggested-task chips
are mechanical; `web_search` is DuckDuckGo HTTP, no hidden LLM.

### 5.2 The real cost per generation

The measured prompt is the small part. Each spawn also carries the **full injection stack**
(`prepareSessionConfig`/`buildLaunchContext` have **no internal-agent exemption** —
verified by grep): the Otto MCP catalog (~9.7–14.9K tok) plus, on the Claude route, the
preset prompt + CLAUDE.md (~9K, all as fresh uncached cache-write). The generation prompts
themselves say "Do not read files, write files, run tools" — the tools are pure waste.
**A 3-word title ≈ 15K–25K input tokens.** The matched personality's _prompt_ is NOT sent
(only its provider/model/effort are copied) — the weight is all architecture.

### 5.3 Multipliers

- **Retry ×3 per rung** (`maxRetries: 2`), and retries re-embed the full base prompt —
  attempt 3 of a commit generation carries the 120K-char diff ~3× in context.
- **Fallback ladder up to 6+ rungs** (writer personalities → configured providers → 4
  built-in defaults → current selection), each rung a fresh full spawn. Worst case
  **15–18 full model calls for one title**. A failing local model can silently escalate a
  commit message to a frontier API at full diff cost.
- **Double-generation bug**: `workspace-auto-name.ts:111-133` — if the rename-path
  generation returns null, the entire ladder runs a second time.
- New chat in a fresh workspace = title + branch-name = **two** independent generations
  of the same first message.

### 5.4 Routing economics — "did we already pick the cheapest writer?" — No.

The chain (`structured-generation-providers.ts:106-142`): **role-matched Writer
personalities first** → configured `metadataGeneration.providers` → the built-in default
ladder → current selection. The built-in ladder IS cheapness-ordered (`haiku` →
`gpt-5.4-mini` @low → `minimax-m3` → `nemotron-3-super`) — but it is only reached when
**no Writer resolves**. Any Writer personality preempts it with its full-price model; no
tier check exists anywhere in the path. `model-tiers.ts` (deep/standard/fast, already
stamped on `AgentModelDefinition.tier`) is consumed only by the setup wizard.
**The plug-in point for a cheapest-capable policy is `resolveStructuredGenerationProviders`**
(single chokepoint; the tier data is already in hand at that line).

### 5.5 Visibility and the "generation receipt" option (analysis only — nothing built)

Today: generations run as `internal` hidden sessions — invisible in listings, never
persisted, no notifications — yet their tokens **do** flow into activity-stats aggregates
(`agentsCreated`, `tokensSent/Received` increment unconditionally), attributed to a
vanished agent no chat can claim. The only receipt-like surface is the commit/PR pre-run
confirm dialog (names personality/provider/model — but pre-run and cost-free).

What a visible per-generation conversation entry ("ran auto-title on Dash/Haiku — 18.2K in
/ 12 out, $0.006") would need:

1. **Identity: cheap.** The resolved-agent union (`personalityName`/`providerLabel`/
   `modelLabel`) already exists on the wire as `CommitMessageAgent`. Caveat: stamp it from
   what **actually ran** — the runner silently falls through the ladder, so the planned
   primary can differ from the executor.
2. **Cost: the real gap.** The daemon receives per-call usage including `totalCostUsd`
   (Claude/OpenCode/Pi populate it) onto the ephemeral agent — and the generation runner
   **discards it** one function call before the generator returns (`agent-response-loop.ts:376-399`
   reads only `finalText`). Threading usage through the runner's return type is the
   prerequisite for any cost display.
3. **Rendering: new plumbing.** No "system notice/receipt" timeline item type exists; this
   would be a new optional (protocol-compatible) timeline variant, plus an additive
   activity-stats counter (`generationsRun`) if we want aggregates.

## 6. Fan-out surfaces (agent-to-agent economics)

- **Chat mentions**: one `@everyone` post triggers up to **25 full-stack turns**
  (`CHAT_MENTION_FANOUT_LIMIT`), each replaying its target's entire prefix; reply-mentions
  can chain with no user in the loop.
- **`notifyOnFinish`** (default true agent-scoped): N children = N full parent turns, each
  carrying a child's unbounded final message.
- **`get_agent_activity`** defaults to the entire child transcript; repeated polling stacks
  full copies in the caller's history.
- **Fork / "continue in new chat"**: curates the **entire parent timeline uncapped**
  (`maxItems: 0`, message text untruncated) into the child's first prompt — a long chat
  forks 25K+ tokens that openai-compat then re-sends every round forever.
- **Schedules/heartbeats**: agents can self-install recurring cost via injected tools; each
  fire is a full-stack turn (existing-agent target = a context-growth ratchet with no
  scheduler-owned compaction; new-agent target = full cold start per fire; hourly = 24
  cold starts/day). The loop service pays **two** fresh bootstraps per iteration
  (worker + verifier) with **no default iteration cap**.
- **Orchestration runs**: up to 40 full agents per run (workers + one judge per candidate;
  judge input = candidate's entire output) + a hidden Writer summary at the end.
- **Composer auto-attach**: typing/pasting a PR/issue ref silently attaches the **full
  body** (forge cap ~65K chars ≈ 16K tok) into the prompt — and into the branch-name
  generation seed.

## 7. What Otto's accounting can and cannot see today

Trust table for anyone reasoning about Otto costs:

| Number                                                             | Verdict                                                                                                                                                                                               |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude `contextWindowUsedTokens` (ring fill)                       | **Trust** — streamed, real, includes cache read+write                                                                                                                                                 |
| Claude `totalCostUsd`                                              | **Trust** — provider-computed dollars                                                                                                                                                                 |
| Claude context popup                                               | **Trust** — SDK-reported categories                                                                                                                                                                   |
| openai-compat last-round `prompt_tokens`/`completion_tokens`       | Trust (that round only)                                                                                                                                                                               |
| `cumulativeTokens` (subagent rows, runs screen, visualizer totals) | **Do not read as cost** — resend-sum, O(turns × context), verified +2.9M for one 4-tool-call reply; different semantics per provider (Claude sums rounds, openai-compat keeps last only, Pi lifetime) |
| Activity-stats `tokensSent/Received`                               | Directional only — cache-blind, per-turn, includes hidden generations, misses failed turns / observed subagents / auto-compaction                                                                     |
| Visualizer $                                                       | **Do not trust** — stale blended rates × no cache discount × resend-sum ≈ 3×+ overstatement                                                                                                           |
| contextComposition ring segments                                   | Proportions are chars/4 estimates for every provider; systemPrompt never attributed                                                                                                                   |

Structural blind spots (no toggle recovers them): no per-API-request instrumentation
anywhere; openai-compat multi-round replacement undercount; auto-compaction usage counted
nowhere; failed/canceled turns counted nowhere; Claude `cache_creation_input_tokens`
dropped; whether Claude parent usage includes sidechain spend is unverified. The open
45K/75K ring mismatch is two metrics (occupancy vs. lifetime resend-sum + retired bank)
wearing one visual language — structural, not arithmetic.

## 8. Remediation menu (options, ranked by est. impact — NOT implemented)

**Tier 1 — architecture (biggest wins)**

1. **Internal-agent exemption from tool injection** (`agent-manager.ts:5155-5215`): one
   gate saves ~10–25K tokens per generation, per retry, per rung. The single cheapest
   large win in the codebase.
2. **A bare-completion path for generations** (no agent spawn at all) — removes the
   Claude preset/CLAUDE.md cost too.
3. **Tier-aware generation routing** in `resolveStructuredGenerationProviders` —
   cheapest-capable pick or fast-tier downgrade; data already present. Optionally a
   dedicated cheap role or per-generation model setting.
4. **Per-group catalog gating on the MCP path** + a preview-tools toggle + per-agent/
   per-workspace tool scoping. Plus dedup of the browser boilerplate sentence (−12–15.5%
   of that block for free).

**Tier 2 — caching & caps** 5. Send `prompt_cache_key` (and honor `prompt_tokens_details.cached_tokens`) on
openai-compat where the endpoint supports it; document the implicit-cache reality. 6. Cap the uncapped: Otto tool results, console/dev-server log line length, fork
attachment size, `get_agent_activity` default limit (e.g. 50 items, not ∞). 7. Auto-compact fallback when the endpoint reports no context length (e.g. fixed 32K
assumption) + re-arm logic for the disarm trap; prune/age images.

**Tier 3 — control & honesty** 8. Off-switches: `metadataGeneration.enabled=false`, pass-through for `promptSuggestions`
(concretely: set `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false` in the session env, or
stop hard-coding the option) and `agentProgressSummaries`, `notifyOnFinish` default
reconsidered, denial-count circuit breaker for unattended loops. 9. **Instrument per-API-request usage** (count requests per turn; sum openai-compat rounds
instead of replacing; capture cache writes; count auto-compaction + failed turns).
Prerequisite for everything user-facing. 10. **Generation receipts** (§5.5) + the total-token-accounting charter's glossary fix
("context" vs "total tokens", real $ from `totalCostUsd` where present). 11. Fix the two config landmines (`bootstrap.ts:628` dead `?? true`; switch rendering ON
while loading).

## 9. Per-feature quick-reference table

| Feature                                |                                                        Est. tokens | Frequency                | Default                 | Off switch                                                             |
| -------------------------------------- | -----------------------------------------------------------------: | ------------------------ | ----------------------- | ---------------------------------------------------------------------- |
| Otto catalog (default config)          |                                                         ~9,700/req | per-api-request          | off (fresh install)     | Enable Otto tools                                                      |
| Otto catalog (+browser)                |                                                        ~14,900/req | per-api-request          | browser off             | Browser Tools setting                                                  |
| — `create_agent` def                   |                                                             ~1,500 | per-api-request          | with catalog            | none individually                                                      |
| — browser tools def                    |                                                             ~5,000 | per-api-request          | off                     | browserTools.enabled                                                   |
| — preview tools def                    |                                                               ~700 | per-api-request          | **on with catalog**     | **none** (oai-compat group only)                                       |
| openai-compat builtins def             |                                                           ~950/req | per-api-request          | on                      | plan mode / web group                                                  |
| openai-compat full-history resend      |                                                   context × rounds | per-api-request          | on                      | compaction only                                                        |
| openai-compat compaction call          |                                                     up to ~100K in | per-event                | auto @80%               | auto_compact=off                                                       |
| Claude preset + CLAUDE.md              |                                                  ~9,000 (repo-dep) | per-session cache-write  | on                      | **none**                                                               |
| Claude promptSuggestions               | ~context/10 per turn (cache-read, no cache write, ≤12-word output) | per-turn (from 2nd turn) | on                      | env `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false` (not exposed by Otto) |
| Claude agentProgressSummaries          |                                                  per subagent /30s | per-event                | on                      | **none**                                                               |
| notify-on-finish                       |                                       child msg + full parent turn | per-event                | **true** (agent-scoped) | per-call param                                                         |
| Personality/team/role stack            |                                                            230–450 | per-session              | opt-in                  | don't use                                                              |
| Live personality switch / voice toggle |                                               full-context recache | per-event                | —                       | avoid mid-session                                                      |
| Chat auto-title                        |                                           15–25K × retries × rungs | per new chat             | on                      | **none**                                                               |
| Workspace/branch auto-name             |                                                               same | per new workspace        | on                      | **none**                                                               |
| Commit message gen                     |                                                  ≤30K diff + stack | per-event                | user-initiated          | write it yourself                                                      |
| PR text gen                            |                                                  ≤50K diff + stack | per-event                | user-initiated          | write it yourself                                                      |
| Run summary                            |                                                     stack + digest | per terminal run         | on                      | **none**                                                               |
| Loop iteration                         |                                                  2 full bootstraps | per-event                | user-initiated          | maxIterations                                                          |
| Orchestration run                      |                                                    ≤40 full agents | per-event                | user-initiated          | caps exist                                                             |
| @everyone mention                      |                                                     ≤25 full turns | per-event                | agent-driven            | fan-out cap only                                                       |
| Fork context attachment                |                                 unbounded (25K+ typical long chat) | per-event                | user-initiated          | **no cap**                                                             |
| browser_snapshot result                |                                                               ≤20K | per-event ×replay        | agent-driven            | page_text steering                                                     |
| Image attachment (oai-compat)          |                                            full base64 every round | per-api-request          | user-initiated          | until compacted                                                        |
