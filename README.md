<p align="center">
  <img src="packages/website/public/logo.svg" width="64" height="64" alt="Otto logo">
</p>

<h1 align="center">Otto</h1>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a>
</p>

<p align="center">
  <a href="https://github.com/otto-code-ai/otto-code/stargazers">
    <img src="https://img.shields.io/github/stars/otto-code-ai/otto-code?style=flat&logo=github" alt="GitHub stars">
  </a>
  <a href="https://github.com/otto-code-ai/otto-code/releases">
    <img src="https://img.shields.io/github/v/release/otto-code-ai/otto-code?style=flat&logo=github" alt="GitHub release">
  </a>
  <a href="https://x.com/moboudra">
    <img src="https://img.shields.io/badge/%40moboudra-555?logo=x" alt="X">
  </a>
  <a href="https://discord.gg/jz8T2uahpH">
    <img src="https://img.shields.io/badge/Discord-555?logo=discord" alt="Discord">
  </a>
  <a href="https://www.reddit.com/r/OttoAI/">
    <img src="https://img.shields.io/badge/Reddit-555?logo=reddit" alt="Reddit">
  </a>
</p>

<p align="center">One interface for Claude Code, Codex, Copilot, OpenCode, and Pi agents.</p>

> [!NOTE]
> **Otto is a modified fork of [Paseo](https://github.com/getpaseo)** (© 2025–present
> Mohamed Boudra), reworked toward an autonomous AI coding IDE. It remains licensed
> under AGPL-3.0. See [NOTICE](NOTICE) for full attribution and a summary of changes.

<p align="center">
  <img src="https://otto-code.ai/hero-mockup.png" alt="Otto app screenshot" width="100%">
</p>

<p align="center">
  <img src="https://otto-code.ai/mobile-mockup.png" alt="Otto mobile app" width="100%">
</p>

> [!NOTE]
> I'm a solo maintainer and don't always keep up with GitHub Issues daily.
> If something is urgent or blocking you, [Discord](https://discord.gg/jz8T2uahpH) is the fastest place to reach me.

---

Run agents in parallel on your own machines. Ship from your phone or your desk.

- **Self-hosted:** Agents run on your machine with your full dev environment. Use your tools, your configs, and your skills.
- **Multi-provider:** Claude Code, Codex, Copilot, OpenCode, and Pi through the same interface. Pick the right model for each job.
- **Voice control:** Dictate tasks or talk through problems in voice mode. Hands-free when you need it.
- **Cross-device:** iOS, Android, desktop, web, and CLI. Start work at your desk, check in from your phone, script it from the terminal.
- **Privacy-first:** Otto doesn't have any telemetry, tracking, or forced log-ins.

## Getting Started

Otto runs a local server called the daemon that manages your coding agents. Clients like the desktop app, mobile app, web app, and CLI connect to it.

### Prerequisites

You need at least one agent CLI installed and configured with your credentials:

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Codex](https://github.com/openai/codex)
- [GitHub Copilot](https://github.com/features/copilot/cli/)
- [OpenCode](https://github.com/anomalyco/opencode)
- [Pi](https://pi.dev)

### Desktop app (recommended)

Download it from [otto-code.ai/download](https://otto-code.ai/download) or the [GitHub releases page](https://github.com/otto-code-ai/otto-code/releases). Open the app and the daemon starts automatically. Nothing else to install.

To connect from your phone, scan the QR code shown in Settings.

### CLI / headless

Install the CLI and start Otto:

```bash
npm install -g @otto-code/cli
otto
```

This shows a QR code in the terminal. Connect from any client. This path is useful for servers and remote machines.

For full setup and configuration, see:

- [Docs](https://otto-code.ai/docs)
- [Configuration reference](https://otto-code.ai/docs/configuration)

### Docker

Run the Otto daemon and self-hosted web UI in Docker:

```bash
docker run -d --name otto \
  -p 6868:6868 \
  -e OTTO_PASSWORD=change-me \
  -v "$PWD/otto-home:/home/otto" \
  -v "$PWD:/workspace" \
  ghcr.io/otto-code-ai/otto-code:latest
```

Open `http://localhost:6868` after it starts. Extend the base image with the agent CLIs you use, then provide credentials through environment variables or the persistent `/home/otto` volume. See the [Docker documentation](docs/docker.md) for full setup details.

## CLI

Everything you can do in the app, you can do from the terminal.

```bash
otto run --provider claude/opus-4.6 "implement user authentication"
otto run --provider codex/gpt-5.4 --worktree feature-x "implement feature X"

otto ls                           # list running agents
otto attach abc123                # stream live output
otto send abc123 "also add tests" # follow-up task

# run on a remote daemon
otto --host workstation.local:6868 run "run the full test suite"
```

See the [full CLI reference](https://otto-code.ai/docs/cli) for more.

## Skills

Skills teach your agent to use Otto to orchestrate other agents.

```bash
npx skills add otto-code-ai/otto-code
```

Then use them in any agent conversation:

- `/otto-handoff` — hand off work between agents. I use this to plan with Claude and then handoff to Codex to implement.
- `/otto-loop` — loop an agent against clear acceptance criteria (aka Ralph loops), optionally with a verifier.
- `/otto-advisor` — spin up a single agent as an advisor for a second opinion, without delegating the work itself.
- `/otto-committee` — form a committee of two contrasting agents to step back, do root cause analysis, and produce a plan.

## Development

Quick monorepo package map:

- `packages/server`: Otto daemon (agent process orchestration, WebSocket API, MCP server)
- `packages/app`: Expo client (iOS, Android, web)
- `packages/cli`: `otto` CLI for daemon and agent workflows
- `packages/desktop`: Electron desktop app
- `packages/relay`: Relay package for remote connectivity
- `packages/website`: Marketing site and documentation (`otto-code.ai`)

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

## Community

- [paseo-relay](https://github.com/zenghongtu/paseo-relay) — self-hosted relay in Go (built for the upstream Paseo project)
- [paseo-vscode](https://marketplace.visualstudio.com/items?itemName=hinnes.paseo-vscode) — VS Code extension (built for the upstream Paseo project)

---

<p align="center">
  <a href="https://star-history.com/#otto-code-ai/otto-code&Date">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=otto-code-ai/otto-code&type=Date&theme=dark">
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=otto-code-ai/otto-code&type=Date">
      <img src="https://api.star-history.com/svg?repos=otto-code-ai/otto-code&type=Date" alt="Star history chart for otto-code-ai/otto-code" width="600" style="max-width: 100%;">
    </picture>
  </a>
</p>

## License

Otto is licensed under **AGPL-3.0**, the same license as the upstream project it is
based on. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

## Credits & attribution

Otto is a modified fork of **[Paseo](https://github.com/getpaseo)**, created by
**Mohamed Boudra** and contributors, © 2025–present. Paseo is licensed under
AGPL-3.0; Otto continues under the same license as required by its copyleft terms.

The original copyright notice is preserved verbatim in [LICENSE](LICENSE). A summary
of what Otto changes relative to Paseo, along with full attribution, lives in
[NOTICE](NOTICE). Otto is an independent project and is not endorsed by or affiliated
with the Paseo project or its authors.
