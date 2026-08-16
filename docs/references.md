# References and sources

> **Legacy migration source.** References now live in confirmed
> `.otto/knowledge/references/` pages and are managed through Otto Knowledge. Do not update this
> file. It remains temporarily for migration and UI parity review.

Every external source Otto has drawn on - libraries we vendored, prior art we read, specs we
implemented, projects we surveyed and rejected - with **why we used it and what it contributed**.

## Why this file is in `docs/`

`docs/` is for durable, evergreen facts about how Otto works. Where an idea came from is exactly
that kind of fact: it outlives the project folder that introduced it, it does not change when the
code is refactored, and it is the thing a future reader most often cannot reconstruct. Point-in-time
plans live in `projects/`, but the influences those plans cite need a home that survives the plan
being deleted - which is what happens to a project folder once it ships. This is that home.

The value is **re-readability**. Six months out, "useful patterns for agents" tells you nothing.
"We took the excluded-branch poison value and the Coalesce fan-in from Rivet, and rejected its
persistence model because it dies with the host" tells you whether to go back.

## How to use it

- **Adding a source.** When work is informed by something external - even if you end up not using
  it - add a row here in the group it informed. If a project folder cites it, this file is where the
  citation survives the folder's deletion.
- **Rejections are first-class.** A source marked _Considered and rejected_ is worth as much as an
  adopted one: it stops the next person re-evaluating the same thing, and it records the criterion
  that failed. Never delete a rejection; downgrade an adoption to one if it gets dropped.
- **Say what it contributed, not what it is.** A link plus a one-line description of the project is
  a bookmark. The entry earns its place with the sentence that starts "what we took" or "why not".

### Status vocabulary

| Status                      | Meaning                                                                         |
| --------------------------- | ------------------------------------------------------------------------------- |
| **Vendored**                | Its code is in this repo (subtree, copy, or fork). Carries license obligations. |
| **Dependency**              | Consumed as a package or an external process we spawn.                          |
| **Implemented**             | A spec or protocol we wrote our own conforming implementation of.               |
| **Read, not linked**        | We studied it and re-wrote the ideas in our own vocabulary. No dependency.      |
| **Considered and rejected** | Evaluated and turned down. The entry records the failing criterion.             |
| **Unevaluated**             | Supplied or found, characterized here, but no decision taken yet.               |

---

## 1. Foundations and licensing

Sources that Otto is legally and structurally built on. These carry obligations, not just ideas.

