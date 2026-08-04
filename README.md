<p align="center">
  <img src="packages/website/public/logo.svg" width="64" height="64" alt="Otto logo">
</p>

<h1 align="center">Otto</h1>

<p align="center">
  <a href="https://github.com/Draek2077/otto-code/stargazers">
    <img src="https://img.shields.io/github/stars/Draek2077/otto-code?style=flat&logo=github" alt="GitHub stars">
  </a>
  <a href="https://github.com/Draek2077/otto-code/releases">
    <img src="https://img.shields.io/github/v/release/Draek2077/otto-code?style=flat&logo=github" alt="GitHub release">
  </a>
  <a href="https://github.com/Draek2077/otto-code/issues">
    <img src="https://img.shields.io/github/issues/Draek2077/otto-code?style=flat&logo=github" alt="GitHub issues">
  </a>
</p>

<p align="center">One interface for Claude Code, Codex, Copilot, OpenCode, and Pi agents.</p>

> [!NOTE]
> **Otto is a modified fork of [Paseo](https://github.com/getpaseo)** (© 2025–present
> Mohamed Boudra), reworked toward an autonomous AI coding IDE. It remains licensed
> under AGPL-3.0. See [NOTICE](NOTICE) for full attribution and a summary of changes.

<p align="center">
  <img src="https://otto-code.me/hero-mockup.png" alt="Otto app screenshot" width="100%">
</p>

<p align="center">
  <img src="https://otto-code.me/mobile-mockup.png" alt="Otto mobile app" width="100%">
</p>

