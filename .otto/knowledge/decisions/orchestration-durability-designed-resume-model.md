---
id: "orchestration-durability-designed-resume-model"
kind: "decision"
title: "Orchestration durability: designed resume model"
status: "proposed"
tags:
  [
    "orchestration",
    "durability",
    "resume",
    "checkpoint",
    "orphan-adoption",
    "gates",
    "archdocs-retirement",
  ]
created_at: "2026-08-16T13:27:13.329Z"
updated_at: "2026-08-16T13:27:13.329Z"
---

# Orchestration durability: designed resume model

<!-- compiled_truth -->

Durability matters more here than in any framework studied, for one reason: the nodes have side effects that cost money and edit repositories — re-running a completed node is a second agent making a second set of edits. This record is the model for closing the resume gap; the built half is the gap itself.

Built today (the gap): writing is solved, reading is not. Every state change is persisted and broadcast — the engine emits the whole `Run` on each phase transition, `RunStore` writes it atomically (temp + rename), serialized per id; node results land on `RunPhaseCandidate` as `summary` and validated `outputFields`. In memory only, lost on restart: the memoised node promises, the concurrency semaphore, the spawned-agent count, `NodeOutputStore` (a `submit_output` value held for the moments between submission and harvest), and pending gate waiters. There is no resume: `RunService.init()` walks the persisted runs at boot and marks every `running`, `pending` or `paused` run as `failed` ("Daemon restarted while this run was in flight"). A run parked at a human gate — waiting on the person the gate exists for — does not survive a daemon restart, and meanwhile its child agents may still be alive, so the work is orphaned rather than cleaned up. This is the single largest gap in the system. What IS enforced today: a run in flight cannot be deleted (the caller must cancel first, so a cleanup click cannot orphan live agents); gate decisions arriving before the engine registers its wait are buffered in memory; a starved join resolves as `skipped` with a stated reason rather than hanging or silently vanishing.

Designed: what must survive a restart. (1) The frontier — which nodes completed, which were skipped, which were in flight. (2) Node outputs — so a resumed run feeds downstream nodes without re-running upstream ones. (3) Pause state — which gate is waiting, what it asked, and what form it expects back. (4) The seat snapshot and spend — resolution must not drift, and a restart must not reset the counter. The first two are largely already written; the frontier is the piece that lives only in the promise map.

Checkpoint cadence — two distinct persistence events, conflating them is a common bug: node settle (as each node produces a result; a node that produced nothing still writes a marker, so "ran, produced nothing" stays distinguishable from "never ran") and run snapshot (once per scheduling step, written after the completed step's results are applied and before the next ready set is prepared).

Idempotent resume: two studied systems solve this differently and the difference decides ours. LangGraph.js uses deterministic task ids (`uuid5` over namespace/step/node/trigger, seeded by checkpoint id) plus persisted per-task writes, and its node bodies re-execute from the top on resume — harmless when a node is a function, catastrophic when a node spawns an agent that edits a repository. Activepieces re-walks the step tree and short-circuits per step against a name-keyed output map — that is the model. Otto's rule: seed the memoised result map from the persisted run before execution starts; a node whose phase is `done` resolves immediately to its recorded output, a `skipped` node resolves skipped, everything else runs. The memo check must precede anything side-effecting, always — nothing (no spawn, no file write, no notification) precedes the "have I already done this?" check. The key must include the iteration: `(runId, nodeId, attempt, instance)`, not just node id (a plain `(runId, nodeId)` key breaks the moment a node is inside a loop).

Gate pause and resume: persist the pause (nodeId, prompt, form), pause the run and notify (incl. push); on a decision, store the payload keyed by node id + iteration, clear the pause and resume scheduling. Three load-bearing details: uniqueness is the idempotency anchor (one outstanding question per node instance, keyed `(runId, nodeId, iteration)`, enforced by the store so a double-click or retried RPC cannot create two pending gates); handle the decision-arrives-first race (the user can respond before the engine finishes persisting the pause — Otto already solves this in memory; the durable version needs the same buffering, persisted); the boot path is the whole fix for indefinite gates (a paused run is a record nothing is driving, so the boot path only needs to stop marking it failed and restore it as paused; gates with timeouts would need a scheduled-job equivalent). Resume payloads are keyed, never positional (LangGraph matches by index within a task, so changing the number or order of interrupts silently misassigns answers).

Orphan adoption: the genuinely hard case, and the one no studied framework has — the daemon restarted and the node's agent is still running. Every framework surveyed assumes in-process work, so a crash kills it; Otto agents are separate processes with persisted state, so the correct behaviour is adoption, not restart: on boot, for each in-flight run, look up each running node's `agentId`; agent exists and unsettled → re-await it (continues as though nothing happened); agent exists and settled → harvest its output as the node's result; agent gone → the node counts as failed, subject to its failure policy. This is strictly better than any in-process engine can offer and falls out of Otto's existing architecture. A lease with a visibility timeout is the backstop for two daemons driving one run (currently impossible) — the invariant "a node that is `running` is owned by exactly one executor, and ownership is provable" is worth stating before it becomes possible.

Storage discipline: the run record is broadcast to every connected client on every change, so it must stay small — outputs are references plus a bounded summary; anything large belongs in the workspace or the artifact store. If the output is big enough to need slicing, it should have been an artifact.

Deliberately not building: reducers with declared merge semantics (our concurrent writers write files, and the filesystem already has ownership semantics); time travel / fork from a checkpoint (per-agent rewind already exists); deterministic replay with compensation (our side effect is "an agent edited your repo" — git is the compensation mechanism).

Invariants (✅ built, ◻ designed): ◻ a node's result is persisted as it settles, distinguishably from "never ran"; ◻ the memo check precedes every side effect in node execution; ◻ the memoisation key includes the loop attempt and map instance; ◻ pause state is persisted on the run, unique per `(runId, nodeId, iteration)`; ◻ resume payloads are keyed by node identity, never by call position; ✅ a gate decision arriving before the engine waits is buffered, not lost (in memory); ◻ a restart resumes in-flight runs and never marks a paused run failed; ◻ a still-running agent is adopted, not re-spawned; ✅ a join that can never be satisfied resolves skipped with a stated reason; ✅ a run in flight cannot be deleted (the caller cancels first); ✅ writes are atomic and serialized per run id; ◻ the run record stays bounded, anything large is an artifact.

## Timeline

- time: "2026-08-16T13:27:13.329Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["graph-templates","orchestration-domain-model-and-engine-invariants","orchestration-graph-engine-execution-model"]
- time: "2026-08-16T13:27:13.329Z"
  kind: "evidence"
  summary: "Ported from the retired archdocs page 15-orchestration-durability (reconciled to code 2026-07-25). Status proposed: the resume model (checkpoint cadence, idempotent resume, persisted pause, orphan adoption) is designed, not built — the built half is only the gap. Tracked as build order (durability boot path is dependency 1) in the [[graph-templates]] charter. Where the built facts and the code disagree, code wins."
