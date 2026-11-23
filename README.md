<!-- OTTO(identity): Otto distribution names; internal Paseo API identifiers stay upstream. -->
<p align="center">
  <img src="packages/website/public/logo.svg" width="64" height="64" alt="Otto logo">
</p>

<h1 align="center">Otto</h1>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <a href="https://github.com/Draek2077/otto-code/stargazers">
    <img src="https://img.shields.io/github/stars/Draek2077/otto-code?style=flat&logo=github" alt="GitHub stars">
  </a>
  <a href="https://github.com/Draek2077/otto-code/releases">
    <img src="https://img.shields.io/github/v/release/Draek2077/otto-code?style=flat&logo=github" alt="GitHub release">
  </a>
</p>

<p align="center">One interface for Claude Code, Codex, Copilot, OpenCode, Pi, Antigravity, and Muse Code agents.</p>

Otto is an open source agentic development environment for desktop, mobile, web, and CLI. Open the desktop app and work: agents, editor, terminals, diffs, pull requests, and a browser in one window. Run many agents at once, each in its own worktree, on one machine or several. The mobile app is the full app, native on iOS and Android.

- **Parallel agents:** Run many agents at once, each in its own worktree.
- **Built-in orchestration:** Agents in Otto can create worktrees, launch other agents, and talk to them, across providers.
- **Complete development workflow:** Edit files, review diffs, open pull requests, and run terminals, in split panes you arrange how you want.
- **Self-hosted:** Agents run on your machine with your full dev environment. Use your tools, your configs, and your skills.
- **Multi-provider:** Claude Code, Codex, Copilot, OpenCode, Pi, Antigravity, and Muse Code through the same interface. Pick the right model for each job.
- **Voice control:** Dictate tasks or talk through problems in voice mode. Hands-free when you need it.
- **Cross-device:** iOS, Android, desktop, web, and CLI. Start work at your desk, check in from your phone, script it from the terminal.
- **Privacy-first:** Otto doesn't have any telemetry, tracking, or forced log-ins.

