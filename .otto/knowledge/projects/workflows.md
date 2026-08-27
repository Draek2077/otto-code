---
id: "workflows"
kind: "project"
title: "Workflows"
status: "confirmed"
tags: ["workflows","ai-orchestration","graph-execution","v0.9"]
delivery_status: "in_build"
progress_completed: 0
progress_total: 7
progress_unit: "0.9 delivery inventory items"
created_at: "2026-08-27T00:35:25.828Z"
updated_at: "2026-08-27T02:08:55.988Z"
---
# Workflows

<!-- compiled_truth -->

# Workflows

## Outcome

Otto ships two complementary Workflow execution models under one product surface:

- **AI Workflow:** a user configures a prompt and execution options in a basic dialog. A dedicated orchestrator agent then uses Otto MCP chat and agent tools to coordinate open-ended work. Its run view shows the orchestration actually observed; it is never drawn or described as a predeclared graph.
- **Graph Workflow:** a user selects or authors a declared Graph, validates it, supplies inputs, and executes its explicit nodes, gates, pass/fail routing, caps, and outputs.
- **Workflow visualizers:** both models expose an inspectable live and historical run visualizer. Only Graph Workflows expose the graph editor.

## End-user capability contract

### Outcome and boundary

Workflows turn a selected set of project work into an observable, controlled execution toward a
declared outcome. They are the execution layer for a project process: research, planning,
implementation, review, verification, approval, and delivery may be combined as the work needs.

Workflows do **not** replace Kanban. Kanban owns the project backlog, tracker synchronization,
and day-to-day card state. A Workflow may receive a selected work-list, issue set, or task list
as input and drive it toward completion, but it must leave the source board’s ownership and
provider semantics explicit.

### What an end user must be able to do

- Enter a project-scoped Workflow library, understand the distinction between AI and Graph
  Workflow, and choose the appropriate model.
- Configure an **AI Workflow** with a task, target project/workspace, orchestrator seat,
  execution options, caps, and approval posture. The user can start open-ended coordinated work
  without authoring a graph.
- Configure a **Graph Workflow** from a saved declared Graph, supply its declared inputs, inspect
  validation before start, create or edit the Graph only through the Graph editor, and run the
  exact declared process.
- Use a Workflow for generic project delivery patterns: work-list completion; researched
  implementation; multi-role review; plan → execute → verify; bounded repair/retry; and
  evidence-backed delivery. A particular domain such as groceries is not a product capability.
- Observe the live execution, including the orchestrator, participating agents, declared Graph
  nodes where applicable, gates, caps, outputs, skipped work, failures, and a truthful
  visualization of actual rather than inferred work.
- Approve, reject, cancel, retry or resume only where the execution model supports the action,
  then inspect the durable result, evidence, and failure/remediation after returning later.
- Reopen a durable definition or run by project and deep link. A saved Workflow may become a
  Schedule target only when it preserves the same explicit permission, run history, and recovery
  posture.

### Durable objects and lifecycle

The product ultimately owns a Workflow definition, a project-bound Workflow run, its selected
inputs/options/seat, execution record, outputs, visualizer projection, and terminal or recoverable
failure state. Graph definitions remain reusable declared Graphs; AI Workflows may preserve their
configuration and observed execution, but never pretend that a free-form plan was a Graph.
Storage ownership, retention/deletion, daemon-restart behavior, and schedule eligibility must be
documented per object.

### Truthful documentation and proof

The end-user guide must state AI versus Graph control boundaries, supported actions, authority and
provider requirements, visualizer meaning, persistence, recovery, and capability/upgrade
messages. It must identify unavailable operations rather than promising them. Completion requires
an executable proof mapped to each capability, including the principal AI and Graph success paths
and their important failure/recovery paths.

## Verified current baseline

- The daemon already owns typed `Run` records, atomic file persistence under `$OTTO_HOME/runs`, state broadcasts, cancellation, gate responses, orphan recovery, phase caps, and graph-run execution. Graph templates persist atomically under `$OTTO_HOME/orchestration-graphs`.
- `runs.start` accepts open wire strings for a `flavor`; the client sends `"ai"` or `"graph"`. The optional `server_info.features.orchestrationGraphs` capability gates Graph-specific RPCs and UI. The graph UI additionally has a client-only `isDev` restriction.
- The existing Workflows screen aggregates persistent runs, filters them, supports phase-run gate responses and cancellation, and opens a run-scoped visualizer. The first 0.9 copy slice makes its library, dialog, actions, and confirmations use the released Workflows terminology while preserving internal compatibility names.
- The current dialog already separates an AI prompt form from Graph selection/input/design. It selects a project/workspace and an orchestrator personality or model. Graph drafts are persisted and reopenable.
- A Graph Workflow validates its saved graph before spawning its orchestrator. It freezes roster, team, and prompt-template snapshots, enforces declared node authority and workspace-access support, caps spawned agents and concurrency, cascades cancellation, reports node failures/skips, and persists terminal state.
- An AI launch only spawns a detached orchestrator chat with an instruction to call `start_run`. It returns an agent id but **does not create a durable Workflow run at launch**. A run, caps, gates, cancellation, history entry, and visualizer scope therefore exist only if the model subsequently declares a phase plan. That is not sufficient for the 0.9 AI Workflow contract.
- A parameterized real-provider, in-process live-daemon harness exists at `packages/server/scripts/live-orchestration.ts`; it covers an agent-driven `start_run` flow and is explicitly isolated from the installed and development daemons. This feature has no verified live-daemon proof recorded for the current Workflows product journey.
- Unit and protocol tests exist for the engines, stores, session dispatch, and wire schemas. The existing Runs-screen E2E seeds a legacy phase run and asserts its card/visualizer; it does not prove AI Workflow launch or the Graph Workflow lifecycle.

