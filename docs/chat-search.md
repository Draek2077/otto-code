# Global chat search

Global Search includes conversation-message matches in its existing results list. It keeps the
same input, keyboard selection, compact rows, and click-to-open behavior. There is no additional
project/type toolbar. Message rows share the other search results' padding and typography. The
provider icon aligns with the title and History's trailing Archived pill; long titles truncate
before the pill. The matching excerpt comes next, followed by muted project, author, and date details.
Selecting it opens the owning workspace and chat, then reveals the matching timeline message.

Search fans out to connected hosts and covers their non-internal persisted chats across projects,
including closed and archived chats. Each host owns its own index; conversation bodies are not
copied into a central service. Existing workspace/file/action results continue to work. The existing
Files shortcut remains workspace-scoped filename search; this feature does not add attachment OCR,
tool-output search, or cross-project file-content indexing.

## Ownership and storage

The daemon's chat-search service coordinates the registry, live normalized timelines, and
provider-native history readers. Its worker owns SQLite FTS5, source-file validation,
message-key generation, and index transactions on a worker thread. There are no embeddings,
model requests, or paid indexing services.

The store is under $OTTO_HOME/chat-search/:

- `sources/<hashed-chat-id>.json` holds normalized user/assistant text, stable message keys,
  timestamps, source sequence numbers, completeness, a content checksum, and verification metadata.
  Tools, reasoning, images, and internal prompt envelopes are not indexed.
- index.sqlite holds searchable message text, message keys, timestamps, chat IDs, source
  revisions, and the FTS token/posting structures. WAL/SHM files are transient SQLite working files.
- Provider, project, workspace, title, and archive facets come from the current authoritative registries,
  rather than stale copies embedded in the search index.

The index is derived, not a second conversation authority. Source snapshots commit atomically
before the SQL transaction. Provider history remains the recovery authority where an offline reader
exists; the retained normalized source also preserves messages captured live by Otto.

Stable keys use role, text, and duplicate occurrence. Adjacent chunks of one assistant message
coalesce. Inserts, edits, and rewinds update only changed message keys in FTS. A source snapshot
is still a whole-chat JSON replacement, not an append-only journal. Storage therefore includes
both normalized text and indexed text, plus metadata and token overhead; it is not a fixed number
of bytes per chat.

## Freshness and recovery

- Live user/assistant updates coalesce for one second. Import, hydration, rewind, and close capture
  the resulting normalized timeline. Queries flush pending live changes before reading.
- Startup and a 30-second background reconciliation enumerate eligible chats, repair missing
  sources from live/provider history, refresh registry facets, and remove orphaned source/index rows.
  A failed registry read never authorizes deletion.
- Native file fingerprints and persisted-handle revisions detect changes cheaply. Unchanged
  complete histories avoid repeated reads. A full history audit becomes due after 15 minutes,
  including providers without a cheap revision API. Background reads are sequential.
- Failed histories retry after 60 seconds. Each background read has a 60-second cancellation
  deadline; shutdown cancels the active read. A query never waits for provider backfill.
- Generations, deletion tombstones, revision checks before and after a read, and a registry recheck
  prevent old background work from replacing newer live content or resurrecting deleted chats.
- SQLite integrity checks run when opening the worker database. Recognized corruption discards
  only the derived database and rebuilds from validated sources. Runtime corruption retries once
  after rebuilding. An exited worker is recreated on the next operation.
- Missing, corrupt, or identity/checksum-mismatched sources remove their stale indexed messages.
  Reconciliation then attempts recovery. Deleting a chat removes its source and indexed text;
  archiving retains it. SQLite and FTS secure-delete are enabled, but this is not a guarantee of
  physical erasure from filesystem backups or SSD media.

Recovery is eventual, not a promise that deleted or inaccessible provider history can be recreated.
Query responses report indexed, pending, and unavailable coverage. Global Search displays a short
status only when coverage is incomplete, a host needs updating, or results are capped. An open
query refreshes every five seconds. It never presents an unavailable corpus as a completed empty
search.

## Provider and navigation boundaries

Offline readers reuse provider history mapping for Claude, Codex, OpenAI-compatible/Brain,
OpenCode, Pi, and OMP. Codex uses a read-only thread/read helper, separate from active writer
sessions, reused within a batch and disposed after ten idle seconds. Pi reads its active native
branch without launching a provider. Unsupported offline readers retain live-captured messages
but report unavailable coverage for histories Otto cannot obtain. Adding a provider requires
the same read-only contract; search must not send prompts or start turns.

The dotted RPCs are search.chats.query and search.chats.resolve, with request/response
suffixes and workspace.read authorization. The optional
server_info.features.chatContentSearch capability is checked once at the UI boundary.
No legacy RPC fan-out simulates the feature on older hosts.

A click resolves the stable key against the current canonical timeline to obtain an epoch/sequence
cursor. Archived matches first use History's restore operation, then resolve against the restored
timeline; an epoch captured before restoration would already be stale. Only the visible, ready chat
pane consumes that navigation intent. The existing timeline
window loader fetches an offscreen target once; the viewport then reveals and scrolls to it.
If the source changed, the UI reports that the match is no longer available rather than jumping
to an unrelated row.

## Verification

Targeted worker/service tests exercise initial backfill, restart after database corruption, provider
edits, source loss/corruption, stale-write races, deletion, scope moves, unavailable history, failed
registry reads, and shutdown cancellation. Pi fixtures verify active-branch selection and malformed
history handling. Chat navigation tests cover retained hidden panes, offscreen window loading, and
stale cursors. The existing command-center-workspaces.spec.ts browser fixture verifies a real
cross-project message search and click-through without adding new search controls.
