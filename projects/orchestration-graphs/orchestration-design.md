# What an orchestration actually is — design evaluation

**Status:** design analysis, 2026-07-21. Companion to [orchestration-graphs.md](orchestration-graphs.md), which describes what is BUILT. This one describes what is MISSING and why.

---

## Part 1 — Audit: what the graph can express today

A node is exactly this (`GraphNodeSchema`):

| Field             | Meaning                                                                            |
| ----------------- | ---------------------------------------------------------------------------------- |
| `kind`            | `orchestrator` (the single root) or `agent`                                        |
| `role`            | one of 7 team roles: researcher, planner, coder, designer, writer, judger, advisor |
| `prompt`          | fixed text, may reference `{{inputs.key}}`                                         |
| `promptFromInput` | one declared input's value, appended                                               |
| `autonomous`      | binary: may spawn its own agents, or may not                                       |
| `loop`            | `times: N`, or `until { criteria[], judgeRole, max }`                              |
| `model`           | provider/model override                                                            |

An edge is `{ from, to }`. Nothing else. No condition, no label, no type.

**Execution.** The daemon builds a DAG, holds an all-inputs barrier per node, spawns one fresh agent per node (same `cwd`, same workspace as the orchestrator), waits for its whole subtree to settle, takes its **last assistant message** as the node's output, and concatenates upstream outputs into the next node's prompt as `Input from "<title>":\n<text>`. Caps: 6 concurrent agents, 40 total. Terminal nodes' outputs become the wrap-up handed to the orchestrator.

### The five structural limits this implies

1. **The data plane is prose.** A node's output is whatever the agent happened to say last. It is untyped, unbounded, un-addressable, and it is _narration_ — "I've implemented the parser and added tests" — not the artifact. Everything downstream re-reads a summary of work instead of the work.
2. **Control flow is a plain DAG.** There is no condition on an edge, so a graph cannot branch on what it found. Every path always runs. "If the research says X, do A, else do B" is inexpressible.
3. **There is no state.** Nodes cannot accumulate into a shared document, cannot read a variable set upstream, cannot count, cannot carry a list. The only channel is the direct edge.
4. **Fan-out is static.** You draw three researchers, you get three researchers. You cannot say "one researcher per file the previous node listed" — the shape of the graph cannot depend on runtime data.
5. **The human is not in the graph.** The AI flavor already has a `gate` phase type and `runs.gate_respond.request` on the wire; the graph engine has no gate node. So a user-authored orchestration — the flavor whose entire premise is _human logic layered onto agent work_ — is the one that cannot ask the human anything.

### What is already right (don't rebuild it)

- Daemon-held barriers; agents never know they are waiting.
- Per-node tool policy enforced at spawn, not by prompt.
- Roles resolving through team → personality → model, snapshotted at execute.
- Loop-until-judge with a structured verdict, hard-capped.
- Every node is an ordinary Otto agent, so ledger/parentage/monitoring came free.
- The phases engine already has best-of-N candidates + judge, and human gates. The graph engine simply doesn't reach them.

---

## Part 2 — What an orchestration IS

An orchestration is **a decision the user makes once, in advance, that the model would otherwise have to make repeatedly and invisibly at runtime.**

That is the whole value proposition, and it is worth being precise about it, because "multiple agents" is not the value — multiple agents is the cost. Anthropic's own measurements: an agent uses roughly 4× the tokens of a chat turn, a multi-agent system roughly 15×. You do not pay 15× for parallelism. You pay it for **structure that survives**.

There are exactly five things a user can fix in advance that a single agent cannot reliably hold on its own:

1. **Decomposition** — which subproblems exist, and their boundaries. A single agent re-derives this every run, differently each time. Anthropic's own failure example: an under-specified "research the semiconductor shortage" produced one subagent researching the 2021 auto-chip crisis and two duplicating each other on 2025 supply chains.
2. **Isolation** — which work gets a _clean context_. A subagent may burn tens of thousands of tokens exploring and return a 1,000–2,000 token distillation. The parent never sees the mess. Drawing a node is how a user says "this exploration must not pollute the main thread."
3. **Sequencing and dependency** — what must be true before the next thing starts. A single agent will happily start implementing before it has finished understanding, because nothing stops it.
4. **Verification** — what "done" means, checked by something that is not the author. This is the single highest-value thing in agentic work: the agent stops when the work _looks_ done, so without a runnable check the human is the loop. A graph makes the loop a structural property instead of a habit.
5. **Authority** — where a human must say yes, and what each participant is allowed to touch. This is the part no framework gives you for free and the part Otto is best positioned to own, because it already has per-agent tool policy and permission modes.

Everything else — parallelism, speed, "many agents" — is downstream of those five.

### The honest capability inventory

What a node's agent can _actually_ do today, in this codebase, with no new work:

