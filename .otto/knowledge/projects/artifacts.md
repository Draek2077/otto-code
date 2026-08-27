---
id: "artifacts"
kind: "project"
title: "Artifacts"
status: "confirmed"
tags: ["artifacts","storage","generation","v0.9"]
delivery_status: "in_build"
progress_completed: 1
progress_total: 5
progress_unit: "0.9 delivery slices"
created_at: "2026-08-27T00:35:26.705Z"
updated_at: "2026-08-27T02:07:05.530Z"
---
# Artifacts

<!-- compiled_truth -->

# Artifacts

## Outcome

Artifacts are durable AI-created project deliverables. They have no fixed product taxonomy: their content defines them. Each artifact belongs to one project and follows that project’s repository versus host-local ownership policy. Repository artifacts live under `.otto/artifacts`; host-local artifacts live in Otto’s project storage on the daemon host.

## Verified baseline

- The daemon has a file-backed HTML artifact store, background generation, a generation watcher, status, cancellation, regeneration, retained generation transcripts, bounded run history, and metadata editing.
- The app has an aggregate library with project filtering, cards, creation/editing, preview, status/error display, cancellation, regeneration, deletion, and a read-only generation-chat entry point when the host supports retained transcripts.
- The generator requires one self-contained HTML document. The watcher sanitizes output and installs an Otto-owned CSP. Web uses a sandboxed iframe, Electron uses an isolated `webview` session, and native uses a restricted WebView.
- The `otto-artifact-data` JSON block is the explicit data-update seam. `update_artifact_data` replaces only that block and never rewrites the HTML, CSS, or JavaScript; artifacts without the block require regeneration.
- Existing targeted T1 proof covers store run-history compatibility and id traversal rejection, data-block byte preservation, CSP canonicalization, and app-side project derivation.

## Adversarial gap review

The storage contract is not yet met. `ArtifactService` is constructed at `$OTTO_HOME` for both session RPCs and daemon agent tools, so all artifact files currently land in `$OTTO_HOME/.otto/artifacts` regardless of the artifact’s `projectId`. The aggregate library consequently sees one host-global directory rather than project-owned stores. The current data-model documentation still states the earlier repository-only path and is stale.

The watcher is generation-scoped only. It does not durably observe externally edited ready artifacts, and startup only logs stale `generating` records instead of resolving them to a recoverable state. Metadata contains generation-provider details and run records, but not resolved storage location or durable source provenance for a Chat, Workflow, or Schedule. The client can preview in a dialog and may open an artifact tab, but it does not disclose storage location or a supported sharing/open lifecycle. There is no migration or dual-read plan for the existing host-global store.

The current artifact capability is the pre-0.9 generic `artifacts` gate. A storage-policy client surface requires a new additive capability and a centralized unavailable state. The protocol has no storage-location or source-provenance fields, and there are no session/service/UI or T2 controlled-generation proofs for the 0.9 journey.

## 0.9 delivery inventory

### 1. Ownership, storage, and migration

- Resolve an artifact store from the project root and the project’s repository versus host-local ownership policy, using worktree-aware project-root resolution.
- Repository location: `<projectRoot>/.otto/artifacts`. Host location: a stable, project-keyed directory under Otto’s host project-artifacts storage.
- Keep the project root, resolved storage location, and store key separate from the opaque historical `projectId` grouping value.
- Create a daemon-owned store registry that routes create, list, inspect, content, update, regenerate, cancel, and delete to the owning project store. Aggregate listing must enumerate registered project stores without cross-project moves.
- Read legacy host-global artifacts compatibly and define an explicit, recoverable migration path. Never silently move repository files or delete a legacy record.
- Expose the selected storage location and repository/host meaning in metadata and the library after the capability gate is available.

### 2. Durable metadata, provenance, and watchers

- Persist durable metadata for storage location, root/store identity, current status, data-contract availability, last error, and source provenance.
- Provenance is an explicit discriminated source reference: Chat, Workflow, or Schedule, with enough immutable identifiers to reopen the source when it remains available.
- Replace generation-only watching with per-store lifecycle watching. Externally edited metadata/HTML must refresh the library safely; malformed external input must preserve the last valid deliverable and surface a recoverable error.
- On daemon startup, reconcile interrupted runs: never leave a record indefinitely `generating`; retain prior successful HTML where one exists and record the recovery outcome.

### 3. Library, open, preview, and sharing lifecycle

