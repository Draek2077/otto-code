# Orchestration Graphs — Enhancement Plan

**Status:** Plan (agreed direction, not yet commissioned per stage)
**Date:** 2026-07-21
**Scope:** The capability set that turns Graph orchestrations from prose relay into a
structured pipeline: honest node results, declared output fields, tool-enforced
structured output, conditional edges, per-node authority, resilience, and prompt reuse.

**Sources.** The reference implementation reviewed at `~/Desktop/something/api/`
(NestJS DAG engine; see `ORCHESTRATION-COMPARISON.md` there) proved these capabilities
work end to end. This plan re-expresses them **in Otto's vocabulary and architecture** —
we port ideas and contracts, never code or names. The architectural frame is
`archdocs/pages/10-18` (orchestration doc set); where this plan and those pages disagree
on a word, this plan wins and the pages get amended (see Terminology reconciliation).

---

## Principles (Otto's, restated for this work)

1. **Every provider, equally.** Anything a node can do — submit structured output, call
   query tools, run with narrowed authority — works for Claude, openai-compat (and
   therefore local models), and every other seat. The per-agent **Otto tool catalog** is
   the one seam that makes this true; nothing binds to a single provider SDK.
2. **Protocol contract is absolute.** Every field below is `.optional()`; absence
   reproduces today's behaviour exactly. Vocabularies are plain strings on the wire with
   known-values arrays in code. Old clients render a graph orchestration as the phase
   list they already understand.
3. **Token economy is a design input.** A node's session weight — tools offered, prompt
   length, upstream material carried — is part of its design, not an accident. The
   reference proved that a narrow node (no filesystem, one submit tool, short prompt) is
   dramatically cheaper; local models benefit most.
4. **The designer is the authoring surface.** Every concept here has a visual home in
   the graph designer (node properties, edge properties). No capability may be
   JSON-only.
5. **No silent skips.** A node that does not run says why — on the canvas, in the run,
   and in the wrap-up.

---

## Vocabulary

Otto names for everything in this plan. Glossary entries are added as each ships.

| Otto term                        | What it is                                                                                                                                                                                                   | Wire (all optional)                                                                                                                                              | Not called                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **Skipped** (node result)        | Third node outcome: control flow routed around the node. Not an error. Reuses the existing phase status `skipped`; a new reason distinguishes _why_.                                                         | `RunPhase.skipReason?: string` (`"condition"` \| `"upstream-skipped"` \| `"upstream-failed"`)                                                                    | "excluded" (archdocs draft term), "inactive"   |
| **Output fields**                | Fields a node declares it will produce, as plain JSON descriptors. The designer's schema editor renders them; the daemon compiles them to Zod for validation and JSON Schema for the submit tool.            | `GraphNode.output?: { fields: [{ key, type, description?, required? }] }` — `type` is an open string vocabulary (`"string"`, `"number"`, `"boolean"`, `"array"`) | "outputSchema", serialized Zod (not wire-safe) |
| **`submit_output`**              | The Otto tool a node's agent calls to deliver its output fields. Validation failure returns a tool error the model corrects in-session; the first valid, non-errored call wins.                              | none (tool lives in the per-agent catalog, not the graph)                                                                                                        | "structured output MCP server"                 |
| **Condition** (on an edge)       | Expression gating an edge, evaluated against the upstream node's output fields after it settles. Unselected branch → downstream **skipped** with reason `"condition"`.                                       | `GraphEdge.when?: { expression: string }` (JSONata)                                                                                                              | "guard", "edge condition schema"               |
| **Fields carried** (on an edge)  | Which of the upstream node's output fields this edge delivers downstream. Absent = everything (today). Selection, not renaming — downstream is a prompt, not a typed function, so mapping keys buys nothing. | `GraphEdge.fields?: string[]`                                                                                                                                    | "fieldMap"                                     |
| **Workspace access** (on a node) | How much of the workspace the node's agent may touch: `none` (no filesystem), `read`, `write`. Absent = today's behaviour (unrestricted).                                                                    | `GraphNode.access?: string`                                                                                                                                      | "sandbox mode"                                 |
| **Otto tools** (on a node)       | Allowlist over the existing Otto tool groups (preview, browser, web, agents, terminals, schedules, artifacts, workspace) for this node's session. Absent = today's policy-driven behaviour.                  | `GraphNode.tools?: string[]`                                                                                                                                     | "MCP allowlist"                                |
| **Query tools** (on a node)      | Author-defined, read-only tools available only in this node's session: run a command (argv only), HTTP GET, or read a file. They join the node agent's Otto tool catalog.                                    | `GraphNode.queryTools?: [...]`                                                                                                                                   | "data tools"                                   |
| **Retry** (on a node)            | Resilience against transient failure: bounded re-dispatch with backoff. Distinct from **Loop** (quality iteration, exists).                                                                                  | `GraphNode.retry?: { maxAttempts, backoffMs, multiplier? }`                                                                                                      | —                                              |
| **Time limit** (on a node)       | Wall-clock ceiling for the node's agent. Expiry cancels the agent (really), fails the node, and cascades like any failure.                                                                                   | `GraphNode.timeoutMs?: number`                                                                                                                                   | —                                              |
| **Prompt template / snippet**    | Host-level reusable prompts (EJS), mirroring the Graph store. A **snippet** is a template other templates include.                                                                                           | `GraphNode.promptTemplate?: { templateId, variables? }`                                                                                                          | "partial" (EJS jargon; UI says snippet)        |
| **Run values**                   | (Deferred) Write-once named values shared across a run. Second write is an error; accumulation stays on files/artifacts.                                                                                     | future `OrchestrationGraph.values?`                                                                                                                              | "run context", "shared state"                  |

