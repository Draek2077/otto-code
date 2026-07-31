# Brain coding capabilities

**What we will build:** coding-specific functionality on top of `@otto-code/brain`, so a
local model served from the brain reaches the same coding competence and frontier-tool
support Otto gives hosted providers. This is the fork's founding pattern applied to the
local host: a capability isn't done when a hosted provider has it, it's done when the
local brain does too.

Status lives in [`../README.md`](../README.md), not here. This charter describes the
tracks and their dependency order; it does not keep its own ledger.

## The four tracks

Four capabilities were scoped against the current tree (four parallel surveys, 2026-07-30).
The connective insight: **the benchmark is the spine.** `rankModels` already produces a
per-model coding score, but today it feeds only the TUI and the HTML report — nothing reads
it to _choose_ a model. Closing that loop is what turns "we measure coding quality" into "we
serve the best local coder automatically."

### A — Benchmark expansion (keystone)

Make the agentic-coding eval trustworthy enough to drive model selection.

- **Current state.** `packages/brain/src/bench/` has only **3 real coding tasks**, all static
  Python string fixtures. The `agentic-loop` task **simulates every tool result** and scores a
  fix by regex on the emitted text (`tasks.ts:340-368`, `348-353`) — a model can pass without a
  working fix. `tool-calling` is single-shot name/arg matching. Depth/concurrency tasks are
  hardware probes, not coding.
- **The dormant harness.** `bench/mine.ts` + `bench/repo.ts` already implement a SWE-bench-style
  oracle: `mine()` scans `git log` for commits touching both source and tests and emits
  `MinedTask { fix, parent, testPaths, sourcePaths }`; `Repo` drives one reused working copy with
  `reset` / `checkoutPaths` (apply the author's test as oracle) / `ensureDependencies` / `build`
  / `test` (parses vitest JSON into pass/fail sets). **Nothing wires them in** — no command, no
  `TASKS` entry, no tests.
- **First slice (highest leverage in the program).** A `MinedTask → Task` adapter that (a) resets
  the repo, (b) applies only the author's test paths via `checkoutPaths`, (c) hands the model
  _real_ read/write/run tools against the working copy, (d) scores on `repo.test()` pass/fail
  deltas. Then a small curated task set and per-task repetition for statistical robustness (today
  every task runs N=1 at temperature 0.3-0.4; `rankModels` std only accrues from manual reruns).
- Files: `bench/tasks.ts` (Task model, `:110-117`), `bench/index.ts` (driver, `:133`),
  `bench/verify.ts` (scoring), `bench/mine.ts`, `bench/repo.ts`, `ops/results.ts`
  (`rankModels`, `:413-443`).
- **Update (2026-07-31).** The `MinedTask → Task` adapter now exists: `bench/repo-task.ts`
  (+ `repo-task.test.ts`) is the SWE-bench oracle wired end to end — reset to the buggy parent,
  author's tests as a read-only oracle, real read/write/run tools, score on the test-delta. Still
  opt-in (needs a repo), not in the default `TASKS`. Also built: the **context-utilization metric** —
  agentic tasks now capture peak `prompt_tokens` across turns and report it as a fraction of the
  loaded window (`TaskRunContext.contextWindow`, threaded from `profile.contextSize`), so a run says
  how much context the model held while solving ("5/5 tests pass, held 51% ctx"). **Planned
  "extra-long-horizon" task (synthetic default + real opt-in, context-fill a reported metric):** a
  self-contained corpus (interlinked modules + markdown docs) whose bug fix requires _researching_ a
  spec scattered across the docs — the model must read widely (filling context) to fix correctly,
  scored on a hidden oracle like the agentic loop, with context utilization surfaced. Real mined
  repos remain the opt-in depth path. The bar in mind: a model should reach ~50%+ context on a
  real task before we call it agentic-capable.

### B — Curation & ranking-driven routing

Curate coding models, rank them, and route a coding request to the best local model that fits VRAM.

- **Current state.** The download catalog (`catalog.json`, schema `config/schema.ts:145-176`) carries
  rich coding metadata per entry (`useCases`, `tier`, `thinking`, `contextMax`), seeded from
  `config/downloads.json`. **That metadata dead-ends at `pull`:** once files land on disk, `scan.ts`
  rebuilds a `Model` (`types.ts:28-44`) from filename + GGUF header only — `useCases`/`tier` never
  reach discovery, pick, or routing. `pickModel` is pure string matching (`pick.ts:18-40`); routing
  selects by the client-supplied `model` name with no ranking and no intent detection
  (`router.ts:575-590`); VRAM fit (`vram.ts`) is a start-time gate, not a route-time selector.
- **B1 (independent).** Carry catalog coding metadata onto the scanned `Model` — reconcile a scanned
  model back to its `CatalogModel` (by hfRepo path) so `useCases`/`tier`/`thinking` survive download.
- **B2 (needs A).** A comparator that ranks candidates by A's bench score (with `std`/`runs` and a
  minimum-confidence gate) and a fit-filtered selector in `resolveModel` that picks the best coder
  that fits the VRAM budget. The scheduler's model-switch plumbing already exists.