- The Artifacts library is reachable at the aggregate and project scopes, clearly identifies host/project/storage source, and supports searching/filtering as the library grows.
- Open and preview work after restart for repository and host stores. Preview errors give an actionable recovery path; the artifact tab/dialog must stay read-only until an explicit update or regeneration action is chosen.
- Define a deliberate share/open contract. Repository artifacts can be opened from their known project location; host-local artifacts disclose that they live only on the daemon host. No implicit external publication or cross-host sync is introduced.

### 4. Update versus regeneration and recovery

- Data update is an explicit operation that requires the data contract and preserves every presentation byte outside the contract.
- Regeneration is a separately labeled destructive-to-design choice, preserves the last successful output through failure/cancel/timeout, and records its run and source.
- Create, provider validation, watcher failure, timeout, cancellation, malformed HTML/data, missing files, external edits, and daemon restart all terminate in visible recoverable states without losing the last known good deliverable.

### 5. Protocol, provider boundaries, documentation, and proof

- Add only backward-compatible optional wire fields and new dotted RPCs where required. Gate the 0.9 storage/provenance UI in one place through `server_info.features.*`; old hosts retain their existing artifact experience.
- Generation remains daemon-owned and provider-neutral. Unattended permission behavior must retain the documented safe-unattended policy and disclose a provider limitation rather than pretending unsupported providers are equally guarded.
- Update `docs/data-model.md`, the product/storage documentation, glossary only if user-facing terms change, and the E2E coverage matrix with the shipped behavior.
- Add T1 resolver/store/service/session/protocol tests, T1 app derivation and unavailable-state coverage, and controlled T2 generation proof based on observable artifact files and rendered preview rather than model prose.

## Delivery order

1. Project-scoped storage resolver and store identity, with unit proof of repository/host resolution and no path traversal.
2. Central store registry and legacy discovery, then route creation and reads through the resolved store without moving existing artifacts.
3. Add storage/provenance metadata, watcher/startup reconciliation, and recovery UI.
4. Deliver library storage/open/share disclosure and explicit data-update versus regeneration controls.
5. Add Schedule and Workflow provenance/refresh integration plus T1/T2 proof and documentation reconciliation.

## Dependencies

- [[project-knowledge-is-repository-owned-markdown-managed-atomically-by-otto]] provides the existing project ownership policy, worktree-aware root resolution, and stable host project identity pattern. Artifacts must not independently infer ownership in each caller.
- [[schedules]] supplies durable artifact-update triggers and run provenance.
- [[workflows]] supplies durable Workflow identifiers and run provenance.
- [[e2e-qa-coverage]] owns the coverage matrix and proof discipline.

## Explicit non-goals

- New fixed artifact taxonomy or non-HTML artifact formats.
- Moving artifacts between projects, implicit repository-to-host migration, or silent deletion of legacy records.
- External publishing, cloud synchronization, or cross-host sharing.
- Treating a data update as regeneration, or adding a degraded client-side fallback for a missing daemon capability.

## Acceptance

A user can create, reopen, inspect, update or regenerate an artifact after leaving Otto; understand its project, storage location, current state, provenance, and last update; and recover from failure without losing the deliverable. Updating data never redesigns the artifact unless regeneration was explicitly chosen.

## Completion ledger

This is the release decision record for Artifacts. A row is **complete** only when its user outcome, daemon behavior, compatibility boundary, and stated proof all pass. An existing component, an internal tool, or a unit test alone does not complete a row.

