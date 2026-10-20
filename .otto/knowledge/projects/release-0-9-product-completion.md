---
id: "release-0-9-product-completion"
kind: "project"
title: "0.9 release plan — product completion train toward 1.0"
status: "proposed"
tags: ["release","v0.9","v1.0","orchestration","artifacts","schedules","kanban","project-knowledge","context-management","brain"]
delivery_status: "in_build"
progress_completed: 0
progress_total: 8
progress_unit: "release-train milestones"
created_at: "2026-08-26T23:24:52.003Z"
updated_at: "2026-09-04T01:05:28.407Z"
---
# 0.9 release plan — product completion train toward 1.0

<!-- compiled_truth -->

# 0.9 release plan — completion train toward 1.0

## Outcome

The **0.9.x release train** advances Otto’s remaining major operational surfaces toward 1.0. **0.9.0 is the first stable waypoint in that train, not the single-version completion gate**. Individual modules may continue through later 0.9.x releases; 1.0.0 is the release that requires their completed user journeys and reliability proof.

The train covers:

1. **Workflows** — Otto’s explicit, safe, observable way to run a multi-agent plan, not a hidden daemon capability.
2. **Artifacts** — a project-scoped, inspectable, refreshable deliverable lifecycle.
3. **Schedules** — reliable, explainable recurring work with a visible run history and an intentional unattended posture.
4. **Kanban** — a configured project board that supports the complete day-to-day board journey through GitHub Projects and Jira.
5. **Project Knowledge and Context Management** — one coherent loop from durable project truth, through consciously selected prompt context, to technical review.
6. **Connectors** — every release-roster integration is configurable, verified, safe, provider-usable, and tested.
7. **Otto Brain managed runtimes** — one generalized Otto Brain contract implemented by llama.cpp, vLLM, and SGLang runtime drivers.

This is a **release train**, not a promise to collapse every adjacent charter into 0.9. A module is complete only when a user can enter it, accomplish its core job, understand failure/recovery, and see evidence that it happened.

## Product decisions

- The final product label is **Workflows**. Where a provider exposes a similarly named native tool, Otto labels that provider-specific action explicitly so it cannot be mistaken for an Otto Workflow.
- A visible screen is not a finished module. Every module needs explicit entry points, capability/upgrade handling, empty/loading/error states, mutations, recovery, and a tested core journey.
- Brain is deliberately simple in product shape: **Otto → Brain → runtime driver**. Each driver must implement the same applicable generalized functionality: model loading/unloading, queueing, settings, calibration, benchmarking, logs, templates, queries, and recovery. Runtime-specific gaps are implementation work inside a driver, to be tackled as each runtime is integrated. They do not change the generalized Brain product contract.
- Never add a degraded legacy path for a new feature. Capability detection remains centralized and old hosts present the upgrade boundary.
- **0.9.0 is stability-gated, not module-completion-gated.** It ships the coherent, stable work available at the first 0.9 waypoint. Subsequent 0.9.x releases continue the completion train. **1.0.0** does not ship until the user-facing module journeys and their reliability proofs are complete.

## Module completion contract

Every 0.9 feature charter must answer the same end-user question before its delivery can be
considered complete:

> Can an end user understand what this module is for, enter it, perform its promised work,
> inspect the resulting state and evidence, and recover when its dependencies fail?

A module’s charter must therefore carry an explicit **end-user capability contract**. It is not a
list of arbitrary example domains or internal components. It contains:

1. **Outcome and boundaries** — the user job the module owns, its explicit non-goals, and which
   adjacent module owns nearby work.
2. **Owned durable objects** — definitions, configuration, records, outputs, history, and their
   project/host ownership, storage, lifecycle, and deletion rules.
3. **Discoverability and actions** — navigation, capability/upgrade state, empty/loading/error
   state, and every user action that changes an owned object.
4. **Execution and integrations** — provider, host, authorization, runtime, schedule, and
   cross-module boundaries; an unavailable dependency must state its remediation.
5. **Safety, observability, and recovery** — permissions/approval, caps where relevant, active
   status, outputs/failures, cancellation/retry/resume semantics, audit/deep links, and what
   survives leaving the app or restarting the daemon.
6. **Truthful documentation** — the end-user documentation must describe what is actually
   available, name limitations plainly, and never present a future or provider-specific behavior
   as a general Otto capability.
7. **Proof** — targeted unit/protocol checks plus T1 and, when model- or daemon-sensitive, T2 or
   controlled live proof for the happy path and the principal failure/recovery path.

The release completion matrix is the compact projection of these contracts: every module must
link its charter’s capabilities to an executable proof and remain partial when any promised
capability is unproven. A rendered screen, an internal service, or a provider-specific demo does
not earn completion by itself.



### Claim audit and acceptance proof

Every module has two gates, in this order:

1. **Current-state claim audit:** turn each assertion about existing software into a reproducible test and classify it as **Proven**, **Implemented, not yet proven**, **Provider or host limited**, **Planned**, or **Out of scope**. Code inspection, a screenshot, or an internal service alone does not make a claim Proven.
2. **End-user acceptance proof:** after implementation, execute the complete user journey through the real daemon and UI. T1 proves deterministic product plumbing, and T2 or controlled live proof is required where a real model or daemon-sensitive loop is part of the promised outcome. Assertions must target durable side effects and recovery behavior, never model prose.

A charter’s plan is complete only when each desired end-user claim has exactly one classification, owner, limitation, failure/recovery contract, and named proof. Its feature is complete only when every required claim is Proven and the release matrix names green evidence. End-user documentation may state only Proven behavior as generally available; implemented-but-unproven, provider-limited, planned, and out-of-scope behavior must remain explicit.

## 0.9 executable completion matrix

This is the release-control view of the feature charters. **Verified** means the named current
test exists or the code path has been directly inspected during the Phase 1 audit; it does not
mean the 0.9 promise is complete. A row turns green only when its named proof has actually passed
in the appropriate environment.

