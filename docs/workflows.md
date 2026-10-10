# Workflows

Workflows coordinate project work as an inspectable, durable run. They are not a
replacement for a Kanban backlog: a board owns task state, while a Workflow
drives selected work through research, implementation, review, verification,
approval, or delivery.

Otto has two deliberately different execution models.

| Model              | What the user supplies                                              | What runs                                                                   | What the visualizer shows                                           |
| ------------------ | ------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **AI Workflow**    | A task, project/workspace, orchestrator seat, and execution options | An orchestrator chat declares the useful phases through Otto tools          | The agents and phases actually declared and run. It is not a graph. |
| **Graph Workflow** | A saved Graph and its declared inputs                               | The daemon executes the selected nodes, conditions, checks, gates, and caps | The declared Graph plus the run's actual node state and outputs.    |

Only Graph Workflows have a visual graph editor. An AI Workflow is intentionally
prompt-and-options based. It may decide that a known Graph is the right way to
do work, but that is an explicit future product action, not a hidden conversion
from an AI Workflow into a Graph.

## Availability

Workflows are a 0.9 in-progress surface. The durable AI and Graph lifecycle has
targeted proof, but the **New Workflow** entry and Graph editor are currently
restricted to development builds and a host that advertises the required Graph
and start-confirmation capabilities. A released app must not expose a partial
creation path or substitute an older daemon path. It keeps the existing
Workflow history surface instead. The CLI boundary below is available
independently of that app-preview gate.

## Starting a Workflow

In a development build with a compatible host, open **Workflows**, choose **New
Workflow**, select the project and workspace, then choose its kind.

- For an **AI Workflow**, provide the task and select an orchestrator profile or
  model. Otto writes a durable **Planning** record before the orchestrator's
  first turn. The orchestrator must use `start_workflow` to declare its plan.
  The record stays in Planning while its chat is alive, so an orchestrator that
  asks a clarifying question first can still declare on a later turn. If the
  chat is archived, or the daemon restarts, before a plan is declared, the same
  record fails with a direct reason.
- For a **Graph Workflow**, select or author a Graph, provide its declared
  inputs, validate it, and run the saved definition. The run uses a frozen
  definition snapshot, so a later Graph edit cannot rewrite history.

Both forms are scoped to the selected project and workspace. The required active
team role must be available for each AI-declared phase. Missing roles, an
unavailable profile or model, unsupported workspace authority, and unsupported
daemon capabilities fail the run visibly rather than silently selecting another
provider or permission level.

Every child an AI Workflow spawns runs **unattended**: the engine is what waits on
it, so there is no one to answer a tool prompt, and a gate phase is the run's
only human checkpoint. A profile's attended mode is coerced to its provider's
safe unattended mode at spawn, and any escalation the provider still raises is
denied by the daemon's deny-responder rather than left hanging. The rules are in
[safe-unattended.md](safe-unattended.md). Choose team profiles for Workflow
roles with that in mind: a Claude coder lands in `dontAsk` (or `auto` where the
model supports it), so anything it must do has to be pre-approved or safe.

### Phase modes: bounded and iterative

A judged AI-declared phase has a `mode` that decides what happens to a candidate
the judge did not pass.

- **Bounded** (the default) judges each candidate once. With `keepBest`, a
  failed candidate is replaced by a fresh agent that receives the task plus the
  previous round's feedback (the failed attempt's report, the judge's summary,
  and the unmet criteria with their evidence). Replacement is for read-only
  work only; see below.
- **Iterative** continues a failed candidate's own chat with the judge's unmet
  criteria, so it carries on from where it stopped and keeps the context it
  already built. The judge grades again after each continuation. This is the
  shape for open-ended work one session cannot finish (inventory a platform,
  plan a whole project) and the only way to send work that edits files back.
  An iterative phase requires a `judge`; verify and gate phases cannot iterate.

Both modes stop when enough candidates pass or the daemon's loop cap trips. The
cap counts judged rounds, the first one included, so the default of three means
one attempt plus two continuations or replacements. The judge always grades
against the declared task, never against a round's feedback. A host that cannot
continue chats fails an iterative phase and says so, rather than quietly running
it as bounded.

### Work that edits files is never redone