| Capability | Verified now | Required for 0.9 completion | Completion proof |
| --- | --- | --- | --- |
| Create a deliverable | UI and `create_artifact` create background HTML generations | Creation chooses the owning project store, records the source trigger, and returns a durable inspectable object | T1 UI/daemon create in repository and host ownership modes; T2 controlled generation writes and renders |
| Project ownership | A resolver foundation is unit-tested, but live requests still use the host-global store | Every create/read/list/mutate path routes through the resolved project store; worktrees resolve to their project root | Resolver and registry T1 tests, plus two-project isolation proof |
| Durability and restart | Ready records/files persist; active generation has run history | Startup reconciles interrupted runs to a named recoverable state and retains last good output | Restart test during initial generation and regeneration |
| Library and discovery | Aggregate library, project filter, cards, dialog preview, and workspace tabs exist | Library identifies project, host, and storage state; it remains correct across stores and supports the defined open/share lifecycle | T1 aggregate/project scope, unavailable host, empty/loading/error, and tab reopen tests |
| Inspect and provenance | Generation provider/model/agent and bounded attempt history are retained | Durable source reference identifies originating Chat, Workflow, or Schedule and can deep-link when available | Metadata/protocol compatibility tests plus source deep-link T1 |
| Data-preserving update | Agent tool replaces only `otto-artifact-data` | User has an explicit supported update journey; data-only update proves presentation bytes are unchanged | Byte-preservation T1 and end-user UI/T2 artifact-update proof |
| Regeneration | Explicit regeneration and cancellation retain an in-memory backup during one run | Regeneration is visibly design-changing, persists a durable recovery outcome, and never loses last good output on error/cancel/timeout/restart | Failure matrix across initial create, regenerate, cancel, timeout, and restart |
| External edits and watchers | Active generation watcher validates its expected output | Per-store watcher refreshes safe external edits and reports malformed/missing metadata or HTML without corrupting the last valid deliverable | Filesystem watcher T1 plus library notification proof |
| Rendering security | HTML is self-contained, CSP-sanitized, and rendered in platform-specific isolated views | Security policy, allowed interactivity, navigation/network behavior, and recovery UX are documented and tested on web, Electron, and native | CSP regression tests plus platform rendering/security smoke evidence |
| Migration | None; legacy host-global artifacts remain the live source | Legacy records are discoverable; any move is explicit, recoverable, non-destructive, and leaves an auditable result | Legacy fixture migration/dual-read tests and user-visible migration state |
| Compatibility | Existing `artifacts` feature gate exists | Additive storage/provenance fields and one centralized 0.9 capability gate; old hosts retain their existing experience | Old-record/parser and old-host unavailable-state tests |
| Schedules and Workflows | No trigger provenance or target adapter exists | Schedule uses only data-preserving updates; Workflow and Schedule runs provide source identities, revisions, cancellation, and deep links | Cross-module T1 and controlled T2 run records |
| End-user documentation | Current docs describe an outdated repository-only path | Documentation distinguishes supported behavior, ownership, open/share limits, update/regenerate semantics, recovery, security, and provider limits | Documentation review against this ledger after product tests pass |

### Status vocabulary

- **Verified now** means source and targeted evidence confirm the behavior currently exists.
- **Required** means the behavior is part of the confirmed 0.9 product contract.
- **Decision required** means implementation must not freeze the user-facing contract until the named choice is made.
- **Not complete** means no end-user documentation may imply the required behavior is available.

## Explicit decisions required before the feature can be complete

1. **Ownership policy:** confirm whether Artifacts always follows the Project Knowledge repository/host setting or receives a separate per-project policy. The current resolver foundation reuses Knowledge’s result, but that is an implementation hypothesis, not yet a user-approved end-user contract.
2. **Host-local location and access:** define the host-local path disclosure, whether an owner may reveal/open it in the host file system, and how remote clients are told that the file lives on the daemon host.
3. **Open and share:** define the allowed operations precisely. Repository reveal, host-file reveal, save-copy/export, and publication are distinct capabilities. 0.9 currently excludes publication and cross-host sync.
4. **Migration consent:** choose the user-facing policy for existing host-global records: remain discoverable indefinitely, offer copy, offer move, or require a one-time migration. No silent move is permitted.
5. **Source provenance:** define whether an artifact carries its original source, its most recent trigger, or a durable append-only source history. Define deletion behavior when a source chat, schedule, or Workflow no longer exists.
6. **Data-update UX:** decide the end-user entry point and instruction model for design-preserving updates. The existing agent tool is a technical seam, not proof of a finished user journey.
7. **External-edit conflict policy:** decide whether an invalid external edit preserves and serves last-known-good HTML, marks the artifact as degraded, or requires manual repair before preview.
8. **Provider boundary:** publish which providers can safely run unattended artifact generation today and the exact unavailable/degraded behavior for the rest. The product must not claim parity merely because the generation service can launch them.

## Required end-user journeys

The plan is incomplete until each journey has a named entry point, accessible UI states, daemon behavior, recovery story, and proof.