| Module | Core journey | Verified current evidence | Required proof before completion | Principal recovery proof | Phase 1 verdict |
| --- | --- | --- | --- | --- | --- |
| [[workflows]] | Configure AI or Graph Workflow → start → observe → approve/cancel → inspect outcome | Focused Chromium T1 proves Graph authoring/launch, checks, gates, cancellation/restart, and Visualizer; AI planning, attended gate, cancellation/restart/Visualizer; and deterministic provider-failure recovery through the normal external client-to-daemon journey. Controlled Sonnet 5 proof verifies AI declaration and `fanOut: 2` workers. Project-store Graph import and a capability-gated saved-Graph Schedule target have focused proof. | Remaining: independent storage settings, project-scoped run/template writers and transfer/aggregation; broad provider/runtime proof; and expanded Graph invalid-validation and pass-routing proof. | Child/node failure remains visible; cancel, target repair, and unavailable-host states give a next action. | **In build, partially proven.** |
| [[artifacts]] | Create/open durable artifact → update without redesign → inspect provenance/recover | Store, data-update, resolver, restart/migration, protocol, session, CLI, and HTML-safety tests exist. A targeted browser T1 proves hostile-preview rendering/security only; the coverage matrix still has no complete Artifact lifecycle journey. | T1: library/open/status/error/update-versus-regenerate and old-host/unavailable states; controlled generation/T2: persisted artifact data update preserves design. | Failed generation/update retains the artifact and offers retry/regenerate. | **Partial, preview-security UI proof only; lifecycle UI/T2 absent.** |
| [[schedules]] | Configure agent/Workflow/artifact target → run → inspect history → pause/recover | T1 create/edit/project/hidden-run journeys and daemon lifecycle tests exist. The saved **Graph** Workflow target now has focused protocol, adapter, service, form-state, project-store/provenance, and repair-history proof. | T1: full saved-Workflow chooser and fire journey, invalid/deleted target, linked Workflow inspection/recovery; controlled daemon/T2: each target adapter runs once and records an auditable result. Saved AI Workflow and artifact-update targets remain unimplemented. | Overlap, retry, cancellation and target disappearance are visible and repairable. | **Partial, one narrow new target proven.** |
| [[kanban]] | Configure board → read/refresh → create/link/move/edit supported card fields | GitHub/Jira provider, session and project-target tests exist; no browser board journey or live provider proof. | T1: project target setup, board read/mutation/error reconciliation; T3/sandbox: GitHub Projects and Jira read/create/link/move/edit under documented scopes. | Auth/scope/unsupported-field failure names remediation and retains board state. | **In build, provider journey unproven.** |
| [[project-knowledge-context-management]] | Initialize architecture documents → review/refine → choose context → retain verified conclusion | Store/resolver/migration, review-session and Context Management service tests exist; browser management workflows are all gaps. | T1: roots/records/review/delivery/reference/context selection; controlled daemon/T2: external edit refresh and pull-on-demand injection/review retention. | External conflict, unavailable context and unconfirmed conclusion remain explicit. | **In build, end-user journey unproven.** |
| [[connectors]] | Configure catalog Connector → verify/enumerate tools → enable subset → agent uses them | OAuth/secret/config and catalog tests exist; catalog-row UI, full transport and vendor proof are not uniformly present. | Per row T1/setup/transport/scope test; T3/vendor or sandbox proof with an honest externally-gated verdict. | Authorization, missing scope and unsupported-provider states show actionable remediation. | **Partial, release ledger not yet proven.** |
| [[managed-model-server-runtimes]] | Operate Brain → manage model/runtime → query/observe/recover | Brain manager/runtime-driver/app unit tests exist; browser matrix has one covered Brain row and twelve gaps. | T1: route/capability/operations/error states; controlled runtime/T2: model lifecycle, queue/query, logs, recovery; native matrix proof per runtime/platform. | Runtime install/load/query failure preserves diagnostics and safe next actions. | **In build, generalized host proof absent.** |

### Phase 1 shared-harness verdict

`npm run e2e:coverage` currently proves that all 192 browser specs are claimed by the live
coverage matrix and that the matrix has no stale spec references. Its 2026-08-27 baseline is
171 covered, 25 partial and 44 explicit gaps. It is an integrity check, not evidence that a
coverage row passed.

The current executable matrix remains under `projects/e2e-qa-coverage/`, a legacy tree that
repository policy makes read-only. No Phase 1 spec is added directly to that tree. Before adding
new browser specs under this release matrix, migrate the live matrix to its canonical non-legacy
location and update the checker and QA reporter together. Until then, the feature charters carry
the precise required proof and missing journeys, while the existing checker continues to prevent
silent drift in the existing suite.


## Completion inventory — what each project is actually for

This inventory is the input to the first milestone’s completion matrix. It separates an existing screen or subsystem from the user outcome it must still prove.

### 1. Workflows

**Purpose:** deliver two execution models as first-class Otto work. An **AI Workflow** is an open-ended agentic orchestration: the agent uses Otto MCP tools to start chats and coordinate other agents, with no predetermined execution plan. A **Graph Workflow** is a predetermined, deterministic execution graph with explicit steps, gates, pass/fail behavior and observable outputs. The distinction is execution control, not whether a workflow can be visualized.

**Known work:** [[agent-orchestration]] already has the typed Run engine, store, service, caps, roles, daemon tools, protocol, route, and basic cards. The visual graph designer, graph store/engine, prompt templates, starter graphs, draft graph runs, node outputs, conditions, and graph-workflow UI are already under way. Remaining work is the unified Workflow entry/navigation model; an AI Workflow dialog for its basic configuration such as prompt and execution options; deterministic Graph Workflow authoring/save/validation/run/inspect UX; cost/agent confirmation; live daemon spawn/wait proof; visualizers for both execution models; and clear failure/resume/cancel states. AI Workflows have no graph editor because their agentic execution plan is not a user-authored graph. [[graph-templates]] supplies per-node accounting, scoring, non-LLM checks, a golden-graph harness, and the starter library needed to prove a graph is useful rather than merely elaborate.

**Done when:** a user can deliberately start, observe, approve, cancel and inspect both AI and Graph Workflows. Graph Workflows validate and execute their declared steps and gates through their graph editor. AI Workflows use a basic configuration dialog, then visibly expose the agent-driven orchestration they actually performed without falsely presenting it as a predetermined graph. Both have an appropriate visualizer. Neither silently exceeds declared caps or hides a failed worker behind prose.

### 2. Artifacts

**Purpose:** make an AI-created HTML deliverable a durable project object, not a transient chat by-product.

**Known work:** artifacts already have background generation, status, inspection, regeneration, and a structured data-update path. 0.9 must add the shared category-storage settings platform, then an **independent Artifacts** resolver: host Settings supplies the Artifacts default and Project Settings can override it without affecting Knowledge, Schedules, or Workflows; repository artifacts live under the project `.otto/artifacts`, while host-local artifacts live under Otto’s stable project storage. The selected location, watcher, provenance, refresh/error recovery, opening/sharing disclosure, and relationship to a triggering chat, Workflow or schedule must be visible and testable. Artifacts are never moved between projects; the store resolver simply determines where each project’s own artifacts live. Artifacts do not have a fixed product taxonomy; their content defines them.

**Done when:** an owner can create, inspect, reopen, refresh or regenerate an artifact after leaving the app, understand its current state, source and selected storage policy, and recover from a failed generation without losing the project deliverable. An update preserves the artifact’s design unless the owner explicitly chooses regeneration.

### 3. Schedules

**Purpose:** let users safely automate recurring Otto work and explain what will happen, when it happened, and why it failed.

**Known work:** the durable scheduler already supports agent and new-agent targets, cron/time-zone handling, pause/resume/run-now/edit/delete, run records, target resolution, retries, and safe-unattended behavior. 0.9 adds two built-in target kinds: **Workflow** (an explicit saved AI or Graph Workflow, not prompt reconstruction) and **Artifact update** (a data/update instruction against an existing artifact that preserves its design). The scheduler needs durable target schemas, target-specific forms, execution adapters, status/results, permissions, retry/recovery, and deep links for all three kinds.

**Done when:** a user can create, inspect, pause, run, edit and recover agent, Workflow, and Artifact-update schedules, with the selected cadence, target, last/next execution, result, and unattended posture unambiguous. Artifact updates preserve the artifact’s established design rather than regenerating it from prose.

### 4. Kanban

**Purpose:** give every project one dependable day-to-day work board rather than a disconnected integration demo.

**Known work:** the intended project-scoped board target and host/project selection are decided; GitHub Projects and Jira providers exist. The remaining work is a full practical board view, staged Project Settings configuration, credential/scope remediation, provider discovery and minimal card mutations: create, link, move and edit simple provider-supported card fields. The baseline fields are title, description/body, column/status, assignee, labels, priority and due date when the provider genuinely exposes them. It deliberately does not promise every tracker feature.

**Done when:** a user selects a host and project, saves a GitHub Projects or Jira target, reads its full board, creates/links, moves and edits the minimum provider-supported card fields, refreshes it, and receives actionable provider/auth limitation feedback.

### 5. Project Knowledge and Context Management

**Purpose:** make Otto technically trustworthy: durable, reviewable project truth stays repository-owned, while an agent’s prompt context is visible, intentionally selected, and honestly measured.

