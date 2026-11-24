---
id: "persistent-autonomous-orchestrator"
kind: "project"
title: "Otto-native persistent autonomous orchestrator"
status: "proposed"
tags: ["orchestration","autonomy","voice","research"]
delivery_status: "charter"
progress_completed: 0
progress_total: 5
progress_unit: "core autonomous-orchestrator acceptance mileston"
created_at: "2026-10-27T16:22:08.441Z"
updated_at: "2026-10-28T20:23:01.409Z"
---
# Otto-native persistent autonomous orchestrator

<!-- compiled_truth -->

# Otto-native persistent autonomous orchestrator

## Baseline from the user, 2026-10-27
Research and architecture review only. No implementation, new monitoring, worker intervention, daemon restart, or autonomous workflow activation is authorized. Build inside Otto. Reuse its chat/session lifecycle, providers, scheduling, workflows, tools, permissions, artifacts, project integration, persistence, and transport. Original implementation is preferred; public source may be studied for general mechanisms without copying protected expression. Voice is interchangeable and local processing is desirable. Existing pauses remain until explicitly changed.

## Outcome
A persistent personal orchestrator can maintain explicit goals, observe selected projects and managed workers, initiate useful authorized work, delegate, evaluate evidence, recover safely, and communicate by text or live voice without an open chat window. An idle orchestrator consumes no recurring model inference merely to remain alive.

## Proposed architecture for review
Extend daemon services with a supervisory domain, not another agent runtime:
- Durable commitments and runtime reconciliation records: goal, acceptance criteria, source task references, dependencies, project/host scope, policy revision, budgets, pause state, worker/run links, decision/action receipts, and evidence.
- Deterministic event admission and coalescing over existing agent/workflow/project services and ScheduleService. Reconcile authoritative state after restart; existing directory sync is latest-state replication, not a durable event journal.
- Bounded provider-neutral decision turns through existing agent lifecycle. Typed dispositions: act/delegate, wait with wake condition, request input, propose new work, complete with evidence.
- Extend existing authorization with goal-scoped grants, budget reservation, effect receipts, deduplication, and revalidation immediately before dispatch. Model output cannot widen permissions or resume paused work.
- Reuse current voice/STT/TTS and session transport; separate conversation interruption from cancellation of background work. Consider full-duplex audio adapter only after baseline proof.

Knowledge remains durable project truth; profile memory remains lessons/preferences; Kanban remains task authority; Workflow remains execution authority. Supervisor runtime state references them instead of replacing them. Single execution-owner daemon first; reconnecting devices use existing transport. Cross-host execution transfer needs explicit future ownership/fencing, not file synchronization.

## Source observations
Current checkout has AgentManager lifecycle/subscriptions; chat create/message/status tools; Codex direct app-server adapter (not an ACP-only integration); ScheduleService with self-targeted heartbeat tools, concurrency limits and interrupted-run marking; WorkflowService and graph engine with caps, persisted runs and restart failure marking; ProfileMemoryService; atomic Knowledge operations; semantic daemon permissions; modular local speech workers, Parakeet STT, Kokoro TTS, Silero VAD; voice session interruption; directory sync; encrypted relay. Source presence does not establish current runtime proof or release availability. Workflows docs explicitly label creation as an in-progress development-gated surface.

