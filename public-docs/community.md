---
title: Community projects
description: Community-built tools and integrations for Otto, including self-hosted Docker builds and an alternative relay.
nav: Community
title: Related projects
description: Projects related to Otto and built by the community.
nav: Related projects
order: 7
category: Getting started
---

# Community projects

Projects built by the Otto community. These **aren't official Otto projects** and aren't covered by Otto's support, but they're useful starting points, especially for self-hosting. Review the code before running anything that touches your machine or your agents.
These projects are related to Otto and built by the community.

## Tools and integrations

| Project                                                                                    | What it does                                                                                                                         |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| [Otto for VS Code](https://marketplace.visualstudio.com/items?itemName=hinnes.otto-vscode) | Opens the matching Otto project or worktree in VS Code and adds agent chat, file mentions, and editor links.                         |
| [VS Code Web plugin](https://github.com/itsjustanks/otto-plugin-vscode-web)                | Opens a live Otto worktree in `vscode.dev` through a VS Code tunnel, including workspaces on headless hosts.                         |
| [Otto Icon](https://github.com/gpambrozio/otto-menubar)                                    | Shows workspace status across Otto hosts in the macOS menu bar and opens a workspace with one click.                                 |
| [Otto Cross-Daemon Comms](https://github.com/xpufx/otto-cross-daemon-comms)                | Lets agents communicate with agents on another Otto daemon through an MCP server.                                                    |
| [Otto Antigravity ACP](https://github.com/tiezbro/otto-agy-acp)                            | Connects Google Antigravity CLI to Otto through ACP, with Otto-specific context, permissions, and concurrency handling.              |
| [Desvio](https://github.com/cleiter/desvio)                                                | Rebuilds a personal fork from a set of branches, using an agent to resolve new conflicts and Git rerere to replay known resolutions. |

## Hosting and infrastructure

## Self-hosting

- **[blockfeed/otto-selfhosted](https://github.com/blockfeed/otto-selfhosted)**, a Docker build that runs the Otto web UI connected to a self-hosted local daemon. A good reference if you want a containerized setup. For the built-in way to serve the UI from the daemon, see [Self-hosting the web UI](/docs/web-ui).

- **[zenghongtu/otto-relay](https://github.com/zenghongtu/otto-relay)**, a lightweight self-hosted relay server for Otto, written in Go. Run your own relay instead of the hosted one for fully self-hosted remote access. For how the relay fits into Otto's connection model, see [Security](/docs/security).

- **[otto-vscode](https://marketplace.visualstudio.com/items?itemName=hinnes.otto-vscode)**, a VS Code extension.

## Add your project

Built something for Otto, a relay, a deployment recipe, an integration, a client? Open a pull request or an issue on [GitHub](https://github.com/Draek2077/otto-code) to get it listed here.
| Project | What it does |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| [Otto Self-hosted](https://github.com/blockfeed/otto-selfhosted) | Packages the Otto web UI and a local daemon as a Docker deployment. |
| [Devbox Fleet](https://github.com/omrihaviv/devbox-fleet) | Provisions and maintains per-developer GCP devboxes with Otto, coding agents, and Tailscale access. |