**Known work:** Project Knowledge already has atomic daemon-managed Markdown, six roots, review/delivery/reference lifecycles, pull-on-demand rich pages, a management UI, evidence timelines, and external-file refresh. 0.9 must make initialization/onboarding create useful, evidence-backed draft architectural roots rather than ceremonial shells, and make those roots refinable as the project evolves. Context Management already distinguishes fixed, conditional and referenced context; provider visibility/confidence; the full context inventory; and controls only where Otto genuinely owns the input.

**Done when:** a reviewer can inspect and refine initialized architectural documents with their evidence, choose the relevant durable knowledge/context for a task, see what the agent received and what is merely unavailable or estimated, finish a review, and preserve only a verified durable conclusion. No page body is silently injected just because it exists.

### 6. Connectors

**Purpose:** make integrations a real, safe, provider-usable product surface rather than a directory of endpoint names.

**Known work:** the OAuth broker, add-time connect-and-enumerate verification, secret redaction, catalog search/filtering, installed-connector management, and 29 cited catalog rows are already present. The known delivery gap is support for all real configuration shapes: own OAuth client ID/secret, templated URLs with structured user fields, client-credentials grants, static-token setup, and secure official local servers. The current ledger also identifies vendor-specific uncertainty and gating, including AWS auth, Meta Ads’ canonical endpoint, GitLab/Asana transport details, and Vercel/Square client approval.

**0.9 roster rule:** every Connector already added to Otto’s software catalog is in scope. For each one, the release ledger must record vendor documentation and verification date; setup/auth shape; approved OAuth/token scope inventory; each tool the MCP server exposes; the enabled tool subset; the agent providers that can receive it; the exact operation-to-scope mapping where Otto owns the integration; connection/authorization failures; and automated plus live verification evidence. A researched but unlisted candidate is not silently counted as a commitment. An Otto-native connector is added only when explicitly selected from the researched shortlist and carries owned API, pagination, rate-limit, token-economy, and long-term test obligations.

**Done when:** every catalog Connector can be configured through Otto, verified at add time, inspected for its actual tools, enabled/disabled per tool, and used by every agent provider that advertises the needed MCP capability. Providers without that capability state the limitation honestly. Every row has automated catalog/setup/transport coverage, scope/capability evidence, and a live vendor or vendor-sandbox proof where credentials and vendor policy permit it; externally gated vendors display their actual verdict.

### 7. Otto Brain managed runtimes

**Purpose:** make local-model operation provider-grade: Otto owns the runtime lifecycle and exposes one stable Brain host while allowing each engine’s native strengths.

**Known work:** Brain host control, console, bundles, model operations, benchmark surfaces, and managed llama.cpp behavior exist. [[managed-model-server-runtimes]] requires extracting llama.cpp behind driver one, capability-driven host/UI behavior, then managed vLLM and SGLang. [[brain-model-bundles]] and [[brain-coding-capabilities]] prevent multi-artifact models, tool-result images, benchmark provenance, and coding evaluation from being implicitly llama.cpp-only.

**Done when:** Windows, macOS, Linux and WSL Otto clients can operate a suitable local or remote Brain host. llama.cpp retains parity behind the driver boundary, then vLLM and SGLang independently meet the full managed-host capability floor on explicit verified host-platform matrices. Otto installs, operates, secures, observes, benchmarks, and recovers each runtime; it never pretends a missing native control or unsupported platform is available.

### 8. Release quality

**Purpose:** turn the above from claimed capability into release evidence.

**Known work:** [[e2e-qa-coverage]] has the T1 mock, T2 local-AI, and T3 real-provider strategy plus a coverage matrix. Each 0.9 module adds its core journeys to that matrix rather than relying on an ad hoc full-suite run.

**Done when:** targeted unit, protocol, and app checks are green; every module has T1 coverage; the model-dependent and daemon-sensitive journeys have appropriate T2 or controlled live proof; and the remaining native-only checks are explicit in the release runbook.

## Feature charter index

The master charter owns release order, cross-module contracts and 1.0 entry criteria. Each feature charter owns its current-state inventory, implementation plan, evidence and delivery updates.

- [[workflows]] — product umbrella for AI and Graph Workflows; [[agent-orchestration]] and [[graph-templates]] remain its implementation dependencies.
- [[artifacts]] — durable deliverables, storage and design-preserving updates.
- [[schedules]] — agent, Workflow and artifact-update automation.
- [[kanban]] — GitHub Projects and Jira daily card work.
- [[project-knowledge-context-management]] — initialized architecture documents and trustworthy technical-review context.
- [[connectors]] — catalog completion, MCP tooling and scope evidence.
- [[managed-model-server-runtimes]] — Brain runtime-driver platform; [[brain-model-bundles]] and [[brain-coding-capabilities]] are included dependencies.
- [[e2e-qa-coverage]] — release-proof matrix and execution tiers.

## Release train

### 0.9.0-alpha.1 — module completion matrix and proof harness

Define the completion matrix for Artifacts, Schedules, Kanban, Workflows, Project Knowledge, Context Management, and Brain. Add/repair the targeted T1 mock and T2 local-AI journeys needed to verify them. Ensure each module has a reachable navigation path, centralized capability gate, actionable unavailable state, and an observable failure/retry story.

**Exit:** each later build has executable acceptance journeys; no work is accepted because a screen merely renders.

### 0.9.0-alpha.2 — Workflows become a real module

Finish [[agent-orchestration]]’s unshipped product path:

- explicit **Start workflow** entry points and a visible Workflows navigation item;
- cost/agent-count confirmation before fan-out, attended gate approval, cancellation, and clear failure reporting;
- live-daemon proof of create → fan-out → judge → gate → deliver;
- deterministic graph execution and its authoring/validation surface exposed only where capability-gated, with a small useful starter catalog from [[graph-templates]]; and run visualizers available for both Graph and AI Workflows.

The graph designer, AI graph authoring, and broad template evaluation library are not completion requirements unless their measurement harness proves them reliable. The first release focuses on a robust declared-plan journey.

**Exit:** a user can deliberately start, observe, approve/reject, resume or cancel a workflow and receive a synthesized result without relying on model interpretation of prose.

### 0.9.0-alpha.3 — Artifacts and Schedules close their loops

Make artifact production and scheduled work complete operational products:

- artifacts retain project ownership, inspectable provenance/status, regeneration/data-refresh recovery, and a clear open/share lifecycle;
- schedules expose their target, cadence/time-zone, next/last execution, run result, pause/resume/run-now/edit/delete, and remediation for permissions or unavailable targets;
- define the safe cross-module contract: a schedule may invoke only explicitly supported durable targets. Start with existing agent schedules; add artifact refresh and graph-orchestration targets only when the scheduler can preserve the same user-visible run/audit and permission posture.

**Exit:** an owner can create an artifact or schedule, leave the app, return, understand exactly what happened, and safely recover from a failed run.

### 0.9.0-beta.1 — Kanban is dependable daily coordination

Complete the configured board journey defined by [[kanban-is-reached-via-host-project-pickers-the-board-target-is-configured-per]]:

- host and project selection lead to a staged, saved board target;
- GitHub Projects and Jira have credential checks with actionable remediation;
- board read, create/link, move, and refresh semantics are verified against each provider;
- provider limitations are disclosed rather than simulated.

Broader tracker and connector catalog expansion stays out of this release. GitHub Projects and Jira are the 0.9 contract.

**Exit:** a configured project can reliably show and operate its intended board, and every auth/provider failure tells the user what to fix.

### 0.9.0-beta.2 — Knowledge and Context become the technical-review loop

Strengthen the systems that make Otto a trustworthy reviewer:

