---
title: Otto MCP
description: Otto MCP tools injected into agents.
nav: Otto MCP
order: 30
category: Orchestration
---

# Otto MCP

Otto can inject these MCP tools into every new agent it launches. Turn on **Inject Otto tools** in host settings, or set `daemon.mcp.injectIntoAgents` to `true`.

## Configuration

| Setting                       | Default | Purpose                                           |
| ----------------------------- | ------- | ------------------------------------------------- |
| `daemon.mcp.enabled`          | `true`  | Run the MCP server.                               |
| `daemon.mcp.injectIntoAgents` | `false` | Give agents launched by Otto access to its tools. |

Depending on the provider, Otto delivers tools through its native tool interface or MCP. The capabilities are the same. Start a new agent or reload an existing one after changing injection settings.

## Limit Otto tools by provider

Use provider policies when different agent profiles should receive different Otto tools. Enable
tool injection globally, then add `ottoTools` to the exact provider IDs you launch:

```json
{
  "$schema": "https://otto-code.me/schemas/otto.config.v1.json",
  "version": 1,
  "daemon": {
    "mcp": {
      "enabled": true,
      "injectIntoAgents": true
    }
  },
  "agents": {
    "providers": {
      "codex-lead": {
        "extends": "codex",
        "label": "Codex Lead"
      },
      "codex-worker": {
        "extends": "codex",
        "label": "Codex Worker",
        "ottoTools": {
          "disabledTools": ["create_chat", "send_chat_prompt", "delete_chat"]
        }
      },
      "codex-isolated": {
        "extends": "codex",
        "label": "Codex Isolated",
        "ottoTools": {
          "enabled": false
        }
      }
    }
  }
}
```

Run `otto reload` after editing `~/.otto/config.json`, then start a new agent or reload an
existing one. A running session keeps the catalog it received at launch.

Omitting `ottoTools` enables the complete catalog. Set `enabled` to `false` to remove the catalog,
or list exact tool IDs in `disabledTools` to remove selected tools. Custom profiles do not inherit
this policy from `extends`; configure each custom provider ID separately.

Browser tools still require browser tools to be enabled and a connected browser host. The
voice-only `speak` tool is separate from this policy.

This setting limits the catalog presented to an agent. It is not a security boundary for an agent
that can access the host through a shell.

## Tools

### Chats

| Tool                | Function                                                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `create_chat`       | Start a chat tied to a working directory, optionally with initial settings, a [Personality](/docs/personalities), or a new git worktree. |
| `send_chat_prompt`  | Send a task to a running chat.                                                                                                           |
| `get_chat_status`   | Return the latest snapshot for a chat.                                                                                                   |
| `list_chats`        | List recent chats as compact metadata.                                                                                                   |
| `cancel_chat`       | Stop the chat's current turn but keep the chat available for future work.                                                                |
| `archive_chat`      | Stop and archive a chat. It leaves the active list but stays recoverable in the archive.                                                 |
| `delete_chat`       | Permanently terminate and delete a chat session.                                                                                         |
| `update_chat`       | Update a chat's name, labels, or runtime settings such as mode/model/effort/features.                                                    |
| `get_chat_activity` | Return recent chat timeline entries as a curated summary.                                                                                |
| `set_chat_mode`     | Switch a chat's session mode.                                                                                                            |

### Workspaces

| Tool                | Function                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| `create_workspace`  | Create a local or worktree-isolated workspace. Worktrees can branch off, check out a branch, or a PR. |
| `list_workspaces`   | List active workspaces and their directories and isolation.                                           |
| `rename_workspace`  | Change the user-visible name of the current or specified workspace.                                   |
| `archive_workspace` | Archive a workspace and the sessions it owns.                                                         |

For worktree isolation, `create_workspace` accepts the same useful choices as the app: branch off from a base, check out an existing branch, or check out a pull request. The worktree remains an implementation detail of the workspace lifecycle.

### Workspace scripts

These tools manage scripts configured in a workspace's `otto.json`. Each requires an explicit `workspaceId`; start and stop also require the configured `scriptName`.

| Tool                     | Function                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `list_workspace_scripts` | List configured scripts with lifecycle, terminal, port, proxy URL, and health metadata. |
| `start_workspace_script` | Start a configured script through Otto's managed launcher.                              |
| `stop_workspace_script`  | Stop a running script through its supervised terminal.                                  |

See [Git worktrees](/docs/worktrees#scripts-and-services) for `otto.json` configuration.

### Terminals

| Tool                 | Function                                                                     |
| -------------------- | ---------------------------------------------------------------------------- |
| `list_terminals`     | List terminal sessions for one working directory or all working directories. |
| `create_terminal`    | Create a terminal session for a working directory.                           |
| `kill_terminal`      | Kill a terminal session.                                                     |
| `capture_terminal`   | Capture plain-text output from a terminal session.                           |
| `send_terminal_keys` | Send text or special key tokens to a terminal session.                       |

### Schedules

| Tool               | Function                                                          |
| ------------------ | ----------------------------------------------------------------- |
| `create_schedule`  | Create a recurring schedule that runs on an agent or a new agent. |
| `list_schedules`   | List schedules managed by the daemon.                             |
| `inspect_schedule` | Inspect a schedule and its run history.                           |
| `pause_schedule`   | Pause an active schedule.                                         |
| `resume_schedule`  | Resume a paused schedule.                                         |
| `delete_schedule`  | Delete a schedule permanently.                                    |

### Providers

| Tool               | Function                                                          |
| ------------------ | ----------------------------------------------------------------- |
| `list_providers`   | List configured agent providers, availability, and modes.         |
| `list_models`      | List models for an agent provider.                                |
| `inspect_provider` | Inspect compact provider capabilities and draft feature settings. |

### Personalities

| Tool                  | Function                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| `list_agent_profiles` | List [agent profiles](/docs/personalities) with roles and availability. Available to any agent. |

Read the returned roles, guidance, notes, and `canLaunch` availability before choosing a Personality. Select the one the user names, or one that fits the work. A Personality supplies its saved provider, model, mode, effort, prompt, and identity; explicit launch settings override individual fields.

`create_chat` requires an explicit `relationship` and `workspace`. Choose a subagent or detached root and its workspace deliberately. Without a Personality, discover an available provider and model before launching.

Personalities are also spawned through `create_chat` (its `agentProfile` argument) and bound to schedules through `create_schedule` / `update_schedule`.

### Worktrees

| Tool               | Function                                                                      |
| ------------------ | ----------------------------------------------------------------------------- |
| `list_worktrees`   | List Otto-managed git worktrees for a repository.                             |
| `create_worktree`  | Create an Otto-managed git worktree from a branch, base branch, or GitHub PR. |
| `archive_worktree` | Delete an Otto-managed git worktree.                                          |

### Permissions

| Tool                       | Function                                          |
| -------------------------- | ------------------------------------------------- |
| `list_pending_permissions` | Return pending permission requests across agents. |
| `respond_to_permission`    | Approve or deny a pending permission request.     |

### Voice

| Tool    | Function                                                                                  |
| ------- | ----------------------------------------------------------------------------------------- |
| `speak` | Speak text through daemon-managed voice output. Available only in voice-enabled sessions. |
