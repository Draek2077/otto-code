# Schedule ownership and extension contracts

Paseo's `ScheduleService` owns cadence, due-slot claiming, overlap protection, run history,
restart handling, and final settlement. Otto injects a storage port and target runtime into
that owner. There is no second scheduler or per-project clock.

The optional ports and all target-specific policy live in
`packages/server/src/server/otto/schedules/`. Edits in Paseo's scheduler, store, native tools,
and session boundary carry `OTTO(schedules)` markers. Workflow and Artifact operations use
their existing daemon owners; they do not construct providers or reuse ordinary user chats.
The daemon bootstrap composes these ports before starting Paseo's original clock. Shutdown
stops admission and revokes target waits before Workflow, Artifact and provider teardown.
The native runner remains Paseo-owned. Composition alone does not expose a new editor or
advertise a target capability.

The owned daemon API delegates create, edit, and control actions to that same scheduler.
Its dotted contracts use the authenticated `otto-schedules` built-in route. The target-aware
editor is selected through the single `scheduleTargets` host capability. Hosts without it
retain the original native editor. A create operation carries a stable caller nonce and payload fingerprint;
repeating it returns the saved record even if defaults or target availability changed after
publication. A different payload with that nonce is a conflict. Edits and controls carry the
exact origin and content revision. Settings edits are refused inside the claim queue while a
run is active. Run-once acknowledges the durable claim without waiting for a human Workflow gate.

Library pages carry summaries and bounded output previews. Full prompts, target payloads and
run output require explicit detail reads; unknown disk-only fields stay off this API. Duplicate
origins remain individually inspectable, but cannot execute or mutate through an ambiguous ID.
An uncertain outcome requires an explicit inspection acknowledgement and current target
validation before resuming. That acknowledgement records a receipt and retains the original
failed run and its audit.

Active library views can wait for scoped change versions. Durable writes and discovery on
the existing clock publish notifications; unrelated project writes do not wake a project view.
Waits are bounded and demand-owned, with no idle timer or additional filesystem watcher.
A version captured before reading a page prevents a concurrent write from being lost between
the page read and its next wait. External-file refresh retains the registry's discovery bound.

A bounded file read that races atomic replacement is a temporary busy observation. Discovery
does not publish a partial index that treats that record as missing. A scan also cannot replace
a newer owned publication with an earlier file snapshot. Serialized mutations of known records
reread their exact origin and bytes independently of a concurrent library scan. These rules
do not retry execution, relax byte-CAS, or bypass duplicate and canonical-binding checks.

Shutdown closes API admission and rejects unconfirmed responses before stopping the scheduler
and target owners. Pending provider validation cannot hold daemon shutdown indefinitely.
Late validation cannot create new work after close; a publication already in progress retains
its operation identity and must be inspected before another write.

## Internal records and the legacy transport

`@getpaseo/plugin/otto/schedules` defines Otto's internal target, origin, and run-audit
contracts. The original protocol target union and terminal status vocabulary stay unchanged.
An extended target must have a registered executor before a daemon advertises its capability.
Exporting its schema does not register an executor or make an app feature available.

Legacy Schedule responses contain only agent/new-agent records and the original fields.
They never translate a Workflow or Artifact update into an agent prompt. Legacy mutation
requests carry a guard into the store's serialized update, so a stale client cannot edit a
record after its target changes to an extended target.
Host-global native records keep their name/target upsert identity after their actual origin is
stamped. Repair records remain visible to that identity check even when execution is blocked;
an old client cannot create a duplicate by refreshing a blocked heartbeat.

The persisted format retains unknown record, origin, and audit fields. Nested legacy target/config
fields are merged back only at disk publication, never added to execution DTOs. An explicit
target-kind replacement removes the replaced target rather than transplanting its private fields.
Unsupported Otto 0.9
provider/profile policies remain dormant with their original bytes intact. They are not
silently stripped to obtain an executable record.

## Project storage

Schedules have independent host defaults and project overrides. They never inherit another
category's location. New records select the project override, then the Schedule host default.
Existing records retain their exact location and store key, even after a preference change.

- Repository records use `<canonicalProjectRoot>/.otto/schedules/`.
- Host records use `<OTTO_HOME>/project-schedules/<persisted-directory-identity>/`.
- Legacy global records remain discoverable under `<OTTO_HOME>/schedules/`.

The canonical project metadata owner persists `scheduleLocation` and `scheduleDirectoryName`.
Host directory allocation is revision-checked and rejects collisions with active or archived
projects. A retained directory identity can identify an existing Schedule directory; it never
copies Knowledge's location preference. New host identities derive from stable project IDs.

The registry caches bounded discovery for thirty seconds using the scheduler's existing
list path. Explicit refresh and owned writes update that view without another timer. Every
claim or mutation rechecks the canonical binding and rereads the source record. Duplicate
record IDs or physical-store bindings are excluded from execution, rather than resolved by
directory order. Invalid files remain in place and produce sanitized diagnostics.