Every chat a Workflow spawns works in the same checkout, and nothing reverts a
failed attempt. A replacement or a retry would start over on files the failed
attempt already changed, and parallel candidates would edit the same files at
once, so "keep the best" could not discard the others. Work that edits files
may therefore only be **fixed forward**: one candidate, sent back to its own
chat with the judge's feedback.

- **AI-declared plans.** A phase edits the workspace when its type is
  `implement`, `refactor` or `deliver`, or a coder fills it (plan phases declare
  no access level, so this is classed by intent). Such a phase may not declare
  `fanOut` above 1, or `keepBest` outside iterative mode, or `keepBest` above 1
  at all. `buildRunFromPlan` refuses the plan before anything spawns, and
  `start_workflow` returns the reason to the orchestrator. Research, plan,
  design and verify phases fan out and replace freely.
- **Graph Workflows.** A node whose workspace access is `write` (the default)
  may not declare a retry above one attempt (`validateGraphNodeRetry` in
  `packages/protocol/src/workflow.ts`). A loop stays allowed: each iteration is
  told what the previous one produced and fixes it forward. Saving never
  blocks; Run, daemon execution, `otto workflow graph validate`, and Graph
  import refuse.

The rule lives in the protocol (`describeUnsafeEditingPhase`,
`runPhaseEditsWorkspace`), so the designer and the daemon apply the same
contract. Allowing fan-out and replacement again for editing work needs each
attempt in its own worktree, tracked as the Workflow attempt isolation project
in Otto Knowledge.

### Start confirmation and agent limits

Workflow start posture reports factual, daemon-known work rather than inventing
a provider price estimate. A Graph form shows its initial Agent count and any
fan-out points before launch. The count includes its known Orchestrator root.
At four planned Agents, the daemon returns the Graph's count, fan-out shape,
node count, and worker-Agent cap for explicit confirmation. The follow-up launch
must carry the daemon-issued review token for that exact request; changing the
Graph, its inputs, workspace, or seat requires another review.

An AI Workflow has no truthful initial count while it is **Planning**. Once its
orchestrator declares a plan through `start_workflow`, the same persisted
Workflow pauses at **Awaiting confirmation** before it starts any declared child
Agents. The card shows the declared child-Agent count, planned fan-out points,
phase count, and daemon cap. **Start workflow** executes that unchanged plan;
**Reject** cancels the Workflow without starting its children. A declared plan
that exceeds the daemon's worker-Agent cap is refused before the confirmation
card is created.

Start confirmation is separate from an ordinary attended gate. Approving it
does not approve a plan gate, change an Agent's permission mode, or enable
unattended execution. Autopilot and safe-unattended rules remain the rules of
the declared Workflow after it starts.

## Controls, outcomes, and recovery

A Workflow run is persisted and remains available from the Workflows library.
The library shows planning, active work, approval waits, completion, failure, or
cancellation. Its menu can open the run-scoped Visualizer for either Workflow
kind.

### How the result reaches the conductor

`start_workflow` blocks until the run ends or pauses (at most 5 minutes), and a
terminal run's result comes back in that tool result. Worker chats never report
to the conductor individually. When the call returns before the run ends (a start
confirmation, a gate, or the wait limit), the daemon queues one system message
to the conductor when the run settles, with the result. It skips that message
only when the original call delivers the result: it returned a terminal run, or
it is still waiting inside a live turn. The conductor merely being busy is not
enough. A run that finishes while the conductor works on something else is still
handed back, and queued delivery waits for that turn to end
(`startCallDeliversResult`, `workflow-start-lifecycle.ts`).

### Inspecting a run

Clicking a run opens it as a **Workflow tab** (`workflowRun`, one per run per
workspace) and takes the user to that workspace. The tab shows the run's status,
spend, conductor, summary, requirements, and each phase with the chats that ran
it. Each chat row shows the profile and model, attempts, the judge's verdict with
per-criterion evidence, the chat's final message, and its spend including its
judges. **Open chat** opens that chat beside the Workflow tab. The first one
splits to the right, and later ones join that pane.

- **Which workspace.** The run's own workspace while it is still open, because
  its chats live there. Otherwise the project's root folder workspace (not a
  worktree), matched by the run's storage project id or its project root. With
  neither open, the run has nothing to open into and the card is not pressable.
  `resolveWorkflowWorkspaceId` (`packages/app/src/workflows/open-workflow-run.ts`)
  is the single rule.
