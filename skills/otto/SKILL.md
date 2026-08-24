---
name: otto
description: Otto reference for managing agents and worktrees. Load whenever you need to create agents, send them prompts, or manage worktrees.
---

Otto is a daemon that supervises AI coding agents on your machine. Control it through tools or a CLI.

## Worktrees

**`create_worktree`** - same target union as `create_chat.workspace.source.worktree.target`:

- From a PR: `{ target: { kind: "checkout-pr", githubPrNumber: 503 } }`.
- Branch off a base: `{ target: { kind: "branch-off", worktreeSlug: "foo", branchName: "fix/foo", baseBranch: "main" } }`.
- Checkout an existing branch: `{ target: { kind: "checkout-branch", branch: "feat/bar" } }`.

Returns `{ branchName, worktreePath, workspaceId }`. Pass `cwd` to target a specific repo.

In `branch-off`, `worktreeSlug` controls the worktree path slug and `branchName` controls the git branch. If `branchName` is omitted, Otto defaults it from `worktreeSlug`. The returned `branchName` is authoritative; checkout and PR flows may return a branch name that differs from any requested slug.

**`list_worktrees`** - current repo (or pass `cwd`).
**`archive_worktree`** - `{ worktreePath }` or `{ worktreeSlug }`. Removes worktree and branch.

## Agents

**`create_chat`** - required: `relationship`, `workspace`, and `provider` (`claude/opus`, `codex/gpt-5.4`, …). `title` and `initialPrompt` are **optional** - omit both to just open a new chat (the agent greets the user and asks what to work on); don't refuse to spawn merely because there's no task yet. Common: `notifyOnFinish`, `settings`, `labels`. Returns `{ agentId, … }`.

Initial runtime settings live under `settings`: `modeId`, `thinkingOptionId`, and provider-specific `features`. For Codex fast mode, pass `settings: { features: { "fast_mode": true } }` when creating the agent.

To create a new worktree and launch an agent in it, use `create_chat.workspace.source.kind = "worktree"`. Use `create_worktree` separately only when you need a worktree without launching an agent, or when you need a split flow; in a split flow, pass the returned `workspaceId` to `create_chat` with `workspace: { kind: "existing", workspaceId }`.

### Agent relationships

`relationship` controls parentage only:

- `{ kind: "subagent" }` - child under your subagents track. Use for advisors, committee members, planners, implementers, auditors, loop workers, and any agent whose lifetime belongs to your task.
- `{ kind: "detached" }` - root/sibling agent. Use for handoffs and fire-and-forget delegations the user may continue after you are archived.

`workspace` controls placement only:

- `{ kind: "current" }` - same workspace as the caller, with optional `cwd`.
- `{ kind: "existing", workspaceId: string, cwd?: string }` - attach to an existing workspace, usually from `create_worktree`.
- `{ kind: "create", source: { kind: "directory", path?: string } }` - new workspace rooted at a directory.
- `{ kind: "create", source: { kind: "worktree", cwd?: string, target: { kind: "branch-off", worktreeSlug?: string, branchName?: string, baseBranch?: string } } }`
- `{ kind: "create", source: { kind: "worktree", cwd?: string, target: { kind: "checkout-branch", branch: string } } }`
- `{ kind: "create", source: { kind: "worktree", cwd?: string, target: { kind: "checkout-pr", githubPrNumber: number } } }`

Agent-scoped `create_chat` defaults `notifyOnFinish` to true. Set it to `false` only for truly fire-and-forget agents.

**`send_chat_prompt`** - `{ agentId, prompt }`. Use for follow-ups to an existing agent. Agent-scoped prompt calls default to `background: true` and `notifyOnFinish: true`; top-level calls default to blocking with no callback. For a synchronous follow-up, pass `background: false` and use the returned result.

**`update_chat`** - `{ agentId, name?, labels?, settings? }`. Use `settings` for runtime changes on an existing agent: `modeId`, `model`, `thinkingOptionId`, and provider-specific `features`. For Codex fast mode, pass `settings: { features: { "fast_mode": true } }`.

**`list_chats`** - filter by `cwd`, `statuses`, `sinceHours`, `includeArchived`.

**`archive_chat`** - `{ agentId }`. Interrupts if running, removes from active list.

## Provider discovery

**`list_providers`** - compact provider availability and modes.

**`list_models`** - full model list for one provider. Use only when you need model IDs or thinking options; the list can be large.