- Project Knowledge authoring, review status, evidence, and external-file refresh work as one durable repository-backed record;
- Context Management shows fixed, conditional, referenced, and not-visible input honestly by provider, with edits/actions only where Otto truly controls the context;
- Knowledge can be deliberately selected or withheld for a task rather than implicitly inflating every prompt;
- add end-to-end technical-review journeys: inspect evidence → choose context → conduct review → preserve only verified durable outcome.

**Exit:** a user can explain what Otto knows, what the active agent received, what it cost in context, and why a reviewed conclusion was retained.

### Integration ownership topology — Forge, Kanban, and Connectors

0.9 must remove the current vendor-shaped ambiguity without conflating distinct product scopes:

- **Integration Authorization** is daemon-owned. It stores credentials and nonsecret connection metadata once, runs browser authorization/recovery, records requested and approved scopes, and never sends secrets to a client.
- **Forge / Git hosting** is host-configured and workspace-resolved from the git remote. It owns source-control operations such as PRs, issues, checks, and repository discovery. It is not an agent MCP tool by default.
- **Kanban** is a project-scoped board target. It uses the appropriate vendor integration but owns board configuration and board mutations, not a duplicate arbitrary token UI.
- **Connectors** are host-installed, agent-facing MCP capabilities. They expose real tool catalogs, per-tool enablement, and provider-capability routing. A GitHub or Atlassian connector may coexist with Forge/Kanban, but it is not a competing source of workspace or board truth.

The delivery work is to preserve the separation deliberately: Forge and Kanban are Otto-controlled and capability-gated product integrations; Connectors are free-form, agent-facing MCP capabilities. They may reuse daemon security and authorization machinery, but they do not share credentials, configuration, workspace truth, board truth, or permissions by default.

### 0.9.0-beta.3 — Connectors: real, complete, and tested

Complete [[connectors]] for every Connector already added to Otto’s catalog:

- implement every required setup shape through the Connectors UI, with ordered labelled fields and credential issue links rather than configuration-file or terminal instructions;
- reverify each catalog entry against its vendor documentation, remove or hold anything that no longer has a trustworthy endpoint, and resolve known transport/auth uncertainty before calling a row supported;
- preserve add-time connect-and-enumerate verification, secret redaction, per-tool enablement, permission posture, and clear remediation;
- add automated catalog, setup-shape, OAuth/token/client-credential, tool-enumeration, scope/operation-map, and MCP transport tests for every supported row, with live vendor or sandbox proof where possible and recorded actual outcomes for vendor-gated services;
- include an Otto-native connector only after it is explicitly selected and its ongoing API/token-economy ownership is accepted.

**Exit:** every advertised Connector is an actual integration a user can configure and verify in Otto, with an inspectable tool/capability/scope ledger and evidence that its tools reach every capable provider path. A catalog entry that cannot meet this bar is absent or visibly held back, never aspirational.

### 0.9.0-beta.4 — Brain runtime foundation

Execute Phase 0–2 of [[managed-model-server-runtimes]]:

- publish the runtime-driver contract, capability matrix, and semantic host tests;
- extract llama.cpp behind driver one with no user-visible regression;
- make Brain host/UI capability-driven, including model artifact/bundle and benchmark provenance where the driver owns them;
- complete the directly necessary parts of [[brain-model-bundles]] and [[brain-coding-capabilities]] so models, tool-result images, operations, and reports do not become llama-specific assumptions.

**Gate:** llama.cpp parity passes, and vLLM’s initial packaging, artifact source, Linux/NVIDIA support matrix, and operator recovery path are documented and proven by a narrow spike. No vLLM implementation begins before this gate.

### 0.9.0-beta.5 — managed vLLM

Ship vLLM as the first additional managed runtime on the declared initial matrix. It must meet the entire managed-runtime capability floor: install/verify/remove, compatible artifacts, load/switch/unload, stable endpoint and lifecycle, Otto security/remote control, diagnostics, capability disclosure, capacity/benchmark provenance, and normal agentic tooling.

**Exit:** vLLM is not merely an external endpoint; Otto installs and operates it end-to-end with the same durable Brain host contract.

### 0.9.0-rc.1 — managed SGLang and release hardening

Ship SGLang under the same driver contract and explicit matrix. Run cross-runtime semantic and failure-path tests for llama.cpp, vLLM, and SGLang; execute the module completion matrix; perform real-provider/local-AI journeys; and resolve release blockers only.

**Exit:** every supported runtime and 0.9 module passes its declared contract. No new product scope enters after this point.

## 1.0 entry criteria

- The four operational modules have proven, navigable core journeys with state recovery and provider/host failure clarity.
- Workflows use the explicit Otto surface and cannot accidentally create uncontrolled provider-native fan-out.
- Project Knowledge and Context Management form a truthful review and context-selection loop.
- llama.cpp, vLLM, and SGLang satisfy the managed-host floor on their published support matrices.
- Protocol compatibility, capability gates, targeted unit suites, T1 module coverage, and T2/local or controlled live-daemon proof are green.
- Documentation records the durable product contracts and support matrices.

## Adjacent charter triage

**Included as dependencies:** [[agent-orchestration]], [[graph-templates]] (starter catalog and measurement prerequisites only), [[managed-model-server-runtimes]], [[brain-model-bundles]], [[brain-coding-capabilities]], [[e2e-qa-coverage]], provider-neutral capability parity, and the Kanban GitHub/Jira credential and project-target requirements.

**Explicitly deferred unless they directly unblock an exit:** broad connector-catalog expansion, deep benchmark mode and automatic model routing, AI-authored graph generation, broad graph-template experimentation, new tracker providers, and unrelated UI/refactor charters.

## Risks

- Runtime integration has engine-specific implementation risks. Address them within each driver while preserving the generalized Brain contract; do not expose those internal differences as competing product surfaces.
- Cross-module schedule targets expand the security and audit boundary. Add only targets with a durable run record and explicit unattended policy.
- A release with unverified orchestration spawn/wait behavior, Kanban live-provider behavior, or context accounting would be a demo, not a 1.0 foundation.
- The train must resist adjacent-charter gravity. The completion matrix, not the backlog size, decides readiness.

## Release evidence governance

The completion matrix is executable, not narrative. A module may not be declared complete because a screen renders, a code path exists, or one unit test passes.

For every user-facing module assertion, its feature charter must name:

1. the user journey and failure/recovery journey;
2. deterministic T1 proof at the appropriate store/service/protocol/UI layers;
3. controlled T2 or live-daemon proof whenever model execution, rendering, restart, provider behavior, or daemon coordination is material;
4. platform proof where web, Electron, and native differ;
5. the capability/old-host boundary and backward-compatible parser coverage;
6. the documentation claim that becomes permissible only after evidence passes.

The [[e2e-qa-coverage]] matrix holds the executable T1/T2 mapping. Test evidence records commands, environment and actual outcome; a screen review, an unrun test, or model prose is not release proof. Model tests assert observable side effects, not wording. Documentation is release-checked against the completed journey evidence, so the manual cannot promise an unfinished capability.

A feature’s delivery metric is evidence-led: it advances only for a completed, proportionally proven charter slice; it remains partial while any required decision, recovery path, compatibility boundary, or documentation claim lacks proof.

## Timeline

- time: "2026-08-26T23:24:52.003Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["agent-orchestration","graph-templates","managed-model-server-runtimes","brain-model-bundles","brain-coding-capabilities","e2e-qa-coverage"]
- time: "2026-08-26T23:24:52.003Z"
  kind: "evidence"
  summary: "User requested a realistic 0.9 version plan on 2026-08-26, covering the final operational modules (Workflows/Orchestrations, Artifacts, Schedules, Kanban), Project Knowledge, Context Management, and additional Otto Brain runtimes. The plan was reconciled with the active project-charter inventory and is intentionally recorded as proposed pending user review."
