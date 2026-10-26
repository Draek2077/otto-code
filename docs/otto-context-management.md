# Context Management

Context Management inspects the fixed context carried by a workspace's agent.
It is separate from conversation usage, billing, and Knowledge record management.
Open it from the workspace action menu, Command Center, or the registered sidebar
screen. The global screen requires an explicit workspace on the selected host.
The page uses Paseo controls and gutters, with the original summary, dependency
tree and source/prompt inspection arrangement. Compact layouts drill into the
selected preview and provide Back to context. Desktop source and preview columns
scroll independently, so selecting a source far down the graph keeps its preview
visible in the other column.

## Ownership

The implementation lives in Otto-owned modules:

| Boundary                                     | Owner                                                                            |
| -------------------------------------------- | -------------------------------------------------------------------------------- |
| Structural RPC contracts                     | `packages/plugin/src/otto/context-management.ts`                                 |
| Instruction resolution and dependency parser | `packages/plugin/src/otto/openai/server/instructions.ts`, `instruction-graph.ts` |
| Prepared request snapshot                    | The provider session and `context-inspection.ts` in the same harness             |
| Workspace, chat and file authority           | `packages/server/src/server/otto/context-management/`                            |
| Forms, visibility and presentation           | `packages/app/src/otto/context-management/`                                      |
| Contributions                                | The existing `otto-project-knowledge` built-in                                   |

Paseo files contain marked registration and routing seams. There is no second
agent store, provider loop, browser socket, or credential system. The host checks
workspace and agent ownership before reading context; clients cannot supply a
filesystem path. A plugin can contribute the structural inspection method for
its registered provider. Discovery checks that method rather than guessing from
a provider ID. The OpenAI-compatible harness, Brain and preserved aliases use
the same implementation. Providers without that contract remain opaque.

Older apps retain the existing Knowledge bridge and skip the new contributions
when its optional context components are absent. New apps check the optional
`server_info.features.ottoContextManagement` capability once at the entry point.
An older host gets an update-host message; there is no legacy emulation.

## Input and cost honesty

Current Otto instructions is a prospective scan from the runtime's exact
instruction resolver. It launches nothing and has not been sent to a model.
Selecting a chat instead reads that provider session's last prepared request.
The snapshot distinguishes prepared from completed transport. Neither state
asserts that a particular model followed the instructions. A snapshot can be
absent before a normal turn, after session teardown, for an opaque provider, or
when the combined system text/tool schemas exceed the 512 KiB inspection bound.
Inspection never starts or resumes the chat to obtain a snapshot.

The six original categories remain visible: instruction files, memory index,
skills roster, tool schemas, Otto input and system text. Exact prepared native
and MCP tool schemas are reported together. Remaining system text contains
daemon/Knowledge/MCP instructions and is counted once. A separate Otto-input
number is not invented from that combined text. Provider-native memory, skills,
hidden presets and other unavailable inputs show Not visible instead of zero.

Exact text does not mean exact tokenizer output. All numeric token estimates use
characters divided by four, rounded up. The evaluation window is an explicit
viewing choice; it does not change the model's settings. Working room subtracts
only measured fixed weight, and explicitly excludes unknown inputs and chat
history. Severity starts at 10%, 25% and 50% of the selected window.

## Dependencies and source changes

Literal `@file.md` imports are loaded by the same parser the graph uses. Markdown
links are references, not loaded weight. Fenced examples and inline code do not
create imports. Each runtime-resolved file is counted once, even when multiple
parents import it. Missing or outside-boundary references and import cycles are
reported. Conditional rules appear after the harness encounters their directory;
the prospective view does not claim to crawl every deeper directory.

Full source/category previews are pulled only when selected. Referenced bodies
are not read during the graph scan; bounded filesystem identity metadata makes
external changes invalidate their previews without adding fixed prompt weight.
The existing fetch-query cache shares active reads and checks context every ten
seconds while the surface is visible. Hidden and retained-inactive views stop
scheduled reads. There is no recursive project watcher or background startup scan.
Deleted selected sources clear the selection visibly.

Change load mode requires explicit confirmation and the reviewed graph/source
digests. The host resolves the source from the graph, refuses global/foreign,
missing, symbolic or multiply linked targets, acquires its own sibling edit lock,
and stages one single-span replacement. Other text and line endings survive.
It checks the source digest again before atomic replacement. External editors do
not share the lock, so the final compare-to-rename interval remains a filesystem
limit. Cleanup preserves operation and cleanup errors and never steals a lock.

Edits affect future instruction reads. Other imports can still load the same
target, existing providers may retain their earlier input, and conversation
history is never rewritten. A local action controller serializes clicks,
invalidates hidden confirmations and refuses to acknowledge a hidden write into
a later activation. Conflict or uncertain writes remain blocked until the user
explicitly refreshes and reviews canonical context. No automatic retry, revision
adoption, native provider reset, or model launch is used.

## Proof boundary

Collocated fixtures exercise the shared resolver, import/reference accounting,
source boundaries, atomic revision checks and local confirmation authority.
The existing real harness fixture compares the captured system text with its
request and proves that inspection does not admit a native write. The rendered
wide/compact journey is `packages/app/e2e/browser/otto-context-management.spec.ts`.
Source registration and pure fixtures alone do not establish browser, native,
live-provider or complete F05 acceptance. Deferred personalities, teams and the
general File Editor are not restored by this feature.
