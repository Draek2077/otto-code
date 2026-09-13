# Product

Otto is an agentic development environment built on Paseo. It runs, monitors, and interacts with
coding agents across desktop, mobile, web, and the command line. Its purpose is to make an
IDE-grade toolset available to cloud and local providers alike.

## Agents and their work

The central workflow is giving an agent a task, understanding what it is doing, providing
direction, and reviewing the result. Files, terminals, diffs, browser previews, and other tools
support that workflow. Users can also inspect and edit their work directly.

Provider choice should not determine whether an agent can use Otto's tooling. Browser verification,
artifacts, subagent visibility, context management, permission modes, and MCP belong to the shared
environment. Provider adapters expose native capabilities and connect to shared daemon tools; the
same product behavior must remain available to supported local-model configurations. Provider
limitations and unsupported operations remain explicit. See [providers.md](providers.md).

## Easy to start, room to grow

The default experience should be understandable and useful without knowing how plugins or a daemon
work. The desktop app manages a local daemon; users can connect other clients to that host. Optional
relay pairing provides remote access without requiring a VPN. A separately managed daemon also
supports remote infrastructure and automation, including SSH connections to an existing daemon.
See the [connectivity guide](../public-docs/connectivity.md).

The daemon owns agent processes independently of individual client connections. Multiple clients
can use the same host, and disconnecting one client does not transfer ownership of its agents.
Desktop-managed daemon lifetime is a separate application concern; see
[architecture.md](architecture.md).

Otto retains these integrated workflows:

- Desktop, iOS, Android, web, and CLI access, with platform-appropriate controls.
- Built-in coding providers, a catalog of ACP providers, plugin providers, and custom
  OpenAI-compatible endpoints. Brain manages local model runtimes and their operational controls;
  see [brain.md](brain.md).
- Agent-driven Preview servers and verification in real Otto browser tabs; see
  [preview.md](preview.md). Browser tooling is shared across providers.
- HTML artifacts, file editing, structural diff review, terminals, browser panes, split panes, and
  keyboard workflows.
- Reusable agent personalities, roles, and teams with model, effort, mode, prompt, and visual or
  voice identity; see [agent-profiles.md](agent-profiles.md).
- Voice dictation and playback, project Knowledge and context management, schedules, and workflows.
- Provider-neutral Forge integrations and daemon tools for chats, workspaces, terminals, and
  automation.

These are product capabilities, not a claim that every platform and provider implements every
operation identically. Each capability's documentation defines its supported scope and gates.

## Freedom, ownership, and privacy

- **Self-hosted:** Code, host configuration, and credentials stay under the user's control.
- **Provider choice:** Use supported agent harnesses, local endpoints, and provider plugins without
  tying the surrounding workflow to one vendor.
- **Bring your own keys:** Use provider plans and pricing directly; Otto adds no inference markup.
- **Privacy:** No Otto telemetry, tracking, forced account, or required cloud service. The optional
  relay is end-to-end encrypted. Configured providers, Git remotes, and integrations still have
  their own network and data-handling behavior.
- **Open source:** Otto is licensed under AGPL-3.0-or-later. Users can inspect, modify, and contribute
  to it.

## Shared foundations and extensions

Paseo's extensible architecture supplies common owners for agent state, timelines, provider
registration, and plugin execution. Otto keeps enhancements in owned modules, adapters, and
composition roots with small explicit hooks into those owners. A new upstream implementation can
replace an older workaround while retaining the user-facing feature it supported.

Plugins can contribute providers, panels, commands, settings, and chat UI through the released
interfaces described in [plugins.md](plugins.md). The client SDK also lets other applications and
services use the daemon. These interfaces let integrations evolve independently and combine with
built-in behavior.

The choice between a built-in feature, an owned adapter, and a plugin follows the concrete workflow
and its lifecycle. Moving an existing feature requires preserving its defaults, controls,
persistence, and supported users. Extensibility does not require every enhancement to become a
plugin.

## How Otto develops

Product decisions remain with the maintainer. New work starts with a concrete user problem and
accounts for discoverability, interaction design, platform behavior, reliability, and maintenance.
An implementation or passing tests alone does not establish acceptance. Users build habits and
integrations around shipped behavior, so changes must account for those dependencies.

Bug reports, reproducible tests, documentation, plugins, integrations, and contributions all help
the product improve. See [Contributing](../CONTRIBUTING.md) for participation and
[the documentation index](README.md) for the contracts behind individual features.