- time: "2026-08-26T23:28:34.495Z"
  kind: "decision"
  summary: "User clarified on 2026-08-26 that Workflows is the new product name; this corrects the release plan’s terminology and scopes provider-native naming collision protection."
  source: "User direction, 2026-08-26"
- time: "2026-08-26T23:36:49.218Z"
  kind: "decision"
  summary: "User added Connectors as a 0.9 completion commitment after Project Knowledge and requested a concrete inventory of the known project outcomes and work. The proposed release plan now defines connector completion and inserts it before Brain."
  source: "User direction, 2026-08-26"
- time: "2026-08-26T23:54:53.431Z"
  kind: "decision"
  summary: "User confirmed 0.9 includes both AI and visual Graph Workflows; schedules must run agents, saved Workflows, and artifact updates that preserve artifact design; every catalog Connector needs tool, scope, test, and integration-ownership coverage."
  source: "User direction, 2026-08-26"
- time: "2026-08-27T00:09:03.611Z"
  kind: "decision"
  summary: "User clarified artifact storage ownership, Kanban’s minimal practical editing scope, evidence-backed architectural-document initialization, and cross-platform local or remote Brain operation."
  source: "User direction, 2026-08-26"
  affects: ["connectors","managed-model-server-runtimes"]
- time: "2026-08-27T00:22:06.438Z"
  kind: "decision"
  summary: "User decided Forge and Kanban remain controlled/gated and separate from free-form Connectors; confirmed Kanban’s practical editable-field baseline; clarified artifacts are not moved between projects; and simplified Brain to one generalized Otto → Brain → runtime-driver contract."
  source: "User direction, 2026-08-26"
  affects: ["connectors","managed-model-server-runtimes","brain-host-control","brain-console"]
- time: "2026-08-27T00:24:54.165Z"
  kind: "decision"
  summary: "User clarified that runtime-specific complexity belongs inside the vLLM and SGLang driver work and should be tackled during implementation, without complicating Otto Brain’s generalized product contract."
  source: "User direction, 2026-08-26"
  affects: ["managed-model-server-runtimes"]
- time: "2026-08-27T00:28:06.092Z"
  kind: "decision"
  summary: "User clarified that AI versus Graph Workflows is an execution-control distinction, not a visual distinction: AI Workflows are open-ended agentic orchestration using Otto MCP tools, while Graph Workflows are predetermined deterministic graphs. Both require Workflow visualizers."
  source: "User direction, 2026-08-26"
  affects: ["agent-orchestration","graph-templates"]
- time: "2026-08-27T00:30:59.644Z"
  kind: "decision"
  summary: "User clarified the authoring boundary: AI Workflows use a basic dialog editor for prompt and configuration but have no graph editor; deterministic Graph Workflows have the graph editor. Both use Workflow visualizers."
  source: "User direction, 2026-08-26"
  affects: ["agent-orchestration","graph-templates"]
- time: "2026-08-27T00:35:43.554Z"
  kind: "decision"
  summary: "User established the 0.9 master charter as the release command center and requested one linked feature charter per 0.9 module."
  source: "User direction, 2026-08-26"
  affects: ["workflows","artifacts","schedules","kanban","project-knowledge-context-management","connectors","managed-model-server-runtimes","e2e-qa-coverage"]
- time: "2026-08-27T00:35:44.359Z"
  kind: "note"
  summary: "User explicitly approved this charter as the official 0.9 release plan and command center. New status: confirmed."
- time: "2026-08-27T02:00:57.528Z"
  kind: "decision"
  summary: "User directed the 0.9 plan to define completion through an end-user capability contract for every module, so the release can answer whether its plan and documented product surface are complete."
  source: "User direction, 2026-08-26; reconciled with the existing 0.9 completion inventory and [[e2e-qa-coverage]] proof model."
- time: "2026-08-27T02:07:02.800Z"
  kind: "decision"
  summary: "User requested the project charters absorb the capability-evaluation and testing insights. The master charter now requires each module to pass a current-state claim audit before end-user acceptance proof, and distinguishes a complete plan from a proven feature."
- time: "2026-08-27T02:07:06.328Z"
  kind: "decision"
  summary: "The user requested a charter-level testing standard. Added release evidence governance so every 0.9 module measures completion through user journeys, T1/T2/platform proof, compatibility checks, and documentation traceability."
  source: "User direction, 2026-08-26; docs/testing.md; feature-charter completion-ledger review."
- time: "2026-08-27T02:15:07.651Z"
  kind: "decision"
  summary: "Phase 1 audit added the executable 0.9 completion matrix, tying every module’s core journey to verified baseline evidence, required proof, recovery behavior, and an explicit non-green verdict."
  source: "Phase 1 release-completion audit, 2026-08-27"
  affects: ["workflows","artifacts","schedules","kanban","project-knowledge-context-management","connectors","managed-model-server-runtimes","e2e-qa-coverage"]
- time: "2026-08-27T02:16:13.995Z"
  kind: "note"
  summary: "Phase 1 completion matrix and QA proof map are implemented and the existing coverage checker is green, but the required new T1/T2/T3 journeys and non-legacy coverage-matrix migration remain open; no release milestone is yet complete."
  affects: ["release-0-9-product-completion"]
- time: "2026-08-28T04:05:31.069Z"
  kind: "decision"
  summary: "Remove a wiki link to a proposed decision from confirmed release truth while preserving the provider-neutral capability-parity requirement."
  source: "Knowledge link integrity repair, 2026-08-27"
- time: "2026-08-29T14:02:43.156Z"
  kind: "decision"
  summary: "The product owner clarified the cross-module contract: Knowledge, Artifacts, Schedules, and Workflows each have independent global defaults and project overrides, backed by shared storage-resolution infrastructure. Status returned to proposed for review."
  source: "Product-owner clarification, 2026-08-29."
  affects: ["artifacts","schedules","workflows","project-knowledge-context-management"]
- time: "2026-08-29T14:02:53.325Z"
  kind: "note"
  summary: "The product owner explicitly corrected and confirmed the cross-module storage policy for Knowledge, Artifacts, Schedules, and Workflows. New status: confirmed."
- time: "2026-08-29T18:55:39.282Z"
  kind: "decision"
  summary: "The Workflow charter now has verified browser lifecycle evidence and a controlled real-provider AI declaration/fan-out proof; the release matrix must no longer call the entire product journey unproven. Status returned to proposed for review."
  source: "[[workflows]] evidence, verified 2026-08-29; controlled isolated Sonnet 5 low-effort run run_mteqm9v7_1c6a9cc6."
  affects: ["workflows","e2e-qa-coverage"]
- time: "2026-08-29T18:55:46.056Z"
  kind: "evidence"
  summary: "The Workflow release row now has a controlled real-provider proof in addition to focused T1 browser coverage: an isolated temporary daemon ran a Claude Sonnet 5 low-effort conductor that used `start_workflow` to declare one `fanOut: 2` research phase. Durable run `run_mteqm9v7_1c6a9cc6` completed with two managed workers. This advances the row from wholly unproven to partially proven; it does not meet the 0.9 completion bar because AI gate/deliver, provider-failure recovery, normal external-daemon proof, storage/settings, and sharing/import remain open."
  source: "2026-08-29 Workflow controlled provider proof"
  affects: ["workflows","e2e-qa-coverage"]
- time: "2026-08-29T18:56:29.553Z"
  kind: "note"
  summary: "The release-row correction accurately reflects the confirmed Workflow evidence while retaining all remaining completion gates. The owner authorized confirmation of truthful verified facts. New status: confirmed."
