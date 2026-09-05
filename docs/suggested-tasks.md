# Suggested Tasks

Claude Desktop's **suggested background task** system, brought into Otto with the same agent-facing mechanism and nomenclature, rendered natively in the session UI and wired into Otto's own agent-creation and worktree machinery.

A chat creates a deferred suggestion by calling `suggest_task`; a **card** appears for the user in that chat; the user starts it one of four ways or dismisses it. Either way the suggesting chat's current turn continues uninterrupted. Gated behind `server_info.features.suggestedTasks`.

Because Otto injects its native tool catalog into every provider, registering the two tools once in `createOttoToolCatalog` (`packages/server/src/server/agent/tools/otto-tools.ts`) makes them available to Claude (over the injected `/mcp/agents` server) **and** to the openai-compatible provider (natively via `launchContext.ottoTools`) with zero per-provider work - the two-tool contract ships for all providers by construction.

## The agent-facing contract

Matches Claude Desktop exactly - same tool names and field names:

- **`suggest_task`** - `title` (under 60 chars, imperative verb phrase; becomes the card label and future chat title), `prompt` (self-contained initial message; **never sent to the client**, stays server-side and is used verbatim when the user starts it), `tldr` (1–2 sentence summary shown in the card), `cwd` (optional absolute path to a different project root, honoring `lockedCwd`/`allowCustomCwd` via `resolveScopedCwd`). Returns `{ task_id }`.
- **`dismiss_task`** - `task_id`, optional `reason`. Idempotent: if the task was already started or dismissed it reports that and no-ops.

The Otto name is deliberate: `suggest_task`/`dismiss_task` make the deferred lifecycle explicit. A suggestion card never starts a chat by itself.

The tools have their own **`tasks`** tool group, surfaced in Host settings as "Suggested tasks". They first shipped in the `agents` catch-all, which meant switching off task suggestions also switched off spawning chats; the split gave them their own row.

## Discovery is the whole game

Hard-won lesson: the tool was never broken or missing, yet models rarely called it. Discovery is purely via the **tool description** - there is no system-prompt preamble - and the original description opened with descriptive prose ("Suggest a follow-up task the user can start later…"). Two consequences:

1. Models matched the user's words against the **tool name**, so "spawn a task" hit while "suggest a task" missed.
2. Nothing instructed the model to call it **unprompted**, so it rarely volunteered - unlike Claude Desktop, where the same-named tool fires on its own.

The description is now written **trigger-first**: it opens with the imperative ("Suggest a task. Flag an out-of-scope issue…"), states that _noticing_ is the trigger and that the model should not wait for permission or merely mention the idea in prose, and enumerates the user phrasings that mean this tool ("suggest a task", "make that a task", "queue that up", "spin that off", "flag that for later", …). When tuning discoverability, edit the description before reaching for prompt-level guidance.

Two runtime facts also gate the feature independent of the code: the **daemon must be rebuilt and restarted** (the app half hot-reloads, the daemon half does not), and **`mcp.injectIntoAgents` must be on** (it defaults to `false`, though it is usually enabled if browser/preview/create_chat tools work).

## Auto-approval

`suggest_task`/`dismiss_task` **bypass the permission prompt in every mode, including Always-ask.** The rationale: they only draw or withdraw a card - nothing starts until the user clicks Start, so the **Start button is the gate**, not the act of suggesting. The tool call still shows in the transcript, so "see everything" visibility is preserved.

Implemented at one chokepoint per provider: an `AUTO_APPROVED_OTTO_TOOL_NAMES` early-return in `handlePermissionRequest` (`claude/agent.ts`), plus the bare names in `READ_ONLY_TOOLS` in `openai-compat-otto-tool-permissions.ts`.

## The four start modes

Only **one** links the new agent to the parent. The whole switch is the `detached` flag on the MCP `createAgentCommand` - the parent-id label is stamped iff `!detached && callerAgentId`:

| Mode                   | Shape                                                      | Parent link             |
| ---------------------- | ---------------------------------------------------------- | ----------------------- |
| `new_chat` _(default)_ | Independent chat, own tab                                  | No - `detached: true`   |
| `subagent`             | Bound child in the Subagents track, archive-cascades       | Yes - `detached: false` |
| `worktree`             | Independent chat on a new git worktree (auto `branch-off`) | No - `detached: true`   |
| `in_session`           | Steers the parent via `sendPromptToAgent`                  | n/a                     |

`callerAgentId` stays set even when detached, so the new agent still inherits the parent's cwd/workspace/brain - only the label is dropped. `notifyOnFinish` tracks `detached` (a detached chat isn't watchable via the track). A worktree _must_ have its own branch, so `branch-off` auto-creates a fresh one off HEAD; the user never picks a branch and the parent's branch is never reused.