- Read and write files in the workspace, run shell commands, run tests, use git.
- Search the web, fetch pages (`web` tool group).
- Drive a real browser and dev server (`preview`, `browser` groups) — currently stripped from deterministic nodes.
- Create artifacts (`create_artifact`, addressable by id and projectId), terminals, schedules, worktrees.
- Spawn its own sub-agents — but only if the user ticked `autonomous`.
- Be a personality with a role, a model, and an effort level.

What it cannot do:

- Return anything except a final chat message.
- Read another node's output unless an edge was drawn at design time.
- Know how many siblings it has, or coordinate with them.
- Decide that a downstream node should or shouldn't run.
- Ask the user a question.

So the ceiling today is: **a fixed pipeline of independent agents passing prose summaries, in one shared directory.** That is genuinely useful for research and writing. It is not yet enough for "directed research projects, researched implementations, full feature breakouts with control and stages and logic" — the thing you actually want.

### The four real use cases (and the honest test for each)

The test for whether an orchestration earns its 15× is: **would a single agent get this wrong in a way the structure prevents?**

| Use case                      | Shape                                                                                                                                 | What the structure prevents                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Directed research**         | Fan-out to N researchers on _declared, disjoint_ angles → synthesis → verification against sources                                    | Duplicated angles, one-source tunnel vision, an agent that stops early because it found _an_ answer              |
| **Researched implementation** | Research (read-only, parallel) → plan → **human gate** → implement → test → review-by-a-different-agent → loop until the judge passes | Implementing before understanding; the author reviewing their own work; "done" declared without a runnable check |
| **Feature breakout**          | One planner emits a _list_ of units → dynamic fan-out, one implementer per unit, each isolated → integration → verification           | A single agent flattening a 12-file feature into one context and losing the last third                           |
| **Adversarial evaluation**    | Same task run N ways in parallel → judge panel → keep-best                                                                            | Single-sample luck; the model's first idea winning by default                                                    |

Note what all four have in common: **read-heavy work parallelises safely; write-heavy work does not.** Anthropic is explicit that coding tasks contain far fewer truly parallelisable subtasks than research, and that agents are not yet good at coordinating writes in real time. Otto currently runs every node in the _same_ `cwd` — so parallel implementer nodes will collide today. That is a correctness hole, not a polish item.

---

## Part 3 — The failure mode we must design against

The strongest argument _against_ what we are building is Cognition's "Don't Build Multi-Agents", and it deserves a straight answer rather than a dismissal. Its two principles:

> Share context, and share full agent traces, not just individual messages.
> Actions carry implicit decisions, and conflicting decisions carry bad results.

Their example: split "build a Flappy Bird clone" into two subagents; one produces a Super Mario–style background, the other a bird that matches neither that aesthetic nor the intended mechanics. Neither subagent did anything wrong against its own brief. **The brief did not contain the decisions that mattered**, and the subagents could not see each other's.

The Berkeley MAST taxonomy (1,600+ annotated traces across 7 frameworks, κ=0.88) says the same thing from the data side: of its three failure categories, one entire category is _inter-agent misalignment_ — information withholding, ignoring another agent's input, task derailment, failure to ask for clarification — and a third is _verification and termination_ — premature termination, no or incomplete verification, incorrect verification. Its headline finding is that these are **system-design failures, not model-capability failures**. Their own fix attempts are sobering: better prompts bought +5.0 points on one benchmark, a better topology only +0.75, and the authors still concluded more comprehensive solutions are required.

Read together with Anthropic's numbers (multi-agent ≈15× chat tokens; token volume alone explains ~80% of performance variance on BrowseComp), the honest position is:

**A lot of what multi-agent systems "win" is just buying more compute, and most of what they lose is implicit decisions that were never written down.**

That gives this project its actual design mandate, and it is a good one:

1. **Make the implicit decisions explicit and shared.** The user drawing a graph is _already_ doing this — it is why user orchestration is a better bet than AI orchestration. But the graph must carry those decisions in a form agents actually read: a written brief and written artifacts, not a prose relay.
2. **Never parallelise decisions — only parallelise gathering.** Fan out for research; converge to a single thread for anything where the parts must cohere.
3. **Verification is not optional decoration.** A third of the documented failure taxonomy is verification failure, and the highest-leverage practical pattern in every source is the same: an agent stops when work _looks_ done, so something that is not the author must check, ideally by running something.

---

## Part 4 — The gap list

Ordered by how much each one blocks the stated goal ("directed research projects, researched implementations, full feature breakouts with control and stages and logic").

### Gap 1 — Outputs are prose. They must be artifacts. _(blocking everything)_

Today, node → node passes the last chat message. That is a summary of the work, and it re-summarizes at every hop — exactly the lossy relay Anthropic avoids by having subagents **write outputs to external storage and pass lightweight references**.

The fix is a node output contract:

