---
id: "orchestration-phase-run-engine"
kind: "architecture"
title: "Orchestration phase-run engine"
status: "proposed"
tags: []
created_at: "2026-08-16T13:21:07.387Z"
updated_at: "2026-10-05T13:10:58.364Z"
---
# Orchestration phase-run engine

<!-- compiled_truth -->

A phase run is an orchestration a conducting agent declares at runtime through the `start_workflow` tool rather than one a user draws in advance; the daemon executes it deterministically. The engine is `packages/server/src/server/workflow/workflow-engine.ts` — pure control flow over an injected port, no daemon dependencies. It is one of the two engines sharing the `Run` + `RunPhase[]` projection (the sibling is the graph engine); both project into the same observable type so one store and one client render both.

The plan names phase types, never roles; the dispatcher maps type to role so a plan stays readable when a team is re-cast. The phase vocabulary: research (researcher — survey, report findings not solutions), plan (planner), refactor (coder), implement (coder), design (designer — styling/layout/human-skill text), verify (judger — structured verdict), gate (human, no default role), deliver (coder). A phase carries an id, type, title, task, optional role override, dependsOn, fanOut, keepBest, an optional judge spec, and an optional mode; the plan is schema-validated at the tool boundary so a malformed plan is rejected before any agent spawns.

`buildRunFromPlan` is pure and adds structural rules: ids are unique, `dependsOn` may only reference an earlier phase, and an iterative phase must declare a judge and may not be a verify or gate phase. That keeps declared order a valid topological order, which makes execution a simple forward pass. `dependsOn` is a guard, not a scheduler: a phase whose dependency did not reach `done` is marked `skipped` and the pass continues; parallelism lives inside a phase as fan-out, never across phases.

Roles are resolved before spawning (the engine asks the port for the personality filling each required role, including the judger). A missing role hard-fails the run and names the gap — no silent fallback to a bare provider; fix the team, don't paper over it.

Threading results forward: a child agent starts a fresh session with no memory of its siblings, so a dependency's output must travel in the prompt. `composePhaseTask` prefixes the declared task with one labelled block per dependency carrying that phase's representative output (the joined summaries of its passing candidates, or of all candidates when not judged). This is what makes `dependsOn` mean "build on this" rather than merely "run after this".

The signature shape — fan-out, judging, keep-best: spawn `fanOut` candidates, grade each with a structured judge, keep the passers, top up until `passers >= keepBest` or a cap trips. The first round spawns the full `fanOut`; later rounds spawn only enough to top up, never the full width again. A candidate with no verdict counts as passing (judging is opt-in; an unjudged phase must not be treated as unanimously failing). A judged phase succeeds if at least one candidate passed; an unjudged phase succeeds if it produced any candidate at all. Verdicts are parsed from the judge's final message against `JudgeVerdictSchema` ({verdict, score?, criteria?, summary?}); an unparseable verdict reads as a fail, and the outcome is a forward-compatible plain string. Structured judging here is prompt-and-parse (the judge is a full agent, its verdict recovered from prose); graph nodes get the stronger `submit_output` contract with in-session self-correction, which phase runs do not use.

Phase modes decide what a loop round does with a candidate the judge failed. `bounded` (the default) is for work with a finish line one session can reach: a failed candidate is replaced by a fresh agent whose task carries `buildLoopFeedback` — the failed attempt's report (bounded to 3,000 characters), the judge's summary, and only the unmet criteria with evidence — placed after the task and before the worker framing. `iterative` is for open-ended work one session cannot finish (inventory a platform, plan a project): `runIterativePhase` spawns the candidates once, then continues each failed candidate's own chat through the port's `continueAgent` seam with `buildContinuationPrompt` (the verdict only; the chat already holds its own output), awaits it again, and re-judges, keeping one candidate card per chat with `attempts` counting rounds. In both modes only the most recent round is carried, the judge grades against the declared task alone, never the feedback, and `maxLoopAttempts` bounds judged rounds with the first one included. A provider failure mid-loop is not continued. A host whose port lacks `continueAgent` fails an iterative phase and names the gap rather than running it as bounded; the daemon's port implements the seam with `sendPromptToAgent` into the settled child.

Human gates: a `gate` phase is the attended-by-default guarantee. Reaching one sets the phase `blocked` and the run `paused` and waits for a decision — Approved → phase `done`, run returns to `running`; Rejected → phase `failed`, run `canceled` (the pass stops there); Autopilot → the gate auto-approves and the run never pauses (explicit, per run). Gate decisions arrive out of band and may land before the engine starts waiting, so the service buffers a decision registered against a phase that has not blocked yet.

