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
updated_at: "2026-09-02T14:08:29.279Z"
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

### Independent Workflow storage contract (0.9)

**Workflow storage is a category-owned choice.** It shares a daemon-owned category-storage resolver and settings pattern with Knowledge, Artifacts, and Schedules, but it never reads, inherits, or changes any other category's selected location.

- **Host Settings** supplies the independent default, initially **Repository**, under **Workflows storage**.
- **Project Settings** supplies the independent Workflow override: **Use host default**, **Repository**, or **Host-local**. The explicit project choice always wins over the Workflow host default.
- Repository storage is project-scoped at `<projectRoot>/.otto/workflows/`: `definitions/` for saved AI Workflow configurations and declared Graph documents, `templates/` for reusable Workflow prompt templates, and `runs/` for durable run records and immutable launch snapshots.
- Host-local storage is project-scoped on the selected daemon host at `$OTTO_HOME/project-workflows/<stable-project-key>/` with the same `definitions/`, `templates/`, and `runs/` layout. The stable project key and resolved project root are distinct identifiers; worktrees resolve to their main project root before a repository store is selected.
- A host-local record is durable only on that selected daemon host for that project. It is neither a user-global bucket nor implied synchronization to another host. The library, run visualizer, CLI, and Project Settings disclose **Repository** or **Host-local · <host name>**. A disconnected remote host reports its own unavailable store with a reconnect or explicit transfer action; it never falls back to a different host or pretends the data synchronized.
- Each new durable definition, template, and run records its project identity, resolved store location, store key, originating host identity where applicable, schema/version, and source provenance. A run additionally freezes the exact definition/template snapshot used for execution. CLI and MCP address records by stable id and project scope, never by a daemon-private absolute path.

Changing a host default or project override changes only the destination selected for subsequent creates. It never silently moves, deletes, or hides existing records. Discovery aggregates the registered locations for the same project and labels each record's source. Existing global records remain discoverable as **legacy host library**: persisted runs are associated by their stored project/workspace identity where available; unscoped legacy Graphs and templates remain visible only on their owning daemon until a user explicitly assigns, copies, or moves them into a project store. Otto must not invent project ownership for those records.

A copy or move is an explicit daemon-owned operation with source and destination disclosure, confirmation, atomic destination write, content/schema/hash verification, and a durable migration receipt containing the source, destination, actor, timestamp, record mapping, and result. A move retains recoverable source material until verification and its stated recovery window complete; a failed or interrupted transfer leaves the source discoverable and reports an actionable recovery state. Corrupt, inaccessible, or colliding files preserve the last valid record and surface a repair/export/retry action. A workflow cannot report a durable start until its run snapshot write succeeds.

The first capability gate is the shared additive `server_info.features.categoryStorageResolver` capability, with Workflow listed among its supported categories. An older daemon continues its legacy paths and the client offers no storage-setting fallback; a newer client against that daemon says **Update the host to manage Workflow storage**. Wire additions remain optional and compatibility-safe. The 0.9 resolver must centralize configuration, project descriptors, metadata, migration receipts, and unavailable-state handling so no Workflow code reimplements a category-specific policy.

### Truthful documentation and proof

The end-user guide must state AI versus Graph control boundaries, supported actions, authority and
provider requirements, visualizer meaning, persistence, recovery, and capability/upgrade
messages. It must identify unavailable operations rather than promising them. Completion requires
an executable proof mapped to each capability, including the principal AI and Graph success paths
and their important failure/recovery paths.

## Verified current baseline

- The daemon still retains its typed `Run` records, atomic `$OTTO_HOME/runs` persistence, daemon-global Graph/template libraries, state broadcasts, cancellation, gate responses, orphan recovery, phase caps, and graph-run engine as legacy paths. The first project-owned storage foundation now exists: `CategoryStorageResolver` and `WorkflowStoreRegistry` resolve an independent Workflow repository/host location, project-scoped layout, provenance, worktree root, and legacy discovery. Confirmed Graph import writes a verified copy to the selected `definitions/` directory. The host/project settings UI, project-scoped run/template writers, aggregation, explicit move receipts, and remote-host disclosure remain unimplemented.
- `workflows.start` is the canonical Workflow-launch RPC and accepts open wire strings for a `flavor`; a client selects it when the additive `server_info.features.workflowStartRpc` capability is present. The dated `runs.start` request/response pair remains accepted only for separately shipped older peers through 2027-02-28. The optional `server_info.features.orchestrationGraphs` capability gates Graph-specific RPCs and UI, including the released New Workflow entry.
- The canonical source model is `Workflow` and `WorkflowService`, and callers launch through `startWorkflow`. Legacy `Run` aliases, `RunStore`/`RunPhase` internals, persisted `runId` fields, and the `runs.start` wire pair are migration seams, not the product vocabulary; they remain only where source or peer compatibility still requires them.
- The existing Workflows screen aggregates persistent runs, filters them, supports phase-run gate responses and cancellation, and opens a run-scoped visualizer. The first 0.9 copy slice makes its library, dialog, actions, and confirmations use the released Workflows terminology while preserving internal compatibility names.
- The current dialog already separates an AI prompt form from Graph selection/input/design. It selects a project/workspace and an orchestrator personality or model. Graph drafts are persisted and reopenable.
- A Graph Workflow validates its saved graph before spawning its orchestrator. It freezes roster, team, and prompt-template snapshots, enforces declared node authority and workspace-access support, caps spawned agents and concurrency, cascades cancellation, reports node failures/skips, and persists terminal state.
- An AI launch now creates and persists a project-bound `kind: "ai"` Workflow record before its detached orchestrator chat receives a first turn. The root chat carries that durable run id and, when it calls `start_workflow`, activates the same record rather than minting a second run. The planning record records its title, description, workspace, active team, and bound conductor; it is canceled with that conductor, fails if planning ends without a declared phase plan, and is failed by ordinary daemon-restart recovery if still pending. The library presents this state as **Planning** and **AI Workflow**, rather than an empty phase plan. Focused browser proof covers the durable planning record, mock no-plan failure, cancellation, restart failure recovery, and generated-run visualization. A controlled isolated live-daemon proof now verifies a real Claude Sonnet 5 low-effort conductor declaring and completing one `fanOut: 2` phase through two managed workers. Provider failure, attended AI gates, and a normal external-daemon client journey remain unproven.
- The parameterized real-provider, in-process live-daemon harness at `packages/server/scripts/live-orchestration.ts` is explicitly isolated from the installed and development daemons. Its opt-in `--bootstrap-sonnet` fixture seeds a temporary Claude Sonnet 5 low-effort conductor and researcher team in the copied home. On 2026-08-29 it produced durable run `run_mteqm9v7_1c6a9cc6`: the conductor declared a single research phase with `fanOut: 2`, both managed candidates returned `WORKFLOW FAN-OUT CONFIRMED.`, and the run reached `done` with `agentCount: 2`. This proves actual daemon-owned AI declaration and fan-out, not an attended AI gate, provider failure recovery, or an installed/external daemon journey.
- Unit and protocol tests exist for the engines, stores, session dispatch, and wire schemas. The focused Runs-screen browser E2E now seeds a persisted Graph Workflow record with agent, gate, and check history, restarts its isolated daemon, asserts the project/workspace rehydrates, renders the Graph card, and opens its run-scoped Visualizer. It proves persisted-history rendering and restart rehydration. A separate focused Chromium browser E2E now proves the narrow Graph authoring entry: from the Workflows library, a user selects a project, creates a Graph draft, resolves that host project's real workspace, and arrives in the Graph designer. It now proves the minimal Graph author → launch → deterministic worker completion path with an explicit mock-model override; an attended Graph approval gate that persists `paused` with zero spawned agents and either resumes to completion on approval or cancels durably on rejection; and deterministic Checks that complete on `true` or fail durably on `false`, each with zero spawned agents. It does not yet prove invalid-Graph validation, Check pass continuation into a downstream node or output routing, or AI Workflow browser launch and recovery. User cancellation, restart failure recovery, and generated-run Visualizer opening are now covered by focused Graph browser proof.

## 0.9 delivery inventory

1. **Workflow library and entry:** make Workflows a reachable, capability-aware product section with list, filters, empty/loading/unavailable/error states, project scope, deep links, and one clear **New Workflow** entry. Preserve only tagged legacy wire pairs where compatibility requires them; the current source API uses Workflow terminology.
2. **AI Workflow dialog and durable launch record:** retain the basic prompt/options dialog but create a persistent AI Workflow record before the first agent turn. Bind it to the orchestrator chat, chosen project/workspace, selected seat, requested execution options, and explicit caps/approval posture. The record must survive a daemon restart and accurately distinguish planning, active work, waiting-for-approval, terminal success, failure, and cancellation.
3. **AI orchestration safety and recovery:** the orchestrator uses Otto MCP tools only for cross-provider agent work. Centralize the cap and capability check before launch; make approval, cancellation, failure, disconnect/restart recovery, and a model that never declares a plan visible and recoverable. Do not imitate a graph or silently use a provider-native Workflow.
4. **Graph lifecycle:** expose saved Graph selection, create/edit, validation, input collection, draft persistence, execution, gate response, output inspection, cancellation, and recovery through the declared-graph capability gate. The released entry remains available only when the selected host advertises that capability, and requires executable proof that the complete Graph journey is safe and usable.
5. **Shared visualization and history:** both run kinds must have durable, deep-linkable history and a visualizer that says what is known. Graph runs may render declared nodes and edges. AI runs render observed agents, tool-driven phases, caps, gates, outputs, and failures without inventing a fixed plan.
6. **Provider, auth, runtime, and storage boundaries:** use daemon-owned Otto MCP tools and existing provider-neutral agent creation. A missing team role, unavailable personality/model, unsupported node workspace authority, unsupported daemon capability, unavailable storage host, or unavailable host must fail with a direct remediation. Implement the independent Workflow storage contract above, including project metadata, remote-host disclosure, explicit transfer/recovery, and a shared category-storage capability gate, before schedules can target saved Workflows. No credentials or provider-native fan-out configuration travels from the UI.
7. **Proof and documentation:** maintain targeted unit and protocol coverage for lifecycle/compatibility and T1 entry/recovery journeys in the coverage matrix; retain the passed controlled live-daemon proof for AI declaration → fan-out; add an attended AI gate and deliver proof; and continue the deterministic Graph proof through validation → nodes → gate/pass-or-fail → inspect/cancel/recover. Document the final user-facing terminology, capability boundary, persistence, and recovery contract.

## Adversarial review: dependencies, omissions, and non-goals

- [[agent-orchestration]] is the phase-run substrate. Its existing caps, gates, storage, engine, and MCP tool set are necessary but do not by themselves provide a user-owned AI Workflow lifecycle.
- [[graph-templates]] supplies the Graph engine, starter catalog, and the measurement work needed to judge graph value. Gate nodes, deterministic checks, runtime map fan-out, per-node isolation, broad template evaluation, and AI-authored graphs remain separate dependency work. They are not a reason to delay the basic declared-graph journey.
- The shared category-storage settings/resolver platform is a required dependency. It must generalize the useful resolver, project-setting, metadata, migration, and capability patterns without inheriting the Knowledge policy or coupling Artifacts, Schedules, and Workflows. [[artifacts]], [[schedules]], and [[project-knowledge-context-management]] are affected modules, but their location choices remain independent.
- [[e2e-qa-coverage]] owns the release coverage matrix and its T1/T2/T3 discipline. New proof belongs there, not in an ad hoc full-suite run.
- Broad template experimentation, AI-authored Graph generation, new provider-specific orchestration tools, and a visual graph editor for AI Workflows remain explicit non-goals for this first 0.9 implementation slice. Graph import/sharing and a narrow saved **Graph** Workflow Schedule target are now implemented foundations; saved AI Workflow schedules, schedule re-targeting, and full storage migration/aggregation remain out of scope.
- The current Graph capability is intentionally feature-gated. Removing the host-capability gate without proof would publish a partially built surface, so it is not part of the first slice.

