# Otto OpenAI-compatible provider

The bundled `otto-openai-compatible-provider` plugin registers provider
`openai-compatible` through Paseo 0.12's public provider API. Its implementation lives
in `plugins/otto-openai-compatible-provider/`. The Otto-owned built-in list is the only
integration with the daemon registry. Relay, Hub, client protocol, agent storage and
chat rendering use the existing Paseo implementations.

## Host configuration

On the target host, open **Settings > Plugins > Otto OpenAI-compatible**. Set the API
base URL including its prefix, such as `http://localhost:1234/v1`. Localhost refers
to the daemon machine, including when the client is on a phone. Leave Model ID empty
to use `GET models`, or set an explicit model ID for endpoints without discovery.
The endpoint must support streamed `POST chat/completions` and function tools.

For a keyed endpoint, set its secret in the daemon's environment. The settings screen
stores only the variable's name, defaulting to `OPENAI_API_KEY`. Settings documents
are ordinary host JSON and are not a credential vault. Do not enter secrets in the URL
or the environment-variable field. Endpoint URLs reject embedded credentials, query
parameters and fragments. Requests do not follow redirects.

Save captures the revision at the start of editing. A conflicting save preserves the
draft and the newer host values; Discard loads those newer values. Invalid persisted
settings are reported without a reset. New sessions use the current host configuration;
already-open sessions retain their configuration. Model catalog cache keys include the
endpoint and model configuration.

## Execution and ownership

The daemon owns model requests, history, tools, permissions, cancellation and provider
persistence. The shared client contribution uses Paseo's React Native settings controls
and host frame, with no desktop-only API. Existing chat and permission surfaces render
all messages and tool cards.

The initial mode is **Ask before tools**. Native tools read a bounded text file, atomically
write UTF-8 content, or execute a bounded shell command using the session's host environment.
In this mode every native tool requires approval. Shell commands have a deadline and use the plugin
SDK's process termination helper; process-tree termination guarantees follow that helper's
platform behavior. Denied tools produce feedback without execution. Cancellation aborts
model requests and pending permission waits, and interrupts the active tool.

The provider consumes daemon-injected stdio, Streamable HTTP and legacy SSE MCP servers. It preserves server
instructions, tool descriptions and input schemas. Only an exact daemon-supplied server
and tool preapproval bypasses the permission prompt in Ask before tools. Model-visible names are stable hashes;
policy matching uses the original identities. MCP sessions close when the provider session
closes. Stdio servers run in the session workspace with the session environment and
their configured overrides. Cancellation notifies the MCP server and releases the request;
shutdown closes stdin before bounded process termination. Legacy SSE uses the advertised
message endpoint only on the configured origin, so authentication headers are not forwarded
to another origin. Neither HTTP transport follows redirects.

Tool results are capped at 16,000 characters with a truncation notice. Model output is
bounded; a truncated or unfinished completion cannot execute partial tool calls. Tool
rounds default to 24 and request deadlines to five minutes. The permission decision wait
does not consume the model request deadline. Endpoint usage is reported when supplied;
missing usage is not invented.

## Persistence and current limits

New conversations persist opaque versioned provider data through Paseo's agent store.
It contains model messages and timeline snapshots, not API keys or session environment.
Recovery completes unanswered tool-call records with interruption feedback and never
reexecutes them automatically. A different configured endpoint is refused when resuming
saved history, preventing an accidental history transfer to another service.

The provider supports one endpoint, text and image prompts, native file/shell tools, MCP over all three standard transports,
streaming, approval, cancellation, live configuration, compaction and recovery of its own new sessions. It does not yet
implement multiple endpoint
profiles, credential entry, rewind, or importing
Otto 0.9 provider sessions/settings. Older data remains preserved by the continuity layer;
preservation does not imply those sessions can resume through this new provider.

The full OpenAI-compatible feature family remains in progress. Brain is a separate phase.

## Session controls