- **Workers are read-only.** Every chat a Workflow spawns carries the
  `otto.workflow-worker-run-id` label, and its composer is replaced by a note
  naming the run with **Open workflow**. That replaces the archived chat's
  Unarchive as well: a message sent to a worker lands in a turn the run is not
  waiting for and leaves the run record describing a conversation that did not
  happen. The label is separate from `otto.orchestration-run-id`, which the
  conductor carries and `start_workflow` reads to activate a pending run. The
  block is in the client only; the daemon does not refuse a prompt to a worker.
- **Judges are recorded.** A judged candidate lists the judge chat for each
  judged round in `judgeAgentIds`, so judges can be opened and their spend
  counted. Runs from daemons that predate the field show no judge links.
- **A running phase is live.** A candidate is on the phase from the moment its
  chat spawns, and the engine updates it in place at every milestone (spawned,
  sent to its judge, verdict recorded, continued), stamping the run's
  `updatedAt` each time. The phase carries the `round` it is on. Each candidate
  carries its `stage` (`working`, `judging`, `settled`) and the `verdictAt` of
  its last verdict. A continued candidate back at `working` still holds the
  previous round's verdict, and `verdictAt` dates it. This is what
  `get_workflow_status` returns, so a conductor can tell a long round from a
  stuck one without reading the worker's activity. Before this, candidates
  appeared only when their whole round ended, and `updatedAt` stayed at the
  phase's start. The emits are chained (`emitProgress`, `workflow-engine.ts`)
  because a round's candidates progress concurrently. AI-declared plans only:
  Graph runs do not publish these fields yet.
- **From the conductor.** The `start_workflow` tool call in the conductor's
  transcript has **Open workflow** in its details, so a chat that ran several
  Workflows links to each one where it started it.

- **Graph gates** are human approval boundaries. They pause without spawning an
  agent. Approving continues the declared Graph; rejecting cancels it.
- **Graph checks** are deterministic JSONata assertions. A passing check releases
  downstream nodes; a failing check fails the run with its declared message.
- **Cancellation** stops the active Workflow and cascades to its managed child
  agents where applicable. Canceled runs use a warning state, remain separate
  from failures in history filters, and keep the cancellation or gate-rejection
  reason on the run record.
- **Daemon restart recovery** never pretends in-flight work completed. A pending
  AI Workflow or active Graph Workflow becomes a durable failed record with the
  restart reason, which users can inspect before deciding what to run again.

Graph node authority, conditional routing, output fields, retry limits, timeout
behavior, EJS prompt templates, and the Graph CLI boundary are specified in
[workflow-node-capabilities.md](workflow-node-capabilities.md).

## Scheduling a saved Graph Workflow

Schedules can launch a **saved Graph Workflow** from the selected project's
Workflow store. Choose **Saved Workflow** in the Schedule form, select its
project and a saved Graph, then set the cadence. The schedule stores only the
project and definition id, not a copy of the Graph or a reconstructed prompt.

At each fire, Otto re-resolves that project's selected Workflow store and
checks the Graph's full storage provenance. Starter Graphs, legacy global
Graphs, a missing definition, another project's definition, and an unavailable
host are rejected as repairable schedule failures. Otto pauses the schedule and
retains its history with recovery guidance rather than selecting another Graph
or silently falling back to the daemon-global library.

The scheduled launch enters the ordinary Graph Workflow engine, so its declared
caps, permissions, checks, gates, cancellation, and durable Workflow history
remain in force. The Schedule run records the selected definition fingerprint
and the durable Workflow run id. Its immediate success means the Workflow was
started durably; inspect that linked Workflow for the eventual Graph outcome.
Scheduling AI Workflows and editing/re-targeting an existing saved-Workflow
schedule are not available yet.

## CLI boundary

The CLI currently supports saved Graph Workflows:

```bash
otto workflow graph ls
otto workflow graph inspect <graph-id> --json
otto workflow graph validate <file>
otto workflow graph run <graph-id> --input question="Should we ship?"
```