## External research, checked 2026-10-27
- composio-community/open-dot: source src/server/agent/runtime.ts, scheduler.ts, agent/review.ts, voice.ts. Per-dot serialized in-memory inbox, bounded tool loop, persisted approval continuation, scheduled/event wakeups, separate realtime conversation front handing work to text runtime. Useful conceptual split; in-memory pending inbox is not crash-safe execution. Source license not verified.
- openclaw/openclaw: source src/infra/agent-events.ts includes lifecycle ownership generations, stale-owner rejection, bounded activity. Heartbeat/cron documented, but current heartbeat implementation fetches were unavailable. Do not claim a complete source audit.
- NousResearch/hermes-agent: cron/scheduler.py includes scoped in-flight registrations, cancellation ownership, failure incident grouping and reminder cooldown. Useful recovery/alert patterns; no need to adopt its runtime.
- defog-ai/opendot: Apache-2.0 per repository, host-mediated action registry and sandboxed steps per docs/how-it-works.md. Current README explicitly says proposed actions execute without approval despite repository tagline; do not assume safe approval semantics. Mechanism documentation reviewed; runtime source not successfully retrieved.
- thinkwee/OpenDot is a separate MIT project, not the same OpenDot. Identified, not deeply audited.
- Kyutai Moshi: public speech/text full-duplex framework, MLX tested on M3, q4/q8, MIT MLX code and CC-BY-4.0 model weights per publisher. CLI lacks echo cancellation/lag compensation. Tool integration and concurrent local-model performance unproven.
- Block Dessa: https://block.xyz/dessa confirms speech-only training, full duplex, local M4 Max-or-better claim and limited safety-researcher access. No public source/weights license, downloadable model artifact, tool API, or minimum RAM verified. Not a delivery dependency.

## Incremental acceptance milestones
1. Read-only shadow supervisor: persisted goal and event/reconciliation state; no execution; duplicate/reordered events and pauses tested; idle causes zero model calls.
2. One explicit goal, one project, one permitted worker: dispatch using normal Otto tools, evidence-based completion, bounded retries and budgets; demonstrate Codex and a local OpenAI-compatible model.
3. Restart/effect recovery: crash before/after dispatch and receipt; no duplicate consequential actions; ambiguous effects require inspection; paused work remains paused.
4. Multiple project fairness and shared-checkout write exclusion; actionable blocked/approval notifications, inspectable causal audit.
5. Reuse live voice while background work continues; barge-in stops speech without canceling delegated work; reconnect and conversation continuity.
6. Optional full-duplex local backend benchmark and remote-host ownership transfer as separately reviewed work.

## Proof boundaries and dependencies
No runtime tests or model/audio benchmarks were run in this investigation. External main branches are moving references, not pinned reproduction snapshots. Reconcile against the ongoing 0.10 rebuild before implementation. Strict monetary caps require provider accounting/reservation; unknown usage must not be called a proven hard dollar limit. Sleeping/offline hosts do not execute; use an existing always-on Otto daemon if continuous availability is required. No second scheduler, browser stack, connector platform, vector database, model loop, or distributed cluster is justified for the first increment.

## Architecture and functionality baseline, 2026-10-28

This expands the October 27 research into a reviewable product contract and tracking baseline. It does not approve implementation or confirm the proposed architecture. Current inspected checkout HEAD: 9b281ec547741b2309bae804f8b3841c32369aaf. Source findings describe this checkout, not automatically the 0.10 clean-Paseo rebuild or an installed release. The 0.10 charter defers profiles/teams and general chat customizations; this initiative cannot silently restore them as dependencies.

### Architecture boundaries

| Owner | Responsibility | Proposed change |
| --- | --- | --- |
| Supervisor domain, daemon-owned | Commitment lifecycle, subscriptions, decision admission, priority/fairness, reconciliation and causal audit | New domain composed with existing services; no new general execution platform |
| AgentManager and provider adapters | Sessions, model turns, delegation, continuation, interruption and permission responses | Reuse provider-neutral APIs; declare adapter capabilities centrally |
| ScheduleService | Time-based wakeups, existing schedules and run history | Extend target/wakeup seam only where needed; no second scheduler |
| WorkflowService | Bounded coordinated execution, Graph/AI semantics, gates and run evidence | Supervisor references/launches supported runs; never reimplements graph execution |
| Authorization module and provider sandbox | Semantic operation permissions and actual execution boundaries | Narrow existing authority with commitment constraints; do not invent deny precedence in the additive daemon grant model |
| Kanban and project services | Task authority, project/workspace identity and repository ownership | Refer to task IDs and approved project scope |
| Knowledge and profile-memory services where available | Durable project truth and scoped learned lessons | Pull relevant evidence; do not store high-frequency runtime events in Knowledge; profiles are not a prerequisite on the 0.10 target |
| Existing persistence primitives | Atomic durable records, serialization and storage resolution | New supervisor records through existing persistence conventions; separate category policy if introduced |
| Voice/session/speech services | Capture, recognition, playback, turn-taking and transport | Reuse existing pipeline; add conversation/background-work coordination; optional duplex adapter |
| Client/CLI/notifications | Control, explanation, approvals, audit and reconnection | Projections over daemon state; no client-owned autonomous loop |
| Existing host/relay/Hub transport | Remote observation and commands | One designated supervisor owner first; multi-host execution transfer requires explicit ownership protocol |

