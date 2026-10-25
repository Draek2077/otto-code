# Kanban host library

Kanban's injected project/GitHub read library and typed plugin RPC contracts live
under `packages/plugin/src/otto/kanban/`. The client-safe contract export is
`@getpaseo/plugin/otto/kanban`; daemon composition uses the separate node-only
`@getpaseo/plugin/server/otto-kanban` export. `plugins/otto-kanban/` holds the
client contribution and reexports those canonical contracts. The `otto-kanban`
built-in registers a top-level sidebar entry and a project-settings contribution;
it has no credential store. Constructing a service or contribution does not
start a process, contact GitHub or subscribe to anything. Registration does not
complete the feature: complete provider/product acceptance remains open.

## Ownership and integration boundary

Every operation carries an explicit `hostId` and `projectId`. Both the project
service and GitHub reader reject the wrong host. Board identifiers remain in the
owning host's existing project record under `kanban`, using the preserved
`adapter`, `boardId` and optional `boardOwner` fields. They do not belong in
plugin-global settings or client storage.

`KanbanDaemonService` composes the canonical library with the selected daemon's
project registry and GitHub service. It resolves project IDs on the owning host.
Target preparation uses the opened revision; `OttoProjectMetadata` performs the
final comparison and atomic write inside the ordinary registry mutation queue.
Comparing revisions only before acquiring the queue is insufficient. The helper preserves unrelated record fields and unknown
target fields; it refuses corrupt or unsupported settings. Explicitly clearing a
target sets only `kanban` to null. No store migration is performed.

