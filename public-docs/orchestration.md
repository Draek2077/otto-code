---
title: Orchestration
description: Coordinate agents across providers and machines, delegate work, and keep tasks moving with schedules and heartbeats.
nav: Overview
order: 30
category: Orchestration
---

# Orchestration

Otto orchestration gives a coding agent control of the Otto daemon. The agent can discover every provider and model you have configured, create workspaces, launch other agents, send them follow-ups, and create heartbeats or schedules. The same work stays visible in the Otto app.

## What your agents can do

- **Choose providers and models:** launch other agents using any provider and model configured on the host.
- **Delegate and parallelize:** split research, implementation, and review between agents, including agents from different providers.
- **Communicate with each other:** agents can [send prompts to other agents by ID](/docs/orchestration-workflows#send-a-prompt-to-another-agent) to ask questions, share findings, or request work.
- **Coordinate ongoing work:** check progress, stop tasks, and collect results.
- **Create workspaces and worktrees:** give independent changes their own [working directories](/docs/worktrees).
- **Work across machines:** use the [CLI](/docs/cli#connecting-to-a-remote-daemon) to launch and manage agents on another reachable Otto host.
- **Choose by specialty:** use [Personalities](/docs/personalities) and their notes to select settings for UI work, planning, or reviews.
- **Create schedules:** run a prompt in a new agent at [specified times](/docs/schedules).
- **Create heartbeats:** prompt the same agent periodically to [continue its task](/docs/orchestration-workflows#keep-an-agent-working-with-a-heartbeat).

## Get started

Use built-in Otto tools or the CLI. Both let an agent launch and coordinate workers.

### Built-in Otto tools (MCP)

Enable Otto tools so agents running inside Otto can manage agents and workspaces on their host directly.

1. Open **Settings → your host → Agents**.
2. Turn on **Enable Otto tools**. Tool injection is off by default.
3. Start a new agent, or reload an existing agent so it receives the tools.
4. Ask:

> Use Otto to launch a second agent to review this branch. Have it report potential bugs without changing files, then summarize its findings.

The worker appears in the **Subagents track** near the composer. Open it to follow the conversation. Your main agent receives a notification when the worker finishes, and you can keep talking while it works.

See the [MCP reference](/docs/mcp) for tool configuration and the full catalog. [Orchestration skills](/docs/skills) are optional reusable workflows.

### CLI

Agents with shell access can also use the Otto CLI. This route does not require enabling tool injection. With Otto installed, a running host, and Codex configured:

```bash
otto run --provider codex --background \
  "Review this branch without changing files"
otto ls -a
```

The first command starts a worker and returns immediately; the second lists agents from active workspaces, including archived agents. When an Otto agent runs the command, the worker becomes its subagent in the same workspace. From your own terminal, it starts in a new local workspace.

## Native subagents and Otto subagents

Otto subagents are full agents managed by the Otto daemon. The orchestrator can choose any configured provider and model, keep the worker in the current workspace, or place it in another workspace created for the task. Use them when you want one model to plan, another to implement, and another to review.

|                      | Native subagent                           | Otto subagent                                      |
| -------------------- | ----------------------------------------- | -------------------------------------------------- |
| Provider             | Same provider as its parent               | Any provider configured in Otto                    |
| Working directory    | Managed by the parent provider            | Current or explicitly selected workspace           |
| Lifecycle            | Owned by the parent provider              | Managed by Otto; can receive follow-ups            |
| Where you inspect it | Read-only timeline in the Subagents track | Full agent session in the Subagents track          |
| Best for             | Fast, provider-native delegation          | Cross-provider work and explicit workspace control |

Save launch settings and identity as a [Personality](/docs/personalities), then select it when creating a chat.

## Go further

```text
Stay as the orchestrator. Use Otto to find my available Codex models, then
create a worktree-isolated workspace, then launch a GPT-5.6 subagent there. Ask
it to implement the parser change, run the focused tests, and report back here.
```

The orchestrator discovers the provider and model IDs, starts the worker, and receives a notification when it finishes. You can keep talking to the orchestrator in the meantime.

The `create_chat` tool requires explicit relationship and workspace choices. A subagent remains attached to its parent even in another workspace; a detached root starts independently. The CLI uses the calling agent context for its defaults, as described above.

## Where the work appears

Spawned work appears in the **Subagents track** above the composer. Open a row to read the live conversation.

Both kinds of subagent appear there:

- **Otto subagents** open as full agent sessions. You can talk to them directly, change their settings, or archive them.
- **Native provider subagents** open as read-only timelines. You can inspect their work, but their provider owns their lifecycle.

A cross-workspace subagent still belongs to its parent's Subagents track. Otto also opens its workspace so the work is not hidden in an otherwise empty workspace. To turn an existing subagent into a top-level agent, detach it in the app or with `otto agent detach`. You can also create an independent chat by choosing a detached relationship at creation.

Native subagent visibility depends on the provider reporting those sessions and the connected host supporting observed subagents.

## Keep an agent working with a heartbeat

A heartbeat sends a prompt back into the same agent on a cron cadence. Use one when the agent should keep reassessing a live task: continue a refactor, babysit CI, watch a deployment, or retry after an external system changes.

Ask the agent directly:

```text
Use Otto to create a heartbeat every 10 minutes. Keep checking this PR, fix any
new CI failures, and stop when all checks pass or after two hours.
```

The base [`/otto` orchestration skill](/docs/skills) teaches agents how to create heartbeats, so you only need to ask. A heartbeat continues the current conversation; a [schedule](/docs/schedules) is better for standalone cron-style jobs such as daily triage.

You do not need to name MCP tools in your prompts. Ask for the workflow; the agent uses the tools underneath.

Continue with [Common workflows](/docs/orchestration-workflows) for copyable prompts, [Orchestration skills](/docs/skills) for packaged workflows, or the [MCP reference](/docs/mcp) for the complete tool catalog.