### Durable object model

These are proposed domain records, not new parallel owners for existing tasks or runs.

- Commitment: id, user outcome, acceptance criteria, source task references, project/workspace/host references, priority, dependencies, policy binding, budget binding, version and lifecycle.
- Wake subscription: commitment, accepted source/type/scope, cursor or reconciliation token, wake condition, coalescing/deduplication keys, expiry.
- Decision: triggering wake IDs, commitment revision, compact evidence references, policy revision, structured disposition, next wake condition and model/usage provenance.
- Action intent and receipt: stable operation ID, exact action/target/input digest, admission revision, dispatch state, existing agent/workflow/result links, effect evidence and ambiguity state.
- Approval: exact action/policy revision, authenticated approver, expiry, disposition and consumption state; reuse existing approval infrastructure where it satisfies this contract.
- Budget: period, token/time/agent/concurrency limits, reservation/usage reconciliation and exhausted state. Hard monetary ceilings require trustworthy accounting and bounded in-flight exposure.
- Incident: commitment/action links, failure signature, attempts, next eligible retry, acknowledgement/escalation and recovery evidence.
- Conversation binding: existing chat/session references and last accepted supervisor update; audio buffers do not become durable reasoning state.

Knowledge documents decisions and curated outcomes. Runtime records retain operational receipts. Retention, export, deletion and sensitive-data handling must be specified for both.

### State and execution contract

Proposed commitment states: draft, active, waiting, needs-input, blocked, paused, completed, canceled. Decision and action execution states are separate, so an active worker is not confused with an active commitment. Completed requires acceptance evidence; canceled and paused are user controls, never model-inferred permissions to resume.

Execution cycle:
1. Existing service emits a relevant event or existing scheduler reaches a registered deadline.
2. Deterministic admission validates source/scope, records/coalesces a wake and checks pause, dependency, capacity and policy constraints.
3. Reconcile authoritative state and assemble a bounded context packet.
4. Invoke a bounded ordinary Otto agent decision turn only when a decision is needed.
5. Validate structured disposition: delegate/act, wait, request input, propose work, complete with evidence, or report blocked.
6. Revalidate current authority and commitment revision, reserve capacity, persist action intent, then dispatch through existing services.
7. Record receipts/outcomes and update the commitment; register the next wake condition.
8. On restart, fence stale owners, reconcile pending intents and workers, retain pauses, and inspect ambiguous effects before retry.

Pause admission is synchronous at the daemon boundary. Late results can be recorded as evidence but cannot dispatch further work after pause. Policy revocation blocks undispatched work. Cancel requests propagate to owned in-flight work where supported; already completed external effects are never represented as undone. A plain voice barge-in stops audio/conversation output, not delegated work; an explicit stop-work request is separately interpreted and applied to its named scope.

### Functionality matrix

Foundation codes: R = relevant source exists in inspected 0.9 checkout; E = partial foundation needing extension; N = new supervisory behavior; Q = optional/later research. These codes do not claim target-0.10 availability or runtime acceptance. Delivery for every row is currently Planned; historical platform implementation is tracked separately.

