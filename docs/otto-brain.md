# Otto Brain

Brain is an independent Otto-owned workspace at `packages/otto-brain`. The source
name `@getpaseo/brain` follows this checkout's workspace convention; release packing
maps it to the existing public package `@otto-code/brain`. Its executable remains
`otto-brain`. No app or daemon is required to import or run the package.

The standalone CLI provides the interactive `ui`, `serve`, detached `start`/`stop`/`restart`, `status`,
`scan`, `catalog`, `search`, `pull`, `add`, `config show`/`set`, `runtime list`/`install`/`select`/`remove`,
`calibrate`, `sweep`, `bench`, `share`, `report`, `rescore` and help,
configuration persistence, home ownership, HTTP/HTTPS, credential masking and host
shutdown. The library also provides concrete llama.cpp process supervision,
runtime acquisition and model inventory/download operations. Its scheduling library
provides per-model admission, shared exclusive operations and a bounded process pool.
Capacity/quality jobs and host inference share the resident process pool. The
bundled `otto-brain` plugin registers the original animated sidebar icon,
Overview/Library/Models/Benchmark/Logs screen, host settings and Open Brain command.
The renderer remains in Otto-owned app files behind a typed built-in bridge.
Host > Plugins contains Configure Brain even while Brain is disabled. This opens
the registered host settings screen; built-ins do not appear in the installed-plugin list.
Registration creates only passive controllers. Native graphics load on first
render; the operational and settings screens load separately when opened, so
unrelated app/runtime modules do not evaluate Brain's native animation controls.
The animated icon sits beside Usage in the sidebar's existing bottom icon line,
without a separate footer panel. Its state sentence is
the tooltip and accessible name; no permanent state label appears beside it.
The sidebar waits for the host's saved enablement before adding the icon. Disabled
hosts have no provisional icon; enabled hosts retain their unreachable state.
With the built-in enabled, Otto daemon startup applies saved local enablement and
Start with host together, once per daemon lifetime. It leaves an existing owner
alone and never starts a Remote Brain. Failed startup is not retried automatically.
Settings reads and saves do not apply this intent. Automatic model selection on
an explicit start/restart uses the owning host's saved default; a selected model
overrides it without rewriting that default. Passive settings projections apply
environment overrides in memory without seeding a missing configuration file.
Daemon-owned connection and owner settings use the same local/Remote transport
and private home. The same plugin registers the `otto-brain` agent provider,
sharing the complete OpenAI harness. Native terminal, model and
product acceptance remain restoration work tracked in Otto Knowledge. This
package is not yet the complete Brain product. `serve`
starts unloaded unless its caller explicitly passes `--model`.

### Active app resource reads

Operational views share one installation-owned read per resource. A host revision
event arriving during that read queues one follow-up for retained consumers;
the older response cannot consume the event and leave terminal jobs displayed as
running. Event bursts coalesce, and releasing the last consumer drops queued work.
Connection/owner replacement clears it rather than carrying work to the next host.
An explicit post-mutation refresh waits past any earlier query before beginning
its own read. Job cancellation uses that barrier. A newer accepted job projection
also prevents an older query or its error from replacing that projection.
These are demand-owned invalidations and explicit refreshes, not polling or
automatic failure retries.

### Otto CLI management

`otto brain` manages the Brain selected by the target Otto daemon. Normal `--home`
and `--host` selection applies, including paired relay and SSH connections. It
uses the same encrypted plugin RPC and daemon-owned local/Remote connection as
the app. It never interprets a remote selection as permission to use local model
files. Help is passive; commands require the host's Brain capability.

`status` reports saved connection/owner settings even while the local runtime is
stopped. `live-status`, `resources`, `model ls`/`scan`/`load`/`unload`/`rename`/
`reset-name`/`delete-plan`/`delete`/`delete-component`, `model profile show`/`save`/
`budget`, `catalog`, `search`, `quants`, `pull`, `add`, `runtime list`/`candidate`/
`install`/`select`/`auto`/`remove`, `calibrate`, `sweep`, `benchmark`, `job ls`/
`cancel` and `evals` use host-issued identities. `benchmark <model-id>` returns
job admission; closing that command does not cancel its durable work. Inspect it
with `job ls` and cancel it explicitly with `job cancel`.