## First coherent 0.9 slice

Implemented copy and persisted-history proof boundary: the persistent-runs surface now presents **Workflows**, **New Workflow**, **AI Workflow**, and **Graph Workflow**. The canonical source API is `Workflow`, `WorkflowService`, `startWorkflow`, and `workflows.start`; only the tagged legacy `runs.start` wire pair remains for peer compatibility. The focused Runs-screen E2E passed through the documented installed-Edge channel: it seeds a persisted Graph Workflow, verifies its project/workspace survives daemon restart, validates its Graph agent/gate/check history, and opens its scoped Visualizer. The test uses a host-owned seed project because a client-owned seed correctly removes its project when its socket closes. This slice establishes the public product boundary, persisted-Graph history proof, and one deterministic browser Graph authoring/launch/completion proof without claiming the then-unresolved AI durable-run lifecycle, Graph rejection/cancellation/recovery, or real-provider execution was complete. Subsequent focused proof closed the listed AI and Graph browser lifecycle boundaries, and the controlled real-provider fan-out proof is recorded above.


## Verification and release evidence plan

Delivery evidence has two deliberately separate tracks. A **baseline assertion audit** tests
what Otto already claims; an **acceptance proof** earns a newly implemented Workflow capability.
Neither source inspection, a rendered card, an unrun spec, nor an orchestrator's prose is enough.

### Baseline assertion audit

Each existing claim in this charter must be classified as **Proven**, **Implemented, not yet
proven**, **Provider or host limited**, **Planned**, or **Out of scope**. Its record names the
code owner, targeted automated check, required live proof (if any), principal failure/recovery
case, documentation claim, and release verdict. The current classified gaps include the
incomplete AI declaration/provider recovery and unproven browser/live-daemon journeys; they cannot be represented as
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

## Graph-designer capability-to-product audit — 2026-08-28

This audit traced the five intended Graph journeys through the current editor, protocol, daemon, persistence, visualizer, and available automated-test seams. It is a source-backed baseline, not a claim of release readiness.

### Verified trace

| Journey | Verified implementation | Verdict and product gap |
| --- | --- | --- |
| Create and edit a Graph | The web/Electron Drawflow designer creates agent nodes; edits role, prompt, model override, autonomous flag, loop, workspace access, output fields, retry, time limit, Otto-tool narrowing, query tools, and prompt-template binding. Its wire inspector edits JSONata condition and carried fields. | **Implemented, not proven.** The editor supports an Orchestrator root, agent nodes, attended approval Gates, and deterministic Check nodes. The current Check form proves only pass-continuation; pass/fail output-port routing remains unbuilt, so the full branch contract is not yet met. |
| Save and revisit authoring work | GraphStore persists saved Graphs on the daemon; the designer saves them and preserves unedited wire/node fields on a round trip. It holds unsaved canvas edits in an in-memory, session-scoped draft. | **Partial.** A saved Graph is durable, but unsaved authoring work is lost when the app process ends. Versioning, reviewable revision history, conflict handling, and a clear definition-to-project Workflow relationship remain undefined. |
| Validate and launch | The designer saves before launch, runs structural validation, then returns to the Workflow dialog for required Graph inputs, project/workspace and Orchestrator seat. The daemon validates again, freezes the Graph/cast/template snapshot, creates a Graph run, and executes it. | **Implemented, not proven.** Validation feedback is currently a toast with a count and first issue, not an actionable per-node/per-edge review surface. The Graph entry path is gated by the server capability. |
| Inspect, cancel, and recover execution | Runs persist; Graph execution carries node state, structured output fields, conditions/skips, caps, cancellation, and a run-scoped visualizer path. Daemon boot marks any in-flight run failed with a restart explanation. | **Partial.** The current behavior is terminal restart recovery, not safe continuation. There is no verified Graph UI journey covering gate/pass/fail, cancellation, restart, and evidence inspection. |
| Reuse prompt material | The daemon owns persistent prompt-template/snippet records, two starter records, EJS rendering, variable bindings, snapshot-at-run-start behavior, and renderer unit tests. The designer can select and bind an existing template. | **Implemented but not product-authored.** There is no app UI for creating, editing, previewing, validating, deleting, organizing, or versioning prompt templates/snippets, even though client RPCs exist. Raw EJS remains trusted host-local code, not a share/import-ready user format. |

The existing browser E2E spec proves only that a manually seeded legacy phase run appears in Workflows and opens a Visualizer. It does not cover Graph creation, validation, launch, execution, template binding, gates, failure, or recovery. Engine, renderer, store, session, and graph-document tests exist, but no completed Graph end-user proof is recorded.

### Required remediation order

1. **Finish the shared Workflow lifecycle first:** an AI launch must create a durable Workflow run before its first agent turn; define the project-bound definition → immutable run snapshot model that Graph launches will share.
2. **Make one Graph execution contract whole:** add explicit Gate and deterministic Check semantics, their declared authority and pass/fail data, then ship one narrow Plan → Execute → Verify → Gate → Deliver Graph as the release probe.
3. **Turn the designer into an authoring product:** show validation at its responsible node or wire; make save/draft/conflict/revision behavior intentional; expose a capability-aware Graph library and direct remediation instead of a development-only dead end.
4. **Define prompt-template authoring separately:** ship a normal structured prompt and variable experience first. EJS may remain an advanced local-only renderer only with preview, syntax errors, explicit trust disclosure, and no import/share route until a safe trust model exists.
5. **Prove before unlocking:** add T1 Graph author/edit/save/validate/run/visualizer/recovery coverage and controlled T2/live-daemon proof for the starter Graph. Lift the dev gate only after those journeys pass on the published capability/provider matrix.
6. **Measure Graph value before expanding the library:** add per-node accounting, deterministic checks where possible, and the [[graph-templates]] local-AI comparison harness. Broad starter catalogs, dynamic map fan-out, per-node turn limits, worktree isolation, graph sharing/import, and AI-authored Graphs remain later work, not a shortcut around this probe.

This audit makes the immediate design target unambiguous: one complete AI Workflow, one complete declared Graph Workflow, and one safe prompt-material path. The editor is a component of that target, not a justification for claiming the target is complete.

## Storage proof requirements

No Workflow storage design or test row is complete yet. The shared platform and Workflow adapter must prove the following before delivery progress moves:

| Proof layer | Required assertion |
| --- | --- |
| Focused resolver/service/protocol | Workflow project override wins over its Workflow host default; the Repository default resolves only that category; repository and host paths are project-scoped and worktree-safe; two projects and two hosts cannot read each other's records; all wire fields/capabilities remain optional for old peers. |
| Legacy and migration | Existing `$OTTO_HOME/runs`, `orchestration-graphs`, and `prompt-templates` records stay discoverable; scoped legacy runs map only from stored evidence; unscoped legacy definitions require explicit assignment; changing either setting does not move or delete; copy/move verifies content, writes an auditable receipt, and is recoverable after interruption. |
| Failure and remote-host recovery | Full disk/write error prevents a false durable start; malformed/colliding input preserves the last valid record; offline selected host shows location and remediation without cross-host fallback; disconnect/restart leaves run recovery state and storage provenance inspectable. |
| T1 UI / CLI | Host Settings and Project Settings show independent Workflow choices and effective resolution; library/history/visualizer disclose record location and host; CLI/MCP and UI reopen the same project-scoped definition/run; explicit migration confirmation, failure, and legacy assignment paths are exercised. |
| T2 / controlled live daemon | A Graph and AI Workflow each create, reopen, and inspect a run on both repository and selected host-local stores, then prove the declared remote-host unavailable path. These tests complement, not replace, the AI/Graph execution proof already required by this charter. |

## CLI and automation parity

Workflows are a daemon-owned product capability, not a UI-only feature. The Otto CLI and Otto MCP
tools must operate the same Workflow definitions and durable runs as the graphical product surface;
they must not grow a second scheduler, storage format, or provider-specific execution path.

The CLI is the primary fast functional-validation surface while the graphical UI is tested on its
own terms. It must support discovering and inspecting Graph definitions and run history, validating
and starting a Graph with declared inputs, starting an AI Workflow with its prompt/options/caps and
receiving a durable run identifier before the first turn, following live progress, inspecting
outputs and failures, responding to supported gates, cancelling, and invoking retry or resume only
when the daemon advertises that action for the run. Graph authoring may use a reviewable structured
file or structured command input; it need not replicate the visual editor in a terminal.

This parity is an acceptance requirement, not an excuse to skip graphical E2E coverage. CLI tests
prove the daemon contract, persistence, state transitions, capability gating, and recovery cheaply
and deterministically. UI-focused tests separately prove navigation, forms, accessibility, visualizer
rendering, and browser/native integration against that shared contract.

### Graph document and CLI input contract

The Graph editor is the primary human authoring and review surface. Its saved definition is the
canonical structured Graph document, and CLI or MCP commands consume that same document shape;
they do not translate a terminal-only workflow language into a different execution model.

**Verified current storage:** `GraphStore` validates an `OrchestrationGraph` and atomically writes
one JSON document per Graph at `$OTTO_HOME/orchestration-graphs/{graphId}.json`. The graphical
client saves and loads those documents through daemon RPC. The headless CLI uses the same daemon
records through `otto workflow graph ls`, `inspect <id> --json`, and `run <id>`; it validates
declared inputs, resolves an existing workspace, and never creates one as a side effect.
`workflow graph validate <file>` validates a local JSON document without saving or executing it.
The current host-private legacy path is an implementation detail, not the CLI contract. Under the 0.9 storage contract the same commands operate the resolved project store and expose its repository/host ownership descriptor without requiring a daemon-private absolute path; legacy discovery and any import, copy, or move remain explicit.

The remaining CLI contract must add caller-supplied JSON through an explicit document option or
`--file <path>`, with a separate explicit save/import operation. A file-based run must validate
and freeze that exact document into the durable Run snapshot without silently mutating the user's
file or saved library. File import and `run --file` remain deliberately unbuilt: Graph query tools
and EJS templates make an imported Graph executable local authority, so they require an explicit
trust boundary first. Declared Graph inputs are supplied as structured values or repeated named
parameters, never spliced into a second prompt format.

The editor and CLI must round-trip the same complete document, including fields the editor cannot
yet expose, so neither surface destroys conditions, output contracts, future control nodes, or
template bindings. Human review remains available by opening a saved/imported document in the
editor before execution.

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
- time: "2026-08-28T13:34:41.934Z"
  kind: "decision"
  summary: "User requested a source-backed capability-to-product audit of the Graph editor to identify exactly what must be enhanced or fixed before real Workflows can be designed and executed. Status returned to proposed for review."
  source: "Source audit on 2026-08-28: packages/app/src/orchestration-graph/{orchestration-graph-panel.web.tsx,graph-canvas.ts,graph-draft-store.ts}; packages/app/src/comp"
  affects: ["graph-templates","e2e-qa-coverage","agent-orchestration"]