- time: "2026-08-29T20:20:42.261Z"
  kind: "evidence"
  summary: "Wave 2A passed the AI Workflow provider-failure reliability proof with deterministic mocks only: post-declaration provider failure is durable, actionable in Runs, and proven through an external client-to-daemon WebSocket plus browser UI journey. This is not a paid-provider certification or a general recovery/retry implementation."
  source: "Wave 2A targeted verification, 2026-08-29"
  affects: ["workflows"]
- time: "2026-08-29T22:49:12.564Z"
  kind: "evidence"
  summary: "Wave 4B evidence: saved Graph Workflow Schedule adapter verified. It resolves only the selected project’s definitions directory, rejects legacy/global, starter, missing, host/project-provenance-mismatched, unavailable, unsupported, and failed-start targets with repairable history; it launches the ordinary graph Workflow path with schedule source and audit fingerprint/linkage. Targeted server/app typechecks, lint, and six focused Vitest files (151 tests) passed. This is narrow adapter evidence only, not a release-wide completion claim."
  source: "Wave 4B source and targeted executable verification, 2026-08-29"
  affects: ["workflows","schedules"]
- time: "2026-08-29T22:54:07.103Z"
  kind: "decision"
  summary: "Reconciled the release matrix with verified Waves 2A, 3A, 4A, and 4B evidence. The rows now distinguish the proven saved-Graph Schedule slice and project-store Graph sharing from remaining storage, target, routing, and provider work. Status returned to proposed for review."
  source: "Cross-wave integration audit and targeted verification, 2026-08-29"
  affects: ["workflows","schedules","e2e-qa-coverage"]
- time: "2026-08-29T22:54:30.524Z"
  kind: "note"
  summary: "The product owner previously authorized confirmation of verified Workflow facts. This reconciliation records only source-audited and targeted-test-backed Wave 2A/3A/4A/4B outcomes and leaves remaining work explicit. New status: confirmed."
- time: "2026-08-29T22:55:02.751Z"
  kind: "evidence"
  summary: "Wave 4B final verification correction, 2026-08-29: the completed saved-Graph Workflow Schedule adapter pass ran 7 focused Vitest files with 158 tests, superseding the earlier provisional 151-test count in the Wave 4B evidence. Targeted format/lint and app typecheck passed. Server typecheck remains blocked by unrelated dirty `packages/server/src/server/session.ts:11543` (`Logger` missing), which this slice did not modify."
  source: "Wave 4B final agent report, 2026-08-29"
  affects: ["workflows","schedules","release-0-9-product-completion"]
- time: "2026-08-29T23:07:44.519Z"
  kind: "evidence"
  summary: "## WAVE 5B — verified Workflow provider/runtime matrix\n\nThe new [[workflow-provider-proof-matrix]] documentation record has been reconciled with the current profile and adapter capability model.\n\nVerified rows only:\n\n| Release assertion | Evidence | Verdict |\n| --- | --- | --- |\n| Profile-backed role resolution, managed worker spawn, human gate, cancellation, no-plan error, and daemon-restart recovery | Focused deterministic server tests passed on 2026-08-29 | Proven mechanics |\n| Claude Graph authority | Focused adapter tests plus previously recorded controlled Sonnet fan-out proof | Representative live path proven |\n| Codex Graph authority | Focused adapter tests plus previously recorded controlled Luna attended-gate proof | Representative live path proven; `none` access is refused |\n| Native OpenAI-compatible/local authority | Focused adapter tests passed | Mechanically supported; controlled local Workflow declaration remains unproven |\n| ACP, Pi, OpenCode, and OMP Workflow runtimes | Capability inspection | Explicitly capability-limited or unproven; no provider-native fallback |\n\nNo paid-provider command ran during this wave. The broad provider/runtime requirement in the [[workflows]] release row remains partial until the local controlled Workflow fixture and named ACP/native runtime proofs exist. An attempted isolated Chromium rerun stalled before test execution, so it did not upgrade the existing history/Visualizer evidence."
  source: "WAVE 5B Workflow provider/runtime proof matrix, 2026-08-29"
  affects: ["workflows","e2e-qa-coverage"]
- time: "2026-08-29T23:18:17.907Z"
  kind: "decision"
  summary: "Final Artifact 0.9 audit corrected the release matrix to distinguish the verified browser preview-security proof from the still-unproven lifecycle journey and controlled generation evidence. Status returned to proposed for review."
  source: "Artifact 0.9 final release audit, 2026-08-29"
  affects: ["artifacts","e2e-qa-coverage"]
- time: "2026-08-29T23:18:48.696Z"
  kind: "note"
  summary: "User explicitly requested this final verified release audit. The release matrix correction only distinguishes existing Artifact preview-security proof from still-open lifecycle proof. New status: confirmed."
- time: "2026-08-30T01:18:05.541Z"
  kind: "evidence"
  summary: "Workflow storage advanced with targeted evidence only: independent gated Host/Project settings, stable project-scope provenance, durable pre-launch run snapshots, pinned follow-up writes, legacy-source visibility, and remote-host remediation copy are implemented and tested. Project-scoped template/definition writers, cross-store aggregation, verified transfer receipts, and corruption repair remain incomplete. The 0.9 release remains in build and is not complete."
  source: "Workflow storage vertical slice, 2026-08-29"
  affects: ["workflows","schedules","artifacts"]
- time: "2026-08-30T02:36:07.680Z"
  kind: "evidence"
  summary: "2026-08-29: Partial Workflow storage evidence added, not release closure: independent Workflow settings, project-stamped graph/template/run writers, durable verified transfer receipts, collision/source-retention recovery, and targeted protocol/server/app checks are now in place. End-user aggregate browsing and repair/export proof remain open, so neither Workflows nor 0.9 is complete."
- time: "2026-09-04T00:43:48.414Z"
  kind: "evidence"
  summary: "Release-readiness evaluation at `origin/main` commit `530fdef35e86ba8ab3f34d555954828f4b1bf785`: the checkout is clean and aligned with origin, but the required CI run 33807528943 is red. Fifteen jobs failed, including lint, app tests, desktop tests on Ubuntu and Windows, server tests, one CLI shard, the desktop-overlay Playwright job, and seven browser Playwright shards. The lint job fails before dependency installation because the live E2E coverage matrix has one stale `sidebar-resize-handle.spec.ts` row and eighteen unclaimed spec files. The app-test failure includes deterministic assertion drift in Settings storage and workspace-pane tests, plus a missing headless-shell browser in the Vitest browser provider. `npm run acp:version-drift:check` reports 12 stale package-runner catalog pins; release policy requires each to be updated or explicitly classified as intentional. No `0.9` changelog entry exists. The seven-module completion matrix remains the release gate: each named module is still in build or partial with required end-user/T1/T2/T3 proof outstanding. This is release-blocking evidence, not a change to scope or delivery status."
  source: "Release-readiness evaluation, 2026-09-03; origin/main 530fdef35e86ba8ab3f34d555954828f4b1bf785; GitHub Actions run 33807528943; npm run acp:version-drift:check."
  affects: ["e2e-qa-coverage","workflows","artifacts","schedules","kanban","project-knowledge-context-management","connectors","managed-model-server-runtimes"]

## Timeline

- time: "2026-08-26T23:24:52.003Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["agent-orchestration","graph-templates","managed-model-server-runtimes","brain-model-bundles","brain-coding-capabilities","e2e-qa-coverage"]
- time: "2026-08-26T23:24:52.003Z"
  kind: "evidence"
  summary: "User requested a realistic 0.9 version plan on 2026-08-26, covering the final operational modules (Workflows/Orchestrations, Artifacts, Schedules, Kanban), Project Knowledge, Context Management, and additional Otto Brain runtimes. The plan was reconciled with the active project-charter inventory and is intentionally recorded as proposed pending user review."