1. **Create and return:** create an artifact for a repository-owned project, leave Otto, restart the daemon/app, find it in the project library, open its tab, inspect its source/status, and render it.
2. **Host-owned project:** repeat the journey under host ownership; the UI states that the artifact is on the selected daemon host and offers only the defined open/share actions.
3. **Failure without loss:** regenerate a ready artifact, make the run fail/cancel/timeout, restart where applicable, and reopen the last valid deliverable with a visible error and retry path.
4. **Design-preserving refresh:** inspect the data contract, run a data update, and prove HTML/CSS/JS outside the contract is byte-identical. The owner can distinguish this from regeneration before confirming.
5. **External change:** edit valid HTML/metadata outside Otto and see the library refresh; introduce malformed content and see a direct repair state while preserving last valid output according to the approved policy.
6. **Legacy recovery:** discover a pre-0.9 host-global artifact and complete the approved migration choice without silent loss or project reassignment.
7. **Scheduled update:** create an artifact-update Schedule, run it, inspect the schedule run and artifact history, verify the design survives, and recover a missing/deleted/incompatible target without a prompt fallback.
8. **Workflow provenance:** create or refresh an artifact from a saved Workflow, then navigate from the artifact to the exact Workflow/run or receive an honest unavailable/deleted-source state.
9. **Security boundary:** render a hostile-but-valid artifact on every supported platform and prove its documented network/navigation/host-isolation policy.
10. **Upgrade boundary:** use a new client against an old host and see one clear upgrade state for 0.9-only storage/provenance behavior while legacy artifact behavior stays usable.

## Documentation readiness

The end-user guide may document only the verified-now rows as current behavior. It must not state that artifacts are project-owned, storage-policy aware, externally watched, schedule/Workflow-provenanced, exportable, or restart-recoverable until the matching completion row passes.

Before release, documentation must answer in direct user language:

- what an Artifact is and is not, including the distinction from a Widget;
- where it is stored, who can access it, and what repository versus host ownership changes;
- how to create, inspect, open, update data, regenerate, cancel, delete, and recover it;
- what content is allowed to do in its preview and what Otto blocks;
- how Schedule and Workflow updates appear in provenance and history;
- provider, host-connectivity, migration, and unavailable-capability limits.

## Definition of complete

Artifacts are complete for 0.9 only when every Completion ledger row is complete, all required product decisions are resolved and reflected in the UI/docs, every required end-user journey has proportional T1/T2 proof, protocol compatibility is exercised, and the documentation review can describe the feature without qualifiers beyond deliberate supported-platform/provider limits. Until then, delivery progress must remain partial regardless of how many individual screens or tools exist.

## Verification and release evidence plan

The Completion ledger is executable. Every row receives a stable evidence identifier in the release coverage matrix before implementation closes it. A row cannot advance on a code review, a screenshot, or a passing unit test alone.

### Evidence rule

For every user-facing assertion, record:

1. the charter row and end-user journey it proves;
2. the deterministic T1 test file and test name;
3. the daemon/protocol or UI layer the test reaches;
4. the T2/local or controlled live-daemon proof when a model, daemon restart, or rendered HTML behavior is material;
5. the platform proof where web, Electron, and native behavior differs;
6. the documentation section that may make the claim once its tests pass.

The evidence record states the actual command, result, and environment. “Not run” and “visually appears correct” are not proof.

### Verify existing assertions before building further

Re-run and extend the current baseline first, using real temporary files and stores rather than mocked filesystem behavior:

- `artifact-store.test.ts`: metadata/run-history compatibility, bounded retention, path-traversal rejection, atomic update/delete behavior.
- `artifact-store-resolver.test.ts`: repository and host resolution, stable project identity, normalized project roots, and later worktree-root resolution.
- `artifact-data.test.ts`: data-contract parsing and byte preservation outside `otto-artifact-data`.
- `html-validator-regression.test.ts`: CSP replacement/idempotence and malformed/unsafe HTML handling.
- `artifact-derivation.test.ts`: aggregate/project/worktree membership and compatibility behavior.
- New service/session tests: create, ready, error, cancel, timeout, regeneration backup/restore, retained transcript ownership, and exact RPC error/result shapes.
- New app tests: library/project filtering, create/edit/update/regenerate distinction, preview/tab reopening, failure/retry/log entry, capability upgrade boundary, and accessible storage/provenance disclosure.

A failed baseline claim changes the charter’s **Verified now** state to an observed gap before any release documentation uses it.

### T1 acceptance matrix

