---
id: "artifacts"
kind: "project"
title: "Artifacts"
status: "confirmed"
tags: ["artifacts","storage","generation","v0.9"]
delivery_status: "partial"
progress_completed: 0
progress_total: 5
progress_unit: "0.9 delivery slices"
created_at: "2026-08-27T00:35:26.705Z"
updated_at: "2026-08-30T02:36:04.847Z"
---
# Artifacts

<!-- compiled_truth -->

# Artifacts

## Outcome

Artifacts are durable AI-created project deliverables. They have no fixed product taxonomy: their content defines them. Each artifact belongs to one project and has its **own Artifacts storage choice**. A host-wide Artifacts default applies unless that project explicitly overrides it; this is independent of the Knowledge, Schedules, and Workflows choices. Repository artifacts live under `<projectRoot>/.otto/artifacts`; host-local artifacts live in that project’s stable, daemon-host-local `OTTO_HOME/project-artifacts/<project-key>/` directory. The host-local form is durable for the owner’s project on that host, not a user-global bucket and not shared across hosts.

## Verified baseline

- The daemon has a file-backed HTML artifact store, background generation, a generation watcher, status, cancellation, regeneration, retained generation transcripts, bounded run history, and metadata editing.
- The app has an aggregate library with project filtering, cards, creation/editing, preview, status/error display, cancellation, regeneration, deletion, and a read-only generation-chat entry point when the host supports retained transcripts.
- The generator requires one self-contained HTML document. The watcher sanitizes output and installs an Otto-owned CSP. Web uses a sandboxed iframe, Electron uses an isolated `webview` session, and native uses a restricted WebView.
- The `otto-artifact-data` JSON block is the explicit data-update seam. `update_artifact_data` replaces only that block and never rewrites the HTML, CSS, or JavaScript; artifacts without the block require regeneration.
- Existing targeted T1 proof covers store run-history compatibility and id traversal rejection, data-block byte preservation, CSP canonicalization, app-side project derivation, and independent repository/host resolver-registry-store-service behavior.

## Adversarial gap review

Artifacts now has an independent persisted host default and per-project repository/host override, surfaced through capability-gated Host and Project Settings. Its resolver uses only the Artifacts fields, an existing repository store, and the Artifacts default; it does not consult the Knowledge, Schedules, or Workflows selection. The daemon dual-reads both project locations and the legacy host-global bucket while directing new writes to the selected location, so no setting change silently moves, hides, or creates a store. Explicit settled-only moves, Legacy location handling, library storage disclosure, and the host-path documentation are shipped with deterministic proof. Worktree-root coverage, project-setting session/app coverage, and controlled create/reopen proof remain open.

Ready artifacts are watched through a shared directory watcher per store. Valid external HTML and metadata edits refresh connected clients; invalid or missing HTML is preserved, disables preview, and can be repaired explicitly from a retained last-known-good snapshot. Malformed external metadata is preserved and logged, but its user-visible recovery contract remains open. During daemon bootstrap, discoverable stale `generating` records settle to an explicit recoverable error; an interrupted regeneration restores its durable last-ready `.bak` output before the run closes as failed. New Artifact metadata records the resolved repository/host storage location and cards disclose it; legacy records remain readable without an invented value. Chat and new-agent Schedule source provenance is durable, while Workflow and existing-agent Schedule provenance/deep links remain blocked on their owning contracts. The client can preview in a dialog and open an artifact tab, but the defined open/share lifecycle and restart proof remain incomplete.

The additive `artifactStoreLocation` capability gates both the independent host default and project override. The protocol carries optional project/default storage fields and a dotted project-setting RPC, while the app leaves old hosts on the existing artifact experience. Durable per-artifact storage/source-provenance fields, parser compatibility, and focused session RPC coverage are proved; old-host unavailable-state coverage and controlled T2 generation remain open.

## 0.9 delivery inventory

### 1. Ownership, storage, and migration

- Resolve an artifact store from the project root plus the **Artifacts** project override, existing repository artifact store, and host-wide Artifacts default, using worktree-aware project-root resolution. Do not read the Knowledge, Schedules, or Workflows storage setting when resolving Artifacts.
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

1. Build the shared category-storage settings platform: independent host defaults and per-project overrides, worktree-aware resolution, stable host directory identities, compatibility gates, and no silent move.
2. Refactor the Artifact resolver and registry onto the Artifacts setting; route session RPCs and daemon tools, retain legacy discovery, and prove two-project isolation.
3. Add storage/provenance metadata, watcher/startup reconciliation, and recovery UI.
4. Deliver library storage/open/share disclosure and explicit data-update versus regeneration controls.
5. Add Schedule and Workflow provenance/refresh integration plus T1/T2 proof and documentation reconciliation.

## Dependencies

- [[project-knowledge-is-repository-owned-markdown-managed-atomically-by-otto]] provides the precedent for safe location precedence, worktree-aware root resolution, stable host-project identity, and explicit migration. Artifacts shares that infrastructure pattern but never inherits Knowledge’s selected location.
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
| Project storage | Independent Artifacts host default and project override now select resolver/registry/service/tool routing. Settings are capability-gated; dual-read retains both locations and the legacy bucket without silent migration. Focused resolver/registry/store/service proof covers 26 tests, but project-setting session/app proof is not yet present. | Add worktree-root proof, per-artifact storage-location metadata/library disclosure, explicit migration action, and controlled T2 create/reopen proof | Settings/resolver/registry/service/session/app T1 tests, two-project isolation, and T2 create/reopen proof |
| Durability and restart | Ready records/files persist; active generation has run history | Startup reconciles interrupted runs to a named recoverable state and retains last good output | Restart test during initial generation and regeneration |
| Library and discovery | Aggregate library, project filter, cards, dialog preview, and workspace tabs exist | Library identifies project, host, and storage state; it remains correct across stores and supports the defined open/share lifecycle | T1 aggregate/project scope, unavailable host, empty/loading/error, and tab reopen tests |
| Inspect and provenance | Generation provider/model/agent and bounded attempt history are retained | Durable source reference identifies originating Chat, Workflow, or Schedule and can deep-link when available | Metadata/protocol compatibility tests plus source deep-link T1 |
| Data-preserving update | Agent tool replaces only `otto-artifact-data` | User has an explicit supported update journey; data-only update proves presentation bytes are unchanged | Byte-preservation T1 and end-user UI/T2 artifact-update proof |
| Regeneration | Explicit regeneration and cancellation retain an in-memory backup during one run | Regeneration is visibly design-changing, persists a durable recovery outcome, and never loses last good output on error/cancel/timeout/restart | Failure matrix across initial create, regenerate, cancel, timeout, and restart |
| External edits and watchers | Active generation watcher validates its expected output | Per-store watcher refreshes safe external edits and reports malformed/missing metadata or HTML without corrupting the last valid deliverable | Filesystem watcher T1 plus library notification proof |
| Rendering security | HTML is self-contained, CSP-sanitized, and rendered in platform-specific isolated views | Security policy, allowed interactivity, navigation/network behavior, and recovery UX are documented and tested on web, Electron, and native | CSP regression tests plus platform rendering/security smoke evidence |
| Migration | Legacy host-global records are discoverable alongside resolved project stores; no files move | Define and ship an explicit, recoverable, non-destructive migration action with an auditable result | Legacy fixture migration/dual-read tests and user-visible migration state |
| Compatibility | Existing `artifacts` gate remains; the additive `artifactStoreLocation` gate protects host default and project override | Exercise additive parser compatibility and the old-host unavailable state; add provenance compatibility when that surface exists | Old-record/parser and old-host unavailable-state tests |
| Schedules and Workflows | Chat and new-agent Schedule source identities persist; Workflow and existing-agent Schedule adapters/deep links do not | Schedule uses only data-preserving updates; Workflow and Schedule runs provide source identities, revisions, cancellation, and deep links | Cross-module T1 and controlled T2 run records |
| End-user documentation | Public Artifact and CLI guides describe the shipped ownership, move, data-update, recovery, security, provider, and provenance limits | Documentation review against this ledger after product tests pass |

