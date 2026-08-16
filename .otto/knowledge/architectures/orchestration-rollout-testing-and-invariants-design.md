---
id: "orchestration-rollout-testing-and-invariants-design"
kind: "architecture"
title: "Orchestration rollout, testing and invariants (design)"
status: "proposed"
tags:
  ["orchestration", "rollout", "testing", "golden-graphs", "feature-gating", "archdocs-retirement"]
created_at: "2026-08-16T13:29:27.102Z"
updated_at: "2026-08-16T13:29:27.102Z"
---

# Orchestration rollout, testing and invariants (design)

<!-- compiled_truth -->

The consolidated per-page invariants for the whole orchestration system are gathered in the orchestration-domain-model record; this record is the build order, feature gating, golden graphs, test tiers, and the audit checklist.

Build order: the live, agreed order is the dependency list in the graph-templates charter — durability boot path → per-node accounting → gate + ports → check → run values → turn limit → map → isolation — then the golden-graph harness. Of the correctness holes the 2026-07-25 full-set review found, the cancel cascade and the seat/template snapshots are fixed (same day, engine-tested); the deterministic-node-needs-preview widening is settled with the gate step. The design-era stages, with what has since shipped: stage 0 (structural) — the third node result state shipped as `skipped` + `skipReason`; ports reserved in the schema, unused, land with the gate. Stage 1 (make it real) — structured output ✅ (fields + `submit_output` + prose recovery); tool groups, query tools, workspace access ✅; check, gate, brief, isolation ◻. Stage 2 (make it powerful) — conditional edges ✅ (JSONata on the edge; router-as-node not needed for two-way branches); map, merge policy, subgraph ◻. Stage 3 (make it trustworthy) — run budget with a hard stop, per-node failure policy, checkpoint restore + agent adoption, the per-node record ◻ (all). The per-node record is a precondition of the template initiative, not a stage-3 nicety. Deliberately out of scope: reducers with declared merge semantics, time-travel/fork from a checkpoint, deterministic replay with saga compensation — real primitives in LangGraph and Temporal, problems we do not have at this scale.

Feature gating, two gates one check each: dev-only for now — while the designer is under construction every door in (the New Orchestration button, the designer tab, running a graph) additionally requires a dev build (`isDev`, Metro's `__DEV__`, dead-code-stripped from production); release builds keep the Orchestrations page exactly as it was. Capability-gated after — `server_info.features.orchestrationGraphs`, detected in exactly one place client-side, with a `COMPAT(orchestrationGraphs)` marker naming the version and the cleanup condition; no fallback paths. Daemon ships before client, always — the capability flag exists so a new client can detect an old host, not the reverse.

Golden graphs — the four shapes that pass the cost test, each shipped as a starter and asserted end to end, doubling as the acceptance criteria for the stages: directed research (brief → N researchers on declared disjoint angles, read-only parallel → synthesis → verification against sources) proves fan-out, barrier fan-in, deliverable extraction; researched implementation (research → plan artifact → gate → implement isolated → check → review by a different seat → loop until the check passes) proves gates, artifacts, isolation, ground-truth verification, loop-until-pass; feature breakout (plan emits a list → map one implementer per item → each self-checks → integration → verify) proves dynamic fan-out, per-instance isolation, ordered collection; adversarial evaluation (same task N ways in parallel → judge panel → keep best) proves best-of-N, judging, merge policy.

Test tiers: engine unit (vitest, fake port) — the whole graph engine with no daemon: barriers, skip propagation, loop bounds, failure cascade, cancellation, budget trips; deterministic schedules, no timing, no randomness. Protocol — schema round-trips, old-client parse of a graph run, unknown-vocabulary tolerance. Durability — kill and restart mid-run; a resumed run must not re-spawn a completed node's agent, must adopt a still-running one, and must never mark a paused run failed — the tier that catches the expensive class of bug. App — designer interactions, draft survival across navigation, validation feedback, gate approval UI. E2E, three tiers — mock provider (structure), local AI via LM Studio (real models, no cost), real provider (the honest end-to-end), per the e2e-qa-coverage project. The house rule stands: never run a full suite locally — run the file you changed, push to CI for breadth.

Migration: there is nothing to migrate to, by design. Every schema change is additive with absent-means-today semantics, so existing graphs keep working untouched. A stored graph whose edges carry no ports runs exactly as it does today; a stored graph referencing a port that no longer exists opens with that connection dropped rather than refusing to open. Built-in starters are re-seeded only when absent, so a user's edits are never overwritten; changing a starter's shape means users who already have it keep the old one until they delete it.

Open questions: should a graph's drawn topology override the Visualizer's force layout for orchestration runs? Where does a gate's timeout belong — per gate, per run, or a host default — and what is the correct behaviour when a gate is reached during an unattended scheduled run (docs/safe-unattended.md)? Do subgraphs need a cycle check on graph references (Rivet has none, and a self-including graph is a trivially reachable footgun)? May an edge condition read run values, once run values exist?

## Timeline

- time: "2026-08-16T13:29:27.102Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["graph-templates","orchestration-domain-model-and-engine-invariants","orchestration-per-node-accounting-is-a-precondition","e2e-qa-coverage"]
- time: "2026-08-16T13:29:27.102Z"
  kind: "evidence"
  summary: "Ported from the retired archdocs page 19-orchestration-rollout. Status proposed: the stage-2/3 items (gate, check, map, merge, subgraph, run budget, per-node failure policy, checkpoint restore) are not built. The live build order and the per-node-record precondition live in the graph-templates charter. Where the shipped items and the code disagree, code wins."