Project writes reuse Otto's bounded, no-link, revision-checked filesystem publisher. Store
queues serialize cooperating mutations, while publication compares the actual file bytes.
External editors do not participate in that queue; the final compare/rename race remains a
filesystem boundary. There is no automatic retry after uncertain publication. Explicit
deletion retains the original record in the store's `.otto-recovery` directory and refuses
active runs.

### Explicit transfer receipts

The daemon's transfer API treats copying as **Copy settings**: it creates a new paused
identity with empty history and preserves the source's exact bytes, cadence and history.
A move retains the identity and run history, verifies the paused destination, and retires
the fenced source into its recovery directory. Neither operation starts a target or changes
the project's storage preference.

Transfers require an exact source origin and revision, an explicit destination and project,
and a stable operation nonce. The owning daemon retains a byte-exact source backup and
digest-bound receipt under `schedule-transfers/<operationId>/`. Pending markers block both
clock claims and manual controls. The destination stays paused after commit; a copy restores
source execution only after the committed receipt and destination have been verified.

Repeating an operation reads its receipt. It never repeats publications or retires a source
again. Interrupted operations require explicit reconciliation against inspected receipt,
source and destination digests. Completion requires the retained proof to match. Aborting is
allowed only before any destination exists and restores the exact unchanged source. Unknown
or edited bytes remain untouched. A committed receipt can still need reconciliation if final
unfencing was interrupted; historical receipts do not reject later legitimate edits.

Inspection reports bounded summaries, digests and lock kinds, never backup contents or paths.
Locks use the existing no-link publisher and recovery rules. Recovering one requires its exact
inspected revision and explicit confirmation that other owning-host writers stopped. A crash
before receipt publication permits inspection of packet locks only, without guessing a source
or destination. The detail's **Copy or move** action opens these controls with the captured
origin and revision. Inspection never repeats the transfer.

## App editor and Settings

Schedules retains its existing main-navigation destination. Upgraded hosts use a wide
inventory/detail layout or a compact single-pane selection. The host/project toolbar
identifies where new records are created. Legacy records remain discoverable;
unassigned legacy transfers require an explicitly selected project on the same host.

The editor reuses Paseo's native target controls and cadence editor. Saved AI/Graph
Workflows and project/workspace Artifacts come from their existing libraries. Workflow
execution requires an explicit workspace and model seats. Target review captures
authority fingerprints; a separate approval control accepts that review. Cadence preview
uses the daemon's existing cron/time-zone implementation and displays three next fires.
Workflow human gates still wait for the user. Failed attempts wait for the next scheduled
time, without automatic retries between fires. Uncertain outcomes pause for inspection.

Forms retain local drafts and their originating revision. A failed or unconfirmed write
does not adopt peer revisions or resend itself. Creation inspection uses the retained
operation nonce; an absent result cannot authorize replay. Explicit confirmed reload
replaces a draft with the inspected record. Hidden views release read demand while
accepted work stays owned by the daemon. Library change waits are scoped and bounded.

Host Settings supplies the independent Schedules default. Project Settings supplies its
override. The Schedules page's Storage action exposes both domains together, each with
its own revision and explicit Save. Changing preferences never moves existing records.

History pages expose requested/resolved targets, revision, executor, outcome and exact
chat/Workflow/Artifact result links. The Artifact link retains project or workspace scope
and original location; malformed or cross-host links never choose another collection.
Run once acknowledges admission rather than waiting for a Workflow gate. Cancellation
requests the exact run and retains ownership until its actual target settles.
Full target and transfer-receipt payloads are explicit expandable audit details, so ordinary
history and recovery actions remain reachable without scrolling through transport records.
History defaults to 25 runs per app page and accepts an explicit limit from 1 through 50
in the shared API. Smaller pages preserve every retained attempt while keeping large
results within the transport or tool response budget.

## CLI and MCP

`otto schedule targets operations` discovers the owned operations. Supply one dotted
operation name to inspect its input schema. Named commands take an exact JSON request
with `--input <file>`; mutation commands require `--approved`. They use the selected
daemon, check its capability and host scope, send one request, validate the reply and
close the connection. The original native `otto schedule` commands remain available.

The provider-neutral `schedule_catalog` and `schedule_operation` MCP pair uses progressive
discovery instead of injecting every schema and saved prompt into model requests. It
reuses daemon/provider tool policy and the calling chat's canonical workspace/project.
Writes require approval for the exact action; inspection uses creation or transfer
receipts without replay. Workflow-owned members cannot schedule recursively. Neither
surface owns a provider, credential store, clock, or alternate target executor.

## Retained history

The owning registry keeps at most fifty recent terminal attempts in the primary record and
archives finished prefixes sooner when the primary exceeds 768,000 bytes. Active attempts
remain in the primary. Compaction preserves all archived attempts and their original fields;
it never resets the lifetime count used by `maxRuns` or deletes older results.