- time: "2026-08-28T23:09:26.097Z"
  kind: "evidence"
  summary: "Wave 1 Graph kernel evidence: added the built-in `Brief → Decision` Graph. It accepts one required `question`, runs a `researcher` worker that emits a structured `brief`, hands that field to a `writer` worker, and persists the terminal Graph run. A deterministic in-process daemon integration test uses real fake-backed child sessions and verifies launch persistence, both completed nodes, structured-output recovery, downstream task hand-off, completion notification, and persisted `done` status. This is evidence for the narrow daemon execution kernel only; it does not prove the production UI lifecycle, user-run real-provider journey, gate/pass-fail behavior, cancellation/restart recovery, AI Workflow durability, or the dev-gate removal.\n\nManual validation card, not yet executed:\n1. In a development host advertising `orchestrationGraphs`, open Workflows and choose New Workflow → Graph Workflow.\n2. Select `Brief → Decision`, enter a project-relevant question, choose an Orchestrator and an active team with `researcher` and `writer` seats, then start it.\n3. In the live visualizer, verify Research brief starts before Decision; after completion, verify both nodes are done and the Decision acknowledges the research output.\n4. Reopen Workflows and the completed run; verify its node history and terminal result remain visible.\n\nA manual result is required before calling this product path proven."
  source: "Verified locally on 2026-08-28: packages/server/src/server/orchestration/starter-graphs.ts and packages/server/src/server/orchestration/run-orchestration.integr"
  affects: ["graph-templates","e2e-qa-coverage"]
- time: "2026-08-28T23:26:00.534Z"
  kind: "note"
  summary: "The owner explicitly authorized confirmation after reviewing the source-backed charter, its 0.9 inventory, audit, and verified Wave 1 evidence on 2026-08-28. New status: confirmed."
- time: "2026-08-28T23:29:41.502Z"
  kind: "decision"
  summary: "The owner explicitly established that Workflows must remain fully capable through the CLI and that CLI-driven daemon validation complements, rather than replaces, UI-specific E2E proof. Status returned to proposed for review."
  source: "User direction, 2026-08-28."
  affects: ["agent-orchestration","e2e-qa-coverage"]
- time: "2026-08-28T23:29:58.586Z"
  kind: "note"
  summary: "The owner explicitly confirmed the revised, source-backed Workflows charter, including CLI parity as a first-class acceptance and validation requirement, on 2026-08-28. New status: confirmed."
- time: "2026-08-28T23:33:25.547Z"
  kind: "decision"
  summary: "The owner clarified that the editor must remain the human-reviewable authoring surface while CLI/MCP commands consume the same Graph JSON document by saved identifier or explicit file/document input. Source review verified the existing daemon-owned JSON store and absence of a Workflow CLI/import-export surface. Status returned to proposed for review."
  source: "User direction and source review, 2026-08-28: packages/server/src/server/orchestration/graph-store.ts; packages/server/src/server/session/runs/runs-session.ts; "
  affects: ["graph-templates","agent-orchestration","e2e-qa-coverage"]
- time: "2026-08-28T23:33:30.113Z"
  kind: "note"
  summary: "The owner explicitly confirmed the revised Workflows charter after clarifying its reviewed editor-to-CLI document contract on 2026-08-28. New status: confirmed."
- time: "2026-08-28T23:40:57.223Z"
  kind: "evidence"
  summary: "Execution-validation Layer 1: reused Otto's existing zero-cost FakeAgentClient rather than creating another mock provider. It now has an opt-in exact-response callback for tests. The Brief → Decision Graph proof supplies an ordered Workflow cast script: each fake worker verifies the fully assembled task fragments it receives before returning its exact JSON output, and the test fails if any scripted worker is skipped or invoked out of order. This proves deterministic worker task/output hand-off through the in-process daemon; it does not yet simulate tool calls, intentional agent failure, delay/timeout, control nodes, CLI dispatch, browser UI, or a live model."
  source: "Verified locally on 2026-08-28: packages/server/src/server/test-utils/fake-agent-client.ts; packages/server/src/server/orchestration/run-orchestration.integrati"
  affects: ["e2e-qa-coverage","agent-orchestration"]
- time: "2026-08-28T23:50:58.136Z"
  kind: "evidence"
  summary: "Execution-validation Layer 2: the existing FakeAgentClient's Workflow scenario seam now models either an exact assistant message or an explicit failed turn. A real in-process daemon Graph proof scripts a research worker failure, verifies bounded retry state (two worker candidates and retryAttempts = 1), then verifies that only the recovered structured brief reaches the downstream decision worker and that the terminal run persists as done. This proves the current Graph retry contract with zero model cost. It does not yet prove timeout/cancel timing, control nodes, CLI dispatch, browser UI, or live-model behavior."
  source: "Verified locally on 2026-08-28: packages/server/src/server/test-utils/fake-agent-client.ts; packages/server/src/server/orchestration/run-orchestration.integrati"
  affects: ["e2e-qa-coverage","agent-orchestration"]
- time: "2026-08-29T12:31:14.136Z"
  kind: "evidence"
  summary: "Execution-validation Layer 3: the deterministic FakeAgentClient scenario can now hold a streamed worker until Otto interrupts it. A real in-process daemon Graph proof starts a held researcher, waits until its child session is genuinely running, cancels the durable run, verifies the child session reaches idle, verifies no downstream worker spawns, and verifies the terminal run persists as canceled. The current node projection is recorded separately in [[finding-2026-08-29-canceled-graph-worker-phase-status]]. This proves cancel cascade for this Graph kernel; it does not yet prove node timeout, control nodes, CLI dispatch, browser UI, or live-model behavior."
  source: "Verified locally on 2026-08-29: packages/server/src/server/test-utils/fake-agent-client.ts; packages/server/src/server/orchestration/run-orchestration.integrati"
  affects: ["graph-templates","e2e-qa-coverage","agent-orchestration"]
- time: "2026-08-29T12:33:32.576Z"
  kind: "evidence"
  summary: "Execution-validation Layer 4: focused daemon integration proof uses the deterministic FakeAgentClient cast to hold the `brief` Graph worker beyond its one-second node limit. The actual daemon child session is canceled and reaches `idle`; the durable run is `failed`, the active `brief` phase is `failed` with `timedOut: true`, and dependent `decision` is `skipped` with `skipReason: \"upstream-failed\"`. Targeted four-case workflow integration selection passed (4 passed); targeted lint and server typecheck passed."
  source: "packages/server/src/server/orchestration/run-orchestration.integration.test.ts"
- time: "2026-08-29T12:36:10.472Z"
  kind: "evidence"
  summary: "Execution-validation Layer 5: focused daemon integration proof runs the bundled Triage Graph with an exact fake classifier result `{complexity:\"simple\", rationale:\"The edit is isolated.\"}`. The actual graph condition selects Quick, persists Deep as `skipped` with `skipReason: \"condition\"`, carries the selected worker result into the Review child, and reaches durable `done`. Targeted five-case workflow integration selection passed (5 passed); targeted lint and server typecheck passed."
  source: "packages/server/src/server/orchestration/run-orchestration.integration.test.ts"
- time: "2026-08-29T12:38:02.828Z"
  kind: "evidence"
  summary: "Execution-validation Layer 6: focused daemon integration proof runs the bundled Research → Plan → Build → Verify Graph using deterministic fake workers. Its first judge returns a structured fail with `Need stronger proof.`; the next Build child receives that exact feedback, the second judge returns pass, and the durable Build phase records four candidates (worker/judge × 2) with fail/pass verdicts plus `Passed judge on iteration 2 of 3.` Targeted six-case workflow integration selection passed (6 passed); targeted lint and server typecheck passed."
  source: "packages/server/src/server/orchestration/run-orchestration.integration.test.ts"
- time: "2026-08-29T12:40:50.568Z"
  kind: "evidence"
  summary: "Execution-validation Layer 7: an isolated focused daemon integration proof binds an EJS `promptTemplate` to the Brief node and renders it via the production renderer/variable resolver with an in-memory host-template snapshot. It proves `$inputs.question` interpolation and `include('workflow-research-rules')` become the exact real child task, then validates the structured Brief → Decision handoff and durable done run. The isolated EJS case passed; targeted lint and server typecheck passed. This proves template execution, not end-user template-authoring UI."
  source: "packages/server/src/server/orchestration/run-orchestration.integration.test.ts"
- time: "2026-08-29T12:42:17.515Z"
  kind: "evidence"
  summary: "Execution-validation Layer 8: isolated focused daemon integration proof gives a Graph run `maxAgents: 1`. The Brief worker completes through a real fake-backed child session; the Decision node is blocked before spawning, the durable run fails with `Agent cap reached (1)`, `agentCount` remains 1, and the Decision phase is failed. Targeted cap case passed; targeted lint and server typecheck passed. Graph human-approval gates remain a separate unimplemented gap."
  source: "packages/server/src/server/orchestration/run-orchestration.integration.test.ts"
- time: "2026-08-29T12:57:02.138Z"
  kind: "evidence"
  summary: "Graph Gate delivery slice: Graph documents now support `kind: \"gate\"`; the Graph editor exposes Add approval gate with a title and review prompt. The daemon projects it as the existing `RunPhase.type: \"gate\"`, pauses the durable run without spawning a provider child or charging the agent cap, and uses the existing Runs Approve/Reject controls. Approval releases downstream Graph work; rejection marks the gate failed, cancels the run, and skips dependent nodes. Focused tests passed: graph-engine approval/rejection behavior and a real fake-backed daemon child run that paused, persisted blocked gate state, accepted approval, and then spawned/completed downstream work. Targeted lint plus server and app typecheck passed. This is not browser UI E2E or live external-daemon proof; rejected-output branching is explicitly deferred."
  source: "packages/server/src/server/orchestration/graph-engine.test.ts; packages/server/src/server/orchestration/run-orchestration.integration.test.ts; docs/orchestratio"
- time: "2026-08-29T13:06:12.793Z"
  kind: "evidence"
  summary: "Verified a first headless Graph Workflow slice. `otto workflow graph ls`, `inspect <id> --json`, and `run <id>` now use the existing daemon Graph and `runs.start` contracts; run validates declared `--input key=value` values, applies declared defaults, rejects unknown/missing required inputs before dispatch, and requires `--cwd` for a remote host. `workflow graph validate <file>` performs local JSON/schema/structural validation only. Focused CLI tests passed (11 assertions), direct TypeScript help output lists the new command group, targeted lint and CLI typecheck passed, and `git diff --check` passed. The repository's npm CLI wrapper did not run under this Windows shell because cmd cannot execute its Bash wrapper; direct TypeScript help was successful. Not yet proven against a live daemon. File import and `run --file` remain deliberately unbuilt: Graph query tools/EJS templates require a trust boundary, and persisted Runs currently retain graph id plus execution projection rather than an immutable source-document snapshot."
  source: "2026-08-29 verified CLI Graph Workflow slice"
  affects: ["release-0-9-product-completion","graph-templates"]
- time: "2026-08-29T13:15:29.486Z"
  kind: "evidence"
  summary: "Completed live headless Graph Workflow proof with no paid provider: an isolated real daemon stored a one-worker Graph, the real `otto workflow graph run` subprocess connected over WebSocket, resolved the existing workspace from `--cwd`, started the Graph with deterministic fake Claude sessions, and the durable Run reached `done` with its graph id and supplied input persisted. This exposed and fixed a real CLI gap: `--cwd` alone previously omitted workspaceId although daemon chat creation requires it. The CLI now resolves the registered workspace for cwd or accepts explicit `--workspace`; it never creates a workspace as an execution side effect. Focused daemon E2E passed; CLI unit/surface tests passed (12 assertions); targeted lint, CLI/server typechecks, and `git diff --check` passed. Also live-read proof against the existing dev daemon on 6788 succeeded for Graph list, inspect, and validate. Not UI E2E; file import and `run --file` remain intentionally unbuilt pending the Graph trust boundary and immutable source-document Run snapshot."
  source: "2026-08-29 isolated daemon CLI execution proof"
  affects: ["release-0-9-product-completion","graph-templates"]
