# Otto History and chat search

History keeps Paseo's chronological cursor pagination and its search of titles,
workspace names, branches, and project names. The host, project, and archive
controls narrow the records before a page is chosen. The command center's
**Chat messages** section searches message content across connected hosts. **Find**
inside a chat continues to use Paseo's per-chat timeline search.

The daemon captures user and assistant messages from the same projected timeline
the app displays. It batches changes and runs tokenization, source writes, and
SQLite full-text search on one worker per host. It also reads Otto 0.9's verified
`chat-search/sources` files. The index is derived; older index and timeline files
are left in place on upgrade. Indexing does not open chats or start a provider.
When a closed chat has neither retained search text nor a locally available
source, the search reports incomplete coverage. Opening a result uses the
normal chat loader, then resolves a stable message key against the current
timeline epoch before the viewport moves.

**Clear archived** reviews archived Otto records on the selected hosts across
all projects. The host picker shows reviewable archive file sizes and only shows
an all-host total when every host provides a complete result. Confirmation names
the affected hosts and shows the count and size. Each reviewed batch is bound
to its connection and expires after two minutes. Apply checks record identity and
revision again under the existing lifecycle and storage locks. Later archives,
restored chats, and records whose files could not be verified stay in place.

The operation removes the reviewed Otto records and their derived search data.
It does not delete provider transcripts, active chats, workspace settings, or
files in a project. The UI reports acknowledged archive bytes separately from
skipped records and unknown host outcomes. It does not retry destructive work
after a missing reply.