`validate` reads a local JSON Graph without importing or executing it. It proves
the document shape and Graph structure only: JSONata expressions, available
daemon capabilities, seats, workspace authority, and prompt-template references
are checked only before a saved Graph executes. New portable Graph documents use
`format: "otto.workflow.graph"` and `formatVersion: 1`; an unversioned Graph is
accepted as a legacy local document with an export warning, while a newer version
reports an upgrade recovery action. `run` uses an existing workspace and never
creates one as a side effect. `run --file` and an equivalent headless AI
Workflow command are not available yet. A Graph can be explicitly exported,
then imported into a selected project's Workflow store through a review and an
explicit confirmation. Import checks the portable document format, version,
structure, and content hash; discloses source and destination stores; writes
atomically; then re-reads and verifies the copy. The review does not write a
Graph or make its EJS templates and query tools runnable: use `--confirm` only
after inspecting that declared authority. A collision, corrupt package, or
interrupted write leaves the source and any existing destination Graph intact
and returns a retry, repair, or rename action.

## Current persistence and sharing boundary

Existing runs, Graphs, and prompt templates remain in their daemon-host legacy
libraries: `$OTTO_HOME/runs`, `$OTTO_HOME/orchestration-graphs`, and
`$OTTO_HOME/prompt-templates`. They remain visible as **Legacy host library**
material until a user asks for an explicit transfer. A project Graph or prompt
template save writes to the selected Workflow store with repository/host
provenance; changing a setting affects only future saves. An imported portable
Graph is another explicit copy path: after review and confirmation, it is copied
into the selected project's Workflow `definitions/` store with project and host
provenance. Graph sharing is not synchronization: `otto workflow graph export
<id> --output <file>` produces a portable package, and `otto workflow graph
import <file> --cwd <project>` shows the review before `--confirm` writes and verifies
that copy. It does not run the Graph or move/delete the source.

The shared Workflow storage resolver and project-store Graph import are shipped
foundations. Compatible hosts expose independent Host and Project Workflow
storage settings. A new AI or Graph Workflow writes its project-store
provenance and immutable initial run snapshot before a root agent can start;
later updates remain pinned to that recorded store even if a setting changes.
The library labels project records as **Repository** or **Host-local · host**
and daemon-global records as **Legacy host library**. A host-local record whose
origin host is unavailable names reconnection or an explicit verified transfer
as the remediation; it never falls back to another host. A transfer is addressed
by its stable record id and the requested project scope, never a daemon-private
path. The daemon writes a durable **prepared** receipt before its destination
record, re-reads and hashes that record, then records **verified**, **moved**,
or **source retained**. A collision refuses without changing either copy; an
interrupted or corrupt receipt is surfaced for recovery and never authorizes a
guess, fallback, or deletion.

Same-project definition/template aggregation across both selected locations and
user-facing repair/export actions for corrupt or colliding definitions are still
unfinished. No setting change silently relocates or deletes existing Workflow
data.

## Compatibility and proof

Workflow-specific UI is capability-gated. A daemon that lacks the required
feature tells the user to update the host instead of attempting a partial legacy
fallback. The `workflows.start` launch RPC is the current API; the older
`runs.start` wire pair remains only for peer compatibility.

The Fable 5 changes to the focused browser assertions still require a clean
isolated Chromium confirmation. On 2026-08-29,
`npm --workspace=@otto-code/app run test:e2e -- e2e/browser/runs-screen.spec.ts`
ran three of its four tests: persisted Graph history and Visualizer opening,
Graph restart failure recovery, and AI-planning restart failure recovery. Its
provider-failure assertion exposed an obsolete expectation because the declared
AI plan now pauses for daemon-owned start confirmation; the test now explicitly
approves that confirmation. The required rerun timed out during Metro warmup
before Playwright began, and `graph-workflow-authoring.spec.ts` has not been
rerun against these changes. Do not treat either file as current browser proof
until the exact focused Chromium commands pass.

Deterministic checks, gate outcomes, cancellation cascade, restart recovery,
AI planning records, the AI-declared start confirmation, and no-plan failure
are proven by in-process daemon integration tests
(`workflow.integration.test.ts`, `workflow-service.test.ts`,
`graph-engine.test.ts`), not by browser specs. None of these consume provider
credits. An isolated live-daemon proof uses Claude Sonnet 5 at
low effort to show a real AI conductor declaring one `fanOut: 2` research phase
that completes through two managed workers. A second isolated live-provider
proof uses Codex Luna at low effort to declare an attended gate, approve it
through the Runs RPC, and finish the same Workflow record. These are proofs of
the daemon-owned Workflow path, not a claim that every provider has identical
runtime behavior.

Remaining 0.9 work includes broader provider/runtime proof and expanded Graph
routing and validation coverage. The durable delivery inventory and evidence
record live in Otto Project Knowledge.