```
NodeOutput {
  summary: string            // for the chat + Visualizer (bounded)
  artifacts: ArtifactRef[]   // files written / Otto artifacts created (addressable)
  fields?: Record<string,…>  // optional, when the node declares an output schema
  evidence?: { command, exitCode, output }   // for check/verify nodes
}
```

Downstream nodes receive the summary inline plus _references_, and read the artifact themselves. This single change is what turns "research → plan → implement" from three agents chatting into a real pipeline over `spec.md` → `plan.md` → a diff. It is also what makes Spec-Kit / Kiro-style flows expressible at all: their entire value is that the _artifact_ is the unit of work, human-editable between stages.

### Gap 2 — No deterministic check node _(blocking "real answers")_

Every source converges on this: the loop must close on ground truth. A node that runs a command and yields `{exitCode, output}` — `npm test`, `lint`, a build, a script — is cheap to build (Otto already owns terminals), needs no model, and is the difference between an orchestration that _claims_ success and one that _demonstrates_ it. It also gives loops a real exit test that isn't another opinion.

### Gap 3 — No human gate _(blocking "human logic layered onto AI work")_

The premise of user orchestration is human control, and the human currently cannot intervene once it starts. The machinery already exists for the AI flavor: `gate` phase type, `awaitGate`/`resolveGate` in RunService, `runs.gate_respond.request` on the wire. A Gate node needs: approve / reject / **edit the artifact and continue** / a free-text note that becomes downstream context. The edit case is the important one — it is where the user's judgement actually enters the work.

### Gap 4 — No conditional routing _(blocking "logic")_

Edges are unconditional. A user cannot express "if the research says this is a schema change, take the migration path." Minimum viable: an optional `when` on an edge, evaluated against the upstream node's declared output fields, plus a **Router node** that classifies in natural language when a predicate won't do. Every surveyed system has this; it is table stakes.

### Gap 5 — No dynamic fan-out _(blocking "feature breakouts")_

