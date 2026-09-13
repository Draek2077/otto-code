---
title: Paseo Hub reference
description: Upstream Paseo Hub reference. Hub is disabled in Otto.
nav: Overview
order: 60
category: Hub
---

# Paseo Hub reference

> **Upstream reference.** This page describes Paseo Hub as documented with Paseo v0.8.0. Hub is disabled in Otto; these commands require a separate Paseo installation and Hub service. Package names, configuration expressions and service addresses below belong to Paseo. They are not Otto hosting or installation instructions. See the [reference overview](/docs/hub).

A daemon runs agents on one machine, for you. Paseo Hub is the layer above your daemons. You register your daemons with it, and it gives them capabilities they do not have on their own.

```text
             Hub
    ┌─────────┼─────────┐
    ▼         ▼         ▼
 laptop    devbox    build server
```

The upstream reference describes:

- Agents that start on their own, from activity in GitHub, Slack, and Discord.
- Triggers you can keep in a repository and deploy from the CLI.
- A record of everything that arrived, what it matched, and what ran.
- One place for your team to see all of it.

Your daemons keep running agents where they always did. Hub decides when to ask them to.

## What lives in your repository

`paseo hub init` creates one self-contained starter trigger:

```text
.paseo/
└── triggers/
    └── slack-help.yml
```

The file names the app connection, allowed user, daemon, working directory, agent runtime, prompt, and outputs. Setup validates it and asks whether to deploy. Mentioning the bot then starts an agent on your machine. [Quickstart](/docs/hub/quickstart) runs it end to end; the [generated starter trigger](/docs/hub/configuration#generated-starter-trigger) shows what setup wrote.

This reference is retained from the [Paseo v0.8.0 source](https://github.com/getpaseo/paseo/tree/v0.8.0/public-docs/hub). It is not a live availability check or a claim that the separate Hub service ships with Otto.

## Reading order

1. [Quickstart](/docs/hub/quickstart)
2. [How it works](/docs/hub/concepts)
3. [Daemons](/docs/hub/daemons)
4. [Triggers](/docs/hub/triggers)
5. [Workflows](/docs/hub/workflows)
6. [GitHub access](/docs/hub/github)
7. [Configuration](/docs/hub/configuration)
8. [Security](/docs/hub/security)

If a workflow accepts requests from GitHub, Slack, Discord, or the API, read [Hub security](/docs/hub/security) before giving an agent access to a working directory or output capability.

## Run Hub yourself

Start on your machine with the embedded database, then add PostgreSQL or a public deployment only when you need them. [Self-hosting](/docs/hub/self-hosting) covers each step.

[Hosted Hub](/docs/hub/hosted) uses the same triggers, daemons, and activity model. [Paseo manages its hosted service information](https://hub.paseo.sh). This reference does not establish current availability, pricing or account access.