- time: "2026-08-29T13:28:57.125Z"
  kind: "evidence"
  summary: "Verified Graph Run source-document snapshot slice. `Run.graphSnapshot` is an optional additive protocol field, so older Runs/clients continue to parse. `buildRunFromGraph` deep-clones the validated Graph into every draft and execution; a draft re-save replaces its snapshot, while a started run carries that source document forward as immutable history. Focused evidence passed: protocol schema compatibility (19 assertions), Graph-engine deep-clone test (54 assertions), RunService draft disk-persistence test (28 assertions), and the real fake-backed daemon Brief → Decision hand-off reading the exact document back from terminal Run storage. The real CLI-to-isolated-daemon E2E also reached `done` with the exact saved Graph attached to the retrieved run. Targeted lint, protocol/server/CLI typechecks, build:server, format, and `git diff --check` passed. This closes the run-snapshot prerequisite for future file-driven execution, but does not authorize file import or `run --file`: Graph EJS/query-tool documents still need an explicit trust boundary. No browser UI E2E or updated shared dev-daemon proof was run for this additive field."
  source: "2026-08-29 Graph Run source-document snapshot proof"
  affects: ["release-0-9-product-completion","graph-templates"]
- time: "2026-08-29T13:30:05.060Z"
  kind: "decision"
  summary: "Verified the shipped headless Graph CLI and exact source-document Run snapshot; retain the unresolved file-import trust boundary. Status returned to proposed for review."
  source: "packages/cli/src/commands/workflow/graph.ts; packages/server/src/server/orchestration/workflow-cli.e2e.test.ts; packages/server/src/server/orchestration/graph-e"
- time: "2026-08-29T13:30:30.129Z"
  kind: "note"
  summary: "The user explicitly directed confirmation of verified current Workflows facts; the charter remains the reviewed canonical plan after its evidence-backed CLI and snapshot correction. New status: confirmed."
- time: "2026-08-29T13:46:59.040Z"
  kind: "evidence"
  summary: "Verified deterministic Graph Check slice. Graph documents now support `kind: \"check\"` with a required JSONata assertion and optional durable failure message. The daemon validates Check syntax before spawn, evaluates only `upstream.<nodeId>.fields.<field>` and `upstream.<nodeId>.output`, and makes no provider call or agent-cap charge. A true Check is persisted as done and releases downstream work; false or evaluation failure persists a failed phase, fails the Run, and skips downstream nodes through ordinary dependency handling. The Graph editor now adds and edits deterministic Check cards. Focused engine tests passed for pass, false failure/skip, and syntax rejection (31 assertions). A real fake-backed daemon Graph lifecycle test passed: structured research output fed the Check, the persisted Check passed, only two worker agents ran, and delivery received the original brief. Targeted formatting/lint, protocol/server/app typechecks, and `git diff --check` passed. This is a single pass-continuation form; pass/fail output ports and recovery branching remain unbuilt. No browser UI E2E or shared live-dev-daemon proof was run."
  source: "2026-08-29 deterministic Graph Check proof"
  affects: ["release-0-9-product-completion","graph-templates"]
- time: "2026-08-29T14:09:20.491Z"
  kind: "decision"
  summary: "Verified the durable AI Workflow launch and planner-recovery slice; the prior baseline claim that AI launch creates no Run is no longer true. Status returned to proposed for review."
  source: "2026-08-29 focused RunService and real fake-backed daemon launch proof"
  affects: ["release-0-9-product-completion","agent-orchestration","e2e-qa-coverage"]
- time: "2026-08-29T14:09:36.517Z"
  kind: "evidence"
  summary: "Implemented the durable AI Workflow launch slice. `runs.start` with `flavor: \"ai\"` now persists a `kind: \"ai\"` Run before spawning the detached orchestrator chat, stamps that root chat with the run id, and returns both ids. When that root uses `start_orchestration`, the tool activates the same pending Run after validating the bound conductor, preserving the original title, description, workspace, team, and creation time. Cancel during planning cancels the root chat and persists `canceled`; a planner that settles without a declaration persists an explicit `failed` result; daemon restart continues to fail pending work through ordinary orphan recovery. The Workflows library labels that pending record Planning and AI Workflow rather than showing an empty phase plan. Focused RunService lifecycle tests passed (17 assertions), protocol label tests passed (9 assertions), and an isolated real fake-backed daemon test passed: the UI-facing launch RPC created the durable record, returned the root chat, verified the root label, and retained the no-declaration failure. Targeted format/lint, app typecheck, and `git diff --check` passed. Server typecheck was also attempted after rebuilding its declared dependency stack, but is currently blocked by an unrelated existing `projectArtifacts` type error in `packages/server/src/server/bootstrap.ts`; no feature file was named by that failure. This does not prove a real model calling `start_orchestration`, the resulting full phase fan-out, provider/disconnect recovery, attended gates, browser UI E2E, or a shared live daemon."
  source: "2026-08-29 durable AI Workflow launch proof"
  affects: ["release-0-9-product-completion","agent-orchestration","e2e-qa-coverage"]
- time: "2026-08-29T14:09:45.964Z"
  kind: "note"
  summary: "The owner previously explicitly authorized confirmation of verified Workflows facts; this update reconciles the confirmed charter with the focused, evidence-backed durable AI launch proof. New status: confirmed."
- time: "2026-08-29T14:15:20.456Z"
  kind: "decision"
  summary: "Product owner corrected durable-category storage policy: Workflows must select storage independently from Knowledge, Artifacts, and Schedules. Source inspection verified the current host-global legacy paths and the absence of a Workflow-specific resolver or settings. Status returned to proposed for review."
  source: "Product-owner storage correction, 2026-08-29; source inspection of Workflow bootstrap, stores, protocol, and settings."
  affects: ["release-0-9-product-completion","artifacts","schedules","project-knowledge-context-management","agent-orchestration","graph-templates","e2e-qa-coverage"]
- time: "2026-08-29T14:15:29.452Z"
  kind: "note"
  summary: "Confirmed at the product owner's explicit request: this charter correction records the required independent Workflow storage policy and source-verified current legacy state. Delivery progress remains unchanged because no resolver, settings, migration, or proof has been implemented by this charter-only effort. New status: confirmed."
- time: "2026-08-29T14:21:33.062Z"
  kind: "decision"
  summary: "Verified MCP naming correction: the agent-facing declaration tool is now `start_workflow`; its catalog registration, policy gate, conductor prompts, live-daemon harness, and focused tests were updated. `runs.start` remains the separate client-daemon RPC. Status returned to proposed for review."
  source: "Source and verification: packages/server/src/server/agent/tools/otto-tools.ts; user-orchestration.ts; protocol agent profile/tool-group routing; focused Vitest "
  affects: ["agent-orchestration","release-0-9-product-completion"]
- time: "2026-08-29T14:21:39.102Z"
  kind: "note"
  summary: "Confirmed from the product owner's explicit instruction to rename the MCP action. The implementation and focused validation named in the charter update are complete; overall Workflow delivery progress remains unchanged. New status: confirmed."
- time: "2026-08-29T14:43:02.965Z"
  kind: "decision"
  summary: "Reconciled the confirmed Workflow charter with the verified canonical Workflow terminology and additive workflow launch RPC migration; legacy Run terms are now explicitly scoped to compatibility seams. Status returned to proposed for review."
  source: "Focused source review and verification on 2026-08-29: protocol build; 317 targeted Vitest assertions; client, server, CLI, and app typechecks; targeted lint."
  affects: ["agent-orchestration","release-0-9-product-completion"]
- time: "2026-08-29T14:43:40.704Z"
  kind: "note"
  summary: "The product owner explicitly directed the Workflow terminology correction and previously directed confirmation of verified Workflows facts. The revised charter now records the source-verified canonical Workflow API, legacy compatibility boundary, and completed targeted checks without changing delivery progress. New status: confirmed."
- time: "2026-08-29T15:16:29.268Z"
  kind: "evidence"
  summary: "Verified: `packages/server/src/server/orchestration/run-orchestration.integration.test.ts` passed all 21 fake-backed, live in-process-daemon cases. They drive real child-agent sessions through the Graph lifecycle with exact fake-provider outputs and cover durable worker hand-off, attended gate pause/resume, deterministic Check, template rendering, caps, retry, cancellation, timeout, conditional routing, judge loop, and phase-run compatibility. This is deterministic daemon proof, not browser E2E or a real-provider proof. The tightened browser `runs-screen.spec.ts` now requires a persisted Graph Workflow card to disclose Graph plus completed agent/gate/check history and open its scoped Visualizer. It remains unproven: an isolated-daemon restart retains the seeded Workflow record but `fetchWorkspaces()` returns no workspace, so the app correctly shows `No projects yet`. During investigation, the restart helper was corrected to preserve worker no-relay topology, resolve the server package path, and retain the worker server identity; the remaining persisted-workspace loss is a separate recovery defect. Targeted format/lint, app typecheck after rebuilding client declarations, `git diff --check`, and `npm run e2e:coverage` passed. The isolated browser run was executed through the documented installed-Edge escape hatch because the shared Playwright Chromium installer lock could not be repaired under the shell policy; it failed at the explicit post-restart workspace assertion, not at a Graph display assertion."
  source: "2026-08-29 deterministic Graph Workflow validation"
  affects: ["e2e-qa-coverage","agent-orchestration","graph-templates"]
- time: "2026-08-29T15:35:16.838Z"
  kind: "decision"
  summary: "The previously unproven browser assertion has now passed. Its apparent missing-workspace failure was a client-owned test seed deleting its own project on socket close before restart, not daemon recovery. The charter now accurately records the narrow persisted Graph Workflow history/restart/Visualizer proof and its remaining limits. Status returned to proposed for review."
  source: "2026-08-29 Graph Workflow T1 browser proof"
- time: "2026-08-29T15:35:25.974Z"
  kind: "evidence"
  summary: "Verified browser T1 proof: `E2E_BROWSER_CHANNEL=msedge npx playwright test --config packages/app/playwright.config.ts --project=browser packages/app/e2e/browser/runs-screen.spec.ts` passed (1 test). It seeds a durable `kind: graph` Workflow record with completed agent, gate, and check phases; restarts the isolated daemon; independently verifies the run plus owning workspace rehydrate; then asserts the Workflows library discloses Graph, agent/gate/check history, timing, and opens `visualizer_run_<runId>`. The run uses the documented installed-Edge escape hatch because Chromium's shared Playwright installer remains globally locked; this is valid local browser proof, not a CI-Chromium result. The false workspace-loss finding was corrected: the prior client-owned seed wrapper removed its own project when closed before restart. The proof now uses a host-owned seed project and post-restart cleanup. The restart helper also preserves worker server identity/no-relay topology and registers its detached replacement for worker teardown after Playwright's project sweep, yielding a clean process exit. Targeted format/lint and app typecheck passed; `git diff --check` passed. Earlier in this effort, `run-orchestration.integration.test.ts` passed all 21 fake-provider, in-process daemon cases."
  source: "2026-08-29 Graph Workflow T1 browser proof"
  affects: ["e2e-qa-coverage","agent-orchestration","graph-templates"]
- time: "2026-08-29T15:35:50.489Z"
  kind: "note"
  summary: "The product owner explicitly authorized confirmation of truthful verified Workflow facts. This revision only corrects the charter from the newly passed narrow Graph Workflow T1 proof and explicitly preserves all unproven delivery boundaries. New status: confirmed."
- time: "2026-08-29T16:05:21.733Z"
  kind: "evidence"
  summary: "Supersedes the local-browser caveat in the prior Graph Workflow T1 evidence: the normal command `npm run test:e2e --workspace=@otto-code/app -- e2e/browser/runs-screen.spec.ts` passed its one Workflow browser spec against Playwright's downloaded Chromium, with `E2E_BROWSER_CHANNEL` unset. Otto no longer uses Playwright's user-global cache for official app browser-test scripts or CI installation. `scripts/ensure-browsers.mjs` now installs the pinned Chromium, headless shell, FFmpeg, and Winldd into checkout-local `.tmp/otto-playwright-browsers/` through an Otto-owned lock and bounded archive download/extraction; `scripts/run-playwright.mjs` launches the resolved local CLI with that cache. This was validated while two stale user-global Playwright install processes remained stuck, proving the Workflow browser run is independent of the global `__dirlock`. A second `npm run browsers:install` was a no-op with no Otto lock left behind."
  source: "2026-08-29 local Playwright Chromium repair"
  affects: ["e2e-qa-coverage"]