### Status vocabulary

- **Verified now** means source and targeted evidence confirm the behavior currently exists.
- **Required** means the behavior is part of the confirmed 0.9 product contract.
- **Decision required** means implementation must not freeze the user-facing contract until the named choice is made.
- **Not complete** means no end-user documentation may imply the required behavior is available.

## Explicit decisions required before the feature can be complete

1. **Storage policy — decided:** Artifacts has its own repository/host choice. Host Settings supplies the Artifacts default; Project Settings may independently override it. The precedence is project override, an existing repository artifact store, then the Artifacts host default. This setting is independent of Knowledge, Schedules, and Workflows, while sharing their resolver/migration safety model. Repository storage is `<projectRoot>/.otto/artifacts`; host storage is stable and project-keyed under the daemon host’s `OTTO_HOME/project-artifacts/`. There is no user-global artifact bucket or implied cross-host sharing.
2. **Host-local location and access:** define the host-local path disclosure, whether an owner may reveal/open it in the host file system, and how remote clients are told that the file lives on the daemon host.
3. **Open and share:** define the allowed operations precisely. Repository reveal, host-file reveal, save-copy/export, and publication are distinct capabilities. 0.9 currently excludes publication and cross-host sync.
4. **Migration consent — decided:** migrations are explicit user-triggered **moves**, never copies. Changing a global or project location preference still never moves data silently. A future host/project identification surface will let users see both sides and move items in either direction.
5. **Source provenance — decided:** persist only the latest source trigger for 0.9. Chat, Workflow, and Schedule history is deferred; a deleted or unavailable source must render as unavailable rather than be inferred from prompt text.
6. **Data-update UX:** decide the end-user entry point and instruction model for design-preserving updates. The existing agent tool is a technical seam, not proof of a finished user journey.
7. **External-edit conflict policy — decided:** preserve the invalid external file and mark the artifact as needing repair. Keep a last-known-good HTML snapshot; disable unsafe preview and offer an explicit **Repair** action that restores that snapshot. Otto never silently overwrites an external edit.
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
- time: "2026-08-29T13:36:52.451Z"
  kind: "decision"
  summary: "The product owner confirmed that Artifacts follows each project’s Project Knowledge repository-versus-host ownership setting. Host-owned artifacts are durable per-project data under the daemon host’s Otto Home, not a daemon-global user bucket. Status returned to proposed for review."
  source: "User decision, 2026-08-29"
  affects: ["project-knowledge-is-repository-owned-markdown-managed-atomically-by-otto","release-0-9-product-completion","schedules","workflows"]
- time: "2026-08-29T13:37:14.029Z"
  kind: "note"
  summary: "The product owner explicitly confirmed the Artifact ownership policy and directed implementation to proceed. New status: confirmed."
- time: "2026-08-29T13:51:25.295Z"
  kind: "decision"
  summary: "Reconciled the confirmed charter with the verified project-scoped storage implementation: resolver and registry route session RPCs and daemon agent tools, preserve legacy discovery, and have focused T1 proof. Remaining 0.9 rows stay explicitly incomplete. Status returned to proposed for review."
  source: "Implementation and verification on 2026-08-29: artifact-store-resolver.test.ts, artifact-store-registry.test.ts, artifact-store.test.ts, artifact-service.test.t"
- time: "2026-08-29T13:51:30.670Z"
  kind: "note"
  summary: "Completed and verified delivery slices 1–2: ownership-based store resolution, project-store registry, live session/daemon-tool routing, and legacy discovery. Evidence: 25 focused artifact T1 tests passed, targeted lint passed, and @otto-code/server typecheck passed. Migration action, storage/provenance UI, watcher/restart recovery, data-update UX, Schedule/Workflow integration, T2 proof, and docs remain incomplete."
  affects: ["artifacts"]
- time: "2026-08-29T13:51:38.232Z"
  kind: "note"
  summary: "The product owner explicitly confirmed this Artifacts charter and its ownership policy, and requested implementation and charter reconciliation to proceed. New status: confirmed."
- time: "2026-08-29T14:02:42.077Z"
  kind: "decision"
  summary: "The product owner clarified that Artifacts must have its own global default and per-project repository/host override. The existing Knowledge setting is only the safety and UX precedent, not Artifacts' selector. Reclassified the Knowledge-coupled resolver work as invalid groundwork rather than delivered progress. Status returned to proposed for review."
  source: "Product-owner clarification, 2026-08-29."
- time: "2026-08-29T14:02:50.705Z"
  kind: "note"
  summary: "The prior 2/5 count was based on an invalid coupling to Project Knowledge storage. The registry/resolver and T1 tests remain reusable groundwork, but no Artifacts delivery slice is complete until the independent host default and project override are implemented and exercised."
  affects: ["artifacts"]
- time: "2026-08-29T14:02:51.957Z"
  kind: "note"
  summary: "The product owner explicitly corrected and confirmed the Artifacts storage policy: it is an independent per-category global default and project override. New status: confirmed."
- time: "2026-08-29T14:09:35.063Z"
  kind: "evidence"
  summary: "Corrected the invalid Knowledge-coupled Artifact resolver. The daemon now persists a separate `projectArtifacts.defaultStoreLocation`, plus `artifactLocation` and `artifactDirectoryName` on each project; ArtifactStoreResolver reads only those Artifact fields, an existing repository artifact directory, and the Artifact default. Session RPC service and daemon tools use the independent resolver. The control surfaces and project-setting RPC are intentionally not implemented, so delivery remains 0/5. Focused resolver/registry/store/service tests: 26 passed; server typecheck and targeted lint passed."
  source: "Implementation and verification, 2026-08-29"
  affects: ["release-0-9-product-completion","schedules","workflows"]
- time: "2026-08-29T14:15:33.630Z"
  kind: "evidence"
  summary: "Implemented the non-destructive dual-read safety boundary for independent Artifact storage: each project’s selected repository/host store remains the write target, while ArtifactStoreRegistry lists and finds records in both project locations plus the legacy bucket. ArtifactStore reads no longer create directories, so discovery does not materialize unused repository/host paths. Focused resolver/registry/store/service tests: 26 passed; targeted lint and server typecheck passed. Settings RPC/UI and explicit Move/Copy migration remain open."
  source: "Implementation and verification, 2026-08-29"
  affects: ["release-0-9-product-completion"]
- time: "2026-08-29T14:35:15.264Z"
  kind: "evidence"
  summary: "Added the first user-facing independent setting: Host Settings now exposes a capability-gated Artifacts default (`projectArtifacts.defaultStoreLocation`) with explicit copy that it directs future writes and leaves existing repository/host artifacts available through dual-read. The setting is independent of Knowledge. Protocol/server targeted lint and server typecheck pass. App-wide typecheck is currently blocked by an unrelated existing `DaemonClient.startWorkflow` declaration mismatch in `packages/app/src/hooks/use-orchestration-graphs.ts`; no Artifact diagnostic was reported. Project-level Artifacts override remains open."
  source: "Implementation and verification, 2026-08-29"
  affects: ["release-0-9-product-completion"]
- time: "2026-08-29T14:49:07.156Z"
  kind: "decision"
  summary: "Reconciled the confirmed charter after the verified independent Artifacts host default, project override, dual-read storage routing, capability gate, and error-recovering settings UI were implemented. Status returned to proposed for review."
  source: "Implementation and verification, 2026-08-29"
- time: "2026-08-29T14:50:29.080Z"
  kind: "decision"
  summary: "Updated the gap review and completion ledger to precisely distinguish the verified independent storage implementation from unproven session/app compatibility, disclosure, migration, and T2 work."
  source: "Implementation and verification, 2026-08-29"