[Run parallel tasks in Otto](https://otto-code.me/docs/parallel-development): start agents in separate worktrees, review their diffs, run each app, and check it in the built-in browser.

## Plugins

Plugins run on the daemon and show up in every client you connect, with the same UI on desktop, web,
iOS, and Android. Write a plugin once and it is on your phone.

- **UI:** screens, sidebar items, workspace panels, Command Center items, slash commands, composer pills, attachment sources, timeline items, themes.
- **Agent lifecycle:** change configuration, environment, and MCP servers, answer permissions, follow up when a turn ends.
- **Providers:** add a coding agent as a provider.

Install from the registry with `otto plugin add owner/slug`, or from Git or a local directory.

**[Paseo plugin registry](https://paseo.sh/plugins)** · **[Plugin docs](public-docs/plugins/index.md)**

Plugins run with access to your daemon machine and inside connected clients; install only code you trust.

## Getting Started

Otto runs a local server called the daemon that manages your coding agents. Clients like the desktop app, mobile app, web app, and CLI connect to it.

### Prerequisites

You need at least one agent CLI installed and configured with your credentials:

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Codex](https://github.com/openai/codex)
- [GitHub Copilot](https://github.com/features/copilot/cli/)
- [OpenCode](https://github.com/anomalyco/opencode)
- [Pi](https://pi.dev)
- [Antigravity](https://otto-code.me/docs/supported-providers#antigravity)
- [Muse Code](https://otto-code.me/docs/muse-code)

### Desktop app (recommended)

Download it from [otto-code.me/download](https://otto-code.me/download) or the [GitHub releases page](https://github.com/Draek2077/otto-code/releases). Open the app and the daemon starts automatically. Nothing else to install.

To connect from your phone, open **Settings → your host → Pair Device**.

### Server

For a server, a VM, or any machine without the desktop app. Install the CLI and start the daemon:

```bash
npm install -g @otto-code/cli
otto
```

Otto starts, then asks whether to enable the end-to-end encrypted relay for device pairing. If you decline, connect directly over TCP, Tailscale, or another VPN. The desktop, mobile, and web apps connect to this daemon like any other host.

For full setup and configuration, see:

- [Docs](https://otto-code.me/docs)
- [Connectivity guide](https://otto-code.me/docs/connectivity)
- [Configuration reference](https://otto-code.me/docs/configuration)

### Docker

Run the Otto daemon and self-hosted web UI in Docker:

```bash
docker run -d --name otto \
  -p 6868:6868 \
  -e PASEO_PASSWORD=change-me \
  -v "$PWD/otto-home:/home/otto" \
  -v "$PWD:/workspace" \
  ghcr.io/draek2077/otto-code:latest
```

Open `http://localhost:6868` after it starts. Extend the base image with the agent CLIs you use, then provide credentials through environment variables or the persistent `/home/otto` volume. See the [Docker documentation](docs/docker.md) for full setup details.

## CLI

Everything you can do in the app, you can do from the terminal.

```bash
otto run --provider claude/opus-4.6 "implement user authentication"
otto run --provider codex/gpt-5.5 --worktree feature-x "implement feature X"

otto ls                           # list running agents
otto attach abc123                # stream live output
otto send abc123 "also add tests" # follow-up task

# run on a remote daemon; --cwd is a path on that host
otto run --host workstation.local:6868 --cwd /workspace "run the full test suite"
```

See the [full CLI reference](https://otto-code.me/docs/cli) for more.

## TypeScript SDK

Build issue integrations, dashboards, and orchestration services with `@otto-code/client`:

```ts
import { createPaseoClient } from "@otto-code/client";

const client = createPaseoClient({ url: "ws://127.0.0.1:6868/ws" });
await client.connect();

const agent = await client.agents.create({
  config: { provider: "codex/gpt-5.5" },
  cwd: "/Users/me/dev/storefront",
  prompt: "Review the current diff and name the riskiest change.",
});

const result = await agent.waitForFinish();
console.log(result.lastMessage);

await client.close();
```

See the [SDK quickstart](https://otto-code.me/docs/sdk/quickstart), [recipes](https://otto-code.me/docs/sdk/recipes), and [API reference](https://otto-code.me/docs/sdk/reference).

## Skills

The upstream Paseo skills teach agents to orchestrate work. Their filenames and API identifiers stay upstream; use the `otto` command for this distribution.

```bash
npx skills add getpaseo/paseo
```

Then use them in any agent conversation:

- `/paseo-handoff` — hand off work between agents. I use this to plan with Claude and then handoff to Codex to implement.
- `/paseo-advisor` — spin up a single agent as an advisor for a second opinion, without delegating the work itself.
- `/paseo-committee` — form a committee of two contrasting agents to step back, do root cause analysis, and produce a plan.

## Development

Quick monorepo package map:

- `packages/server`: Otto daemon (agent process orchestration, WebSocket API, MCP server)
- `packages/app`: Expo client (iOS, Android, web)
- `packages/cli`: `otto` CLI for daemon and agent workflows
- `packages/desktop`: Electron desktop app
- `packages/relay`: Relay transport and encryption used by the daemon and clients
- `packages/website`: Marketing site and documentation (`otto-code.me`)

Common commands:

```bash
# run all local dev services
npm run dev

# run individual surfaces
npm run dev:server
npm run dev:app
npm run dev:desktop
npm run dev:website

# build the server stack
npm run build:server

# repo-wide checks
npm run typecheck
```

## Related projects

- [getpaseo/paseo-relay](https://github.com/getpaseo/paseo-relay) — official distributed relay, written in Elixir
- [paseo-vscode](https://marketplace.visualstudio.com/items?itemName=hinnes.paseo-vscode) — VS Code extension

## License and upstream

Otto is distributed under [AGPL-3.0-or-later](LICENSE). It is built on
[Paseo](https://github.com/getpaseo/paseo); the upstream license is retained in
[LICENSE-Paseo](LICENSE-Paseo), with attribution in [NOTICE](NOTICE).
