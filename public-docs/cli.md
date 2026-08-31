---
title: CLI
description: "Otto CLI reference: manage agents, daemons, permissions, and worktrees from your terminal."
description: "Otto CLI reference: manage projects, workspaces, agents, plugins, scripts, schedules, daemons, and permissions from your terminal."
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

## Provider diagnostics

Ask the daemon to inspect the provider environment it actually uses:

```bash
otto provider diagnostic claude
otto provider diagnostic codex --json
otto provider diagnostic opencode --host devbox:6868
```

The diagnostic includes the configured command, daemon `PATH` and shell, matching binaries, resolved path, version, model count, and provider status. Use `--host` for a remote daemon. This is the same diagnostic shown under **Settings → your host → Providers → provider → Diagnostic**.

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

For a local daemon, `otto project create [path]` defaults to the current directory and resolves relative paths on the CLI machine. When you use `--host` or `OTTO_HOST`, provide a path that the target daemon can access:

```bash
otto project create /srv/repos/api --host devbox:6868
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

## Workspace scripts

List, start, and stop the scripts configured in a workspace's `otto.json`:

```bash
otto script ls
otto script start web
otto script stop web
```

By default, Otto selects the workspace whose directory is the current directory. Pass `--cwd <path>` to select a different directory, or `--workspace <workspace-id>` when a directory has multiple workspaces. These commands also accept `--host` and the standard output options such as `--json`.

The output includes each script's lifecycle and supervised terminal ID. Services also include their assigned port, proxy URL, and health. See [Git worktrees](/docs/worktrees#scripts-and-services) for `otto.json` configuration.

## Plugins

Create and manage trusted local plugins on a daemon:

```bash
otto plugin init /absolute/path/to/plugin
otto plugin install /absolute/path/to/plugin
otto plugin ls
otto plugin reload my-plugin
otto plugin logs my-plugin
otto plugin disable my-plugin
otto plugin enable my-plugin
otto plugin remove my-plugin
```

`otto plugin logs <id>` returns the plugin's recent daemon-side stdout and stderr. Add `--json` for
structured entries or `--host <target>` for another daemon. See the
[Plugin reference](/docs/plugins/reference) for installation, trust, lifecycle, and log-retention
behavior.

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

Use `OTTO_HOME` to run multiple isolated daemon instances.
Reload validates the whole file, applies runtime-safe changes, and reports `appliedPaths`, `restartRequiredPaths`, and `overrideControlledPaths`. Human output prints `otto daemon restart` only when a changed setting needs it. Use `--json` or `--format yaml` for the structured result, and `--host` to reload a remote daemon's own configuration file. An older host that does not support reload returns an update-host error.

Use `OTTO_HOME` to run multiple isolated daemon instances.

## Hub

```bash
otto hub login [url]          # Approve and store organization-scoped CLI access
otto hub init                 # Guided setup: scaffold and deploy a starter bundle here
otto hub connect [url]        # Enroll this daemon using CLI access
otto hub projects             # List projects in the authenticated organization
otto hub status               # Show the current Hub relationship
otto hub disconnect           # End it
otto hub deploy -p <project>  # Discover, validate, and activate a Hub bundle
otto hub deploy -p <project> --dry-run # Validate without activating
otto hub logout               # Remove the active stored CLI login
```

Run deploy from the project root. It reads `.otto/hub.yml`, every direct `.otto/workflows/*.yml` file, and referenced `.otto/workflows/partials/*` files in deterministic path order. It does not search parents, accept an alternate resource path, or flatten the bundle into monolithic YAML.

Pass `-p, --project <slug>` to select the target project. `--dry-run` performs the same discovery and server validation without recording or activating a revision. Both outputs include the resolved Hub, project, and discovered workflow count.

`login` opens the Hub approval page and stores a durable organization-scoped CLI credential under `OTTO_HOME`. In an interactive terminal it then asks whether to connect this daemon and whether to initialize and deploy a starter workflow, both defaulting to yes. Declining the connection prints `otto hub connect <origin>; then otto hub init`, because the connection alone does not produce a bundle; declining only the starter prints `otto hub init`. `--json` and non-TTY login remain login-only and never prompt. The stored login is separate from the daemon relationship created by `connect`.

`init` runs the same guided setup on its own and requires a TTY. It connects the daemon, uses the organization's only project or asks which one, and lists the Hub app connections that can back a starter workflow. One usable connection is selected automatically; with several, you choose a **Trigger connection**. If none is ready, setup sends you to **Hub → Apps** and stops before selecting an agent or writing files.

Setup then asks which agent provider, model, and mode the starter should run, choosing from what the connected daemon reports. A provider is offered only when the daemon has it enabled with a selectable model. Suggested model and mode entries are the daemon's defaults; no provider is suggested merely because it appears first. The mode question is skipped for providers that expose no modes and asked explicitly when the daemon has modes but no default. Finally, setup asks for the identity that gates the chosen connection: a GitHub username, a Slack member ID, or a Discord user ID. It writes `.otto/hub.yml` and `.otto/workflows/<provider>-help.yml`, validates them against Hub, and deploys. An existing `.otto/` directory is replaced only after you confirm. See the [generated starter bundle](/docs/hub/configuration#generated-starter-bundle).

Interactive logout checks the same-origin daemon relationship and asks whether to disconnect before deleting the login. Declining removes only the login. JSON and noninteractive logout never prompt or disconnect implicitly; `--disconnect-daemon` is the explicit automation path, and `--force` applies to that daemon disconnection. If a requested disconnection fails, the login is preserved.

Every command resolves and normalizes its destination before Hub or daemon work. Origin precedence is an explicit command origin or `--hub`, then `OTTO_HUB_URL`, then the active stored login origin, then the hosted default `https://hub.otto-code.me`. The hosted default never overrides an active login. Credential precedence is `--api-key <secret>`, then `OTTO_HUB_API_KEY`, then a stored login for the exact resolved origin. A stored credential is never sent to a different origin. API keys passed through flags or the environment are not stored.

Human output reports the resolved destination before each action. JSON output keeps stdout machine-readable and includes the normalized Hub origin. Bundle diagnostics identify paths without printing configuration contents or credentials.

See [Daemons in Hub](/docs/hub/daemons), [Hub configuration](/docs/hub/configuration), and the [Hub public API](/docs/hub/api).

## Connecting to a remote daemon

`--host` accepts either a local target (`host:port`, a unix socket, or a Windows pipe) or a pairing offer URL, the same `https://app.otto-code.me/#offer=...` link the mobile app uses for QR pairing. With an offer URL the CLI connects through the Otto relay with end-to-end encryption, so you can drive a daemon on another machine without exposing it to the network.

Get an offer URL from the daemon you want to control:

```bash
otto daemon pair          # asks before enabling relay, then prints the QR and link
otto daemon pair --relay  # enables relay without prompting
otto daemon pair --json   # structured output; never prompts
```

Relay is off for new installations. In non-interactive or JSON mode, a disabled relay returns a `RELAY_DISABLED` error; pass `--relay` to provide explicit consent. Relay pairing is end-to-end encrypted. See [Security](/docs/security).

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

- `--host <target>`, connect to a different daemon (`host:port`, unix socket, or `https://app.otto-code.me/#offer=...` for relay). See [Connecting to a remote daemon](#connecting-to-a-remote-daemon).
- `--json`, JSON output
- `-q, --quiet`, minimal output
- `--no-color`, disable colors
