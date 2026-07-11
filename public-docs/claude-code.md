---
title: Claude Code
description: How Otto runs Claude Code and how usage counts against your Claude plan.
nav: Claude Code
order: 23
category: Providers
---

# Claude Code

Otto runs Claude Code through the official `claude` CLI, using the Claude Agent SDK — the same mechanism Claude Desktop uses internally. Install and authenticate the `claude` CLI on the machine running the Otto daemon, and Claude Code shows up as a provider like any other.

## Usage and limits

Claude Code sessions started from Otto authenticate through your existing `claude` CLI login and draw from your Claude subscription's usage limits — the same pool as running `claude` in a terminal.

In June 2026, Anthropic announced a change that would have moved Claude Agent SDK usage — including third-party apps like Otto — onto a separate monthly credit pool. Anthropic has since paused that change before it took effect. Per their support article, nothing has changed: Agent SDK, `claude -p`, and third-party app usage all continue to draw from your subscription's usage limits. See ["Use the Claude Agent SDK with your Claude plan"](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) for the current state. If the policy changes again, this page will be updated.

## Terminal sessions

Otto also has first-class terminal support, so you can run Claude Code interactively in an Otto terminal instead of (or alongside) chat sessions. Terminal usage works exactly like any other terminal.

## See also

- [Anthropic: Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
- [Custom providers](/docs/custom-providers), for custom binaries, third-party endpoints, or multiple Claude profiles.
- [Supported providers](/docs/supported-providers), for other agents you can run alongside Claude Code.