- time: "2026-08-29T14:50:39.154Z"
  kind: "evidence"
  summary: "Implemented the capability-gated per-project Artifacts override. `project.artifact.store.set.request/response` persists an independent repository/host/null override, announces the project descriptor update, and is exposed through Project Settings with save guarding and recovery toasts. Together with Host Settings' independent default, resolver/registry/service/tool routing selects Artifacts storage only, dual-reads both project stores plus legacy host-global records, and never moves records on a setting change. Verification: `npx vitest run packages/server/src/server/artifact/artifact-store-resolver.test.ts packages/server/src/server/artifact/artifact-store-registry.test.ts packages/server/src/server/artifact/artifact-store.test.ts packages/server/src/server/artifact/artifact-service.test.ts --bail=1` passed 26 tests in 5 files; `npm run typecheck --workspace=@otto-code/protocol`, `@otto-code/server`, and `@otto-code/app` passed; targeted lint passed. No dedicated session/app unavailable-state test, migration action, per-artifact disclosure/provenance, T2 proof, or documentation claim is complete."
  source: "Implementation and verification, 2026-08-29"
  affects: ["release-0-9-product-completion"]
- time: "2026-08-29T14:50:43.862Z"
  kind: "note"
  summary: "The product owner previously explicitly confirmed this Artifacts charter and its independent storage policy; this reconciliation adds only verified implementation evidence and does not change the confirmed product contract. New status: confirmed."
- time: "2026-08-29T14:54:25.768Z"
  kind: "evidence"
  summary: "Added deterministic wire-boundary proof for the independent project Artifact storage override. `daemon-client.test.ts` proves the client sends and correlates `project.artifact.store.set.request/response`, including a daemon rejection; `messages.stream-parsing.test.ts` proves the new additive request/response shapes parse through the session unions. Verification: `npx vitest run packages/client/src/daemon-client.test.ts packages/protocol/src/messages.stream-parsing.test.ts --bail=1` passed 268 tests in 4 files; `npm run typecheck --workspace=@otto-code/protocol` and `@otto-code/client` passed; targeted lint passed. This is protocol/client T1 only: server session behavior, app-visible unavailable/error states, real daemon T2, and all remaining ledger rows stay incomplete."
  source: "Implementation and verification, 2026-08-29"
  affects: ["release-0-9-product-completion","e2e-qa-coverage"]
- time: "2026-08-29T14:54:30.557Z"
  kind: "note"
  summary: "The product owner previously explicitly confirmed the Artifacts charter; this entry only adds verified evidence and leaves its scope and completion criteria unchanged. New status: confirmed."
- time: "2026-08-29T14:57:35.590Z"
  kind: "evidence"
  summary: "Added daemon-session T1 coverage for `project.artifact.store.set`: a valid request persists the host override and emits the accepted correlated response; a missing project emits the recoverable `Project not found.` rejection and does not mutate storage. Verification: `npx vitest run packages/server/src/server/session.test.ts --exclude \".tmp/**\" -t \"project Artifact storage RPC\" --bail=1` passed 2 targeted tests; server typecheck and targeted lint passed. The unfiltered single-file runner also discovered an unrelated copied `.tmp/android-tablet-build/.../session.test.ts` and an unrelated existing pull-request-timeline expectation mismatch; neither is an Artifact failure. App-visible recovery, old-host unavailable state, real daemon T2, and remaining ledger rows stay incomplete."
  source: "Implementation and verification, 2026-08-29"
  affects: ["release-0-9-product-completion","e2e-qa-coverage"]
- time: "2026-08-29T14:57:40.352Z"
  kind: "note"
  summary: "The product owner previously confirmed the Artifacts charter; this entry records only verified test evidence and does not change the confirmed contract. New status: confirmed."
- time: "2026-08-29T15:00:18.393Z"
  kind: "decision"
  summary: "Reconciled the verified addition of additive per-artifact resolved-storage metadata and card disclosure, without overstating the still-unbuilt provenance or open/share lifecycle. Status returned to proposed for review."
  source: "Implementation and verification, 2026-08-29"
- time: "2026-08-29T15:00:27.365Z"
  kind: "evidence"
  summary: "Added additive durable `storageLocation` metadata for new Artifacts. The Artifact service records the resolved repository/host location at creation; later preference changes cannot rewrite it. Artifact cards disclose `Stored: Repository` or `Stored: This host` only when the new optional field is present, preserving compatibility with old hosts and historical metadata. Verification: `npx vitest run packages/server/src/server/artifact/artifact-store.test.ts packages/server/src/server/artifact/artifact-service.test.ts --bail=1` passed 20 tests in 3 files; protocol, server, and app typechecks passed; targeted lint passed. This does not prove app rendering, old-host unavailable behavior, open/share actions, provenance, watcher/restart recovery, migration, T2, or documentation readiness."
  source: "Implementation and verification, 2026-08-29"
  affects: ["release-0-9-product-completion"]
- time: "2026-08-29T15:00:33.261Z"
  kind: "note"
  summary: "The product owner confirmed this charter; the reconciliation records verified additive metadata and disclosure evidence without changing its product contract. New status: confirmed."
- time: "2026-08-29T15:04:31.424Z"
  kind: "decision"
  summary: "Reconciled the verified bootstrap recovery behavior for stale generations and durable regeneration backups, while retaining the independent watcher, first-generation, and UI proof gaps. Status returned to proposed for review."
  source: "Implementation and verification, 2026-08-29"
- time: "2026-08-29T15:04:41.818Z"
  kind: "evidence"
  summary: "Implemented bootstrap reconciliation for interrupted Artifact generations. The daemon-wide Artifact service scans registered stores before clients can fetch the library; every stale `generating` record is marked `error`, its current run becomes `failed`, its generation-agent id clears, and the recovered record is broadcast. For interrupted regenerations, durable `<html>.bak` last-ready output is restored before reporting the failure, so restart does not lose the deliverable. Verification: `npx vitest run packages/server/src/server/artifact/artifact-service.test.ts --bail=1` passed 3 tests, including a real-filesystem restart simulation; server typecheck and targeted lint passed. First-generation restart behavior, per-store external-edit watchers, app-visible recovery/retry, T2, and documentation remain incomplete."
  source: "Implementation and verification, 2026-08-29"
  affects: ["release-0-9-product-completion","e2e-qa-coverage"]
- time: "2026-08-29T15:04:43.407Z"
  kind: "note"
  summary: "The product owner confirmed this charter; the entry adds verified recovery evidence without changing the product contract. New status: confirmed."
- time: "2026-08-29T15:05:28.383Z"
  kind: "decision"
  summary: "Added direct proof that initial interrupted generations, as well as regenerations with a backup, settle after daemon restart. Status returned to proposed for review."
  source: "Implementation and verification, 2026-08-29"
- time: "2026-08-29T15:05:30.102Z"
  kind: "evidence"
  summary: "Extended restart recovery proof to initial generations: a stale first-ever generation now clears its agent id, marks its create run failed, and exposes `Generation interrupted when Otto restarted`. The Artifact service T1 file now has 4 passing tests covering repository/host routing, cross-project move rejection, initial-generation restart recovery, and regeneration-backup restart recovery."
  source: "Implementation and verification, 2026-08-29"
  affects: ["e2e-qa-coverage"]
- time: "2026-08-29T15:05:31.109Z"
  kind: "note"
  summary: "The confirmed charter received verified evidence only; its accepted product contract is unchanged. New status: confirmed."
- time: "2026-08-29T15:38:25.749Z"
  kind: "decision"
  summary: "Recorded the product owner’s explicit decisions: user-triggered moves rather than copies, latest-only provenance, and a visible repair action that restores last-known-good HTML without silently overwriting external edits. Status returned to proposed for review."
  source: "Product-owner decision, 2026-08-29"
- time: "2026-08-29T15:39:05.152Z"
  kind: "note"
  summary: "The product owner explicitly confirmed the migration, provenance, and external-edit decisions recorded in this charter update. New status: confirmed."
