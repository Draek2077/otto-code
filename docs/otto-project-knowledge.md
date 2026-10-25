# Otto Project Knowledge

Project Knowledge uses one daemon-owned Markdown service in
`packages/server/src/server/otto/project-knowledge/`. The bundled
`otto-project-knowledge` plugin registers a workspace panel, a browsing screen,
host settings and an Open Project Knowledge command. Workspace right-click and
action menus open the panel for the clicked workspace, even when another
workspace is active. App-owned forms and Markdown rendering remain in
`packages/app/src/otto/knowledge/` behind a narrow typed presentation bridge.
The single app boundary checks `server_info.features.ottoKnowledge` before loading
operational surfaces. An older host receives an update-host message; it does not
fan out across older operations to simulate this feature.

## Ownership and resolution

The daemon resolves a workspace through the canonical registry to its project ID
and shared project root. Worktree directories never select separate Knowledge
stores. Resolution uses the project's override, an existing repository store,
then the retained host default. An unreadable or partially initialized repository
store is an error, never a reason to redirect to an empty host store.

Repository stores retain `<project>/.otto/knowledge/`. Host stores retain
`<OTTO_HOME>/project-knowledge/<persisted-directory>/knowledge/`. The optional
`KNOWLEDGE.md` remains beside `knowledge/`. The connected client's filesystem and
current directory are not inputs. Existing directory identities are preserved;
a host store without its persisted identity is refused rather than guessed.

Host settings expose a host-wide new-store default before project selection.
Reading it is inert. An explicit confirmed save uses its captured revision and
stores only the nonsecret preference in
`<OTTO_HOME>/project-knowledge/settings.json`; retained `otto-config.json` remains
read-only and supplies the default until that explicit replacement exists.
Unknown preference fields survive writes. Before replacing a Host default, the
same canonical project registry queue pins initialized inherited host stores,
including archived projects, to their existing directory. Repository precedence
and explicit project overrides remain unchanged. A failed publication retains
protective bindings and requires a fresh read; it never rolls back peer data,
moves stores or deletes recovery copies. External editors do not join the
daemon's queues, so the final compare/rename interval remains a filesystem limit.
Changing a default does not allocate a missing host directory identity.

When an inherited or explicit Host store has no persisted directory identity,
the Knowledge error surface exposes explicit storage setup. Inspection is read-only
and pins the project revision, host default and retained ownership markers. It
offers known `project.json` markers matching the stable project ID or canonical
root; directories already bound to another project, including archived projects,
are excluded. Other directories are retained and never selected automatically.
Matching previews are bounded to 100 entries and 24,000 bytes.

The user explicitly chooses Repository instead of the Host default, a new empty
Host store, or an offered retained store. Confirmation persists the project setting
under the canonical registry queue. New Host identities are opaque, allocated once
and saved before marker creation; changing a project name cannot rederive them.
Retained-store binding rechecks the captured marker under that queue and never
rewrites existing records, roots, policy or history. A marker-publication failure
keeps the saved identity and requires a fresh read rather than rollback or another
automatic allocation. Root initialization remains a separate explicit action.

## Records and roots

Catalog reads return metadata and full-file digests, with confirmed records only
unless inactive records are explicitly requested. Full statements, timelines and
the six fixed roots are separate reads. Every read consults the filesystem;
active consumers receive invalidation from the demand-owned observation feed.

Explicit operations support Draft, Confirmed and History review, charter delivery
and structured progress, reference disposition/source, title/tags, reason-bearing
truth edits and evidence appends. Review requires an explicit human action.
Delivery and review are separate metadata domains. Original unknown YAML and
history survive every operation. Changed confirmed truth returns to Draft.
Percentage is derived from completed/total. Noncanonical formats and malformed
pages raise errors and retain their original files.

Initialize roots creates only missing Background, Architecture, Flow, Mindmap,
Stack and Roadmap pages. Draft content cites inspected README/manifest/docs
sources, repository structure, declared commands and confirmed charters. Existing
authored roots, including empty files, are never overwritten. Root editing uses
a separate whole-file digest and has no fabricated record review status. Explicit
initialization creates a missing `knowledge/index.md` marker with root links;
existing indexes remain unchanged. Reading a chat's catalog never initializes a store.
Every generated root discloses the three candidate source files and explicit gaps:
absent, non-regular/symbolic, outside-root or over the 256 KiB inspection limit.
Skipped input is not described as nonexistent. Empty README content, malformed or
non-object manifests, and uninspected package behavior remain explicit unknowns;
initialization does not invent purpose, commands or stack details to fill them.

## MCP and UI

All providers receive the same eleven tools through the existing Paseo tool catalog:

