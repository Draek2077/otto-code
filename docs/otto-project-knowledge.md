# Otto Project Knowledge

Project Knowledge uses one daemon-owned Markdown service in
`packages/server/src/server/otto/project-knowledge/`. The bundled
`otto-project-knowledge` plugin registers a workspace panel, a browsing screen,
host settings and an Open Project Knowledge command. Workspace right-click and
action menus open the panel for the clicked workspace, even when another
workspace is active. App-owned forms and Markdown rendering remain in
`packages/app/src/otto/knowledge/` behind a narrow typed presentation bridge.

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
a separate whole-file digest and has no fabricated record review status.

## MCP and UI

All providers receive the same four tools through the existing Paseo tool catalog:

| Tool                          | Contract                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `list_project_knowledge`      | Confirmed metadata and root discovery by default; explicit inactive review, title/tag search and bounded pagination |
| `read_project_knowledge`      | One on-demand article and its complete retained history                                                             |
| `read_project_knowledge_root` | One of the six on-demand root bodies                                                                                |
| `manage_project_knowledge`    | Draft creation, reason-bearing changes, evidence, review, delivery, references, roots and explicit initialization   |

Tools resolve the chat workspace by default. Outside a chat, callers supply a
workspace ID. A restricted chat cannot redirect Knowledge to another workspace.
The owning project/root is always resolved by the daemon. Tools honor the existing
provider tool policy and are omitted from voice-only catalogs. Review operations
additionally require declared explicit user agreement. Existing secrets and raw
project configuration are not returned in Knowledge responses.

The workspace UI uses the same RPC/service operations, the current Markdown
renderer and Paseo form/settings primitives. Search has an explicit clear action.
Article bodies are fetched on demand rather than included in catalog responses.
Editing captures the opened revision; peer conflicts retain the draft and block
another save. Cancel/discard is explicit. Hide/unmount invalidates pending review
confirmations and late write acknowledgments, without claiming host cancellation.

Permanently delete requires a reason and a destructive human confirmation. It
removes the canonical page and its full history, repairs incoming wiki-links in
other current articles, roots and an existing index, and preserves prior peer
timeline entries. The MCP operation also requires declared human deletion
approval. Purge validates every input before writing, pins each repaired file's
digest and deletes the selected page last after another revision check. A partial
repair failure retains the selected file when deletion has not happened and
requires explicit reconciliation; it does not roll repairs back over newer
external edits. Recovery copies from earlier explicit storage switches are
separate stores and remain untouched. This is not a multi-file transaction.

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

Abandoned-lock recovery, older
noncanonical format conversion, host-wide default editing, automatic per-chat
catalog injection and broader historical management/review features remain
separate integration boundaries. The implementation does not claim those
remaining behaviors or full F04 completion from focused service or form tests.