- time: "2026-08-29T17:04:33.709Z"
  kind: "decision"
  summary: "Reconcile the confirmed Workflows charter with the focused Chromium browser proof of Graph Workflow project selection, workspace resolution, draft creation, and designer entry; preserve unproven execution boundaries. Status returned to proposed for review."
  source: "2026-08-29 Graph Workflow authoring browser proof"
- time: "2026-08-29T17:05:02.082Z"
  kind: "evidence"
  summary: "Verified focused Chromium browser T1 proof: `npm run test:e2e --workspace=@otto-code/app -- e2e/browser/graph-workflow-authoring.spec.ts` passed (1 test) using the checkout-local Playwright cache. The browser opens Workflows, selects Graph Workflow, enters its name and description, selects a host-owned seeded project, verifies the Workspace field resolves that project's actual workspace rather than a synthetic Project root, creates the Graph draft, and arrives in the designer with its Add agent, Save, and Run controls. The proof exposed and corrected a real host-identity bug: `buildOrchestrationWorkspaceTargets` had compared `WorkspaceDescriptor.projectId` (host-local) to `ScheduleProjectTarget.projectKey` (cross-host). The shared target now carries host-local `projectId` from `ProjectHostEntry` and matches that identity. Targeted app validation passed: 26 Vitest assertions across identity/project-target/form-model tests, app typecheck, targeted format/lint, and `git diff --check`. This proves authoring entry and workspace selection only. It does not prove Graph validation, launch, worker execution, gate/check pass-fail, cancellation/restart recovery, or AI Workflow browser launch."
  source: "2026-08-29 Graph Workflow authoring browser proof"
  affects: ["e2e-qa-coverage","graph-templates"]
- time: "2026-08-29T17:05:06.289Z"
  kind: "note"
  summary: "The product owner previously authorized confirming truthful, verified Workflow facts. This correction is backed by focused unit, static, and Chromium browser evidence and preserves the remaining unproven scope. New status: confirmed."
- time: "2026-08-29T17:21:49.174Z"
  kind: "decision"
  summary: "Reconcile the confirmed Workflows charter with the focused browser proof that a minimally authored Graph Workflow launches against the selected workspace and reaches durable completion through the deterministic mock provider. Status returned to proposed for review."
  source: "2026-08-29 Graph Workflow browser execution proof"
- time: "2026-08-29T17:21:59.962Z"
  kind: "evidence"
  summary: "Verified focused Chromium browser T1 proof: `npm run test:e2e --workspace=@otto-code/app -- e2e/browser/graph-workflow-authoring.spec.ts` passed (1 test, one Graph authoring/execution case) with the checkout-local Playwright browser cache. The browser opens Workflows, selects Graph Workflow, names it, selects a real host-owned project/workspace, creates its Graph draft, adds an Agent node, supplies an inline prompt and explicit `mock/ten-second-stream` model override, saves through the designer Run flow, launches the graph, polls the daemon's durable Workflow snapshot to `done`, and returns to Workflows to render the same record as Completed. The run exposed a production gap and its correction: the designer's Run dialog propagated `cwd` but omitted selected `workspaceId`; the daemon correctly refused the orchestrator spawn with `createAgentCommand requires a resolved workspaceId`. The dialog now resolves the selected concrete workspace (or resolves the synthetic root from its cwd) and includes it in every draft/start request. Targeted format/lint/app typecheck passed, plus 10 focused project/workspace-target Vitest assertions and `git diff --check`. This proves one deterministic Graph success path, not invalid-Graph validation, human gate/Check outcomes, cancellation, restart recovery, Visualizer inspection from the generated run, or AI Workflow browser launch."
  source: "2026-08-29 Graph Workflow browser execution proof"
  affects: ["e2e-qa-coverage","agent-orchestration","graph-templates"]
- time: "2026-08-29T17:22:04.856Z"
  kind: "note"
  summary: "The product owner previously authorized confirmation of verified Workflow facts. This charter correction is backed by focused app checks and a passing deterministic Chromium browser execution proof; remaining scope is explicitly retained. New status: confirmed."
- time: "2026-08-29T17:29:05.660Z"
  kind: "decision"
  summary: "Focused browser proof now verifies an attended Graph gate pauses durably without spawning an agent and resumes from the Workflows library; it also corrects stale editor-capability wording. Status returned to proposed for review."
  source: "2026-08-29 Graph Workflow gate browser proof"
  affects: ["e2e-qa-coverage","agent-orchestration","graph-templates"]
- time: "2026-08-29T17:29:13.832Z"
  kind: "evidence"
  summary: "Verified focused Chromium browser T1 proof: `npm run test:e2e --workspace=@otto-code/app -- e2e/browser/graph-workflow-authoring.spec.ts` passed (2 tests, 2.3m) using the checkout-local Playwright cache. In addition to the existing deterministic one-agent Graph launch, the browser creates a real host-owned Graph draft containing only an Approval Gate, launches it through the designer, polls the daemon's durable Workflow snapshot until it is `paused` with `agentCount: 0`, returns to Workflows, verifies `Awaiting approval: Approval gate`, presses **Approve**, and polls the same durable record to `done`. This proves the visible attended-gate pause/approval path and that a gate itself consumes no worker agent. Targeted format/lint and app typecheck passed, as did `git diff --check`. It does not prove gate rejection, gate ordering after an upstream node, deterministic Check outcomes, cancellation, restart recovery, generated-run Visualizer inspection, or AI Workflow browser launch."
  source: "2026-08-29 Graph Workflow attended-gate browser proof"
  affects: ["e2e-qa-coverage","agent-orchestration","graph-templates"]
- time: "2026-08-29T17:29:18.883Z"
  kind: "note"
  summary: "The product owner previously authorized confirmation of verified Workflows facts. This update is limited to the passing deterministic browser gate proof and preserves all remaining unproven boundaries. New status: confirmed."
- time: "2026-08-29T17:52:55.612Z"
  kind: "decision"
  summary: "Focused browser proof now verifies the deterministic false-Check failure path, including durable failure state, zero agent usage, and rendered remediation. Status returned to proposed for review."
  source: "2026-08-29 Graph Workflow false-Check browser proof"
  affects: ["e2e-qa-coverage","agent-orchestration","graph-templates"]
- time: "2026-08-29T17:52:56.549Z"
  kind: "evidence"
  summary: "Verified focused Chromium browser T1 proof: `npm run test:e2e --workspace=@otto-code/app -- e2e/browser/graph-workflow-authoring.spec.ts --grep \"fails a false deterministic Check\"` passed (1 test, 1.2m) through the checkout-local Playwright cache. The browser authors a real host-owned Graph Workflow, adds a deterministic Check node, sets its JSONata assertion to `false` and failure message to `Deliberate E2E check failure.`, launches it, and polls the durable daemon record to `{ status: \"failed\", agentCount: 0 }`. Returning to Workflows renders the declared failure reason. Targeted format/lint and app typecheck passed; `git diff --check` passed. This proves the negative no-agent Check boundary, not Check pass continuation, output routing, invalid-expression feedback, gate rejection, cancellation, restart recovery, generated-run visualizer, or AI Workflow browser launch."
  source: "2026-08-29 Graph Workflow false-Check browser proof"
  affects: ["e2e-qa-coverage","agent-orchestration","graph-templates"]
- time: "2026-08-29T17:52:57.430Z"
  kind: "note"
  summary: "The owner previously authorized confirmation of verified Workflows facts. This is limited to a passing focused browser Check-failure proof. New status: confirmed."
- time: "2026-08-29T17:58:02.147Z"
  kind: "decision"
  summary: "Focused browser proof now verifies Graph gate rejection persists cancellation without spending an agent. Status returned to proposed for review."
  source: "2026-08-29 Graph Workflow gate-rejection browser proof"
  affects: ["e2e-qa-coverage","agent-orchestration","graph-templates"]
- time: "2026-08-29T17:58:03.224Z"
  kind: "evidence"
  summary: "Verified focused Chromium browser T1 proof: `npm run test:e2e --workspace=@otto-code/app -- e2e/browser/graph-workflow-authoring.spec.ts --grep \"rejects an attended approval gate\"` passed (1 test, 58.4s). A real host-owned Graph containing only an Approval Gate persisted `{ status: \"paused\", agentCount: 0 }`; the browser returned to Workflows, pressed **Reject**, then observed the same durable record as `{ status: \"canceled\", agentCount: 0 }` and its terminal Failed label. Targeted format/lint and app typecheck passed; `git diff --check` passed. This proves the rejection boundary, not user cancellation, restart recovery, gate ordering after workers, generated-run visualization, or AI Workflow browser launch."
  source: "2026-08-29 Graph Workflow gate-rejection browser proof"
  affects: ["e2e-qa-coverage","agent-orchestration","graph-templates"]
- time: "2026-08-29T17:58:04.313Z"
  kind: "note"
  summary: "The owner previously authorized confirmation of verified Workflows facts; this update records a focused passing browser proof only. New status: confirmed."
- time: "2026-08-29T18:03:47.396Z"
  kind: "decision"
  summary: "Focused browser proof now verifies the deterministic true-Check terminal path and its persisted pass note. Status returned to proposed for review."
  source: "2026-08-29 Graph Workflow true-Check browser proof"
  affects: ["e2e-qa-coverage","agent-orchestration","graph-templates"]
- time: "2026-08-29T18:03:48.462Z"
  kind: "evidence"
  summary: "Verified focused Chromium browser T1 proof: `npm run test:e2e --workspace=@otto-code/app -- e2e/browser/graph-workflow-authoring.spec.ts --grep \"completes a true deterministic Check\"` passed (1 test, 1.1m). A real host-owned Graph with only the editor's default `true` Check reached durable `{ status: \"done\", agentCount: 0 }`; the persisted Check phase recorded `Check passed: true`, and Workflows rendered the Graph as Completed. The library intentionally omits successful phase notes while showing phase status; the daemon snapshot is the appropriate assertion point. Targeted format/lint and app typecheck passed; `git diff --check` passed. This is terminal Check proof only: a Check continuing to a downstream node, output routing, invalid-expression UX, cancellation, restart recovery, generated-run visualizer, and AI browser lifecycle remain unproven."
  source: "2026-08-29 Graph Workflow true-Check browser proof"
  affects: ["e2e-qa-coverage","agent-orchestration","graph-templates"]
- time: "2026-08-29T18:03:49.402Z"
  kind: "note"
  summary: "The owner previously authorized confirmation of verified Workflows facts; this is a focused passing browser proof. New status: confirmed."
- time: "2026-08-29T18:11:07.582Z"
  kind: "decision"
  summary: "Focused browser proof now covers Graph user cancellation, restart failure recovery, and generated-run visualizer opening. Status returned to proposed for review."
  source: "2026-08-29 Graph Workflow controls, restart, and Visualizer browser proofs"
  affects: ["e2e-qa-coverage","agent-orchestration","graph-templates"]
- time: "2026-08-29T18:11:08.524Z"
  kind: "evidence"
  summary: "Verified three focused Chromium browser T1 proofs using checkout-local Playwright: (1) `--grep \"cancels a running Graph Workflow\"` passed (1 test, 1.1m): a running explicit `mock/ten-second-stream` worker was canceled through the Workflows card kebab and destructive confirmation, then persisted `canceled`; (2) `runs-screen.spec.ts --grep \"turns an in-flight Graph Workflow\"` passed (1 test, 1.0m): after isolated-daemon restart, a persisted active Graph run became durable `failed` with `Daemon restarted while this run was in flight.` and the library rendered that recovery reason; (3) `graph-workflow-authoring.spec.ts --grep \"authors and launches one deterministic agent\"` passed (1 test, 1.5m) after extending the generated-run journey to open and verify its run-scoped Visualizer tab in the selected workspace. Targeted format/lint/typecheck and `git diff --check` passed for all changes. This closes narrow Graph terminal-control/recovery/Visualizer proof; it does not prove invalid Graph feedback, Check downstream continuation/routing, or AI Workflow browser lifecycle."
  source: "2026-08-29 Graph Workflow controls, restart, and Visualizer browser proofs"
  affects: ["e2e-qa-coverage","agent-orchestration","graph-templates"]