- time: "2026-08-29T16:01:47.781Z"
  kind: "evidence"
  summary: "Implemented and verified the external-edit repair increment without advancing overall 0.9 completion. Ready artifacts now retain a durable `.last-good` HTML snapshot, and the daemon-global service starts monitoring ready artifacts after bootstrap. A valid external edit is sanitized, becomes the next snapshot, updates metadata, broadcasts, and resumes monitoring. An invalid or missing HTML edit remains on disk, changes the artifact to a repairable error, blocks `getContent`/preview, and exposes a capability-gated `artifact.repair.request` action that restores the snapshot only after the user chooses Repair. The service uses the existing watcher infrastructure with one active file watcher per ready artifact; this is not yet the charter's desired per-store watcher architecture, and the remaining library/E2E/docs/migration/provenance work is still open.\n\nProof: `npx vitest run packages/server/src/server/artifact/artifact-service.test.ts packages/protocol/src/messages.stream-parsing.test.ts packages/client/src/daemon-client.test.ts --exclude \".tmp/**\" --bail=1` passed 143 tests in 3 files. The service test uses a real temporary store and mock provider: generation writes valid HTML, snapshot creation is observed, invalid external HTML is preserved, preview refusal is asserted, and explicit repair restores last-good content. `npm run build:client`, `npm run typecheck:server`, `npm run typecheck --workspace=@otto-code/app`, and targeted `npm run lint -- …` all passed."
  source: "Implementation and verification, 2026-08-29"
  affects: ["release-0-9-product-completion","e2e-qa-coverage"]
- time: "2026-08-29T16:08:19.885Z"
  kind: "evidence"
  summary: "Added a durable, capability-gated CLI path for the existing design-preserving data contract: `otto artifact data <id>` reads the explicit JSON contract and `otto artifact update-data <id> --data '<json>'` replaces it through daemon-owned `artifact.data.get.request` and `artifact.data.update.request` RPCs. The CLI never edits artifact HTML locally and reports a clear host-upgrade error when `server_info.features.artifactDataUpdate` is absent. The same service `updateData` path is used by agent tooling and the CLI, so it preserves the HTML/CSS/JS boundary; an artifact without the contract fails with a named recovery message rather than regenerating.\n\nProof: `npx vitest run packages/cli/src/cli-surface.test.ts packages/client/src/daemon-client.test.ts packages/protocol/src/messages.stream-parsing.test.ts packages/server/src/server/artifact/artifact-service.test.ts packages/server/src/server/artifact/artifact-data.test.ts --exclude \".tmp/**\" --bail=1` passed 156 tests in 5 files. `npm run build:client`, `npm run typecheck --workspace=@otto-code/cli`, `npm run typecheck:server`, and targeted `npm run lint -- …` passed. The interactive app data-update entry point, Schedule/Workflow adapters and provenance, controlled T2, old-host UI state, and documentation are still incomplete."
  source: "Implementation and verification, 2026-08-29"
  affects: ["release-0-9-product-completion","e2e-qa-coverage"]
- time: "2026-08-29T16:22:54.807Z"
  kind: "evidence"
  summary: "Delivered the in-app data-only update journey and reconciled the engineering data-model documentation. A capability-gated **Update data** card action opens a dedicated JSON sheet that loads the `otto-artifact-data` contract, states that HTML/layout/styles/scripts do not change, validates complete JSON before calling the daemon, disables duplicate submission, and directs artifacts without a data contract to explicit regeneration. It uses the new daemon RPC, never local file mutation. `docs/data-model.md` now documents independent repository/host artifact stores, no-silent-move dual-read behavior, the last-good repair policy, the app/CLI data update entry points, and the additive metadata/capability fields.\n\nVerification: `npm run typecheck --workspace=@otto-code/app` and targeted `npm run lint -- …` passed. `npx vitest run packages/app/src/artifacts/artifact-derivation.test.ts packages/server/src/server/artifact/artifact-data.test.ts packages/server/src/server/artifact/artifact-service.test.ts --exclude \".tmp/**\" --bail=1` passed 24 tests in 3 files. This validates the existing data-byte-preservation service behavior and app artifact derivation, but does not yet provide a rendered sheet interaction test or full T2 evidence. Explicit cross-store Move, source provenance, Schedule/Workflow adapters, and the broader acceptance matrix remain open."
  source: "Implementation and verification, 2026-08-29"
  affects: ["release-0-9-product-completion","e2e-qa-coverage"]
- time: "2026-08-29T16:34:45.578Z"
  kind: "evidence"
  summary: "Verified 2026-08-29: added an explicit cross-store Artifact move increment. The daemon resolves the requested repository or host destination without changing the project's write preference, rejects generating artifacts, stages the destination record/HTML/last-good snapshot, hides sources as rollback backups, promotes the staged destination, preserves the full StoredArtifact run history, and restores hidden sources if promotion fails. Cleanup failure after promotion is logged as recoverable leftover backup housekeeping rather than reported as a failed move. The additive capability gate is server_info.features.artifactStoreMove; the protocol uses artifact.store.move.request/response and the client gates a confirmed card action (\"Move to repository\"/\"Move to this host\") on that capability. The card continues to show the resolved storage tag. docs/data-model.md now documents explicit move semantics. Proof: build:client; typecheck:server; app typecheck; target lint; and 149 targeted assertions across artifact-service, protocol stream-parsing, and daemon-client tests. The service test proves a settled repository artifact moves to host with its last-good snapshot and run record retained, and that an active generation is refused. A ready watcher may apply the existing CSP normalization at the destination, but the test confirms the data-bearing rendered content is retained rather than regenerated. This is not a migration engine, does not move unlabelled legacy records from the UI, and has no interactive Playwright/E2E proof yet."
  source: "Implementation and verification, 2026-08-29"
  affects: ["release-0-9-product-completion","e2e-qa-coverage"]
- time: "2026-08-29T16:37:05.781Z"
  kind: "evidence"
  summary: "Verified 2026-08-29 follow-up: added a durable CLI surface for the explicit move increment: `otto artifact move <id> --to repository|host`. It validates the destination, capability-gates on server_info.features.artifactStoreMove, and delegates exclusively to artifact.store.move.request; it performs no local file edits and therefore shares the daemon's settled-only, staged-transfer, recovery behavior with the UI. The artifact command's feature gate was made capability-specific so existing data commands remain gated by artifactDataUpdate while move requires artifactStoreMove. docs/data-model.md records the CLI path. Proof: CLI typecheck, targeted CLI lint, and cli-surface test (8 assertions). This adds CLI command-surface proof only; it does not replace an interactive live-daemon/E2E move test."
  source: "Implementation and verification, 2026-08-29"
  affects: ["release-0-9-product-completion","e2e-qa-coverage"]
- time: "2026-08-29T16:42:20.116Z"
  kind: "evidence"
  summary: "Verified 2026-08-29 follow-up: completed the explicit migration path for unlabelled legacy Artifact records. Library cards now disclose missing ownership metadata as “Legacy location” without inferring repository or host ownership, and capability-gated actions offer an explicit choice of repository or this host. The existing daemon move RPC uses that choice to remove the legacy source record, transfer the HTML and last-good snapshot, and write normal storageLocation metadata at the destination. docs/data-model.md now describes this path. Proof: service fixture creates an unlabelled legacy host-global record, moves it to the project repository, verifies source removal, destination metadata, and retained snapshot; target results are 24 assertions across artifact-service and app artifact derivation. Server-stack and app typechecks plus targeted lint pass. Interactive browser/E2E exercise of the legacy menu and confirmation remains open."
  source: "Implementation and verification, 2026-08-29"
  affects: ["release-0-9-product-completion","e2e-qa-coverage"]
- time: "2026-08-29T16:49:07.425Z"
  kind: "evidence"
  summary: "Verified 2026-08-29: added the first durable provenance slice. Artifact metadata now has an additive, discriminated latest-source field with Chat, Workflow, and Schedule variants; old records remain readable. The daemon-owned create_artifact tool stamps its calling chat ID, ArtifactService persists it, and an artifact card capability-gates source disclosure plus a read-only “View source chat” action. The existing transcript viewer supplies the honest unavailable state when that chat cannot be fetched. The Workflow and Schedule source variants are schema-reserved only: no adapter or deep link is claimed. docs/data-model.md distinguishes generation-agent identity from source provenance. Proof: a mock-provider-catalog tool test proves create_artifact sends the caller Chat source; a service test proves persistence; a protocol parser fixture accepts the additive field. Targeted result: 44 assertions across tool, service, protocol, and app derivation tests; build:client, server-stack and app typechecks, plus targeted lint passed."
  source: "Implementation and verification, 2026-08-29"
  affects: ["release-0-9-product-completion","schedules","workflows","e2e-qa-coverage"]