- time: "2026-08-26T23:28:34.495Z"
  kind: "decision"
  summary: "User clarified on 2026-08-26 that Workflows is the new product name; this corrects the release plan’s terminology and scopes provider-native naming collision protection."
  source: "User direction, 2026-08-26"
- time: "2026-08-26T23:36:49.218Z"
  kind: "decision"
  summary: "User added Connectors as a 0.9 completion commitment after Project Knowledge and requested a concrete inventory of the known project outcomes and work. The proposed release plan now defines connector completion and inserts it before Brain."
  source: "User direction, 2026-08-26"
- time: "2026-08-26T23:54:53.431Z"
  kind: "decision"
  summary: "User confirmed 0.9 includes both AI and visual Graph Workflows; schedules must run agents, saved Workflows, and artifact updates that preserve artifact design; every catalog Connector needs tool, scope, test, and integration-ownership coverage."
  source: "User direction, 2026-08-26"
- time: "2026-08-27T00:09:03.611Z"
  kind: "decision"
  summary: "User clarified artifact storage ownership, Kanban’s minimal practical editing scope, evidence-backed architectural-document initialization, and cross-platform local or remote Brain operation."
  source: "User direction, 2026-08-26"
  affects: ["connectors","managed-model-server-runtimes"]
- time: "2026-08-27T00:22:06.438Z"
  kind: "decision"
  summary: "User decided Forge and Kanban remain controlled/gated and separate from free-form Connectors; confirmed Kanban’s practical editable-field baseline; clarified artifacts are not moved between projects; and simplified Brain to one generalized Otto → Brain → runtime-driver contract."
  source: "User direction, 2026-08-26"
  affects: ["connectors","managed-model-server-runtimes","brain-host-control","brain-console"]
- time: "2026-08-27T00:24:54.165Z"
  kind: "decision"
  summary: "User clarified that runtime-specific complexity belongs inside the vLLM and SGLang driver work and should be tackled during implementation, without complicating Otto Brain’s generalized product contract."
  source: "User direction, 2026-08-26"
  affects: ["managed-model-server-runtimes"]
- time: "2026-08-27T00:28:06.092Z"
  kind: "decision"
  summary: "User clarified that AI versus Graph Workflows is an execution-control distinction, not a visual distinction: AI Workflows are open-ended agentic orchestration using Otto MCP tools, while Graph Workflows are predetermined deterministic graphs. Both require Workflow visualizers."
  source: "User direction, 2026-08-26"
  affects: ["agent-orchestration","graph-templates"]
- time: "2026-08-27T00:30:59.644Z"
  kind: "decision"
  summary: "User clarified the authoring boundary: AI Workflows use a basic dialog editor for prompt and configuration but have no graph editor; deterministic Graph Workflows have the graph editor. Both use Workflow visualizers."
  source: "User direction, 2026-08-26"
  affects: ["agent-orchestration","graph-templates"]
- time: "2026-08-27T00:35:43.554Z"
  kind: "decision"
  summary: "User established the 0.9 master charter as the release command center and requested one linked feature charter per 0.9 module."
  source: "User direction, 2026-08-26"
  affects: ["workflows","artifacts","schedules","kanban","project-knowledge-context-management","connectors","managed-model-server-runtimes","e2e-qa-coverage"]
- time: "2026-08-27T00:35:44.359Z"
  kind: "note"
  summary: "User explicitly approved this charter as the official 0.9 release plan and command center. New status: confirmed."
- time: "2026-08-27T02:00:57.528Z"
  kind: "decision"
  summary: "User directed the 0.9 plan to define completion through an end-user capability contract for every module, so the release can answer whether its plan and documented product surface are complete."
  source: "User direction, 2026-08-26; reconciled with the existing 0.9 completion inventory and [[e2e-qa-coverage]] proof model."
- time: "2026-08-27T02:07:02.800Z"
  kind: "decision"
  summary: "User requested the project charters absorb the capability-evaluation and testing insights. The master charter now requires each module to pass a current-state claim audit before end-user acceptance proof, and distinguishes a complete plan from a proven feature."
- time: "2026-08-27T02:07:06.328Z"
  kind: "decision"
  summary: "The user requested a charter-level testing standard. Added release evidence governance so every 0.9 module measures completion through user journeys, T1/T2/platform proof, compatibility checks, and documentation traceability."
  source: "User direction, 2026-08-26; docs/testing.md; feature-charter completion-ledger review."
- time: "2026-08-27T02:15:07.651Z"
  kind: "decision"
  summary: "Phase 1 audit added the executable 0.9 completion matrix, tying every module’s core journey to verified baseline evidence, required proof, recovery behavior, and an explicit non-green verdict."
  source: "Phase 1 release-completion audit, 2026-08-27"
  affects: ["workflows","artifacts","schedules","kanban","project-knowledge-context-management","connectors","managed-model-server-runtimes","e2e-qa-coverage"]
- time: "2026-08-27T02:16:13.995Z"
  kind: "note"
  summary: "Phase 1 completion matrix and QA proof map are implemented and the existing coverage checker is green, but the required new T1/T2/T3 journeys and non-legacy coverage-matrix migration remain open; no release milestone is yet complete."
  affects: ["release-0-9-product-completion"]
- time: "2026-08-28T04:05:31.069Z"
  kind: "decision"
  summary: "Remove a wiki link to a proposed decision from confirmed release truth while preserving the provider-neutral capability-parity requirement."
  source: "Knowledge link integrity repair, 2026-08-27"
- time: "2026-08-29T14:02:43.156Z"
  kind: "decision"
  summary: "The product owner clarified the cross-module contract: Knowledge, Artifacts, Schedules, and Workflows each have independent global defaults and project overrides, backed by shared storage-resolution infrastructure. Status returned to proposed for review."
  source: "Product-owner clarification, 2026-08-29."
  affects: ["artifacts","schedules","workflows","project-knowledge-context-management"]
- time: "2026-08-29T14:02:53.325Z"
  kind: "note"
  summary: "The product owner explicitly corrected and confirmed the cross-module storage policy for Knowledge, Artifacts, Schedules, and Workflows. New status: confirmed."
- time: "2026-08-29T18:55:39.282Z"
  kind: "decision"
  summary: "The Workflow charter now has verified browser lifecycle evidence and a controlled real-provider AI declaration/fan-out proof; the release matrix must no longer call the entire product journey unproven. Status returned to proposed for review."
  source: "[[workflows]] evidence, verified 2026-08-29; controlled isolated Sonnet 5 low-effort run run_mteqm9v7_1c6a9cc6."
  affects: ["workflows","e2e-qa-coverage"]
- time: "2026-08-29T18:55:46.056Z"
  kind: "evidence"
  summary: "The Workflow release row now has a controlled real-provider proof in addition to focused T1 browser coverage: an isolated temporary daemon ran a Claude Sonnet 5 low-effort conductor that used `start_workflow` to declare one `fanOut: 2` research phase. Durable run `run_mteqm9v7_1c6a9cc6` completed with two managed workers. This advances the row from wholly unproven to partially proven; it does not meet the 0.9 completion bar because AI gate/deliver, provider-failure recovery, normal external-daemon proof, storage/settings, and sharing/import remain open."
  source: "2026-08-29 Workflow controlled provider proof"
  affects: ["workflows","e2e-qa-coverage"]
- time: "2026-08-29T18:56:29.553Z"
  kind: "note"
  summary: "The release-row correction accurately reflects the confirmed Workflow evidence while retaining all remaining completion gates. The owner authorized confirmation of truthful verified facts. New status: confirmed."
