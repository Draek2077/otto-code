---
title: Schedules
description: Schedule agents, saved Workflows, and Artifact data updates.
nav: Overview
order: 25
category: Schedules
---

<!-- OTTO(website): retain Otto public site and manual content. -->

# Schedules

A Schedule runs saved work on its owning host at a chosen cadence. It can use an agent, launch a saved Workflow, or update an Artifact's data.

The target can be:

- A new agent each run, for fresh daily jobs and long-running watchers.
- An existing agent, when you want continuity.
- The agent that created the schedule, for heartbeats from inside an agent.
- A saved AI or Graph Workflow, with an explicit execution workspace, model seats, and reviewed permissions.
- An Artifact data update, using literal JSON or an instruction and an explicitly selected model. The Artifact's HTML design stays unchanged.

The app previews three upcoming cron times in the selected time zone. Existing interval schedules and the native CLI's interval commands remain supported. Runs retain their target, outcome, and result link. Active runs have their own cancellation control; editing, deletion, and storage transfers wait until their owner settles.

## Create and review

Open **Schedules**, choose the owning host and project, then choose **New schedule**. Set the name, cadence, and target. Agent schedules also take a prompt. Workflow schedules use a saved definition from that project; Artifact updates can select project or workspace Artifacts.

Choose **Preview next runs**, then **Review target**. Read the target and permissions before accepting the approval control and saving. Saved Workflow autopilot settings require review too. A deliberate future save to a Workflow can affect later fires, while each admitted run records the definition it actually resolved. Authority changes require another review.

Schedules uses the same provider and permission systems as ordinary Otto work. It does not provide an alternate credential store or bypass provider permissions. On an older host, existing agent scheduling stays available and the new target controls require a host update.

## Approval and failures

A scheduled Workflow waits at its normal human approval gates. Open its result to review and approve it; scheduling never approves it for you. AI Workflows can remain in Planning while you discuss the work.

Failed attempts wait until the next scheduled time. Otto does not retry between cadence fires. An uncertain outcome pauses for inspection; a missing target or changed authority requires deliberate repair. A cancellation request addresses the exact run, and an unconfirmed cancellation is not reported as success.

Cron uses five fields and an IANA time zone. A nonexistent spring-forward time does not fire. Both matching instants of a repeated fall-back minute can fire. The preview shows absolute upcoming occurrences in the selected zone.

## Storage and history

Schedules has its own storage preference. **Host Settings** supplies its default, and **Project Settings** can override it. Repository schedules belong to the project; host-local schedules remain and execute on the selected host. Changing this preference affects new records and never moves existing records.

Use a Schedule's **Copy or move** action for an explicit transfer. **Copy settings** creates a new paused Schedule with empty history and keeps the source. A move retains history and a recoverable source. Neither operation launches work. If an acknowledgement is lost, inspect the operation receipt instead of starting it again.

Open a Schedule to inspect its runs and follow the exact chat, Workflow, or Artifact result link. Older attempts remain available through history pages and full-run reads. Choose fewer runs per page for large results. Unknown outcomes and conflicting saves preserve your draft and require explicit inspection and reload before another write.

## What it's for

- **Overnight refactors:** wake an agent every 30 minutes to continue a scoped refactor, run checks, and leave notes.
- **Heartbeats:** have an agent periodically reassess state and keep moving.
- **Build babysitting:** check CI, EAS, Docker, or release builds until they pass.
- **Daily triage:** scan issues, PRs, and failing checks every morning.
- **Maintenance sweeps:** refresh dependencies, audit docs, or clean stale branches.

## Ways to create one

- **In the app**: open the Schedules view and create one with an agent, a cadence, a repo, and a prompt. This is the main way to create and manage schedules.
- **[From chat](/docs/schedules-chat)**: ask the agent in a chat and it sets the schedule up for you.
- **[From the CLI](/docs/schedules-cli)**: `otto schedule create`, for headless boxes and scripts.
- **[Over MCP](/docs/mcp)**: agents create and manage schedules programmatically.
