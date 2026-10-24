# Kanban host library

Kanban's restoration source lives under `plugins/otto-kanban/`. It contains an
injected project/GitHub read library, typed plugin RPC contracts and unregistered
client/server contribution factories. It has no plugin entry, manifest, built-in
registration or credential store. Constructing a service or contribution does not
start a process, contact GitHub or subscribe to anything. These surfaces are not
reachable in the app yet.

## Ownership and integration boundary

Every operation carries an explicit `hostId` and `projectId`. Both the project
service and GitHub reader reject the wrong host. Board identifiers remain in the
owning host's existing project record under `kanban`, using the preserved
`adapter`, `boardId` and optional `boardOwner` fields. They do not belong in
plugin-global settings or client storage.

`ProjectBoardPort` must resolve project IDs on the owning host and authorize each
operation. Its `setTarget` implementation must acquire the existing project-record
lock, read the latest record, compare `expectedRevision`, call
`prepareTargetUpdate`, and persist atomically. Comparing revisions before acquiring
the lock is insufficient. The helper preserves unrelated record fields and unknown
target fields; it refuses corrupt or unsupported settings. Explicitly clearing a
target sets only `kanban` to null. No store migration is performed.

`GitHubReadPort` must reuse the daemon's GitHub CLI account and host policy. It
receives a read-only document, variables and project binding, and returns the
GraphQL envelope or a safe typed error. It must never return credentials or echo
raw command output. Transport deadlines, cancellation, response-size limits and
auth/scope classification belong to that bridge. The library never resolves
tokens or runs `gh auth login`, `refresh` or `switch`.

The client factory uses public project listing and the installation's bound host.
The existing plugin surface owns host selection; Kanban creates no parallel host
inventory. An explicit project or workspace hint is used only with a matching host
identity. Missing context never selects the first project automatically.

Project metadata CAS, a reusable forge query/auth bridge, active/last navigation
context, canonical Project Settings navigation and an outer before-leave guard
remain integration boundaries. The source includes an unregistered board/settings
editor, but its local project-picker lock does not cover outer host switches or
closing the surface. It must not be registered before those boundaries are resolved.
External-resource plugins must not import private daemon services to bypass them.

## Read behavior

A configured GitHub number resolves against its explicit owner. Old number-only
settings use the project's GitHub remote owner. Node IDs remain opaque. An explicit
board never falls back to another accessible board when it fails. Organization
boards can serve multiple Otto projects.

A configured GitHub target without an ID discovers boards linked to that project's
repository. A single result is usable; multiple results require an explicit target
in Project Settings. An absent project target returns an unconfigured state without
calling the provider. Jira pointers survive configuration reads and updates, but
Jira board reads return `unsupported` in this slice.

The normalized board preserves item IDs, issue/PR/draft kinds, titles, descriptions,
URLs, assignees and archive state. Columns come from one single-select Status field,
or State when Status is absent. Priority never defines columns. Unset status uses
Unassigned; inaccessible content retains its board item with an unavailable label.
All mutation capabilities remain false.

The client source includes board, empty/error/refresh and compact column views.
Its target form captures the opened project revision, prevents duplicate saves and
retains failed drafts. Read requests invalidate late replies on scope change.
RPC contracts accept host/project identities and identifiers, never filesystem
paths or credentials. Raw project records remain on the daemon.

`server/mutation-port.proposed.ts` is a type-only review proposal for future writes,
including revision preflights and uncertain-outcome reconciliation. It implements
no provider mutation and enables no RPC or capability.

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
Pure project-selection, target-form and RPC fixtures cover the unregistered
contribution boundary. They do not render the client. Desktop/Mobile interaction,
native/device behavior, daemon bridge acceptance, Jira and mutations remain outside
this source's proof.
