---
title: Schedules from the CLI
description: Create and manage Otto schedules with otto schedule.
nav: CLI
order: 27
category: Schedules
---

<!-- OTTO(website): retain Otto public site and manual content. -->

# Schedules from the CLI

`otto schedule` creates and manages [schedules](/docs/schedules) from your terminal, useful for headless boxes and scripts.

## Create

Overnight refactor on Codex:

```bash
otto schedule create \
  --every 30m \
  --name overnight-refactor \
  --provider codex/gpt-5.5 \
  --cwd ~/dev/my-app \
  --max-runs 16 \
  --expires-in 10h \
  "Continue the refactor. Run the focused checks. Leave a short status note."
```

Long build babysitter on Claude:

```bash
otto schedule create \
  --every 5m \
  --name build-watch \
  --provider claude/opus-4.7 \
  --cwd ~/dev/my-app \
  --max-runs 24 \
  "Check the release build. If it failed, inspect logs, fix the cause, and rerun."
```

Daily GitHub triage on GLM through OpenCode:

```bash
otto schedule create \
  --cron "0 14 * * 1-5" \
  --timezone UTC \
  --run-now \
  --name github-triage \
  --provider opencode/openrouter/glm-5.1 \
  --cwd ~/dev/my-app \
  "Triage GitHub issues, PRs, and failing checks. Summarize what needs attention."
```

Morning triage at 9 AM in New York, including daylight saving time changes:

```bash
otto schedule create \
  --cron "0 9 * * 1-5" \
  --timezone America/New_York \
  --name morning-triage \
  --provider codex/gpt-5.5 \
  --cwd ~/dev/my-app \
  "Review overnight CI failures and summarize anything urgent."
```

Heartbeat the current agent:

```bash
otto schedule create \
  --every 20m \
  --target self \
  --name heartbeat \
  "Check the current task state and continue with the next useful step."
```

## Manage

```bash
otto schedule ls
otto schedule inspect <id>
otto schedule logs <id>
otto schedule pause <id>
otto schedule resume <id>
otto schedule run-once <id>
otto schedule update <id> --every 10m --max-runs 6
otto schedule delete <id>
```

## Cadence

Use `--every <duration>` for intervals and `--cron "<expr>"` for 5-field cron. Cron schedules default to UTC. Pass `--timezone <IANA>` to interpret cron fields in a local wall-clock time zone, for example `--timezone America/New_York`. The persisted `nextRunAt` is still a UTC instant, but it is computed from that local time zone so recurring jobs stay at the same local time across daylight saving time changes.

Interval schedules run once immediately by default; pass `--no-run-now` to wait for the first interval. Cron schedules wait for the next matching time; pass `--run-now` to fire once immediately.

Start the command with `otto --host <target> schedule create ...` when targeting a remote daemon. Pass `--cwd`; your local working directory may not exist on the remote machine.

## Project targets, storage, and recovery

`otto schedule targets` exposes the project-owned API for agents, saved AI/Graph Workflows, Artifact data updates, history, independent storage settings, and transfer recovery. The selected host must support the target-aware Schedule capability. The native commands above remain available.

Discover operation names, then inspect the schema for one operation:

```bash
otto schedule targets operations
otto schedule targets operations schedules.cadence.preview.request
```

Named commands read an exact JSON request from `--input`. For example, save this cadence-preview request as `preview.json`, using the IDs of the actual owning host and project:

```json
{
  "scope": { "hostId": "HOST_ID", "projectId": "PROJECT_ID" },
  "cadence": { "type": "cron", "expression": "0 9 * * 1-5", "timezone": "America/New_York" }
}
```

```bash
otto schedule targets preview --input preview.json --json
otto schedule targets history --input history-request.json --json
otto schedule targets create --input reviewed-create-request.json --approved
otto schedule targets transfer-inspect --input inspection-request.json --json
```

Use `operations` to obtain each command's schema before constructing its request. History accepts `offset` and an optional `limit` from 1 through 50. Writes require `--approved` for the exact action. They also retain the owning origin, revision, and creation or transfer operation ID. The CLI sends one request and never retries an unconfirmed write. Reconnect and inspect its saved record or operation receipt before another write.

Run once acknowledges admission, including a Workflow that is still waiting for human approval. It does not mean that the work is complete. Failed attempts wait for the next scheduled time; uncertain outcomes pause for inspection.