| Test family | Required assertions |
| --- | --- |
| Store and resolver | Correct repository/host directory; two-project isolation; safe artifact-id/path behavior; legacy discovery; no silent project move |
| Service lifecycle | Every terminal status settles once; backup survives failed regeneration; missing HTML/data/provider causes a named recoverable error; startup reconciles interrupted runs |
| Watchers | Valid external HTML/metadata updates publish once; malformed edits preserve the approved last-known-good state and issue repair guidance; watchers stop cleanly |
| Protocol and compatibility | Old metadata and old clients parse additive fields; new client sees one storage/provenance upgrade boundary on old host; no fallback crosses old RPCs |
| Session and tools | UI RPCs and Otto tools route to the same owning store and return matching identifiers/statuses; source provenance is never inferred from prompt text |
| App | Library, tabs, dialogs, confirmations, capability states, error/retry, and deep links accurately project daemon state |
| Security | CSP has one Otto-owned policy; data/network/navigation and host-isolation limits meet the published contract; no platform silently grants more authority |
| Cross-module | Schedule update calls only the design-preserving update path; Workflow/Schedule provenance, cancellation, revision/fingerprint and target-gone repair are durable |

### T2 and platform proof

Use a controlled daemon and pinned local-AI provider for model-dependent journeys. Assert only observable effects: a named artifact record, HTML/data files in the resolved store, status/history, and rendered preview. Never assert model prose.

- Repository-owned create → file placement → sanitize/render → restart/reopen.
- Host-owned create → host disclosure → restart/reopen.
- Regenerate ready content with an injected failure, cancel, timeout, and daemon restart; assert last-good recovery.
- Schedule artifact update and Workflow-originated generation when their owning modules provide the required stable target/revision contract.
- Web, Electron, and native platform smoke cases for rendering and security. Native-only or Electron-only proof remains explicit in the release runbook rather than being implied by web coverage.

### Documentation traceability gate

An end-user documentation claim links to one completed ledger row and its evidence identifier. Documentation may describe deliberate limits, but never a planned capability as current behavior. A release review samples each guide action against the matching acceptance journey: create, locate, inspect, open, update, regenerate, recover, delete, and the stated storage/security boundary.

### Evidence exit

Artifacts can move from `in_build` to `complete` only after every ledger row has its required T1/T2/platform evidence, the coverage matrix has no unmapped Artifact spec, all required decisions are recorded, and the documentation traceability review passes.

## Timeline

- time: "2026-08-27T00:35:26.705Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["e2e-qa-coverage"]
- time: "2026-08-27T00:35:26.705Z"
  kind: "evidence"
  summary: "Initial 0.9 charter created from user direction and the existing Otto implementation/Knowledge inventory on 2026-08-26. This charter is confirmed as the feature-level planning record and will be expanded with verified current-state and delivery evidence."
- time: "2026-08-27T01:47:43.065Z"
  kind: "decision"
  summary: "The user requested an end-to-end 0.9 delivery inventory and adversarial source review before implementation. The expanded charter records verified baseline behavior, concrete gaps, dependencies, non-goals, and delivery order."
  source: "Verified against packages/server/src/server/artifact/, packages/server/src/server/session.ts, packages/server/src/server/bootstrap.ts, packages/protocol/src/art"
- time: "2026-08-27T01:49:51.779Z"
  kind: "note"
  summary: "Verified the first delivery slice: ArtifactStoreResolver now resolves repository projects to <project>/.otto/artifacts and host-owned projects to $OTTO_HOME/project-artifacts/<stable-project-directory>, reusing the Project Knowledge ownership result. ArtifactStore now accepts a resolved directory. Focused resolver (3 tests) and store (9 tests) suites pass; targeted formatting and lint pass. Live RPC/tool routing and legacy migration are intentionally not yet implemented, so the feature remains in build."
  affects: ["artifacts"]
- time: "2026-08-27T02:01:08.088Z"
  kind: "decision"
  summary: "The user requested a complete, evidence-led Artifacts plan that can answer whether the feature is genuinely complete. The charter now carries a capability-by-capability completion ledger, product decisions, end-user journeys, documentation readiness boundary, and release definition of done."
  source: "Source review of current Artifacts daemon, protocol, client, UI, and tests; confirmed [[release-0-9-product-completion]]; user direction on 2026-08-26."
- time: "2026-08-27T02:07:05.530Z"
  kind: "decision"
  summary: "The user requested that the charter capture how present assertions and final acceptance must be tested. Added an executable evidence plan, T1/T2/platform matrix, baseline-verification rule, and documentation traceability gate."
  source: "User direction, 2026-08-26; repository testing rules in docs/testing.md; Artifacts source/test review."
