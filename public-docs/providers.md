---
title: Providers
description: How Otto thinks about coding agents, wrapping existing CLIs, native vs ACP support, and where to go next.
nav: Providers
order: 20
category: Providers
---

# Providers

Otto doesn't ship its own coding agent. It launches and supervises **existing CLIs you've already installed and authenticated**, Claude Code, Codex, OpenCode, Cursor, Gemini, and the rest. Your subscriptions, your config, your skills, your MCP servers all stay intact. Otto adds the assistant environment on top — a UI, a CLI, a relay, orchestration, browser-verified previews, and artifacts — the same tooling for every provider, cloud or local.

## Mental model

A provider is the contract between Otto and one external agent CLI: how to launch it, how to stream its output, how to send input back, what modes it supports. The actual binary lives on your machine and runs as a normal subprocess.

## Two tiers, both CLI-based

- **Native support**, Otto ships a bundled adapter for the major agents (Claude Code, Codex, OpenCode, pi). Auto-discovered when the underlying CLI is installed, with mode metadata and voice support where applicable.
- **ACP catalog**, any agent speaking the [Agent Client Protocol](https://agentclientprotocol.com) is supported through a generic adapter. Otto ships a curated catalog of one-click installs (Cursor, Gemini, GitHub Copilot, Hermes, Kimi, Qwen Code, and 25+ more), and you can add any other ACP agent yourself.

Either way, **you install the underlying CLI**. Otto runs it as a subprocess. This is the right default: it's how you get frontier-model support, since it's the same CLI Anthropic, OpenAI, and the rest ship and update, with no reimplementation lag on Otto's side.

## A third way: talking to a model server directly

Not every model worth running has a CLI in front of it. Local inference servers, LM Studio, Ollama, vLLM, llama.cpp, expose an HTTP API instead, and plenty of hosted gateways speak the same shape. For these, Otto skips the subprocess entirely and talks to the endpoint itself, the daemon becomes the agent loop, not just a supervisor around one.

This isn't a replacement for CLI-based providers, it's for the case CLI adapters don't cover: a model with no CLI at all, usually because it's running locally on your own hardware. See [Local models](/docs/local-models) for how the mechanism works and [Custom providers](/docs/custom-providers#openai-compatible-local-models) for the config reference.

## Where to go next

- [Supported providers](/docs/supported-providers), the full list with install links.
- [Local models](/docs/local-models), connect LM Studio or any OpenAI-compatible server directly, no CLI required.
- [Custom providers](/docs/custom-providers), add your own provider, point an existing one at a different endpoint, run multiple profiles, or override the binary in `~/.otto/config.json`.
- [otto-code.me/agents](/agents), per-agent landing page for each supported provider.
