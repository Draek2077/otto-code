# Architectural Views

Architectural Views turn selected project Knowledge into interactive architecture,
workflow, sequence, dataflow, and lifecycle diagrams. The daemon owns source,
validation, rendering and revisions. The app owns presentation and local edits.
Normal Paseo chats own authoring, permissions, provider sessions and delivery.

## Entry points and layout

The Architectural Views navigation item opens the host/project library. The
workspace panel and Command Center action open that workspace's project. A root
or record in Knowledge has a Views action filtered to that source. No new
workspace or chat is created by browsing. Wide layouts keep the library beside
the selected document. Compact layouts show one pane at a time. Authoring uses
the normal chat beside its live draft preview, with a persisted app-local splitter;
compact authoring exposes Chat and View controls. The existing
`architectural-view-authoring-layout` version 1 preference is preserved.

New View creates an explicitly unpublished starter linked to selected Knowledge.
Choose an active workspace, provider/model and its ordinary permission mode to
start an authoring chat. Its durable binding is saved before the normal first
turn. The author reads the selected diagram contract and Knowledge, then updates
only its bound draft. It cannot publish or discard through View tools. Missing
or conflicting bindings require inspection and explicit detach, never a duplicate
chat or replacement draft. Detaching does not delete the old chat.

## Persistence and compatibility

Views use the canonical Knowledge project resolver. Repository storage is
`.otto/architectural-views/<viewId>`; host storage uses the persisted project
Knowledge directory. Both retained origins remain individually inspectable after
a default-location change. Clients use opaque host-issued origin keys, not paths.

A small manifest points to immutable SHA-256 source and receipt objects. The
cooperative Knowledge writer queue/lock and content-revision compare protect
pointer replacements. External editors do not participate in the final portable
compare/rename interval. Unknown fields and malformed files are retained; library
diagnostics identify unreadable records without inventing a replacement.

Publication requires a human confirmation, the exact saved draft revision and
an explicitly reviewed current published base. Previous manifests and sources
are retained before replacing the publication pointer. That pointer is the durable
outcome even if marking the draft later fails. An uncertain acknowledgment carries
an operation identity for inspection; it is not permission to repeat a write.
Discard and Remove retain source/history and revoke active use. They do not remove
Knowledge or the authoring chat. Removal does not change historical revisions.

Otto 0.9 manifests, pretty-JSON specification hashes and dated revision folders
remain readable in place. A legacy draft without an exact base revision requires
explicit base review before publication. No automatic migration, pruning or
source rewrite occurs while browsing. Local JSON/title edits survive peer changes,
validation errors and navigation. Conflict or uncertain/hidden writes block replay
until explicit inspection/reload. Unavailable saved drafts expose local source
recovery, including copy and local-only discard.

Linked Knowledge byte digests report current, stale or unknown source freshness.
They never imply human confirmation. Active surfaces retain scoped change leases;
pruned observation covers only their Knowledge/View store subtrees. Hidden surfaces,
disconnect, expiry and shutdown release demand. A separate bounded volatile
workspace-display lease handles show requests without mutating ordinary chat labels,
watching repositories or adding a polling loop.

## Rendering, presentation and export

The offline renderer is pinned to Archify 2.17.0-dev.1, commit
`9e35d2b0b39b155553ba9fcfe0b4f2a5198dd993`. `vendor/archify/OTTO-PATCHES.md`
records the upstream boundary and removed default brand catalogue. MIT and
Cocoon notices are distributed with every daemon. The host exposes only bounded
validation/delivery. Browser launchers, remote artwork and upstream discovery
commands are not exposed. Specifications reject brand requests before invoking
a child. Structural, input/output, concurrency, elapsed-time and memory budgets
bound the renderer. Children inherit no provider credentials. Shutdown revokes
queued writes, drains admitted filesystem work and terminates owned renderer
children, without canceling an ordinary authoring chat.

Server build materializes the runtime beside the compiled adapter. Runtime
assets are explicit inputs to the daemon trace used by Nix. Desktop, Docker,
CLI and server packages consume that same owner rather than a second renderer.
Missing assets disable the single `server_info.features.ottoArchitecturalViews`
capability. Hosts without it show an update message; there is no legacy-RPC fanout.

The same isolated viewer serves published Views, history and draft previews.
Web/Desktop use a nested opaque sandbox with a parent-owned CSP; native uses a
private WebView. Network, app DOM/storage, navigation, credentials and popup
access remain outside the guest. An ephemeral channel and exact frame identity
scope typed toolbar messages. Theme/syntax colors and current UI/mono font stacks
are projected without changing shared themes. Theme updates retain the active
camera; hidden guests release transport and animation clocks.

Otto owns the 36px toolbar and 24px status bar. Find, semantic lens, route, map,
guide, zoom, fit and applicable motion controls use Archify's public API. Web/Desktop
export PNG, JPEG, WebP, SVG and, where motion exists, WebM. Export messages have
MIME/size/name limits and download through the host. Native supports reading and
interactive controls; browser capture/export is a web/Desktop action.

## Tools and CLI

The provider-neutral tool catalog exposes `list_architectural_views`,
`read_architectural_view`, `read_architectural_view_contract`,
`read_architectural_view_draft`, `update_architectural_view_draft` and
`show_architectural_view`. They honor the existing Knowledge tool-group/provider
policy. Lists return metadata, never rendered HTML. Source/contracts are pulled
only when needed. Model replies stay below 14,000 characters, including native
harnesses with 16,000-character truncation limits. Source reads return revision-pinned
text parts; the next offset must retain the originating revision. Diagram and common
contracts are separate on-demand reads. Metadata pages carry their exact continuation
offset. This avoids truncated JSON and repeated large source/contract injection.
The native model input schema keeps the specification as a shallow object; explicit
budgeted JSON validation runs before recursive validation and real kind-specific rendering. Draft writes are bound to the actual caller agent and canonical
workspace, with exact revision checks.

`otto architectural-view` (alias `otto view`) supplies `ls`, `inspect`, `contract`,
`sources`, `draft`, `update`, `publish`, `discard`, `review-base`, `remove`,
`revisions`, `author`, `detach`, `show`, `operation` and `export`. Select the daemon
normally, then exactly one `--project` or `--workspace`. Mutations carry the origin
from `ls`, exact revision and caller operation identity. Human lifecycle commands
require `--yes`. `export` transfers bounded self-contained HTML to a new local
file; it never overwrites a destination or interprets client paths on the host.
Use the command's help for required arguments. No command silently retries a write.