**`inspect_provider`** - compact provider capability and feature inspection. Required: `provider`; pass `cwd` when you are not in an agent-scoped session. Optional: `settings` with draft `model`, `modeId`, `thinkingOptionId`, and `features`.

Only set feature IDs returned by `inspect_provider`. For Codex fast mode, look for `fast_mode` and pass `settings: { features: { "fast_mode": true } }` to `create_chat` or `update_chat`.

## Agent profiles

**`list_agent_profiles`** - the roster of named agent profiles the human configured on this host. Each one binds a provider, model, mode, effort, behavior prompt, and identity. Before choosing how to launch a delegated agent, call this tool and read every entry's `roles` and `guidance`. Optionally filter with `roles`. (Otto's own settings UI calls these "Agent personalities"; same thing.)

Pass the name you read to `create_chat`'s `agentProfile` field. That one field is the whole pick:

```
create_chat({ relationship, workspace, agentProfile: "Sage" })
```

Let the daemon expand it. It resolves the profile against the target workspace and applies the provider, model, mode, effort, feature values, behavior prompt, roles, spinner colors, voice, and team framing. Copying those values into `provider` and `settings` by hand gets you the brain without the identity: the prompt, roles, voice, and memory binding are only attached when the daemon resolves the profile itself.

Override a single field when you have a reason, and only that field. `provider` and `settings` win over the profile per field:

```
create_chat({ agentProfile: "Sage", settings: { thinkingOptionId: "high" } })
```

If no profile fits, or none is configured, pass `provider` (as `provider/model`) instead and use the provider discovery tools rather than guessing. Tell the user when you fall back.

An agent profile is a launch pick, not state: do not remember the one you chose or infer drift later.

## Schedules and heartbeats

**`create_schedule`** - starts a new agent on a cron cadence. Required: `prompt`, `cron`, `provider`. Optional: `timezone`, `name`, `cwd`, `maxRuns`, `expiresIn`. Use when the recurring work should live in fresh agents.

**`create_heartbeat`** - sends you a prompt on a cron cadence. Required: `prompt`, `cron`. Optional: `timezone`, `name`, `maxRuns`, `expiresIn`. Use for reminders, PR/build babysitting, and status checks that should return to this conversation.

## Models

`claude/sonnet` (default), `claude/opus` (harder reasoning), `codex/gpt-5.4` (frontier coding), `claude/haiku` (tests only).

## Orchestration preferences

User-specific configuration at `~/.otto/orchestration-preferences.json`. Before an Otto skill chooses a raw provider because no configured [agent profile](#agent-profiles) fits, it must read this file. Reading means an actual file read, not relying on these examples or defaults. Never hardcode a provider string in another skill - resolve through this file.

Two parts:

- `providers` - map of role categories to provider strings. Pass straight to `create_chat`'s `provider` field.
- `preferences` - freeform string array. Read on startup; weave into agent prompts contextually.

Categories: `impl`, `ui`, `research`, `planning`, `audit`. Skills pick the category that matches the role they're launching.

```json
{
  "providers": {
    "impl": "codex/gpt-5.4",
    "ui": "claude/opus",
    "research": "codex/gpt-5.4",
    "planning": "codex/gpt-5.4",
    "audit": "codex/gpt-5.4"
  },
  "preferences": [
    "Claude Opus is the right choice for anything artistic or human-skill-oriented: copywriting, naming, UX copy, visual design, styling. Codex is the workhorse for mechanical work."
  ]
}
```

If the file is missing, use sensible defaults and tell the user once.

## Waiting

Agents take time - 10–30+ minutes is routine. Favor asynchronous workflows.

For agent-scoped `create_chat` and background `send_chat_prompt`, leave `notifyOnFinish` omitted or set it to `true` unless the work is truly fire-and-forget. You will get notified when the target agent finishes, errors, or needs permission. Move on to other work. The notification arrives on its own.

Don't poll `list_chats` or `get_chat_status` to "check on" a running agent. The notification will tell you.

## CLI parity

The `otto` CLI is a thin wrapper over the same daemon. Same surface:

```bash
otto run --provider codex/gpt-5.4 --mode full-access --worktree feat/x "<prompt>"
otto send <agent-id> "<follow-up>"
otto ls
otto worktree ls
otto schedule create --cron "*/15 * * * *" "ping main build"
```

Discover with `otto --help` and `otto <cmd> --help`.

For product questions, setup, logs, version problems, or troubleshooting, use the **otto-help** skill.
