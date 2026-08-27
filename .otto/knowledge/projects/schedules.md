---
id: "schedules"
kind: "project"
title: "Schedules"
status: "confirmed"
tags: ["schedules","automation","workflows","artifacts","v0.9"]
delivery_status: "in_build"
progress_completed: 0
progress_total: 7
progress_unit: "0.9 delivery slices"
created_at: "2026-08-27T00:35:27.555Z"
updated_at: "2026-08-27T02:06:41.341Z"
---
# Schedules

<!-- compiled_truth -->

# Schedules

## Outcome

Schedules run durable Otto work safely and explainably. Built-in targets are a single existing agent, a newly created agent, a saved AI or Graph Workflow, and a design-preserving artifact update. The 0.9 product contract names the three user-facing categories as **one agent**, **saved Workflow**, and **artifact update**; the existing new-agent scheduler remains a compatible execution form of the agent category.

## Verified current baseline

- Durable schedule JSON records already persist cadence, target, status, max/expiry, bounded run history, executor metadata and output/error fields.
- The persisted target schema is a discriminated union of `agent` and `new-agent`; the create RPC also accepts legacy `self` and normalizes it to `agent`.
- The daemon validates five-field cron cadence and optional IANA time zones, computes/recomputes next fire times, supports create/list/inspect/logs/pause/resume/run-now/update/delete, serializes per-schedule writes, caps global concurrent runs at five, and prevents a schedule from overlapping itself.
- Existing-agent runs fail closed when busy; target deletion/archival completes the schedule. New-agent runs create a hidden workspace, recover a daemon-interrupted run as failed, and either archive or reveal the workspace according to the stored policy.
- Runs retry when the existing retry path permits it, retain at most 50 finished records unless a configured max-run count requires more, and preserve a transcript deep link through `agentId` for agent-backed runs.
- The app provides an agent/new-agent form, cadence editor, multi-host/project/model/profile/worktree controls, cards, pause/resume/run-now/delete, last-run transcript access, and client-side missing-existing-agent indication.
- No Schedule target schema, resolver, execution adapter, editor selector, capability gate, recovery flow, audit projection, or target-specific proof exists for saved Workflows or artifact updates.

## 0.9 target and version contract

Every persisted target is a tagged discriminated union. The tag is the sole dispatch boundary; target-specific configuration must not be inferred from prompt text.

- **Agent:** retain current existing-agent and new-agent compatibility, including profile/team run-time resolution and current busy fail-fast semantics until a dedicated policy decision changes it.
- **Workflow:** persist a stable saved Workflow identity and its declared execution kind (AI or Graph), never a reconstructed prompt or a transient run id. Resolve the saved Workflow at fire time so a deliberate save affects later fires. Each run must stamp the exact resolved definition revision or immutable content fingerprint, title and kind into durable history before dispatch.
- **Artifact update:** persist a stable artifact identity plus a structured update instruction/data payload. At fire time resolve the current artifact, then invoke only the design-preserving update path. A run must stamp the artifact identity and resolved design/data revision or fingerprint before mutation. Regeneration from prose is explicitly forbidden.
- A deleted, inaccessible, incompatible, or revision-unresolvable Workflow/artifact is a named permanent target failure: the schedule pauses for repair rather than silently selecting another target, reconstructing a prompt, or consuming retries indefinitely. Repair chooses a valid target deliberately and retains the failed audit record.

Neither saved Workflow definitions nor artifact metadata currently supply an immutable execution revision. Their owning initiatives must expose a stable revision/fingerprint read at schedule execution; Schedules owns recording the resolved snapshot, not inventing a second source of target truth.

## End-to-end delivery inventory

### 1. Data, storage, migration

- Extend the durable schedule target union and create/update RPC inputs additively with `workflow` and `artifact-update` branches. Preserve all existing `agent`, `new-agent`, and create-only `self` records and requests.
- Add typed run-target audit data: requested target, resolved target identity/title/kind, resolution revision/fingerprint, execution adapter, deep-link reference, and target-specific failure code/message. Keep new leaves optional for old run records.
- Update name-plus-target idempotency identity, mutation serialization, pruning and summary projection for every tag.
- Write an explicit persisted-record migration/read-normalization only when required by a concrete legacy shape. No destructive bulk rewrite; unknown or deleted targets remain inspectable user data.

### 2. Daemon services and execution adapters