Paseo's existing session controls select models, reasoning effort, permission mode and an
optional maximum response token count. Endpoint default sends no output cap or reasoning
override. Explicit output limits can include reasoning tokens. Model discovery retains
advertised context windows, supported reasoning efforts and output token parameter names.
Unknown endpoints can reject an effort they do not support; selecting Endpoint default
leaves the choice to that endpoint. A manually configured model ID does not require discovery.

Ask before tools is the default. Accept file edits permits reads and writes inside the
workspace, checking real filesystem paths; other actions still ask. Read only offers read
tools and rejects write tools even if the model requests one. Don't ask permits workspace
reads and exact host MCP grants, and denies actions that would ask. Bypass explicitly permits
available tools without approval. These modes are application policies, not OS sandboxes.
MCP read-only annotations control availability in Read only; they do not grant permission.

Configuration changes made during a turn apply to the next turn. The admitted turn and its
pending approvals retain their original settings. Desired settings persist through restart.
Reasoning text and signed or encrypted reasoning details remain in model history across
tool calls and recovery, with opaque chunks preserved in wire order. Each conversation also
retains a stable prompt cache key. These fields travel only within the encrypted application
channel and model requests, leaving Paseo relay identity unchanged.

## Context compaction

`/compact [summary focus]` summarizes older model context while retaining the full transcript
and recent context. Automatic compaction defaults to an estimated 80% of the model window;
the session control offers 50%, 60%, 70%, 80%, 90% and Off. Off leaves the manual command
available. A missing model window uses an 8192-token trigger estimate, which is never
reported as measured usage or an advertised model limit. The trigger includes the system
prompt and tool catalog. A single large prompt or tool group can still exceed an endpoint's
window; compaction cannot split an unfinished tool exchange.

The recent-context target is one quarter of the known window, capped at 20,000 estimated
tokens. Boundaries retain complete tool-call/result groups, including during a long turn.
Repeated compaction sends the previous summary and newly older context to the summarizer,
avoiding repeated processing of the full archive. Summary calls carry no tools; old images
remain references, with recorded findings preserved in the summary. Opaque reasoning
signatures remain in the archive and recent context, without being copied into summary calls.

A summary commits only after a completed, nonempty response that reduces context. Failure
or cancellation preserves the previous context. Automatic failure shows a warning and
suppresses repeated attempts until enough new context has accumulated; manual retry remains
available. Summary usage contributes to the turn's endpoint-reported token counts. Both the
summary and its archive boundary persist, so restarting does not restore the larger request
prefix or delete transcript history.

## Attachments

PNG, JPEG, GIF and WebP inputs use Chat Completions image content. Select a model that
supports images; a text-only endpoint can reject an image request. Images are stored
atomically in the host's `otto-openai-compatible/images` directory and checked by their
SHA-256 content hash when a request is built. Provider persistence contains hash references,
so image bytes are not repeated in every agent snapshot. Retain that directory alongside
the host's agent data when backing up or moving a host.

Each prompt accepts at most 20 MiB of decoded image data and 1 MiB of text. Model requests
accept at most 40 MiB of decoded image context. Invalid or changed attachments produce an
error without sending a partial request. Text attachments retain their title, source and
body; forge and review attachments retain their supplied context. Uploaded files are
represented by host path, name, MIME type and size, so the agent inspects them through an
approved host tool rather than reading arbitrary attachment paths during prompt conversion.
MCP image results use the same host storage. All tool replies in a model round precede the
corresponding image content. Pending image references persist with completed tool replies,
so recovery retains captures without rerunning a completed tool.

## Verification

Targeted provider tests exercise fragmented SSE, approvals/denials/cancellation, recovery,
failure boundaries, and exact MCP grants against local fixture endpoints. The daemon
integration test in `packages/server/src/server/otto/openai-compatible.e2e.test.ts` exercises
the compiled built-in contribution, host settings RPC, model catalog and ordinary chat.
These deterministic endpoints establish integration behavior, not compatibility with every
hosted model or a native-device UI acceptance test. CI and product builds remain required
at each phase checkpoint; retain the exact commit and run links on the rebuild charter.
