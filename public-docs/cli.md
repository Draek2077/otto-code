---
title: CLI
description: "Otto CLI reference: manage agents, daemons, permissions, and worktrees from your terminal."
nav: CLI
order: 3
category: Getting started
---

# CLI

The Otto CLI lets you manage agents from your terminal. It's the same interface exposed by the daemon's API, so anything you can do in the app you can do from the command line.

> **Agent orchestration:** You can tell coding agents to use the Otto CLI to spawn and manage other agents. This enables multi-agent workflows where one agent delegates subtasks to others and waits for results.

## Quick reference

```bash
otto run "fix the tests"            # Start an agent
otto ls                             # List running agents
otto attach <id>                    # Stream agent output
otto send <id> "also fix linting"   # Send follow-up task
otto logs <id>                      # View agent timeline
otto stop <id>                      # Stop an agent
```

## Running agents

Use `otto run` to start a new agent with a task:

```bash
otto run "implement user authentication"
otto run --provider codex "refactor the API layer"
otto run --detach "run the full test suite"  # background
otto run --worktree feature-x "implement feature X"
otto run --output-schema schema.json "extract release notes"
otto run --output-schema '{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"]}' "summarize release notes"
```

The `--worktree` flag creates the agent in an isolated git worktree, useful for parallel feature development.

Use `--output-schema` to return only matching JSON output. You can pass a schema file path or an inline JSON schema object. This mode cannot be used with `--detach`.

By default, `otto run` waits for completion. Use `--detach` to run in the background.

## Listing agents

```bash
otto ls                    # Running agents in current directory
otto ls -a                 # Include completed/stopped agents
otto ls -g                 # All directories
otto ls -a -g --json       # Full list as JSON
```

## Streaming output

Use `otto attach` to stream an agent's output in real-time:

```bash
otto attach abc123   # Attach to agent (Ctrl+C to detach)
```

Agent IDs can be shortened, `abc` works if it's unambiguous.

## Sending messages

Send follow-up tasks to a running or idle agent:

```bash
otto send <id> "now run the tests"
otto send <id> --image screenshot.png "what's wrong here?"
otto send <id> --no-wait "queue this task"
```

## Viewing logs

```bash
otto logs <id>                  # Full timeline
otto logs <id> -f               # Follow (streaming)
otto logs <id> --tail 10        # Last 10 entries
otto logs <id> --filter tools   # Only tool calls
```

## Waiting for agents

Block until an agent finishes its current task:

```bash
otto wait <id>
otto wait <id> --timeout 60   # 60 second timeout
```

Useful in scripts or when one agent needs to wait for another.

## Permissions

Agents may request permission for certain actions. Manage these from the CLI:

```bash
otto permit ls                # List pending requests
otto permit allow <id>        # Allow all pending for agent
otto permit deny <id> --all   # Deny all pending
```

## Agent modes

Change an agent's operational mode (provider-specific):

```bash
otto agent mode <id> --list   # Show available modes
otto agent mode <id> bypass   # Set bypass mode
otto agent mode <id> plan     # Set plan mode
```

## Daemon management

```bash
otto daemon start             # Start the daemon
otto daemon start --web-ui    # Start and serve the bundled web UI
otto daemon status            # Check status
otto daemon stop              # Stop the daemon
```

Use `OTTO_HOME` to run multiple isolated daemon instances.

## Connecting to a remote daemon

`--host` accepts either a local target (`host:port`, a unix socket, or a Windows pipe) or a pairing offer URL, the same `https://app.otto-code.me/#offer=...` link the mobile app uses for QR pairing. With an offer URL the CLI connects through the Otto relay with end-to-end encryption, so you can drive a daemon on another machine without exposing it to the network.

Get an offer URL from the daemon you want to control:

```bash
otto daemon pair --json   # prints { url, qr, ... }
```

Use it from anywhere:

```bash
otto ls --host 'https://app.otto-code.me/#offer=eyJ2IjoyLC...'
otto run --host "$OFFER_URL" "fix the failing tests"
```

You can also set it once via `OTTO_HOST` instead of passing `--host` on every command.

## Multi-agent workflows

The CLI is designed to be used by agents themselves. You can instruct an agent to spawn sub-agents for parallel work:

```bash
# Agent A spawns Agent B and waits for it
otto run --detach "implement the API" --name api-agent
otto wait api-agent
otto logs api-agent --tail 5
```

Simple implement + verify loop:

```bash
# Requires jq
while true; do
  otto run --provider codex "make the tests pass" >/dev/null

  verdict=$(otto run --provider claude --output-schema '{"type":"object","properties":{"criteria_met":{"type":"boolean"}},"required":["criteria_met"],"additionalProperties":false}' "ensure tests all pass")
  if echo "$verdict" | jq -e '.criteria_met == true' >/dev/null; then
    echo "criteria met"
    break
  fi
done
```

This pattern enables hierarchical task decomposition, a lead agent can break down work, delegate to specialists, and synthesize results.

## Output formats

Most commands support multiple output formats for scripting:

```bash
otto ls --json                # JSON output
otto ls --format yaml         # YAML output
otto ls -q                    # IDs only (quiet)
```

## Global options

- `--host <target>`, connect to a different daemon (`host:port`, unix socket, or `https://app.otto-code.me/#offer=...` for relay). See [Connecting to a remote daemon](#connecting-to-a-remote-daemon).
- `--json`, JSON output
- `-q, --quiet`, minimal output
- `--no-color`, disable colors
