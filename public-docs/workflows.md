---
title: Workflows
description: Understand Otto AI and Graph Workflows, their current preview boundary, storage, recovery, and CLI support.
nav: Overview
order: 32
category: Workflows
---

# Workflows

Workflows are Otto's durable record of coordinated project work. They are not a
Kanban board: a board owns task state, while a Workflow drives selected work
through research, implementation, review, approval, verification, or delivery.

Workflows are an in-progress 0.9 surface. The lifecycle has targeted automated
proof, but creating a new Workflow in the app and editing Graphs are currently
a development preview. A normal released app keeps the existing Workflow
history view and does not show a partial creation path. The CLI support below
is separate from that app-preview boundary.

## AI Workflow and Graph Workflow

Otto has two different execution models.

| Model              | You provide                                                              | What the Visualizer shows                                                                                   |
| ------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| **AI Workflow**    | A task, project and workspace, orchestrator seat, and execution options. | The phases and Agents the orchestrator actually declared and ran. It is never drawn as a predeclared Graph. |
| **Graph Workflow** | A saved Graph and its declared inputs.                                   | The declared Graph together with the actual node state, gates, skipped work, failures, and outputs.         |

Only a Graph Workflow has a Graph editor. An AI Workflow is deliberately a
prompt-and-options flow. It does not silently become a Graph because its
orchestrator chooses to coordinate several Agents.

## Start, approval, and limits

An AI Workflow first creates a durable **Planning** record. Its orchestrator
must declare a plan through Otto. If it finishes without one, the same record
fails with a reason you can inspect.

A Graph Workflow validates its saved definition and freezes that definition at
start. Later edits cannot rewrite the historical run.

Otto asks for a start confirmation when a Graph's known shape reaches the
Agent threshold. An AI Workflow asks after its orchestrator has declared a
plan, before any declared child Agent starts. This confirmation is not the same
as a Graph approval gate, and it never changes an Agent's permission mode or
enables unattended execution.

Missing team roles, unavailable profiles or models, unsupported workspace
authority, and unavailable host capabilities fail with a named reason. Otto
does not choose a different provider or weaker permission level for you.

## Inspect failures and recover

The Workflow library keeps Planning, active, approval-waiting, completed,
failed, and cancelled records. Open the run-scoped **Visualizer** to inspect
the work that actually happened.

- A Graph gate pauses before it continues. Approval continues the declared
  Graph; rejection cancels it without spawning an Agent at that gate.
- A Graph check is a deterministic assertion. A passing check releases its
  downstream work; a failing check records the declared failure message.
- Cancelling a Workflow stops its managed child Agents where applicable. A
  cancelled Workflow is shown separately from a failed one and keeps its
  cancellation or gate-rejection reason.
- After a daemon restart, in-flight AI and Graph work is recorded as failed
  with a restart reason. Otto does not claim it completed. Start again only
  after inspecting the record and resolving the cause.

## Storage and sharing limits

Current legacy Workflow records are local to the selected daemon host. Runs,
Graphs, and prompt templates are currently kept under that host's Otto Home.
An imported portable Graph is the exception: confirmation copies it into the
selected project's `.otto/workflows/definitions` directory with project and
host provenance.

Graph sharing is an explicit export and import copy. It is not synchronization,
publication, or a move. Import review shows the source and destination, checks
the document and content hash, writes atomically after confirmation, and leaves
the source intact. A corrupt package, collision, or interrupted import leaves
the existing source and destination intact and offers a recovery action.

The shared Workflow storage resolver is a foundation, not the complete storage
feature. Host and Project storage controls, project-scoped run and template
writes, cross-store discovery, and explicit copy or move receipts are not
available yet. Changing a future storage choice will not silently relocate or
delete existing data.

## Automation eligibility

Schedules can currently target a saved, project-store **Graph Workflow** only.
The Schedule stores the project and definition id, then resolves the same store
when it fires. A missing or unavailable definition, another project's Graph, a
legacy Graph, or an unavailable host pauses the Schedule with repair guidance.

The linked Workflow records the eventual outcome. A Schedule's immediate
success only means that Otto started the Workflow durably. Saved AI Workflows,
re-targeting an existing saved-Workflow Schedule, and prompt reconstruction are
not available.

## Upgrade and provider boundary

Workflow capabilities are detected from the selected daemon host. When the
host lacks a required capability, Otto tells you to update that host instead of
attempting a degraded legacy flow. A host-local record remains on that host; it
does not appear on another host merely because both are connected to Otto.

Providers use the same daemon-owned Workflow engine, but they do not all have
the same proven runtime behavior or workspace-authority levels. Otto refuses a
Graph node whose requested access level the selected provider cannot enforce.
See [Supported providers](/docs/supported-providers) for configured provider
requirements.

## CLI boundary

The CLI currently works with saved Graph Workflows:

```bash
otto workflow graph ls
otto workflow graph inspect <graph-id> --json
otto workflow graph validate <file>
otto workflow graph run <graph-id> --input question="Should we ship?"
```

`validate` reads a local JSON Graph. It does not import or execute it, and it
checks only document and structural validity. Otto checks available seats,
workspace authority, prompt-template references, and other host-specific
requirements before a saved Graph runs.

You can explicitly export a Graph, then review and import it into a selected
project:

```bash
otto workflow graph export <graph-id> --output graph.json
otto workflow graph import graph.json --cwd ~/dev/my-project
otto workflow graph import graph.json --cwd ~/dev/my-project --confirm
```

The first import command only reviews. `--confirm` writes the verified copy.
The CLI does not offer a headless AI Workflow command or `run --file` yet.