Existing terms unchanged and load-bearing: **Orchestration**, **Graph**, **graph
designer**, **Loop** (`times`/`until`), **tool policy** (deterministic/autonomous),
**deliverables** (terminal-node output relayed to the Orchestrator), **Role**,
**Personality**, **Isolation** (already means local vs worktree — a future per-node
isolation choice reuses it verbatim). **"Workflow" is forbidden** — it names the Claude
provider's Workflow tool.

### Terminology reconciliation

`archdocs/pages/12-14, 18` use "excluded" for the third node state. The wire already has
`skipped`, the run projection already paints it, and the glossary rule is one term — so
the state is **skipped**, and the archdocs distinction (control-flow skip vs
failure-cascade skip) is carried by `skipReason`, not by a second noun. Amend the pages
when Stage 0 lands.

---

## The capabilities

### 1. Node results tell the truth (Stage 0 — everything depends on this)

`NodeResult` in `graph-engine.ts` is `{ output, failed }` today. It becomes a
discriminated union per the server's own state-design standard:

```ts
type NodeResult =
  | { status: "done"; output: string | null }
  | { status: "failed"; error: string }
  | { status: "skipped"; reason: "condition" | "upstream-skipped" | "upstream-failed" };
```

The run projection maps `skipped` onto the existing phase status and records
`skipReason`; the free-text phase notes carry the human sentence ("Skipped — the
condition on the edge from _Classify_ chose the other branch"). The wrap-up names every
skipped node and its reason — a run never reports done while silently omitting part of
the graph. Retrofit-proofing: this lands **before** conditions exist, because threading a
third state through every join, wrap-up, and projection later is strictly harder
(archdocs page 13's warning, honoured).

Also in Stage 0, schema-only: reserve `GraphEdge.fromPort?` / `toPort?` (absent ⇒
today's single ports). Costs two optional fields now; buys the control-node future
(gate `approved`/`rejected`, check `pass`/`fail`) without a coordinated
schema+canvas+engine change later.

### 2. Output fields (the value plane)

Today a node's output is its agent's last chat message — prose that every downstream hop
re-summarises. A node that declares **output fields** gets:

- validation of its result on settle (compiled from the descriptors),
- its fields persisted on the phase candidate (`outputFields?: Record<string, unknown>`),
- downstream nodes receiving a labelled JSON block _alongside_ the prose summary (prose
  stays — a node that never heard of fields keeps working),
- something for edge **conditions** and **fields carried** to operate on.

The descriptors are deliberately small — key, type, description, required — because they
must be three things at once: wire-safe JSON, a form the designer can render as a field
editor, and compilable to both Zod (validation) and JSON Schema (the submit tool's input
schema — MCP's native format, so this is the natural shape, not a compromise).

Rule kept from the archdocs design: **references, not contents**. Output fields carry
values and paths; anything big is a file the downstream node reads with its own tools.

### 3. `submit_output` — enforcement with self-correction

When a node declares output fields, the daemon registers a **`submit_output`** tool in
that agent's Otto tool catalog (the per-agent factory already exists and already carries
the caller's identity; `OttoToolResult.isError` already exists). Mechanics:

- The node's task gains a two-line driver instruction: do the work, then call
  `submit_output` exactly once; the call _is_ the deliverable.
- The tool handler validates against the compiled schema. Invalid → `isError: true` with
  the precise validation message; the model corrects **in the same session** at zero
  orchestration cost.
- On settle, the daemon extracts the result from the node agent's timeline: the first
  valid call whose result was not an error. (The reference implementation also proved
  `last` and `merged` extraction variants useful; we start with `first` and add the
  others when a node needs them.)
- Extraction failure falls back to prose JSON parsing (the existing
  `parseVerdict`-style balanced-object scan) validated against the same descriptors;
  only if both fail does the node fail, with a diagnosis that lists which tools the
  agent _did_ call.

Provider coverage is the point: Claude and every MCP-capable provider reach the tool via
the daemon's MCP server; openai-compat gets it natively because the daemon owns its tool
loop; local models therefore get the identical self-correction contract. No provider
branch anywhere in the engine.

### 4. Conditional edges

`when` on the edge, evaluated after the upstream node settles, before downstream
dispatch. Engine truth (validated against both codebases):

- Otto's memoized-promise scheduler **keeps working unchanged**. Decisions happen after
  all upstream promises settle, so there is nothing to re-converge — the reference's
  fixed-point cascade exists only because its dispatcher re-scans global state. Our
  change is a post-await, pre-dispatch gate inside `executeNode` (~140 lines total).
- Semantics (adopted from the reference, where the diamond pattern demonstrably works):
  a declared edge is required. A node runs only if at least one incoming edge is
  satisfied **and** none is inactive (its condition said no). An upstream that was
  _skipped_ is not the same as an edge whose condition said no — that distinction is
  what lets a join downstream of two conditional branches run off whichever branch
  executed.
- Material honesty: the assembled task includes upstream material **only from satisfied
  edges** — a skipped branch contributes nothing, not an empty section.
- Expressions are JSONata: safe (parsed, never eval'd), small, evaluates against the
  upstream node's output fields, falls back to the prose output when no fields are
  declared. Designer: a "Condition" editor on the edge, live syntax feedback, the
  expression painted as the wire's label; save-time validation warns (not errors) when a
  condition targets a node with no output fields.

### 5. Node authority — the token-spend lever

The reference's deepest lesson: its cheap nodes run with almost nothing — no filesystem,
no shell, one submit tool, a stripped env. Otto nodes today carry the provider's full
default toolset into every session. Authority becomes a per-node declaration, applied at
spawn, never requested in prose:

- **Workspace access** — `none | read | write`. One dropdown in node properties. The
  daemon maps it per provider: allowed/disallowed tool sets for CLI providers,
  exact enforcement for openai-compat (the daemon owns that tool loop), permission modes
  elsewhere. Absent = today.
- **Otto tools** — allowlist over the eight existing groups. Fewer tools is not just
  safety: it is fewer catalog tokens per request and less distraction, which matters
  most for local models.
- **Query tools** — author-defined read-only lookups scoped to the node's session,
  hosted on the same per-agent catalog: `command` (argv array only — no shell operators,
  no injection surface; anyone needing a pipe writes a script and points the tool at
  it), `http-get` (no custom headers), `file-read` (resolved path must stay inside the
  run's cwd, symlinks followed before the check).
- Existing **tool policy** (deterministic/autonomous) is unchanged and composes: policy
  decides whether orchestration tools exist at all; access and the allowlist narrow the
  rest.

### 6. Retry and Time limit

- **Retry** is one bounded loop around dispatch, attempts counted centrally against the
  run's agent cap and semaphore. _Never re-entered from the failure path_ — the
  reference implementation's retry recurses (`executeStep` ↔ `retryStep`) with a fresh
  allowance at every level, so a persistently failing step retries forever; we take the
  lesson, not the code. Retry wraps the node's whole dispatch including its Loop;
  `RunPhase.retryAttempts?` surfaces how many were spent.
- **Time limit** must actually stop the work. The reference races a timer against the
  handler and leaves the agent running and spending — and Otto can do what it cannot:
  node agents are managed processes, so expiry cancels the agent via the daemon
  (per-node abort wired through the engine port), fails the node with
  `RunPhase.timedOut?: true`, and lets independent branches continue. A timed-out node
  with Retry configured retries after backoff.

### 7. Prompt templates and snippets

Host-level store (`$OTTO_HOME/prompt-templates/`), mirroring the Graph store: atomic
writes, change notifications, seeded starters, copy-on-edit for built-ins. EJS rendering
with includes; a **snippet** is a template other templates include (the reference's
`structured_output_rules` partial — one shared block of submit-tool behaviour reused by
every node that submits — is the pattern to seed). Node properties gain a prompt source
choice: Inline (today) or Template with variable bindings (`$inputs.key`,
`$output.nodeId.field`). Resolution failure falls back to the inline prompt; templates
are never load-bearing for an existing graph.

Convention shipped with the mechanism: the _driver instruction_ (two lines: what to do
now, how to deliver) stays in the task; the reusable _behavioural rules_ live in
snippets. That separation, applied everywhere in the reference, is a real token saving.

EJS executes JavaScript in the daemon process. Acceptable: templates are user-authored
host-level files, the same trust level as workspace scripts. The day graphs or templates
become shareable, imported templates need an explicit warning gate — comment goes in the
code now.

### 8. Run values (deferred, scoped honestly)

The reference's shared context is a bare last-write-wins map — safe there only because
its workflows use it write-once (a session id, a repo path — set early on a sequential
path, read later). Even the reference never attempts concurrent accumulation. So Otto's
eventual version is exactly that narrow: **write-once named values**, declared on the
graph, a second write is a loud error, compile-time warning when two parallel nodes
could write the same key. Accumulation stays on files and artifacts, which already have
ownership semantics. Not in the build order until a golden graph needs it.

---

## Build order

Each stage lands green (lint, scoped tests, format), independently shippable behind the
existing gates (`server_info.features.orchestrationGraphs` + dev-build gating in the
client). Daemon before client, always.

| Stage                    | Work                                                                                                                                                                                                                                       | Done when                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0 — Truth**            | `NodeResult` discriminated union; `skipReason` + notes on the projection; wrap-up names skips; reserve `fromPort`/`toPort`; amend archdocs terminology                                                                                     | Engine tests prove skip ≠ fail ≠ done end to end; a failure-cascaded node and a (future) condition-skipped node are distinguishable in the run record                         |
| **1 — Output fields**    | Field descriptors on nodes; compile to Zod; validate on settle; persist `outputFields`; labelled JSON block in downstream material; `submit_output` on the Otto tool catalog + timeline extraction + prose fallback; designer field editor | The classify-style node produces validated fields via the tool on **both** a Claude seat and a local openai-compat seat; an invalid first submission self-corrects in-session |
| **2 — Conditional flow** | `when` on edges (JSONata); pre-dispatch gate; skip cascade with reasons; satisfied-edges-only material; `fields` selection on edges; designer condition editor + skipped-branch painting                                                   | The diamond graph (classify → quick/deep → review) runs with one branch skipped-with-reason and review consuming whichever draft exists                                       |
| **3 — Node authority**   | Workspace access modes; per-node Otto tool groups; query tools (argv/http-get/file-read); per-provider enforcement mapping                                                                                                                 | A `none`-access node with one query tool runs measurably lighter (catalog tokens) and cannot touch the workspace on any provider                                              |
| **4 — Resilience**       | Retry (bounded, centrally counted); Time limit with real agent cancellation; `retryAttempts` / `timedOut` on phases                                                                                                                        | Kill-the-node tests: a flaky node recovers within its budget; a hung node is cancelled at the limit and its branch fails while siblings finish                                |
| **5 — Prompt reuse**     | `PromptTemplateStore` + RPCs (`runs.templates.*`); snippets; seeded starters; node prompt-source UI                                                                                                                                        | Two graphs share one template + the submit-rules snippet; editing the template changes both on next run                                                                       |

Dependencies added (packages/server only): `jsonata` (Stage 2), `ejs` (Stage 5).

Deliberately out of scope here, tracked in the archdocs set: named-port _use_ (gate /
check / router / merge / map nodes), durable pause + adoption-on-restart, run budgets.
Stage 0's reserved port fields and honest results are their prerequisites, so this plan
converges with that track rather than forking it.

## Protocol additions (one table, all optional)

| Schema                    | Field                                                       | Stage |
| ------------------------- | ----------------------------------------------------------- | ----- |
| `GraphNodeSchema`         | `output?: { fields: [...] }`                                | 1     |
| `GraphNodeSchema`         | `access?: string`, `tools?: string[]`, `queryTools?: [...]` | 3     |
| `GraphNodeSchema`         | `retry?: {...}`, `timeoutMs?: number`                       | 4     |
| `GraphNodeSchema`         | `promptTemplate?: { templateId, variables? }`               | 5     |
| `GraphEdgeSchema`         | `fromPort?`, `toPort?` (reserved)                           | 0     |
| `GraphEdgeSchema`         | `when?: { expression }`, `fields?: string[]`                | 2     |
| `RunPhaseSchema`          | `skipReason?: string`                                       | 0     |
| `RunPhaseSchema`          | `retryAttempts?: number`, `timedOut?: boolean`              | 4     |
| `RunPhaseCandidateSchema` | `outputFields?: Record<string, unknown>`                    | 1     |

All wire schemas stay structurally pure (no transforms); descriptors must pass the
zod-aot generated-validator rules (`docs/protocol-validation.md`) — verify in Stage 1.

## New daemon modules

| Module (`packages/server/src/server/orchestration/`) | Owns                                                                                                | Stage |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----- |
| `node-output.ts`                                     | Descriptor→Zod/JSON-Schema compilation, settle-time validation, timeline extraction, prose fallback | 1     |
| `edge-conditions.ts`                                 | JSONata evaluation, edge resolution, material filtering                                             | 2     |
| `node-authority.ts`                                  | Access-mode → per-provider enforcement mapping, query-tool builders                                 | 3     |
| `prompt-template-store.ts` + `prompt-render.ts`      | Template store (GraphStore pattern), EJS render + snippet includes                                  | 5     |

Engine changes stay inside `graph-engine.ts` behind the existing `GraphEnginePort` seam —
pure control flow, fake-port unit tests, deterministic schedules. The port grows one
method (per-node agent cancellation) in Stage 4.

## Reference defects we deliberately do not import

Recorded so review can check the temptation never creeps in:

1. **Retry recursion** — retry re-entered from the failure path compounds without bound.
   Ours is one loop, one counter, charged to the run's caps.
2. **Timeout that doesn't cancel** — racing a timer while the agent keeps spending.
   Ours cancels the managed process.
3. **Last-write-wins shared state** — unordered concurrent writes. Ours (if ever built)
   is write-once with a loud second-write error.
4. **Serialized code in data** — typed lambdas / Zod shapes can't cross a wire. Ours are
   JSON descriptors and JSONata strings, renderable by the designer.

## Glossary entries to add as stages ship

Output fields · Condition (edge) · Fields carried · Workspace access · Query tools ·
Retry (vs Loop) · Time limit · Prompt template · Snippet · skipReason semantics under
**Orchestration**.
