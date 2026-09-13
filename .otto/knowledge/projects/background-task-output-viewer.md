---
id: "background-task-output-viewer"
kind: "project"
title: "Background task output viewer"
status: "proposed"
tags: ["background-tasks","terminal","output","providers","read-only"]
delivery_status: "charter"
progress_completed: 0
progress_total: 6
progress_unit: "milestones"
created_at: "2026-09-13T04:28:20.115Z"
updated_at: "2026-09-13T04:28:20.115Z"
---
# Background task output viewer

<!-- compiled_truth -->

# Background task output viewer

## Outcome

Every Background Tasks track row offers a View output eye icon that opens or focuses a read-only, terminal-style output tab in the task's owning workspace. Users can inspect captured output while a task runs and after it settles without asking the AI to read or summarize it.

**The viewer is always read-only.** It never accepts process input, sends keystrokes or terminal control responses, attaches an interactive shell, or offers an interactive mode. Selection, copying, searching, and scrolling are viewing operations and remain available.

## Authority and current baseline

The user requested a View icon and a terminal-style tab comparable to Scripts and Git logs, then explicitly decided: "Read only always" and requested this charter. This is a planning deliverable; implementation has not started.

Source inspection in this conversation found:

- `docs/chat-lifecycle.md`, Background Tasks track: background tasks are lightweight status projections, separate from Agent records. Existing actions are Stop and Clear.
- `packages/protocol/src/agent-types.ts`, `BackgroundShellTaskUpdate`: updates carry identity, description, status, and related metadata, with no output stream or terminal attachment.
- `packages/server/src/server/agent/providers/claude/agent.ts`, `appendBackgroundShellTaskEvent` and `appendTaskNotificationEvents`: the shell-task projection does not retain the notification's output-file path.
- Claude task notifications can carry an `output_file`; this is a candidate output source, not proof of live capture completeness or availability for every task type.
- `docs/scripts.md` and `docs/service-proxy.md`: Scripts already own real terminals. `packages/app/src/git/open-git-log-tab.ts` provides the open-or-focus workspace log-tab precedent.

These are source-level observations, not runtime verification. A tracked task is not evidence that its full output is available.

## User experience

- Add View output beside the existing Stop/Clear action, following shared icon, tooltip, hover, keyboard, and compact-layout conventions.
- Open the viewer in the same workspace and window. Key tab identity by host, workspace, owning chat, and task so repeated clicks focus the existing tab and unrelated tasks never collide.
- Reuse the established tab shell and terminal/log rendering components where suitable. Do not create a new shell process to display text.
- Show the task label, lifecycle, capture state, and available completion details. Display an exact command or exit code only when the provider supplies it; a progress summary must not masquerade as an exact command.
- Load retained output before following new output. Follow while the reader is at the bottom; scrolling away holds their position. Provide an explicit return-to-latest action.
- Keep settled output readable. Closing or reopening the viewer never starts, restarts, interrupts, or stops the task.
- Keep process control in the existing task controls. The viewer adds no control channel.
- Clearing or auto-clearing a track row must not unexpectedly close an already-open viewer or erase its displayed output. Define reopening and retention boundaries explicitly during delivery.
- Present concise, distinct states for loading, no output yet, unavailable capture, lost connection, expired output, and truncated history. Never substitute a blank pane or invented output for an unavailable source.

## Output contract

Build one provider-neutral daemon contract with provider adapters supplying trusted task-output sources.

- Support captured stdout and stderr, preserving observed ordering and stream identity when the source actually supplies them. Do not invent ordering or separation from an already merged log.
- Prefer original capture or task-owned output files over the shortened tool response sent to the model. Output omitted from model context may still be available to the viewer.
- A command redirecting output to a file is viewable only when that file is reliably associated with the task. Do not guess paths from arbitrary shell text or tail unrelated workspace files.
- Output discarded through `/dev/null`, `NUL`, equivalent redirection, or a quiet command cannot be recovered. Buffered output may arrive late. Generic missing capture must not be labeled as deliberate suppression without evidence.
- Use a retained initial read plus incremental updates with offsets or sequence identifiers. Handle overlap, reconnect, file truncation/rotation, completion, and disappearing files without duplicated output or silent gaps.
- Bound retained bytes, replay size, transport queues, watcher count, and client rendering work. Read historical output in bounded chunks and disclose truncation. Choose and document concrete limits before implementation acceptance.
- Subscribe on demand and release subscriptions when the viewer no longer needs them. Any capture that must begin at launch must be independently bounded and justified by the provider's retention behavior.
- Viewing output does not invoke a model and does not inject log contents into chat context.

## Provider and host boundaries

Inventory every supported agent provider and every background-task path, including non-shell monitor tasks where applicable. Record task discovery, output source, live streaming, settled replay, retention, and verified gaps for each.

