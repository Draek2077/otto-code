---
id: "orchestration-graph-engine-execution-model"
kind: "architecture"
title: "Orchestration graph-engine execution model"
status: "confirmed"
tags:
  [
    "orchestration",
    "graph-engine",
    "scheduling",
    "skip-semantics",
    "node-envelope",
    "archdocs-retirement",
  ]
created_at: "2026-08-16T13:22:18.917Z"
updated_at: "2026-08-16T13:22:59.483Z"
---

# Orchestration graph-engine execution model

<!-- compiled_truth -->

The graph engine is pure control flow over an injected port (`packages/server/src/server/orchestration/graph-engine.ts`) — no daemon dependencies, unit-testable with a fake port. It decides what runs, in what order, with what input, and whether the answer counts; who the agent is and what it may touch is agent binding. It is one of two engines sharing the `Run` + `RunPhase[]` projection (the other is the phase engine); `Run.kind = "graph"` selects it.

Scheduling: one memoised promise per node. There is no wave batching and no dispatcher rescan. Each node gets one promise, created on first demand and reused; a node awaits its upstream nodes' promises directly, so a node whose inputs are ready never waits on an unrelated branch. Termination is guaranteed at build time, not run time: `buildRunFromGraph` rejects a graph that fails structural validation (Kahn's cycle check, exactly one Orchestrator root, edges resolving to known nodes) or whose edge conditions do not parse. Loops are node annotations, never cyclic edges. Because a node awaits all of its upstream promises before deciding anything, nothing it reads can still change by the time it decides — that is what lets conditional edges ride the memoised-promise model with no fixed-point pass.