Scan, catalog, search, pull/add, calibration, sweeps, runtime, report and replay commands share their
option definitions, handlers and table/JSON/YAML/quiet formatters with
`otto-brain`. Calibration and sweeps use `--model <fragment>`; sweeps also accept
`--budgets`. Runtime installation accepts `--build` and `--variant`; destinations
and installed identities belong to the owner. Downloads support quant discovery
and bundle selections. These commands wait on the existing event feed for their
admitted job. An explicit Ctrl-C requests cancellation of that job; a dropped
feed alone does not. An uncertain admission must be checked in the host's jobs
before another submission.

`report --out <path>` writes on the selected Brain owner, including a Remote
owner. It does not create a client-local export. `rescore --run <archive-id>`
replays that owner's saved transcripts as a cancellable CPU benchmark job;
`--no-execute` retains the existing syntax-check-only Python policy. Neither
operation loads a model or rewrites saved scores/transcripts. Replay has an
explicit mode within the existing benchmark job category, so older readers can
still parse its status. Current screens and terminal progress identify it as
rescoring rather than a new inference measurement.

`bench --model <fragments>` runs the same rich benchmark controls on resident
models through the owner's exclusive scheduler. `bench --endpoint <host:port>`
runs on the selected owner against that explicit endpoint as a durable benchmark
job. Endpoint hostnames, port defaults, repository access and any generated-code
checks belong to that owner. Closing the request does not stop the job; explicit
interruption requests cancellation. Endpoint benchmarks do not load a local
resident or pretend to measure one in the animated icon. Their report retains a
null resident profile instead of inventing model metadata.
For selected-owner repository benchmarks, `--repo-dir` is required and forwarded
unchanged, including when the client and owner use different path conventions.
Use a source path on that owner. The benchmark creates its disposable checkout
there; it never mines the client's current directory.

`scan` discovers the selected owner's files and calibration state without loading
a runtime or probing GPU resources. `--no-metadata` skips GGUF header reads and
does not replace the full metadata used by resident operations. Full discovery
refreshes the owner's inventory cache. Both listings work on read-only owners;
they do not change saved settings or grant model-management permissions.
Ordinary CLI job progress requests status only; the interactive terminal also
requests logs while its viewer is retained.

`config show/set` shares standalone key validation and formatting while adapting
to Otto's two settings owners. Enable/autostart edits use the selected daemon's
connection revision and work even while its Remote Brain is unreachable. Other
keys use the actual local/Remote owner's revision. Reads and writes never start
a host or load a model. The command sends only the edited leaf and explicit
credential replacement/removal intents; masked output is never a saved key.
Conflicts require a new explicit invocation after reading the current settings.
Runtime source changes clear a previously pinned executable/installed selection.

`share` uses the same sharing policy as `otto-brain`. On Otto it reads the selected
local/Remote owner; mutations require both daemon and owner sharing capabilities.
Discovery, key generation and the single revisioned settings write happen there.
Only a newly generated key is returned directly to that invocation. Existing keys
remain status-only, and environment-owned credentials cannot be rotated. Sharing
output reports staged settings that require restart. Saving never starts or
restarts a host or changes the selected daemon's Remote connection credentials.

`serve --home <path>` is an explicit local foreground owner, using the same
implementation as `otto-brain serve`. It does not connect to an Otto daemon and
rejects `--host`; use the selected host's `start/restart` commands for remote
management. The captured local home is passed to configuration, discovery and
runtime construction without changing process environment. A saved default model
does not load on initial serve unless `--model` is explicit. Failed startup
removes its own signal handlers; successful shutdown retains normal ownership
and process cleanup rules.

The shared handlers borrow one target-scoped transport. A disconnected Remote
owner never falls back to a local home. Each command request carries the captured
connection revision and owner lifetime, and crosses encrypted RPC as a fixed
operation with validated arguments, rather than an arbitrary HTTP path. An
explicit model command may start its selected daemon's unloaded local management
owner when absent; it never starts a Remote service or loads a saved default.

`connection show` and `owner show <owner-id>` return revisioned sanitized settings.
Their `save --input <file|->` commands take explicit JSON write documents with the
originating revision, partial patch and write-only credential intents. `-` reads
stdin, keeping secrets out of command-line history. Profile saves also require
`--revision`. Input is bounded to 128 KiB. Blank keys never mean removal, conflicts
never rebase, and uncertain writes never retry. Read current state before another
explicit submission. Reads strip unknown output fields; stored keys and raw host
errors are not printed.

