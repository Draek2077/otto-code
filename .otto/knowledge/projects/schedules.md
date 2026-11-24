---
id: "schedules"
kind: "project"
title: "Schedules"
status: "proposed"
tags: ["schedules","automation","workflows","artifacts","v0.9"]
delivery_status: "complete"
progress_completed: 8
progress_total: 8
progress_unit: "restoration checkpoints"
created_at: "2026-08-27T00:35:27.555Z"
updated_at: "2026-11-09T02:52:36.236Z"
---
# Schedules

<!-- compiled_truth -->

# Schedules

## Delivered Otto 0.10 contract

Schedules execute existing agents, new agents, saved AI Workflows, saved Graph Workflows and design-preserving Artifact data updates. Paseo's original ScheduleService remains the sole clock, claim, overlap, capacity, history, restart and settlement owner. Otto-owned ports compose target resolution and project storage before that clock starts. The original native runner and ordinary chat ownership remain intact.

The implementation lives in the Otto-owned server, plugin SDK, built-in plugin, app and CLI Schedule directories. Modified Paseo seams carry OTTO(schedules) markers. Software contracts are specified in docs/otto-schedules.md, indexed in docs/README.md; continuity and controlled acceptance are documented in docs/otto-continuity.md and docs/testing.md.

### Confirmed execution policy

- Scheduled AI and Graph Workflows wait at their ordinary human approval gates. Scheduling never approves a gate; saved autopilot and authority require explicit review.
- Failed attempts wait for the next cadence. There are no automatic execution retries between fires, even for proven pre-effect failures. Uncertain outcomes pause for explicit inspection.
- Missing targets, changed authority, invalid canonical bindings and unsupported retained policies pause for deliberate repair. No fallback prompt, different target, provider or host is selected.
- Cancellation addresses the exact Schedule/run pair. Capacity and per-Schedule ownership remain held until the underlying target owner settles. An unconfirmed cancellation is an unknown outcome, not proof of cancellation.
- A durable claim whose settlement could not be published fences subsequent automatic and manual attempts. Restart preserves its audit and pauses for inspection rather than replaying effects.

## Storage, continuity and explicit transfer

Schedules have an independent host default and per-project override. They never inherit Knowledge, Artifact or Workflow location.

- Repository: canonical project root/.otto/schedules/.
- Host-local: selected daemon OTTO_HOME/project-schedules/persisted-directory-identity/.
- Legacy host-global: OTTO_HOME/schedules/, discovered and controlled in place.

The canonical project metadata owner persists scheduleLocation and scheduleDirectoryName with revision checks. Worktrees resolve to their owning project. Settings changes select only new-record placement; existing records retain their exact origin and remain discoverable. Host-local data belongs to the selected daemon, never the browser filesystem.

Discovery and mutations recheck canonical bindings, actual bytes and duplicate identities. Invalid files are preserved with diagnostics. Atomic-replacement read conflicts are temporary observations; a scan cannot publish a partial missing-record index or overwrite a newer owned publication. Exact detail/history inspection shares the existing per-ID write queue. External editors remain outside that cooperating queue; the final compare/rename race is a documented filesystem boundary.

Copy settings creates a distinct paused identity with empty history and preserves source bytes. Move retains identity and verified full history, pauses the destination and retires the fenced source into recovery only after verification. Digest-bound receipts, exact source backups and stable operation IDs make uncertain transfer inspection/reconciliation explicit. Active runs cannot move or delete. Lock recovery requires inspected revisions and explicit confirmation that owning-host writers stopped. No inspection replays a transfer.

Unknown persisted fields and prior settings survive supported rewrites. Legacy flat Workflow references and unsupported profile/provider authority records remain byte-preserved, dormant and diagnosable; they are not silently converted or stripped. Restoring deferred profile/team ownership is outside this Schedule extension.

## Target resolution and execution

Every claim records its requested target, resolves through the canonical owning service immediately before effects, and durably stamps resolved identity, content revision/fingerprint, authority, executor and result link.