- time: "2026-08-29T20:20:42.261Z"
  kind: "evidence"
  summary: "Wave 2A passed the AI Workflow provider-failure reliability proof with deterministic mocks only: post-declaration provider failure is durable, actionable in Runs, and proven through an external client-to-daemon WebSocket plus browser UI journey. This is not a paid-provider certification or a general recovery/retry implementation."
  source: "Wave 2A targeted verification, 2026-08-29"
  affects: ["workflows"]
- time: "2026-08-29T22:49:12.564Z"
  kind: "evidence"
  summary: "Wave 4B evidence: saved Graph Workflow Schedule adapter verified. It resolves only the selected project’s definitions directory, rejects legacy/global, starter, missing, host/project-provenance-mismatched, unavailable, unsupported, and failed-start targets with repairable history; it launches the ordinary graph Workflow path with schedule source and audit fingerprint/linkage. Targeted server/app typechecks, lint, and six focused Vitest files (151 tests) passed. This is narrow adapter evidence only, not a release-wide completion claim."
  source: "Wave 4B source and targeted executable verification, 2026-08-29"
  affects: ["workflows","schedules"]
- time: "2026-08-29T22:54:07.103Z"
  kind: "decision"
  summary: "Reconciled the release matrix with verified Waves 2A, 3A, 4A, and 4B evidence. The rows now distinguish the proven saved-Graph Schedule slice and project-store Graph sharing from remaining storage, target, routing, and provider work. Status returned to proposed for review."
  source: "Cross-wave integration audit and targeted verification, 2026-08-29"
  affects: ["workflows","schedules","e2e-qa-coverage"]
- time: "2026-08-29T22:54:30.524Z"
  kind: "note"
  summary: "The product owner previously authorized confirmation of verified Workflow facts. This reconciliation records only source-audited and targeted-test-backed Wave 2A/3A/4A/4B outcomes and leaves remaining work explicit. New status: confirmed."
- time: "2026-08-29T22:55:02.751Z"
  kind: "evidence"
  summary: "Wave 4B final verification correction, 2026-08-29: the completed saved-Graph Workflow Schedule adapter pass ran 7 focused Vitest files with 158 tests, superseding the earlier provisional 151-test count in the Wave 4B evidence. Targeted format/lint and app typecheck passed. Server typecheck remains blocked by unrelated dirty `packages/server/src/server/session.ts:11543` (`Logger` missing), which this slice did not modify."
  source: "Wave 4B final agent report, 2026-08-29"
  affects: ["workflows","schedules","release-0-9-product-completion"]
- time: "2026-08-29T23:07:44.519Z"
  kind: "evidence"
  summary: "## WAVE 5B — verified Workflow provider/runtime matrix\n\nThe new [[workflow-provider-proof-matrix]] documentation record has been reconciled with the current profile and adapter capability model.\n\nVerified rows only:\n\n| Release assertion | Evidence | Verdict |\n| --- | --- | --- |\n| Profile-backed role resolution, managed worker spawn, human gate, cancellation, no-plan error, and daemon-restart recovery | Focused deterministic server tests passed on 2026-08-29 | Proven mechanics |\n| Claude Graph authority | Focused adapter tests plus previously recorded controlled Sonnet fan-out proof | Representative live path proven |\n| Codex Graph authority | Focused adapter tests plus previously recorded controlled Luna attended-gate proof | Representative live path proven; `none` access is refused |\n| Native OpenAI-compatible/local authority | Focused adapter tests passed | Mechanically supported; controlled local Workflow declaration remains unproven |\n| ACP, Pi, OpenCode, and OMP Workflow runtimes | Capability inspection | Explicitly capability-limited or unproven; no provider-native fallback |\n\nNo paid-provider command ran during this wave. The broad provider/runtime requirement in the [[workflows]] release row remains partial until the local controlled Workflow fixture and named ACP/native runtime proofs exist. An attempted isolated Chromium rerun stalled before test execution, so it did not upgrade the existing history/Visualizer evidence."
  source: "WAVE 5B Workflow provider/runtime proof matrix, 2026-08-29"
  affects: ["workflows","e2e-qa-coverage"]
- time: "2026-08-29T23:18:17.907Z"
  kind: "decision"
  summary: "Final Artifact 0.9 audit corrected the release matrix to distinguish the verified browser preview-security proof from the still-unproven lifecycle journey and controlled generation evidence. Status returned to proposed for review."
  source: "Artifact 0.9 final release audit, 2026-08-29"
  affects: ["artifacts","e2e-qa-coverage"]
- time: "2026-08-29T23:18:48.696Z"
  kind: "note"
  summary: "User explicitly requested this final verified release audit. The release matrix correction only distinguishes existing Artifact preview-security proof from still-open lifecycle proof. New status: confirmed."
- time: "2026-08-30T01:18:05.541Z"
  kind: "evidence"
  summary: "Workflow storage advanced with targeted evidence only: independent gated Host/Project settings, stable project-scope provenance, durable pre-launch run snapshots, pinned follow-up writes, legacy-source visibility, and remote-host remediation copy are implemented and tested. Project-scoped template/definition writers, cross-store aggregation, verified transfer receipts, and corruption repair remain incomplete. The 0.9 release remains in build and is not complete."
  source: "Workflow storage vertical slice, 2026-08-29"
  affects: ["workflows","schedules","artifacts"]
- time: "2026-08-30T02:36:07.680Z"
  kind: "evidence"
  summary: "2026-08-29: Partial Workflow storage evidence added, not release closure: independent Workflow settings, project-stamped graph/template/run writers, durable verified transfer receipts, collision/source-retention recovery, and targeted protocol/server/app checks are now in place. End-user aggregate browsing and repair/export proof remain open, so neither Workflows nor 0.9 is complete."
- time: "2026-09-04T00:43:48.414Z"
  kind: "evidence"
  summary: "Release-readiness evaluation at `origin/main` commit `530fdef35e86ba8ab3f34d555954828f4b1bf785`: the checkout is clean and aligned with origin, but the required CI run 33807528943 is red. Fifteen jobs failed, including lint, app tests, desktop tests on Ubuntu and Windows, server tests, one CLI shard, the desktop-overlay Playwright job, and seven browser Playwright shards. The lint job fails before dependency installation because the live E2E coverage matrix has one stale `sidebar-resize-handle.spec.ts` row and eighteen unclaimed spec files. The app-test failure includes deterministic assertion drift in Settings storage and workspace-pane tests, plus a missing headless-shell browser in the Vitest browser provider. `npm run acp:version-drift:check` reports 12 stale package-runner catalog pins; release policy requires each to be updated or explicitly classified as intentional. No `0.9` changelog entry exists. The seven-module completion matrix remains the release gate: each named module is still in build or partial with required end-user/T1/T2/T3 proof outstanding. This is release-blocking evidence, not a change to scope or delivery status."
  source: "Release-readiness evaluation, 2026-09-03; origin/main 530fdef35e86ba8ab3f34d555954828f4b1bf785; GitHub Actions run 33807528943; npm run acp:version-drift:check."
  affects: ["e2e-qa-coverage","workflows","artifacts","schedules","kanban","project-knowledge-context-management","connectors","managed-model-server-runtimes"]
- time: "2026-09-04T01:05:28.407Z"
  kind: "decision"
  summary: "User clarified on 2026-09-03 that 0.9.0 is the first stable release in the 0.9.x completion train; every planned module is not required in 0.9.0, and the full completion bar belongs to 1.0.0. Status returned to proposed for review."
  source: "User direction, 2026-09-03."