Starting a suggested task reuses the same commands the MCP tools and the app's own create flows already use. The suggested-task panel includes the shared provider/model picker beside the start button. It offers the selected host's configured providers, including local providers, independently of the suggesting chat's provider. The source provider and model are initially selected; the user can choose another model and start directly from the panel. **New chat**, **Sub-agent**, and **Worktree** use this selection. Bulk start applies it to each task separately. **This session** queues directly into the current chat and ignores the picker.

The start request carries an optional `launch: { provider, model }`. When omitted by an older client, the daemon retains source-chat configuration. An explicit model change clears the source thinking option; a provider change also clears provider-specific modes, features, and adapter options so the ordinary create-chat pipeline resolves destination defaults. Task prompt, directory, instructions, and workspace-access constraints remain intact. Failed tasks stay pending, and the panel retains the selection for retry and displays an inline error.

The picker requires `server_info.features.suggestedTaskModelSelection`. An older host shows **Update the host to choose a model** and disables new-chat launch modes rather than ignoring the user's selection. **This session** remains available.

Start-mode labels follow the glossary - **New chat / Sub-agent / Worktree / In session** - never "checkout". The device-local `suggestedTasksDefaultMode` setting (default `new_chat`) picks the split-button primary; bulk start falls back to `new_chat` when the default is `in_session`.

## Daemon store and protocol

An in-memory `Map<taskId, SuggestedTaskEntry>` on `AgentManager`, mirroring `backgroundShellTasks` one-for-one (`spawnSuggestedTask`, `dismissSuggestedTask`, `markSuggestedTaskStarted`, `currentSuggestedTasksFor`, `emitSuggestedTaskState`), with `state ∈ pending | started | dismissed`.

The emitted list carries only **`pending`** tasks - resolved entries stay in the map purely so dismiss/start remain idempotent and can report "already acted on," and are dropped from the wire so the card disappears on resolution. Same rule `currentBackgroundShellTasksFor` uses. In-memory only, cleared on daemon restart: cards are inherently ephemeral "act on it now" affordances (Claude Desktop's are session-scoped too). Persistence is deferred, not a requirement.

`SuggestedTaskInfoSchema` omits `prompt` entirely - it is never sent to the client. `suggested_tasks_changed` is a full-list reconciliation push, mirroring the `BackgroundShellTask*` block.

Every successful chat timeline fetch also sends the current pending suggestions to the requesting socket. This hydrates the card after a page refresh or reconnect without waiting for another task mutation. The snapshot is read after timeline loading and includes empty lists, so tasks resolved while disconnected disappear from the client too. This survives client refreshes while the daemon remains running; daemon-restart persistence remains deferred.

## The card

The compact model trigger uses the same filled `SplitButton` and `SplitButtonPrimary` primitives as the start control, inheriting its border, focus, hover, and pressed states. Only text/icon size and layout are specific to the compact variant. The picker has a bounded width independent of the model name, which truncates with an ellipsis. Its desktop popup has an independent 360px minimum width, bounded by the viewport. Task rows place the start action at the top right beside the wrapping title; the description spans the full content width underneath.

The collapsed header uses one row when the summary, model picker, and start controls fit. The measured header width moves the two controls onto a second row below 440px, while dismiss stays at the top right beside the summary. This panel alone uses the compact filled model-picker variant with `fontSize.xs`, matching the start button's text size while retaining normal weight, and `xs` provider and chevron icons. Other model-picker instances keep their standard sizing. The bounded task list uses the shared auto-hiding scrollbar on web and the native scroll indicator on mobile platforms. The thumb appears while scrolling and fades when idle.

Top-anchored over the stream (bottom-anchoring hid the text being read), with a title-bar X that dismisses the whole visible queue and a per-row split button. The primary half starts in the user's default mode; the caret opens the other modes plus a destructive **Dismiss**. The provider/model picker sits directly beside the primary start control, including when task details are collapsed. A header "Start all" split button appears when 2+ are queued (`in_session` excluded from bulk).

The card takes the **info tone** - a `statusInfo` ring around a `statusInfoSurface`-washed header and body - rather than the theme accent. Deliberate: accent is the CTA colour and already paints the Start button inside the card, so an accent wash would read as more of the same chrome; and on monochrome variants (Graphite, Midnight) `accentBright` is near-white, so an "accent tint" would carry no hue at all. Blue reads as _suggestion_ in every variant. Documented in [design.md](design.md) §12.

Because the card floats over the conversation, the wash sits on the children over an opaque `surface2` base - washing the card itself would let chat text show through. Layering is claimed from `CHAT_PANE_OVERLAY_Z` (`packages/app/src/constants/layout.ts`), which states the stacking order for conversation overlays; the card holds `suggestedTasks: 30`. Any later overlay that floats over the stream should read its slot from that map rather than picking a number.