`GitHubReadPort` uses the daemon's existing GitHub CLI account and host policy.
Only the canonical Projects read and editing-metadata documents are allowed. String variables
use `gh api -f`; integer/null variables use `-F`, following the
[GitHub CLI API contract](https://cli.github.com/manual/gh_api). The existing runner
supplies host routing, timeout and output-size bounds. Typed GraphQL failures
are classified by the canonical reader; raw CLI error text never reaches the UI.
The library never resolves
tokens or runs `gh auth login`, `refresh` or `switch`.

The client factory uses public project listing and the installation's bound host.
The existing plugin surface owns host selection; Kanban creates no parallel host
inventory. An explicit project or workspace hint is used only with a matching host
identity. Missing context never selects the first project automatically.

The daemon's internal `OttoProjectMetadata` adapter supplies revisioned preserved
records under the ordinary registry mutation queue. The app supplies active/last
workspace context only after resolving the workspace on the selected host; it
never selects an arbitrary project. A workspace command uses its bound workspace.
Board configuration opens canonical Project Settings through app-owned navigation.
The settings section renders under the same plugin installation and host client.
An installation-owned registry retains only local dirty or pending edit drafts
across route departure and host/project selection. It releases closed clean forms
and disposes all drafts with the plugin installation. It is not a host-data cache.
Drafts retain their originating revision; a conflict or uncertain save outcome
blocks another save until an explicit reload. Confirmed reload preserves edits
when its host read fails. Accepted own saves advance only that draft's revision.
External-resource plugins must not import private daemon services to bypass them.

## Read behavior

A configured GitHub number resolves against its explicit owner. Old number-only
settings use the project's GitHub remote owner. Node IDs remain opaque. An explicit
board never falls back to another accessible board when it fails. Organization
boards can serve multiple Otto projects.

A configured GitHub target without an ID discovers boards linked to that project's
repository. A single result is usable; multiple results require an explicit target
in Project Settings. An absent project target returns an unconfigured state without
calling the provider. Jira pointers use the selected daemon's shared Atlassian
account, configured under host Plugins settings. An absent account or Jira site
produces an actionable error; no project credential store is introduced.

The normalized board preserves item IDs, issue/PR/draft kinds, titles, descriptions,
URLs, assignees and archive state. Columns come from one single-select Status field,
or State when Status is absent. Priority never defines columns. Unset status uses
Unassigned; inaccessible content retains its board item with an unavailable label.
The legacy board-read response remains read-only. The editing response adds
operation-specific project/content permissions and per-card field/transition metadata.

The client source includes board, empty/error/refresh and compact column views.
Its target form captures the opened project revision, prevents duplicate saves and
retains failed drafts. Read requests invalidate late replies on scope change.
RPC contracts accept host/project identities and identifiers, never filesystem
paths or credentials. Raw project records remain on the daemon.

## Explicit GitHub actions

The editing host supports draft creation, linking an existing same-host issue or
pull request, status movement, supported field edits and board-item removal.
Removing an item does not delete a linked issue or pull request. Content title,
description, assignees and labels use the underlying content mutation. Project
text, number, date, single/multi-select and iteration fields use their own field
routes. Unknown field kinds remain read-only. Synthetic Unassigned is not a move
target. An unplaced create/link leaves the new item unassigned.

The host reads current project settings, board identity/revision, card membership,
card revision and applicable permissions before a write. Settings are rechecked
immediately before provider effects. These checks cannot make GitHub transactional
or prevent an external writer after the check. Metadata refuses partial/repeated
pages and bounds fields, assignees/labels and repository choices explicitly.

Each explicit intent carries an operation ID. The daemon exclusively admits its
fingerprint on disk before provider effects. A repeated applied operation rereads
truth without writing again; a changed intent cannot reuse its ID. An admitted,
uncertain or corrupt record blocks blind repetition, including after a daemon
restart. Admission stores hashes and safe outcomes, not card bodies or credentials.
Failed response/reconciliation or a partially placed create/link is an uncertain
outcome. It requires checking provider truth before another explicit action; Otto
does not automatically retry or delete a newly created item to simulate rollback.

The app renders a plain TypeScript action form behind current shared controls.
It keeps the originating revisions and local drafts across route/host changes,
serializes submission and blocks repeats after uncertainty or conflicts. Card
detail selection performs a fresh permission/field read. Compact column selection
survives refresh and provider errors when the column remains valid. No optimistic
canonical board cache or second tracker transport is introduced.

## Jira reads and issue edits

Jira uses real board configuration/status mappings and the current enhanced
Software issue endpoint with token pagination. Quick filters do not define
columns. Incomplete/repeated pages and configuration changes are refused.
Editing metadata comes from the issue's actual edit screen; native workflow
transitions determine allowed moves. Ambiguous transitions or required transition
screen fields are not guessed. Denied edit/transition permissions preserve the
readable issue and remove the corresponding actions.

Field writes contain only the selected known field. Description writes use ADF
only after an explicit description edit; other edits do not flatten rich content.
People use account IDs, options use native IDs, and required fields cannot be
cleared. Unrecognized types remain read-only. Jira does not provide a generic
detach-from-filtered-board operation, so Otto does not substitute issue deletion.
Jira's Link backlog issue action accepts an exact issue key or a browse URL on
the configured site. It first verifies that exact issue through the current
enhanced backlog endpoint, then uses the official Move issues to board operation.
It never changes a saved filter, attaches an arbitrary foreign issue, or deletes
an issue. Existing board cards are refused as duplicate links. An optional column
uses the issue's current unambiguous native transition after membership is read
back; incomplete placement requires reconciliation rather than rollback or retry.
Project settings and the shared account revision are rechecked before each write.
Jira's own default column is described as such instead of promising Unassigned.
The owning-host request fixtures prove these contracts; real-provider and app
acceptance of Jira linking remain open.

Create card reads the board's associated projects, then the selected project's
non-subtask issue types and that exact type's current create-screen fields. The
user chooses both identities explicitly. Reads are paginated and bounded; denied,
changing, repeated or incomplete metadata leaves creation unavailable. The form
captures a digest of the complete metadata. The daemon rereads it before creation
and rejects a changed digest, settings or shared account without creating an issue.
Titles and descriptions use Jira's known summary and ADF description fields.
Unknown required fields without a host default disable this form with a concrete
explanation; Otto does not invent values or create an incomplete issue. Defaults
remain provider-owned and are omitted from the request. Subtask creation and
arbitrary Jira create-screen custom fields are not supported by this form.

An accepted creation is read back on the board. When Jira initially places the
new issue in that board's backlog, the same verified Link backlog issue operation
moves it onto the board. A missing membership or incomplete placement reports the
returned issue key and requires reconciliation. No issue is deleted, recreated or
blindly retried. The form retains local project/type choices and the originating
metadata revision across errors; hiding an unfinished lookup invalidates its late
reply. Focused request/form fixtures cover these behaviors. Real Jira account,
browser/device and final exact-source acceptance remain separate proof gates.
Account/site revision is part of board identity and
is checked again before effects. Jira shares the same durable write admission
and reconciliation path as GitHub.

Field and item connections paginate independently. Reads refuse partial data,
repeated cursors, mismatched IDs and detected board revisions changing mid-read.
Limits are 500 fields, 2,000 items and 100 assignees per item. The revision is a
provider change marker; multi-request reads are not transactionally consistent.

## Provider contract and proof

The documents and synthetic response fixtures follow GitHub's
[Projects GraphQL reference](https://docs.github.com/en/graphql/reference/projects)
and [API guide](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects).
Field unions use `ProjectV2FieldCommon`; single-select options are a list, and
content explicitly selects `__typename`. GitHub documents `read:project` for reads
and `project` for writes. Access to private issue/PR contents depends on the host's
repository authorization as well. The library does not infer scopes from one
fixture or implement a second authentication mechanism.

Collocated tests exercise config continuity, stale revisions, host/project scope,
normalized reads, pagination and safe failures through injected ports. They do not
validate documents against a full official schema or prove a live board journey.
Pure project-selection, target-form, retained-draft and RPC fixtures cover the
contribution boundary. They do not render the client. The app journey in
`packages/app/e2e/browser/otto-kanban.spec.ts` covers wide/compact navigation,
canonical target settings, retained drafts, revision-conflict recovery and
clearing through the real isolated daemon. Its fixture deliberately avoids
tracker requests. `otto-kanban-board.spec.ts` exercises configured paginated reads,
external open and scope-error recovery through the real daemon and isolated
local-fixture GitHub CLI adapter. `otto-kanban-actions.spec.ts` covers explicit
card actions and uncertain-response recovery through that same adapter. These
synthetic responses do not establish live-provider acceptance. Native/device
behavior and Jira require separate acceptance. Source registration
and a passing fixture alone do not establish a complete Kanban feature.