| Tool                                    | Contract                                                                                                                           |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `list_project_knowledge`                | Confirmed metadata and root discovery by default; explicit inactive review, title/tag search and bounded pagination                |
| `read_project_knowledge`                | One on-demand article and its complete retained history                                                                            |
| `read_project_knowledge_review_signals` | Revision-pinned, read-only counted diagnostics for one article; no related article bodies or inferred review authority             |
| `read_project_knowledge_root`           | One of the six on-demand root bodies                                                                                               |
| `read_project_knowledge_policy`         | Optional custom Knowledge guidance from the canonical owning-host store, read only on demand                                       |
| `inspect_project_knowledge_storage`     | Read-only captured setup choices for a missing Host directory identity; no implicit allocation or adoption                         |
| `configure_project_knowledge_storage`   | Human-approved, revision-pinned Repository choice, fresh Host allocation or exact offered retained-store binding                   |
| `lint_project_knowledge_links`          | Read-only bounded link health for current confirmed pages and roots, with source identities and revisions                          |
| `inspect_project_knowledge_format`      | Read-only revision-pinned preview of known older Markdown and v1 JSON conversions                                                  |
| `migrate_project_knowledge_format`      | Explicit human-approved conversion with verified byte recovery and no identity rewriting                                           |
| `manage_project_knowledge`              | Draft creation, reason-bearing changes, evidence, review, delivery, references, roots, explicit initialization and confirmed purge |

Tools resolve the chat workspace by default. Outside a chat, callers supply a
workspace ID. A restricted chat cannot redirect Knowledge to another workspace.
The owning project/root is always resolved by the daemon. Tools honor the existing
provider tool policy and are omitted from voice-only catalogs. Review operations
additionally require declared explicit user agreement. Existing secrets and raw
project configuration are not returned in Knowledge responses.

Interactive session creation, resume, import and refresh append a fresh compact
catalog to the provider's existing runtime instruction field. The daemon resolves
the stored workspace identity to the canonical project. It never infers the store
from a branch working directory, changes the user's system prompt, or persists
catalog text into the conversation configuration. The index contains confirmed
metadata and six-root discovery, capped at 200 rows and 24,000 characters, with an
explicit omitted count and search/pagination instructions. Article, root, policy
and timeline bodies are excluded. Internal metadata/voice jobs, history-only
loads, disabled tool policies and disabled Knowledge reads do not pay this cost.

An existing `index.md` identifies initialization. Older stores with only a
`KNOWLEDGE.md` entry point remain readable without a rewrite. Exact generated 0.9
policy signatures are recognized with CRLF normalization; custom additions remain
custom guidance. Only a pointer to the policy tool is appended automatically.
Store failures produce a fixed unavailable notice, without private exception text
or fallback to another directory. No files are created or migrated during reads.

The workspace UI uses the same RPC/service operations, the current Markdown
renderer and Paseo form/settings primitives. Search has an explicit clear action.
Article bodies are fetched on demand rather than included in catalog responses.
Link health uses the same service and MCP operation. It inspects confirmed current
truth and the six roots against confirmed page identities, including aliases and
heading links; Draft and History targets are inactive. Repeated references from
one source are reported once. Historical timeline references are excluded. Results
are paginated, and Open source reads the latest page or root before an explicit
revision-pinned edit. Checking never repairs, confirms, initializes or deletes data.
Editing captures the opened revision; peer conflicts retain the draft and block
another save. Cancel/discard is explicit. Hide/unmount invalidates pending review
confirmations and late write acknowledgments, without claiming host cancellation.

Each article retains its collapsed **Review signals** section. Opening it reads
counted bullets for identical complete tag sets, partial tag overlap, overlapping
current truth and stale review. Only confirmed atomic records participate in
overlap; broad project/reference records receive only the stale-date check.
Tag sets are unique trimmed tags; truth overlap requires three distinct shared
words of at least five ASCII characters, ignoring case and timeline history.
These are inspection hints, not conclusions. Staleness means the record's last
changed timestamp is more than 180 days old; it does not infer a human review date.
The operation pins the source digest, caps inspection at 2,000 peers, 512 KiB per
statement and 16 MiB of peer statements, and fails explicitly beyond those bounds.
No counts, peer lists or findings are persisted, and no review status changes.
The section fetches only while expanded on an active surface, refreshes after
external changes and exposes the same sanitized count result through MCP.

Permanently delete requires a reason and a destructive human confirmation. It
removes the canonical page and its full history, repairs incoming wiki-links in
other current articles, roots and an existing index, and preserves prior peer
timeline entries. The MCP operation also requires declared human deletion
approval. Purge validates every input before writing, pins each repaired file's
digest and deletes the selected page last after another revision check. A partial
repair failure retains the selected file when deletion has not happened and
requires explicit reconciliation; it does not roll repairs back over newer
external edits. Recovery copies from earlier explicit storage switches or format
conversions are outside the canonical pages and remain untouched. This is not a
multi-file transaction.