- Existing/new agents use Paseo's provider and workspace owners. Atomic idle admission cannot steer a manual turn that wins a race. Legacy projectless native records remain controllable without an implicit project transfer.
- Saved AI/Graph Workflows use their saved-definition review/start and lifecycle owners, explicit workspace and model seats. Content updates can affect later fires; topology, permissions, seats, caps, unknown authority or executable-template changes require review. AI Planning and human gates remain active until actual settlement.
- Artifact updates resolve exact project/workspace and origin. Literal or explicitly selected provider/model instruction updates change only the validated otto-artifact-data JSON span. Every other presentation byte is preserved. Generation runs a fresh nonpersistent JSON-only completion, attaches no Otto tool catalog and denies surfaced permissions; it never falls back to HTML regeneration. Existing native-provider startup customization semantics remain unchanged. The separately deferred Context isolation investigation is not claimed complete.

One Schedule cannot overlap itself and total admission remains bounded at five. Delayed or non-cooperative cleanup retains those bounded reservations and fences late starts. Shutdown revokes admission and waits without depending on a provider returning promptly.

## App, settings, CLI and MCP

Schedules remains in main navigation. Upgraded hosts show a wide inventory/detail layout and compact adaptive selection, with host/project scope, target picker, native cadence controls, IANA zone and three daemon-computed next fires. Human approval, target review and unattended authority are distinct controls. Native targets reuse Paseo controls. AI/Graph and Artifact choices come from their existing libraries.

Create, edit, pause, resume, Run once, cancel, delete, inspect, repair, Copy or move, storage controls and result links use the same daemon owners. Run once acknowledges admission without waiting for a human gate. Host Settings and Project Settings expose independent Schedule revision domains; the page Storage action shows both without moving records.

Forms keep local drafts and origin revisions, serialize writes, retain failed/conflicted edits and never automatically resend or adopt peer revisions. Unconfirmed writes require exact operation inspection and explicit confirmed reload. Expanded transport/audit payloads keep ordinary actions reachable. Hidden views release read demand; accepted work stays daemon-owned.

One canonical query observer owns scoped, bounded changes. Read-only typed busy observations can retry at most twice through the existing query cache. This never retries execution, mutation or watches. Scope changes reset cursors, and lower authoritative counters after daemon restart are accepted.

The original native CLI remains available. Otto schedule targets operations provides progressive schema discovery and exact JSON inputs, requiring --approved for writes, one request and validated replies. Provider-neutral schedule_catalog and schedule_operation MCP tools reuse canonical host/project and provider approval, with bounded output and progressive discovery. Workflow-owned members cannot schedule recursively. These surfaces own no credentials, alternate provider, clock or executor.

## History, time and protocol

Full immutable history is retained beside bounded recent primary records. Paging defaults to 25 and accepts 1 through 50. Content-addressed index nodes and bounded immutable result parts preserve lifetime max-run counts and older audit/results. Corrupt/missing history excludes the record without rewriting data. Moves verify referenced history; copies intentionally start empty.

History identifies requested/resolved target, content and authority revisions, cadence, executor, outcome, cancellation/recovery disposition and exact chat/Workflow/Artifact result link. Malformed or cross-host links never guess another collection. Explicit deletion retains a recovery record; a missing target does not erase evidence.

Five-field cron uses the existing implementation: default UTC or explicit IANA zone, skipped nonexistent spring-forward minutes and two matching repeated fall-back minutes. Existing interval/expiry/max-run behavior remains owned by the same scheduler.

The original closed transport target/status unions remain unchanged. Extended DTOs and authenticated dotted RPCs live in the Otto SDK/built-in route. The single optional server_info.features.scheduleTargets capability selects the new editor; old hosts retain native scheduling. New extended targets never degrade into legacy prompts. The dated COMPAT gate records v0.10 and removal target 2027-05-08. Both version directions retain structural parsing.

## Acceptance and eight delivery checkpoints

Each of the five execution forms requires: schema/create/persistence; immediate canonical resolution with revision audit; execution through the owner; overlap/capacity/cancellation/restart/no-retry semantics; negative/repair paths; visible user controls; compatibility; and controlled daemon/engine evidence. Artifact proof additionally compares all presentation bytes outside the allowed JSON span.

1. Independent storage, canonical project/worktree resolution, legacy discovery and duplicate exclusion.
2. Discriminated internal target/audit schemas, unknown-field retention and unchanged legacy transport.
3. Canonical target resolution, content/authority fingerprints and permanent repair outcomes.
4. Saved AI/Graph execution, approval, Planning, cancellation and ordinary result links.
5. Literal/instruction Artifact data updates with preserved design and exact result provenance.
6. App editor, host/project settings, capability gate, local-draft safety, cadence and approval UX.
7. Full history, transfer receipts, lock/unknown-outcome recovery, retained legacy diagnostics and progressive CLI/MCP.
8. Required normal hooks, focused tests, real controlled browser journeys, broad CI and affected product builds.