> [!NOTE]
> This is a one-person project run in spare time, and I'm obsessed with it; so if you message me you will get a reply instantly.
> [Open an issue](https://github.com/Draek2077/otto-code/issues), or provide feedback right in the app to my discord!

---

## Why I'm building this

I'm Philippe. Otto isn't a startup and I'm not trying to sell you anything - it's the
environment I want to work in, and the way I'm getting better at agentic coding. Most of
Otto is written by the agents Otto runs, which is either the point or the joke, depending
on the day.

The problem I keep hitting: agents can now do an enormous amount of work on their own, and
it's genuinely hard to see what they did, what it cost, and where it went sideways. So the
work here leans toward **observability and accounting** - real per-subagent token and cost
numbers, a live visualizer of the orchestration graph, browser-verified previews so an agent
proves a change instead of just claiming it - and toward **pulling good open-source pieces
into one setup that actually works end to end**, instead of five tools that half-talk to
each other.

That's the whole thesis: let AI do the autonomous work, but make the operation legible while
it happens. If that matches how you work, I'd like the help - issues, comments, and PRs all
welcome.

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

Download it from [otto-code.me/download](https://otto-code.me/download) or the [GitHub releases page](https://github.com/Draek2077/otto-code/releases). Open the app and the daemon starts automatically. Nothing else to install.

To connect from your phone, scan the QR code shown in Settings.

### CLI / headless

Install the CLI and start Otto:

```bash
npm install -g @otto-code/cli
otto
```

This shows a QR code in the terminal. Connect from any client. This path is useful for servers and remote machines.

For full setup and configuration, see:

- [Docs](https://otto-code.me/docs)
- [Configuration reference](https://otto-code.me/docs/configuration)

### Docker

Run the Otto daemon and self-hosted web UI in Docker:

```bash
docker run -d --name otto \
  -p 6868:6868 \
  -e OTTO_PASSWORD=change-me \
  -v "$PWD/otto-home:/home/otto" \
  -v "$PWD:/workspace" \
  ghcr.io/draek2077/otto:latest
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

See the [full CLI reference](https://otto-code.me/docs/cli) for more.

## Skills

Skills teach your agent to use Otto to orchestrate other agents.

```bash
npx skills add Draek2077/otto-code
```

Then use them in any agent conversation:

- `/otto-handoff` - hand off work between agents. I use this to plan with Claude and then handoff to Codex to implement.
- `/otto-loop` - loop an agent against clear acceptance criteria (aka Ralph loops), optionally with a verifier.
- `/otto-advisor` - spin up a single agent as an advisor for a second opinion, without delegating the work itself.
- `/otto-committee` - form a committee of two contrasting agents to step back, do root cause analysis, and produce a plan.

## Development

Quick monorepo package map:

- `packages/server`: Otto daemon (agent process orchestration, WebSocket API, MCP server)
- `packages/app`: Expo client (iOS, Android, web)
- `packages/cli`: `otto` CLI for daemon and agent workflows
- `packages/desktop`: Electron desktop app
- `packages/relay`: Relay package for remote connectivity
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

## Documentation

Five trees, five audiences. This section is the entry point to all of them.

| Tree                                  | Audience               | What it is                                                                                                                                                     |
| ------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[`docs/`](docs/README.md)**         | Anyone building Otto   | **The official software documentation.** How Otto works - system design, subsystem behaviour, conventions, gotchas. This is the specification we build against |
| **[`projects/`](projects/README.md)** | Anyone planning Otto   | Charters for work not yet done, plus **the single open-work ledger** - the one place that says what is done and what is not                                    |
| **[`findings/`](findings/README.md)** | Anyone diagnosing Otto | Dated, reproducible investigation reports - what was measured, how, and what it ruled in or out. Evidence, not specification                                   |
| **[`archdocs/`](archdocs/README.md)** | Architects             | The system-level architecture record: AsciiDoc pages with Mermaid diagrams, one level above `docs/`. `npm run archdocs:serve`                                  |
| **[`CLAUDE.md`](CLAUDE.md)**          | AI coding agents       | Working rules and constraints for agents in this repo. Deliberately **not** a documentation index - that is [`docs/README.md`](docs/README.md)                 |

The three writing trees differ by **tense**: `docs/` is present (_this is how it behaves_),
`projects/` is future (_this is what we will build_), `findings/` is past (_this is what we
measured_). A dated measurement in `docs/` reads as a permanent fact, which is why it has its own
tree.

User-facing product documentation is published at
[otto-code.me/docs](https://otto-code.me/docs) and authored in `public-docs/`. It documents what Otto
does; `docs/` documents how it is built.

### Quick links into `docs/`

**Start here** - [Product](docs/product.md) ·
[Architecture](docs/architecture.md) ·
[Glossary](docs/glossary.md) ·
[Coding standards](docs/coding-standards.md) ·
[Development](docs/development.md)

**Chat, agents and orchestration** - [Chat lifecycle](docs/chat-lifecycle.md) ·
[Agent personalities](docs/agent-personalities.md) ·
[Agent teams](docs/agent-teams.md) ·
[Subagent accounting](docs/subagent-accounting.md) ·
[Orchestration node capabilities](docs/orchestration-node-capabilities.md) ·
[Safe unattended runs](docs/safe-unattended.md) ·
[Suggested tasks](docs/suggested-tasks.md) ·
[Timeline sync](docs/timeline-sync.md) ·
[Visualizer](docs/visualizer.md) ·
[Activity stats](docs/activity-stats.md) ·
[Terminal activity](docs/terminal-activity.md)

**Workspaces, files and git** - [Workspace lifecycle](docs/workspace-lifecycle.md) ·
[New project](docs/new-project.md) ·
[Changes view](docs/changes-view.md) ·
[Git providers](docs/git-providers.md) ·
[Git file history](docs/git-file-history.md)

**Editor and code intelligence** - [Text editor](docs/text-editor.md) ·
[Code intelligence (LSP)](docs/code-intelligence.md) ·
[Markdown rendering](docs/markdown-rendering.md) ·
[File icons](docs/file-icons.md)

**Providers and integration** - [Providers](docs/providers.md) ·
[Custom providers](docs/custom-providers.md) ·
[Preview](docs/preview.md) ·
[Service proxy](docs/service-proxy.md)

**Client and UI** - [Design tokens](docs/design.md) ·
[Unistyles](docs/unistyles.md) ·
[Hover](docs/hover.md) ·
[Floating panels](docs/floating-panels.md) ·
[Mobile panels](docs/mobile-panels.md) ·
[Expo Router](docs/expo-router.md) ·
[Forms](docs/forms.md) ·
[UI icons](docs/ui-icons.md) ·
[Text effects](docs/text-effects.md) ·
[Onboarding](docs/onboarding.md) ·
[i18n](docs/i18n.md) ·
[Feature flags](docs/feature-flags.md)

**Protocol, data and performance** - [RPC namespacing](docs/rpc-namespacing.md) ·
[Protocol validation](docs/protocol-validation.md) ·
[Data model](docs/data-model.md) ·
[Token economy](docs/token-economy.md) ·
[Terminal performance](docs/terminal-performance.md)

**Testing** - [Testing](docs/testing.md) ·
[Mobile testing](docs/mobile-testing.md) ·
[Ad-hoc daemon testing](docs/ad-hoc-daemon-testing.md) ·
[Browser capture harness](docs/browser-capture-harness.md)

**Build, release and operations** - [Release](docs/release.md) ·
[Fork release guide](docs/fork-release-guide.md) ·
[Upstream merges](docs/upstream-merges.md) ·
[Android](docs/android.md) ·
[Desktop Linux](docs/desktop-linux.md) ·
[Docker](docs/docker.md)

**Reference** - [References and sources](docs/references.md) ·
[OpenCode event baseline](docs/opencode-global-event-baseline.md)

### Repository documents

[CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) · [CHANGELOG.md](CHANGELOG.md) ·
[LICENSE](LICENSE) · [NOTICE](NOTICE)

## Community

- [paseo-relay](https://github.com/zenghongtu/paseo-relay) - self-hosted relay in Go (built for the upstream Paseo project)
- [paseo-vscode](https://marketplace.visualstudio.com/items?itemName=hinnes.paseo-vscode) - VS Code extension (built for the upstream Paseo project)

---

<p align="center">
  <a href="https://star-history.com/#Draek2077/otto-code&Date">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Draek2077/otto-code&type=Date&theme=dark">
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Draek2077/otto-code&type=Date">
      <img src="https://api.star-history.com/svg?repos=Draek2077/otto-code&type=Date" alt="Star history chart for Draek2077/otto-code" width="600" style="max-width: 100%;">
    </picture>
  </a>
</p>

## License

Otto is licensed under **AGPL-3.0**, the same license as the upstream project it is
based on. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

## Credits & attribution

Otto is mostly other people's good work, assembled. Two projects carry it, and I'd rather
name them properly than bury them in a footer.

### Paseo - by Mohamed Boudra

Otto is a modified fork of **[Paseo](https://github.com/getpaseo)**, created by
**Mohamed Boudra** and contributors, © 2025–present. Paseo is licensed under
AGPL-3.0; Otto continues under the same license as required by its copyleft terms.

Mo got the hard parts right before I ever showed up: agent process lifecycle, a clean
WebSocket protocol, genuinely cross-platform clients, an end-to-end encrypted relay.
That's why the work here can be features instead of plumbing. Otto keeps the full
foundation intact with upstream history preserved.
→ [Sponsor Mo](https://github.com/sponsors/boudra)

### Agent Flow - by Simon Patole

Otto's **Visualizer** - the live node-graph of agents, subagents, tool calls, and timeline
that makes an autonomous run something you can watch instead of guess at - is the render
layer of **[Agent Flow](https://github.com/patoles/agent-flow)** (Apache-2.0) by
**[Simon Patole](https://github.com/patoles)**, vendored as a git subtree.

It's beautiful work, and it fit because Simon kept rendering separate from event collection
behind a small documented bridge protocol. That one decision let Otto drive the same graph
from its own provider-neutral event stream, so it lights up for Claude, Codex, OpenCode, or
a local model alike - not just the runtime the original ingests. Adapting it has been the
most enjoyable part of building Otto. Carried patches and the Apache-2.0 state-changes
notice live in `vendor/agent-flow/OTTO-PATCHES.md`; upstream PRs are preferred over carrying
them. Agent Flow's name and logos are its own and Otto never ships them as its branding -
the feature is called "Visualizer" for exactly that reason.
→ [Star Agent Flow](https://github.com/patoles/agent-flow)

### Notices

The original copyright notice is preserved verbatim in [LICENSE](LICENSE). A summary
of what Otto changes relative to Paseo, along with full attribution, lives in
[NOTICE](NOTICE). Otto is an independent project and is not endorsed by or affiliated
with the Paseo project, the Agent Flow project, or their authors. Otto takes no
sponsorships of its own - support goes upstream.
