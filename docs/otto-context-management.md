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

Desktop uses the existing Paseo pointer/touch splitters for reading width and
summary-versus-tree height. Both are app-local user preferences under
`otto-context-layout`, not host/project settings. The old `panel-state`
`contextSidebarWidth` seeds the width when the new preference is absent; its bytes
and unrelated fields are never rewritten by Context. Newer/invalid layout data is
preserved and disclosed instead of reset. Narrow or hidden geometry only clamps
the displayed width; compact drill-down never overwrites the desktop preference.

## Ownership

A workspace without loaded project instructions offers Set up your project
context in the existing detail pane. Host-wide instructions and project
references do not hide setup. Selecting a host source retains the hidden starter
draft. Load repository context explicitly, choose `AGENTS.md` or `CLAUDE.md`, and
optionally generate a starter using the normal preferred-model picker. The host
reads only bounded root filenames and a README excerpt; it does not recursively
scan code, read environment files or launch a writable generation session.
Review and edit the local Markdown draft, then confirm Create instruction file.
Generating never writes it. A changed repository snapshot or existing target
refuses creation. Publication uses a synced staging file and exclusive hard-link
creation, so even a racing external writer's existing file is never replaced.
Failures retain the draft and require explicit refresh/review before another
write. Initial setup requires the separate `ottoContextStarter` host capability.

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
the same implementation. Native Claude, Codex and OpenCode also have a separate,
read-only convention inventory. Configured aliases use their declared native
family; other providers without an inspection contract remain opaque.

Older apps retain the existing Knowledge bridge and skip the new contributions
when its optional context components are absent. New apps check the optional
`server_info.features.ottoContextManagement` capability once at the entry point.
An older host gets an update-host message; there is no legacy emulation.

## Input and cost honesty

The composer's existing Paseo pill bar shows Context when fixed input reaches
25% of a provider-reported model window, or a required instruction is blocked.
The percentage uses live usage metadata or that exact model's host catalog
metadata, never the Context page's what-if window. Unknown windows have no
percentage warning. Context reports are shared through the normal query cache;
only visible, connected, retained-active composers request them. Hidden or
disabled warnings stop scheduled reads. Convention estimates and unavailable
provider inputs remain labeled; chat history is excluded.

The pill's Manage context action opens the registered workspace panel. Mute
applies across chats in that host/workspace for eight hours in the current app
session. A severity change or a new five-percentage-point size band breaks the
mute immediately. Mutes retain at most 256 workspace identities and no prompt
text. Context Management's Composer context warnings switch persists only the
device-local enabled preference, preserving unknown fields and the original 0.9
choice. Corrupt or newer preference bytes disable writes until explicit reload;
save failures retain the previously accepted preference and expose recovery.

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

### Native provider inventory

Selecting a native chat inspects its owning working directory and provider
configuration without launching or resuming it. Existing session discovery paths
take precedence over current provider settings and inherited host paths. Only
the known discovery path/flag fields cross this adapter; credentials and raw
configuration never enter the report. Invalid settings produce a sanitized
partial-inventory notice, without changing the file or claiming a complete zero.

The picker projects both the canonical live manager and persisted chat registry.
Live metadata wins once per chat; archived and internal chats are excluded at
the workspace boundary. A closed chat is never resumed for inspection. Its
native convention inventory explicitly uses current host/provider settings,
without reconstructing a historical launch environment or prepared request.