The client and protocol remain provider-neutral. A Claude adapter is an initial proof, not completion of the project. Extend adapters where output can be exposed; otherwise report the specific limitation honestly and keep the delivery gap visible. Do not silently omit unsupported providers or claim universal capture.

The daemon resolves a task-owned source from authenticated task identity. A client cannot nominate an arbitrary output-file path. Preserve ownership checks across chats, workspaces, remote hosts, and file replacement. Render output as untrusted content through the established safe display path; output must never cause command execution or automatic terminal replies.

Use additive optional wire fields and dotted request/response namespaces. Gate the new feature once through `server_info.features.*`, with the repository-required COMPAT version and cleanup information. An old host shows the standard update-host state; do not emulate missing capture through legacy RPCs.

## Delivery plan

| Milestone | Deliverable | Completion evidence |
| --- | --- | --- |
| 1. Capture audit | Provider/task matrix; verified live and settled sources; proposed storage, expiry, restart behavior, and numeric resource limits | Controlled emitting tasks and source references for every supported provider; explicit gaps |
| 2. Daemon output service | Task-source binding, bounded reads and incremental subscriptions, lifecycle cleanup, ownership enforcement | Focused tests for ordering, replay, reconnect, truncation, rotation, missing files, and cross-task access |
| 3. Provider adapters | Each provider maps task identities and available capture onto the shared service | Controlled stdout/stderr, quiet, redirected, failed, and completed task evidence per provider |
| 4. Viewer and track action | Eye icon, open-or-focus tab, read-only rendering, reader-owned scroll, search/copy, capture states | Focused app checks and browser/native checks appropriate to the supported surfaces |
| 5. Lifecycle and compatibility | Clear/auto-clear, close/reopen, reconnect, expiry, old-host behavior, and bounded high-volume operation | No task interruption from viewing; no duplicate/lost retained output; explicit loss boundaries and resource measurements |
| 6. Documentation and acceptance | Official docs, glossary, test coverage matrix, and reconciled delivery inventory | Targeted tests, typecheck, lint, and controlled end-to-end evidence; remaining limitations stated |

## Acceptance criteria

1. A task producing periodic output can be opened during execution, followed live, searched, copied, and inspected after completion without an AI round trip.
2. Reopening View output focuses the same task tab, including when tasks share labels across chats or hosts.
3. Keyboard input, paste, terminal escape responses, and viewer resizing never write to or control the process. Read-only cannot be disabled.
4. Closing the tab and clearing track rows do not stop the process. An already-open completed viewer survives row clearing.
5. Scrolling away from the bottom preserves the reader's position while output continues; follow can be resumed explicitly.
6. Empty, unavailable, expired, truncated, and disconnected captures are distinguishable. Quiet or discarded output is never fabricated.
7. Initial replay and subsequent updates remain ordered and deduplicated across reconnect, with explicit disclosure where retained history is incomplete.
8. Large or long-running output stays within documented memory, storage, transport, and rendering limits.
9. Provider coverage is evidenced individually. Unsupported output paths remain named gaps rather than being counted as delivered.
10. Runtime proof uses isolated development tasks and Otto's existing verification tools. Do not restart the installed daemon or run the full local test suite for this effort.

## Non-goals

Interactive terminals, stdin forwarding, command reruns, task migration into Otto-owned shells, reconstructing discarded output, automatic AI summaries, indefinite log archival, and redesigning Scripts or Git logs.

## Decisions to resolve during the capture audit

Determine the supported retention period and byte limits; whether any provider requires launch-time capture; behavior after daemon restart and provider cleanup; and whether a cleared task can be reopened after its viewer closes. These remain explicit planning questions, not implied durability promises.

## Related work

- [[observed-subagents]]: adjacent provider observation and lifecycle machinery; shell tasks remain separate from AI subagent transcripts.
- [[e2e-qa-coverage]]: coverage ownership and controlled runtime proof.
- [[upstream-mergeability-through-otto-owned-seams]]: keep the addition in clear Otto-owned integration points.

## Timeline

- time: "2026-09-13T04:28:20.115Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-09-13T04:28:20.115Z"
  kind: "evidence"
  summary: "User conversation: requested a View icon on background tasks opening a terminal-style tab, accepted the approach, explicitly required 'Read only always', and asked to plan it in a charter. Source inspection in this conversation covered docs/chat-lifecycle.md, docs/scripts.md, docs/service-proxy.md, packages/protocol/src/agent-types.ts, packages/server/src/server/agent/providers/claude/agent.ts, packages/server/src/server/agent/providers/claude/task-notification-tool-call.ts, and packages/app/src/git/open-git-log-tab.ts. Existing active and draft Knowledge catalog reviewed; no dedicated background-task output viewer charter found. Findings are source-level only; no capture runtime test or implementation completed."
