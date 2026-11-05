# Workflows

Workflows adds durable orchestration above Paseo's existing agent manager. Paseo
owns every chat, provider session, transcript, permission request and turn. Otto
owns definitions, plans, run state, admission limits, gates and result references.
There is no second chat runtime or replacement message queue.

## Entry points and authoring

The bundled `otto-workflows` plugin contributes Workflows to the main navigation,
workspace panels, Command Center and host settings. The selected host advertises
`server_info.features.ottoWorkflows`; an older host shows an update requirement.
The same dotted RPC service backs the app, `otto workflow` and MCP operations.

The library is explicitly host/project-bound. It lists AI and Graph definitions,
prompt templates and run history across repository and host origins. Wide layouts
keep the library beside the selected content; compact layouts use a scoped detail
view. Local drafts survive navigation within their surface and are exposed through
Drafts. Each surface retains at most sixteen drafts and requires explicit discard
instead of silently evicting dirty work.

- **AI Workflow:** a task plus explicit conductor, worker and judge seats. Starting
  saves Planning before the conductor's first turn. Clarifying replies remain in
  Planning. The conductor calls `start_workflow` once with a bounded phase plan,
  then ends its turn. Workers wait for that turn to settle and for explicit plan
  confirmation. Autopilot explicitly skips initial confirmation and approves AI
  plan gates. The execution deadline excludes Planning and confirmation time.
- **Graph Workflow:** a saved directed graph with one conductor root and agent,
  gate and deterministic check nodes. The web/desktop designer preserves the
  original Drawflow canvas, ports, wires and node controls. Native clients have a
  node/wire overview and accessible node, edge and input forms. Node forms also
  expose placement and advanced output, retry, loop, query and template contracts.
  Run visualization shows actual declared nodes or phases, not inferred chat state.

Starter Graphs and prompt templates are inert gallery entries. Copying creates a
draft; browsing never seeds files or launches a model. Profiles and Teams are not
implicit seat resolvers: the launch captures provider, model, native permissions
and thinking choices from the selected host's normal provider catalog.

## Execution and session authority

Review binds exact definition bytes/revision, host/project/workspace, seats,
inputs, limits, captured templates and operation identity for five minutes.
Starting consumes that review. A saved definition edited after review cannot
redeem the old token. A repeated operation returns its retained run instead of
creating duplicate chats. There are at most sixteen pending reviews and two
admitted/admitting Workflows per daemon.

Each AI plan supports at most sixty-four phases, including gates. Each run supports up to forty agents, six concurrent Workflow turns, five quality
loop attempts and a 240-minute execution deadline. The daemon also caps Workflow
turns globally at six. A per-workspace writer lane serializes Workflow write
turns, without placing ordinary chats in that lane. Shared-checkout write fanout,
replacement and retry are refused. Read fanout and continued fix-forward loops
remain available. Managed descendants are read-only or no-workspace, bounded to
three levels, and share their parent's seats and run limits.

Only durable, daemon-private owner reservations authorize member turns. Labels
identify Workflow context in the app but do not grant runtime authority. A final
launch fence rejects plugin customization that changes the captured provider,
model or workspace. Ordinary chats return their original configuration and
composer subtree. Worker/judge chats cannot accept independent messages; an
admitted conductor is controlled through Workflow decisions. A Planning conductor
continues to use the ordinary composer.

Worker and judge permission requests are denied rather than left waiting for an
interactive response. Explicitly selected native permission modes retain their
provider semantics; Otto never silently upgrades them to bypass permissions.
The conductor remains attended. Workflow gates express human decisions.

Provider write execution uses the normal Paseo adapters. Read ceilings have
explicit adapters for Claude, Codex, OpenCode and Otto's OpenAI-compatible/Brain
harness. No-workspace ceilings are available for Claude and Otto's harness.
Unsupported access combinations fail preflight before creating sessions.
External MCP `readOnlyHint` is not trusted authorization. Native subagent tools
are withheld in favor of bounded Workflow delegation. These are tool ceilings,
**not startup-hook isolation**; the separate Context isolation investigation is
not implemented by this feature.

Cancellation revokes new turn/tool authority immediately, cancels only recorded
members, drains active siblings and cleanup, then publishes the terminal run.
Rejected gates and user cancellation are `canceled`, never `failed`. Completed
filesystem or external effects are not reverted. A publication failure retains
the owner journal and admission until explicit reconciliation; it does not turn a
failed save into a successful run.

## Data and rendering boundaries

Run manifests retain compact candidate previews and immutable result digests.
Full result blobs live under `runs/.otto-results/<run>/` and are read on demand;
UI observation does not duplicate chat transcripts. The engine consumes the full
values. Structured `submit_output` fields are validated on the daemon and can
drive conditional edges and JSONata checks.

