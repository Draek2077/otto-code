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
Every native tool requires approval. Shell commands have a deadline and use the plugin
SDK's process termination helper; process-tree termination guarantees follow that helper's
platform behavior. Denied tools produce feedback without execution. Cancellation aborts
model requests and pending permission waits, and interrupts the active tool.

The provider consumes daemon-injected stdio, Streamable HTTP and legacy SSE MCP servers. It preserves server
instructions, tool descriptions and input schemas. Only an exact daemon-supplied server
and tool preapproval bypasses the permission prompt. Model-visible names are stable hashes;
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

The provider supports one endpoint, text prompts, native file/shell tools, MCP over all three standard transports,
streaming, approval, cancellation and recovery of its own new sessions. It does not yet
implement images, other attachment types, multiple endpoint
profiles, credential entry, compaction, rewind, live session configuration, or importing
Otto 0.9 provider sessions/settings. Older data remains preserved by the continuity layer;
preservation does not imply those sessions can resume through this new provider.

The full OpenAI-compatible feature family remains in progress. Brain is a separate phase.

## Verification

Targeted provider tests exercise fragmented SSE, approvals/denials/cancellation, recovery,
failure boundaries, and exact MCP grants against local fixture endpoints. The daemon
integration test in `packages/server/src/server/otto/openai-compatible.e2e.test.ts` exercises
the compiled built-in contribution, host settings RPC, model catalog and ordinary chat.
These deterministic endpoints establish integration behavior, not compatibility with every
hosted model or a native-device UI acceptance test. CI and product builds remain required
at each phase checkpoint; retain the exact commit and run links on the rebuild charter.