Node results are three-valued: `done`, `failed`, or `skipped`. A skip is control flow routing around a node, never an error, and always carries a machine-readable `RunPhase.skipReason`: `condition` (an incoming edge's condition chose another branch), `upstream-skipped` (everything feeding this node was itself skipped), `upstream-failed` (an upstream node failed), `canceled` (the run was canceled before dispatch). The gating rule that makes diamonds work: a drawn edge is a requirement; a node runs when at least one edge delivers and none was ruled out by its own condition; an upstream that was skipped contributes nothing and vetoes nothing. So a join below two conditional branches still runs off whichever branch executed, because the pruned side arrives as upstream-skipped rather than as a veto.

Conditions are JSONata (`edge-conditions.ts`), evaluated against the upstream node's output fields at the top level plus `output` carrying its prose. JSONata because it is parsed and evaluated, never `eval`'d — a graph is user-authored data and must never become code the daemon executes; nothing else is in scope (a condition cannot reach the filesystem, the run, or another node). A condition that throws fails the node; it is never a quiet false (a typo would otherwise silently prune half the graph). Syntax is checked before the run starts; the shared client validator stays parser-free, so expression checking is daemon-side.

Prompt assembly: a node's prompt is assembled per attempt, not stored. Base prompt is one of `promptTemplate` (EJS + snippets), inline prompt with `{{inputs.key}}` substitution, or `promptFromInput` binding a declared input as the whole prompt; the task then gains upstream material (satisfied edges contribute a labelled JSON block of carried fields first, then prose — a skipped branch contributes nothing), an output instruction from the declared fields, and iteration context (previous output, judge feedback). Rule: references, not contents — fields carry values and paths; anything large is a file the next node reads with its own tools.

The node is a mini-orchestrator: a bounded orchestration of its own. The engine runs a nested envelope of counters around one or more real agents, and only the outermost result crosses the node boundary. Inside out: one iteration spawns a worker (seat, authority, assembled task), awaits it (bounded by `timeoutMs`, which really cancels), harvests its output; under `until` a separate judge agent grades the output against declared criteria (spawned with no workspace reach — it grades output, it does not need the node's authority). The loop is quality: `times` re-runs work that succeeded feeding each iteration the previous output; `until` re-runs until the judge passes feeding the failure reasoning forward (self-grading is not an exit test). Retry is resilience: it wraps the whole loop and re-enters only from the top, never from the failure path, with every attempt charged to the run's caps. What crosses the boundary is deliberately small: in, the material carried by satisfied edges (fields first, prose second); out, the declared fields and the final prose. Iterations, judge feedback, retries and timeouts stay inside — downstream nodes never see a node's drafts. A node kind is a different envelope (a gate waits for a human; a check runs a command; a map multiplies the envelope per item), not a different scheduler.

Three separate mechanisms, deliberately not one: Loop `times` (fixed repeat, last output wins), Loop `until` (quality iteration, judge-graded, never passing within max fails the node), Retry (resilience, wraps the whole node including its loop, backoff `backoffMs × multiplier^(attempt-1)`, ends early if canceled). Two invariants protect the counters: one loop, one counter (retry is never re-entered from the failure path — the prior art studied re-enters its executor from its own catch block with a fresh allowance at every level, so a persistently failing step retries forever); every attempt is charged to the run (retries and judges spawn through the same capped path as any other agent). `timeoutMs` must cancel, not merely stop waiting — an abandoned agent keeps running and keeps spending; on expiry the engine calls the port's `cancelAgent`, marks `RunPhase.timedOut`, and fails the node.

Caps and settlement: `maxConcurrency` bounds simultaneous agents through a semaphore; `maxAgents` is a hard run-wide ceiling that stops the run rather than letting it sprawl; loop and retry bounds are per node. A run settles `canceled` if the signal aborted, `failed` on the first node failure, otherwise `done`; failure does not stop independent branches already in flight. The wrap-up names every skipped node and its reason, and the graph's deliverables (nodes nothing else consumes) carry their full output into it.

Not built: no human gate node (gates exist only on phase runs), no per-node candidate fan-out (parallelism is drawn nodes), no per-node turn limit or token/cost ceiling, no per-node worktree isolation (parallel writing nodes share one tree), no cross-node shared state, and no resume (a graph run in flight when the daemon stops is marked failed on restart). `GraphEdge.fromPort`/`toPort` are reserved in the schema and unused. Three review-found holes were fixed 2026-07-25: cancel cascades to in-flight children on both engines; and the cast and prompt templates are snapshotted at run start, so a mid-run team or template edit cannot re-cast or reword a running orchestration.

Invariants: a skip is never an error and always carries a machine-readable reason; a run never reports done while silently omitting part of the graph; a node decides only after every upstream promise has settled; a condition that cannot be evaluated fails its node, never a quiet false; an unknown output-field type accepts, never fails a run; `submit_output` reaches every provider through the per-agent Otto tool catalog (no provider branch in the engine); validation failure is a correctable tool error, not a thrown parse error; a template that cannot render degrades to the inline prompt (the only sanctioned fallback in the engine); retry is one bounded loop, never re-entered from the failure path, always charged to the run's caps; a time limit cancels the agent, never just stops awaiting it; graph structure and condition syntax are validated before the run starts, never during it.

Shipped per-node declaration behaviour and its gotchas (output fields, submit_output, conditional edges, node authority, workspace access, retry/time limit, prompt templates) live in `docs/orchestration-node-capabilities.md` — that page owns the node-level subsystem detail; this record owns the engine's flow.

## Timeline

- time: "2026-08-16T13:22:18.917Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["orchestration-domain-model-and-engine-invariants","orchestration-node-capabilities","orchestration-graph-execution"]
- time: "2026-08-16T13:22:18.917Z"
  kind: "evidence"
  summary: "Ported from the retired archdocs page 14-orchestration-graphs (reconciled to code 2026-07-25). Engine: packages/server/src/server/orchestration/graph-engine.ts. Where this and the code disagree, code wins."
- time: "2026-08-16T13:22:59.483Z"
  kind: "decision"
  summary: "Removed a dangling [[orchestration-graph-execution]] wiki link I introduced; it points to no page. No content change otherwise."