### Interactive terminal

`otto-brain` and `otto-brain ui` open the original full-screen terminal. An explicit
invocation starts a detached, unloaded local owner if none is running. It does not
require an installed model runtime, load the saved default model or apply autostart.
`otto brain` and `otto brain ui` instead use the selected Otto daemon and its
enabled local/Remote connection. They can start its unloaded local management
owner; a Remote service must already be running on its own machine. Both TTY
streams are checked before connecting or resolving a home. Piped invocations
receive console guidance and have no host side effects.

The terminal reads one batch of canonical model/profile/catalog/runtime metadata.
It shares one demand-owned status/log stream, refreshes metadata on library
revision changes and reads hardware while the terminal is active. Repository,
model, slot and runtime identities come from the owner, including repeated slot
numbers in different resident processes. No owning-host paths are inferred or
sent back as commands. The same owner scheduler and durable jobs perform loads,
calibration, sweeps, benchmarks, downloads and runtime management.

Profile edits serialize with their originating revision and use the normalized
acknowledgment before saving a newer edit. Failed or conflicted drafts remain
local until explicit reload. Fit previews also check that originating revision
before applying and saving a context size. Node transports pin the intended host
lifetime on each terminal operation, so a replacement listener rejects a stale
write even when its model IDs match. Closing the terminal releases its feed,
hardware reads and client waits. It leaves the independent host, its residents
and admitted jobs running; cancellation is an explicit job action.

## Ownership and continuity

Only explicit operations resolve `OTTO_HOME`, defaulting to `~/.otto`, and use its
existing `otto-brain/` subdirectory. Configuration, profiles, catalog, models,
runtimes, templates and results retain their historical paths. Configuration
validation errors leave the original file intact. Profile/catalog stores preserve
unknown user fields; curated catalog entries retain the existing refresh behavior.
Loading a configuration never launches a runtime or applies autostart intent.

Configuration writers use a private exclusive claim and an originating byte
revision. The CLI, runtime selector and revisioned update API share this path;
a peer edit is rejected rather than rebased. Reads through the revisioned API
do not create a missing configuration. Unsupported or malformed files remain
intact. An interrupted writer's `config.json.lock` fails closed and requires
owner inspection; another writer never removes it on an elapsed-time guess.
The final compare detects external editor changes before replacement, while an
editor racing that final compare and rename remains outside the cooperative lock.

`config set` accepts known root or dotted setting leaves, validates the complete
configuration, and requires literal `true` or `false` for booleans. Nullable paths
can be cleared with `null`; model locks use a JSON array. `share` saves network,
TLS and access intent without starting or restarting a host. A newly generated
key is returned once by that command; later reads report only whether a key exists.
Saved transport changes take effect on an explicit host restart.
Standalone `serve` supports explicit owner restart without depending on an Otto
daemon to respawn it. A permitted restart acknowledges its current lifetime before
closing the listener and replacing the engine, then rereads saved configuration
once. The replacement receives a new lifetime ID. Active model work and jobs stop
as part of that explicit restart. It loads an explicitly selected model, or the
owner's saved default, while the initial `serve` remains unloaded without `--model`.
Startup or shutdown failures do not trigger an automatic restart loop.

Otto's app and CLI expose Remote restart only when the actual owner advertises it
and allows remote configuration. They bind the request to its observed lifetime.
Remote service start and stop remain operations of the machine that owns that
service. If staged settings change its endpoint, TLS identity or access key,
restart through the current connection first, then explicitly save the matching
new connection. Otto never guesses a replacement key or trusts a new certificate.
The private running-host record retains the active listener's public certificate.
Exact local stop uses that trust material and its private lifetime proof, so a
staged certificate location or replacement access key cannot lock its owner out
of restarting. Browser Origins and mismatched lifetimes are rejected.

The engine advertises `ownerSettings` for revisioned `GET`/`POST /__host/settings`.
These routes use the existing listener authentication and management write policy.
Reads contain credential presence and environment provenance, never saved keys.
Writes carry a stable owner ID, originating revision, partial known settings and
separate `keep`/`replace`/`remove` credential intents. Proven pre-write validation
rejections are distinguished from conflicts and uncertain failures; a caller must
not infer a safe retry from an HTTP status alone. Environment-owned runtime,
storage and credentials report their ownership and reject ineffective changes.
An installed runtime ID is resolved to its actual source and executable by the host.

