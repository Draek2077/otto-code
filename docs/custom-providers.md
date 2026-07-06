# Custom Provider Configuration

Otto supports configuring custom agent providers through `config.json` (located at `$OTTO_HOME/config.json`, typically `~/.otto/config.json`). You can extend built-in providers with different API backends, add ACP-compatible agents, set custom binaries, disable providers, and create multiple profiles for the same underlying provider.

All provider configuration lives under `agents.providers` in config.json:

```json
{
  "version": 1,
  "agents": {
    "providers": {
      "provider-id": { ... }
    }
  }
}
```

Provider IDs must be lowercase alphanumeric with hyphens (`/^[a-z][a-z0-9-]*$/`).

---

## Table of Contents

- [Extending a built-in provider](#extending-a-built-in-provider)
- [Z.AI (Zhipu) coding plan](#zai-zhipu-coding-plan)
- [Alibaba Cloud (Qwen) coding plan](#alibaba-cloud-qwen-coding-plan)
- [OpenAI Compatible (local models)](#openai-compatible-local-models)
- [Codex with a custom OpenAI-compatible endpoint](#codex-with-a-custom-openai-compatible-endpoint)
- [Multiple profiles for the same provider](#multiple-profiles-for-the-same-provider)
- [Custom binary for a provider](#custom-binary-for-a-provider)
- [Disabling a provider](#disabling-a-provider)
- [ACP providers](#acp-providers)
- [Provider override reference](#provider-override-reference)

---

## Extending a built-in provider

Use `extends` to create a new provider entry that inherits from a built-in provider (claude, codex, copilot, opencode, pi, omp). The new provider gets its own entry in the provider list, with its own label, environment, and model definitions.

```json
{
  "agents": {
    "providers": {
      "my-claude": {
        "extends": "claude",
        "label": "My Claude",
        "description": "Claude with custom API endpoint",
        "env": {
          "ANTHROPIC_API_KEY": "sk-ant-...",
          "ANTHROPIC_BASE_URL": "https://my-proxy.example.com/v1"
        }
      }
    }
  }
}
```

Required fields for custom providers:

- `extends` — which built-in provider to inherit from (or `"acp"`)
- `label` — display name in the UI

See [Codex with a custom OpenAI-compatible endpoint](#codex-with-a-custom-openai-compatible-endpoint) below for the dedicated Codex example.

---

## Z.AI (Zhipu) coding plan

[Z.AI](https://z.ai) is a Chinese AI company (Zhipu AI) that offers an Anthropic-compatible API endpoint. Their GLM Coding Plan provides flat-rate access to GLM models through Claude Code's Anthropic API protocol. These are **not** Anthropic Claude models — they are Zhipu's own GLM models exposed through an Anthropic-compatible API.

### Setup

1. Register at [z.ai](https://z.ai) and subscribe to a coding plan
2. Create an API key from the Z.AI dashboard
3. Add a provider entry in config.json:

```json
{
  "agents": {
    "providers": {
      "zai": {
        "extends": "claude",
        "label": "ZAI",
        "env": {
          "ANTHROPIC_AUTH_TOKEN": "<your-zai-api-key>",
          "ANTHROPIC_BASE_URL": "https://api.z.ai/api/anthropic",
          "API_TIMEOUT_MS": "3000000"
        },
        "disallowedTools": ["WebSearch"],
        "models": [
          { "id": "glm-4.5-air", "label": "GLM 4.5 Air" },
          { "id": "glm-5-turbo", "label": "GLM 5 Turbo", "isDefault": true },
          { "id": "glm-5.1", "label": "GLM 5.1" }
        ]
      }
    }
  }
}
```

### Available models

| Model         | Tier                |
| ------------- | ------------------- |
| `glm-5.1`     | Advanced (flagship) |
| `glm-5-turbo` | Advanced            |
| `glm-4.7`     | Standard            |
| `glm-4.5-air` | Lightweight         |

### Notes

- `ANTHROPIC_AUTH_TOKEN` is used instead of `ANTHROPIC_API_KEY` — this is the z.ai API key
- The `API_TIMEOUT_MS` env var extends the request timeout (z.ai can be slower than direct Anthropic)
- If you get auth errors, run `/logout` inside Claude Code before switching to the z.ai provider
- Web search (`WebSearch` tool) is an Anthropic-only server-side feature — third-party endpoints don't support it. Add `"disallowedTools": ["WebSearch"]` to avoid errors.
- Automated setup is also available: `npx @z_ai/coding-helper`
- Official docs: [docs.z.ai/devpack/tool/claude](https://docs.z.ai/devpack/tool/claude)

---

## Alibaba Cloud (Qwen) coding plan

[Alibaba Cloud Model Studio](https://www.alibabacloud.com/en/campaign/ai-scene-coding) offers a coding plan that routes Claude Code requests to Qwen models through an Anthropic-compatible API. Like z.ai, these are **not** Anthropic Claude models.

### Setup

1. Go to the [Coding Plan page](https://modelstudio.console.alibabacloud.com/ap-southeast-1/?tab=globalset#/efm/coding_plan) on Alibaba Cloud Model Studio (Singapore region)
2. Subscribe to the Pro plan ($50/month)
3. Obtain your plan-specific API key (format: `sk-sp-xxxxx`) — this is different from a standard Model Studio key
4. Add a provider entry in config.json:

```json
{
  "agents": {
    "providers": {
      "qwen": {
        "extends": "claude",
        "label": "Qwen (Alibaba)",
        "env": {
          "ANTHROPIC_AUTH_TOKEN": "sk-sp-<your-coding-plan-key>",
          "ANTHROPIC_BASE_URL": "https://coding-intl.dashscope.aliyuncs.com/apps/anthropic"
        },
        "disallowedTools": ["WebSearch"],
        "models": [
          { "id": "qwen3.5-plus", "label": "Qwen 3.5 Plus", "isDefault": true },
          { "id": "qwen3-coder-next", "label": "Qwen 3 Coder Next" },
          { "id": "kimi-k2.5", "label": "Kimi K2.5" }
        ]
      }
    }
  }
}
```

### API endpoints

| Mode                            | Base URL                                                    |
| ------------------------------- | ----------------------------------------------------------- |
| Coding plan (subscription)      | `https://coding-intl.dashscope.aliyuncs.com/apps/anthropic` |
| Pay-as-you-go (no subscription) | `https://dashscope-intl.aliyuncs.com/apps/anthropic`        |

For pay-as-you-go, use `ANTHROPIC_API_KEY` with a standard Model Studio key (`sk-xxxxx`) instead of `ANTHROPIC_AUTH_TOKEN`.

### Available models

**Recommended for coding plan:**

| Model              | Notes                       |
| ------------------ | --------------------------- |
| `qwen3.5-plus`     | Vision capable, recommended |
| `qwen3-coder-next` | Optimized for coding        |
| `kimi-k2.5`        | Vision capable              |
| `glm-5`            | Zhipu GLM                   |
| `MiniMax-M2.5`     | MiniMax                     |

**Additional models (pay-as-you-go):**
`qwen3-max`, `qwen3.5-flash`, `qwen3-coder-plus`, `qwen3-coder-flash`, `qwen3-vl-plus`, `qwen3-vl-flash`

### Notes

- API keys must be created in the **Singapore region**
- The coding plan is for personal use only in interactive coding tools
- Web search (`WebSearch` tool) is an Anthropic-only server-side feature — third-party endpoints don't support it. Add `"disallowedTools": ["WebSearch"]` to avoid errors.
- Official docs: [alibabacloud.com/help/en/model-studio/claude-code-coding-plan](https://www.alibabacloud.com/help/en/model-studio/claude-code-coding-plan)

---

## OpenAI Compatible (local models)

Local inference servers like [LM Studio](https://lmstudio.ai), [Ollama](https://ollama.com), vLLM, and llama.cpp expose an OpenAI-compatible HTTP server instead of a CLI. Otto talks to them **natively** — the daemon connects to the endpoint directly with `extends: "openai-compatible"`. No agent CLI is involved.

**OpenAI Compatible** ships as a featured preset in the in-app **Add provider** catalog, defaulting to LM Studio's local port (`http://localhost:1234`). Installing it creates the config below; the Server URL and API key are editable afterwards in the provider's settings sheet (Connection section) — point it at Ollama, vLLM, or any other OpenAI-compatible server instead.

### Setup

1. Install a local server, e.g. [LM Studio](https://lmstudio.ai) or [Ollama](https://ollama.com), and download the models you want
2. Start the local server (for LM Studio: Developer tab → Start Server, or `lms server start`)
3. Install the preset from Settings → Add provider, or add the entry manually:

```json
{
  "agents": {
    "providers": {
      "openai-compatible": {
        "extends": "openai-compatible",
        "label": "OpenAI Compatible",
        "env": {
          "OPENAI_BASE_URL": "http://localhost:1234/v1"
        }
      }
    }
  }
}
```

### How it works

- **Models are discovered automatically** from `GET {OPENAI_BASE_URL}/models` — whatever the server has downloaded shows up in the model picker. Setting `models` in the config replaces discovery with a static list.
- **Status reflects reachability, not installation.** When the server is running the provider shows Available with the discovered model count; when it isn't, the row shows an error explaining that the endpoint can't be reached.
- Chat turns stream over `POST {OPENAI_BASE_URL}/chat/completions` (SSE). Reasoning deltas (`reasoning_content`) are rendered as thinking output.
- **Function-calling models get a built-in coding toolset** executed by the daemon in the agent's cwd: `read_file`, `list_dir`, `grep_search`, `write_file`, `edit_file`, `run_command`. Tool calls stream as timeline items like any other agent's.
- **Otto's tool catalog is injected too.** Because there is no agent binary to host an MCP client, the daemon injects Otto's agent tools (`browser_*`, `preview_*`, agent management, terminals, schedules, workspace) directly into the model's tool list, so a local model can drive previews and browser verification like Claude Code does. Excluded in `plan` mode (those tools can take actions); the built-in coding tools win on any name collision.
- **Otto tools are permission-gated by class** (`openai-compat-otto-tool-permissions.ts`). CLI providers get prompting from their own permission system in front of the MCP client; here the daemon prompts itself. Read-only tools (`browser_snapshot`, `preview_logs`, `list_agents`, …) never prompt. "Interact" tools (browser clicks/typing/navigation, `preview_start`/`preview_stop`) prompt in `default` mode and auto-approve in `acceptEdits`, like file edits. "Execute" tools (`browser_evaluate`, `browser_upload`, terminal creation and keystrokes, agent creation/mode changes, schedule and worktree mutation — and any unclassified tool) prompt in `default` **and** `acceptEdits`, like shell commands. `bypassPermissions` auto-approves everything.
- **Scope the Otto tools with `ottoToolGroups`.** Omit it for all groups (the default); set it to a subset to keep the prompt small and the model focused. Groups: `preview`, `browser`, `agents`, `terminals`, `schedules`, `workspace`.

  ```json
  {
    "agents": {
      "providers": {
        "openai-compatible": {
          "extends": "openai-compatible",
          "label": "OpenAI Compatible",
          "env": { "OPENAI_BASE_URL": "http://localhost:1234/v1" },
          "ottoToolGroups": ["preview", "browser"]
        }
      }
    }
  }
  ```

- **Permission modes** mirror the other providers: `default` (Always Ask — prompts before edits, commands, and non-read-only Otto/MCP tools), `acceptEdits` (auto-approves file edits and browser/preview interaction, still asks for commands and execute-class tools), `plan` (Read Only — only read tools are offered to the model, and Otto and MCP tools are withheld), and `bypassPermissions` (unattended).
- **Reasoning effort** is a per-agent feature select (Off / Low / Medium / High). Off (the default) omits the `reasoning_effort` parameter entirely, so strict servers are unaffected until you opt in.
- **Rewind conversation** is supported: the daemon owns this provider's transcript, so rewinding truncates the conversation at the chosen user message. Persistence keeps the last 40 messages, so on a resumed agent only that window is rewindable.
- `OPENAI_API_KEY` is optional — set it if your server requires an API key (LM Studio local servers accept requests without one).
- `/v1` is appended to the URL automatically if missing. Remote servers (e.g. LM Studio on another machine over Tailscale) work by pointing `OPENAI_BASE_URL` at that host.
- The same `extends: "openai-compatible"` entry works for any OpenAI-compatible server: Ollama (`http://localhost:11434/v1`), vLLM, llama.cpp server, gateways.

### MCP servers

The daemon itself acts as the MCP client for this provider: it connects to the configured servers per agent session, lists their tools, and exposes them to the model as `mcp_{server}_{tool}` functions alongside the built-in coding tools and Otto's catalog. Configure servers in the provider entry:

```json
{
  "agents": {
    "providers": {
      "openai-compatible": {
        "extends": "openai-compatible",
        "label": "OpenAI Compatible",
        "env": { "OPENAI_BASE_URL": "http://localhost:1234/v1" },
        "mcpServers": {
          "docs": { "type": "stdio", "command": "npx", "args": ["-y", "some-mcp-server"] },
          "tracker": {
            "type": "http",
            "url": "https://example.com/mcp",
            "headers": { "Authorization": "Bearer <token>" }
          }
        },
        "mcpToolPermissions": "always-ask"
      }
    }
  }
}
```

- **Transports:** `stdio` (daemon spawns the process — scrubbed environment, agent cwd, tree-killed on session close), `http`, and `sse`.
- **Merging:** provider-level `mcpServers` merge with any per-agent `mcpServers` sent at agent create; the per-agent entry wins on a server-name collision.
- **Namespacing:** tool names are always exposed as `mcp_{server}_{tool}` (sanitized to the OpenAI charset), so an MCP server can never shadow `run_command`, `preview_start`, or any other builtin/Otto tool.
- **Permissions (`mcpToolPermissions`):** MCP tools are opaque — the daemon can't know whether one is destructive.
  - `"always-ask"` (the default): every MCP tool call prompts in `default` **and** `acceptEdits` modes.
  - `"trust-read-only"`: in `acceptEdits` mode, tools whose MCP `readOnlyHint` annotation is true auto-approve; everything else still prompts. The hint is the server's self-declaration, so it is never honored in `default` mode.
  - `plan` mode never exposes MCP tools regardless of this setting; `bypassPermissions` auto-approves everything, as with all other tools.
- **Prompts as slash commands:** prompts exposed by connected servers appear in the composer as `/mcp_{server}_{prompt}` commands. The rest of the line maps to the prompt's first declared argument; a failed resolution falls back to sending the typed text as a plain prompt.
- **Failure isolation:** a server that can't be reached is skipped with a one-time warning in the agent timeline — the session keeps working with the remaining tools.
- **Security:** `stdio` entries execute arbitrary commands as the daemon's user — only add servers you trust, exactly as you would for any agent that can run shell commands. Configured header and env values are treated as secrets and redacted from logs, timeline errors, and tool output fed to the model. MCP tool results are capped at 30k characters.

### Current limitations

- Tool use requires a model that supports OpenAI function calling; models without it fall back to plain chat (the `tools` payload is ignored by the server or the model simply never calls them).
- MCP tool/prompt sets are snapshotted when the session connects; `list_changed` notifications are not yet handled.
- Multi-argument MCP prompts receive only their first declared argument from the slash-command line.
- Custom providers can be removed from the UI (provider settings → Remove provider) on daemons with the `providerRemove` feature.

---

## Codex with a custom OpenAI-compatible endpoint

Codex talks to OpenAI's Responses API by default. Custom providers that extend `"codex"` can point Codex at any OpenAI-compatible endpoint (OpenRouter, LiteLLM, vLLM, llama.cpp server, an internal gateway, etc.) by setting `OPENAI_BASE_URL` and `OPENAI_API_KEY` in the provider `env`.

Otto passes those variables through to the Codex app-server process **and** maps them into Codex's thread config under `model_provider` / `model_providers`, because Codex reads provider routing from config rather than from `OPENAI_BASE_URL` alone.

### Setup

```json
{
  "agents": {
    "providers": {
      "my-codex": {
        "extends": "codex",
        "label": "My Codex",
        "description": "Codex via custom OpenAI-compatible endpoint",
        "env": {
          "OPENAI_API_KEY": "sk-...",
          "OPENAI_BASE_URL": "https://custom-relay.example.com"
        },
        "models": [{ "id": "custom-model", "label": "Custom Model", "isDefault": true }]
      }
    }
  }
}
```

### What Otto wires up

Under the hood, for each custom Codex provider Otto injects this into Codex's config:

```toml
model_provider = "my-codex"

[model_providers.my-codex]
name = "My Codex"
base_url = "https://custom-relay.example.com/v1"
wire_api = "responses"
env_key = "OPENAI_API_KEY"
requires_openai_auth = false
```

- `base_url` — taken from `OPENAI_BASE_URL`. If it does not already end in `/v1`, Otto appends `/v1`. Trailing slashes are stripped.
- `wire_api` — always `"responses"` (OpenAI Responses API protocol).
- `env_key` — set to `"OPENAI_API_KEY"` when that env var is present and non-empty, so Codex reads the key from the same env var Otto passes through.
- `requires_openai_auth` — forced to `false` when `OPENAI_API_KEY` is provided, so Codex skips its built-in OpenAI login flow.

### Notes

- The endpoint must speak the OpenAI **Responses API**, not just chat completions. Many gateways (OpenRouter, LiteLLM) support both — pick the Responses-compatible route.
- Set `models` explicitly. Custom endpoints expose their own model IDs (`anthropic/claude-opus-4-7`, `qwen/qwen3-coder`, `local/llama`, etc.), and Otto does not discover them automatically for Codex.
- To run multiple endpoints side-by-side, define multiple entries that each extend `"codex"` with different IDs, labels, and env. Each appears as its own provider in the app.
- If you only want to override the binary (e.g. a nightly Codex build) without changing the endpoint, omit `OPENAI_BASE_URL` and use `command` instead — see [Custom binary for a provider](#custom-binary-for-a-provider).

---

## Multiple profiles for the same provider

You can create multiple entries that extend the same built-in provider. Each gets its own entry in the provider list with independent credentials, models, and environment.

Example: two different Anthropic accounts as separate profiles:

```json
{
  "agents": {
    "providers": {
      "claude-work": {
        "extends": "claude",
        "label": "Claude (Work)",
        "description": "Work Anthropic account",
        "env": {
          "ANTHROPIC_API_KEY": "sk-ant-work-..."
        }
      },
      "claude-personal": {
        "extends": "claude",
        "label": "Claude (Personal)",
        "description": "Personal Anthropic account",
        "env": {
          "ANTHROPIC_API_KEY": "sk-ant-personal-..."
        }
      }
    }
  }
}
```

Each profile appears as a separate provider in the Otto app. You can select which one to use when launching an agent.

You can also combine profiles with model overrides to pin specific models per profile:

```json
{
  "agents": {
    "providers": {
      "claude-fast": {
        "extends": "claude",
        "label": "Claude (Fast)",
        "models": [{ "id": "claude-sonnet-4-6", "label": "Sonnet 4.6", "isDefault": true }]
      },
      "claude-smart": {
        "extends": "claude",
        "label": "Claude (Smart)",
        "models": [{ "id": "claude-opus-4-6", "label": "Opus 4.6", "isDefault": true }]
      }
    }
  }
}
```

---

## Custom binary for a provider

Override the command used to launch any provider with the `command` field. This is an array where the first element is the binary and the rest are arguments.

### Override a built-in provider's binary

```json
{
  "agents": {
    "providers": {
      "claude": {
        "command": ["/opt/claude-nightly/claude"]
      }
    }
  }
}
```

### Use a custom wrapper script

```json
{
  "agents": {
    "providers": {
      "claude": {
        "command": ["/usr/local/bin/my-claude-wrapper", "--verbose"]
      }
    }
  }
}
```

### Custom binary on a derived provider

```json
{
  "agents": {
    "providers": {
      "my-codex": {
        "extends": "codex",
        "label": "Codex (Custom Build)",
        "command": ["/home/user/codex-dev/target/release/codex"]
      }
    }
  }
}
```

The `command` array completely replaces the default command for that provider. The binary must exist on the system — Otto checks for its availability and will mark the provider as unavailable if not found.

### Pi-compatible forks with their own session directory

OMP already ships as a built-in provider option. It is disabled by default; enable it with:

```json
{
  "agents": {
    "providers": {
      "omp": { "enabled": true }
    }
  }
}
```

For other providers that keep Pi's `--mode rpc` API but write sessions somewhere else, extend `pi`, replace the command, and provide the JSONL session directory:

```json
{
  "agents": {
    "providers": {
      "my-pi-fork": {
        "extends": "pi",
        "label": "My Pi Fork",
        "command": ["my-pi-fork"],
        "params": {
          "sessionDir": "~/.my-pi-fork/sessions"
        }
      }
    }
  }
}
```

The session directory is used only for importing sessions that were started outside Otto. Launching and resuming still go through the configured command, so this example resumes with `my-pi-fork --mode rpc --session <session-file>`.

---

## Disabling a provider

Set `enabled: false` to hide a provider from the provider list. The provider will not appear in the app or CLI.

```json
{
  "agents": {
    "providers": {
      "copilot": { "enabled": false },
      "codex": { "enabled": false }
    }
  }
}
```

This works for both built-in and custom providers. To re-enable, set `enabled: true` or remove the `enabled` field entirely. Most providers are enabled by default; OMP is intentionally disabled by default and requires `enabled: true`.

---

## ACP providers

The [Agent Client Protocol (ACP)](https://agentclientprotocol.com) is an open standard for communication between editors and AI coding agents — think LSP but for AI agents. Any agent that supports ACP can be added to Otto as a custom provider.

ACP agents communicate over JSON-RPC 2.0 on stdio. Otto spawns the agent process and talks to it through stdin/stdout.

Otto also ships an in-app provider catalog (Settings → Add provider) for common agents, including CodeWhale, Cursor, DeepAgents, DimCode, Gemini CLI, Hermes, Qwen Code, and Kimi Code. ACP catalog entries create the same `extends: "acp"` provider config shown below. The catalog also carries featured endpoint presets (e.g. [OpenAI Compatible](#openai-compatible-local-models)) that use the native `extends: "openai-compatible"` provider type instead.

### Adding a generic ACP provider

Set `extends: "acp"` and provide a `command`:

```json
{
  "agents": {
    "providers": {
      "my-agent": {
        "extends": "acp",
        "label": "My Agent",
        "command": ["my-agent-binary", "--acp"],
        "env": {
          "MY_API_KEY": "..."
        }
      }
    }
  }
}
```

Required fields for ACP providers:

- `extends: "acp"`
- `label`
- `command` — the command to spawn the agent process (must support ACP over stdio)

Otto tools such as subagent creation come from the shared internal tool catalog. ACP providers receive those tools through the MCP fallback by default because ACP exposes `mcpServers`, not Otto's native tool catalog. Some ACP adapters cannot create sessions when `mcpServers` is non-empty. Disable injected MCP for those providers with `params.supportsMcpServers: false`:

```json
{
  "agents": {
    "providers": {
      "my-agent": {
        "extends": "acp",
        "label": "My Agent",
        "command": ["my-agent", "acp"],
        "params": {
          "supportsMcpServers": false
        }
      }
    }
  }
}
```

### Generic ACP diagnostics

Otto diagnostics for `extends: "acp"` providers report the configured command, resolved launcher binary, version output, ACP `initialize`, ACP `session/new`, model count, modes, and final status.

For package-runner commands such as `npx -y @google/gemini-cli --acp`, the version probe keeps the package spec and runs `npx -y @google/gemini-cli --version`. This diagnoses the actual agent package instead of only proving that `npx` exists.

ACP probes use short timeouts and browser-suppression environment variables so agents that enter an auth/browser flow fail as a diagnostic error instead of hanging the provider screen.

### Example: Google Gemini CLI

[Gemini CLI](https://github.com/google-gemini/gemini-cli) supports ACP via the `--acp` flag.

1. Install: `npm install -g @google/gemini-cli` or see [Gemini CLI docs](https://github.com/google-gemini/gemini-cli)
2. Authenticate with Google (Gemini CLI handles its own auth)
3. Add to config.json:

```json
{
  "agents": {
    "providers": {
      "gemini": {
        "extends": "acp",
        "label": "Google Gemini",
        "command": ["gemini", "--acp"]
      }
    }
  }
}
```

Ref: [Gemini CLI ACP mode docs](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/acp-mode.md)

### Example: Hermes (Nous Research)

[Hermes](https://github.com/NousResearch/hermes-agent) is an open-source coding agent by Nous Research with persistent memory and multi-provider LLM support. It supports ACP via the `acp` subcommand.

1. Install: `curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash`
2. Install ACP support: `pip install -e '.[acp]'`
3. Configure Hermes credentials in `~/.hermes/`
4. Add to config.json:

```json
{
  "agents": {
    "providers": {
      "hermes": {
        "extends": "acp",
        "label": "Hermes",
        "description": "Nous Research self-improving AI agent",
        "command": ["hermes", "acp"]
      }
    }
  }
}
```

Ref: [Hermes ACP docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/acp)

### How ACP providers work in Otto

When you launch an agent with an ACP provider:

1. Otto spawns the process using the configured `command`
2. Sends an `initialize` JSON-RPC request over stdin
3. The agent responds with its capabilities, available modes, and models
4. Otto creates a session and sends prompts through the ACP protocol
5. The agent streams responses, tool calls, and permission requests back over stdout

Models and modes are discovered dynamically at runtime from the agent process. If you want to override the model list (e.g., to curate which models appear in the UI), use the `models` field:

```json
{
  "agents": {
    "providers": {
      "my-agent": {
        "extends": "acp",
        "label": "My Agent",
        "command": ["my-agent", "--acp"],
        "models": [
          { "id": "fast-model", "label": "Fast", "isDefault": true },
          { "id": "smart-model", "label": "Smart" }
        ]
      }
    }
  }
}
```

Profile models (defined in config.json) completely replace runtime-discovered models when present.

If you want to keep runtime-discovered models and add or relabel a few entries, use `additionalModels` instead.

Example: add an experimental model while keeping every model the provider discovers at runtime:

```json
{
  "agents": {
    "providers": {
      "my-agent": {
        "extends": "acp",
        "label": "My Agent",
        "command": ["my-agent", "--acp"],
        "additionalModels": [
          { "id": "experimental-model", "label": "Experimental", "isDefault": true }
        ]
      }
    }
  }
}
```

Example: relabel a discovered model without replacing the full list:

```json
{
  "agents": {
    "providers": {
      "my-agent": {
        "extends": "acp",
        "label": "My Agent",
        "command": ["my-agent", "--acp"],
        "additionalModels": [{ "id": "provider/model-id", "label": "My Preferred Label" }]
      }
    }
  }
}
```

When an `additionalModels` entry has the same `id` as a discovered model, it updates that model in place.

---

## Provider override reference

Every entry under `agents.providers` accepts these fields:

| Field              | Type                      | Required          | Description                                                        |
| ------------------ | ------------------------- | ----------------- | ------------------------------------------------------------------ |
| `extends`          | `string`                  | Yes (custom only) | Built-in provider ID to inherit from, or `"acp"`                   |
| `label`            | `string`                  | Yes (custom only) | Display name in the UI                                             |
| `description`      | `string`                  | No                | Short description shown in the UI                                  |
| `command`          | `string[]`                | Yes (ACP only)    | Command to spawn the agent process                                 |
| `env`              | `Record<string, string>`  | No                | Environment variables to set for the agent process                 |
| `params`           | `Record<string, unknown>` | No                | Provider-specific options such as `supportsMcpServers: false`      |
| `models`           | `ProviderProfileModel[]`  | No                | Static model list (overrides runtime discovery)                    |
| `additionalModels` | `ProviderProfileModel[]`  | No                | Static model additions (merged with runtime discovery or `models`) |
| `disallowedTools`  | `string[]`                | No                | Tool names to disable for this provider (e.g. `["WebSearch"]`)     |
| `enabled`          | `boolean`                 | No                | Set to `false` to hide the provider (default: `true`)              |
| `order`            | `number`                  | No                | Sort order in the provider list                                    |

### Model definition

Each entry in the `models` array:

| Field             | Type               | Required | Description                           |
| ----------------- | ------------------ | -------- | ------------------------------------- |
| `id`              | `string`           | Yes      | Model identifier sent to the provider |
| `label`           | `string`           | Yes      | Display name in the UI                |
| `description`     | `string`           | No       | Short description                     |
| `isDefault`       | `boolean`          | No       | Mark as the default model selection   |
| `thinkingOptions` | `ThinkingOption[]` | No       | Available thinking/reasoning levels   |

### Thinking option

| Field         | Type      | Required | Description                         |
| ------------- | --------- | -------- | ----------------------------------- |
| `id`          | `string`  | Yes      | Thinking option identifier          |
| `label`       | `string`  | Yes      | Display name                        |
| `description` | `string`  | No       | Short description                   |
| `isDefault`   | `boolean` | No       | Mark as the default thinking option |

### Claude settings.json model discovery

The built-in `claude` provider appends concrete model IDs from `~/.claude/settings.json` to its first-party Claude model list. Otto reads the top-level `model` field and these `env` keys: `ANTHROPIC_MODEL`, `ANTHROPIC_SMALL_FAST_MODEL`, `ANTHROPIC_DEFAULT_OPUS_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`, and `ANTHROPIC_DEFAULT_HAIKU_MODEL`.

This lets users who already configured Claude Code for Bedrock, OpenRouter, ollama, Z.AI, or another Anthropic-compatible gateway select the exact model ID in Otto. When `agents.providers.claude.models` is set it **replaces** both the hardcoded first-party Claude list and any settings.json-discovered entries; use `agents.providers.claude.additionalModels` to keep the first-party list and append curated entries on top.

### Gotcha: `extends: "claude"` with third-party endpoints

When a custom provider extends `"claude"` but points `ANTHROPIC_BASE_URL` at a non-Anthropic API (Z.AI, Alibaba/Qwen, proxies), the Claude Agent SDK may try to use Anthropic-only server-side tools like `WebSearch`. Third-party APIs don't support these tools, causing errors.

Use `disallowedTools` to disable unsupported tools:

```json
{
  "agents": {
    "providers": {
      "my-proxy": {
        "extends": "claude",
        "label": "My Proxy",
        "env": {
          "ANTHROPIC_BASE_URL": "https://my-proxy.example.com/v1"
        },
        "disallowedTools": ["WebSearch"]
      }
    }
  }
}
```

### Valid `extends` values

Built-in providers: `claude`, `codex`, `copilot`, `opencode`, `pi`, `omp`

Special values:

- `acp` — creates a generic ACP provider (requires `command`)
- `openai-compatible` — served natively by the daemon against an OpenAI-compatible HTTP endpoint (requires `env.OPENAI_BASE_URL`; see [OpenAI Compatible](#openai-compatible-local-models))

### Full example

A config.json with multiple custom providers:

```json
{
  "version": 1,
  "agents": {
    "providers": {
      "copilot": { "enabled": false },

      "zai": {
        "extends": "claude",
        "label": "ZAI",
        "env": {
          "ANTHROPIC_AUTH_TOKEN": "<zai-api-key>",
          "ANTHROPIC_BASE_URL": "https://api.z.ai/api/anthropic",
          "API_TIMEOUT_MS": "3000000"
        },
        "disallowedTools": ["WebSearch"],
        "models": [
          { "id": "glm-4.5-air", "label": "GLM 4.5 Air" },
          { "id": "glm-5-turbo", "label": "GLM 5 Turbo", "isDefault": true },
          { "id": "glm-5.1", "label": "GLM 5.1" }
        ]
      },

      "qwen": {
        "extends": "claude",
        "label": "Qwen (Alibaba)",
        "env": {
          "ANTHROPIC_AUTH_TOKEN": "sk-sp-<coding-plan-key>",
          "ANTHROPIC_BASE_URL": "https://coding-intl.dashscope.aliyuncs.com/apps/anthropic"
        },
        "disallowedTools": ["WebSearch"],
        "models": [
          { "id": "qwen3.5-plus", "label": "Qwen 3.5 Plus", "isDefault": true },
          { "id": "qwen3-coder-next", "label": "Qwen 3 Coder Next" }
        ]
      },

      "gemini": {
        "extends": "acp",
        "label": "Google Gemini",
        "command": ["gemini", "--acp"]
      },

      "hermes": {
        "extends": "acp",
        "label": "Hermes",
        "command": ["hermes", "acp"]
      }
    }
  }
}
```