- Introduce a target resolver boundary that turns the persisted target into a validated, version-stamped executable target immediately before each run.
- Keep one scheduler lifecycle for claiming, run record creation, overlap limit, retry, cancellation, completion, recovery, pruning and notifications. Target adapters may not implement their own clocks or run histories.
- Implement adapters for existing/new agent, saved AI Workflow, saved Graph Workflow and artifact data/update. Workflow execution must go through the saved Workflow service/engine; artifact update must go through the artifact data/update service.
- Define per-target cancellation propagation and startup-recovery behavior. A canceled schedule run must settle once, preserve its target audit, and never leave a hidden workspace/run/artifact operation orphaned.
- Preserve existing scheduler compatibility: existing-agent busy remains explicit and non-interrupting; new-agent profile/team/worktree semantics remain unchanged.

### 3. Editor UX and cadence/policy

- Add a target picker that clearly distinguishes Agent, saved Workflow and Artifact update, then shows only the target’s valid controls and a read-only resolved-target summary.
- Show name, selected target, host/project boundary, cadence, IANA time zone and a deterministic next-run preview before save. Invalid cron, unavailable host/target, unsupported target kind, and unsafe unattended posture block submission with actionable copy.
- Surface the unattended policy per target. Agent policy reuses the established provider/permission posture; Workflow and artifact-update adapters require an explicit policy review and must not silently bypass gates, spend/cap limits, or provider authorization.
- Editing an existing schedule preserves its stored target/config unless the user intentionally changes it. Target repair is a dedicated flow, not an accidental default selection.

### 4. Protocol and capability compatibility

- Keep all wire additions optional/additive and use `z.discriminatedUnion("type", ...)` for all shared-tag target shapes. Wire schemas remain structural; normalization/resolution happens daemon-side.
- Add a centralized `server_info.features.scheduleTargets` capability for the new target editor and mutation RPC shape, with the required dated `COMPAT(scheduleTargets)` cleanup marker. Old clients ignore fields; new clients on old daemons retain legacy agent scheduling and show the upgrade boundary for Workflow/artifact targets. No degraded fallback or prompt reconstruction.
- New target-specific RPCs, if needed beyond extending existing schedule operations, use dotted request/response namespaces. Existing schedule RPC names remain compatible.

### 5. History, deep links, errors and recovery

- Schedule detail/history shows cadence/time zone, requested and resolved target, resolution snapshot, last/next execution, executor, outcome, retry/cancel/overlap disposition and a deep link to the agent, Workflow run, or artifact update result when available.
- Classify durable outcomes: succeeded, failed, skipped/busy, canceled, retrying, target-gone, target-version-unresolvable, authorization/policy blocked and daemon-recovery interrupted. Do not conflate a skipped overlap with a failed execution.
- Target deletion, target-kind mismatch, disabled/unsupported Workflow, artifact absence, version mismatch and permission denial lead to named repair guidance. Retain the original schedule and audit trail.

### 6. Dependencies and boundaries

- [[workflows]] must provide saved AI and Graph Workflow lookup, executable saved-definition resolution, revision/fingerprint exposure, lifecycle deep links and cancellation semantics.
- [[artifacts]] must provide stable metadata lookup, revision/fingerprint exposure and a design-preserving scheduled data/update entrypoint with result/deep-link semantics.
- Provider authorization remains daemon-owned; Schedules neither stores credentials nor adds auth checks to tests.
- Workflow and artifact adapters must meet [[provider-neutral-capability-parity-defines-done]]; provider-specific native behavior is not a separate schedule target.
- Keep the existing per-host scheduler store and run history. Cross-host remote dispatch, arbitrary webhooks, arbitrary shell commands, calendar UI and a general job-DAG engine are explicit non-goals for this charter.

## Completion model

### When the **plan** is complete

The plan is complete only when every entry in the delivery inventory has one of these forms: a verified implementation/proof obligation, an explicit non-goal, or a named dependency with its required contract and owning initiative. A plan is incomplete if it still relies on implied target semantics, undocumented recovery behavior, a generic “provider handles it” assumption, or an untestable user claim.

The plan is currently complete enough to guide the first 0.9 implementation slice, but it is not decision-complete. The unresolved decisions below must be settled before the affected adapter or editor work starts. They are deliberate gates, not permission to invent behavior during implementation.

### When the **feature** is complete

The feature is complete only when all of the following are proved for every shipped target tag:

