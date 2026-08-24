---
title: Otto MCP
description: Otto MCP tools injected into agents.
nav: Otto MCP
order: 30
category: Orchestration
---

# Otto MCP

Otto can inject these MCP tools into every new agent it launches. Turn on **Inject Otto tools** in host settings, or set `daemon.mcp.injectIntoAgents` to `true`.

The MCP server itself is controlled by `daemon.mcp.enabled`. Existing agents may need a reload.

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

| Tool                 | Function                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| `list_personalities` | List [agent personalities](/docs/personalities) with roles and availability. Available to any agent. |

Personalities are also spawned through `create_chat` (its `personality` argument) and bound to schedules through `create_schedule` / `update_schedule`.

### Worktrees

| Tool               | Function                                                                     |
| ------------------ | ---------------------------------------------------------------------------- |
| `list_worktrees`   | List Otto-managed git worktrees for a repository.                            |
| `create_worktree`  | Create a Otto-managed git worktree from a branch, base branch, or GitHub PR. |
| `archive_worktree` | Delete a Otto-managed git worktree.                                          |

### Permissions

| Tool                       | Function                                          |
| -------------------------- | ------------------------------------------------- |
| `list_pending_permissions` | Return pending permission requests across agents. |
| `respond_to_permission`    | Approve or deny a pending permission request.     |

### Voice

| Tool    | Function                                                                                  |
| ------- | ----------------------------------------------------------------------------------------- |
| `speak` | Speak text through daemon-managed voice output. Available only in voice-enabled sessions. |