| Source                                                                                           | Status                                           | What it contributed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[Otto](https://github.com/Draek2077/otto-code)** - Mohamed Boudra, AGPL-3.0                    | **Vendored** (fork base)                         | The entire foundation: agent process lifecycle, the WebSocket protocol, cross-platform clients, the E2E-encrypted relay. Otto is a modified fork and continues under AGPL-3.0. Merge cadence, rebrand tooling and the ledger of upstream changes we deliberately skipped: [upstream-merges.md](upstream-merges.md). Attribution: `NOTICE`, `README.md`.                                                                                                                                                                             |
| **[Agent Flow](https://github.com/patoles/agent-flow)** - Simon Patole, Apache-2.0               | **Vendored** (git subtree, `vendor/agent-flow/`) | The Visualizer's **render layer only**. It fit because upstream kept rendering separate from event collection behind a documented bridge protocol - that one decision let Otto drive the same graph from its own provider-neutral event stream, so it lights up for every provider rather than only the runtime upstream ingests. We do **not** take its Claude/Codex ingestion. Trademark: "Agent Flow" is never a UI label; the feature is "Visualizer". See [visualizer.md](visualizer.md), `vendor/agent-flow/OTTO-PATCHES.md`. |
| **[expo-two-way-audio](https://github.com/speechmatics/expo-two-way-audio)** - Speechmatics, MIT | **Vendored** (`packages/expo-two-way-audio`)     | Two-way audio capture/playback for voice mode. Speechmatics' MIT library, forked once upstream, now vendored here. The `author` field still credits Speechmatics deliberately - only the fork URLs were repointed (`projects/marketing-strategy/`).                                                                                                                                                                                                                                                                                 |
| **[Contributor Covenant](https://www.contributor-covenant.org/)**                                | **Adapted**                                      | The code of conduct text in `vendor/agent-flow/` and `packages/expo-two-way-audio/`, inherited with those trees.                                                                                                                                                                                                                                                                                                                                                                                                                    |

---

## 2. Agent architecture and orchestration patterns

**The group that matters most for where Otto is heading.** The planned initiative - reusable
coding-pattern templates executed by the orchestration system - draws almost entirely from here.
See §12 for the reading order.

### 2.1 Pattern catalogs (supplied by the product owner, 2026-07-25)

These four are catalogs of ideas rather than components to adopt. They are characterized honestly
below, including what does **not** apply to Otto.

#### [all-agentic-architectures](https://github.com/FareedKhan-dev/all-agentic-architectures) - Fareed Khan, MIT - **Unevaluated**

**What it actually is:** a Python library plus 35 executed Jupyter notebooks, one per architecture,
built on **LangGraph** state machines with a uniform `Architecture` class interface, 283 unit tests,
9 LLM provider integrations, and a self-scored 17-task benchmark (README reports 33/42 correct,
78%). It is simultaneously a library, a textbook and a benchmark. Crucially, the theory is written
against captured real runs rather than hypothetical examples - which is what makes it worth reading
rather than skimming.

**The 35, by family:** Reasoning & Reflection (5) - Reflection, Reflexion, Chain-of-Verification,
Self-Discover, Constitutional AI. Sampling & Search (5) - Self-Consistency, Tree of Thoughts, LATS,
Mental Loop, Ensemble. Retrieval/RAG (5) - Agentic RAG, Corrective RAG, Self-RAG, Adaptive RAG,
GraphRAG. Memory (5) - Episodic + Semantic, Graph Memory, MemGPT, Voyager, Agent Workflow Memory.
Tools & Actions (6) - Tool Use, ReAct, Planning, Plan-Execute-Verify, SWE-Agent, BrowserAgent.
Multi-Agent (5) - Multi-Agent, Blackboard, Debate, STORM, Meta-Controller. Safety & Routing (3) -
Dry-Run, Reflexive Metacognitive, Computer Use. Specialty (2) - RLHF Self-Improvement, Cellular
Automata.

**Relevant to Otto - high value:**

- **Plan-Execute-Verify** and **Chain-of-Verification** are the closest published statements of what
  `projects/agent-orchestration` already calls the requirements-immutable / audit-every-bullet loop,
  and what an orchestration graph's Check node is for. Read before finalising the verifier node's
  structured output.
- **Meta-Controller** and **Blackboard** are the two multi-agent topologies Otto's graph engine can
  express but has no template for. Blackboard in particular maps onto artifacts-as-shared-state,
  which is the design decision already taken in `orchestration-design.md` Part 6 (files, not
  reducers).
- **Agent Workflow Memory** and **Voyager** are the two memory architectures that are about
  _accruing reusable skills from completed work_ - directly the "reusable coding pattern template"
  idea, from the memory side rather than the graph side. These two are the single most relevant
  items in the repo for the planned initiative.
- **SWE-Agent** and **Dry-Run** speak to coding-specific agent behaviour and to a safety posture
  Otto already has an analogue of ([safe-unattended.md](safe-unattended.md)).

**Relevant but redundant:** ReAct, Tool Use, Planning, Reflection - Otto does not implement these;
the provider CLIs it supervises do. Reading them clarifies vocabulary, not implementation.

**Not relevant to Otto:**

- **The whole LangGraph implementation layer.** Otto never calls a model - the daemon spawns Claude
  Code, Codex, Copilot CLI, OpenCode or Pi as OS processes, each owning its own model connection and
  tool loop. The reasoning about node/state/checkpoint transfers; the code does not. This is the
  same conclusion reached independently in `orchestration-design.md` Part 8.
- **The RAG family (5) and the retrieval plumbing.** Otto has no corpus and no embeddings; its
  "retrieval" is a file explorer and an LSP. Interesting as background for a future memory-search
  design, not as architecture.
- **Cellular Automata, RLHF Self-Improvement, Ensemble, Self-Consistency.** Sampling-time techniques
  that assume you control the inference loop. Otto does not.
- **The benchmark.** Self-scored on its own 17 tasks; treat the 78% as a smoke test that the
  notebooks run, not as evidence any architecture is better than another.

#### [Agentic Design Patterns](https://github.com/evoiz/Agentic-Design-Patterns) - Antonio Gulli - **Unevaluated**

**What it actually is:** the full 424-page PDF of Gulli's book _Agentic Design Patterns: A Hands-On
Guide to Building Intelligent Systems_, plus per-chapter Jupyter notebooks. 21 chapters, 7
appendices. Examples use LangChain and the OpenAI APIs, and reference AutoGPT, AutoGen and CrewAI.
Author royalties go to Save the Children. This is a **book with code**, not a library - the value is
the taxonomy and the prose, and it is the most complete vocabulary in this group.

**The 21 chapters:** Prompt Chaining · Routing · Parallelization · Reflection · Tool Use · Planning ·
Multi-Agent Systems · Memory Management · Learning and Adaptation · Model Context Protocol (MCP) ·
Goal Setting and Monitoring · Exception Handling and Recovery · Human-in-the-Loop · Knowledge
Retrieval (RAG) · Inter-Agent Communication (A2A) · Resource-Aware Optimization · Reasoning
Techniques · Guardrails/Safety Patterns · Evaluation and Monitoring · Prioritization · Exploration
and Discovery.

**Relevant to Otto - high value:**

- **Ch. 11 Goal Setting and Monitoring**, **Ch. 12 Exception Handling and Recovery**, **Ch. 13
  Human-in-the-Loop** are the three chapters that describe things Otto's graph engine has as
  first-class nodes (budget/ceiling, retry policy, Gate). Read them against
  [orchestration-node-capabilities.md](orchestration-node-capabilities.md) - this is the closest
  published treatment of the same design space.
- **Ch. 16 Resource-Aware Optimization** is the missing prose for [token-economy.md](token-economy.md): Otto has the measurements but no framework for reasoning about them.
- **Ch. 8 Memory Management** and **Ch. 9 Learning and Adaptation** are the direct input to
  personality memory, now shipped ([agent-personalities.md § Memory](agent-personalities.md#memory-accrued-lessons)).
  Read them against what shipped: the scoping question resolved to `global ∪ thisProject`, resolved
  rather than configured.
- **Ch. 19 Evaluation and Monitoring** and **Ch. 20 Prioritization** bear on what an orchestration
  run should report back, which is an open area.
- **Appendix G (coding agents)** and **Appendix E (CLI agents)** are the parts closest to Otto's
  actual product.

**Not relevant to Otto:**

- **Ch. 1–7 (the core patterns)** - the same in-process-agent-loop layer as above. The provider CLI
  owns all of it.
- **Ch. 15 Inter-Agent Communication (A2A)** - Otto's agents communicate through the daemon and
  through the filesystem, deliberately. A peer-to-peer agent protocol is a different architecture,
  and adopting one would undo the daemon-owns-execution property that
  the orchestration survey identifies as the differentiator.
- **The LangChain/CrewAI/AutoGen example code** throughout. Framework-specific and irrelevant for
  the same reason as above.

**Caveat:** it is a broad survey book. Expect the chapters to be shallower than the specific
engineering write-ups in §2.2 - use it for vocabulary and completeness checks, not for depth.

#### [COG - second brain](https://github.com/huytieu/COG-second-brain) - huytieu - **Unevaluated**

**What it actually is** (and this is the one most likely to be mischaracterized): **not** a tool, a
database, or an MCP server. It is a **prompt pack and vault convention** - ~21 Claude Code skill
definitions, 6 worker-agent definitions, 7 role packs, manifests for Claude Code / Cursor / Kiro /
Gemini CLI, and a PARA-style directory layout, all as markdown. "COG" = Cognition + Obsidian + Git;
the pitch is "no database, no vendor lock-in - just `.md` files that think". There are **no
embeddings and no graph database** - consolidation is done by AI passes over markdown
cross-references.

**Relevant to Otto - high value.** This is the closest existing analogue to Otto's shipped
[personality memory](agent-personalities.md#memory-accrued-lessons), and it validates the central bet
(daemon-owned, file-based, no new storage engine) with a working example. Otto landed on **one file
per personality** rather than one file per fact, because here the daemon maintains the store instead
of an agent doing it by hand. The four mechanisms worth taking:

1. **Tiered promotion by evidence count.** An entity starts as a Tier 3 stub on first mention,
   escalates to Tier 2 at 3+ references, and to Tier 1 at 8+ mentions or direct contact. This is a
   concrete, cheap answer to "when is a fact worth writing down properly". Otto shipped a cruder
   version of the same idea - `reinforcedCount`, bumped when a near-duplicate is recorded again,
   which orders the injection budget and is shown in the brief. Tiers-by-user-setting were rejected
   outright as bookkeeping. What COG has and Otto does not is escalation driven by
   evidence.
2. **`last_verified` + confidence stamps with source citations on every observation.** Memory that
   records how it knows something, and how stale that is.
3. **The `memory-hygiene` skill** - a periodic trust sweep that re-verifies stored claims against the
   live environment and re-stamps them. Otto's charter has "prune when wrong" as guidance text; this
   makes it an operation. Directly applicable, and the single best idea in the repo for Otto.
4. **Skill distillation / model routing** - exploration on a capable model, execution on cheaper
   workers. Otto already has the casting layer to express this
   ([agent-personalities.md](agent-personalities.md)); COG shows the pattern applied to memory work
   specifically.

**Not relevant to Otto:**

- **The vault taxonomy** (`00-inbox/`, `01-daily/`, `02-personal/`, PARA) is a personal-knowledge
  structure for a human's notes. Otto's memory is per-personality, per-project, and about code
  mechanisms. Do not import the folder scheme.
- **The PM/CRM workflow skills** - people profiles, meeting transcripts, PRD generation,
  Confluence/Linear/Slack integrations, content-factory. Entirely outside Otto's product.
- **The multi-platform manifest sprawl** (`.kiro/`, `.gemini/`, `AGENTS.md`) - Otto's answer to
  provider neutrality is the daemon's own MCP surface, not per-CLI config files.
- **The absence of search** is a real limitation to note, not a feature to copy: with no embeddings
  and no index, recall is whatever the model can find by reading. Fine at personal-vault scale;
  Otto's charter should decide deliberately whether it inherits that ceiling.

#### [OpenResearcher](https://github.com/TIGER-AI-Lab/OpenResearcher) - TIGER-AI-Lab - **Unevaluated**

**What it actually is:** a **trained model plus its training pipeline**, not an agent framework.
OpenResearcher-30B-A3B, trained with Megatron-LM on a 96K-trajectory deep-research dataset (100+
turns each) generated by GPT-OSS-120B with native browser tools, over a self-built retriever
(Qwen3-Embedding-8B + BM25) on an ~11B-token corpus so trajectory generation needs no external
search API. Ships vLLM deployment scripts, a local search service and an evaluation harness. Paper:
[arXiv:2603.20278](https://arxiv.org/abs/2603.20278). Reports 54.8% on BrowseComp-Plus, claimed
above GPT-4.1 / Claude-Opus-4 / Gemini-2.5-Pro / DeepSeek-R1 / Tongyi-DeepResearch; also evaluated on
BrowseComp, GAIA-text and xbench-DeepResearch. No license stated in the README - **check before any
use.**

**Relevant to Otto - narrow but real:**

- **Long-horizon trajectory shape.** 100+ tool-using turns per task is the regime Otto's orchestration
  runs actually operate in, and almost nothing else published describes it concretely. Their
  trajectory schema is worth reading when designing what a graph run records per node.
- **It is a strong local model for a long-horizon role.** Otto's fork thesis is frontier tooling for
  local providers too, and the daemon already drives LM Studio over the openai-compat provider
  ([custom-providers.md](custom-providers.md)). A 30B-A3B research-tuned model is a plausible
  occupant of the `researcher` role in `projects/agent-orchestration`. Nothing to build - a model to
  try.
- **The self-built-retriever move** - removing an external API dependency from the data pipeline - is
  the same instinct as `projects/web-search-providers` (making the search engine selectable rather
  than fixed).

**Not relevant to Otto:**

- **Everything about training.** Otto does not train models and has no plan to. Megatron-LM, the
  distillation recipe, the 96K dataset and the trajectory synthesis are out of scope entirely.
- **The retrieval stack** (dense embeddings, BM25, 11B-token corpus). Otto has no corpus.
- **The benchmarks.** BrowseComp/GAIA measure web research, not code editing. They say nothing about
  whether a model is good at Otto's actual job, and should not be cited as if they do.
- **The browser automation half** is superseded for Otto by the Preview subsystem ([preview.md](preview.md)),
  which drives a real tab in the Otto browser pane with a token-economy design this does not have.

**Bottom line:** the weakest fit of the four for architecture, and the only one that is a model
rather than a set of ideas. Keep it for the local-provider angle and the long-horizon trajectory
data, not for design.

#### [AgentX-Python](https://github.com/AgentX-ai/AgentX-Python) - AgentX-ai, MIT - **Read, adopted in part** (2026-07-25)

**What it actually is:** the official Python **client SDK for a hosted platform**, not an engine.
Execution lives in their cloud; the SDK exposes `Agent → Conversation → Message`, plus local
instrumentation. Also ships framework integrations (LangChain, CrewAI, OpenAI, Anthropic,
Google) and MCP connectivity.

**Rejected as architecture, and the rejections are the useful part:**

- **The hosted model.** Otto is daemon-owned and local-first; that is the product, not an
  implementation detail.
- **"Workforce with a manager agent"** - a designated manager coordinating specialists is _the
  model picking the topology_. That is the AI flavour the orchestration competitive survey
  (§2.3) explicitly rejected in favour of user-authored deterministic graphs. Adopting it would
  undo the differentiator.
- **`Agent → Conversation → Message`** is a chat model, not a DAG, and the framework wrappers
  are the same in-process layer Otto never occupies.

**Adopted as the vocabulary for the evaluation layer Otto does not have.** This is the first
source surveyed that treats agent telemetry and scoring as first-class product surface rather
than an afterthought, and it closes an area both Gulli Ch. 19–20 and §12 item 6 flag as open:

1. **A trace is a unit with a defined shape** - per run: input, output, latency, tool calls,
   token usage; per tool call: name, input, output, `latency_ms`. That is close to the per-node
   record Otto lacks entirely (`Run` carries `agentCount` and nothing else).
2. **Three scoring mechanisms, not one** - LLM-as-judge (0–10), cosine similarity (embeddings),
   Jaccard (token-set overlap). **The single most useful idea here.** Otto grades with exactly
   one mechanism: an agent judger returning a prose verdict - the most expensive, slowest and
   driftiest of the three, and currently the only one. Deterministic scoring where the answer is
   checkable is the argument for the unbuilt `check` node (a command plus an expectation, no
   model, ground truth rather than opinion).
3. **Patterns** - semantic detection rules evaluated over recorded traces, with severity, run
   automatically when monitoring is on. Otto's analogue is regression detection on graph
   templates: _did this template start behaving differently than it used to?_
4. **Datasets + evaluations as a resource** - scored test cases with a run/finalize/analyze
   shape. The direct input to a golden-graph harness on the T2 local-AI tier (§9).

**The generalizable lesson:** you cannot settle "does orchestrating agents actually work" by
argument, only by measurement - and measurement needs a defined unit, more than one scoring
mechanism, and a corpus of real tasks.

### 2.2 Orchestration engines and graph semantics

Surveyed 2026-07-21 for the orchestration graph engine. The governing decision (Philippe): **learn
the concepts, write them ourselves, in our vocabulary** - the same treatment the Visualizer got. The
test applied to every borrowed concept: _does this exist because agents need it, or because graphs
need it?_ Full working: `archive/projects/orchestration-graphs/orchestration-design.md` Parts 6–9 (archived).

| Source                                                                    | License                                                        | Status                      | What it contributed / why not                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[LangGraph](https://github.com/langchain-ai/langgraph)** / LangGraph.js | MIT                                                            | **Read, not linked**        | The science of durable agent graphs. **Taken as concepts:** checkpoint-after-every-step, interrupt/resume, conditional edges + router, `Send` dynamic fan-out (our Map node), subgraphs, per-node retry + recursion limit. **Skipped:** shared typed state + reducers (artifacts are files; the filesystem already has ownership semantics), `Command` update+goto (that is the model taking control back from the user), deterministic replay + saga compensation (git is our compensation mechanism). **Not linked because** its node is an in-process function returning a state delta in milliseconds; ours spawns an OS process that edits a real repo for minutes to hours. Also: `Run` is a protocol type with back-compat guarantees, so a second state model would have to be projected into it anyway. |
| **[Rivet](https://github.com/Ironclad/rivet)** - Ironclad                 | MIT                                                            | **Read, not linked**        | The closest working model of Otto's exact architecture, and the one project here both agent-shaped and legally borrowable. **Taken:** the executor/canvas split, **named typed ports** (`{outputNodeId, outputId, inputNodeId, inputId}` - the sequencing insight that had to land before any control-flow node), the `control-flow-excluded` poison value propagating through untaken branches plus explicit `Coalesce` fan-in, and its node-palette vocabulary. **Rejected as a dependency** because it has _no durable persistence at all_ - `pause()`/`resume()` are in-process promises, so if the host dies the run dies - and no notion of agent identity, repo, or authority.                                                                                                                            |
| **[Activepieces](https://github.com/activepieces/activepieces)**          | MIT (`packages/ee/**` carved out)                              | **Read, not linked**        | The **pause/resume model, near-verbatim**: a `PAUSED` status plus a discriminated `PauseMetadata` persisted on the run row, and a boot-time worker that rehydrates paused runs. Roughly sixty readable lines closing Otto's gate + restart-resume gap.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **[Windmill](https://github.com/windmill-labs/windmill)**                 | engine AGPL; **OpenFlow spec Apache-2.0**                      | **Read (spec only)**        | The spec, not the engine: suspend declared as `{ required_events, timeout, resume_form, user_auth_required }`, and flow state as a blob on the job row so a suspended run is simply a row nothing picks up.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **[Sim](https://github.com/simstudioai/sim)**                             | Apache-2.0                                                     | **Read, not linked**        | Two schema ideas: conditions live **on the edge** (`condition: { type: 'if' \| 'else if' \| 'else', expression }`), and loops/parallels as first-class keyed containers rather than cyclic edges.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **[Dify](https://github.com/langgenius/dify)**                            | source-available (modified Apache)                             | **Read - ideas only**       | Its `BlockEnum` is the best palette **taxonomy**: control flow (`if-else`, `iteration`, `loop`, `variable-aggregator`) separated from capability (`llm`, `agent`, `tool`, `code`, `http-request`) separated from lifecycle (`start`, `end`, `human-input`). **Code is off-limits** - no-multi-tenant and logo clauses.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **[Kestra](https://github.com/kestra-io/kestra)**                         | Apache-2.0                                                     | **Read, not linked**        | `Pause` with an `onResume:` block declaring **typed inputs that render as a form** - the shape Otto's Gate node's "ask the human something" should take.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **XState v5**                                                             | MIT                                                            | **Considered and rejected** | The one genuine embeddable candidate: in-process, no infra, `getPersistedSnapshot()`/restore, actor supervision that maps onto child processes. Rejected **for consistency** - the daemon already hand-rolls its lifecycle state machine in a ~6,000-line `AgentManager`, and adding a state-machine library for one subsystem buys a second idiom rather than removing one.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Inngest · Temporal · Restate · Motia · Trigger.dev**                    | mixed (Motia ELv2, Inngest SSPL)                               | **Considered and rejected** | Need their own process and call into your code - they invert control by construction. Ruled out on architecture before licensing: the daemon already owns process lifecycle, cancellation and persistence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Mastra · VoltAgent · LangChain.js**                                     | Apache-2.0 / MIT / MIT                                         | **Considered and rejected** | Embed fine, but their value is LLM plumbing Otto does not need - our nodes are external CLI processes, not in-process model calls. LangChain specifically is the wrong layer: it normalizes providers, prompts, memory and retrievers, and **Otto never calls a model**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **n8n · ComfyUI · Flowise**                                               | Sustainable Use / GPL-3.0 / Apache-2.0 with per-file carve-out | **Rejected on license**     | n8n prohibits commercial use of the software outright - don't read it with intent to borrow. ComfyUI is GPL-3.0 with no linking exception (the typed-socket _idea_ is free, the code is not). Flowise's commercial carve-out is per-file by copyright header, so it cannot be audited mechanically.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **[Drawflow](https://github.com/jerosoler/Drawflow)**                     | MIT                                                            | **Vendored** (frozen)       | The orchestration designer canvas. Vendored frozen on purpose - dormant since Sep 2024 with 272 open issues, and no engine - because Otto owns the wrapper and the engine.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **[Rete.js](https://github.com/retejs/rete)**                             | MIT                                                            | **Watching**                | The replacement if Drawflow ever needs one: the only library in the survey with a genuinely headless, framework-free, separately-installable node engine (`rete-engine`). React Flow (MIT) is the safe canvas-only alternative.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

**The seven things bespoke engines get wrong** - distilled from the whole survey and worth reading
as a unit before touching the engine: checkpoint before advancing (including the pending frontier);
idempotent re-execution on resume (memoize by `(runId, nodeId)`); string-keyed interrupts, never
positional (LangGraph matches by index, so editing a graph between suspend and resume mis-binds the
payload); two separate counters (per-node retry **and** a run-wide budget - nested retries compound);
deferred fan-in that waits on pruned branches too; declared merge semantics for concurrent writes;
and leases with a visibility timeout so a dead executor's node becomes reclaimable.

### 2.3 Competitive survey - agent orchestration products (2026-07-21)

The question asked: is anyone shipping a **user-authored visual graph that a daemon deterministically
executes over real coding-agent CLIs, with human gates and verification, monitored remotely**?
Answer: no. Recorded here because the negative result is the strategic finding, and because the churn
rate means it needs re-running periodically. Full detail: `orchestration-design.md` Part 7.

| Project                                                                                                                                                                                                                                                                                                                                                       | Where it stops                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[claude-workflow-composer](https://github.com/fayzan123/claude-workflow-composer)** (MIT)                                                                                                                                                                                                                                                                   | The only one with a real canvas including dedicated approval-gate nodes - but it **flattens the graph into a natural-language orchestrator skill** Claude then interprets. Non-deterministic by construction; the exact failure daemon-held barriers exist to avoid. |
| **[awslabs/cli-agent-orchestrator](https://github.com/awslabs/cli-agent-orchestrator)** (Apache-2.0)                                                                                                                                                                                                                                                          | Strongest execution story - nine real CLIs in tmux, MCP handoff, declarative YAML with conditional gating and cron. No visual editor, no first-class human-approval node, no mobile.                                                                                 |
| **[Nimbalyst](https://github.com/nimbalyst/nimbalyst)** (MIT)                                                                                                                                                                                                                                                                                                 | The only OSS project with both a canvas and iOS/Android companions - but its canvas is a spatial knowledge workspace; edges document relationships, nothing traverses them.                                                                                          |
| **[AGX](https://github.com/ramarlina/agx)**                                                                                                                                                                                                                                                                                                                   | Explicit approve/reject before irreversible steps and **durable checkpointed execution across restarts** - worth studying for Otto's resume gap. The flow is a fixed built-in lifecycle, not user-authored.                                                          |
| **[OpenHands](https://github.com/All-Hands-AI/OpenHands)**                                                                                                                                                                                                                                                                                                    | Best-resourced; real sandboxes, ACP to third-party CLIs. Its "Agent Canvas" is a conversation control center, not a DAG authoring surface. **The main competitive risk** - it could add graph authoring over ACP.                                                    |
| Parallel runners - [vibe-kanban](https://github.com/BloopAI/vibe-kanban) (sunsetting), [claude-squad](https://github.com/smtg-ai/claude-squad), [CCManager](https://github.com/kbwo/ccmanager), [uzi](https://github.com/devflowinc/uzi), [Crystal](https://github.com/stravu/crystal) (deprecated), [container-use](https://github.com/dagger/container-use) | Worktree/tmux fan-out with a kanban or TUI. They run many agents; they don't compose them. The niche is commoditized and churning hard - five of six dead, deprecated or sunsetting within about six months.                                                         |
| AI-planned swarms - [ruflo/claude-flow](https://github.com/ruvnet/ruflo), [Agent-MCP](https://github.com/rinadelph/Agent-MCP)                                                                                                                                                                                                                                 | The model picks the topology. That is the AI flavor, not the user flavor. claude-flow specifically is heavily overclaimed - its "100+ agents" are prompt templates plus MCP tools inside Claude Code.                                                                |
| Ruled out as not-what-they-sound-like - [SWE-agent](https://github.com/SWE-agent/SWE-agent) (single-agent YAML loop), [Task Master](https://github.com/eyaltoledano/claude-task-master) (PRD parser over MCP; MIT + Commons Clause, **not** OSI open source), Conductor (closed-source), MetaGPT/ChatDev/Devika (in-process role-play)                        | -                                                                                                                                                                                                                                                                    |

### 2.4 Otto's own prior art

| Source                                                                    | Status                  | What it contributed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Otto's `/epic`** (removed upstream in `59b32ab3b`, near the fork point) | **Read, being revived** | A 336-line orchestrator plus a `roles.md` reference. What `projects/agent-orchestration` takes: **separating the plan vocabulary from the role cast** (phase types `refactor · implement · verify · gate · deliver`, with roles as the dispatcher's type→agent map - the plan never names roles); a single-writer resumable plan as source of truth, resumable by a fresh conductor reading frontmatter status; structured verifier output ("YES/NO per acceptance criterion, with evidence - file/line/test"); and the requirements-immutable, audit-every-bullet loop. **What we fix:** `/epic` was prose a model hand-executed; Otto's substrate is a daemon-owned `Run` with deterministic execution. |
| **Claude's Task tool complexity gate**                                    | **Read**                | The principle that small tasks are done solo and complexity earns orchestration - adopted as the trigger condition in `projects/agent-orchestration`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Anthropic's artifact-passing shape**                                    | **Read**                | Contributed to `NodeOutput { summary, artifacts, fields?, evidence? }` in `orchestration-design.md` Part 9, alongside Rivet's typed ports.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

---

## 3. Agent memory and knowledge accrual

The other direction Otto is heading. Personality memory shipped 2026-07-25
([agent-personalities.md § Memory](agent-personalities.md#memory-accrued-lessons)) on top of the
context surface ([context-management.md](context-management.md)); the sources below are what the next increment -
smarter consolidation, retrieval at scale - should be built against.

| Source                                                                           | Status                      | What it contributed                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[COG - second brain](https://github.com/huytieu/COG-second-brain)**            | **Unevaluated**             | The four mechanisms in §2.1: evidence-count tier promotion, `last_verified` + confidence + source stamps, the `memory-hygiene` re-verification sweep, and capable-model-explores / cheap-model-executes routing. Validates the file-based, no-database bet. Its lack of any search index is the limitation to decide about deliberately.                                   |
| **all-agentic-architectures - Memory family**                                    | **Unevaluated**             | Episodic + Semantic, Graph Memory, MemGPT, **Voyager**, **Agent Workflow Memory**. The last two are about accruing _reusable skills from completed work_ - the bridge between this section and §2, and the most directly relevant published work to the planned initiative.                                                                                                |
| **Agentic Design Patterns Ch. 8–9** (Memory Management; Learning and Adaptation) | **Unevaluated**             | Vocabulary and completeness check. Otto shipped without tiers; these chapters are the place to look before adding any.                                                                                                                                                                                                                                                     |
| **Claude Code's own `MEMORY.md` + one-fact-per-file pattern**                    | **Read, adopted**           | Read, then **deliberately diverged from**. The index-plus-`recall` split it uses exists because an _agent_ maintains that store by hand; Otto's daemon maintains it, so the full lesson text is injected inside a token budget and there is no second tool. What Otto did adopt is the shape: plain files, no storage engine, and a system-prompt block composed at spawn. |
| **[mindmuxai/brain.md](https://github.com/mindmuxai/brain.md)**                  | **Read, adapted**           | Project knowledge should be repo-native rich Markdown with human slugs, wiki links, six project-map roots, active-only daily retrieval, and append-only change evidence. Otto adapts those invariants under `.otto/KNOWLEDGE.md` through daemon tools rather than brain.md's external CLI. Every chat gets a compact discovery catalog; full pages remain pull-on-demand.  |
| **PARA** (Projects / Areas / Resources / Archive) - Tiago Forte, via COG         | **Considered and rejected** | A personal-knowledge taxonomy for a human's notes. Otto's memory is per-personality, per-project and about code mechanisms; importing the folder scheme would be cargo-culting.                                                                                                                                                                                            |
| **graphify** (`~/.claude/skills/graphify`, `docs/graphify-out/`)                 | **Dependency** (tooling)    | Knowledge-graph extraction over this repo's own docs and code - god nodes, community detection, query/path/explain. Used for navigating Otto itself, not shipped in the product. Relevant here as an existence proof for graph-shaped recall if the memory charter outgrows flat files.                                                                                    |

---

## 4. Providers, protocols and tool surfaces

Everything in this group is about the fork thesis: frontier-model tooling for every provider, cloud
and local alike.

| Source                                                                                                                       | Status                                        | What it contributed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Model Context Protocol (MCP)**                                                                                             | **Implemented**                               | The daemon's own MCP server is how Otto's tools (preview, browser, artifacts, suggested tasks, widgets) reach every provider identically. Also the client side for the natively-tooled openai-compat provider. See [architecture.md](architecture.md), [providers.md](providers.md).                                                                                                                                                                                                                                                                                                 |
| **Claude Code's built-in `Claude_Preview` MCP server**                                                                       | **Read (reverse-engineered), re-implemented** | The founding proof of the fork. Reverse-engineered, then rebuilt for all providers. The durable design principles it taught - **token economy as a first-class design axis** (screenshots normalized to a ~1568px / ~1.15MP budget; pruned accessibility trees over DOM serialization; reader-mode page text; network summaries with bodies fetched on demand), **tool descriptions as agent steering** rather than API docs, and **descriptions steer / the daemon enforces** - are recorded in [preview.md](preview.md). The original blueprint document was retired once shipped. |
| **[Agent Client Protocol (ACP)](https://agentclientprotocol.com)**                                                           | **Implemented**                               | The integration path for third-party agents. Session modes: `providers.md`. Config: [custom-providers.md](custom-providers.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **[OpenAI Codex rate card](https://help.openai.com/en/articles/20001106)**                                                   | **Implemented**                               | The authoritative token-class rates for Codex GPT frontier models. The Codex provider prices its own exact fresh-input, cached-input and output split at this boundary, while neutral ledger code remains pricing-free.                                                                                                                                                                                                                                                                                                                                                              |
| **[gemini-cli](https://github.com/google-gemini/gemini-cli)**                                                                | **Dependency** (spawned)                      | ACP-mode reference implementation, and a supported custom provider. Its [acp-mode.md](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/acp-mode.md) is the working spec we validated against.                                                                                                                                                                                                                                                                                                                                                                          |
| **[hermes-agent](https://github.com/NousResearch/hermes-agent)** - Nous Research                                             | **Dependency** (spawned)                      | Another ACP-family agent, supported as a custom provider.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **[LM Studio](https://lmstudio.ai) · [Ollama](https://ollama.com)**                                                          | **Dependency** (external)                     | The local-model half of the fork thesis. LM Studio is also the backbone of the T2 test tier (§9) and the reference deployment for the openai-compat provider.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **[llama.cpp server API](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)**                         | **Dependency** (embedded runtime)             | The `/slots` contract for Otto Brain live inference telemetry. Its current response nests `n_decoded` under `next_token`, while older builds used top-level counters; host API v2 accepts both and bounds sampling independently of model token rate. The documented reasoning/content streaming fields define the live `thinking` to `generating` boundary.                                                                                                                                                                                                                         |
| **[Z.AI](https://z.ai) · [Alibaba Model Studio](https://www.alibabacloud.com/help/en/model-studio/claude-code-coding-plan)** | **Dependency** (external)                     | Anthropic-compatible coding-plan endpoints supported as custom providers; their docs are the source for base-URL and auth quirks in [custom-providers.md](custom-providers.md).                                                                                                                                                                                                                                                                                                                                                                                                      |
| **[DuckDuckGo](https://duckduckgo.com) instant-answer + HTML endpoints**                                                     | **Unevaluated**                               | Candidate default engine for `projects/web-search-providers` - a selectable web-search engine for the openai-compat provider, so a local model gets search without a paid key.                                                                                                                                                                                                                                                                                                                                                                                                       |

---

## 5. Rendering, markdown and UI

| Source                                                                                              | Status                                   | What it contributed                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`react-native-markdown-display` + `markdown-it`**                                                 | **Dependency**                           | The one markdown pipeline serving chat, the file viewer and the PR panel. `markdown-it` runs with `html: false` on purpose - see [markdown-rendering.md](markdown-rendering.md).                                                                                                                                                                                                                    |
| **[Mermaid](https://mermaid.js.org)**                                                               | **Dependency** (lazy + vendored webview) | Diagram fences on all four platforms. Web/Electron import it lazily (~3.4 MB); iOS/Android run the same render core in a self-contained webview payload. Was also the diagram layer of the (now retired) `archdocs/` site.                                                                                                                                                                          |
| **[react-native-unistyles](https://www.unistyl.es/)**                                               | **Dependency**                           | The styling system. Its docs and issue tracker are load-bearing: [#550](https://github.com/jpudysz/react-native-unistyles/issues/550), [#817](https://github.com/jpudysz/react-native-unistyles/issues/817), [#1030](https://github.com/jpudysz/react-native-unistyles/issues/1030) are the sources for the gotchas in [unistyles.md](unistyles.md) - above all that `useUnistyles()` is forbidden. |
| **[vscode-material-icon-theme](https://github.com/material-extensions/vscode-material-icon-theme)** | **Vendored** (generated)                 | The file-explorer icon set. Generation pipeline: [file-icons.md](file-icons.md).                                                                                                                                                                                                                                                                                                                    |
| **[material-symbols](https://github.com/marella/material-symbols)** - Google Material Symbols       | **Vendored** (generated SVG strings)     | The general UI icon set, committed as monochrome SVG strings via a codegen script. [ui-icons.md](ui-icons.md).                                                                                                                                                                                                                                                                                      |
| **AsciiDoc / Asciidoctor**                                                                          | **Unevaluated**                          | The format the `.adoc` preview renders (its fidelity corpus lives in `test-documents/archdocs-corpus/`). Otto's `.adoc` preview is a hand-written converter to markdown rather than an Asciidoctor dependency - rationale in the module header of `markdown/asciidoc/asciidoc-to-markdown.ts`, behaviour in [markdown-rendering.md](markdown-rendering.md).                                         |
| **HTML-in-markdown handling - no prior art adopted**                                                | **Rejected by design**                   | Worth recording as a deliberate non-adoption: Otto **translates** embedded HTML to markdown equivalents and unwraps everything else, rather than rendering a "safe subset" like every common sanitizer library does. Rationale in [markdown-rendering.md](markdown-rendering.md).                                                                                                                   |

---

## 6. Editor, code intelligence and build systems

| Source                                                                                | Status                        | What it contributed                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CodeMirror 6 + Lezer**                                                              | **Dependency**                | The editor and the syntax layer (~14 language families in `packages/highlight`). [text-editor.md](text-editor.md).                                                                                                                                                                                                                                                                                                                                                         |
| **ctags (the technique, not the binary)**                                             | **Implemented**               | The name-based code index - deliberately no type resolution, so multiple hits are a picker rather than a guess. Now the **designed fallback** beneath LSP, not a compat shim: it still honestly serves the outline and the fuzzy finder.                                                                                                                                                                                                                                   |
| **[Language Server Protocol](https://microsoft.github.io/language-server-protocol/)** | **Implemented** (client)      | The daemon's LSP client. Empirically probed rather than trusted: `typescript-language-server` 5.3 sends no `serverInfo`, and the spec **forbids** a server sending `$/progress` unless the client advertised `window.workDoneProgress` - both recorded in [code-intelligence.md](code-intelligence.md).                                                                                                                                                                    |
| **`typescript-language-server` · `pyright-langserver` · `csharp-ls`**                 | **Dependency** (spawned)      | The three acceptance-criteria servers. Resolution order and memory footprints drive the indexing-cost policy (lazy / opt-in / idle-exit). `csharp-ls` installs as a dotnet global tool - **user-consented, never automatic**.                                                                                                                                                                                                                                              |
| **[EditorConfig](https://editorconfig.org)** + the `editorconfig` npm package         | **Unevaluated**               | `projects/editor-repo-conventions` - honour the repo's own `.editorconfig` without configuring Otto. The npm package is the reference implementation; the open question is dependency vs. hand-rolled.                                                                                                                                                                                                                                                                     |
| **`Microsoft.VisualStudio.SolutionPersistence`** (NuGet) - Microsoft, MIT             | **Adopted** (planned sidecar) | Reads **and writes** `.sln` and `.slnx`, with solution folders, nesting, configurations/platforms and project type GUIDs. The decisive property: **it is the same parser the toolchain uses** - MSBuild, the .NET CLI and Visual Studio all read solutions through it - so Otto's tree cannot disagree with `dotnet build` about what is in the solution. Spike proven cross-platform (including the Windows path-separator quirk). `projects/solution-view/`.             |
| **`Buildalyzer` 9.0.0** (NuGet) - Dave Glick / phmonte, MIT                           | **Open decision**             | Per-project MSBuild evaluation without hand-rolling design-time builds: items with metadata, project/package references, multi-targeting, SDK resolution; 9.0 added `SolutionInfo`/`ProjectInfo` and SLNX support. Its value is absorbing MSBuild's sharp edges (SDK resolution, `global.json` pinning, multi-targeting, `Directory.Build.props`, which target to run). Weighed against `Microsoft.Build` + `Microsoft.Build.Locator` directly; the Phase 0 spike decides. |
| **Roslyn `MSBuildWorkspace`**                                                         | **Considered and rejected**   | Opens a solution and gives projects + documents through official code - but it models a _compilation_, not an _organisation_, and drops solution folders. Does not replace SolutionPersistence.                                                                                                                                                                                                                                                                            |
| **npm `.sln` parsers** - `vs-parse`, `visualstudiofiles`, `node-csproj-util`          | **Considered and rejected**   | None supports `.slnx`, none evaluates MSBuild, and all reimplement precisely the semantics we are trying not to get wrong.                                                                                                                                                                                                                                                                                                                                                 |
| **LSP for project structure**                                                         | **Considered and rejected**   | Recorded because it is the obvious first guess and it is wrong: **LSP gives no project structure at all.** That gap is the entire reason `projects/solution-view` needs a .NET sidecar.                                                                                                                                                                                                                                                                                    |

---

## 7. Protocol and performance

| Source                       | Status                                         | What it contributed                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[Zod](https://zod.dev)**   | **Dependency**                                 | The authoring source of truth for every protocol schema and the TypeScript types derived from them.                                                                                                                                                                                                                                                                                                                                                            |
| **zod-aot**                  | **Dependency** (exact-pinned, locally patched) | Ahead-of-time compiled inbound WebSocket validation, replacing runtime Zod on the hot path. Adopted for a measured mobile win: a 353 KB provider snapshot cost ~10.9 ms / 5.9 MB allocated on Hermes with `JSON.parse` + Zod, and ~2.5 ms / 1.2 MB through the generated validator. It is young enough that **compiler patches are treated as part of our package**, with regression tests per patched case. [protocol-validation.md](protocol-validation.md). |
| **Chrome DevTools Protocol** | **Implemented**                                | Underlies the browser-tools half of Preview - screenshots, clip-at-reduced-scale full-page capture, network and console capture - executed against a real tab in the Otto browser pane, never headless and never the system browser.                                                                                                                                                                                                                           |

---

## 8. Speech, dictation and audio

| Source                                                                                                                                     | Status                      | What it contributed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`sherpa-onnx` + Parakeet**                                                                                                               | **Dependency**              | The local STT engine. Its known weakness - largely unpunctuated, un-cased output - is the entire motivation for `projects/dictation-refine`.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **[Sherpa-ONNX KWS](https://k2-fsa.github.io/sherpa/onnx/kws/index.html)** and **[GigaSpeech](https://github.com/SpeechColab/GigaSpeech)** | **Adopted for wake word**   | Apache-2.0 native open-vocabulary keyword spotting and the Apache-2.0 training corpus used by the selected compact KWS model. Sherpa supports mobile deployment, runtime keyword files, and separate boosting-score / trigger-threshold controls, so inference remains local while sensitivity tunes both beam survival and acceptance. The release model is checked in as a five-file, checksum-pinned runtime subset so installers are deterministic and offline. See [wake-word.md](wake-word.md).                                                                                 |
| **[Picovoice Porcupine](https://picovoice.ai/docs/porcupine/)**                                                                            | **Considered and rejected** | Technically capable on Android and iOS, but requires a Picovoice access key and commercial terms. That adds account and licensing coupling to an otherwise local, provider-neutral feature.                                                                                                                                                                                                                                                                                                                                                                                           |
| **OpenAI Whisper**                                                                                                                         | **Dependency** (API)        | The cloud STT path. The "preserve punctuation and casing" transcription prompt only bites here, not for the local model.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Kokoro v1**                                                                                                                              | **Dependency**              | Local TTS for message playback and voice mode.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **[OpenWhispr](https://github.com/OpenWhispr/openwhispr)**                                                                                 | **Considered and rejected** | The user asked about embedding it. Rejected: it is a standalone Electron **end-user app**, not a library, so "including it" means shipping a second desktop app inside Otto; and its STT is the same `whisper.cpp` + `sherpa-onnx` Parakeet Otto already runs, so it would not improve transcription at all. **The one idea worth taking** - an optional LLM post-processing pass that punctuates and cleans the transcript - Otto is better positioned to do, because the daemon already has every provider wired up including the user's local LM Studio. Squarely the fork thesis. |

---

## 9. Computer use, testing and QA

| Source                                                           | Status                      | What it contributed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`@vitalops/opendesk-sdk`** v0.2.0 - MIT (evaluated 2026-07-13) | **Considered and rejected** | Source teardown: ~858 lines of tool glue over `@nut-tree-fork/nut-js` + `screenshot-desktop`; **no coordinate scaling** (delegates DPI math to the model, so it mis-clicks on scaled displays); accessibility tooling complete only on macOS; two releases, single maintainer. **Ideas adopted (MIT):** Set-of-Marks screenshot overlay, region/app allowlists, audit JSONL, and the dependency-pair validation for the spike. **Rejected:** its peering, scheduler, OCR and mega-tool schemas. Full record: `projects/computer-use/computer-control-library.md`. |
| **[Playwright](https://playwright.dev)**                         | **Dependency**              | The E2E harness across all three QA tiers, and the marketing-site demo capture pipeline ([site-demos.md](site-demos.md)).                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **[Maestro](https://maestro.mobile.dev)**                        | **Dependency**              | Mobile flow testing. [mobile-testing.md](mobile-testing.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **[Vitest](https://vitest.dev)**                                 | **Dependency**              | The unit/integration runner across all packages.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **LM Studio as a test dependency**                               | **Dependency** (external)   | The T2 "local-AI" tier: live agent-loop coverage with **zero API spend**. The insight worth keeping - for the openai-compat provider a local model _is_ the production code path, not a stand-in, so T2 proves the real daemon-owned tool loop (native tool injection, permission gating, compaction, rewind) that the mock tier structurally cannot. `projects/e2e-qa-coverage/local-ai-tier.md`.                                                                                                                                                                |

---

## 10. Distribution, release and outreach

Lower-stakes, but they are real sources and they go stale fastest - platform policies change without
notice. Detail lives in `projects/outreach/channels.md`; this is the pointer.

| Source                                                                                                                                                                                                                                                                                                                         | Status          | What it contributed                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[Caddy](https://caddyserver.com)**                                                                                                                                                                                                                                                                                           | **Dependency**  | The reference reverse proxy for the service proxy and for remote daemon access. [service-proxy.md](service-proxy.md), [fork-release-guide.md](fork-release-guide.md). |
| **[winget-releaser](https://github.com/vedantmgoyal9/winget-releaser) · [Flathub submission docs](https://docs.flathub.org/docs/for-app-authors/submission) · Obtainium · Umbrel · CasaOS · Unraid CA**                                                                                                                        | **Read**        | Packaging and store-submission requirements per distribution channel.                                                                                                 |
| **HN, Reddit, Lobsters, dev.to, Bluesky, X, Mastodon, Product Hunt guidelines**                                                                                                                                                                                                                                                | **Read**        | The posting rules each channel enforces, gathered so outreach is compliant by construction rather than by apology. `projects/outreach/channels.md`.                   |
| **Awesome-lists** - [awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code), [awesome-ai-devtools](https://github.com/jamesmurdza/awesome-ai-devtools), [awesome-cli-coding-agents](https://github.com/bradAGI/awesome-cli-coding-agents), [awesome-local-llm](https://github.com/rafska/awesome-local-llm) | **Read**        | Listing targets, and incidentally the best available census of the competitive field in §2.3.                                                                         |
| **[F5Bot](https://f5bot.com) · [Syften](https://syften.com) · [HN Algolia API](https://hn.algolia.com/api) · [Bluesky Jetstream](https://docs.bsky.app/blog/jetstream)**                                                                                                                                                       | **Unevaluated** | Candidate mention-monitoring inputs for the outreach draft-queue pipeline.                                                                                            |

---

## 11. Sources that changed a decision

The short list worth re-reading first, because in each case reading the source changed what got
built rather than confirming it.

1. **Rivet's named typed ports** - forced generalizing the port model **before** any control-flow
   node was built. Bolting branches onto a single-port canvas would have cost both the schema and
   the wire format.
2. **LangGraph's positional interrupt matching** - a documented failure mode (editing a graph between
   suspend and resume mis-binds the payload) that made Otto key gates by node id from day one.
3. **The Claude Preview MCP teardown** - established token economy as a first-class design axis, not
   an optimization pass. Every browser tool's shape follows from it.
4. **zod-aot's measured numbers** - a 4× latency and 5× allocation win is why a young, exact-pinned,
   locally-patched dependency was acceptable at all.
5. **`typescript-language-server`'s silence on `serverInfo` and `$/progress`** - empirical probing beat
   reading the spec, and is now the standing method for LSP work.
6. **OpenWhispr's teardown** - the request was "embed this"; the answer was "the only good idea in it
   is one we're better placed to build ourselves". The generalizable lesson: evaluate the mechanism,
   not the packaging.
7. **The orchestration competitive survey's negative result** - no one occupies the combination, and
   the parallel-runner niche is commoditized and churning. That reframed the differentiator from
   "the canvas" to "deterministic daemon-side execution".
8. **AgentX-Python's trace/score/pattern triad** - read for architecture, kept for evaluation. It
   promoted per-node accounting from "nice observability, later" to **a precondition**: two graph
   templates cannot be compared without cost, latency and token counts per node, so the question
   "does orchestration actually work" is unanswerable until that record exists. It also exposed
   that Otto grades with exactly one mechanism (an LLM judger) where three are warranted.

---

## 12. Reading list for the agentic-coding-templates initiative

The planned initiative - **reusable coding pattern templates built on the orchestration system**
(`projects/agent-orchestration/agent-orchestration.md`, plus the built graph engine)

- has its inputs scattered across the sections above. This is the ordered path through them.

**First, the constraint that shapes everything.** Otto never calls a model. A "pattern template" is a
graph of _agent seats_ - each with an identity, a repo, a worktree and an authority - that the daemon
executes deterministically. Every catalog in §2.1 describes patterns as in-process model-call graphs.
Translate, never transplant. `orchestration-design.md` Part 6 is the worked example of doing that
translation well.

**Then, in order:**

1. **`orchestration-design.md` Parts 6–9** (internal) - the concepts already translated, the parts
   list, and the seven things bespoke engines get wrong. Start here so the catalogs are read against
   a design, not in a vacuum.
2. **`agent-orchestration.md` "Prior art we're reviving"** (internal, §2.4) - `/epic`'s phase-type
   vocabulary decoupled from the role cast. This is the template abstraction Otto already chose;
   check every catalog pattern against it.
3. **all-agentic-architectures → Plan-Execute-Verify, Chain-of-Verification, Meta-Controller,
   Blackboard, SWE-Agent** (§2.1). The five that map onto graph node types Otto can already express.
   Each is a candidate first template.
4. **all-agentic-architectures → Agent Workflow Memory and Voyager** (§2.1, §3). The two that close
   the loop between §2 and §3: how a completed run becomes a reusable skill. If the initiative is to
   be more than a template gallery, this is where the mechanism comes from.
5. **Agentic Design Patterns Ch. 11, 12, 13, 16, 19, 20** (§2.1) - goal setting and monitoring,
   exception handling and recovery, human-in-the-loop, resource-aware optimization, evaluation, and
   prioritization. The operational half: what a template must declare beyond its shape.
6. **COG's memory-hygiene and tier-promotion mechanisms** (§2.1, §3) - how accrued knowledge stays
   trustworthy. A template library that accumulates without verification decays into noise.
7. **Rivet's palette and Dify's `BlockEnum` taxonomy** (§2.2) - the two best existing vocabularies for
   naming node types. Otto's palette should be legible to anyone who has seen either.
8. **AGX and Activepieces** (§2.2, §2.3) - durable checkpointed execution across restarts. A template
   that cannot survive a daemon restart is a demo.
9. **AgentX-Python's evaluation layer** (§2.1) - the trace unit, the three scoring mechanisms, and
   patterns as trace-level regression detection. Read last, because it is the part that tells you
   whether everything above actually worked. A template library with no harness is a gallery.

**What to deliberately skip:** every RAG entry, every training-pipeline entry, every in-process
framework (LangChain, CrewAI, AutoGen, Mastra, VoltAgent), and every benchmark number in this file.
None of them measure the thing the initiative is trying to be good at.