Owner settings saves are staged for explicit host restart and report whether the
effective saved configuration differs from the running host. They never rebind a
listener, alter its active key, load/unload a model or apply autostart. Explicit
`POST /__host/settings/access-key` generates and persists a replacement against the
same owner revision; only that direct response contains the new key. Subsequent
reads and canonical settings projections contain status only.

`report` explicitly exports the owning home's saved benchmark history as HTML,
using the latest run per model and configuration for its comparison table.
`rescore` re-grades archived exchanges with the current scorer and compares them
with historical scores. It does not rewrite saved measurements or transcripts;
timing-dependent tasks remain unscored by replay. `--no-execute` skips generated
code execution. Both commands use the normal table/JSON/YAML/quiet output layer,
and neither starts a Brain host or loads a model.

The host claims its home before binding a listener. It records a per-lifetime
instance ID as well as the PID, refuses another live owner, and releases only its
own record. A malformed ownership record or reused live PID fails closed. A claim
whose recorded process has exited is recoverable on the next explicit start.

Importing the package root, `config`, `host` or `cli`, and invoking help, must not
resolve a home, read user configuration, start a listener or launch a process.
Keep configuration and engine integrations on these explicit boundaries.

## Transport and engine boundary

The listener remains available while no model is loaded. `/health` describes host
liveness; `/__host/status` describes model state. Management capabilities report
only implemented operations. Host composition supplies inference, model inventory,
load/unload, revisioned profiles, budget preview, rename/reset, guarded deletion,
jobs and demand-owned events. Empty model listings remain valid, and completion requests
without an engine return an actionable 503.

The host's SSE feed carries complete status snapshots and bounded retained log
history. Log records carry the host lifetime and absolute index; reconnecting
readers can deduplicate replay without collapsing repeated identical messages.
The host advertises `logCursors` for this identity contract. Both host history
and consumer buffers have line and byte limits, and truncated UTF-8 lines retain
complete characters.

The public `host` entry provides a transport-injected `BrainStatusStore` and
validated local event source. All consumers of one owner retain the same store;
passive subscriptions and bounded cursor waits create no connection. The final
release aborts the sole feed and reconnect timer. A new host lifetime resets log
identity, stale callbacks are ignored, and uncertain transport failures expose
fixed display text. The owner supplies the complete status DTO validator; no
browser socket or parallel feature cache is created by this library. This is a
composition boundary; the bundled app contributes its own surfaces.

The daemon gives every installation's visible Brain consumers one shared feed.
The sidebar and settings request status without log payloads. The Logs tab adds
bounded log demand, receives batched absolute-index deltas and releases that demand
when hidden. Resource probes run only while the Overview requests them. Library
revisions invalidate retained views after profile, runtime, inventory or job changes;
owner-setting revisions signal peer edits without rebasing local form drafts.
Closing a client aborts its waits and reads, leaving admitted host jobs running.

`GET /__host/resources` is an explicit, separately advertised hardware read.
It samples the owning host's CPU, RAM and available GPU, while cheap status and
the icon feed never trigger that probe. Concurrent requests share one in-flight
sample. Canceling one request keeps other readers alive; canceling the last
reader aborts the probe. A later request does not overlap a probe still stopping.
Host shutdown waits for its canceled hardware probe to settle. There is no
resource timer or background sampling when no view requests it.

Profile reads and saves carry an opaque edit revision. A saved profile reports
whether an existing resident needs reloading; saving never restarts that resident.
An explicit model load drains inference before applying changed profile or runtime
selection. Loading an unloaded model starts it once. Calibration and temporary
operation profiles retain their separate launch settings.

A missing saved runtime executable does not block inventory or profile editing.
The owner can repair its runtime selection without starting a model; an actual
model load still requires a usable executable.

Brain owns transport authentication and TLS. Non-loopback binding requires an
actual token unless the owner explicitly allows an insecure bind. Private tokens
are masked in configuration responses; engine exceptions are not reflected into
HTTP responses. Existing file, cached self-signed and Tailscale certificate modes
are retained. Tailscale issuance requires the owner's installed Tailscale service.

