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

The host resolves workspace directory aliases before looking up servers or their
designated tabs. A previously resolved alias retains recovery access after its
directory disappears, so both app controls and agent tools can inspect logs and
stop an owned process. This does not authorize a new launch in a missing directory.
Alias identities are workspace-bound and capped at 4,096 entries.

Owned processes begin in Starting and become Ready when their port listens.
Readiness times out after 60 seconds. A timeout or failed stop keeps ownership
and blocks another launch until an explicit stop succeeds. Output retains up to
2,000 lines, each bounded to 1,000 characters, with tail, search and error filters.
Each log response also has a 128 KiB encoded budget. Only explicit lifecycle actions invoke the process adapter. Shutdown stops owned
processes and leaves adopted servers alone.
The host retains at most 256 server records. Only confirmed-stopped or
never-started historical records yield space; active or uncertain ownership is
never evicted to admit another process.

The adapter uses Paseo's command/argv environment and Windows script handling.
POSIX children start in a dedicated process group; stopping signals that group,
then forces termination after five seconds. Windows uses the existing process-tree
termination helper. Native process-tree acceptance runs only in the Linux and
Windows CI lanes, against isolated Node fixtures.

## Workspace controls and agent tools

The built-in Otto Browser plugin contributes a Preview Servers workspace panel.
Open it from the workspace menu, Command Center or a browser's More menu. Wide
layouts place server selection beside output; compact layouts retain the selection
and show its actions inline. Both use the app's existing controls and content gutters.
Reading the page, loading configuration or copying the detection prompt starts nothing.
Start and Stop require explicit confirmation. A changed command fingerprint is refused
before execution. Invalid configuration leaves tracked processes available for recovery.
Reads refresh only while the panel is retained, visible and connected; output is pulled
on demand. A late confirmation from a hidden opening cannot start a process.

`preview_list`, `preview_start`, `preview_stop` and `preview_logs` use the same host
service for every provider. Agent tools resolve the live chat's workspace, not a
model-supplied path. Existing host/provider tool ceilings remain authoritative.
The OpenAI-compatible harness shares the execution parser and pins command approval;
an edited command revokes an old automatic grant. The snapshot never creates a grant.
Native providers retain their own permission systems.
Agent responses are capped at 192 KiB; authenticated app responses are capped at
768 KiB below the relay frame limit. An oversized response fails visibly rather
than sending an unbounded launch inventory or silently clipping a command approval.

Preview opens one designated tab per server/workspace through Paseo's browser broker,
reuses a confirmed existing association and refuses to create another when listing fails.
Browser failures leave process ownership visible. Closing the tab does not stop the server.
The shared broker serializes AI tab creation per workspace and counts both ordinary
browser and Preview tabs toward its twelve-tab admission ceiling. Failed inventory
reads never authorize another create. Navigation to a running Preview origin, or
a loopback alias matching its local port, requires that workspace's designated ID.
Only the daemon's Preview service can request its first designated tab; that authority
is not a wire field. Initial HTTP(S) navigation rejects credential-bearing URLs and
known cloud metadata addresses, including DNS aliases and IPv4-mapped IPv6 forms.
This preflight does not claim interception of page-initiated redirects or requests.
The host reports a separate capability; an older daemon offers an update message.

Rendered wide/compact lifecycle acceptance is authored in
`packages/app/e2e/browser/otto-preview.spec.ts` and executes only in CI. Local fixture
proof does not establish native browser, mobile streaming or packaged-product acceptance.