- time: "2026-08-29T18:11:09.486Z"
  kind: "note"
  summary: "The owner previously authorized confirming verified Workflows facts. The update is limited to passing focused browser proofs. New status: confirmed."
- time: "2026-08-29T18:14:07.657Z"
  kind: "decision"
  summary: "Focused browser proof now verifies the AI Workflow durable planning record and no-plan failure path. Status returned to proposed for review."
  source: "2026-08-29 AI Workflow browser lifecycle proof"
  affects: ["e2e-qa-coverage","agent-orchestration"]
- time: "2026-08-29T18:14:08.593Z"
  kind: "evidence"
  summary: "Verified focused Chromium browser T1 proof: `npm run test:e2e --workspace=@otto-code/app -- e2e/browser/graph-workflow-authoring.spec.ts --grep \"creates a durable AI Workflow\"` passed (1 test, 1.1m). From the Workflows dialog, the browser selects AI Workflow, enters task/description/prompt, chooses a real host-owned project, launches, and polls the daemon record to `pending` before returning to Workflows to render AI Workflow plus Planning. The mock planner is instructed not to declare a plan; the same record then reaches durable `failed` and the library renders its terminal state. Targeted format/lint/app typecheck passed. This proves the browser-visible planning-record and no-plan failure boundary only, not real provider declaration/fan-out, AI gate/cancellation/restart recovery, generated AI visualization, or a live external daemon."
  source: "2026-08-29 AI Workflow browser lifecycle proof"
  affects: ["e2e-qa-coverage","agent-orchestration"]
- time: "2026-08-29T18:14:09.583Z"
  kind: "note"
  summary: "The owner previously authorized confirmation of verified Workflows facts; this is a focused passing browser proof. New status: confirmed."
- time: "2026-08-29T18:27:52.537Z"
  kind: "decision"
  summary: "Focused browser proof now covers AI Workflow cancellation, restart failure recovery, and generated-run visualization. Status returned to proposed for review."
  source: "2026-08-29 AI Workflow controls and visualizer browser proofs"
  affects: ["e2e-qa-coverage","agent-orchestration"]
- time: "2026-08-29T18:27:53.486Z"
  kind: "evidence"
  summary: "Verified focused Chromium browser T1 proofs: `--grep \"cancels an AI Workflow\"` passed (1 test, 59.3s), cancelling the visible Planning record through Workflows to durable `canceled`; `runs-screen.spec.ts --grep \"turns a pending AI Workflow\"` passed (1 test, 58.7s), making a persisted pending AI Workflow durably fail after restart with the explicit daemon-restart reason and retain its AI label; and `--grep \"creates a durable AI Workflow\"` passed (1 test, 1.1m) after extending the launch proof to open that generated AI run's scoped Visualizer tab before returning to observe its no-plan failure. Targeted format/lint/typecheck and `git diff --check` passed. Real-provider declaration/fan-out and attended AI gates remain unproven."
  source: "2026-08-29 AI Workflow controls and visualizer browser proofs"
  affects: ["e2e-qa-coverage","agent-orchestration"]
- time: "2026-08-29T18:27:54.428Z"
  kind: "note"
  summary: "The owner previously authorized confirmation of verified Workflows facts; this records passing focused browser evidence. New status: confirmed."
- time: "2026-08-29T18:29:26.330Z"
  kind: "evidence"
  summary: "Release-evidence reconciliation: `projects/e2e-qa-coverage/coverage-matrix.md` now maps `graph-workflow-authoring.spec.ts` to a verified T1 Workflows row covering Graph node/gate/Check/cancellation/restart/generated-Visualizer and AI planning/cancellation/restart/generated-Visualizer journeys, alongside `runs-screen.spec.ts`. `npm run e2e:coverage` passed with all 193 browser specs claimed. Targeted Markdown formatting and `git diff --check` passed. The remaining controlled real-provider AI declaration/fan-out proof is intentionally unrun because the owner earlier required no AI spend; final user-facing documentation and release verdict remain pending that explicit T3 decision."
  source: "2026-08-29 Workflow coverage-matrix reconciliation"
  affects: ["e2e-qa-coverage"]
- time: "2026-08-29T18:29:27.250Z"
  kind: "note"
  summary: "The owner previously authorized confirmation of verified Workflows facts; this records the passing coverage-matrix reconciliation. New status: confirmed."
- time: "2026-08-29T18:55:12.296Z"
  kind: "decision"
  summary: "Controlled Sonnet 5 low-effort live-daemon proof now verifies the previously unproven AI Workflow declaration and fan-out boundary; retain remaining AI gate, provider-failure, external-daemon, storage, and sharing gaps. Status returned to proposed for review."
  source: "Verified 2026-08-29: npm run live:orchestration -- --bootstrap-sonnet ...; durable run run_mteqm9v7_1c6a9cc6 completed with one fanOut: 2 research phase, two ma"
  affects: ["e2e-qa-coverage","agent-orchestration","release-0-9-product-completion"]
- time: "2026-08-29T18:55:17.858Z"
  kind: "note"
  summary: "The controlled real-provider declaration and fan-out proof is complete, but attended AI gates, provider-failure recovery, normal external-daemon proof, independent storage/settings, sharing/import, and other charter inventory remain. Workflows is still in build."
  affects: ["workflows"]
- time: "2026-08-29T18:55:26.630Z"
  kind: "evidence"
  summary: "Verified a controlled real-provider AI Workflow proof with `npm run live:orchestration -- --bootstrap-sonnet --timeout 240 ...`. The harness starts an in-process daemon on a random loopback port with a temporary copied home, then removes it; it does not touch ports 6868 or 6788 or persistent profile/team settings. The ephemeral `claude/claude-sonnet-5` low-effort conductor declared `Sonnet fan-out proof` through `start_workflow`; its one `research` phase had `fanOut: 2`. Durable run `run_mteqm9v7_1c6a9cc6` reached `done`, recorded `agentCount: 2` and two candidates, and both returned `WORKFLOW FAN-OUT CONFIRMED.`. Harness formatting, targeted lint, server typecheck, and `git diff --check` passed. This proves AI declaration plus real managed fan-out only; attended AI gates, provider-failure recovery, and normal external-daemon product proof remain open."
  source: "2026-08-29 controlled Sonnet Workflow proof"
  affects: ["e2e-qa-coverage","agent-orchestration","release-0-9-product-completion"]
- time: "2026-08-29T18:56:28.001Z"
  kind: "note"
  summary: "The updated charter statement and evidence are limited to verified focused browser and controlled Sonnet live-daemon proof. The owner authorized confirmation of truthful verified Workflow facts. New status: confirmed."
- time: "2026-08-29T19:22:29.056Z"
  kind: "evidence"
  summary: "Verified invalid-Graph launch feedback with the isolated T1 browser proof `packages/app/e2e/browser/graph-workflow-authoring.spec.ts` (`blocks an invalid deterministic Check before launching an orchestrator`). An invalid JSONata Check leaves the persisted Graph record in `draft` with `agentCount: 0`, creates no root/orchestrator agent, and keeps the New Workflow dialog open with the actionable Check-specific parse correction. The daemon now uses the same complete executable-Graph validator before Graph seat resolution/spawn as the engine uses before execution. Focused engine test: `npx vitest run packages/server/src/server/orchestration/graph-engine.test.ts --bail=1` (57 assertions). Browser proof: `npm run test:e2e --workspace=@otto-code/app -- e2e/browser/graph-workflow-authoring.spec.ts -g \"blocks an invalid deterministic Check\"` (passed)."
  source: "2026-08-29 focused Graph Workflow validation slice"
- time: "2026-08-29T19:27:12.603Z"
  kind: "note"
  summary: "Verified the attended AI Workflow gate slice: an AI-declared gate pauses the original persisted AI Workflow, approval or rejection resolves that same record, and the library and Visualizer project the truthful state. Remaining charter scope is still in build."
  affects: ["workflows"]
- time: "2026-08-29T19:27:21.096Z"
  kind: "evidence"
  summary: "Verified attended AI Workflow gates without a paid provider. `npx vitest run packages/protocol/src/orchestration.test.ts packages/server/src/server/orchestration/run-service.test.ts packages/server/src/server/agent/providers/mock-load-test-agent.test.ts packages/server/src/server/agent/tools/otto-tools.orchestration.test.ts --bail=1` passed 7 files / 86 tests. The lifecycle test proves a persisted `kind: ai` record passes pending → paused → done after approval and pending → paused → canceled after rejection, while refusing a stale phase response; neither path creates a second record. The focused browser proof `npm run test:e2e --workspace=@otto-code/app -- e2e/browser/graph-workflow-authoring.spec.ts --grep=\"approves a mock-declared AI Workflow gate\"` passed 1/1 in 15.9s against an isolated temporary daemon and deterministic mock provider. It observed one record paused at the attended gate, opened its run Visualizer, approved it, and verified the same record completed. Targeted format, lint, and protocol/server/app typechecks passed. Existing direct remediation for unavailable capabilities, roles, and providers remains intact; no Graph routing or storage settings changed."
  source: "2026-08-29 attended AI Workflow gates focused proof"
  affects: ["agent-orchestration","release-0-9-product-completion","e2e-qa-coverage"]
- time: "2026-08-29T19:39:11.134Z"
  kind: "note"
  summary: "Verified the remaining attended AI Workflow gate outcomes: rejection keeps the original record and cancels it durably, and a paused AI gate is explicitly failed on daemon restart rather than resumed."
  affects: ["workflows"]
- time: "2026-08-29T19:39:19.800Z"
  kind: "evidence"
  summary: "Extended the attended AI Workflow gate proof without a paid provider. `npx vitest run packages/server/src/server/orchestration/run-service.test.ts packages/protocol/src/orchestration.test.ts packages/server/src/server/agent/providers/mock-load-test-agent.test.ts --bail=1` passed 6 files / 86 tests, including explicit recovery of a persisted `kind: ai`, `paused` approval gate as terminal `failed` after restart, not silent resumption. The focused deterministic browser proof `npm run test:e2e --workspace=@otto-code/app -- e2e/browser/graph-workflow-authoring.spec.ts --grep=\"rejects a mock-declared AI Workflow gate\"` passed 1/1 in 12.0s against an isolated temporary daemon. It observed the single AI Workflow paused at its gate, rejected it through the Runs UI, and verified the same id became `canceled`. Targeted formatter, lint, server typecheck, and app typecheck passed. This closes the focused mock proof for both attended-gate decisions and makes restart recovery explicit; broader provider/runtime evidence remains in build."
  source: "2026-08-29 attended AI Workflow rejection and restart proof"
  affects: ["agent-orchestration","release-0-9-product-completion","e2e-qa-coverage"]
- time: "2026-08-29T19:55:26.096Z"
  kind: "note"
  summary: "Verified a second real-provider Workflow proof using Codex Luna: it declared an attended gate, accepted the real Runs RPC approval, and completed the same durable Workflow record in an isolated temporary daemon."
  affects: ["workflows"]