- time: "2026-08-29T16:58:20.245Z"
  kind: "evidence"
  summary: "Verified 2026-08-29: the explicit artifact location move UI now has operation-state recovery rather than silently dropping errors. The selected card shows “Moving artifact…”, its move choices disable while the operation is pending, and a failed move remains in the Artifacts view with the daemon error plus Try again and Dismiss controls. A ref guard prevents a duplicate confirmed move for the same artifact before React rerenders. This is a UI-only resilience increment over the already-proven atomic move service; app typecheck and lint passed for artifacts-screen, artifact-grid, and artifact-card. No interactive browser E2E was added: the current E2E coverage matrix is a legacy migration source and must be migrated before adding a new Artifact browser spec, so this UI behavior is not represented as E2E-proven."
  source: "Implementation and verification, 2026-08-29"
  affects: ["release-0-9-product-completion","e2e-qa-coverage"]
- time: "2026-08-29T17:03:20.730Z"
  kind: "evidence"
  summary: "Verified 2026-08-29: added the first Schedule provenance adapter. New-agent Schedule runs already stamp both a schedule id and exact run id on their internal agent; these labels are now centralized and validated in protocol agent-label helpers. `create_artifact` recognizes that complete pair and persists `{ kind: \"schedule\", scheduleId, runId }` before the ordinary Chat fallback. The card therefore discloses Schedule source truthfully, though it does not yet deep-link to a Schedule run. Existing-agent Schedule targets do not carry an execution context into their pre-existing chat, so they intentionally remain Chat-attributed pending a separate runtime-context design; Workflow provenance also remains pending because the current Workflow model has durable run identity but no settled definition-id contract for both AI and Graph forms. `docs/data-model.md` documents these limits. Proof: the mock-provider artifact tool test covers Chat fallback and Schedule precedence; protocol label tests reject incomplete/malformed schedule labels. `npx vitest run packages/protocol/src/agent-labels.test.ts packages/server/src/server/agent/tools/otto-tools.artifact-provenance.test.ts --exclude \".tmp/**\" --bail=1` passed 8 tests; `npm run build:client`, `npm run typecheck:server`, targeted formatting/lint, and diff check passed."
  source: "Implementation and verification, 2026-08-29"
  affects: ["schedules","workflows","release-0-9-product-completion","e2e-qa-coverage"]
- time: "2026-08-29T17:09:52.790Z"
  kind: "evidence"
  summary: "Verified 2026-08-29: expanded the durable Artifact CLI from data/update-data/move operations to library discovery. `otto artifact ls [--project <project-root-or-id>]` uses the existing daemon-owned `artifact.list.request` RPC and the longstanding `artifacts` capability gate, so it neither reads files locally nor requires a new daemon feature. Its output identifies id, name, project, resolved Repository/This host/Legacy ownership, latest source kind, state, and update time without exposing a daemon-local artifact file path. The command offers the direct old-host remediation “Update the host to list artifacts.” `docs/data-model.md` now lists this read path. Proof: focused list-row tests cover host/scheduled provenance disclosure and legacy no-invention behavior; CLI surface tests cover command/options. `npx vitest run packages/cli/src/commands/artifact/ls.test.ts packages/cli/src/cli-surface.test.ts --exclude \".tmp/**\" --bail=1` passed 10 tests; CLI typecheck, targeted lint, format, and diff check passed. This is deterministic CLI proof only, not a live daemon CLI interaction."
  source: "Implementation and verification, 2026-08-29"
  affects: ["release-0-9-product-completion","e2e-qa-coverage"]
- time: "2026-08-29T17:18:54.298Z"
  kind: "evidence"
  summary: "Verified 2026-08-29: Artifact library discovery now includes a standard pinned-clear Search artifacts field. It filters only already-loaded durable metadata, case-insensitively across name, description, project id, status, disclosed repository/host/legacy ownership, and latest source kind; it never reads or parses artifact HTML. Search combines with host, project, and status filters and changes the empty state to “No matching artifacts.” Proof: `artifact-derivation.test.ts` has deterministic coverage for name/description/storage/Schedule-source matching, blank search, and unrelated terms. `npx vitest run packages/app/src/artifacts/artifact-derivation.test.ts --exclude \".tmp/**\" --bail=1` passed 18 tests; app typecheck, targeted lint, format, and diff check passed. Interactive browser coverage remains pending the E2E coverage-matrix migration."
  source: "Implementation and verification, 2026-08-29"
  affects: ["release-0-9-product-completion","e2e-qa-coverage"]
- time: "2026-08-29T17:22:35.180Z"
  kind: "evidence"
  summary: "Added a capability-gated `otto artifact repair <id>` CLI path that delegates to the existing daemon repair RPC and reports only artifact ID, status, update time, and remaining repair availability; it never exposes an artifact filesystem path. The command uses `artifactRepair`, so older hosts receive the existing explicit host-update guidance. `docs/data-model.md` now documents this recovery route. Verified with `npx vitest run packages/cli/src/commands/artifact/repair.test.ts packages/cli/src/cli-surface.test.ts --exclude \".tmp/**\" --bail=1` (2 files, 9 tests), `npm run typecheck --workspace=@otto-code/cli`, targeted lint, formatting, and `git diff --check`. This proves command construction/output shaping and CLI compilation, not a live-daemon repair or browser end-to-end scenario."
  source: "Implementation and targeted verification, 2026-08-29"
  affects: ["release-0-9-product-completion","e2e-qa-coverage"]
- time: "2026-08-29T17:24:30.049Z"
  kind: "evidence"
  summary: "Added `otto artifact regenerate <id>` as the CLI's explicit visual-generation action. It delegates to the existing baseline artifacts regenerate RPC, returns only ID/status/update time, and starts a fresh generation from the stored artifact definition. The CLI documentation now distinguishes this action from `otto artifact update-data <id> --data '<json>'`, which updates declared backing data without regeneration. Verified with `npx vitest run packages/cli/src/commands/artifact/regenerate.test.ts packages/cli/src/commands/artifact/repair.test.ts packages/cli/src/cli-surface.test.ts --exclude \".tmp/**\" --bail=1` (3 files, 10 tests), `npm run typecheck --workspace=@otto-code/cli`, targeted lint, formatting, and `git diff --check`. This proves command construction/output shaping and CLI compilation, not a live generation run."
  source: "Implementation and targeted verification, 2026-08-29"
  affects: ["release-0-9-product-completion","e2e-qa-coverage"]
- time: "2026-08-29T17:26:18.937Z"
  kind: "evidence"
  summary: "Added `otto artifact cancel <id>` as the CLI lifecycle-recovery action. It delegates to the existing artifacts cancel RPC and reports the resulting recoverable status/error without disclosing the artifact filesystem path. The server cancellation path stops the generation watcher and restores last-good output when the cancelled run was a regeneration; CLI documentation now states that contract. Verified with `npx vitest run packages/cli/src/commands/artifact/cancel.test.ts packages/cli/src/commands/artifact/regenerate.test.ts packages/cli/src/commands/artifact/repair.test.ts packages/cli/src/cli-surface.test.ts --exclude \".tmp/**\" --bail=1` (4 files, 11 tests), `npm run typecheck --workspace=@otto-code/cli`, targeted lint, formatting, and `git diff --check`. This proves command construction/output shaping and CLI compilation, not a live cancellation/recovery run."
  source: "Implementation and targeted verification, 2026-08-29"
  affects: ["release-0-9-product-completion","e2e-qa-coverage"]