| ID | User-visible capability and acceptance boundary | Foundation | Proposed milestone |
| --- | --- | --- | --- |
| G01 | Capture durable goal, success criteria, scope and source task references; reopen unchanged after restart | E: Knowledge/project/task primitives | M1 |
| G02 | Persist lifecycle, dependencies, deadlines and explicit ownership; invalid transitions rejected | N | M1 |
| G03 | Pause/resume/cancel at goal and supervisor scope; pauses survive restart and new events | E: existing controls, new commitment enforcement | M1/M3 |
| G04 | Prioritize multiple projects with fairness and explain why work was selected or deferred | N | M4 |
| O01 | Observe selected managed agents/projects without an open chat; unrelated sessions untouched | R: AgentManager subscriptions | M1 |
| O02 | Admit, coalesce and deduplicate durable wakeups; replay/reordering cannot duplicate dispatch | N; directory sync is latest-state only | M1/M3 |
| O03 | Register deadlines/rechecks through existing schedules; no recurring inference for liveness | R: ScheduleService and heartbeat tools | M1 |
| O04 | Reconcile authoritative state after downtime, cursor loss or missed events; explicit missed-wake policy | E | M3 |
| D01 | Bounded decision turn chooses action/delegation/wait/input/proposal/completion with evidence | N atop existing agent execution | M2 |
| D02 | Persist named wait conditions; waiting consumes no active model turn | E: schedules/agent events | M2 |
| D03 | Identify useful new work within selected projects; proposals separate from execution authority | N | M4 |
| D04 | Complete only against acceptance criteria and evidence; record unresolved uncertainty | E: workflow judging/evidence patterns | M2 |
| X01 | Create or continue ordinary Otto-managed workers through existing APIs | R: chat tools/provider adapters | M2 |
| X02 | Respect busy-chat queue/steer/interrupt semantics and explicit worker ownership | R/E: chat messaging; supervisor ownership new | M2 |
| X03 | Follow whole delegated work and consume final results; do not mistake first idle for completion | E: existing orchestration gather/settle | M2 |
| X04 | Launch supported AI/Graph Workflows with exact provenance and capability gates | R/E: workflow services; target availability must be qualified | M4 |
| X05 | Prevent conflicting shared-checkout writes; do not replace writing attempts on dirty effects | E: workflow guardrails, wider admission needed | M4 |
| P01 | Execute only under existing principal authority, provider sandbox and commitment-scoped constraints | E: daemon grants are currently daemon-wide | M2 |
| P02 | Revalidate exact action after approval/policy change; prevent stale/replayed approvals | E | M3 |
| P03 | Enforce hierarchical token/time/agent/concurrency budgets including child work | E: usage/caps; reservations new | M2/M4 |
| P04 | Global stop, revocation and control ownership remain effective during concurrent decisions | E | M3 |
| P05 | Treat project/tool/worker content as evidence, not authority; unsupported enforcement refuses execution | E | M2 |
| C01 | Retrieve scoped Knowledge, tasks, recent outcomes and changed evidence under a context budget | R/E: existing context/Knowledge paths | M2 |
| C02 | Learn explicit preferences/lessons using the accepted target-base memory owner; review/delete retained data | E; 0.9 profile memory cannot be assumed restored | M4 |
| C03 | Preserve goals and decisions across chats/devices without depending on a model thread | N atop existing persistence/transport | M3/M5 |
| C04 | Retention/export/deletion and redaction apply to supervisor records; no secrets in curated Knowledge | E | M4 |
| R01 | Persist intent before dispatch and correlate action, agent/workflow and outcome receipts | N/E | M3 |
| R02 | Restart reconciliation fences stale execution owners and prevents duplicate consequential effects | N | M3 |
| R03 | Classify transient/permanent/permission/ambiguous-effect failures; bounded backoff and repair | E: current failure handling | M3 |
| R04 | Deduplicate incidents, surface blockers and require review when effects cannot be established | N/E | M3 |
| U01 | Inspect goals, active workers, waits, next wake, decisions, approvals, outcomes and remaining budgets | E: existing UI/run projections | M1/M4 |
| U02 | Deliver meaningful progress/blocker/completion updates with deep links and notification restraint | E: existing notifications/timelines | M4 |
| U03 | Reconnect a second authorized device and see the same authoritative state | R/E: existing client/relay; supervisor projection new | M5 |
| U04 | Continue while clients close if owning daemon stays alive; show offline/sleep limitations honestly | E | M3/M5 |
| V01 | Invoke and converse through existing local recognition/agent/synthesis path | R: voice/speech services | M5 |
| V02 | Continue conversation while workers run; inject concise, causally linked work updates | E | M5 |
| V03 | Distinguish barge-in, mute, end-call, pause-goal and cancel-work; test echo/noise and corrections | E | M5 |
| V04 | Resume text/voice continuity across call end and reconnect; mic captures only while listening | E | M5 |
| V05 | Interchangeable local full-duplex speech-to-speech backend with explicit tool/control bridge | Q: Moshi candidate; Dessa not qualified | M6 |
| H01 | One designated daemon owns execution; clients never create competing supervisors | E | M1/M3 |
| H02 | Explicit cross-host execution transfer with fencing, offline reconciliation and authority preservation | Q; no automatic file-sync ownership | Later |
| T01 | Provider-neutral capability declaration and proof for Codex plus a local compatible model | E | M2 |
| T02 | Deterministic restart/event/pause/budget/approval fault tests and exact-build runtime evidence | N: supervisor proof | Every milestone |
| T03 | Apple Silicon latency/memory/thermal benchmark while coding inference runs concurrently | Q: no current hardware proof | M5/M6 |