- time: "2026-08-29T19:55:36.108Z"
  kind: "evidence"
  summary: "Verified a paid, isolated Codex Luna (`codex/gpt-5.6-luna`, low effort) AI Workflow proof. The parameterized `packages/server/scripts/live-orchestration.ts` fixture copied the configured home into a temporary directory, seeded only an ephemeral `Workflow T4 Codex Luna Conductor` team, and bound its daemon to random loopback port 55980; it did not restart ports 6868 or 6788. The live conductor used `start_workflow` exactly once to create `run_mtestmrd_72ddf66d`, titled `Codex Luna attended gate proof`, with one blocked `approval` gate. Harness option `--approve-gate` waited for that durable paused record, sent `runs.gate_respond` through the real client, and waited for the same run to reach `done`. The Codex final message was `LUNA GATE DECLARED`; the durable record reported the approval phase `done`, no child agents, and a ready summary. The new fixture and docs passed targeted formatter and lint. Server typecheck was attempted but currently fails in unrelated dirty `src/server/archify/archify-renderer.ts` because `join` is undefined there; the fixture typechecked before that external failure appeared. This proves Codex Luna's real MCP-backed attended-gate declaration and approval path, but not broad provider parity or real-provider rejection."
  source: "2026-08-29 isolated Codex Luna attended-gate proof"
  affects: ["agent-orchestration","release-0-9-product-completion","e2e-qa-coverage"]
- time: "2026-08-29T20:07:27.589Z"
  kind: "evidence"
  summary: "Verified the current headless Graph boundary: `otto workflow graph validate <file>` reads a local JSON document through `OrchestrationGraphSchema` and `validateOrchestrationGraph`, returns warnings without connecting to a daemon, saving, importing, or executing it; `run` accepts only a saved Graph id. The focused test in `packages/cli/src/commands/workflow/graph.test.ts` now proves both a forward-additive local document and actionable structural validation failure. `npx vitest run packages/cli/src/commands/workflow/graph.test.ts --bail=1`, targeted CLI lint/format, and `npm run typecheck --workspace=@otto-code/cli` passed."
  source: "Wave 2B source audit and executable verification, 2026-08-29"
  affects: ["workflows"]
- time: "2026-08-29T20:15:21.356Z"
  kind: "evidence"
  summary: "Implemented Graph document compatibility slice 1. `OrchestrationGraphSchema` now accepts optional `format`, `formatVersion`, and `requires`; `validateGraphDocument` preserves legacy unversioned local Graphs with `GRAPH_DOCUMENT_LEGACY_UNVERSIONED`, rejects unsupported document formats/newer versions with stable diagnostics and recovery, and the structural validator rejects duplicate Graph input keys. `otto workflow graph validate <file>` now reports `scope: \"structural\"` and structured diagnostics, without introducing import, `run --file`, daemon access, or execution. Verified with focused protocol/CLI tests (31 passing), targeted format/lint, and protocol plus CLI typechecks. Documentation updated in `docs/workflows.md` and `docs/orchestration-node-capabilities.md`."
  source: "Wave 2B implementation and verification, 2026-08-29"
  affects: ["workflows"]
- time: "2026-08-29T20:20:41.140Z"
  kind: "evidence"
  summary: "Passed deterministic provider-failure proof: a mock conductor declares an AI Workflow and its managed mock worker then returns `Requested mock provider failure`. The run engine persists the candidate error, fails the unjudged phase and run, and records: `Review the failed phase, correct the underlying provider or configuration issue, then start a new Workflow.` The normal external client-to-daemon WebSocket journey and browser Runs card passed in `npm run test:e2e --workspace=@otto-code/app -- e2e/browser/runs-screen.spec.ts --grep \"records a declared AI Workflow provider failure\"`; no paid provider was called. Focused unit tests (79), formatting, lint, server/app typechecks, and E2E coverage check passed."
  source: "Wave 2A targeted verification, 2026-08-29"
  affects: ["release-0-9-product-completion"]
- time: "2026-08-29T22:20:01.980Z"
  kind: "evidence"
  summary: "Verified Graph sharing now has an explicit daemon-owned export and two-step project-store import contract. A portable package carries `otto.workflow.graph` v1 plus a content hash and source descriptor. Import first returns source/destination disclosure and an executable-authority review requirement; only explicit confirmation atomically writes and re-reads the selected Workflow project store. Corrupt input, unsupported version, collisions, and interrupted destination writes preserve the source and existing destination material and return remediation. Focused checks passed: `npx vitest run packages/server/src/server/orchestration/graph-sharing-service.test.ts packages/server/src/server/session/runs/runs-session.test.ts packages/cli/src/commands/workflow/graph.test.ts packages/protocol/src/workflow-storage-protocol.test.ts --bail=1` (5 files, 49 tests); targeted format and lint passed; CLI typecheck passed. Server typecheck is blocked only by pre-existing `architectural-views-session.ts(287)` nullability failure outside this slice."
  source: "Wave 4A targeted verification, 2026-08-29"
  affects: ["release-0-9-product-completion","graph-templates"]
- time: "2026-08-29T22:49:10.076Z"
  kind: "evidence"
  summary: "Wave 4B saved Graph Workflow Schedule adapter verified 2026-08-29. Schedule configuration persists only `{ type: \"workflow\", definitionId, projectRoot }`. At fire time the daemon resolves that project’s `WorkflowStoreRegistry` location, opens `location.definitionsDirectory` through an injected `GraphStore` factory, requires full `workflowStorage` provenance equality, and passes that project store into the ordinary graph Workflow launcher. There is no read or fallback to the legacy daemon-global graph store. The durable Workflow run carries `{ scheduleId, scheduleRunId }`; Schedule history retains immutable target and resolved definition/title/project/fingerprint/Workflow-run linkage. Missing definition, unavailable storage host, provenance mismatch, unsupported host capability, and failed launch are `ScheduleWorkflowTargetError`s, preserving history and pausing for repair. The app gates selection on `server_info.features.scheduleWorkflowTargets` and lists only provenance-matching saved project Graphs through `workflows.graphs.list`; it does not list starters or legacy Graphs. Proof: `npm run typecheck:server`, `npm run typecheck --workspace=@otto-code/app`, targeted lint, and 6 focused Vitest files / 151 tests passed (protocol target compatibility, project-store-only and same-id legacy exclusion, storage/provenance failures, durable source, repair pause, and form state). Knowledge link lint passed with zero broken links."
  source: "Wave 4B source and targeted executable verification, 2026-08-29"
  affects: ["schedules","release-0-9-product-completion"]
- time: "2026-08-29T22:53:22.118Z"
  kind: "decision"
  summary: "Reconciled verified Waves 3A, 4A, and 4B: project-store Graph import and the project-scoped saved-Graph Schedule adapter are implemented, while full Workflow storage migration/settings and AI scheduling remain incomplete. Status returned to proposed for review."
  source: "Cross-wave source audit and Wave 3A/4A/4B targeted verification, 2026-08-29"
  affects: ["schedules","release-0-9-product-completion","graph-templates"]
- time: "2026-08-29T22:54:27.712Z"
  kind: "note"
  summary: "The product owner previously authorized confirmation of verified Workflow facts. This reconciliation records only source-audited and targeted-test-backed Wave 2A/3A/4A/4B outcomes and leaves remaining work explicit. New status: confirmed."
- time: "2026-08-29T22:55:00.209Z"
  kind: "evidence"
  summary: "Wave 4B final verification correction, 2026-08-29: the completed saved-Graph Workflow Schedule adapter pass ran 7 focused Vitest files with 158 tests, superseding the earlier provisional 151-test count in the Wave 4B evidence. Targeted format/lint and app typecheck passed. Server typecheck remains blocked by unrelated dirty `packages/server/src/server/session.ts:11543` (`Logger` missing), which this slice did not modify."
  source: "Wave 4B final agent report, 2026-08-29"
  affects: ["workflows","schedules","release-0-9-product-completion"]
- time: "2026-08-29T23:07:43.229Z"
  kind: "evidence"
  summary: "## Provider/runtime proof matrix evidence — 2026-08-29\n\nVerified without provider spend:\n\n- `packages/server`: `agent-profiles.test.ts` passed (12 tests). Focused orchestration integration tests passed for a Graph human-gate pause/resume and real downstream worker, missing-role refusal with zero spawn, and active-worker cancellation cascade.\n- Focused `run-service.test.ts` checks passed for AI-planning cancellation, terminal no-plan failure, and durable restart recovery.\n- Focused Claude, Codex, and native OpenAI-compatible adapter authority tests passed (3 files, 286 tests). Claude and OpenAI-compatible enforce Graph `write`/`read`/`none`; Codex enforces `write`/`read` and correctly refuses `none`.\n- `docs/workflow-provider-proof-matrix.md` now names the provider/runtime support verdicts, reproducible no-cost commands, owner-authorized controlled-live commands, and the exact release-safe wording.\n\nNo new paid or quota-consuming provider run was made. The isolated browser T1 command for `runs-screen.spec.ts` stalled in Metro setup before a test/report was produced and was terminated as that command's verified process tree. It is not counted as new evidence. The earlier recorded focused browser evidence remains historical, not re-certified here.\n\nVerdict: deterministic mechanics and authority boundaries are proven; Claude and Codex retain their separately recorded representative controlled-live evidence; OpenAI-compatible/local declaration, ACP, Pi, OpenCode, and OMP controlled Workflow runs remain explicit unproven or capability-limited rows."
  source: "WAVE 5B targeted deterministic evidence, 2026-08-29"
  affects: ["release-0-9-product-completion","e2e-qa-coverage"]
- time: "2026-08-29T23:16:10.534Z"
  kind: "evidence"
  summary: "Verified blocker for Workflow-to-Artifact provenance: the current execution adapter stamps workers only with `otto.orchestration-run-id`. `WorkflowSchema` has durable run `id` and an optional Graph-only `graphId`, but no universal immutable Workflow-definition identifier; AI Workflow launch records therefore cannot supply the required distinct `{ workflowId, runId }` Artifact source. `WorkflowStoreRegistry` is explicitly a future-writer boundary while execution still uses the legacy run store. Before Artifact provenance can ship, the final Workflow storage/execution contract must durably expose and propagate a stable definition ID plus execution run ID for every Workflow flavor. Do not derive one from prompt text, labels, or `runId`."
  source: "Workflow-to-Artifact provenance precondition audit, 2026-08-29"
  affects: ["artifacts"]
- time: "2026-08-29T23:31:10.029Z"
  kind: "evidence"
  summary: "Verified WAVE 5A Workflow-start confirmation posture without provider spend. Graph Workflow starts now disclose the known initial Agent and fan-out shape; at the named 4-Agent threshold the daemon issues a request-bound confirmation token, and an altered or forged launch request is rejected. AI Workflows remain unknown while Planning; after `start_workflow` declares a plan, the same durable Workflow pauses at a separate daemon-owned start confirmation before any child Agent starts. Approval executes the unchanged declared plan, rejection cancels it, and ordinary attended gates remain separate. Declared plans above the daemon worker-Agent cap fail before confirmation. Proof: `npx vitest run packages/protocol/src/orchestration.test.ts packages/protocol/src/messages.test.ts packages/client/src/daemon-client.test.ts packages/server/src/server/orchestration/run-service.test.ts packages/server/src/server/session/runs/runs-session.test.ts --exclude .tmp/** --bail=1` passed 5 files / 224 tests; focused Chromium E2E passed `confirms a mock-declared AI Workflow, then preserves its attended gate` and `rejects a mock-declared AI Workflow start confirmation without creating a second Workflow`, each against an isolated temporary daemon and deterministic mock provider; targeted lint and protocol/client/server/app typechecks passed."
  source: "WAVE 5A verified implementation"
