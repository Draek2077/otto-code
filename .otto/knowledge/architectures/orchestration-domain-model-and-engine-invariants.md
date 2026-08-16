---
id: "orchestration-domain-model-and-engine-invariants"
kind: "architecture"
title: "Orchestration domain model and engine invariants"
status: "confirmed"
tags: ["orchestration", "graphs", "runs", "protocol", "invariants", "archdocs-retirement"]
created_at: "2026-08-16T12:14:26.912Z"
updated_at: "2026-08-16T12:14:26.912Z"
---

# Orchestration domain model and engine invariants

<!-- compiled_truth -->

Otto executes user-authored orchestration graphs of AI agents across every provider. An orchestration is one execution (wire `run`) of a host-level reusable template (wire `OrchestrationGraph`); a `GraphNode` capability node becomes a real Otto agent while control nodes are executed by the daemon. Two engines share one projection: `Run` + `RunPhase[]`, discriminated by `Run.kind`. Phase runs (`run-engine.ts`) are declared by a conducting agent via `start_run`; graph runs (`graph-engine.ts`) execute a user-drawn DAG exactly as drawn. Both live in `packages/server/src/server/orchestration/`; schemas in `packages/protocol/src/orchestration.ts` with `judge-verdict.ts`.

UI vocabulary (bound in `docs/glossary.md`): Orchestration (not "Run"), Graph (the blueprint — never called a "template"), Node, Port (`fromPort`/`toPort`, reserved in schema, unused by engine until the gate node), Answers (`graphInputs`), Seat (role→personality→model, frozen at start), Gate (a `pause`; built for phase runs, graph-node form designed not built), Prompt template (`PromptTemplate`, reusable EJS text), Snippet (a template meant to be `include()`d). Forbidden UI words: "workflow", "blueprint", "pipeline", bare "template" (means prompt template), "Run" as a heading.

The value is what a person fixes before work starts — five decisions every subsystem serves: decomposition, isolation, sequencing, verification, authority. Parallelism is a consequence, not a goal.

The cost test: a multi-agent system costs ~10x the tokens of a single turn, and much of its measured gain is just spend. So the gate before drawing a graph is: would a single agent get this wrong in a way the structure prevents? If no, the graph is a slower, more expensive chat. Four shapes pass: directed research, researched implementation, feature breakout, adversarial evaluation.

The safety rule the engine enforces structurally: read-heavy work parallelises safely; write-heavy work does not, because every action encodes an implicit decision parallel agents cannot see. So gather is parallelised (fan-out reads), and deciding converges through a single node or an explicit brief that fixes decisions in advance.

Consolidated invariants (checkable against code): (structure) exactly one orchestrator root per graph, undeletable and restored if removed; the root has no input port and receives the prompt automatically; a graph with validation problems can always be saved and never executed. (protocol) every added field is `.optional()` with absence reproducing prior behaviour; vocabularies are open strings on the wire with `as const` arrays in code, never a wire enum; no `.transform()/.catch()/.preprocess()` in wire schemas (normalisation is an explicit later pass); an unknown output-field type accepts rather than failing; the shared validator stays parser-free and expression syntax is checked daemon-side only; a graph is validated before a run starts, never during; schemas are declared above first use or the `zod-aot` build breaks. (agents) a node names a role and a role nothing fills fails loudly naming the gap (no silent fallback); authority is applied by withholding at spawn, never requested in prose; `start_run` is withheld from every participant (orchestrations never nest); a node's declarations travel to its agent as labels, so no provider parses a graph and no engine code branches on a provider; whole-subtree settle, never first-idle. (execution) a skip is control flow, never an error, and always carries a machine-readable `RunPhase.skipReason` (`condition`/`upstream-skipped`/`upstream-failed`/`canceled`); a run never reports done while silently omitting part of the graph; a node decides only after every upstream promise settles; a condition that cannot be evaluated fails its node, never a quiet false; concurrency is bounded and total agents capped. (data) a graph run is always also a valid `Run` for a client that has never heard of graphs; run records stay bounded — references, never inlined blobs.

Portability: nodes name a role, not a model, so the same graph runs on an all-local-model team and an all-Claude team.

## Timeline

- time: "2026-08-16T12:14:26.912Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["graph-templates","orchestration-node-capabilities"]
- time: "2026-08-16T12:14:26.912Z"
  kind: "evidence"
  summary: "Ported in full from the retired archdocs set (pages 10 index, 11 concepts, 12 data model, 13 phase runs, 14 graph execution, 16 agent binding), reconciled to code 2026-07-25. Where this record and the code disagree, code wins. Shipped per-node behaviour and designer authoring detail live in `docs/orchestration-node-capabilities.md`; the subsystem gotcha page is the source for node declarations."
