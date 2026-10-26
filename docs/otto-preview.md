# Otto Preview

Preview's launch configuration and process lifecycle belong to the daemon. The
implementation is under `packages/server/src/server/otto/preview/`. It reads only
the selected workspace directory's `.claude/launch.json`; inspection never
creates a file or starts a process. Missing configuration is distinct from a
malformed file. Invalid, linked and oversized files are preserved and refused.

Each entry supplies a unique name, executable, argument array and local readiness
port. An optional HTTP(S) URL selects the browser destination independently of
that port. Optional environment overrides stay with the execution request.
Command approval fingerprints bind the canonical working directory, executable,
arguments and sorted environment. Changing only the destination does not grant
new execution authority. The manager requires its caller to supply approval of
the exact command; the fingerprint alone is not user consent.

Lifecycle changes serialize per canonical directory. Concurrent starts reuse one
tracked server. A configured port already listening can be adopted, without
claiming its identity or acquiring permission to stop its process. Adopted
servers retain `ext:<port>` identities within their directory. Otto never kills
a process discovered from a port. Protected host-service ports cannot launch a
Preview process.

Owned processes begin in Starting and become Ready when their port listens.
Readiness times out after 60 seconds. A timeout or failed stop keeps ownership
and blocks another launch until an explicit stop succeeds. Output retains up to
2,000 lines, each bounded to 1,000 characters, with tail, search and error filters.
Only explicit lifecycle actions invoke the process adapter. Shutdown stops owned
processes and leaves adopted servers alone.
The host retains at most 256 server records. Only confirmed-stopped or
never-started historical records yield space; active or uncertain ownership is
never evicted to admit another process.

The adapter uses Paseo's command/argv environment and Windows script handling.
POSIX children start in a dedicated process group; stopping signals that group,
then forces termination after five seconds. Windows uses the existing process-tree
termination helper. Native process-tree acceptance runs only in the Linux and
Windows CI lanes, against isolated Node fixtures.

This daemon core is not yet registered as an app or MCP contribution. Browser
binding, provider permission admission, workspace controls and tools compose it
with Paseo's existing browser broker. They must not bypass the caller's command
approval or create a separate browser stack.
