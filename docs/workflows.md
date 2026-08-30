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
cancellation. It can open the run-scoped Visualizer for either Workflow kind.

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
[orchestration-node-capabilities.md](orchestration-node-capabilities.md).

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
(`run-orchestration.integration.test.ts`, `run-service.test.ts`,
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
