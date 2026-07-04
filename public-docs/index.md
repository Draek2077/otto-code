---
title: Getting started
description: Install Otto and start running coding agents from anywhere.
nav: Getting started
order: 1
category: Getting started
---

# Getting started

Otto runs your coding agents on your machine and gives you a mobile, desktop, web, and CLI client to drive them from anywhere. Three common ways to install.

## Desktop app (recommended)

Download from [otto-code.ai/download](https://otto-code.ai/download) or the [GitHub releases page](https://github.com/otto-code-ai/otto-code/releases). Open it and you're done.

The desktop app bundles its own daemon and starts it automatically, no separate install required. On first launch you'll see a brief startup screen, then connect from your phone by scanning the QR code in Settings.

## Server / CLI

For headless machines, dev boxes, or any setup where you want the daemon running without the desktop UI:

```bash
npm install -g @otto-code/cli
otto
```

Otto prints a QR code in the terminal. Scan it from the mobile app, or enter the daemon address manually from another client.

The daemon can also serve the browser web app itself, so you can use the full UI without the hosted app. See [Self-hosting the web UI](/docs/web-ui).

Configuration and local state live under `OTTO_HOME` (defaults to `~/.otto`).

## Docker

For servers, dev boxes, NAS devices, or homelab hosts, run the official image:

```bash
docker run -d --name otto \
  -p 6868:6868 \
  -e OTTO_PASSWORD=change-me \
  -v "$PWD/otto-home:/home/otto" \
  -v "$PWD:/workspace" \
  ghcr.io/otto-code-ai/otto-code:latest
```

Then open `http://localhost:6868`.

The image runs the daemon and serves the bundled web UI. It does not bundle agent CLIs, so extend it with the agents you use. See [Docker](/docs/docker) for Compose, reverse proxy, agent install, and security examples.

## Where next

- [Docker](/docs/docker), run the daemon and bundled web UI in a container.
- [Workspaces](/docs/workspaces), the project, workspace, and session model Otto is built around.
- [Providers](/docs/providers), what a provider is and how Otto wraps existing CLIs.
- [CLI reference](/docs/cli), every command.
- [Self-hosting the web UI](/docs/web-ui), serve the browser app from your own daemon.
- [GitHub repo](https://github.com/otto-code-ai/otto-code)
- [Report an issue](https://github.com/otto-code-ai/otto-code/issues)

## Prerequisites

Otto manages other agents, it doesn't ship one. Before it's useful, install at least one provider CLI yourself and make sure it works with your credentials. See [Supported providers](/docs/supported-providers) for the full list.

You'll also want the [GitHub CLI](https://cli.github.com/) (`gh`) installed and authenticated, Otto uses it for PR-aware worktrees and a few orchestration features.
