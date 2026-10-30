# Artifacts

Artifacts are durable, interactive HTML deliverables owned by a project on one daemon.
The bundled `otto-artifacts` plugin contributes the sidebar library, workspace panel,
Command Center action and host settings. Project Settings contains an independent
Artifacts storage override. The library follows Paseo's host filter and page gutters;
wide layouts keep the list beside the selected content, while compact layouts stack
them without a second navigation hierarchy.

## Ownership and storage

The daemon resolves a workspace through its canonical project registry. A client
supplies only a host, project or workspace identity and an artifact identity/location,
never a storage path. Repository storage is `<projectRoot>/.otto/artifacts`. Host storage
is `OTTO_HOME/project-artifacts/<persisted-directory>`. New directory identities derive
from the canonical project ID and are pinned before the first host write. Registered
worktrees therefore share their project's store rather than creating one per cwd.

The Artifacts host default and project override are independent of Knowledge,
Schedules and Workflows. An existing repository store wins over an inherited host
default. Both locations remain readable after a preference change. Compatibility
reads retain existing 0.9 directory bindings, project grouping keys and the legacy
`OTTO_HOME/artifacts` bucket. Unknown metadata is preserved. No read or settings save
moves or deletes an artifact. Explicit moves remain within the same project, refuse
an occupied destination, publish destination-first and retain the source on an
incomplete transfer. A duplicate stays visible for manual reconciliation.

Each artifact uses `<id>.json` and `<id>.html`. Metadata contains bounded run history,
source provenance, provider/model, current state, a generation log and last-good HTML.
Metadata snapshots support explicit recovery after malformed external edits. The
daemon refuses linked, oversized and nonregular artifact files. Per-artifact exclusive
locks serialize cooperating writers; revision digests reject stale actions. External
editors do not participate in that lock, so compare/publish is not a filesystem CAS
against an uncooperative concurrent editor.
Discovery reports changing or unreadable records as diagnostics without failing the
rest of the library. Direct reads and writes still enforce their file-identity and
revision checks; discovery does not retry a mutation.

## Generation and recovery

Creation returns a durable `generating` record immediately. A fresh, nonpersistent
provider session returns structured HTML; it never resumes a user's chat or receives
Otto's tool catalog. The provider supplies its normal unattended mode, and every
surfaced permission request is denied instead of waiting for approval. Native provider
startup customizations retain their normal provider semantics. This path does not
claim the stronger startup isolation being investigated separately for Context.

An explicit provider/model selection owns the attempt. Default selection follows the
host's existing structured-generation candidates. An admitted provider failure does
not silently spend on another model. Successful output records the actual selected
provider/model. Cancel, timeout and daemon close interrupt and close the owned session
and revoke late publication. At most eight generations, including unresolved canceled
requests and pending admissions, can occupy the daemon. Timeout is three minutes.
Published admissions remain owned while their startup read completes; library reads
cannot classify them as interrupted, and shutdown prevents a pending admission from
starting its provider session.

Regeneration is explicitly design-changing. Failed or canceled regeneration preserves
the previous output. Interrupted records settle to a recoverable error when their
project is next read; startup never scans or rewrites every user store. Active library
and detail queries refresh external changes at bounded intervals only while visible.
Invalid HTML disables preview and retains damaged bytes. Repair restores a valid
last-good snapshot and keeps the damaged HTML/metadata in recovery files.

Locks never expire automatically. Recovery requires a freshly inspected empty lock
and explicit verification that all writers using the store have stopped. The old lock
is renamed and retained. Recovery does not retry the failed write.

## Data, preview and export

`otto-artifact-data` is the single JSON data seam. Data updates replace only the
contents of `<script id="otto-artifact-data" type="application/json">`, escape `<`
and preserve every byte outside that span. An artifact without that seam needs
explicit regeneration to introduce one. Metadata, data and lifecycle actions use the
revision returned by inspection. Each library or workspace surface owns its editor
draft independently, so closing another view cannot release its lifecycle authority.
Local form drafts retain their origin across peer
updates and hidden panels. Unknown write outcomes require an explicit reload.

The preview uses an Otto-owned CSP with no network, frames, external fonts, external
images, objects or forms. Inline CSS, scripts and data/blob images remain available.
Web and desktop use nested sandboxed opaque-origin frames. The trusted outer
document owns the child-frame navigation policy, so an artifact cannot relax it
with its own markup. Inline interaction remains available without parent
DOM/storage access, popups, downloads or top navigation. Native uses a private WebView
with shared cookies, DOM storage and file access disabled, and rejects external
navigation. Export and Copy HTML are explicit device-side actions. Export does not
publish, synchronize or move the host's stored artifact.

## Agent tools and CLI

All providers receive the same daemon tools subject to their existing tool-group
policy: `list_artifacts`, `create_artifact`, `inspect_artifact`,
`get_artifact_data`, `update_artifact_data` and `change_artifact`. Inspection omits
HTML and data unless explicitly requested, keeping routine model context small.
A chat is bound to its own workspace;
an outside-chat caller must supply an explicit workspace ID. Tools return bounded
metadata/results and never choose a different project after failure. Source chat
identity is retained when creation originates in a chat. Workflow and Schedule source
references are structural contracts for their owning modules, not substitute trigger
implementations in Artifacts.

`otto artifact --help` lists creation, inspection, metadata/data updates, cancellation,
regeneration, repair, deletion, moves and storage preferences. Commands connect through
the selected daemon and require `--workspace`; revision-pinned writes require
`--revision`. Destructive actions require `--yes`. The CLI never opens a browser or
starts a model itself. The host capability `server_info.features.ottoArtifacts` gates
the entire feature once; an older host asks the user to update.

## Verification boundary

Focused tests cover real isolated files, stale revisions, dual-store/legacy reads,
external corruption, recovery, cancellation and local form authority. Provider-session
tests inject a deterministic client and do not claim live native-provider execution.
The app acceptance journey uses an isolated daemon, a deterministic OpenAI-compatible
HTTP endpoint and a real browser to exercise creation, safe interactivity, data-only
updates, recovery and reopening in wide and compact layouts. Device WebView and native
provider behavior require their own platform evidence; package builds alone do not
establish those runtime properties.