### Provider and platform proof matrix

Track each capability by provider and platform rather than allowing one successful provider to stand for all.

| Axis | Required evidence |
| --- | --- |
| Codex | Existing adapter create/continue/queue/cancel, sandbox/approval behavior, usage limitations, restart reconciliation |
| Local OpenAI-compatible | Same orchestration contract, daemon tool enforcement, bounded context and tool-schema compliance |
| Other supported providers | Explicit supported/unsupported matrix; qualified execution only; no silent provider substitution |
| Windows/Linux/macOS daemon | Headless lifecycle, persistence, interruption, model/tool execution and installation behavior |
| Desktop/web/mobile clients | Observation, approvals, controls, reconnect and authenticated authority; do not promise identical background microphone behavior |
| Direct/relay/Hub paths | Same authorization, outcome identity and replay-safe command semantics |
| Local speech hardware | Warm/cold latency, audio interruption, memory pressure, sustained performance and concurrent inference |

### Progress model and evidence ledger

Use four independent axes per capability:
- Scope review: draft / approved / deferred.
- Foundation: reusable / extend / new / research.
- Target availability: not assessed / absent / partial / implemented on exact target revision.
- Product delivery: planned / implemented / verified / accepted, with blocked as an explicit condition.

A delivered row records source revision, changed owner/API, focused automated evidence, runtime proof, provider/platform coverage, remaining limits and acceptance decision. Implementation alone never closes a row. A milestone passes only when all mandatory rows meet its exit criteria; optional research rows do not inflate the denominator. Architectural review is separate from shipped functionality. Do not calculate an overall percentage by adding inherited platform pieces.

Baseline:
- Initial external comparison and 0.9 source inventory exist, with the limits preserved above.
- Draft architecture, object model, lifecycle, matrix and milestone gates now exist.
- Target 0.10 seam/dependency mapping is not complete.
- No supervisor implementation or end-to-end acceptance was performed in this effort.
- M1-M5 core acceptance milestones: 0/5 verified. This is a milestone count, not a statement that Otto's reusable platform is 0% built.
- M6 full-duplex research and H02 cross-host transfer are separate optional/later scope.
- Implementation authorization remains absent.