Local and remote management clients share bounded JSON and SSE handling. Remote
HTTPS uses the system trust store unless the owner explicitly saves a SHA-256
certificate pin. In pinned mode the TLS handshake and fingerprint comparison
finish before the socket is handed to HTTP, so a mismatched peer receives no
access key. Invalid pins and URL-shaped host fields are rejected before connecting.
Requests do not follow redirects. Aborting an event reader or an incomplete TLS
handshake closes its client wait; it does not cancel an admitted host job.
Non-success JSON responses retain their untrusted body separately from fixed
display text, for validation by the owning operation's error contract.

A model engine implements `BrainRuntime` behind this listener. It owns its model
processes and requests; the listener owns sockets and service lifetime. Stop closes
active sockets and calls engine teardown once, with an abort signal and a six-second
deadline. Engines must honor cancellation and terminate their owned processes.
The concrete `Supervisor` implements this contract for one llama.cpp child. Its
internal listener is always loopback, separate from the public host listener.
Construction never loads a model. Explicit `start(model, profile, signal)` resolves
the host's stored hosting profile, materializes its template and builds native
arguments/environment through the llama.cpp driver. It waits for `/health`, bounds
each readiness probe, supports cancellation during loading, and reports launch
errors, early exits and resident crashes. `properties()` reads `/props` only when
ready. Shutdown requests termination, escalates after two seconds and waits for
the child to close before returning. Owned children must stop before a replacement
starts. Logs and incomplete log lines are bounded.

`startService({config, env, createRuntime: createHostRuntime})` claims the home
before constructing the host engine. This composition owns the process pool,
routes inference to resident models and validates management operations. A bare
transport or injected supervisor advertises only its implemented capabilities.
Management writes reject browser Origins; remote writes require the owner's
`allowRemoteConfig` setting in addition to transport authentication.

## Runtime and model libraries

The package root and `runtime`/`models` exports are inert on import. Discovery,
installation, downloads and removal are explicit calls. Runtime selection keeps
the existing explicit-path, managed and LM Studio choices. Managed installations
live in the existing Brain runtimes directory. The historical default remains
llama.cpp `b10265`; its release asset names and native argument spellings are
verified against that tag, rather than assuming the latest naming convention.

`installManagedRuntime` streams archives into a generated hidden stage, inspects
archive paths/links before extraction and verifies the executable before making
it discoverable. Existing installations are never overwritten. Failed stages
belong only to that operation. Native helpers have a fifteen-second deadline;
Windows uses the system `tar.exe` because Git's GNU tar treats drive letters as
remote hosts. ZIP extraction on Windows uses PowerShell's existing extractor.
The existing Linux missing-libgomp repair remains local to the runtime directory;
it does not install an OS package or alter global configuration.

Runtime management uses host-issued installed and candidate identities. Clients
submit a build/variant choice to the host and install its candidate as a tracked
job; they never submit a runtime deletion path. Removal refuses external, selected,
resident or queued runtimes. Runtime selection preserves unrelated host settings
and takes effect on the next explicit load or restart. A missing saved executable
does not hide installation and repair controls.

An explicit `latest` installation resolves the current compatible upstream release
when the job runs. A failed lookup does not fall back to the packaged build. A
successful latest update restores automatic selection only if no peer changed the
runtime selection while it installed. Named builds remain deliberate pins. GPU
diagnostics run only as part of an explicit installation; their warnings do not
claim that a model has loaded successfully. CLI progress uses the host event feed
and prints measured phases without raw native exception text.

Model discovery combines configured managed and LM Studio sources, with managed
files owning identical artifact IDs. Callers can supply explicit sources for
isolated inventories. GGUF metadata is read without loading tensor data. Shards,
projectors, manifest-declared bundles, curated enrichment and saved display names
retain their existing identities. Hugging Face search, quant/shard discovery and
token resolution are library operations, not new daemon RPCs.

Downloads share one path validator, reject traversal and filesystem links, and
hold an operation claim per destination. Interrupted claims are recoverable only
when their recorded owner is proven dead. Partial files resume only against a
strong ETag, matching byte range and complete size; changed or unidentified files
restart. Cancellation never publishes a partial model. Existing complete files
count toward bundle progress. Storage plans keep shared projectors while another
quant remains and conservatively retain cross-repository companions. Callers must
resolve trusted model IDs and reject resident/shared optional components before
executing removal. The host's synchronous deletion guard includes queued work,
loading/resident models, admitted jobs and shared artifact references. No await
separates its checks from the filesystem mutation.

