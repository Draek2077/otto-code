# Otto Brain

Brain is an independent Otto-owned workspace at `packages/otto-brain`. The source
name `@getpaseo/brain` follows this checkout's workspace convention; release packing
maps it to the existing public package `@otto-code/brain`. Its executable remains
`otto-brain`. No app or daemon is required to import or run the package.

The restored foundation currently provides `otto-brain serve`, `status` and help,
configuration persistence, home ownership, HTTP/HTTPS, credential masking and host
shutdown. Model engines, acquisition, scheduling, operations, full CLI coverage,
Remote Brain integration and the existing Brain renderer remain restoration work
tracked in Otto Knowledge. This package is not yet the complete Brain product.

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
only implemented operations. The foundation does not advertise model management,
events or remote writes. Empty model listings remain valid, and completion requests
without an engine return an actionable 503.

Brain owns transport authentication and TLS. Non-loopback binding requires an
actual token unless the owner explicitly allows an insecure bind. Private tokens
are masked in configuration responses; engine exceptions are not reflected into
HTTP responses. Existing file, cached self-signed and Tailscale certificate modes
are retained. Tailscale issuance requires the owner's installed Tailscale service.

A model engine implements `BrainRuntime` behind this listener. It owns its model
processes and requests; the listener owns sockets and service lifetime. Stop closes
active sockets and calls engine teardown once, with an abort signal and a six-second
deadline. Engines must honor cancellation and terminate their owned processes.
Future adapters must prove that contract using fixture processes before real models.

## Verification

`npm run build:brain:clean` builds only this workspace. Its fixture tests share the
existing Linux and Windows server CI jobs. The package also participates in root
typechecking, server-stack builds and release packing. Run individual changed test
files locally, with one worker; keep broad coverage on CI. Tests use isolated homes
and ephemeral ports and never inspect the installed Brain store or load real models.