### D — Frontier-tool parity for brain models

- **Current state (smaller than expected).** The brain is consumed as a plain OpenAI-compatible
  endpoint by `OpenAICompatAgentClient`
  (`packages/server/src/server/agent/providers/openai-compat-agent.ts`). Artifacts, MCP client loop,
  context compaction (with real window sizing off the brain's reported `loaded_context_length`),
  permission modes, and the injected Preview _workflow doctrine_ are **already provider-agnostic or
  openai-compat-native**. What's missing is narrow and concrete.
- **First slice — the load-bearing gap.** Tool-result images are **dropped**: `ottoResultToText`
  (`openai-compat-agent.ts:1284-1303`) keeps only text/`structuredContent` and discards `image`
  content parts, so `browser_screenshot` never reaches the model and **browser-verify is blind on
  every openai-compat model.** Feed image tool-results back as `image_url` (mirroring the user-image
  path at `:405-417`), gated on the brain's already-reported `type: "vlm"|"llm"` (`router.ts:243`),
  with a text-only fallback that prefers `browser_snapshot`/`browser_page_text` for non-vision models.
- **Follow-ons.** Surface the brain's `reasoning-only`/`truncated` verdict (`router.ts:143-186`,
  telemetry `:106-117`) to the Otto agent instead of a silent empty turn. Note the related tracked
  row "Tool-call cards render MCP results as raw JSON" in [`../README.md`](../README.md) — the same
  image channel.
- **Follow-on (from the shipped first slice, 2026-07-30).** Tool-result images currently ride inside
  the `role:"tool"` message as `image_url` parts — accepted by llama.cpp/LM Studio (the local targets,
  correctly capability-gated), but the _strict_ OpenAI API rejects images in tool-role messages, so a
  strict-OpenAI vision endpoint + browser tools + `unknown` capability would 400 where it previously
  dropped the image and worked-blind. Move to the OpenAI-canonical shape (image in a following
  `user` message) or default `unknown`-capability to not-send, to keep the provider-agnostic promise.

### C — Inline completion (moved out — it is an Otto feature, not a brain feature)

Originally scoped here as "local FIM/autocomplete." **Reframed 2026-07-30:** editor inline
completion is a provider-neutral **Otto** capability driven by whatever provider the user picks
(Claude, OpenAI-compatible, brain, …), not a brain feature. FIM is one implementation strategy
(the one FIM-trained local models use), not the feature. Moved to its own charter:
[`../inline-completion/inline-completion.md`](../inline-completion/inline-completion.md). What
stays brain-side is only an **input** to that feature: a managed low-latency `/infill` lane and
FIM-token detection in `gguf.ts`, which let the Otto feature default to a fast local completion
model when one is present.

## Dependency order

1. **A** — keystone, unblocks B2. Contained in `packages/brain`.
2. **B1** — independent, can run alongside A.
3. **D** — independent, touches `packages/server`. Restores the founding Preview proof for local models.
4. **B2** — after A lands (needs the ranking).
5. **C** — separate effort, whenever the cross-layer surface is committed.

## Load-bearing constraints (do not relearn these)

- Protocol stays backward-compatible; new capability rides `server_info.features.*` with a
  `COMPAT(...)` cleanup tag. New RPCs use dotted namespaces with direction suffixes.
- The local brain is **opt-in**; nothing here may auto-start it.
- Preserve the brain's empirical header comments (DLL-stub trap, KV overestimate, reasoning-only
  failure). Byte quantities stay raw internally, formatted only at the edge.
- Never run the full test suite; run only the changed test file.

## When this drains

Fold the durable design into a `docs/` page (a brain coding-capabilities page, or extend the
brain's own docs), move any remaining tail into [`../README.md`](../README.md) Open work, then
remove this folder.