Cross-host dispatch, arbitrary webhooks/shell commands, calendar UI and a second DAG/job engine remain non-goals. Provider authorization stays with the owning daemon services. This charter does not claim all Otto restoration initiatives complete.

## Verified delivery evidence

- Final integration source: f61be0d302dc4cb8465bcbd138ebf79817e4cf83 on otto-0.10/phase-0. All normal commit hooks passed, including all-workspace typechecking; working tree clean.
- [Main CI](https://github.com/Draek2077/otto-code/actions/runs/42549959048): all 21 jobs passed, including Linux/Windows server suites, macOS file observation, CLI, app, desktop and eight broad Playwright shards. The formerly failing native Schedule shard passed 115 cases with its existing one skip.
- [Full Otto app acceptance](https://github.com/Draek2077/otto-code/actions/runs/42549956593): 42 + 39 = 81 cases passed on final source. This includes six Schedule target journeys, CAS draft recovery, native legacy controls, approval/Planning/cancellation and design-preserving Artifact updates. Final wide/compact screenshots were inspected; no busy-error banner remained.
- [Dedicated Schedule matrix](https://github.com/Draek2077/otto-code/actions/runs/42548171306): 14/14 passed at e046dd8f7d8ef57a3e2c89c9f06eb3bc5d666f1b (six extended journeys plus eight original native UI capability-floor cases). Subsequent f61 changes only Preview recovery/tests/docs; Schedule source is unchanged. The eight native cases also passed in final-source broad CI.
- [Preview acceptance](https://github.com/Draek2077/otto-code/actions/runs/42549963995): 2/2 real wide/compact journeys passed after a measured initial-navigation recovery fix. The exact Preview host fixture passed 13/13, targeted format/lint/server typecheck and strict test-file typecheck. Healthy routes/process ownership are unchanged.
- [Editor runtime acceptance](https://github.com/Draek2077/otto-code/actions/runs/42549956678): passed on final source.
- [Desktop builds and installed smoke](https://github.com/Draek2077/otto-code/actions/runs/42549969915): Windows, Linux, unsigned macOS ARM64/x64 and restricted-user-namespace installed Linux acceptance passed. Apple signing gate passed; release/publish jobs skipped.
- [Docker](https://github.com/Draek2077/otto-code/actions/runs/42549973830): both architectures and installed Host Browser acceptance passed, publication disabled.
- [Nix](https://github.com/Draek2077/otto-code/actions/runs/42549978763): Linux daemon/desktop and Darwin desktop passed. Linux attempt one failed on external cache.nixos.org HTTP 416 after an interrupted download; same-source failed-job retry passed. No Nix source/policy change.
- [Android APK/AAB](https://github.com/Draek2077/otto-code/actions/runs/42541877585): passed at d4e12e4ce693a433bf7c5553f502fcf2f4514d45. Subsequent differences are server-only registry/Preview recovery and test/CI/docs files; affected Android runtime app/SDK/protocol/dependency inputs are unchanged. This is retained matching-input proof, not a claim the APK was rebuilt at f61.
- Focused Schedule owner, registry/history, target, transfer/recovery, form, observation, SDK/CLI/MCP and compatibility fixtures passed during implementation and in final CI. Local unchanged green tests were not rerun. Documentation and coverage entries describe the implemented behavior.

## Proof boundaries

Local applications, models and daemons remained stopped; installed Otto was not changed. Controlled process/browser/provider fixtures and packaged smoke ran in GitHub CI. Provider-neutral owner integration is exercised with isolated loopback provider/real daemon paths, not paid vendor credentials or every native CLI against an external service. Browser compatibility-floor fixtures remove only the optional Schedule extension capability from real server_info frames; they are explicit synthetic old-contract tests, not proof an old binary ran.

Android and iOS have distinct proof boundaries: Android APK/AAB build evidence is retained for identical affected runtime inputs; iOS retains its existing credential/signing gate. No release, publish, tag, deployment or installed-app replacement occurred. User review/testing follows this completed phase.

## Timeline

- time: "2026-08-27T00:35:27.555Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["workflows","artifacts","e2e-qa-coverage"]
- time: "2026-08-27T00:35:27.555Z"
  kind: "evidence"
  summary: "Initial 0.9 charter created from user direction and the existing Otto implementation/Knowledge inventory on 2026-08-26. This charter is confirmed as the feature-level planning record and will be expanded with verified current-state and delivery evidence."
- time: "2026-08-27T01:47:28.400Z"
  kind: "decision"
  summary: "Expanded the confirmed 0.9 charter after source inspection so the delivery plan distinguishes the verified agent/new-agent baseline from the unimplemented Workflow and artifact-update target contracts, and closes target-version, audit, policy, recovery, compatibility, and proof gaps named by the product owner."
  source: "Source inspection 2026-08-26: packages/protocol/src/schedule/{types,rpc-schemas}.ts; packages/server/src/server/schedule/{service,store,cron}.ts; packages/app/s"
- time: "2026-08-27T01:47:33.279Z"
  kind: "note"
  summary: "The verified end-to-end inventory replaces the initial five coarse slices with seven proofable delivery slices. No implementation slice is yet complete."
  affects: ["schedules"]
- time: "2026-08-27T01:48:58.954Z"
  kind: "evidence"
  summary: "## Adversarial completeness review\n\nVerified omissions and resolved planning gaps:\n\n- The scheduler currently executes only `agent` and `new-agent`; create uses a duplicate target union to retain the legacy `self` request and update can patch only `newAgentConfig`. Slice 1 must centralize target branch definitions while retaining `self` normalization, and no Workflow/artifact target may become publicly creatable before its resolver is wired.\n- `ScheduleRun.status` and `lastRunStatus` are closed three-value enums (`running`, `succeeded`, `failed`). Adding `canceled` or `skipped` directly would make an old client reject a new daemon's run record. Preserve those legacy values and add optional, open-vocabulary disposition/failure-detail leaves for cancellation, skip, retry and recovery semantics.\n- There is no schedule-cancel RPC or service operation. `delete` removes the schedule/transcript owner but does not actively cancel a claimed run. Cancellation is therefore a required lifecycle slice, not an assumed existing capability.\n- Current per-schedule overlap rejects a duplicate fire; the global cap leaves due schedules pending for a later tick. Existing-agent busy produces a generic failed run. The new history model must distinguish skipped/busy, capacity delay, execution failure and cancellation without changing legacy parseability.\n- Cron is five-field, minute-scanned, IANA-zone aware and defaults an unspecified zone to UTC. Its existing absolute-instant matcher skips a nonexistent spring-forward wall time and fires both matching instants in a repeated fall-back wall minute. Preserve that behavior as the declared 0.9 DST rule, show the selected zone in editor/history, and prove both cases.\n- Existing-agent targets run through the resident agent and busy-fail before dispatch; new-agent targets resolve an unattended provider mode, create an internal hidden workspace and use the safe-unattended permission guard. Workflow and artifact adapters must declare equivalent unattended/cap/authorization behavior rather than inheriting it accidentally.\n- Graphs and artifacts expose mutable ids and `updatedAt`, but neither source inspected exposes an immutable saved-definition/artifact execution revision. Workflow and Artifact owners must supply a stable fingerprint/revision before schedule adapters launch; the scheduler only stamps the resolution result.\n- The app has no target picker and derives labels/actions only for agent/new-agent. Existing-agent rows intentionally have no run/pause/resume actions in the current UI. Target-aware controls, deep links and repair affordances are therefore new work, not a cosmetic extension.\n- Existing agent transcript deep links use `agentId`; Workflow and artifact executions need their own durable run/result identifiers. Target audit must remain after target deletion and schedule records must not be silently rewritten to another target.\n\nExplicit non-goals confirmed: no prompt reconstruction, artifact regeneration, silent executor fallback, arbitrary shell/webhook jobs, calendar surface, generic job-DAG engine or scheduler-owned credential storage."
  source: "Adversarial source review 2026-08-26: packages/protocol/src/schedule/{types,rpc-schemas}.ts; packages/server/src/server/schedule/{service,cron}.ts; packages/ser"
  affects: ["workflows","artifacts","e2e-qa-coverage"]
- time: "2026-08-27T01:53:34.280Z"
  kind: "evidence"
  summary: "Implemented the first partial foundation increment: each newly claimed legacy agent/new-agent run persists an optional immutable requested-target snapshot before target resolution/execution. Old persisted runs remain valid because the field is optional. Proof: protocol schema tests (5 passed) and scheduler service tests (87 passed). `npm run typecheck --workspace=@otto-code/protocol` and targeted lint passed. Server typecheck was retried after `npm run build:server` and remains blocked only by unrelated Kanban `boardOwner` type drift in `packages/server/src/server/session.ts`; this change introduced no server type errors."
  source: "Implemented and verified 2026-08-26: packages/protocol/src/schedule/types.ts; packages/server/src/server/schedule/service.ts; targeted tests packages/protocol/s"
- time: "2026-08-27T01:53:38.485Z"
  kind: "note"
  summary: "Implementation has begun with a verified partial audit-history foundation, but none of the seven complete delivery slices is proven end to end. Workflow/artifact execution remains blocked on their owning revision and resolver contracts."
  affects: ["schedules"]
- time: "2026-08-27T02:02:14.644Z"
  kind: "decision"
  summary: "The feature owner asked to enrich the confirmed Schedules plan with the end-user capability audit so the team can determine both plan completeness and product completion without treating undocumented or unresolved semantics as done."
  source: "Verified implementation/charter audit 2026-08-26: schedule protocol, daemon service/store/cron, app schedule UI, public schedule manuals, Workflow and Artifact "
  affects: ["workflows","artifacts","e2e-qa-coverage","provider-neutral-capability-parity-defines-done"]
- time: "2026-08-27T02:06:41.341Z"
  kind: "decision"
  summary: "The feature owner requested that the Schedules charter define how existing assertions and completed 0.9 capabilities are proved. The charter now requires a baseline assertion audit, a uniform per-target acceptance matrix, and a release evidence bundle before delivery can advance."
  source: "Schedules capability and documentation audit, 2026-08-26; repository testing conventions in docs/testing.md."
  affects: ["workflows","artifacts","e2e-qa-coverage"]
- time: "2026-08-28T04:05:32.058Z"
  kind: "decision"
  summary: "Remove a wiki link to a proposed decision from confirmed schedule truth while preserving the provider-neutral capability-parity requirement."
  source: "Knowledge link integrity repair, 2026-08-27"
- time: "2026-08-29T14:03:12.089Z"
  kind: "decision"
  summary: "Product-owner correction: Schedules has its own repository-versus-host-local default and per-project override. It shares only the storage-resolution platform with Knowledge, Artifacts and Workflows; it does not follow Project Knowledge's selected location. Status returned to proposed for review."
  source: "Product-owner storage-policy correction relayed 2026-08-29; verified current scheduler construction in packages/server/src/server/schedule/service.ts."
  affects: ["workflows","artifacts","project-knowledge-context-management"]
- time: "2026-08-29T14:03:54.790Z"
  kind: "note"
  summary: "Storage resolution is a required new 0.9 slice. It is planned only; no storage implementation or proof is claimed."
  affects: ["schedules"]
- time: "2026-08-29T14:04:26.086Z"
  kind: "decision"
  summary: "Correct the literal newline escape introduced while recording the storage-platform dependency, so the charter remains valid Markdown and link discovery can resolve its outgoing dependencies."
  source: "Knowledge integrity repair 2026-08-29."
- time: "2026-08-29T14:04:47.891Z"
  kind: "note"
  summary: "The product owner explicitly directed the independent Schedules storage contract on 2026-08-29; the charter remains confirmed after its daemon-managed rewrite. New status: confirmed."
- time: "2026-08-29T22:49:11.308Z"
  kind: "evidence"
  summary: "Wave 4B saved Graph Workflow Schedule adapter verified 2026-08-29. Schedule configuration persists only `{ type: \"workflow\", definitionId, projectRoot }`. At fire time the daemon resolves that project’s `WorkflowStoreRegistry` location, opens `location.definitionsDirectory` through an injected `GraphStore` factory, requires full `workflowStorage` provenance equality, and passes that project store into the ordinary graph Workflow launcher. There is no read or fallback to the legacy daemon-global graph store. The durable Workflow run carries `{ scheduleId, scheduleRunId }`; Schedule history retains immutable target and resolved definition/title/project/fingerprint/Workflow-run linkage. Missing definition, unavailable storage host, provenance mismatch, unsupported host capability, and failed launch are `ScheduleWorkflowTargetError`s, preserving history and pausing for repair. The app gates selection on `server_info.features.scheduleWorkflowTargets` and lists only provenance-matching saved project Graphs through `workflows.graphs.list`; it does not list starters or legacy Graphs. Proof: `npm run typecheck:server`, `npm run typecheck --workspace=@otto-code/app`, targeted lint, and 6 focused Vitest files / 151 tests passed (protocol target compatibility, project-store-only and same-id legacy exclusion, storage/provenance failures, durable source, repair pause, and form state). Knowledge link lint passed with zero broken links."
  source: "Wave 4B source and targeted executable verification, 2026-08-29"
  affects: ["workflows","release-0-9-product-completion"]
- time: "2026-08-29T22:53:40.243Z"
  kind: "decision"
  summary: "Reconciled the verified Wave 4B saved Graph Workflow Schedule target with the existing Schedules baseline, including its project-store authority boundary and remaining unsupported target/editing/storage work. Status returned to proposed for review."
  source: "Wave 4B source audit and targeted verification, 2026-08-29"
  affects: ["workflows","release-0-9-product-completion"]
- time: "2026-08-29T22:54:29.102Z"
  kind: "note"
  summary: "The product owner previously authorized confirmation of verified Workflow facts. This reconciliation records only source-audited and targeted-test-backed Wave 2A/3A/4A/4B outcomes and leaves remaining work explicit. New status: confirmed."
- time: "2026-08-29T22:55:01.510Z"
  kind: "evidence"
  summary: "Wave 4B final verification correction, 2026-08-29: the completed saved-Graph Workflow Schedule adapter pass ran 7 focused Vitest files with 158 tests, superseding the earlier provisional 151-test count in the Wave 4B evidence. Targeted format/lint and app typecheck passed. Server typecheck remains blocked by unrelated dirty `packages/server/src/server/session.ts:11543` (`Logger` missing), which this slice did not modify."
  source: "Wave 4B final agent report, 2026-08-29"
  affects: ["workflows","schedules","release-0-9-product-completion"]
- time: "2026-08-29T23:14:55.600Z"
  kind: "evidence"
  summary: "2026-08-29 source audit for the requested existing-agent Schedule-to-Artifact provenance adapter: prerequisites are not yet present, so no implementation was made. The durable existing-agent target is only `{ type: \"agent\", agentId }`; it contains no Artifact identity or structured data-update instruction. `ScheduleService.runSchedule` creates a durable UUID run ID, but the existing-agent branch invokes `agentManager.runAgent(agent.id, wrappedPrompt)` without run-scoped schedule labels. Only the new-agent branch stamps `otto.schedule-id` and `otto.schedule-run` during agent creation, which Artifact creation already resolves. Persisting those labels onto an existing agent is unsafe because agent labels are durable and would misattribute later manual Artifact work. A stable existing-agent execution-context seam plus a persisted Artifact-update target/identity must land before this adapter can be implemented without inventing schedule storage or a prompt fallback."
  source: "Schedule-to-Artifact provenance prerequisite audit, 2026-08-29"
  affects: ["artifacts","release-0-9-product-completion"]
- time: "2026-08-29T23:15:06.848Z"
  kind: "evidence"
  summary: "2026-08-29 source audit for the requested existing-agent Schedule-to-Artifact provenance adapter: prerequisites are not yet present, so no implementation was made. The durable existing-agent target is only `{ type: \"agent\", agentId }`; it contains no Artifact identity or structured data-update instruction. `ScheduleService.runSchedule` creates a durable UUID run ID, but the existing-agent branch invokes `agentManager.runAgent(agent.id, wrappedPrompt)` without run-scoped schedule labels. Only the new-agent branch stamps `otto.schedule-id` and `otto.schedule-run` during agent creation, which Artifact creation already resolves. Persisting those labels onto an existing agent is unsafe because agent labels are durable and would misattribute later manual Artifact work. A stable existing-agent execution-context seam plus a persisted Artifact-update target/identity must land before this adapter can be implemented without inventing schedule storage or a prompt fallback."
  source: "Schedule-to-Artifact provenance prerequisite audit, 2026-08-29"
  affects: ["artifacts","release-0-9-product-completion"]
- time: "2026-08-30T02:36:02.387Z"
  kind: "evidence"
  summary: "2026-08-29: Reconciled Workflow storage lifecycle evidence. Schedule targets continue to resolve saved Graphs by project scope and recorded provenance rather than a daemon path or legacy fallback. The focused schedule target tests remain green alongside the new verified-transfer storage service; no Schedule delivery status changed."
- time: "2026-11-08T13:28:14.110Z"
  kind: "note"
  summary: "Philippe selected the Schedule extensions restoration after the verified Workflow/Artifact ports. Current 0.10 inspection confirms only Paseo agent/new-agent execution is wired; historical 0.9 target/storage evidence is not current-product proof. Initial additive Otto contracts, legacy wire projections/queued mutation guards and injected single-scheduler lifecycle ports pass server typecheck plus 3 lifecycle, 5 boundary and 9 continuity fixtures. Full target adapters, category storage, reachable UI, CLI/MCP, CI/build and controlled product acceptance remain open. No app/daemon/model launches or installed-data writes."
  affects: ["schedules"]
- time: "2026-11-08T14:19:27.292Z"
  kind: "evidence"
  summary: "Backend restoration checkpoint committed and pushed to otto-0.10/phase-0 as 65a7061b7b8d0c3b50a22a212b7f23da8b5757cb. Normal pre-commit format/lint and ALL-workspace typecheck passed; separate strict Schedule, Workflow, Artifact and SDK fixture checks passed. Serial focused evidence accounts for 170 passing cases across 15 files plus 2 existing Windows platform skips in the core Schedule service file (71 passed, 2 skipped). Scope: separate Otto target/origin/audit schemas; unchanged legacy wire union with explicit projections and queued mutation guards; independent Schedule defaults/overrides/pinned host directories, bounded discovery, duplicate suppression, CAS writes and recoverable deletion; target-bound single-scheduler admission/claim/settlement ports; revocable bounded extended runtime; JSON-only Artifact data updates preserving design/CAS/provenance; saved AI/Graph Workflow prepare/start/cancel integration, authority fingerprint, and true Planning/gate settlement with demand-owned waits. No app/daemon/browser/native model launches or installed-home writes. Seam audit passes and upstream relay-facing files are unchanged. CI 42489158287, Otto App Acceptance 42489158218 and Editor Runtime Acceptance 42489158185 are RUNNING for this exact SHA, not yet green proof. Extended targets are NOT wired/advertised in bootstrap or reachable in the app; own RPC, CLI/MCP, editor/settings, migration/repair journeys, full product builds and controlled acceptance remain open. Delivery stays 0/8. The open unattended-approval and retry product choices remain pending; policy callbacks are explicit required owning ports, not silently chosen defaults."
  source: "65a7061b7b8d0c3b50a22a212b7f23da8b5757cb"
- time: "2026-11-08T14:52:55.456Z"
  kind: "evidence"
  summary: "Follow-up Schedule foundation changes are committed and pushed through 89c41becdc7faf8ba1ddc666b5939019f46f579a on otto-0.10/phase-0. Actual first CI failures in 65a7061b7 were corrected: SDK boundary export classification, native MCP queued-guard expectations, and a cross-platform directory-collision fixture. Their targeted fixtures pass (SDK 83; selected MCP 16; registry now15), with normal hooks clean. A measured nested-field regression was fixed by reusing the existing disk-only continuity merge; deliberate known-field removal and target-kind replacement remain explicit. Direct Artifact data-update source inspection now validates the claimed run's target and resolved artifact, owning host/project/location without requiring a chat or reinterpreting an edited current target. Changed Artifact service file32/32 passes; production plus strict Artifact fixture typechecks pass. Normal full-repo format, targeted lint, normal all-workspace precommit typecheck and seam audit pass; upstream relay boundary unchanged. Current exact-source CI42491841859 is QUEUED, App Acceptance42491841272 and Editor Runtime Acceptance42491841300 are RUNNING; these are not green evidence. Earlier superseded runs were canceled, not successes. No new product builds, local app/daemon/browser/model launches or installed-home writes. Extended Schedule adapters still are NOT composed/advertised/reachable in the app. Full UI/RPC/CLI/MCP/storage transfer/acceptance/build work and the unanswered unattended-approval/retry product choices remain open; delivery stays0/8. This evidence does not claim Schedule feature completion."
  source: "89c41becdc7faf8ba1ddc666b5939019f46f579a"
- time: "2026-11-08T19:07:31.444Z"
  kind: "decision"
  summary: "Philippe explicitly chose waiting for human Workflow approval and waiting until the next scheduled time after failure, twice in this conversation. Reconcile only these policy decisions; preserve the full feature scope and current 0/8 delivery boundary. Status returned to proposed for review."
  source: "User decisions in the current Schedule extensions conversation, 2026-11-08."
- time: "2026-11-09T02:51:00.855Z"
  kind: "decision"
  summary: "Reconcile the completed Otto 0.10 Schedule restoration against final-source CI, real controlled app journeys, required product builds and the user's confirmed human-approval/no-execution-retry policy. Replace stale 0.9 baseline/planning claims while retaining all eight acceptance checkpoints, compatibility, deferred legacy authority and proof boundaries. No review confirmation or release is claimed."
- time: "2026-11-09T02:51:17.839Z"
  kind: "note"
  summary: "All eight Schedule restoration checkpoints are complete: independent storage, schemas/audit, canonical resolution, AI/Graph ownership and approval, Artifact data-only updates, visible UI/settings/capability, history/recovery/CLI/MCP, and final-source CI/build acceptance. Main CI 21/21 jobs, full app 81 cases, dedicated Schedule matrix 14 cases, Preview 2 cases, desktop/Docker/Nix and retained unchanged-input Android builds passed. Preserve proposed review status and documented iOS/vendor/legacy-policy limits; this completes Schedules, not every Otto initiative."
  affects: ["schedules"]
- time: "2026-11-09T02:51:34.597Z"
  kind: "evidence"
  summary: "Completed Schedule integration at f61be0d302dc4cb8465bcbd138ebf79817e4cf83, otto-0.10/phase-0. Normal hooks include all-workspace typecheck; clean source was pushed. Final main CI: https://github.com/Draek2077/otto-code/actions/runs/42549959048 (21 successful jobs); app: https://github.com/Draek2077/otto-code/actions/runs/42549956593 (42+39=81 cases); editor: https://github.com/Draek2077/otto-code/actions/runs/42549956678 ; Preview: https://github.com/Draek2077/otto-code/actions/runs/42549963995 (2 cases). Final app screenshots inspected wide and compact. Schedule matrix: https://github.com/Draek2077/otto-code/actions/runs/42548171306 (14 cases at e046, unchanged Schedule source); native compatibility cases also passed final CI shard 6 (115 passed, existing one skip).\n\nFinal affected builds: desktop https://github.com/Draek2077/otto-code/actions/runs/42549969915 (Windows/Linux/unsigned MacARM64+x64/installed Linux smoke), Docker https://github.com/Draek2077/otto-code/actions/runs/42549973830 (both architectures and Host Browser), Nix https://github.com/Draek2077/otto-code/actions/runs/42549978763 (Linux daemon/desktop and Darwin desktop). Nix Linux first failed an external cache download HTTP416; same-source failed-job retry passed. Android APK/AAB https://github.com/Draek2077/otto-code/actions/runs/42541877585 is d4 source; later differences are server-only and tests/CI/docs, leaving Android runtime inputs unchanged. iOS retains agreed signing gate. No publishing/release/installation/local runtime launches.\n\nMeasured CI issues were corrected without weakening product behavior: CLI CRUD fixture cadence moved away from an active boundary; original native UI assertions retained behind a synthetic optional-capability floor instead of disabling built-ins or skipping tests. Independent Preview failure retained HTTP200+ready-server evidence while Chromium showed ERR_CONNECTION_REFUSED; source confirmed initial navigation before listening plus reuse of the failed tab. f61 explicitly retries that observed error page in the same designated tab only, preserving healthy navigation/process ownership and surfacing failed recovery without automatic loops. Targeted Preview host tests13/13 and strict fixture typecheck passed; no stale failed-run proof is reported as green.\n\nBoth confirmed policies hold: ordinary Workflow human gates wait and failed Schedule attempts wait next cadence, with unknown effects paused for inspection. All eight checkpoints reconciled complete while review stays proposed. Deferred profile/team legacy authority remains intact/dormant; Context startup-hook isolation and other Otto projects are not claimed complete."
- time: "2026-11-09T02:52:36.236Z"
  kind: "evidence"
  summary: "Closure validation: the global Knowledge link linter reports six references from Artifacts/E2E pages to Schedules, Workflows, Kanban and the historical release charter. None originate from the reconciled Schedules statement. Review remains proposed as required; no unrelated page, confirmation status or archive was changed to suppress those diagnostics. These are Knowledge catalog cross-reference diagnostics, separate from the successful product CI/build gates."
