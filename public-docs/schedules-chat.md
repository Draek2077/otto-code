---
title: Schedules from chat
description: Ask an agent in chat to set up and manage a schedule for you.
nav: Chat
order: 26
category: Schedules
---

<!-- OTTO(website): retain Otto public site and manual content. -->

# Schedules from chat

You don't have to fill in a form. In any agent chat, just ask, and the agent sets up the schedule for you through [Otto MCP](/docs/mcp).

Example prompts:

- "Every weekday at 9am, triage new GitHub issues and PRs and summarize what needs attention."
- "Check the release build every 5 minutes until it passes, and fix the cause if it fails."
- "Keep working on this refactor. Wake yourself every 20 minutes and continue where you left off."

The agent picks the cadence, target, and prompt from what you asked, creates the schedule, and reports back. You can manage it the same way ("pause the triage schedule", "make the build check run every 2 minutes instead", "delete it") or from the [Schedules view](/docs/schedules) and the [CLI](/docs/schedules-cli).

An agent scheduling itself to wake up later is a **heartbeat**. See [Otto MCP](/docs/mcp) for the underlying tools.

## Saved Workflows and Artifact updates

On an updated host, you can also ask to schedule a saved AI or Graph Workflow, or refresh an Artifact's data. The agent discovers available operations through `schedule_catalog`, then calls one exact operation through `schedule_operation`. These tools use the calling chat's owning workspace, project, and host.

Review the exact target, execution workspace, models, cadence, and permissions before approving a write. A scheduled Workflow still waits for you at its human approval gates. An Artifact update changes its JSON data and preserves the HTML design; it does not regenerate the page.

Failed attempts wait until the next scheduled time. If a write or run has an uncertain outcome, ask the agent to inspect the saved Schedule or transfer receipt. It must not resend the write or create a replacement to guess what happened. Workflow-owned agents cannot use these tools to create nested schedules.