## 0.9 delivery inventory

1. **Workflow library and entry:** make Workflows a reachable, capability-aware product section with list, filters, empty/loading/unavailable/error states, project scope, deep links, and one clear **New Workflow** entry. Preserve internal `runs` and orchestration wire names where required for compatibility.
2. **AI Workflow dialog and durable launch record:** retain the basic prompt/options dialog but create a persistent AI Workflow record before the first agent turn. Bind it to the orchestrator chat, chosen project/workspace, selected seat, requested execution options, and explicit caps/approval posture. The record must survive a daemon restart and accurately distinguish planning, active work, waiting-for-approval, terminal success, failure, and cancellation.
3. **AI orchestration safety and recovery:** the orchestrator uses Otto MCP tools only for cross-provider agent work. Centralize the cap and capability check before launch; make approval, cancellation, failure, disconnect/restart recovery, and a model that never declares a plan visible and recoverable. Do not imitate a graph or silently use a provider-native Workflow.
4. **Graph lifecycle:** expose saved Graph selection, create/edit, validation, input collection, draft persistence, execution, gate response, output inspection, cancellation, and recovery through the declared-graph capability gate. Lift the client-only development restriction only with executable proof that the complete Graph journey is safe and usable.
5. **Shared visualization and history:** both run kinds must have durable, deep-linkable history and a visualizer that says what is known. Graph runs may render declared nodes and edges. AI runs render observed agents, tool-driven phases, caps, gates, outputs, and failures without inventing a fixed plan.
6. **Provider, auth, runtime, and storage boundaries:** use daemon-owned Otto MCP tools and existing provider-neutral agent creation. A missing team role, unavailable personality/model, unsupported node workspace authority, unsupported daemon capability, or unavailable host must fail with a direct remediation. Workflow definitions and runs need an explicit, documented storage/ownership decision before schedules can target saved Workflows. No credentials or provider-native fan-out configuration travels from the UI.
7. **Proof and documentation:** add targeted unit and protocol coverage for lifecycle/compatibility, T1 entry and recovery journeys to the coverage matrix, a controlled live-daemon/T2 proof for AI spawn → declared fan-out → gate → deliver, and a deterministic Graph proof covering validation → nodes → gate/pass-or-fail → inspect/cancel/recover. Document the final user-facing terminology, capability boundary, persistence, and recovery contract.

## Adversarial review: dependencies, omissions, and non-goals

- [[agent-orchestration]] is the phase-run substrate. Its existing caps, gates, storage, engine, and MCP tool set are necessary but do not by themselves provide a user-owned AI Workflow lifecycle.
- [[graph-templates]] supplies the Graph engine, starter catalog, and the measurement work needed to judge graph value. Gate nodes, deterministic checks, runtime map fan-out, per-node isolation, broad template evaluation, and AI-authored graphs remain separate dependency work. They are not a reason to delay the basic declared-graph journey.
- [[e2e-qa-coverage]] owns the release coverage matrix and its T1/T2/T3 discipline. New proof belongs there, not in an ad hoc full-suite run.
- Saved Workflow schedule targets, broad template experimentation, AI-authored Graph generation, graph import/sharing, new provider-specific orchestration tools, and a visual graph editor for AI Workflows are explicit non-goals for this first 0.9 implementation slice.
- The current Graph capability is intentionally feature-gated and dev-only. Removing either gate without proof would publish a partially built surface, so it is not part of the first slice.

## First coherent 0.9 slice

Implemented copy boundary: the persistent-runs surface now presents **Workflows**, **New Workflow**, **AI Workflow**, and **Graph Workflow** while retaining compatibility-safe internal `runs`/orchestration protocol names. The existing Runs-screen E2E assertion was updated, but its browser execution remains unproven because the shared Playwright installer currently holds its global cache lock. This slice establishes the public product boundary without claiming that the unresolved AI durable-run lifecycle is complete.


## Verification and release evidence plan

Delivery evidence has two deliberately separate tracks. A **baseline assertion audit** tests
what Otto already claims; an **acceptance proof** earns a newly implemented Workflow capability.
Neither source inspection, a rendered card, an unrun spec, nor an orchestrator's prose is enough.

### Baseline assertion audit