- time: "2026-08-30T00:20:04.196Z"
  kind: "evidence"
  summary: "## WAVE 6 final Workflows acceptance audit — 2026-08-29\n\nThis is a release-readiness classification, not a completion claim. The Workflows charter remains canonical and its delivery state remains `in_build`.\n\n| Promise | Classification | Current evidence and release consequence |\n| --- | --- | --- |\n| AI and Graph are distinct models, and AI is never presented as a declared Graph | **Proven** | Protocol model, separate dialog branches, visualizer projection, focused T1 evidence, and the clarified internal and end-user documentation agree. |\n| Durable AI planning record, no-plan failure, cancellation, restart failure, and declared-plan confirmation | **Proven** | Focused T1 lifecycle coverage; controlled Sonnet declaration/fan-out and Codex attended-gate evidence are already recorded. |\n| AI Workflow works on every provider/runtime | **Provider/host-limited** | Claude and Codex have representative controlled proof. OpenAI-compatible/local declaration remains unproven; ACP, Pi, OpenCode, and OMP have stated capability limits or no controlled Workflow proof. |\n| Graph authoring, saved-definition launch, gates, Checks, cancellation, restart recovery, and history rendering | **Proven** in the deterministic development-preview path | Focused Chromium T1 is recorded, but the released app keeps New Workflow and Graph authoring behind the development plus host-capability gate. This does not satisfy a general released entry journey. |\n| Graph invalid-definition feedback in the released UI | **Implemented, not yet proven** | Structural validation exists, but its actionable browser feedback has no passing acceptance proof. |\n| Graph pass/fail output-port routing | **Planned** | The current Check form proves pass continuation only; full pass/fail routing is not built. |\n| Shared history and AI/Graph run-scoped Visualizers | **Implemented, not yet proven** | Basic T1 rendering/opening is recorded. The visualizer cannot be called complete while cancellation projects an active Graph worker as failed rather than an explicit canceled state. |\n| Caps, start confirmation, ordinary gates, role/model/authority refusal, and protocol compatibility | **Proven** | Recorded targeted protocol/server/T1 proof covers forged confirmation rejection, no silent role/provider fallback, and optional compatibility fields. |\n| Independent Workflow storage selection, project-scoped run/template writers, aggregation, unavailable-host handling, and migration receipts | **Planned** | Resolver and project-store Graph-import foundations exist. The host/project settings UI, writers, aggregation, transfer/recovery receipts, and full migration behavior are still absent. |\n| Explicit Graph export/import sharing | **Proven** for the CLI foundation | Current CLI graph tests and daemon E2E prove review, confirmation, verification, and source preservation. It is an explicit copy, not synchronization or publication. |\n| Saved Graph Workflow Schedule target | **Implemented, not yet proven** as an end-user journey | Protocol, adapter, provenance, repair-history, and form-state evidence are recorded, but the full chooser → fire → linked Workflow inspection browser journey is still required. Saved AI Workflow schedules and re-targeting are out of scope. |\n| CLI Graph boundary | **Proven** | This audit passed `packages/cli/src/commands/workflow/graph.test.ts` (9 tests) and `packages/server/src/server/orchestration/workflow-cli.e2e.test.ts` (1 test). `validate` remains structural only; no headless AI Workflow or `run --file` command is claimed. |\n| Capability upgrade state | **Proven** | Required host features are additive and centralized. Older hosts receive an update-host boundary, not a legacy feature fallback. |\n| End-user documentation | **Proven** for truthful current-state disclosure | Added `public-docs/workflows.md` and corrected `docs/workflows.md` to disclose AI versus Graph, preview gating, storage/sharing, automation eligibility, visualizers, recovery, capability upgrades, providers, and CLI limits. |\n| Coverage matrix integrity | **Proven** | `npm run e2e:coverage` passed: 194 browser specs are claimed with no stale references. This is an integrity proof, not a passing browser-journey proof. |\n| General 0.9 Workflow acceptance | **Implemented, not yet proven** | The released app lacks the general creation entry, full storage lifecycle, complete Graph routing/validation proof, and broad provider/runtime proof. Do not mark Workflows or the 0.9 release complete. |\n\nFresh no-cost audit checks: `npm run format:files -- docs/workflows.md public-docs/workflows.md public-docs/index.md`; `npm run e2e:coverage`; targeted Workflow documentation relative-link lint; `npx vitest run src/commands/workflow/graph.test.ts --bail=1` in `packages/cli` (9 passed); `npx vitest run src/server/orchestration/workflow-cli.e2e.test.ts --bail=1` in `packages/server` (1 passed); targeted lint; protocol, CLI, website, relay, client, server, and Brain typechecks passed. App typecheck remains blocked by unrelated dirty errors in `packages/app/src/project-knowledge/panel.tsx:341` and `packages/app/src/screens/workspace/workspace-tab-menu.ts:235`; this audit made no app-source change and did not alter those files."
  source: "WAVE 6 final source/docs/protocol/UI/CLI/coverage audit, 2026-08-29"
  affects: ["release-0-9-product-completion","e2e-qa-coverage"]
- time: "2026-08-30T00:47:34.671Z"
  kind: "evidence"
  summary: "Closing review fixes 2026-08-29: (1) AI Workflow Planning record now lives with its chat and fails only on archive/cancel/restart ([[ai-workflow-planning-record-lives-with-its-chat]]). (2) `graphSnapshot` is persisted but stripped from `runs.updated.notification` and `runs.get_snapshot` via `toWireRun` until a consumer exists; it multiplied every phase-transition broadcast by the Graph size. (3) Gate rejection sets `run.error`; phases stopped by the user are `canceled` ([[workflow-phase-cancellation-is-canceled-not-failed]]). (4) Restart recovery reasons are specific: before start confirmation (nothing ran), while planning, at a gate, or in flight. (5) Graph ids are path-safe and the start-confirmation token is bound to the reviewed Graph content ([[graph-sharing-trust-boundary-ids-hash-and-review-binding]]). (6) Stale `start_run` references replaced with `start_workflow` in code comments and current-truth Knowledge pages; docs/workflows.md now attributes each proof to the spec or integration test that provides it (gates, checks, cancel and restart proofs are integration tests, not browser specs). Verified: protocol/server/app typecheck, lint, 114 unit + 21 integration + 1 CLI e2e tests green; runs-screen.spec.ts restart wording updated but awaits CI."
  affects: ["graph-templates","e2e-qa-coverage"]
- time: "2026-08-30T01:06:12.937Z"
  kind: "evidence"
  summary: "Fable 5 focused browser verification was not upgraded to passing evidence. `npm --workspace=@otto-code/app run test:e2e -- e2e/browser/runs-screen.spec.ts` executed in the isolated Playwright Chromium stack: persisted Graph history/Visualizer opening, Graph in-flight restart failure recovery, and pending AI planning restart failure recovery passed; the declared AI provider-failure case failed because the plan now correctly paused for daemon-owned start confirmation. The spec was updated to approve that confirmation through the normal client RPC. Its required exact rerun then stalled in Metro warmup and ended with `TimeoutError: The operation was aborted due to timeout` before Playwright started, so it produced no rerun assertion result. `graph-workflow-authoring.spec.ts` has not been rerun against these Fable 5 changes. The coverage matrix and docs deliberately remain partial/pending; no provider-backed command ran."
  source: "Focused isolated Chromium verification, 2026-08-29"
  affects: ["e2e-qa-coverage"]
- time: "2026-08-30T01:14:58.028Z"
  kind: "evidence"
  summary: "2026-08-29 local/OpenAI-compatible Workflow proof audit: `packages/server/scripts/live-orchestration.ts` now has an opt-in `--bootstrap-openai-compatible-fixture` that starts a private loopback OpenAI-compatible endpoint and a temporary daemon/home, with no provider credentials or ports 6868/6788. Its current targeted run reaches the isolated daemon and local roster but blocks during Workflow-agent execution before its durable assertion, so it is an explicit external proof blocker, not passing local-runtime evidence. `npx vitest run src/server/agent/workspace-access.test.ts --bail=1` passed 26 tests; it confirms ACP, Pi (when `pi-mcp-adapter` is present), OpenCode, and OMP admit ordinary write nodes but refuse `read` and `none` because none declares an enforceable workspace ceiling. `npm run lint -- ...` and `npm run typecheck --workspace=@otto-code/server` passed for the changed files/package."
  source: "Targeted local verification, 2026-08-29: packages/server/scripts/live-orchestration.ts; packages/server/src/server/agent/workspace-access.test.ts; docs/workflow"
  affects: ["e2e-qa-coverage"]
- time: "2026-08-30T01:18:03.084Z"
  kind: "evidence"
  summary: "Verified partial 0.9 Workflow storage evidence: the category-owned resolver now emits stable opaque project-scope store keys while accepting its earlier path-based keys as read-only compatibility locators. New AI/Graph Workflow initial snapshots are stamped with the selected project-store provenance before any root agent launch and later writes remain pinned to it; daemon-global runs remain visible as legacy host library material. Compatible hosts expose independent Workflow Host/Project settings through a capability-gated RPC, and the Runs UI labels Repository, Host-local, or Legacy host library and names remote-host reconnect/verified-transfer remediation. Targeted resolver/store/protocol/session/app presentation tests passed, as did server and app typechecks. Definition/template writers, complete same-project aggregation, daemon-owned copy/move receipts, and corrupt-record repair actions remain open; this does not complete Workflows or the 0.9 release."
  source: "Workflow storage vertical slice, 2026-08-29"
  affects: ["workflows","schedules","artifacts","release-0-9-product-completion"]
- time: "2026-08-30T01:37:00.672Z"
  kind: "evidence"
  summary: "Verified the canceled Workflow presentation correction without changing engine or protocol semantics. Runs now label `canceled` truthfully, use warning rather than error treatment, retain the persisted cancellation or gate-rejection reason, expose a separate Canceled history filter, and include the status in the Visualizer action label. Run-scoped Visualizer history continues to resolve by persisted `runId`; canceled gate and skipped downstream phase history remains visible. Focused evidence: `npx vitest run packages/app/src/screens/runs-screen.test.ts --bail=1` passed (3/3); targeted app lint and `npm run typecheck --workspace=@otto-code/app` passed; isolated browser T1 runs passed: the persisted canceled Graph history/reason/skipped-work/Visualizer case (1/1) and gate rejection, active Graph worker cancellation, AI confirmation rejection, and AI planner cancellation (4/4)."
  source: "Canceled Workflow presentation verification, 2026-08-29"
  affects: ["workflow-phase-cancellation-is-canceled-not-failed","e2e-qa-coverage"]
- time: "2026-08-30T02:36:00.211Z"
  kind: "evidence"
  summary: "2026-08-29: Verified the 0.9 Workflow storage slice with targeted tests. Project Graph and prompt-template saves now stamp the selected project-store provenance; run snapshots stay pinned to their initial recorded store. Stable-id, project-scope transfer RPCs write prepared receipts before destination persistence, verify a re-read hash, retain legacy sources for copy, refuse collisions without mutation, and disclose failed/corrupt receipts for recovery. Passing evidence: `workflow-library-service.test.ts` (5), `workflow-run-store.test.ts`, `workflow-store-registry.test.ts` (14 combined), `graph-sharing-service.test.ts` + `workflow-target.test.ts` (12), protocol test (6), session setting test, and protocol/server/app typechecks. Remaining: aggregated definition/template browsing across both project locations and user-facing repair/export actions for corrupt/colliding definitions."
- time: "2026-09-02T14:07:19.549Z"
  kind: "decision"
  summary: "Released the New Workflow and Graph Workflow entry by removing the client-side development-build gates while preserving the advertised-host capability boundary. Status returned to proposed for review."
  source: "Workflow release-gate change, 2026-09-02: packages/app/src/hooks/use-workflow-graphs.ts; packages/app/src/screens/runs-screen.tsx; use-workflow-graphs.test.tsx"
- time: "2026-09-02T14:08:29.279Z"
  kind: "note"
  summary: "The user explicitly requested released Workflow availability; the implemented capability-bound change and focused production-build regression test verify the updated truth. New status: confirmed."