Caps: `maxConcurrency` (default 6 — children running at once), `maxAgents` (default 40 — hard ceiling, the run stops rather than sprawls), `maxLoopAttempts` (default 3 — judged rounds for a keep-best or iterative phase). The run settles `done` when the pass completes, `failed` on the first phase that produces nothing usable or when a cap trips, `canceled` on user cancel or a rejected gate. A judged phase that produced no passer carries a run error pointing at the judge verdicts; only a provider failure points at provider or configuration. The headline deliverable is the output of the last completed non-gate phase, relayed back by the conductor; a separate AI-written summary is generated after settling and carried as `summary` with a `summaryStatus` lifecycle.

Not built in the phase engine: per-phase retry, time limit, token or cost budget, declared output fields, conditional routing, and per-node authority — retry and time limit are graph-node capabilities. There is no token or cost ceiling on either engine, and no resume (a paused run does not survive a daemon restart — see the Orchestration durability design record). The judge inspects the candidate's prose only; it does not verify the worktree.

Invariants: a plan is validated before any agent spawns (unique ids, dependsOn references only earlier phases, iterative requires a judge); a missing role fails the run and names the gap (no fallback seat); dependsOn is a guard, not a scheduler; a dependency's output reaches its dependants through the prompt, never shared memory; a loop round receives the previous round's judge feedback, and the judge never sees that feedback as part of the task; an iterative phase never silently degrades to replacement; a candidate with no verdict counts as passing; an unparseable judge verdict is a fail, never an accidental pass; a rejected gate cancels the run, it never silently continues; every spawned child — worker or judge — counts against the run's caps.

Direction: once the graph engine gains a gate node and candidate fan-out, this engine's vocabulary survives as a preset graph template rather than a second scheduler (the runs-become-a-preset-graph decision). Until both land, this engine is as built and the fan-out/judge/keep-best shape, with its two modes, is the capability the collapse must preserve.

## Timeline

- time: "2026-08-16T13:21:07.387Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["orchestration-domain-model-and-engine-invariants","runs-become-a-preset-graph-template","orchestration-node-capabilities"]
- time: "2026-08-16T13:21:07.387Z"
  kind: "evidence"
  summary: "Ported in full from the retired archdocs page 13-orchestration-runs (reconciled to code 2026-07-25). Engine: packages/server/src/server/orchestration/run-engine.ts. No docs/ page covers the phase engine; this is the system of record for it. Where this and the code disagree, code wins."
- time: "2026-10-05T12:27:25.028Z"
  kind: "decision"
  summary: "A real run (run_muulbn4t_1ea53166, 2026-10-05) failed its first keep-best phase after three loop rounds that each received the identical task: three candidates independently hit the same ceiling and wrote near-identical incomplete reports. The engine now briefs each top-up round with the previous round's failed attempts (their report, bounded to 3,000 characters, the judge's summary, and only the unmet criteria with evidence), placed between the task and the worker framing; the judge keeps grading against the declared task alone. Also corrected the engine path, which moved to packages/server/src/server/workflow/workflow-engine.ts. Status returned to proposed for review."
  source: "packages/server/src/server/workflow/workflow-engine.ts (buildLoopFeedback, composePhaseTask); workflow-engine.test.ts \"a replacement round receives the failed a"
- time: "2026-10-05T12:47:08.580Z"
  kind: "decision"
  summary: "Added per-phase modes to the phase engine on 2026-10-05, after the RouteOS coverage run showed that replacing a failed candidate with a fresh agent discards the context the failed attempt built (45 minutes of inventory work thrown away per round). A judged phase now declares `mode: bounded` (default, replacement with feedback) or `mode: iterative` (the same chat is continued with the judge's unmet criteria until it passes or the loop cap trips). The engine port gained an optional `continueAgent` seam; the daemon implements it with sendPromptToAgent. The judged-failure run error now points at the verdicts instead of blaming provider configuration."
  source: "packages/server/src/server/workflow/workflow-engine.ts (runIterativePhase, continueCandidate, buildContinuationPrompt); packages/protocol/src/workflow.ts (RUN_P"
- time: "2026-10-05T13:10:58.364Z"
  kind: "evidence"
  summary: "Workflow phase children are spawned with `unattended: true` as of 2026-10-05. The first bounded-feedback test run in Otto Dev failed on every round for a reason unrelated to the loop: the Application Team's Claude coder profile ran in its attended `default` mode, each coder called Write on its first action and parked on a permission prompt, the engine's awaitAgent returned at the pending permission and read the half-turn (\"I'll write the file directly.\" or nothing) as the result, and the run archived the children with \"Tool permission stream closed before response received\". The spawn now carries the unattended signal so create-time coercion moves the profile to the provider's safe unattended mode and the deny-responder answers escalations; the daemon port also reports a child parked on a permission as a named failure instead of \"no output\"."
  source: "Dev run run_muv9ckzh_424fcccf (2026-10-05, dev daemon 6788); Claude session transcripts 24e18a7e and 0396e359; packages/server/src/server/agent/tools/register-o"