- time: "2026-08-29T17:30:36.589Z"
  kind: "evidence"
  summary: "Strengthened the new CLI recovery/lifecycle proof with mocked daemon-client tests. `repair`, `regenerate`, and `cancel` now each prove correct `connectArtifactClient` capability selection, delegation of only `{ artifactId }` to the corresponding daemon RPC, successful result shaping without filesystem-path disclosure, and client closure. Verified with `npx vitest run packages/cli/src/commands/artifact/cancel.test.ts packages/cli/src/commands/artifact/regenerate.test.ts packages/cli/src/commands/artifact/repair.test.ts packages/cli/src/cli-surface.test.ts --exclude \".tmp/**\" --bail=1` (4 files, 14 tests), `npm run typecheck --workspace=@otto-code/cli`, targeted lint, formatting, and `git diff --check`. These are mocked boundary tests, not live daemon/provider or browser end-to-end proof."
  source: "Strengthened CLI verification, 2026-08-29"
  affects: ["release-0-9-product-completion","e2e-qa-coverage"]
- time: "2026-08-29T17:33:00.783Z"
  kind: "evidence"
  summary: "Added a focused `ArtifactSession` test for the daemon protocol boundary: explicit regeneration, cancellation, and repair each delegate to the service by artifact ID, return the correlated success response, and publish `artifact.updated.notification` with the resulting lifecycle state. It uses a mocked ArtifactService, so it proves session RPC routing/notification behavior without claiming provider execution, filesystem recovery, or rendered-preview proof. Verified with `npx vitest run packages/server/src/server/session/artifact/artifact-session.test.ts --exclude \".tmp/**\" --bail=1` (1 file, 3 tests), `npm run typecheck --workspace=@otto-code/server`, targeted lint, formatting, and `git diff --check`."
  source: "Daemon session lifecycle verification, 2026-08-29"
  affects: ["release-0-9-product-completion","e2e-qa-coverage"]
- time: "2026-08-29T17:35:01.565Z"
  kind: "evidence"
  summary: "Added `public-docs/artifacts.md` and linked it from Getting Started. The guide documents only current end-user behavior: creation/opening, independent repository versus selected-host storage, explicit moves and Legacy location, design-preserving data updates, explicit regeneration/cancellation/repair, safe external-edit recovery, existing CLI management commands, Chat and new-agent Schedule provenance, and current limits (no publication/cross-host sync, no Workflow or existing-agent Schedule source adapters). Verified with website typecheck and production build. The build completed successfully but emitted unrelated Vite tsconfig-path warnings from existing `.tmp/android-tablet-build/packages/expo-two-way-audio/tsconfig.json`; no source or generated site failure occurred. Public-doc formatting, `git diff --check`, and the no-em-dash check passed."
  source: "End-user documentation and website verification, 2026-08-29"
  affects: ["release-0-9-product-completion","e2e-qa-coverage"]
- time: "2026-08-29T17:36:26.179Z"
  kind: "evidence"
  summary: "Added direct Artifact protocol compatibility coverage. Legacy metadata written before storage location, repair availability, source provenance, and persisted generation-mode/thinking fields still parses with those fields absent; all three additive source shapes (Chat, Schedule, Workflow) parse when supplied; legacy stored records still default absent run history to `[]`. Verified with `npx vitest run packages/protocol/src/artifacts/types.test.ts --exclude \".tmp/**\" --bail=1` (1 file, 5 tests), protocol typecheck (including validator generation), targeted lint, formatting, and `git diff --check`. This is parser/on-disk compatibility proof, not an old-host UI or cross-version integration test."
  source: "Protocol compatibility verification, 2026-08-29"
  affects: ["release-0-9-product-completion","e2e-qa-coverage"]
- time: "2026-08-29T17:37:20.484Z"
  kind: "evidence"
  summary: "Updated `public-docs/cli.md` so the canonical CLI reference exposes `otto artifact ls`, data read/update, explicit regeneration, cancellation, repair, and ownership move. It explicitly states that `update-data` replaces only declared JSON data and does not redesign HTML. Verified by public-doc formatting, no-em-dash check, `git diff --check`, and a successful website production build. The build repeats the unrelated `.tmp/android-tablet-build` tsconfig-path warning but completes successfully."
  source: "CLI documentation reconciliation, 2026-08-29"
  affects: ["release-0-9-product-completion"]
- time: "2026-08-29T17:46:47.462Z"
  kind: "evidence"
  summary: "Added deterministic ArtifactService generation coverage using a mocked agent manager that writes a valid self-contained HTML document to the daemon-selected output path. The proof verifies internal unattended agent creation, run invocation, repository-owned persistence, watcher transition to `ready`, successful retained run record, last-known-good snapshot, retained transcript capture, and internal-agent close. Verified with `npx vitest run packages/server/src/server/artifact/artifact-service.test.ts --exclude \".tmp/**\" --bail=1` (1 file, 10 tests), server typecheck, targeted lint, formatting, and `git diff --check`. This is controlled T1 service proof using a mock agent manager, not a real provider or platform-rendered browser preview."
  source: "Controlled artifact generation verification, 2026-08-29"
  affects: ["release-0-9-product-completion","e2e-qa-coverage"]
- time: "2026-08-29T17:48:26.214Z"
  kind: "evidence"
  summary: "Extended controlled ArtifactService generation proof across both repository and host ownership. A deterministic mock agent manager writes valid HTML for each selected store; each artifact reaches `ready` with a succeeded run, correct resolved storage location/path, durable last-good snapshot, retained generation transcript, and internal-agent cleanup. The cases run sequentially to avoid filesystem-watch timing races on Windows. Verified with `npx vitest run packages/server/src/server/artifact/artifact-service.test.ts --exclude \".tmp/**\" --bail=1` (1 file, 10 tests), server typecheck, targeted lint, formatting, and `git diff --check`. This remains controlled T1 service proof, not a real provider or platform-rendered preview."
  source: "Controlled dual-storage generation verification, 2026-08-29"
  affects: ["release-0-9-product-completion","e2e-qa-coverage"]
- time: "2026-08-29T17:51:48.146Z"
  kind: "evidence"
  summary: "Added `otto artifact create <name> --project <root> --provider <provider> --description <text> [--model <model>] [--thinking <id>]`. It validates all required inputs before connection, delegates to the existing daemon-owned Artifact create RPC, reports the durable ID/status/resolved storage location, and relies on the selected project’s independent Artifacts storage policy. Mocked CLI tests prove request trimming/delegation and pre-connection input rejection. The end-user Artifacts and CLI guides now include creation. Verified with `npx vitest run packages/cli/src/commands/artifact/create.test.ts packages/cli/src/cli-surface.test.ts --exclude \".tmp/**\" --bail=1` (2 files, 10 tests), CLI typecheck, targeted lint, formatting, `git diff --check`, no-em-dash check, and a successful website production build. The website build repeats the unrelated `.tmp/android-tablet-build` tsconfig-path warnings but completes."
  source: "CLI artifact creation implementation and verification, 2026-08-29"
  affects: ["release-0-9-product-completion","e2e-qa-coverage"]
- time: "2026-08-29T17:58:24.791Z"
  kind: "evidence"
  summary: "Extended ready-artifact watching to compare the current persisted metadata against its initial fingerprint and broadcast a changed valid metadata record to connected clients. This lets safe external metadata edits refresh the library without touching HTML. If external metadata is malformed, the watcher logs it and preserves the file exactly as written; it does not write a cached record over the user’s edit. Existing ArtifactService regression tests, server typecheck, targeted lint, formatting, and `git diff --check` pass. This implementation still needs a dedicated filesystem notification test and a user-facing malformed-metadata recovery design/proof, so neither is marked complete."
  source: "External metadata watcher implementation, 2026-08-29"
  affects: ["release-0-9-product-completion","e2e-qa-coverage"]
