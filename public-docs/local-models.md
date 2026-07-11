---
title: Local models
description: Connect LM Studio, Ollama, or any OpenAI-compatible server directly, a CLI-free way to run local and self-hosted models alongside your other providers.
nav: Local models
order: 24
category: Providers
---

# Local models

Every other provider in Otto works the same way: you install an agent CLI (Claude Code, Codex, an ACP agent) and Otto launches it as a subprocess. That's the right default, and it's how you get **frontier-model support**, Otto rides on whatever the CLI maintainer ships, with no lag on Otto's side.

Local inference servers don't have a CLI in front of them, though. LM Studio, Ollama, vLLM, llama.cpp, and similar tools expose an OpenAI-compatible HTTP API instead. For those, and for any hosted gateway that speaks the same shape, Otto connects **natively**: the daemon talks to the endpoint directly over HTTP, no subprocess, no CLI to install. It's a different mechanism, worth understanding on its own terms, and a genuinely useful complement to CLI-based providers when a local or self-hosted model is what you want to run.

## Setup

1. Start a local server. For LM Studio: install it, download a model, then Developer tab → Start Server (or `lms server start` from the CLI). Default address is `http://localhost:1234`.
2. In Otto, go to Settings → Add provider. OpenAI Compatible is a featured preset, one click fills in the connection (it defaults to LM Studio's local port). For anything else (Ollama, vLLM, a custom gateway), edit the Server URL, or add a provider that extends `openai-compatible` and point it at your server, see [Custom providers](/docs/custom-providers#openai-compatible-local-models) for the exact config.
3. Server URL and API key are editable afterwards from the provider's settings sheet, under **Connection**. Most local servers don't require an API key at all.

## How the connection works

- **Models are discovered automatically.** Otto calls `GET {server}/models` and lists whatever the server currently has loaded, no need to hardcode model IDs. If you'd rather pin a fixed list, setting `models` in the provider config replaces discovery.
- **Status reflects reachability, not installation.** If the server is running, the provider shows Available with a live model count. If it isn't, Otto shows an error explaining the endpoint can't be reached, rather than treating it as "not installed."
- **Chat turns stream over the standard `chat/completions` endpoint.** Reasoning models that emit a separate reasoning stream have it rendered as reasoning output, the same as any other provider's. How hard they reason is set by the shared [Effort](/docs/providers) control, mapped to whatever levels the model advertises.
- **Tool calling depends on the model.** Models that support OpenAI-style function calling get real tool use in Otto: reading and writing files, running commands, searching the codebase. Models without function-calling support fall back to plain chat, the model just talks, it can't act on your project.
- **Otto's own tools are available too**, agent management, terminals, schedules, and the [Preview](/docs/preview) toolset (starting dev servers, browser verification), injected directly into the model's tool list. This is what lets a local model drive the same preview-and-verify workflow as Claude Code or Codex, even without an MCP client of its own. You can scope exactly which of those tool groups a given local provider sees from its settings sheet, useful for keeping a smaller model's toolset focused, or for turning off browser control on a model you don't fully trust with it.
- **Permission modes work the same as any other provider.** Always Ask prompts before edits, commands, and any Otto tool that acts (browser interaction, terminals, agent management); Accept Edits auto-approves file changes and browser/preview interaction but still asks before running commands or anything execute-class; Read Only offers no write or Otto tools at all; and unattended mode skips confirmation entirely. Read-only tools (snapshots, logs, listings) never prompt in any mode.

## Why this is worth having alongside CLI providers

CLI-based providers are the primary path for a reason, they're maintained by the model vendor, they get frontier capability the moment it ships, and Otto doesn't have to reimplement anything. Nothing here changes that.

What the direct-endpoint path adds is optionality: models that run entirely on your own hardware, with no account, no per-token billing, and no dependency on a vendor's CLI existing at all. That matters for privacy-sensitive work, offline development, experimenting with open-weight models, or simply routing a cheap/fast local model at throwaway tasks while your CLI-based provider handles the ones that need a frontier model's judgment. Otto is happy to run both side by side in the same project.

## Current limitations

- Tool use requires a function-calling-capable model. Otto doesn't simulate function calling for models that don't support it.
- No MCP server passthrough yet, the daemon's built-in toolset is what's available, not arbitrary MCP servers you'd otherwise attach to a CLI-based agent.
- Remote local servers work fine (e.g. LM Studio running on another machine over Tailscale or your LAN), just point the connection at that host instead of localhost.

## See also

- [Providers](/docs/providers), how Otto's provider model works in general.
- [Custom providers](/docs/custom-providers#openai-compatible-local-models), the full config reference, including scoping Otto's tools with `ottoToolGroups`.
- [Preview](/docs/preview), the dev-server and browser-verification toolset local models can drive through Otto's injected tools.
- [Supported providers](/docs/supported-providers), the full provider list.
