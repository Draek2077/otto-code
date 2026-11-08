# Schedule ownership and extension contracts

Paseo's `ScheduleService` owns cadence, due-slot claiming, overlap protection, run history,
restart handling, and final settlement. Otto injects a storage port and target runtime into
that owner. There is no second scheduler or per-project clock.

The optional ports and all target-specific policy live in
`packages/server/src/server/otto/schedules/`. Edits in Paseo's scheduler, store, native tools,
and session boundary carry `OTTO(schedules)` markers. Workflow and Artifact operations use
their existing daemon owners; they do not construct providers or reuse ordinary user chats.

## Internal records and the legacy transport

`@getpaseo/plugin/otto/schedules` defines Otto's internal target, origin, and run-audit
contracts. The original protocol target union and terminal status vocabulary stay unchanged.
An extended target must have a registered executor before a daemon advertises its capability.
Exporting its schema does not register an executor or make an app feature available.

Legacy Schedule responses contain only agent/new-agent records and the original fields.
They never translate a Workflow or Artifact update into an agent prompt. Legacy mutation
requests carry a guard into the store's serialized update, so a stale client cannot edit a
record after its target changes to an extended target.

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

## Claims, effects, and cancellation

A claim captures the requested target before resolution. The target adapter stamps its
resolved identity and exact content revision durably before starting effects. Run audit is
additive; cancellation and uncertain outcomes use audit dispositions while the old run
status enum remains parseable.

The Otto runtime bounds extended target admission to five reservations. Native schedules
retain Paseo's execution path. Cancellation addresses the exact Schedule/run pair owned by
the current process. Revoked signals prevent late Artifact publication. Shutdown revokes
owned waits without depending on a provider returning promptly; interrupted extended work
requires inspection rather than automatic replay.

Workflow preparation uses the existing exact-revision review/start boundary. Its authority
fingerprint is separate from content identity: prompt, title, and canvas-position edits can
refresh at a later fire, while topology, access, seats, limits, unknown authority fields,
and approved executable-template revisions require another review. Saved AI approval intent
is preserved. A per-active-run settlement owner waits through AI Planning and human gates
until cleanup completes, with abortable demand and no polling.

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
