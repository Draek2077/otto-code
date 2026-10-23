# Otto Brain

Brain is an independent Otto-owned workspace at `packages/otto-brain`. The source
name `@getpaseo/brain` follows this checkout's workspace convention; release packing
maps it to the existing public package `@otto-code/brain`. Its executable remains
`otto-brain`. No app or daemon is required to import or run the package.

The standalone CLI provides `serve`, detached `start`/`stop`/`restart`, `status`,
`scan`, `catalog`, `search`, `config show`/`set`, `runtime list`/`install`/`select`/`remove`,
`calibrate`, `sweep` and help,
configuration persistence, home ownership, HTTP/HTTPS, credential masking and host
shutdown. The library also provides concrete llama.cpp process supervision,
runtime acquisition and model inventory/download operations. Its scheduling library
provides per-model admission, shared exclusive operations and a bounded process pool.
Capacity/quality jobs and host inference share the resident process pool. Full CLI
coverage, TUI host composition, Remote Brain, provider/settings registration and
app availability remain restoration work tracked in Otto Knowledge. The original
Brain renderer and five operational screens exist in Otto-owned app files but
are not registered. This package is not yet the complete Brain product. `serve`
starts unloaded unless its caller explicitly passes `--model`.

## Ownership and continuity

Only explicit operations resolve `OTTO_HOME`, defaulting to `~/.otto`, and use its
existing `otto-brain/` subdirectory. Configuration, profiles, catalog, models,
runtimes, templates and results retain their historical paths. Configuration
validation errors leave the original file intact. Profile/catalog stores preserve
unknown user fields; curated catalog entries retain the existing refresh behavior.
Loading a configuration never launches a runtime or applies autostart intent.

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

Profile reads and saves carry an opaque edit revision. A saved profile reports
whether an existing resident needs reloading; saving never restarts that resident.
An explicit model load drains inference before applying changed profile or runtime
selection. Loading an unloaded model starts it once. Calibration and temporary
operation profiles retain their separate launch settings.

Brain owns transport authentication and TLS. Non-loopback binding requires an
actual token unless the owner explicitly allows an insecure bind. Private tokens
are masked in configuration responses; engine exceptions are not reflected into
HTTP responses. Existing file, cached self-signed and Tailscale certificate modes
are retained. Tailscale issuance requires the owner's installed Tailscale service.

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
These components are wired to `serve`; Otto app registration remains unfinished.

## Capacity and quality libraries

The `operations` export supplies calibration, reasoning sweeps, benchmarks,
transcript replay, history/report generation and diagnostic samplers. Importing
these APIs does not resolve a home, probe hardware, create a process or start an
operation. The host exposes calibration, sweep and benchmark jobs through the
same pool. CLI calibration and sweeps reuse the existing owner, or claim a
temporary loopback host for that explicit operation. They release only their own
temporary host; an interrupted command requests cancellation of its admitted job.
An event-feed disconnection alone does not cancel durable host work.

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