### Milestone gates, dependencies and complexity

| Milestone | Deliverable | Exit proof | Dependencies and risk |
| --- | --- | --- | --- |
| M0 design review | Approved matrix, lifecycle, ownership, protocol seams and target-0.10 dependency map | Review resolves authority, missed-wake, retention and provider capability decisions; no inferred restoration dependencies | Medium; ongoing rebuild and deferred profile/team scope |
| M1 shadow supervisor | Durable commitments, deterministic wake admission and inspection only | No dispatch; zero idle inference; duplicate/reordered events and persisted pauses; source/target provenance | Medium; agent events and persistence |
| M2 bounded autonomy | One goal/project/worker through Otto APIs and narrow policy | Codex and local-model delegation, bounded wait, criteria-based outcome, denied-action behavior and budget exhaustion | Medium-high; effective provider authority and usage accuracy |
| M3 durable recovery | Receipts, fencing, reconciliation, cancellation and incidents | Fault injection before/after dispatch/receipt, no duplicate effects, ambiguous effects stop, pauses and revocation survive | High; hardest correctness boundary |
| M4 portfolio operation | Fairness, dependencies, safe concurrent work, context/memory policy and control UI | Multi-project scenario, conflicting writers refused, meaningful updates, inspectable audit and retention | High; shared checkout/resource coordination |
| M5 conversational interface | Existing voice pipeline connected to durable supervision | Work continues during conversation/end-call; barge-in distinction, microphone lifecycle, reconnect and measured device behavior | Medium-high; audio UX and availability |
| M6 optional duplex | Replaceable qualified speech-to-speech adapter | End-to-end tool bridge, same authority/continuity, benchmarked local hardware, source/weights obligations evaluated | High experimental; no Dessa dependency |

### Open design decisions for review

Proposed defaults, not approvals:
- One owner daemon, explicit selected projects and task sources.
- Proactive discovery proposes work by default; execution requires an existing scoped mandate.
- Coalesce missed observation wakes after downtime; do not replay consequential actions indiscriminately.
- No delegation to unrelated active sessions without explicit binding.
- Existing profiles/teams are optional conveniences, not architecture requirements.
- Default pause stops admission; separately disclose and control already-running workers.
- Retain compact operational receipts with referenced evidence; exact retention and audio/transcript choices need product review.
- No production inference-cost or latency target is claimed until measured; define p50/p95 targets in M0 and qualify on named hardware.
- Action authority remains enforced by daemon/provider controls, never prose or a model confidence score.

## Timeline

- time: "2026-10-27T16:22:08.441Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["agent-orchestration","workflows","schedules"]
- time: "2026-10-27T16:22:08.441Z"
  kind: "evidence"
  summary: "User handoff 2026-10-27; read-only repository source and docs inspection plus cited public publisher/source pages. Architecture and milestones are proposals awaiting review. No implementation or monitoring authorized."
- time: "2026-10-28T20:22:57.536Z"
  kind: "decision"
  summary: "User requested the full architecture and functionality matrix to measure progress. Expanded the existing Draft charter with stable capability IDs, domain ownership, object/lifecycle contracts, target-0.10 separation, provider/platform proof, and acceptance milestones. No implementation or confirmation authorized."
  source: "User request 2026-10-28; checkout 9b281ec547741b2309bae804f8b3841c32369aaf; docs/permissions.md, docs/workflows.md, existing source seams and 0.10 rebuild chart"
- time: "2026-10-28T20:23:01.409Z"
  kind: "note"
  summary: "Established M1-M5 as the core acceptance denominator. Zero have end-to-end supervisor proof; existing platform functionality and draft planning are tracked separately. M0 review, M6 optional duplex and later host transfer are outside this delivery denominator."
  affects: ["persistent-autonomous-orchestrator"]
