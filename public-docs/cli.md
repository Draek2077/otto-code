---
title: CLI
description: "Otto CLI reference: manage projects, workspaces, chats, plugins, scripts, schedules, daemons, and permissions."
nav: CLI
order: 3
category: Getting started
---

# CLI reference

The Otto CLI lets you manage agents from your terminal. It's the same interface exposed by the daemon's API, so anything you can do in the app you can do from the command line.

> **Agent orchestration:** You can tell coding agents to use the Otto CLI to spawn and manage other agents. This enables multi-agent workflows where one agent delegates subtasks to others and waits for results.

## Quick reference

```bash
otto run "fix the tests"            # Start an agent
otto ls                             # List non-archived agents
otto attach <id>                    # Stream agent output
otto send <id> "also fix linting"   # Send follow-up task
otto logs <id>                      # View agent timeline
otto stop <id>                      # Stop an agent
```

## Provider diagnostics

Ask the daemon to inspect the provider environment it actually uses:

```bash
otto provider diagnostic claude
otto provider diagnostic codex --json
otto --host devbox:6868 provider diagnostic opencode
```

The diagnostic includes the configured command, daemon `PATH` and shell, matching binaries, resolved path, version, model count, and provider status. Use the global `--host` option for a remote daemon. This is the same diagnostic shown under **Settings → your host → Providers → provider → Diagnostic**.

## Running agents

Use `otto run` to start a new agent with a task:

```bash
otto run "implement user authentication"
otto run --provider codex "refactor the API layer"
otto run --background "run the focused test suite"
otto run --new-workspace worktree --worktree-mode branch-off --new-branch feature/x --base origin/main "implement feature X"
otto run --workspace <workspace-id> "review the current diff"
otto run --output-schema schema.json "extract release notes"
otto run --output-schema '{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"]}' "summarize release notes"
```

When an existing Otto agent runs the same command, Otto recognizes it through `OTTO_AGENT_ID`. Without explicit placement, the new agent becomes its subagent in the same workspace. `--workspace` can place that subagent elsewhere without changing its parent.

Use `--output-schema` to return only matching JSON output. You can pass a schema file path or an inline JSON schema object. This mode cannot be used with `--background`.

By default, `otto run` waits for completion. Use `--background` to return immediately while the agent keeps running.

## Projects

Register the current directory as a project, then list the projects known to the daemon:

```bash
cd ~/dev/my-app
otto project create
otto project ls
```

Use the project ID from `otto project ls` to rename, reset, or delete a project:

```bash
otto project rename <project-id> "My app"
otto project rename <project-id> --reset
otto project delete <project-id>
```

`--reset` restores the name derived from the project directory. Deleting a project archives its active workspaces and removes the project from Otto. It does not delete the project directory.

For a local daemon, `otto project create [path]` defaults to the current directory and resolves relative paths on the CLI machine. When you use the global `--host` option or `OTTO_HOST`, provide a path that the target daemon can access:

```bash
otto --host devbox:6868 project create /srv/repos/api
```

The remote daemon interprets that path on its own machine. See [Workspaces](/docs/workspaces) for how projects group working directories and sessions.

## Workspaces

Create a workspace independently when you want to prepare its files before starting an agent:

```bash
otto workspace create --isolation local --path ~/dev/my-app --title main

otto workspace create \
  --isolation worktree \
  --path ~/dev/my-app \
  --mode branch-off \
  --new-branch feature/auth \
  --worktree-slug feature-auth \
  --base origin/main

otto workspace create \
  --isolation worktree \
  --path ~/dev/my-app \
  --mode checkout-branch \
  --branch feature/existing \
  --worktree-slug existing-copy

otto workspace create \
  --isolation worktree \
  --path ~/dev/my-app \
  --mode checkout-pr \
  --pr-number 2186
```

Then list, use, rename, or archive it:

```bash
otto workspace ls
otto run --workspace <workspace-id> "implement authentication"
otto workspace rename <workspace-id> "Auth rework"
otto workspace rename <workspace-id> --reset   # back to the branch or directory name
otto workspace archive <workspace-id>
```