Each existing claim in this charter must be classified as **Proven**, **Implemented, not yet
proven**, **Provider or host limited**, **Planned**, or **Out of scope**. Its record names the
code owner, targeted automated check, required live proof (if any), principal failure/recovery
case, documentation claim, and release verdict. The current classified gaps include the
non-durable AI launch and unproven browser/live-daemon journeys; they cannot be represented as
complete merely because the graph engine or legacy phase runs exist.

### End-user acceptance matrix

| Capability promise | Deterministic T1 proof | Controlled T2 / live-daemon proof | Failure and recovery proof |
| --- | --- | --- | --- |
| Workflow library and capability boundary | project scope, loading/empty/error/upgrade states, AI and Graph entry labels, deep link | Electron or native capture where the released route differs | old daemon and unavailable-host remediation |
| AI Workflow launch | dialog validation and immediate persistent project-bound run record, selected seat/options/caps binding, state broadcast | real orchestrator chat starts from the record and uses Otto MCP to declare/perform observed work | model never declares a plan, cancellation, disconnect/restart and terminal failure remain inspectable |
| Graph Workflow lifecycle | definition/draft/input persistence, validation, graph start, node/gate/output/cancel state transitions | deterministic graph run through declared nodes and gate pass/fail | invalid Graph, unavailable role/authority, cancellation and orphan/restart recovery |
| Shared history and visualizers | durable list/filter/deep link and correct known-state projection per run flavor | a completed AI and Graph run render their actual persisted evidence | partial work, skipped work, failed worker and lost connection are never hidden |
| Safety and compatibility | centralized caps/approval and capability gate, backward-compatible wire parsing | launch confirmation and attended gate behavior against the real daemon | cap refusal, unsupported capability, role/model/provider failure, and direct remediation |

### Documentation traceability and evidence exit

The end-user guide may promise only the behavior whose corresponding matrix row is Proven. It
must distinguish AI's observed orchestration from Graph's declared process, identify persistence
and recovery boundaries, and state authority/provider or host limitations. Before a delivery item
is marked complete, its evidence is linked from the feature charter and the
[[e2e-qa-coverage]] coverage matrix, with command, tier/environment, actual outcome, and any
native-only verdict recorded. A green happy path without its main recovery path leaves the item
partial.

## Acceptance

A user can configure and start either type, understand what is running, approve or cancel where required, inspect outputs/failures, and return to the durable definition or run. AI Workflow execution is never misrepresented as a declared graph. Workflows are not complete until their AI launch records, Graph lifecycle, visualizers, recovery paths, capability gates, and live-daemon evidence meet the inventory above.

## Timeline

- time: "2026-08-27T00:35:25.828Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["agent-orchestration","graph-templates"]
- time: "2026-08-27T00:35:25.828Z"
  kind: "evidence"
  summary: "Initial 0.9 charter created from user direction and the existing Otto implementation/Knowledge inventory on 2026-08-26. This charter is confirmed as the feature-level planning record and will be expanded with verified current-state and delivery evidence."
- time: "2026-08-27T01:46:57.239Z"
  kind: "decision"
  summary: "User requested an end-to-end 0.9 delivery inventory and adversarial source review before implementation. The revised charter separates verified baseline from gaps and identifies the missing durable AI Workflow launch record as the first product-critical omission."
  source: "Source review on 2026-08-26: packages/app/src/screens/runs-screen.tsx; packages/app/src/components/orchestration/new-orchestration-sheet.tsx; packages/app/src/h"
- time: "2026-08-27T01:51:41.262Z"
  kind: "decision"
  summary: "Implemented the first scoped Workflows terminology slice and reconciled the current baseline. Static lint and coverage-matrix checks pass; end-to-end browser proof is pending the shared Playwright installer lock."
  source: "Implemented in packages/app/src/screens/runs-screen.tsx and packages/app/src/components/orchestration/new-orchestration-sheet.tsx; terminology documented in doc"
- time: "2026-08-27T01:51:42.938Z"
  kind: "note"
  summary: "The Workflow terminology slice is implemented and statically checked, but no inventory item is marked complete: its focused browser proof is blocked by the shared Playwright installer lock, and the durable AI Workflow run lifecycle remains unbuilt."
  affects: ["workflows"]
- time: "2026-08-27T02:00:59.085Z"
  kind: "decision"
  summary: "User asked to enrich the project plan with a complete end-user definition of what Workflows can accomplish, rather than a catalog of arbitrary domain examples."
  source: "User direction, 2026-08-26; [[release-0-9-product-completion]] module-completion contract; [[agent-orchestration]] and [[graph-templates]] capability records."
- time: "2026-08-27T02:08:55.988Z"
  kind: "decision"
  summary: "User requested the Workflows charter make its existing-claim audit and final feature-acceptance proof executable and distinguish planned, implemented, and proven behavior."
  source: "User direction, 2026-08-26; [[release-0-9-product-completion]] completion contract; docs/testing.md."
  affects: ["e2e-qa-coverage","agent-orchestration","graph-templates"]