1. **Target contract:** the schema is additive, discriminated, backward-compatible, and has a stable identity plus a requested and resolved audit representation.
2. **Resolution:** the target resolves immediately before dispatch to an executable saved definition/artifact state with a durable revision or fingerprint; unresolved targets pause for deliberate repair.
3. **Execution:** the appropriate owning service executes the target without prompt reconstruction, hidden fallback, or scheduler-owned credentials.
4. **Lifecycle:** schedule overlap, global capacity, retry, cancellation, terminal settlement, daemon restart and deletion are each defined and tested for the target.
5. **Policy:** unattended behavior, provider authorization, permission posture, cost/cap limits and project/host boundaries are visible and enforced before execution.
6. **User control:** the editor creates and edits only valid target configurations; it previews the cadence/time zone and provides pause, resume, run once, inspect, delete and repair flows.
7. **Audit and recovery:** history records requested/resolved target, revision, executor, outcome/disposition, error code and deep link; target disappearance never erases evidence or silently retargets.
8. **Compatibility:** old clients and daemons retain legacy agent scheduling; new Workflow/artifact capability is centrally gated with no degraded fallback.
9. **Documentation:** the end-user manual describes only proved capability, exact cadence/DST and unattended behavior, failure/recovery behavior and present limitations; operator/API references match the same contract.
10. **Proof:** target-specific protocol, unit, T1 UI and controlled T2 daemon/live-provider evidence is green, including migration and negative paths.

Completion is therefore not “all three target cards render.” It is the conjunction of these ten gates for agent, saved AI Workflow, saved Graph Workflow and artifact-update execution.

### Open product decisions that block affected work

- **Unattended policy:** decide the user-visible permission, provider authorization, spend/cap and side-effect posture for Workflow and artifact-update runs. New-agent safe-unattended behavior is the existing reference, not an automatic inheritance.
- **Retry semantics:** define eligible failure codes, retry count/backoff, whether retries preserve the same resolved target snapshot, and when a failed target must instead pause for repair. Target-gone, version-unresolvable and authorization/policy failures never retry indefinitely.
- **Cancellation semantics:** define cancel authority, adapter propagation, timeout/escalation, terminal audit disposition and cleanup guarantees for an agent, Workflow and artifact operation. Deleting a schedule must not be treated as implicit successful cancellation.
- **Run disposition presentation:** retain the closed legacy wire status values for compatibility, while selecting optional durable disposition/error-code fields and clear UI terminology for busy, capacity-delayed, skipped, retrying, canceled and daemon-interrupted runs.
- **Target edit/version semantics:** confirm that deliberate future saves affect future Workflow/artifact fires, while each already claimed run retains the revision it resolved. Repair must always be an explicit user selection.
- **Time semantics:** preserve the verified five-field cron rule: nonexistent spring-forward local times do not fire, and repeated fall-back matching local minutes fire twice. Decide the precise next-run preview copy and document it.
- **Scope and remote-host recovery:** define user-visible handling for unavailable host, missing remote working directory, disabled provider and expired authorization. Each must name a repair action rather than silently redirecting work.
- **Retention and deep-link durability:** define history retention, result retention and what remains inspectable after the target, workspace or schedule is deleted.

## Documentation-readiness contract

The existing public Schedules pages may describe the shipped agent-scheduling subset only: new agents, existing agents/self-heartbeats, cadence, controls and agent transcript history. They must not imply Workflow or artifact-update targets exist before their corresponding execution and proof gates pass.

Before a 0.9 end-user guide can claim the complete feature, it must answer, in product language:

- Which target is being scheduled, whether it is fresh or continuous work, and what state/version will execute.
- How interval and cron cadence work, including IANA time zone, first-run behavior, spring-forward skip and fall-back duplicate-fire behavior.
- What unattended work may do, which provider/host/project it uses, and how users resolve authorization or policy blocking.
- What happens when the target is busy, unavailable, deleted, incompatible, over capacity, retried, canceled or interrupted by daemon restart.
- Where users inspect durable history, output and target-specific deep links, and how they repair rather than recreate a broken schedule.
- Current exclusions: no arbitrary webhook/shell/calendar/DAG automation and no silent fallback between targets.

An honest guide is a release gate, not post-release polish.

## Verification and evidence strategy

### Baseline assertion audit

Before extending the scheduler, convert every statement in **Verified current baseline** into a deterministic proof case and classify it **proved**, **disproved**, or **not yet covered**. Source inspection is supporting evidence, not proof.

