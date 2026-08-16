---
id: "orchestration-phase-run-engine"
kind: "architecture"
title: "Orchestration phase-run engine"
status: "confirmed"
tags:
  ["orchestration", "phase-runs", "conductor", "fan-out", "judge", "gates", "archdocs-retirement"]
created_at: "2026-08-16T13:21:07.387Z"
updated_at: "2026-08-16T13:21:07.387Z"
---

# Orchestration phase-run engine

<!-- compiled_truth -->

A phase run is an orchestration a conducting agent declares at runtime through the `start_run` tool rather than one a user draws in advance; the daemon executes it deterministically. The engine is `packages/server/src/server/orchestration/run-engine.ts` — pure control flow over an injected port, no daemon dependencies. It is one of the two engines sharing the `Run` + `RunPhase[]` projection (the sibling is the graph engine); both project into the same observable type so one store and one client render both.

The plan names phase types, never roles; the dispatcher maps type to role so a plan stays readable when a team is re-cast. The phase vocabulary: research (researcher — survey, report findings not solutions), plan (planner), refactor (coder), implement (coder), design (designer — styling/layout/human-skill text), verify (judger — structured verdict), gate (human, no default role), deliver (coder). A phase carries an id, type, title, task, optional role override, dependsOn, fanOut, keepBest, and an optional judge spec; the plan is schema-validated at the tool boundary so a malformed plan is rejected before any agent spawns.

`buildRunFromPlan` is pure and adds two structural rules: ids are unique, and `dependsOn` may only reference an earlier phase. That keeps declared order a valid topological order, which makes execution a simple forward pass. `dependsOn` is a guard, not a scheduler: a phase whose dependency did not reach `done` is marked `skipped` and the pass continues; parallelism lives inside a phase as fan-out, never across phases.

Roles are resolved before spawning (the engine asks the port for the personality filling each required role, including the judger). A missing role hard-fails the run and names the gap — no silent fallback to a bare provider; fix the team, don't paper over it.

Threading results forward: a child agent starts a fresh session with no memory of its siblings, so a dependency's output must travel in the prompt. `composePhaseTask` prefixes the declared task with one labelled block per dependency carrying that phase's representative output (the joined summaries of its passing candidates, or of all candidates when not judged). This is what makes `dependsOn` mean "build on this" rather than merely "run after this".

The signature shape — fan-out, judging, keep-best: spawn `fanOut` candidates, grade each with a structured judge, keep the passers, top up until `passers >= keepBest` or a cap trips. The first round spawns the full `fanOut`; later rounds spawn only enough to top up, never the full width again. A candidate with no verdict counts as passing (judging is opt-in; an unjudged phase must not be treated as unanimously failing). A judged phase succeeds if at least one candidate passed; an unjudged phase succeeds if it produced any candidate at all. Verdicts are parsed from the judge's final message against `JudgeVerdictSchema` ({verdict, score?, criteria?, summary?}); an unparseable verdict reads as a fail, and the outcome is a forward-compatible plain string. Structured judging here is prompt-and-parse (the judge is a full agent, its verdict recovered from prose); graph nodes get the stronger `submit_output` contract with in-session self-correction, which phase runs do not use.

Human gates: a `gate` phase is the attended-by-default guarantee. Reaching one sets the phase `blocked` and the run `paused` and waits for a decision — Approved → phase `done`, run returns to `running`; Rejected → phase `failed`, run `canceled` (the pass stops there); Autopilot → the gate auto-approves and the run never pauses (explicit, per run). Gate decisions arrive out of band and may land before the engine starts waiting, so the service buffers a decision registered against a phase that has not blocked yet.

Caps: `maxConcurrency` (default 6 — children running at once), `maxAgents` (default 40 — hard ceiling, the run stops rather than sprawls), `maxLoopAttempts` (default 3 — top-up rounds for a keep-best phase). The run settles `done` when the pass completes, `failed` on the first phase that produces nothing usable or when a cap trips, `canceled` on user cancel or a rejected gate. The headline deliverable is the output of the last completed non-gate phase, relayed back by the conductor; a separate AI-written summary is generated after settling and carried as `summary` with a `summaryStatus` lifecycle.

Not built in the phase engine: per-phase retry, time limit, declared output fields, conditional routing, and per-node authority — those are graph-node capabilities. There is no token or cost ceiling on either engine, and no resume (a paused run does not survive a daemon restart — see the Orchestration durability design record).

Invariants: a plan is validated before any agent spawns (unique ids, dependsOn references only earlier phases); a missing role fails the run and names the gap (no fallback seat); dependsOn is a guard, not a scheduler; a dependency's output reaches its dependants through the prompt, never shared memory; a candidate with no verdict counts as passing; an unparseable judge verdict is a fail, never an accidental pass; a rejected gate cancels the run, it never silently continues; every spawned child — worker or judge — counts against the run's caps.

Direction: once the graph engine gains a gate node and candidate fan-out, this engine's vocabulary survives as a preset graph template rather than a second scheduler (the runs-become-a-preset-graph decision). Until both land, this engine is as built and the fan-out/judge/keep-best shape is the capability the collapse must preserve.

## Timeline

- time: "2026-08-16T13:21:07.387Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["orchestration-domain-model-and-engine-invariants","runs-become-a-preset-graph-template","orchestration-node-capabilities"]
- time: "2026-08-16T13:21:07.387Z"
  kind: "evidence"
  summary: "Ported in full from the retired archdocs page 13-orchestration-runs (reconciled to code 2026-07-25). Engine: packages/server/src/server/orchestration/run-engine.ts. No docs/ page covers the phase engine; this is the system of record for it. Where this and the code disagree, code wins."