Active views share one change feed per canonical host/project. The daemon uses
Paseo's file-observer service, prunes unrelated subtrees and debounces filesystem
bursts. It observes the nearest existing store ancestor so an external first
store creation is visible, then narrows observation to the store. Confirmed own
writes notify after completion; external edits invalidate catalogs and open
articles without replacing local drafts. A deleted article clears its selection.
Storage switches rebind observation to the new canonical store. Hidden views
release demand, paired-session disconnects release their leases, and daemon
shutdown awaits observation teardown. Heartbeats do not poll the filesystem or
invalidate unchanged data. Observation failures show a disconnected notice and
use bounded reconnection; manual Refresh remains available.

## Explicit storage changes

Project Knowledge settings offer Repository or Host storage. A confirmed change
locks both stores in deterministic order, inventories the payload, copies bytes,
verifies source and destination, then publishes the project override under the
shared project-registry revision queue. The source is retained as recovery data.
Conflicting or unrelated destination files prevent publication. Policy files,
unknown payload files and binary bytes are preserved; symlinks and special files
are refused. There are bounded file/byte limits, not silent truncation.

A new host directory identity is persisted once before copying, so interrupted
copies can be reconciled against the same directory. Failure after copying can
leave a valid recovery copy without changing the active location. Retry requires
reloading Project Settings. The copy operation only accepts byte-identical files
already present at the destination; it never replaces conflicting destination
data or deletes original stores. This is copy-and-switch with recovery, not a
filesystem/registry transaction across independent processes.

Queued record/root writers re-resolve the canonical store after acquiring its
lock. A storage switch invalidates a queued old-store write instead of allowing
it to change the retained recovery copy after publication.

## Older formats

Older Knowledge formats offers an explicit inspection and confirmed conversion
in workspace and host-settings views, including when an older page prevents the
normal catalog from loading. Inspection reads the selected canonical host store,
its project-registry revision and repository `.otto/project-knowledge.json`. It
never creates a directory or changes files. Previews contain at most 100 record
summaries plus the complete count; the revision covers the complete inventory.

Conversion supports the frozen v1 JSON record envelope and the older Markdown
Current truth / Evidence / bullet Timeline sections. IDs, review status, source
timestamps, unknown fields, evidence and custom timeline events survive. Fenced
examples cannot become provenance. Ambiguous sections, malformed records,
duplicate identities and unrelated destinations stop the operation before page
writes. No automatic slug renaming or status confirmation occurs.

Before replacing older Markdown, Otto copies and verifies its original bytes in
`knowledge-recovery/<preview-revision>/` beside `knowledge/`. JSON stays in place
and also receives a verified recovery copy. Authored roots and existing indexes
remain unchanged. A missing index is created explicitly so converted pages enter
the compact chat-start catalog; interrupted finalization remains inspectable.
The conversion appends a reason-bearing migration event and relative recovery location. A
completion receipt prevents repeated JSON imports; older Otto completion markers
remain recognized. Interrupted imports recognize their original source revision
and preserve subsequent peer edits rather than resurrecting old JSON truth.

Application requires the exact preview revision and a reason. UI confirmation is
explicit; MCP additionally requires `userApprovedMigration`. A shared store lock,
project/store revalidation, source digests and exclusive destination creation
protect cooperating writers. A partial failure retains recovery data and requires
a new explicit preview, without automatic retry or rollback over newer changes.
The form retains its reason on conflict or unknown outcomes and invalidates late
confirmation/write responses across hide/unmount. External editors still do not
participate in the final filesystem comparison interval; this is not a multi-file
transaction. Limits are 10,000 files, 4 MiB per source and 64 MiB total, with explicit
failure rather than truncation.

## Filesystem and recovery limits

Edits require the digest from the last read. A per-store queue and an exclusive
`.write-lock` directory coordinate cooperating Otto writers. Writes stage a
sibling file, flush it, check the expected digest again, then replace the page.
Creation uses an exclusive hard link so an existing destination cannot be replaced.
Directories below the trusted daemon boundary cannot be symbolic links.

Resource cleanup runs once. An operation failure survives successful cleanup;
simultaneous failures produce an `AggregateError` with the operation failure as
`cause` and both errors in order. A cleanup failure after a successful operation
is reported, so callers must reread before retrying a possibly committed write.

An abandoned lock remains in place and stops mutations. Inspect the writer before
manual recovery; automatic lock stealing can permit two live writers. Editors and
Git do not observe the Otto lock. Digest checks detect earlier external edits,
but a filesystem has no portable conditional rename to exclude an external edit
in the final check-to-rename interval, or conditional unlink to exclude a final
external race during confirmed purge. The implementation does not claim
cross-file transactional snapshots or power-loss durability of directory entries.

## Integration boundary

Focused fixtures cover canonical host/workspace binding, record operations,
copy/switch and local form models. Browser acceptance exercises real wide/compact
app controls against isolated daemon data; it never uses an installed Otto home.

Abandoned-lock recovery and broader historical management/review features remain
separate integration boundaries. The implementation does not claim those
remaining behaviors or full F04 completion from focused service or form tests.