Catalog and direct-repository acquisition run as host jobs. The owner resolves its
HF credential, model directory, quant shards and shared or catalog-declared bundle
components. Clients submit model/repository selections rather than destinations or
credentials. Discovery requests honor cancellation and retain their own deadlines.
One active download per repository prevents shared-projector transfers from racing
inside a host; filesystem claims also protect against other processes. Explicit job
cancellation stops its transfer and leaves resumable partials under the existing
identity rules. Canceling before execution does not block a later download.

CLI search, catalog, quant listing, `pull` and `add` use those same APIs, preserving
installed-model indicators and the existing table/JSON fields. Catalog membership
is joined using the host's stable catalog id. Direct additions retain primary-only
and projector-only selection; importing or requesting help performs none of them.

## Residency and scheduling

`ModelProcessPool` owns one supervisor and scheduler per resident model. Its limit
is host-configured (1 to 16). It routes resident work to its existing process,
keeps busy models resident and evicts the least recently used idle model when
another needs a process. Loads serialize reservation decisions so simultaneous
loads cannot each spend the same free memory. An operation receives a pool-owned
lease for temporary profile launches; its stops and starts update the same
reservations and slot ownership as ordinary inference.

Within each process, requests share the configured sequence slots. Model turns
preserve fairness, exclusive calibration/sweep/benchmark work drains inference,
and measured free slots are combined with the process ceiling without subtracting
running requests twice. Session affinity preserves useful caches; slot handoffs
await the supplied runtime eraser before posting a completion. Queued aborts
settle immediately. Shutdown closes both queue levels and prevents work that was
waiting on a load from starting afterwards. The injected loader receives a pool-lifetime
abort signal; it must honor that signal during probes and before launching a child.

`decideModelGate` enforces the host's selected model lock before admission. The
activity tracker distinguishes processing, thinking and generating from actual
stream signals, including concurrent requests. The demand-owned status publisher
coalesces complete snapshots and stops sampling when its last listener leaves.
These components are wired to `serve` and the daemon's built-in Brain bridge.

## Agent provider

The `otto-brain` plugin registers **Otto Brain** through the normal Paseo provider
contract. Its node-only SDK composition uses the same agent sessions, native tools,
permissions, MCP transports, history/rewind, images and compaction implementation
as the OpenAI Compatible Provider. Brain retains a 6,000-token recent context budget
and caps summary requests at 4,000 tokens. Other OpenAI connections retain their
existing policy.

The selected daemon resolves its private Brain connection intent on each request.
Local requests use the verified private lifetime record; Remote Brain requests use
the configured hostname, key and TLS policy. Certificate pins are verified before
headers are sent. A virtual endpoint gives saved Brain chats a stable identity and
is never used for DNS or a browser connection. Registration, discovery and reads
never start a host or load a model. Disabled/unavailable Brain reports its status
through the provider contract.

The host advertises actual model names, per-slot context, profile-enabled vision
and implemented template effort choices. Owner instance, library and settings
revisions invalidate discovery. Supported preserved Brain aliases retain their IDs;
unsupported legacy options remain intact and report a diagnostic. Native 0.9 Brain
history is copied through the existing guarded importer before conversion, and
aliases must match their original preserved Brain inheritance. Transcripts remain
in the selected daemon's private archive, outside client/provider settings.
Detected reasoning controls include explicit Off alongside their model-specific
levels. Imported and resumed Brain conversations retain that template switch;
ordinary OpenAI-compatible providers retain their original omission semantics.
Pinned Brain aliases still discover their selected model's real host metadata.
An unavailable pinned model reports an error instead of receiving guessed capabilities.

The SDK's node-only Brain composition depends on the standalone Brain package's
lightweight `client` entry. Build and publish Brain before the SDK. The SDK root
and client-safe connection definitions do not import host engines or transports.

## Capacity and quality libraries

The `operations` export supplies calibration, reasoning sweeps, benchmarks,
transcript replay, history/report generation and diagnostic samplers. Importing
these APIs does not resolve a home, probe hardware, create a process or start an
operation. The host exposes calibration, sweep and benchmark jobs through the
same pool. CLI calibration and sweeps reuse the existing owner, or claim a
temporary loopback host for that explicit operation. They release only their own
temporary host; an interrupted command requests cancellation of its admitted job.
An event-feed disconnection alone does not cancel durable host work.