The discovery plans follow [Claude memory conventions](https://code.claude.com/docs/en/memory),
[Codex AGENTS discovery](https://learn.chatgpt.com/docs/agent-configuration/agents-md),
[Codex skill discovery](https://learn.chatgpt.com/docs/build-skills), and
[OpenCode V2 instructions](https://opencode.ai/v2/docs/instructions). They are
convention estimates, not observed native requests. Installed CLI versions,
managed policy, approval state, bundled input and skill advertising budgets can
change what a provider actually sends.

Claude startup instructions, local overrides, AGENTS fallback/combined modes,
memory indexes and rules are distinguished from deeper or path-scoped rules.
The memory index contributes at most its first 200 lines or 25 KB. Skills and
subagents contribute descriptor metadata, not implementation bodies. Enabled
plugin rosters use recorded installation identities and project scope rather
than guessing a cache version. Codex uses one first-nonempty instruction per
directory, override/fallback priority and its configured combined byte cap.
OpenCode V2 uses its nearest-first AGENTS chain and configured instruction
patterns; it does not borrow V1's CLAUDE fallback.

Each inventory bounds file reads, directory visits, sources and dependencies.
Recursive discovery skips generated/vendor directories and directory links;
explicit skill aliases can resolve to their recorded descriptor. Remote
instruction URLs are not fetched. External imports outside the selected
project/provider roots are reported for provider approval rather than silently
read. Conditional and referenced sources do not increase fixed weight. Native
category previews contain exactly the text used for their displayed estimate;
source previews remain separate, on-demand reads. Unsupported native import
rewrites are disabled and rejected by the owning host.

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

## Issues and reviewed fixes

The Context and Issues views share one page-level write authority. A scheduled
report refresh does not grant new write authority after a conflict, an uncertain
reply, or a completed edit. Explicit Refresh context reads canonical state and
opens a fresh review. Write feedback remains outside the independently scrolling
panes, including when its originating row disappears.

Typed findings identify missing imports/references, cycles, depth limits, repeated
prose within a file or across global/project scopes, and oversized memory entries.
Each finding carries a source revision and UTF-16 range with owning line numbers.
At most 256 findings are returned. Only known missing targets and exact repeated
prose in editable project sources qualify for mechanical removal. Unavailable,
excluded, outside-boundary or depth-limited targets never become dead imports.
Code examples, case-only similarities, cycles and memory restructuring require
manual review. Global copies survive cross-scope deduplication.

Fix all pins the reviewed report and finding IDs behind an explicit confirmation.
The daemon recomputes the plan; it accepts no client paths or deletion spans.
The common atomic source writer applies one revision-pinned edit per owning file,
preserving unrelated bytes and line endings. Multi-file results name changed,
unchanged, conflicted and unavailable outcomes individually. A partial operation
does not roll back successful files or retry failed writes. Locks belong to their
writers and are never stolen.

When a hard import is missing, inspection returns bounded available text with
an explicit blocked-runtime notice. This diagnostic mode does not admit a native
write or relax the actual harness: request preparation and file-tool preparation
still fail until required instructions can be loaded. A captured request remains
a separate historical view.

## Current source editing

Prompt preview and Current source are separate views. The editor always reads
current bytes from a fresh host-owned graph nomination, even when the prompt
preview shows a previously captured request. The client submits a source ID,
originating file revision and exact reviewed text, never a filesystem path.
Save is explicit. Host-wide instruction files require a confirmation that names
their effect on other projects, in addition to ordinary write approval.

The editor uses the same bounded UTF-8 reader and atomic source writer as
load-mode changes and mechanical fixes. Ordinary files with multiple links are
read-only; missing, foreign and vanished graph entries cannot become arbitrary
writes. Exact bytes and line endings are preserved. Existing requests and chat
history remain untouched. A successful response acknowledges only that operation,
not future external changes to the file.

Workspace-local drafts survive source selection, prompt/source view changes,
compact back navigation and scheduled metadata reads. Dirty drafts retain their
originating revision across hidden activations. Reload explicitly confirms draft
discard, and read failure retains the draft. Hidden confirmations cannot dispatch
a write; hidden acknowledgments cannot clear drafts or adopt a new revision.
The shared page write lane still requires a fresh explicit context review after
an edit or conflict. Clean sources refresh on reactivation. Closing the workspace
view discards its local editor instances; no prompt/draft copy is persisted.

Inspect issue opens Current source and selects the finding's line range only when
the current file still matches the finding's revision. A changed file displays a
notice instead of selecting an obsolete range. Source editing does not implicitly
generate or rewrite a document. AI compaction is a separate reviewed operation;
starter-file generation is a separate action.

## Reviewed prose compaction

Select a source and choose Compact with AI. The review nominates one to twelve
rewritable prose files and a bounded set of read-only references from the current
host-owned graph. Only instruction/prose extensions pass the shared Refine scope
gate. References are complete files selected smallest-first, with twelve files
and 60 KB combined as hard bounds; unavailable or omitted candidates are disclosed.
Document and reference input is capped at 120,000 characters. Host paths never
come from the browser.

The default instructions preserve every distinct rule, fact, heading and link.
The preferred-model picker uses the canonical host catalog. OpenAI Compatible API,
Brain and their aliases expose a provider-owned text-only generation operation.
It reuses the owning endpoint, credentials and transport without constructing a
chat, instruction resolver, native tool executor, MCP client or session archive.
Requests contain no tool definitions; returned tool calls are rejected. Explicit
model selection never falls through to a different provider.

Native Claude, Codex, Copilot, OpenCode, Pi and OMP use fresh provider-owned utility
sessions with enforced restrictions, outside the normal chat manager. Claude has
an empty tool/MCP catalog and disabled hooks; Codex requires an acknowledged
read-only sandbox and disables discovered MCP servers; OpenCode denies tools at
session creation. Pi and OMP launch without tools, executable extensions or
skills. Copilot uses the native SDK stdio protocol with an explicit empty tool
allowlist and denied permission/tool requests. Its one temporary native session
is removed afterward; existing native chats are never enumerated or changed.
Configured aliases retain the owning command, environment and selected model.
Unrecognized native execution contracts fail visibly rather than running an
ordinary writable chat. Utility output and time are bounded, and provider stderr
is never included in recovery messages. These restrictions concern proposal
generation only; ordinary chat compaction and provider sessions are unchanged.

Generating a proposal writes nothing. Every hunk starts dropped. Keep/Drop changes
the local kept result, with original and kept text side by side on wide screens
and stacked on compact screens. Review kept result makes that result the next
working draft for an iterative proposal without adopting a new canonical revision.
Readonly references retain their pinned revisions and cannot become output files.

Apply kept changes requires explicit confirmation, including named host-wide
effects when relevant. The daemon checks every nominated source and origin digest
before the first write, then uses the shared atomic writer once per changed file.
Per-file outcomes disclose partial success without rollback or retry. Any dispatched
apply requires explicit Load selected files before another apply; a late hidden
reply cannot grant new write authority. Reload confirms discarding the local review.
Provider failures leave the draft intact and show bounded recovery copy without
credentials or raw process diagnostics. Character counts are input-size evidence,
not billed token measurements or a guarantee of model quality.

## Proof boundary

Collocated fixtures exercise the shared resolver, import/reference accounting,
source boundaries, atomic revision checks and local confirmation authority.
The existing real harness fixture compares the captured system text with its
request and proves that inspection does not admit a native write. The rendered
wide/compact journey is `packages/app/e2e/browser/otto-context-management.spec.ts`.
Source registration and pure fixtures alone do not establish browser, native,
live-provider or complete F05 acceptance. Deferred personalities, teams and the
general File Editor are not restored by this feature.

The native generation policy, session lifecycle and Copilot SDK protocol have
focused injected-adapter fixtures. They do not establish a live CLI/model run or
support for arbitrary third-party ACP clients without a read-only contract.
