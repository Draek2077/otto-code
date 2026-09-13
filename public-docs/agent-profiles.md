---
title: Agent profiles
description: Otto calls saved agent profiles Personalities.
nav: Agent profiles
order: 32
category: Orchestration
---

# Agent profiles

Otto calls saved agent profiles **Personalities**. Open **Settings → your host → Teams**
to configure a named identity with its provider, model, mode, effort, instructions, and delegation
guidance. See [Personalities](/docs/personalities) for the current controls and launch behavior.

Agents discover these templates with `list_agent_profiles` and select one through
`create_chat`'s `agentProfile` argument. They do not need to copy each setting into a separate launch
request. Explicit launch settings can override individual saved values.

A [custom provider profile](/docs/custom-providers#multiple-profiles) is different: it configures a
provider endpoint, command, credentials, or model catalog in the host's `agents.providers` map.
A Personality chooses a configured provider and adds its identity and launch settings.