- Use persisted legacy record and wire fixtures to prove old-client/new-daemon and new-client/old-daemon parsing, including legacy create-only `self` normalization and optional new run-audit leaves.
- Use a fake clock and deterministic store/service tests for interval first-fire behavior, five-field cron, default UTC, IANA time zones, next-fire recomputation, expiration and max-runs.
- Prove the declared DST contract with exact spring-forward nonexistent-time and fall-back repeated-minute cases.
- Prove per-schedule overlap prevention, global five-run capacity behavior, existing-agent busy non-interruption, new-agent safe-unattended hidden-workspace lifecycle, restart recovery, bounded history/pruning and transcript deep links.
- Use controlled-daemon UI tests to prove every existing app action and indication that is claimed: create/edit, cadence controls, pause/resume/run once/delete, history and missing-target indication.

Any discrepancy changes either the product contract or the baseline statement before new target work proceeds.

### Per-target acceptance matrix

Every executable target tag—existing agent, new agent, saved AI Workflow, saved Graph Workflow and artifact update—must pass the same matrix. A card rendering, a resolver returning an id, or a happy-path adapter invocation is not sufficient.

1. **Create and persist:** valid editor/API/CLI creation persists the requested target without losing legacy compatibility.
2. **Resolve and stamp:** a due fire resolves immediately before dispatch and durable history records requested target, resolved identity/title/kind, executable revision/fingerprint, executor and deep-link reference.
3. **Execute:** the adapter uses its owning service/engine and produces the expected result without prompt reconstruction, unauthorized credential handling or hidden target fallback.
4. **Lifecycle:** prove overlap, capacity, retry eligibility/exhaustion, cancellation, terminal settlement and daemon-restart behavior through deterministic tests.
5. **Negative and repair:** prove busy, missing/deleted/incompatible target, unresolvable version, provider/auth/policy block and unavailable host/project behavior. Each retains audit evidence and exposes its named repair path.
6. **User journey:** prove target selection, target-specific controls, cadence/time-zone preview, unattended posture, history/outcome copy, deep links and repair flows in controlled-daemon Playwright coverage.
7. **Compatibility:** prove the central capability gate with old daemon/new client and old client/new daemon fixtures; Workflow/artifact support never degrades into a legacy prompt path.
8. **Live controlled evidence:** run the target through a controlled daemon and real supported provider/engine after deterministic proofs pass.

Artifact update has an additional non-negotiable proof: compare its preserved design structure before and after execution and show that the scheduled operation changed only the allowed data/update surface, never regenerated the artifact from prose.

### Release evidence bundle

Release proof is complete only when the charter links or records:

- Targeted protocol, persistence, resolver, scheduler and adapter test results.
- T1 controlled-daemon/Playwright evidence for every user journey and negative repair path.
- T2 controlled daemon/live-provider or live-engine evidence for each executable target.
- Cron/DST, overlap/capacity, retry, cancellation, restart recovery and deleted-target repair traces.
- Revision/fingerprint and deep-link evidence for a successful and a failed run of each target.
- A documentation claim review mapping each user-facing promise to a passing scenario. Unproved claims are removed or labeled as unavailable before publication.

A target may be marked delivered only when its complete matrix and documentation mapping are proved; delivery progress must not advance for schema-only or UI-only partial work.

## Delivery slices and proof

1. **Target contract foundation:** additive discriminated target and run-audit schemas, storage identity and compatibility tests. No public creation of a target until its resolver/adapter exists.
2. **Resolution boundary:** shared target resolver, owning-service revision/fingerprint contract and permanent deleted/unresolvable target outcomes.
3. **Workflow adapter:** saved AI and Graph Workflow execution, cancellation/retry/overlap/recovery semantics, run deep links and daemon/protocol proof.
4. **Artifact-update adapter:** design-preserving update execution, revision audit, cancellation/recovery and artifact result deep links.
5. **Target-aware editor:** target picker/forms, cadence/time-zone preview, unattended posture, capability upgrade state and repair UX.
6. **History and recovery journey:** durable target audit, failure explanations, target-repair flow and accessible deep links across every target.
7. **Release proof:** target-specific unit, protocol compatibility, T1 UI and T2 controlled daemon/live-provider evidence, including cron/DST time-zone cases, overlap, retry, cancel, restart recovery and deleted target repair.

## Acceptance

A user can create, edit, inspect, pause, resume, run and recover agent, saved AI Workflow, saved Graph Workflow and artifact-update schedules. Every run makes its requested and resolved target, target version, cadence/time zone, unattended posture, last/next execution, result and deep link unambiguous. Artifact-update schedules preserve the existing artifact design. Existing scheduler behavior remains compatible and no target silently falls back to a prompt, another target, or an unauthorized execution mode.

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