JSONata runs in bounded workers: two active, sixteen queued, one second per
evaluation and bounded expression/input/output sizes. There are no idle workers.
Ordinary prompt substitution and captured includes are data-only. Explicitly
approved EJS runs with daemon filesystem authority in bounded workers; the worker
deadline is not a filesystem sandbox. Importing or previewing a package grants no
code-execution permission. Missing/ambiguous snippets, cycles and excessive depth
are rejected before sessions are created.

Node queries use declared bounded inputs. File reads stay inside the execution
workspace. Commands use argv with `shell:false`; they can still write or spawn
processes. HTTP GET can also have effects. Command/network queries require
explicit per-launch approval; redirects, embedded credentials and parameter-based
origin changes are refused. Read/no-workspace nodes cannot gain write authority
through a command query.

## Storage, compatibility and recovery

Repository stores live at `.otto/workflows/{definitions,templates,runs}`. Host
stores use the owning daemon's `project-workflows/<persisted-directory>/`.
Workflow location is independent of Knowledge and Artifacts. Host defaults and
project overrides use separate explicit CAS saves. Changing a location affects
future creates, never silently moves or hides existing records.

Otto 0.9 global Graph/template libraries are discoverable as read-only legacy
origins; retained runs require canonical project/root/workspace ownership proof.
Ambiguous duplicate origins require an explicit store key. Legacy records are
copied into an owning project, never automatically migrated or deleted. Unknown
fields and original settings remain preserved. Dated `COMPAT` comments identify
these compatibility bridges.

Writes use digest-pinned staging, sync, close and one atomic rename under
cooperating writer locks. Linked/unsupported files and malformed records are
preserved. Unreadable project records remain selectable for origin/snapshot
inspection. Snapshot restoration retains damaged bytes and requires the inspected
current and snapshot digests. External editors are outside the cooperating lock;
no automatic retry can erase that boundary.

Explicit copy/move verifies the destination before retiring a source into
recovery. Receipts retain operation identity, the performing daemon's host identity,
timestamp and content proof. Import receipts retain the same host/time audit stamp.
These stamps identify the performing daemon, not an authenticated human author. Unknown outcomes are
inspected, never blindly replayed. Reconciliation can keep a verified copy or
complete an originally authorized move only while the source still matches.
Changed destination/result blobs refuse reconciliation. Lock recovery requires
the exact lock fingerprint and explicit confirmation that all writers sharing
the store stopped; lock age or emptiness is not evidence of abandonment.

Export/import supports legacy Graph packages and AI/template documents. Hashes
prove content integrity only, not trusted authorship. Import review binds the
exact destination and hash; commit is separate. Previous operation IDs can be
inspected and matching receipts reconciled without replaying the import.

Daemon restart reads only the active-owner journal, closes exact recorded
sessions and marks interrupted runs failed for explicit review. It never resumes
work automatically or scans the entire historical library at startup. A recovery
failure leaves ordinary Paseo chats available. Workflows observation uses one
demand-owned project long poll, bounded waiters and version-change invalidation.
Hidden surfaces do not renew it; inactive Workflows install no transcript watcher.

## CLI, tools and integrations

`otto workflow operations` lists names; supplying a name returns only that
operation's schema. `ls`, `inspect`, `save`, `validate`, `review`, `start`, `control`,
`delete`, `export`, `storage` and `call` use the selected daemon. Inputs require an
explicit project and exact record origin where applicable. Export refuses an
existing output file. `follow <id>` uses the same versioned long poll and emits
changed run revisions as JSON lines until terminal. Ctrl+C closes only that
observation connection; explicit `control --action cancel` stops the run.
Run `otto workflow <command> --help` for argument contracts.
Revisioned `save` uses `--origin <file>` containing the exact captured `WorkflowRef`;
the CLI checks its host and project before submitting the update.

MCP uses the compact `workflow_catalog` and `workflow_operation` entry points.
Only reserved members receive private plan/status/output/delegation controls.
Commands and MCP do not construct provider runtimes themselves. Tools retain
workspace binding on the daemon; a model cannot change its project by argument.

Artifacts created by a Workflow member retain the exact source run. Source
inspection uses a new Workflows RPC so the older Artifacts source response
vocabulary stays compatible. The deliverable remains available when its source
cannot be found. The Schedule adapter invokes the same saved-revision review,
admission and cancellation paths and retains schedule/fire provenance. It does
not add a scheduler, Schedule target UI or the deferred Schedule extensions.

Implementation homes are `otto/workflows` in the plugin SDK, server, app and CLI,
plus `plugins/otto-workflows`. Tagged base seams compose these owners, advertise
the optional capability and fence owned turns. Relay routing, framing, encryption
and Paseo protocol identity remain unchanged.

## Validation boundaries

Focused fixtures cover persistence, admission, cancellation, tools, providers,
template/expression bounds, drafts and recovery with isolated directories and
injected runtimes. `Otto App Acceptance` runs the real daemon, app and provider
tool loop against deterministic loopback HTTP responses, alongside ordinary
chat behavior. Full Paseo CI and exact-source product builds remain separate
gates. Synthetic providers do not establish live vendor quality, native CLI hook
isolation, physical-device input or model/GPU behavior.