Add `--forge <name>` to PR checkout when Otto cannot infer the forge from the source checkout. See [Git worktrees](/docs/worktrees) for setup hooks and services.

## Terminals

Use the workspace ID when multiple workspaces share a directory:

```bash
otto terminal create --workspace <workspace-id> --name Development
otto terminal ls --workspace <workspace-id> --json
otto terminal send-keys <terminal-id> -l "echo ready"
otto terminal send-keys <terminal-id> Enter
otto terminal capture <terminal-id>
otto terminal kill <terminal-id>
```

Creation defaults to the workspace directory. Add `--cwd <absolute-path>` to change the process directory while keeping that workspace as the owner. Unknown and archived workspace IDs fail.

Without `--workspace`, creation opens the project at `--cwd` or the current directory and reuses its oldest active workspace. Listing without `--workspace` filters by `--cwd` or the current directory and can include multiple workspaces. `ls --all` lists every terminal on the host and cannot be combined with directory or workspace filters.

Create and list results include `id`, `name`, `cwd`, and `workspaceId`. Use `--json` for structured output and the global `--host` option to target another daemon. These commands require a host that supports the [workspace terminal API](/docs/sdk/reference#clientterminals); older hosts return an update message.

## Workspace scripts

List, start, and stop the scripts configured in a workspace's `otto.json`:

```bash
otto script ls
otto script start web
otto script stop web
```

By default, Otto selects the workspace whose directory is the current directory. Pass `--cwd <path>` to select a different directory, or `--workspace <workspace-id>` when a directory has multiple workspaces. Use the global `--host` option to target another daemon. These commands also accept standard output options such as `--json`.

The output includes each script's lifecycle and supervised terminal ID. Services also include their assigned port, proxy URL, and health. See [Git worktrees](/docs/worktrees#scripts-and-services) for `otto.json` configuration.

## Plugins

> **Trust every plugin you add.** `otto plugin add` and `otto plugin install` mean “I trust this codebase.” Plugin server code and Git preparation commands run unsandboxed with the daemon user's access on the daemon host; client contributions run inside Otto. Dependencies and future updates are part of that decision. With the global `--host` option, commands run on the remote daemon host.

Create and manage trusted plugins on a daemon:

```bash
otto plugin init /absolute/path/to/plugin
otto plugin install /absolute/path/to/plugin
otto plugin add owner/repository
otto plugin add https://gitlab.com/group/repository.git --ref main
otto plugin add owner/monorepo:plugins/review
otto plugin ls [id]
otto plugin update my-plugin
otto plugin update --all
otto plugin reload my-plugin
otto plugin logs my-plugin
otto plugin disable my-plugin
otto plugin enable my-plugin
otto plugin remove my-plugin
```

GitHub shorthand checks an existing host directory first. Append `:<directory>` for a plugin in a
monorepo. `otto plugin ls [id]` does not contact the remote. `otto plugin logs <id>` returns the
plugin's recent daemon-side stdout and stderr. Add `--json` for structured entries, or run
`otto --host <target> plugin logs <id>` for another daemon. See the
[Plugin reference](/docs/plugins/v0.8/reference) for installation, trust, lifecycle, and log-retention
behavior.

## Listing agents

```bash
otto ls                    # Non-archived agents in active workspaces
otto ls -a                 # Also include archived agents
otto ls -g                 # Non-archived agents across all workspaces
otto ls -a -g --json       # All agents, including archived, as JSON
```

## Streaming output

Use `otto attach` to stream an agent's output in real-time:

```bash
otto attach abc123   # Attach to agent (Ctrl+C to detach)
```

Agent IDs can be shortened, `abc` works if it's unambiguous.

## Sending messages

Send follow-up tasks to a running or idle agent:

Use the recipient's agent ID from `otto ls`, or [copy it from the agent's tab](/docs/orchestration-workflows#send-a-prompt-to-another-agent).

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

## Schedules

Run an agent on an interval or a cron. See [Schedules from the CLI](/docs/schedules-cli) for the full reference.

```bash
otto schedule create --every 30m --cwd ~/dev/my-app "Continue the refactor and leave a note."
otto schedule ls
otto schedule pause <id>
```

## Artifacts

Inspect and manage durable artifacts from the terminal. See [Artifacts](/docs/artifacts) for storage, recovery, and update behavior.

```bash
otto artifact ls
otto artifact ls --project ~/dev/my-app
otto artifact create "Release report" --project ~/dev/my-app --provider codex --description "Interactive release readiness report"
otto artifact data <id>
otto artifact update-data <id> --data '{"visits":42}'
otto artifact regenerate <id>
otto artifact cancel <id>
otto artifact repair <id>
otto artifact move <id> --to repository
```

`update-data` replaces only the artifact's declared JSON data contract. It does not regenerate or redesign the HTML. Use `regenerate` only when you explicitly want a new visual output.

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
otto reload                    # Reload config.json (top-level alias)
otto daemon reload             # Reload config.json
otto daemon stop              # Stop the daemon
```

Reload validates the whole file, applies runtime-safe changes, and reports `appliedPaths`, `restartRequiredPaths`, and `overrideControlledPaths`. Human output prints `otto daemon restart` only when a changed setting needs it. Use `--json` or `--format yaml` for the structured result. Run `otto --host <target> reload` to reload a remote daemon's own configuration file. An older host that does not support reload returns an update-host error.

Use `OTTO_HOME` to run multiple isolated daemon instances.

## Hub

Hub is disabled in this Otto build. `otto hub` remains registered so an invocation explains the boundary and exits with a nonzero status:

```text
Otto Hub is disabled in this build. See docs/upstream-merges.md.
```

It does not log in, enroll a daemon, deploy triggers or connect to a hosted service. Otto's local [Schedules](/docs/schedules) and orchestration commands remain available independently. The [Paseo Hub reference](/docs/hub) retains upstream trigger, workflow and API examples for a separate Paseo installation.

## Connecting to a remote daemon

The global `--host` option accepts a direct target (`host:port`, a unix socket, or a Windows pipe), an SSH URI, or a pairing offer URL, the same `https://app.otto-code.me/#offer=...` link the mobile app uses for QR pairing. With an offer URL the CLI connects through the Otto relay with end-to-end encryption, so you can drive a daemon on another machine without exposing it to the network.

For an existing daemon reachable through SSH, use `otto --host ssh://user@host ls`. The remote daemon defaults to port `6868`; the SSH URI supports an explicit `daemonPort` override. SSH does not install or start the remote daemon. See [SSH connectivity](/docs/connectivity#ssh).

Get an offer URL from the daemon you want to control:

```bash
otto daemon pair          # asks before enabling relay, then prints the QR and link
otto daemon pair --relay  # enables relay without prompting
otto daemon pair --json   # structured output; never prompts
```

Relay is off for new installations. In non-interactive or JSON mode, a disabled relay returns a `RELAY_DISABLED` error; pass `--relay` to provide explicit consent. Relay pairing is end-to-end encrypted. See [Security](/docs/security).

Use it from anywhere:

```bash
otto --host 'https://app.otto-code.me/#offer=eyJ2IjoyLC...' ls
otto --host "$OFFER_URL" run "fix the failing tests"
```

You can also set it once via `OTTO_HOST` instead of passing `--host` on every command. An explicit flag overrides the environment variable.

## Multi-agent workflows

The CLI is designed to be used by agents themselves. You can instruct an agent to spawn sub-agents for parallel work:

```bash
# Agent A spawns Agent B and waits for it
otto run --background "implement the API" --name api-agent
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

- `--host <target>`, connect to a different daemon (`host:port`, unix socket, `ssh://user@host`, or `https://app.otto-code.me/#offer=...` for relay). See [Connecting to a remote daemon](#connecting-to-a-remote-daemon).
- `--json`, JSON output
- `-q, --quiet`, minimal output
- `--no-color`, disable colors