- time: "2026-08-29T18:00:39.377Z"
  kind: "evidence"
  summary: "Added a filesystem-backed service test proving that a valid external edit to an artifact JSON record broadcasts the renamed metadata to connected clients while preserving the settled, CSP-sanitized HTML byte-for-byte. The controlled dual-storage generation test remains green; its explicit 10s per-test cap accommodates Windows filesystem-watch timing, while the observed run completed in 1.53s. Verified with `npx vitest run packages/server/src/server/artifact/artifact-service.test.ts --exclude \".tmp/**\" --bail=1` (1 file, 11 tests). Malformed external metadata still preserves the invalid file and logs the condition; user-facing recovery remains open."
  source: "External metadata watcher proof, 2026-08-29"
  affects: ["release-0-9-product-completion","e2e-qa-coverage"]
- time: "2026-08-29T18:20:55.470Z"
  kind: "evidence"
  summary: "Added deterministic ArtifactService coverage for the unattended provider boundary. When an artifact request carries an interactive mode, the service queries provider modes, does not replay that requested mode, resolves the provider's unattended configuration, and launches the internal generation agent with the resolved unattended mode. Verified with `npx vitest run packages/server/src/server/artifact/artifact-service.test.ts --exclude \".tmp/**\" --bail=1` (1 file, 12 tests), server typecheck, targeted lint, formatting, and `git diff --check`. This proves mode-resolution behavior through mocked provider snapshots, not every external provider's real runtime behavior."
  source: "Unattended provider-boundary verification, 2026-08-29"
  affects: ["release-0-9-product-completion","e2e-qa-coverage"]
- time: "2026-08-29T18:35:10.494Z"
  kind: "evidence"
  summary: "Renderer security proof now directly covers the Electron Artifact guest boundary: only the private `otto-artifact-preview` partition carrying a self-contained `data:text/html` document is accepted; renderer-controlled preload and elevated preferences are removed; window opening plus main-frame, frame, and redirect navigation are denied. The shared HTML validator regression continues to prove exactly one Otto-owned CSP that permits self-contained interactive content while denying connections, frames, objects, external form submission, and base URLs. This is deterministic T1 renderer-security evidence, not a substitute for browser/Electron/native visual smoke coverage."
  source: "Verified locally 2026-08-29: packages/desktop/src/features/artifact-webview.test.ts and packages/server/src/server/artifact/html-validator-regression.test.ts; d"
  affects: ["release-0-9-product-completion","e2e-qa-coverage"]
- time: "2026-08-29T18:52:10.405Z"
  kind: "evidence"
  summary: "Verified 2026-08-29: ArtifactService creates every generator as `internal: true`, `unattended: true`, and `observable: true`; an interactive requested mode is replaced through the provider's unattended configuration so the job does not wait for a client approval. The guarded deny-by-default proof is limited to Claude and the native OpenAI-compatible family: Claude resolves to `dontAsk` or eligible Auto with the AgentManager deny responder as the escalation backstop, and OpenAI-compatible `dontAsk` denies permission-requiring tools in Otto's native loop. This is not provider parity. Codex currently marks Full Access unattended, Copilot marks Allow All unattended, OpenCode and ACP enable auto-accept, and Pi/OMP have no provider-specific unattended mapping; none is verified as deny-by-default artifact generation. ArtifactService also preserves any explicitly requested provider mode marked `isUnattended`, including `bypassPermissions` for Claude/OpenAI-compatible, so Bypass is not a safe unattended posture. Added deterministic ArtifactService coverage for this pass-through and updated `docs/safe-unattended.md` plus `public-docs/artifacts.md` to disclose the boundary. `npx vitest run packages/server/src/server/artifact/artifact-service.test.ts --exclude \".tmp/**\" --bail=1 -t \"preserves an explicitly requested provider-marked bypass mode\"` passed (1 test); server and website typechecks, targeted lint/format, `git diff --check`, and website production build passed. The full ArtifactService suite separately hit its pre-existing Windows file-watch timing failure in the controlled dual-store generation test before the new test was reached; this audit does not treat that broader suite as green."
  source: "Provider-boundary documentation audit and targeted verification, 2026-08-29"
  affects: ["release-0-9-product-completion","e2e-qa-coverage"]
- time: "2026-08-29T18:52:55.382Z"
  kind: "evidence"
  summary: "Artifact lifecycle and legacy-migration T1 proof now uses real `mkdtemp` filesystem stores plus injected deterministic agent/service adapters. It proves interrupted initial generation settles to a recoverable error after restart, interrupted regeneration restores its prior ready HTML, the legacy host-global bucket remains project-scoped discoverable without a silent move or reassignment, and explicit user-triggered migration to either repository or project-keyed host storage preserves the legacy artifact’s rendered HTML content, metadata/source, last-good snapshot, and retained run history while keeping its original project."
  source: "Verified locally 2026-08-29: `npx vitest run src/server/artifact/artifact-service.test.ts src/server/artifact/artifact-store-registry.test.ts --bail=1 -t \"inter"
  affects: ["release-0-9-product-completion","e2e-qa-coverage"]
- time: "2026-08-29T19:06:47.928Z"
  kind: "evidence"
  summary: "Added a browser user-facing security proof for a hostile but interactive self-contained artifact. The real Artifacts preview renders and preserves its button interaction while its installed CSP and sandbox block a local network probe, top navigation, popup creation, and parent-document access. The evidence includes a Playwright money shot and the coverage matrix row is validated. The browser iframe no longer grants `allow-popups`, which was incompatible with the no-external-navigation policy. A matching real-Electron harness assertion now seeds and opens the private artifact webview, but this local executor stopped its long-running parent before a verdict/result file; Electron proof remains pending a normal desktop/CI harness run. Native remains pending device/simulator evidence because this Windows executor has no configured mobile device lane."
  source: "Verified locally 2026-08-29: `packages/app/e2e/browser/artifact-preview-security.spec.ts` passed (real isolated daemon + Playwright Chromium); focused app/deskt"
  affects: ["e2e-qa-coverage","release-0-9-product-completion"]
- time: "2026-08-29T23:14:57.760Z"
  kind: "evidence"
  summary: "2026-08-29 source audit for the requested existing-agent Schedule-to-Artifact provenance adapter: prerequisites are not yet present, so no implementation was made. The durable existing-agent target is only `{ type: \"agent\", agentId }`; it contains no Artifact identity or structured data-update instruction. `ScheduleService.runSchedule` creates a durable UUID run ID, but the existing-agent branch invokes `agentManager.runAgent(agent.id, wrappedPrompt)` without run-scoped schedule labels. Only the new-agent branch stamps `otto.schedule-id` and `otto.schedule-run` during agent creation, which Artifact creation already resolves. Persisting those labels onto an existing agent is unsafe because agent labels are durable and would misattribute later manual Artifact work. A stable existing-agent execution-context seam plus a persisted Artifact-update target/identity must land before this adapter can be implemented without inventing schedule storage or a prompt fallback."
  source: "Schedule-to-Artifact provenance prerequisite audit, 2026-08-29"
  affects: ["schedules","release-0-9-product-completion"]
- time: "2026-08-29T23:15:08.845Z"
  kind: "evidence"
  summary: "2026-08-29 source audit for the requested existing-agent Schedule-to-Artifact provenance adapter: prerequisites are not yet present, so no implementation was made. The durable existing-agent target is only `{ type: \"agent\", agentId }`; it contains no Artifact identity or structured data-update instruction. `ScheduleService.runSchedule` creates a durable UUID run ID, but the existing-agent branch invokes `agentManager.runAgent(agent.id, wrappedPrompt)` without run-scoped schedule labels. Only the new-agent branch stamps `otto.schedule-id` and `otto.schedule-run` during agent creation, which Artifact creation already resolves. Persisting those labels onto an existing agent is unsafe because agent labels are durable and would misattribute later manual Artifact work. A stable existing-agent execution-context seam plus a persisted Artifact-update target/identity must land before this adapter can be implemented without inventing schedule storage or a prompt fallback."
  source: "Schedule-to-Artifact provenance prerequisite audit, 2026-08-29"
  affects: ["schedules","release-0-9-product-completion"]