You cannot say "one implementer per task in the plan." The graph's shape is fixed at design time. A **Map node** — take an upstream list (structured field or a task file), run its subgraph once per item, bounded by a hard cap and a budget — is the single most valuable primitive we could add, and the one most visual builders _don't_ have (they offer fixed iteration; LangGraph's `Send` is the real version). Feature breakout is precisely this shape.

### Gap 6 — Every node shares one working directory _(correctness hole)_

Parallel write nodes collide today. Otto already creates worktrees (`createOttoWorktree`, used by suggested tasks). A per-node **isolation** setting — `shared` (default) / `own worktree` — plus a read-only marker on gather nodes makes the safe/dangerous distinction _visible on the canvas_, which is where it belongs. Worth stating in the UI: worktrees fix file collisions, not conflicting assumptions; the second half is fixed by not parallelising decisions.

### Gap 7 — Tool policy is a binary _(under-using what we already have)_

`autonomous: true|false` collapses eight existing tool groups (preview, browser, web, agents, terminals, schedules, artifacts, workspace) into one switch. A per-node allowlist over groups the daemon already understands costs almost nothing and directly serves the safety story: a research node gets `web` and nothing else; an implementer gets `workspace` + `terminals`; a verifier gets `preview` + `browser` so it can _look at the result_. Note that preview/browser are currently stripped from all deterministic nodes — that was the right conservative default, but a verify node that can't open the page is a verify node that can only read code.

### Gap 8 — No shared brief _(the Flappy Bird hole)_

Nothing in the graph carries the decisions every node must share. A **Brief node** (static text + optionally pinned artifacts, injected into every downstream node's prompt) is a five-line feature that directly addresses the single best-documented multi-agent failure. It is the graph-level equivalent of Spec-Kit's `constitution.md`.

### Gap 9 — No budget, no failure policy, no resume

Caps are hardcoded (6 concurrent, 40 agents) and invisible. There is no cost ceiling, no per-node retry, no "continue on failure", and a daemon restart kills a run outright. At 15× token cost, a visible budget with a hard stop is not a nice-to-have. Failure policy per node (`fail the run` / `continue` / `retry N`) is table stakes everywhere.

### Gap 10 — Per-node observability

Nodes report a status and a summary. There is no per-node record of what it was given, what it produced, what it cost, or what it touched. Every visual builder ships this, and it is what makes a graph _tunable_ rather than a slot machine.

---

## Part 5 — What to build, in order

**Stage 1 — Make it real (a graph can now do something a chat can't).**
Artifact outputs (Gap 1) · Check node (Gap 2) · Gate node (Gap 3) · Brief node (Gap 8) · per-node tool groups + read-only marker (Gap 7) · worktree isolation flag (Gap 6).
After Stage 1, "researched implementation" is fully expressible: brief → research (read-only, parallel) → plan artifact → **human gate** → implement (own worktree) → check (`npm test`) → review by a different role → loop until check passes.

**Stage 2 — Make it powerful (the graph reacts to what it finds).**
Conditional edges + Router node (Gap 4) · Map node (Gap 5) · explicit Merge node with a policy (concat / synthesize / keep-best) · Subgraph node for reuse.
After Stage 2, "feature breakout" is expressible: plan emits a task list → Map spawns one implementer per task in its own worktree → each checks itself → integration node merges → verification.

**Stage 3 — Make it trustworthy.**
Run budget (agents / tokens / cost / wall clock) with a hard stop · per-node failure policy + retry · checkpoint + resume across daemon restart · per-node run log with inputs, outputs, cost, and files touched.

**Deliberately not doing:** reducers with merge semantics, time-travel/fork from a checkpoint, deterministic replay with compensation. These are real primitives in LangGraph/Temporal and they solve problems we do not have at this scale.

### The five questions the authoring UX should ask

The dialog currently asks name, description, project, seat, prompt. Those are bookkeeping. The questions that make an orchestration _good_ are:

1. **What is the deliverable?** A document, a diff, a decision, a dataset. (Determines the terminal node's artifact type.)
2. **How will we know it is right?** A command that must exit zero, criteria a judge grades, or a human's eye. (Determines the check/verify/gate node — and if there is no answer, the orchestration is probably not worth running.)
3. **What has to be decided before work starts?** (Determines gate placement and what goes in the Brief.)
4. **What is genuinely independent?** (Determines what may fan out — and the honest default is "only the reading".)
5. **What is the ceiling?** Agents, cost, time. (Determines the budget.)

A graph that answers those five is worth its 15×. One that doesn't is a slower, more expensive chat.

---

## Part 6 — Mirroring LangGraph's concepts without becoming LangGraph

The decision (Philippe, 2026-07-21): **learn the concepts, write them ourselves, in our vocabulary** — the same treatment the Visualizer got. LangGraph has done the deep thinking about what a durable agent graph runtime must handle; we should not rediscover it by hitting each wall in turn. But it is a developer library whose node is a function you write, and ours is an _agent seat_ with an identity, a repo, and an authority. So each concept gets translated, and some get dropped.

The test for every borrowed concept: **does this exist because agents need it, or because graphs need it?**

| LangGraph concept                            | What it solves                                                | Otto translation                                                                                                                                                                                        | Verdict                                                                    |
| -------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Checkpoint after every step**              | Crash resume without re-running expensive steps               | We already do this by accident: `persistAndEmit` writes a full Run snapshot on every state change, and node outputs land in `phase.candidates[].summary`. What's missing is the read-back path.         | **Take it.** Cheapest high-value item we have.                             |
| **Interrupt / resume**                       | Pause mid-graph, surface a payload, resume with a human value | Our Gate node; the machinery (`awaitGate`/`resolveGate`/`runs.gate_respond`) already exists for the phases engine                                                                                       | **Take it**                                                                |
| **Conditional edges + router**               | Branch on what was found at runtime                           | `when` on an edge + a Router node that classifies                                                                                                                                                       | **Take it**                                                                |
| **Send (dynamic fan-out)**                   | Runtime-sized parallelism over a list                         | Map node: one agent per item of an upstream list, each in its own worktree                                                                                                                              | **Take it** — this is the feature-breakout primitive                       |
| **Subgraphs**                                | Composition, reuse, canvas sanity                             | A Graph node that calls another saved graph                                                                                                                                                             | **Take it**, later                                                         |
| **Retry policy per node + recursion limit**  | Flaky steps don't kill runs; runaways don't drain wallets     | Per-node failure policy + a run-level budget in agents/tokens/cost/time                                                                                                                                 | **Take it**, ours should be run-level first (cost is the real risk at 15×) |
| **Deferred nodes**                           | Ragged parallel branches join correctly                       | Our all-inputs barrier already does this                                                                                                                                                                | **Have it**                                                                |
| **Multi-mode streaming**                     | Watch state, updates, tokens, custom progress separately      | We have the event bus + Visualizer; needs per-node input/output/cost records                                                                                                                            | **Adapt**                                                                  |
| **Shared typed state + reducers**            | Concurrent writes to one key merge predictably                | We don't have concurrent writers to a shared store, and adding one invites the exact race reducers exist to solve. Artifacts (files) are our state, and the filesystem already has ownership semantics. | **Skip**                                                                   |
| **Command (update + goto)**                  | A node picks its own successor                                | This is the model taking control back from the user — the opposite of what user orchestration is for                                                                                                    | **Skip**                                                                   |
| **Time travel / fork from checkpoint**       | Replay a decision differently                                 | Real value, but our rewind already exists per-agent, and the cost is a versioned checkpoint store                                                                                                       | **Defer**                                                                  |
| **Deterministic replay + saga compensation** | Exactly-once side effects across restarts                     | Requires all nondeterminism behind activity boundaries. Our side effects are "an agent edited your repo" — git is the compensation mechanism, not us.                                                   | **Skip**                                                                   |

Two things worth stating plainly, because they are the ones bespoke engines get wrong:

1. **Resume must be idempotent.** If a run resumes by re-running a node whose agent already edited the repo, we have made the crash worse than the outage. Seeding the engine's memoized results from the persisted Run — completed nodes return their recorded output instead of re-spawning — is the whole fix, and it's roughly twenty lines given what's already persisted.
2. **Budget belongs to the run, not the node.** Nested per-node retries compound: three nodes with three attempts each is nine agents, and each agent is ~4× a chat. A global ceiling that hard-stops is the only thing that makes retry safe to offer.

### Adopt or mirror? (surveyed 2026-07-21)

Every embeddable TypeScript runtime splits into two groups, and neither fits:

- **Needs its own process and calls into your code** — Inngest, Temporal, Restate, Motia, Trigger.dev. These invert control by construction: they own the loop. Otto's daemon already owns process lifecycle, cancellation, and persistence, so this class is ruled out on architecture, before licensing (Motia's engine is Elastic License 2.0; Inngest's server is SSPL).
- **Embeds as a library but brings an agent framework** — LangGraph.js (MIT), Mastra (Apache-2.0), VoltAgent (MIT). All embed fine, but their value is the LLM plumbing we don't need — our nodes are external CLI processes, not in-process model calls. We would inherit their state model and release cadence to delete maybe 200 lines.

The one genuine candidate is **XState v5** (MIT, in-process, no infra, `getPersistedSnapshot()`/restore, actor supervision that maps onto child processes). Rejected anyway, for consistency: the daemon already hand-rolls its lifecycle state machine in a ~6,000-line `AgentManager` with no XState anywhere, and introducing a state-machine library for one subsystem buys a second idiom rather than removing one.

**Decision: mirror.** Write the hard-won concepts into our own engine, in our vocabulary, and steal the ecosystem's _names_ so the design stays legible to anyone who has seen LangGraph.

### The reference implementation to read: Rivet

LangGraph is the science; **[Rivet](https://github.com/Ironclad/rivet) (MIT, Ironclad) is the closest thing to a working model of our exact architecture**, and it is the one project in this survey that is both agent-shaped and legally borrowable.

- **MIT, no rider** — vendorable, unlike most of this field.
- 100% TypeScript, and `@ironclad/rivet-core` is an **isomorphic executor decoupled from any database** — the same split we have between engine and store.
- **`startDebuggerServer()` / `RivetDebuggerServer`**: a WebSocket protocol that lets the desktop IDE attach to a processor running elsewhere. That is structurally identical to Otto's daemon↔app split, arrived at independently.
- Its graph model is ~20 lines: `{ nodes: ChartNode[], connections: NodeConnection[] }` where a connection is `{ outputNodeId, outputId, inputNodeId, inputId }` — note the **named ports** ours lacks.
- Its palette is the right vocabulary for agent graphs: Chat, Assemble Prompt, Subgraph, User Input, External Call, Raise/Wait For Event, MCP Discovery/Tool Call, Coalesce, Loop Controller, Abort Graph.
- Typed ports (`string`, `chat-message`, `object`, `image`, `vector`, `T[]`, `fn<T>`) with a **`control-flow-excluded` poison value** that propagates through untaken branches — its answer to "what happens downstream of a branch not taken", with a whitelist of nodes that absorb it (`if`, `ifElse`, `coalesce`, `graphOutput`, `raceInputs`, `loopController`). Fan-in is then an explicit `Coalesce` (first non-excluded wins).

**What Rivet does NOT have, and we do:** any notion of who the agent is (no personality, team, role), any environment (no repo, worktree, or permission model), and — critically — **no durable persistence at all**: its `pause()`/`resume()`/`userInput()` are in-process promises, so if the host dies the run dies. So Rivet is the right thing to read, and the wrong thing to depend on.

### Steal these specific pieces (all license-clean)

| From                                                                  | License                                   | What to lift                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Rivet**                                                             | MIT                                       | The executor/canvas split, named typed ports, the excluded-branch poison value + Coalesce fan-in, the palette vocabulary                                                                                                                                              |
| **[Activepieces](https://github.com/activepieces/activepieces)** core | MIT (`packages/ee/**` carved out)         | The **pause/resume model, near-verbatim** — `PAUSED` status plus a discriminated `PauseMetadata` persisted on the run row, and a boot-time worker that rehydrates paused runs. This is our gate + restart-resume gap in about sixty readable lines.                   |
| **[Windmill](https://github.com/windmill-labs/windmill)**             | engine AGPL, **OpenFlow spec Apache-2.0** | The spec only: suspend declared as `{ required_events, timeout, resume_form, user_auth_required }`, and flow state as a blob on the job row so a suspended run is simply a row nothing picks up                                                                       |
| **[Sim](https://github.com/simstudioai/sim)**                         | Apache-2.0                                | Two schema ideas: **conditions live on the edge** (`condition: { type: 'if' \| 'else if' \| 'else', expression }`), and **loops/parallels are first-class keyed containers rather than cyclic edges** — worth weighing against our current per-node `loop` annotation |
| **[Dify](https://github.com/langgenius/dify)**                        | source-available — **ideas only**         | Its `BlockEnum` is the best palette _taxonomy_: control flow (`if-else`, `iteration`, `loop`, `variable-aggregator`) separated from capability (`llm`, `agent`, `tool`, `code`, `http-request`) separated from lifecycle (`start`, `end`, `human-input`)              |
| **[Kestra](https://github.com/kestra-io/kestra)**                     | Apache-2.0                                | `Pause` with an `onResume:` block declaring **typed inputs that render as a form** — the shape our Gate node's "ask the human something" should take                                                                                                                  |

**Do not borrow code from:** n8n (Sustainable Use License — commercial use of the software is prohibited outright; don't read it with intent to borrow), Dify (modified Apache: no multi-tenant operation, logo clauses), ComfyUI (GPL-3.0, no linking exception — the typed-socket _idea_ is free, the code is not), Motia/iii (Elastic License 2.0). Flowise is Apache-2.0 but its commercial carve-out is **per-file by copyright header**, not by directory, so it can't be audited mechanically.

**Canvas note:** Drawflow has been dormant since Sep 2024 (272 open issues) and has no engine. That matters less than it sounds — we vendored it frozen on purpose and own the wrapper — but if it ever needs replacing, **[Rete.js](https://github.com/retejs/rete)** is the only library here with a genuinely headless, framework-free, separately-installable Node engine (`rete-engine`, MIT). React Flow (MIT, 37.7k★) is the safe canvas-only alternative; its "Pro" tier sells examples and support, not code.

### The seven things bespoke engines get wrong (copy these deliberately)

1. **Checkpoint before advancing** — the write must land before the next node starts, and must include the pending frontier, not just completed outputs. We are most of the way here: `persistAndEmit` already snapshots the whole Run on every change.
2. **Idempotent re-execution on resume** — memoize by a stable `(runId, nodeId)` key so a resumed run returns recorded output instead of re-spawning an agent that already edited the repo. Not choosing a memoization strategy _is_ the bug.
3. **String-keyed interrupts, never positional** — LangGraph matches resume values by index within a node, so editing the graph between suspend and resume mis-binds the payload. Ours should key gates by node id from day one.
4. **Two separate counters** — per-node retry and a run-wide step/cost budget. Nested retries compound.
5. **Deferred fan-in** — a join must not fire until every path that could still reach it has settled, _including_ paths pruned by a branch. Naive engines fire on first arrival or deadlock on a pruned branch. This becomes real the moment conditional edges land.
6. **Declared merge semantics for concurrent writes** — LangGraph's reducers. Our answer is different and simpler: artifacts are files, and the filesystem already has ownership. Worth stating explicitly rather than discovering later.
7. **Leases with a visibility timeout** — a node whose executor died must become reclaimable rather than sit "running" forever. Today a daemon restart marks every in-flight run failed (`RunService.init`), while the child agents may still exist — so the work is orphaned, not cleaned up.

---

## Part 7 — Does this already exist? (open-source survey, 2026-07-21)

Question asked: is anyone shipping a **user-authored visual graph that a daemon deterministically executes over real coding-agent CLIs, with human gates and verification, monitored remotely**? Answer: **no**, and the field splits into three groups that each have one third of it.

**(a) Parallel runners.** Worktree or tmux fan-out with a kanban/TUI, no flow semantics: [vibe-kanban](https://github.com/BloopAI/vibe-kanban) (27.5k, Apache-2.0, **sunsetting**), [claude-squad](https://github.com/smtg-ai/claude-squad) (8.2k, AGPL-3.0), [CCManager](https://github.com/kbwo/ccmanager), [uzi](https://github.com/devflowinc/uzi) (stale), [Crystal](https://github.com/stravu/crystal) (deprecated → [Nimbalyst](https://github.com/nimbalyst/nimbalyst)), [container-use](https://github.com/dagger/container-use) (stale). They run many agents; they don't compose them.

**(b) Visual editors that never execute.** [claude-code-cli-ui](https://github.com/Ngxba/claude-code-cli-ui) has a pipeline builder that authors config, not runs.

**(c) AI-planned swarms.** The model picks the topology: [ruflo/claude-flow](https://github.com/ruvnet/ruflo) (65.4k, MIT — but heavily overclaimed; its "100+ agents" are prompt templates plus MCP tools inside Claude Code, and its LangGraph/AutoGen speed claims sit on an unmerged branch), Roo/Kilo orchestrator modes, [Agent-MCP](https://github.com/rinadelph/Agent-MCP). This is the AI flavor, not the user flavor.

The five closest, and exactly where each stops:

1. **[claude-workflow-composer](https://github.com/fayzan123/claude-workflow-composer)** (33 ★, MIT) — the only project with a real canvas where the user drags agent nodes _and dedicated approval-gate nodes_. But it does not execute the graph: it flattens it into a natural-language orchestrator skill that Claude Code then interprets. Non-deterministic by construction — the exact thing our daemon-held barriers exist to avoid. Claude-only, no loops, no mobile.
2. **[awslabs/cli-agent-orchestrator](https://github.com/awslabs/cli-agent-orchestrator)** (Apache-2.0) — strongest execution story: nine real CLIs in tmux, MCP handoff primitives, declarative YAML flows with conditional gating scripts and cron. No visual editor, no first-class human-approval node (HITL means "attach to tmux and type"), no mobile.
3. **[Nimbalyst](https://github.com/nimbalyst/nimbalyst)** (MIT) — the only OSS project with both a canvas and iOS/Android companions. But its canvas is a spatial knowledge workspace (specs, diffs, mockups as nodes); the edges document relationships, nothing traverses them.
4. **[AGX](https://github.com/ramarlina/agx)** — explicit approve/reject before irreversible steps and durable checkpointed execution across restarts (worth studying for our resume gap). The flow is a fixed built-in lifecycle, not user-authored.
5. **[OpenHands](https://github.com/All-Hands-AI/OpenHands)** (81.5k) — best-resourced, real sandboxes, ACP to third-party CLIs, an "Agent Canvas" that is a conversation control center rather than a DAG authoring surface. Has the resources to add graph authoring on top of ACP at any time; the main competitive risk.

Ruled out as not-what-they-sound-like: [SWE-agent](https://github.com/SWE-agent/SWE-agent) (single-agent YAML loop), [Task Master](https://github.com/eyaltoledano/claude-task-master) (PRD parser over MCP; MIT + Commons Clause, not OSI open source), Conductor (closed-source Mac freeware), MetaGPT/ChatDev/Devika (in-process role-play).

**Two things worth acting on.** The churn in this space is brutal — vibe-kanban sunsetting, omnara archived, Crystal deprecated, Terragon shut down, all within about six months — which says the _parallel runner_ niche is commoditized and not defensible. And 27.5k vibe-kanban users are currently looking for a replacement.

**Conclusion.** The combination is genuinely unoccupied, and it is unoccupied along our three existing strengths (multi-provider supervision, remote/mobile monitoring, per-agent authority) rather than along a gap we'd have to invent a reason to fill. The differentiator is not the canvas — canvases exist. It is **deterministic daemon-side execution** of what the user drew, which is precisely what the closest competitor gave up.

---

## Part 8 — Why not LangChain.js / LangGraph.js

Worth answering precisely, because "write our own" is usually the wrong instinct.

**LangChain.js is the wrong layer entirely.** Its value is normalizing model providers, tools, prompts, memory, and retrievers — and **we never call a model.** The daemon spawns Claude Code, Codex, Copilot CLI, OpenCode, or Pi as supervised OS processes; each owns its own model connection, its own tool loop, its own context window, its own permission prompts. Adopting LangChain would mean importing a provider-abstraction layer and using none of it.

**LangGraph.js is the right layer and the wrong unit of work.** Its node is a function that takes state and returns a delta, in-process, in milliseconds-to-seconds, with the checkpointer owning durability. Our node is: _spawn an OS process, hand it a prompt, wait somewhere between thirty seconds and several hours while it edits a real repository, then read its last message._ Everything downstream of that difference diverges:

- **Two sources of truth.** Our `Run` is a **protocol type** with backward-compatibility guarantees — persisted as JSON, broadcast over the WebSocket, rendered by clients six months older than the daemon. LangGraph's state would be a second model that must be projected into `Run` anyway, and kept in sync across restarts. One state model that the wire already understands beats two.
- **We already own the hard parts.** Process supervision, cancellation, whole-subtree settle detection, per-agent permission modes, the ledger. LangGraph has no opinion about any of it, so it can't help with the 90% and would take over the 10%.
- **The 10% is genuinely small.** Tally what we'd actually use: channels/reducers (don't need — see Part 6), checkpointing (we already snapshot the whole Run on every change), `Send` (~30 lines for us), interrupts (the gate machinery exists), subgraphs (trivial once graphs can call graphs), streaming (we have our own event bus and protocol). That is a few hundred lines, in exchange for a permanent dependency whose JS port already trails its Python original by weeks to months.

So: **read LangGraph for the science, don't link it.** The same conclusion the Visualizer reached, for the same reason — we wanted its render layer, not its ingestion.

---

## Part 9 — The parts list

What to take, from where, and where it lands. Ordered by dependency, not by appeal.

### 0. Named ports come first (Rivet, and Forge's own prior art)

**This is the sequencing insight that matters.** Every control-flow node we want needs more than one port: a Router has one branch per outcome, a Map has `items` and `done`, a Gate has `approved` and `rejected`, a Check has `pass` and `fail`. Our node has exactly one input and one output, and our edge is `{from, to}` with no port identity.

Rivet's connection is `{outputNodeId, outputId, inputNodeId, inputId}`; Forge's own nodes already carry `inPorts[]`/`outPorts[]` with labels and data types. **Generalize the port model before building any control-flow node**, or we will bolt branches onto a single-port canvas and regret both the schema and the wire format. `GraphEdge` gains `fromPort?`/`toPort?` (absent ⇒ `"output"`/`"input"`, so every existing graph stays valid).

### 1. A structured node output (Rivet's typed ports + Anthropic's artifact passing)

```
NodeOutput { summary, artifacts: ArtifactRef[], fields?: Record<string,…>, evidence? }
```

Persisted on the phase candidate, which already carries `summary`. Downstream nodes get the summary inline and **references** to artifacts they read themselves. This is Gap 1, it is the prerequisite for resume (piece 4), and it is what makes `spec.md → plan.md → diff` a real pipeline instead of a prose relay.

### 2. The excluded-branch poison value (Rivet)

The moment conditional edges exist, a join downstream of an untaken branch either deadlocks or fires early. Rivet's answer: an untaken branch yields `control-flow-excluded`, which propagates and excludes downstream nodes, absorbed only by a whitelist (`if`, `coalesce`, `graphOutput`, `loopController`). For us that is one extra state on `NodeResult` — `done | failed | excluded` — plus a Merge node that absorbs it. **Cheap to design in now, expensive to retrofit**, which is why it is listed before the feature that needs it.

### 3. Durable pause (Activepieces) + typed resume form (Kestra) + suspend declaration (Windmill OpenFlow)

The wire vocabulary already has what we need: `RUN_STATUSES` includes `paused`, `RUN_PHASE_STATUSES` includes `blocked`. What is missing is the persisted metadata:

```
Run.pause?: { nodeId, kind: "gate", prompt, form?: GraphInput[], requestedAt }
```

`GraphInput` already exists — it is the schema behind the graph's fill-in parameters — so a Gate node's "ask the human something" renders with the form kit we already ship. Activepieces' shape is the model: a `PAUSED` status plus discriminated pause metadata on the run row, and a **boot-time worker that rehydrates paused runs**. Today `RunService.init` does the opposite: it marks every in-flight run failed.

### 4. Idempotent resume (DBOS / Inngest memoize-by-key)

Seed the engine's per-node memoized promises from the persisted `Run`: a phase already `done` returns its recorded output instead of spawning an agent that already edited the repo. Roughly twenty lines once piece 1 lands, and it converts "daemon restarted, run dead" into "run continues".

### 5. Conditions on the edge (Sim)

`GraphEdge.when?: { type: "if" | "else if" | "else", expression }` evaluated against the upstream node's declared `fields`. Sim puts the condition on the edge rather than in a node, which keeps the canvas readable — the branch is visible as a labelled wire, not hidden inside a box. A Router node still earns its place for the natural-language classification case where no predicate exists.

**On loops:** Sim models loops and parallels as first-class keyed containers rather than cyclic edges. Ours is a per-node annotation, already built, and it covers the common case (retry this node until the judge passes). Recommendation: **keep the annotation, revisit containers only when a loop must span multiple nodes.** Don't rewrite what works to match someone else's schema.

### 6. Palette taxonomy (Dify's `BlockEnum` — the shape, never the code)

Group the node palette in three families, which is also how the designer's Add menu should read:

- **Lifecycle** — Orchestrator (root), Brief
- **Control** — Gate, Router, Map, Merge, Subgraph
- **Capability** — Agent, Check (run a command)

### 7. Live run on the canvas (Rivet's debugger attach)

Rivet's IDE attaches over WebSocket to a processor running elsewhere and lights the graph up as it executes. We already have both halves — a daemon that emits run events and a client that subscribes — so the designer canvas can double as the run monitor, with node status painted live. This is the piece that most directly compounds with Otto's actual differentiator (watching your machine's agents from your pocket), and it costs almost nothing beyond wiring the existing event stream into the canvas.

### What this is not

None of this is a rewrite. Pieces 0–2 are schema and engine-state changes measured in tens of lines; 3–4 are the durability story; 5–7 are the feature surface. The engine stays ours, the wire stays backward-compatible, and every borrowed idea arrives as our own code in our own vocabulary.