`bench` accepts comma-separated model selections, task/depth/concurrency controls
and explicit repository or curated-repository inputs. Model runs use the same
exclusive pool lease and record the profile, fit, calibration and launch arguments
that actually ran. Their bounded job reports retain scorecards and measured depth
rates; full task details remain in the owner's archive. Multiple model runs execute
serially and produce the existing comparison table. Explicit `--endpoint` runs use
an already-serving HTTP endpoint without creating a separate model supervisor.
The legacy `--port` option reports that resident ports are now host-managed.

The `--no-execute` switch controls generated Python execution. Repository tasks
still build their owned checkout and execute its oracle tests. Repository cleanup
waits for the suite and its children; a cleanup failure preserves an earlier suite
error as the primary cause. Saving or formatting a report does not load a model.

Calibration and sweeps require a `ModelOperationProcess` lease from the owning
process pool. They never create an independent supervisor. Every temporary launch
uses that lease, and teardown restores the process's logging verbosity and releases
the allocation. Cancellation reaches probes, private completion requests and child
commands. The host must pass the operation signal into the lease's loader too.
Calibration measures allocation at two or more validated context sizes, rejects
missing measurements and CPU KV spill, and accounts for enabled bundle components.
Metal allocation logs remain available after shutdown. A failed calibration does
not manufacture a measurement or replace the last stored result.

Profile editing keeps stable calibration/group identities, clamps supported
settings against model/runtime capabilities and marks changed allocation inputs
for recalibration. An unrelated settings edit does not invalidate a measurement.
The existing hosting-profile/template materialization remains host-owned.

Benchmark tasks retain their existing tool, repair-loop, long-horizon, context and
concurrency scoring. The suite accepts an injected chat port and explicit Python
interpreter, including `null` to disable discovery. A process-credit score without
executed tests is labeled accordingly. Native timing/usage fields are retained
when supplied, rather than inventing token rates from character counts.

Repository benchmarks clone an explicit local source into a generated disposable
checkout. Reset, oracle checkout, installation, build and tests refuse ordinary
source directories or mismatched ownership. Tests require explicit oracle file
filters and one worker. The owning job must call the returned `dispose()` after
all tasks/children settle. Windows npm/npx commands invoke their JavaScript entry
points with literal argument arrays and no command shell. Running a repository
benchmark can install dependencies and execute project code inside that owned
copy; importing or preparing the package does neither.

Scores/transcripts/reports accept an explicit host environment and retain the
existing results paths. Writes are private and atomic; same-instant runs receive
distinct identities. Historical score/config keys and unknown metadata are not
rewritten. Malformed score presentation fields and transcript records are skipped
without deleting their originals. Transcript replay uses stored exchanges and
does not contact a model; execution/interpreter/cancellation options still apply.

One append-only run log retains child and operation sources across model switches.
Rapid service restarts create distinct files. Tail reads are bounded, and retention
only considers expired Brain session logs. Per-resident slot trackers prevent rate
history from crossing model processes. Benchmark health sampling has at most one
probe in flight and aborts its probe when stopped.

## Verification

`npm run build:brain:clean` builds only this workspace. Its fixture tests share the
existing Linux and Windows server CI jobs. The package also participates in root
typechecking, server-stack builds and release packing. Run individual changed test
files locally, with one worker; keep broad coverage on CI. Tests use isolated homes
and ephemeral ports and never inspect the installed Brain store or load real models.
Synthetic GGUF headers, download responses, real OS archive extraction and small
Node HTTP child processes cover the runtime/model boundary. These fixtures do not
establish native llama.cpp loading, GPU/backend availability, real model quality,
or signed iOS/device acceptance.

`npm run typecheck --workspace=@getpaseo/brain -- -p tsconfig.tests.json` checks
all Brain fixture declarations and package-root helpers without emitting them.
CI runs this beside the focused Knowledge and Kanban fixture typechecks after
building the owning workspace declarations. Production builds continue to exclude
test files. The app's normal typecheck already includes its Brain fixture sources.
`npm run typecheck:otto-fixtures --workspace=@getpaseo/plugin` checks the provider
composition fixture against the packaged SDK and owner transport declarations.