- time: "2026-08-29T23:16:12.290Z"
  kind: "evidence"
  summary: "Verified dependency blocker: ArtifactMetadata’s additive `source: { kind: \"workflow\", workflowId, runId }` shape is ready, but the current Workflow execution contract does not provide a universal authoritative Workflow-definition ID to the artifact-creation adapter. Workers expose only the durable run label; Graph runs may expose optional `graphId`, while AI Workflows have no persisted definition identity. Artifact provenance must remain unstamped until [[workflows]] finalizes and propagates stable definition and run IDs for every flavor. No prompt parsing, `runId` aliasing, history, or cross-store coupling was added."
  source: "Workflow-to-Artifact provenance precondition audit, 2026-08-29"
  affects: ["workflows"]
- time: "2026-08-29T23:17:26.792Z"
  kind: "decision"
  summary: "Final Artifact 0.9 audit reconciled stale current-state claims with source-audited, named proof already recorded in the canonical ledger. It does not advance any incomplete ledger row. Status returned to proposed for review."
  source: "Artifact 0.9 final release audit, 2026-08-29"
- time: "2026-08-29T23:18:01.906Z"
  kind: "note"
  summary: "Final release audit: no delivery slice meets every ledger acceptance and proof gate. Partial increments are verified, but no row is promoted to complete."
  affects: ["artifacts"]
- time: "2026-08-29T23:18:29.356Z"
  kind: "evidence"
  summary: "Final 0.9 ledger reconciliation: no Completion ledger row is complete. Source audit confirmed daemon-owned resolver/registry routing, additive protocol/capability boundaries, data-only byte-preservation, explicit settled-only moves, restart reconciliation, repair snapshots, ready-file watching, Chat and new-agent Schedule provenance, and the CLI surfaces. Public Artifact and CLI guides match those verified limits; no public-document correction was required in this audit.\n\nThe web hostile-preview T1 is the only completed platform-rendering proof: its recorded Playwright run proves rendering and interaction while CSP/sandbox block network, navigation, popups, and parent access. Electron has deterministic guest-boundary unit coverage but no completed Electron harness verdict. Native has no configured device/simulator proof. A focused rerun on this Windows executor reached the isolated daemon and Metro but emitted no Playwright verdict, so it adds no passing evidence.\n\nRelease blockers remain: complete T1 library/create/open/status/error/update-versus-regenerate/old-host journeys; controlled T2 create/reopen and data-update proof; rendered Electron and native security smoke; user-visible malformed-metadata recovery; worktree and project-setting session/app coverage; defined open/share lifecycle and restart reopening; Workflow provenance; and the existing-agent Schedule execution-context plus artifact-update target contract owned by [[schedules]]. No status was promoted on code inspection or static tests alone."
  source: "Artifact 0.9 final release audit, 2026-08-29"
  affects: ["release-0-9-product-completion","e2e-qa-coverage","workflows","schedules"]
- time: "2026-08-29T23:18:46.623Z"
  kind: "note"
  summary: "User explicitly requested this final verified release audit and directed the canonical Artifact ledger to be reconciled. The audit corrected only source- and evidence-backed current truth; it does not confirm any incomplete ledger row. New status: confirmed."
- time: "2026-08-29T23:19:11.928Z"
  kind: "evidence"
  summary: "Proof-ledger correction: the earlier record that described `packages/app/e2e/browser/artifact-preview-security.spec.ts` as passed is withdrawn. The spec exists but was not executed in this audit or by the reported Artifact audit; it is not browser proof. The live Electron desktop path, CLI E2E, and live-provider artifact proof were likewise not run. Deterministic T1 evidence executed locally in this correction is limited to `npx vitest run` over Artifact store, resolver, registry, data, HTML-validator, service, session, and provenance files: 11 files / 68 tests passed. It proves daemon/store lifecycle, dual-read legacy discovery, explicit moves, data-block byte preservation and escaping, repair, ready-watcher transitions, regeneration/restart recovery, and daemon-stamped source metadata. A separate focused app/protocol/CLI surface check passed its app/protocol files but failed `packages/cli/src/cli-surface.test.ts`: the test expects `artifact ls --project <project>` while the implemented command exposes `--project <root>`. Therefore no CLI claim has a clean deterministic proof either. Rendering security and every browser/Electron/native/CLI/live-provider claim remain incomplete; test-file presence must not turn a ledger row green."
  source: "Artifact proof-ledger correction, 2026-08-29"
  affects: ["e2e-qa-coverage","release-0-9-product-completion"]
- time: "2026-08-29T23:19:14.620Z"
  kind: "note"
  summary: "Proof-ledger correction: focused deterministic Artifact T1 is green, but browser preview, live Electron, CLI E2E, and live-provider proof are unexecuted; the focused CLI surface set also has one failing stale contract assertion. No charter row advances to complete."
  affects: ["artifacts"]
- time: "2026-08-29T23:20:47.743Z"
  kind: "evidence"
  summary: "The public Artifact guide was corrected to label Artifacts as an in-progress 0.9 implementation with deterministic coverage only; it no longer presents browser preview security, live Electron, CLI round trips, or live-provider generation as release-proven. Its preview-security language now names the unexecuted Chromium and open Electron/native proof as a safety limitation."
  source: "public-docs/artifacts.md"
  affects: ["e2e-qa-coverage"]
- time: "2026-08-29T23:23:20.013Z"
  kind: "evidence"
  summary: "Verified the daemon-owned ArtifactService integration after the session-wiring fix. `bootstrap.ts` creates one service, gives it to `WebSocketServer`, and production Sessions receive that instance; the session-local fallback remains limited to bare Session unit construction and only that fallback is stopped on session close. New focused real-daemon proof in `packages/server/src/server/artifact-service-session.e2e.test.ts` uses a temporary repository ArtifactStore, two WebSocket clients, and an explicitly injected local port. It proves a client mutation re-arms the one ready watcher without becoming an external-edit error, closing either client does not stop daemon-owned ready monitoring, and a genuine later external invalid edit is still detected. Focused ArtifactService tests passed (20 tests); targeted format/lint and server typecheck passed."
  source: "Post-merge ArtifactService integration verification, 2026-08-29"
  affects: ["artifacts"]
- time: "2026-08-29T23:39:27.551Z"
  kind: "evidence"
  summary: "Real Electron platform proof passed: `OTTO_DESKTOP_E2E_ARTIFACT_ONLY=1 npm run test:e2e:browser-tabs --workspace=@otto-code/desktop` built the desktop main process and launched an isolated daemon plus real Electron renderer. The harness mounted the production artifact shape (a `data:text/html` guest in the private `otto-artifact-preview` partition) into the real renderer, so main-process attach/session/navigation guards applied. A hostile canonical-CSP artifact remained interactive while a loopback fetch made zero probe-server requests, `window.open` returned null, attempted navigation left the guest at its data URL, and `require`, `process`, and `ottoDesktop` were unavailable. This is Electron-only boundary evidence. Browser coverage remains blocked by the coverage-matrix migration; native WebView proof remains unrun."
  source: "Focused real Electron Artifact preview smoke, 2026-08-29"
  affects: ["e2e-qa-coverage","release-0-9-product-completion"]
- time: "2026-08-29T23:40:46.098Z"
  kind: "evidence"
  summary: "Companion deterministic check passed: `npm run test:unit --workspace=@otto-code/server -- src/server/artifact/html-validator-regression.test.ts --bail=1` (4 tests). It verifies Otto-owned CSP canonicalization/replacement and preserves allowed inline/data/blob behavior. This complements, but does not substitute for, the passing real Electron boundary smoke."
  source: "Focused Artifact validator regression, 2026-08-29"
  affects: ["e2e-qa-coverage"]
- time: "2026-08-30T02:36:04.847Z"
  kind: "evidence"
  summary: "2026-08-29: Reconciled the shared category-storage contract. Workflow's independently selected stores use the generic resolver and stable opaque store keys without adopting Artifact directory choices or changing Artifact behavior. No Artifact delivery status changed."