Archives live under the same store's `.otto-history/<scheduleId>/`. Immutable, content-addressed
index nodes permit bounded pages without scanning every older run. Root metadata records the
archived count and latest archived identity. Pages show latest claims first, including runs
whose full results have moved out of the primary. Repair receipts retain that run identity.

Large results use immutable 256 KiB parts. The explicit run read returns an inline result when
small, or a stored-content descriptor when large; subsequent reads validate the selected run,
content revision and part number. Private unknown fields remain in the original archive but
are excluded from the public projection and its parts. A client cannot request an arbitrary
archive object by digest. Each manifest represents at most 4,096 parts.

Archive objects are published before primary byte-CAS. An external edit can therefore leave
unreachable objects, but cannot be overwritten by compaction or make those objects current
history. Missing or corrupt root objects exclude the record from discovery. No read repairs
or rewrites that data. Moves copy and verify every object referenced by the captured history
root before retiring the source. Copy settings creates empty history instead.

The filesystem publisher's record-size bound still applies to a non-archivable oversized
record. Its original bytes remain available for explicit owning-host inspection. The original
Paseo transport retains its native target schema and recent-history contract; the owned API
provides complete archive paging and large-result reads.

## Claims, effects, and cancellation

A durable running claim also fences later automatic and manual attempts if publishing its
settlement fails. Releasing an in-memory reservation does not prove that effects did not occur.
Restart recovery retains that attempt and pauses it for inspection; it never infers success or
replays the work to reconstruct an outcome.

A claim captures the requested target before resolution. The target adapter stamps its
resolved identity and exact content revision durably before starting effects. Run audit is
additive; cancellation and uncertain outcomes use audit dispositions while the old run
status enum remains parseable.

The Otto runtime bounds target admission to five reservations. Native schedules
retain Paseo's provisioning, provider, and workspace cleanup owners. Existing-chat execution
uses the manager's atomic idle admission, so it cannot steer or replace a manual turn that
wins a race. Native preflight uses the current canonical project/workspace binding and provider
catalog; unavailable providers wait for the next cadence and invalid bindings pause for repair.

Cancellation can end the scheduler's wait before the target owner's underlying promise settles.
Unfinished native and extended work retains capacity and a per-Schedule fence during that gap.
Editing, resuming, deleting or transferring that Schedule is refused until its owner settles.
An absent or failed cancellation confirmation is an unknown outcome that pauses for inspection;
it is not a confirmed cancellation. Late cleanup errors reach the owning daemon's error handler.

Native cancellation carries a private receipt bound to the actual provider session and turn.
The receipt is never serialized. A pending Schedule start or conditional interrupt retains a
per-chat fence until the actual provider promise settles, including after a timeout or an old
turn's completion. Other chats remain available. A non-cooperative native operation retains
one of five bounded reservations after cancellation; revocation prevents late provisioning
from starting a new turn. An uncertain result pauses for inspection rather than permitting
unbounded replacement work. The first audited legacy claim records its actual host-global
origin without assigning a project or moving the record.

Cancellation addresses the exact Schedule/run pair owned by
the current process. Revoked signals prevent late Artifact publication. Shutdown revokes
owned waits without depending on a provider returning promptly; interrupted extended work
requires inspection rather than automatic replay.

Workflow preparation uses the existing exact-revision review/start boundary. Its authority
fingerprint is separate from content identity: prompt, title, and canvas-position edits can
refresh at a later fire, while topology, access, seats, limits, unknown authority fields,
and approved executable-template revisions require another review. Saved AI approval intent
is preserved. A per-active-run settlement owner waits through AI Planning and human gates
until cleanup completes, with abortable demand and no polling.
Human approval gates retain their normal Workflow approval controls; scheduling does not
approve them automatically or require an automatic-only Workflow. Saved autopilot and other
execution authority remain subject to explicit target review and the authority fingerprint.

Failed attempts do not retry between scheduled fires. Proven pre-effect busy/unavailable
outcomes settle as failed and leave the existing cadence responsible for the next attempt.
Known execution failures likewise retain their audit and wait for the next fire. Uncertain
outcomes pause for inspection; missing targets and changed authority pause for explicit repair.
No error condition silently replays an admitted operation.

Artifact scheduling changes only the validated `otto-artifact-data` JSON span. Design identity
excludes that span and includes every other presentation byte. Instruction updates use an
explicit provider/model in a fresh, nonpersistent JSON-only completion session; they cannot
fall back to HTML regeneration. The Artifact owner commits against the revision captured
before generation, preserving peer edits and durable Schedule attribution.
Artifact source inspection resolves these runs from the claimed target and resolved artifact
identity, including canonical project and storage location. It does not require a chat workspace
or reinterpret an edited current Schedule target. Missing or mismatched evidence leaves the
Artifact available and marks its source unavailable.

HTML generation and data-only completion share one session lifecycle. No Otto tool catalog
is attached and every surfaced permission is denied. Native provider startup customizations
keep their existing semantics; this path does not change the separate Context isolation policy.
