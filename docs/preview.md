# Preview

Preview is Otto's dev-server-and-browser-verification system: agents (and users)
start a project's dev server from a project-level config, then check the
rendered result in a real browser tab — accessibility snapshots, DOM
inspection, console/network capture, click/fill interaction, viewport resize,
and screenshots — instead of asking the user to check manually.

This doc covers the finished feature: settings, day-to-day server management,
how a preview tab differs from a normal browser tab, the design principles
carried over from the reverse-engineered Claude Preview MCP server, and the
`.claude/launch.json` config lifecycle. (The original reverse-engineering
blueprint that drove the build shipped and was retired; its durable decisions
live in this doc.)

## Two subsystems, one feature

- **Dev-server manager** (`packages/server/src/server/preview/dev-server-manager.ts`) —
  process supervision. Spawns the command from `.claude/launch.json`, tracks
  it by `serverId`, captures stdout/stderr into a bounded ring buffer, polls
  the port for readiness, and tree-kills on stop.
- **Browser tools** (`packages/server/src/server/browser-tools/`) — the
  verification half. Snapshot, inspect, click, fill, eval, network, console
  logs, resize, screenshot all execute against a real tab in the Otto browser
  pane — never a headless browser and never the system browser.

Agents get both as tool groups: `preview_start` / `preview_stop` /
`preview_list` / `preview_logs` for lifecycle, and `browser_*` tools
(`browser_snapshot`, `browser_inspect`, `browser_click`, `browser_fill`,
`browser_navigate`, `browser_network`, …) for verification. `preview_start`
opens (or re-finds) the tab and hands back its `browserId`, which the agent
then passes to the `browser_*` tools.

## Design principles

These were the load-bearing decisions carried over from reverse-engineering
Claude Code's preview MCP server; they explain why the tools look the way
they do and must survive future changes:

- **Token economy is a first-class design axis, not an afterthought.**
  Screenshots are normalized for vision-model legibility and cost: captures
  are scaled back to CSS pixels (undoing device-pixel-ratio inflation) and
  fitted to a ~1568px-long-edge / ~1.15-megapixel budget — the size past
  which vision APIs downscale images anyway, with token cost growing by
  pixel area the whole way; full-page captures render the CDP clip at
  reduced scale and the tool warns the agent when the result falls below
  legible size; `browser_screenshot` with a `ref` re-renders just that
  element at up to 3x zoom for readable small text (a vector re-render, not
  pixel magnification). `browser_snapshot` returns a pruned
  accessibility tree with stable element refs, never a DOM serialization;
  `browser_page_text` returns reader-mode text (article/main first) so
  reading a page doesn't pay for structure;
  network capture is split into a summary listing (method/url/status/
  `requestId`) with response bodies fetched on demand by `requestId` and
  capped at 30k chars; every log tool takes `lines` caps plus `level`/`search`
  post-filters (`level: "error"` is deliberately a keyword grep for
  error/exception/failed/fatal, matching the Claude Preview contract).
- **Tool descriptions are agent steering, not just API docs.**
  `browser_evaluate` is walled off as debug-only in its own description (DOM
  edits are lost on reload — edit source instead); screenshot self-deprecates
  for precision work and points at `browser_inspect` for colors/fonts/spacing;
  snapshot advertises itself as preferred over screenshot; `preview_start`
  embeds the launch.json format with create-if-missing instructions so agents
  can bootstrap a project themselves. Treat description text as prompt
  engineering — review it like code.
- **Descriptions steer, the daemon enforces.** Where a failure mode matters,
  there is a hard server-side check behind the guardrail text — the designated
  preview tab enforcement below (`findPreviewServerForUrl`) and the `ext:`
  stop restrictions are the two live examples. Never rely on description text
  alone for correctness or safety.
- **Console/network events are push; tool calls are pull.** Both hosts buffer
  events into bounded ring buffers read (and filtered) at call time. Network
  capture in the Electron host is a per-tab CDP recorder
  (`webContents.debugger`, Network domain, 500-entry ring per tab) that
  attaches lazily on the tab's first `browser_network` call — which is why the
  tool description tells the agent to reload after enabling, so the page's
  traffic actually gets recorded. (`browser_logs` carries the lighter
  Performance-API entries instead.)
- **The verification workflow is injected as system prompt, not hoped for.**
  Tool descriptions alone don't reliably steer local models, so the
  openai-compatible provider injects a workflow doctrine
  (`buildPreviewWorkflowPrompt` in
  `packages/server/src/server/agent/providers/openai-compat-agent.ts`),
  emitted only when the preview/browser tool groups are actually exposed:
  start dev servers with `preview_start` (never `run_command`), verify against
  the returned `browserId` only, and share proof (snapshot/screenshot) instead
  of asking the user to check manually. Known gap: other providers (Claude
  Code, Codex, …) currently get the guardrail-bearing tool descriptions but no
  injected workflow prompt.

## Preview tabs vs. normal browser tabs

A preview tab is a normal Otto browser tab with extra bookkeeping, not a
separate tab type:

| Field (`packages/app/src/stores/browser-store/state.ts`) | Purpose                                                                                                                                        |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `isPreview: true`                                        | Tab icon is always the Play icon instead of the page favicon, so a preview tab is visually unmistakable from a tab the user opened themselves. |
| `previewServerName`, `previewCwd`                        | The `.claude/launch.json` entry and working directory needed to restart the server after a daemon or app restart.                              |
| `previewServerId`                                        | The running server's id (or `ext:<port>` when Otto detected an already-running server on that port instead of one it spawned).                 |
| `previewStatus`                                          | `idle` \| `starting` \| `ready` \| `error` \| `needs-start` — drives the tab's watermark/spinner until the server responds.                    |

What this buys you, concretely:

- **Users can freely close, navigate, or reload a preview tab.** There's no
  lock-in — closing the tab does not stop the server by default (see
  [Settings](#settings) for the opt-in auto-stop behavior), and navigating
  away doesn't break anything; the next `preview_start` re-finds or reopens
  the designated tab.
- **One designated tab per server, enforced server-side, not just by
  convention.** `findPreviewServerForUrl` (`packages/server/src/server/browser-tools/tools.ts`)
  checks every `browser_new_tab` / `browser_navigate` call: if the target URL
  is a loopback address matching a running preview server's port, and the
  call isn't targeting that server's `boundBrowserId`, it's rejected with an
  error naming the correct `browserId` (or telling the agent to call
  `preview_start` if no tab is bound yet). This closes the failure mode where
  an agent opens a second, detached tab pointed at the same dev server instead
  of reusing the bound one — tool descriptions alone can't guarantee that, so
  the daemon enforces it.
- **Restored preview tabs don't silently reconnect to a stale server.** On
  app/workspace restore, a preview tab's status resets to `idle`; whether it
  auto-restarts the dev server or waits for the user to click "Start" is the
  `previewAutoStartOnRestore` setting below.

## Settings

Preview-related configuration is split across three levels — daemon-wide,
per-provider, and per-client (device-local) — because each answers a
different question: _is Otto allowed to touch the browser at all_, _which
tool groups does this specific model see_, and _how does this device want
restored preview tabs to behave_.

### Daemon-level (Host settings screen, requires a connected daemon)

| Setting               | Config key                                      | Where it's rendered                                                        |
| --------------------- | ----------------------------------------------- | -------------------------------------------------------------------------- |
| **Browser tools**     | `daemon.browserTools.enabled` (default `false`) | `BrowserToolsOptInCard`, `packages/app/src/screens/settings/host-page.tsx` |
| **Enable Otto tools** | `daemon.mcp.injectIntoAgents` (default `true`)  | `InjectOttoToolsCard`, `packages/app/src/screens/settings/host-page.tsx`   |

"Browser tools" is the master switch: agents can access and control Otto
browser tabs, including logged-in browser state, so it ships off and carries
an explicit trust warning in the UI. With it off, `browser_*` tools (and by
extension the verification half of Preview) aren't registered for any
provider, regardless of that provider's own tool-group selection below.
"Enable Otto tools" is the broader switch for all daemon-injected tools
(agent/worktree/schedule management as well as preview/browser) — turning it
off removes the whole Otto tool catalog from agents on this daemon.

### Per-provider (provider details screen, natively-injected providers only)

Providers that receive Otto tools natively (currently the openai-compatible
provider family — LM Studio, etc.) can be scoped to a subset of Otto's tool
groups via `ProviderToolGroupsSection` in
`packages/app/src/components/provider-diagnostic-sheet.tsx`, backed by
`providers.<name>.ottoToolGroups` in daemon config
(`OTTO_TOOL_GROUPS` in `packages/protocol/src/provider-config.ts`):

```
preview | browser | agents | terminals | schedules | workspace
```

Unchecking **Preview servers** hides `preview_*` tools from that provider;
unchecking **Browser control** hides `browser_*` tools. Omitting the field
entirely (the default) means all groups are exposed. This is a per-provider
_narrowing_ — it can restrict what an already-enabled provider sees, but
can't re-enable browser tools if the daemon-level "Browser tools" switch
above is off. (The settings UI has a `globallyDisabled` string reserved for
showing that interaction visually; it isn't wired up yet, so a provider's
preview/browser toggles currently render as available even when the daemon
switch would make them no-ops.)

### Client-local (General settings, per device — not synced through the daemon)

| Setting                         | Storage key                  | Default        | Behavior                                                                                                                                                                                                                    |
| ------------------------------- | ---------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Preview server on tab close** | `previewServerCloseBehavior` | `keep-running` | `stop-on-close` calls `client.previewStop(serverId)` when the tab is closed (`workspace-screen.tsx`). `keep-running` leaves the dev server up so reopening the tab (or another tab) reconnects instantly.                   |
| **Auto-start on restore**       | `previewAutoStartOnRestore`  | `false`        | When a saved preview tab is restored (app relaunch, workspace reopen), `true` relaunches its dev server automatically (`browser-pane.electron.tsx`); `false` leaves the tab showing a manual "Start preview server" button. |

Both live in `packages/app/src/screens/settings-screen.tsx` under General, are
persisted client-side (`packages/app/src/hooks/use-settings/storage.ts`), and
apply to every workspace opened from that device/browser.

## Managing preview servers

There's no standalone "running servers" panel today — management happens
through two entry points that both call into the same `DevServerManager`:

1. **The Preview button** — `WorkspacePreviewButton` in
   `workspace-desktop-tabs-row.tsx`, next to "New Browser" in a pane's
   toolbar. Enabled only when the pane's active tab is a chat, since the
   server to preview is resolved from that agent's `cwd` (which may be a
   worktree, not the workspace root). Clicking it:
   - reads `.claude/launch.json` for that `cwd` (`preview.list_config` RPC)
     without starting anything;
   - if no servers are configured, sends the bootstrap prompt into that chat
     instead of opening a menu (see [launch.json](#launchjson) below);
   - if exactly one server is configured, starts it directly;
   - if more than one, opens a picker (name + port) first.

   On start, it opens the tab immediately (before the possibly-slow spawn
   resolves) showing a spinner, splits it into a pane beside the button's own
   pane, and binds it as that server's designated tab — so a later agent
   `preview_start` call for the same server finds this exact tab.

2. **Agent tools** — `preview_start` (spawn-or-reuse by name),
   `preview_stop` (tree-kill by `serverId`), `preview_list` (enumerate
   running servers for the agent's `cwd`), `preview_logs` (bounded
   stdout/stderr with `level`/`search`/`lines` filters). These are the same
   operations the button uses, just callable by the agent mid-conversation —
   e.g. an agent can `preview_logs` to check for a build error without a
   human touching anything.

`DevServerManager` itself exposes more than either surfaces (`bindTab`,
`boundTab`, reconciling externally-running servers detected by port probe
under an `ext:<port>` id) — that's internal wiring for the tab-binding
behavior described above, not something a user interacts with directly.

### External (`ext:`) servers and the bulk-stop rule

A running server with an `ext:<port>` id was **not** spawned by the daemon —
it's whatever process happens to be listening on a configured port, adopted
by port probe. Stopping one resolves the port's owning PIDs and tree-kills
them. That is safe only as a deliberate user action (the tab row's "Stop
server" button), never as part of automatic cleanup: if the workspace is this
repo itself, the `otto-dev` launch config claims port 8081, so the "external
server" is the dev stack's own Metro — killing it takes down Electron
(`concurrently --kill-others`) and, with `keepRunningAfterQuit` off, the
daemon too, which presents as the whole app crashing. This actually happened
via the `/clear` sweep in `agent-panel.tsx`, which stopped every running
server for the cwd; it now filters with `isExternalPreviewServerId()`
(exported from `@otto-code/protocol/messages` alongside
`EXTERNAL_PREVIEW_SERVER_ID_PREFIX`). Any future path that stops preview
servers in bulk must apply the same filter.

The daemon also enforces this independently of client behavior. Bootstrap
wires `DevServerManager.setProtectedPortsProvider()` with the daemon's own
listen port plus the loopback origin ports of currently connected clients
(`VoiceAssistantWebSocketServer.getConnectedClientOriginPorts()` — a
connected client's origin port is the dev server hosting the UI itself).
`stopExternal` refuses to stop an `ext:` server on a protected port with a
clear error, and additionally skips `process.pid`/`process.ppid` if the port
lookup ever resolves to the daemon's own process. Explicit "Stop server" on a
genuinely third-party port still works.

Beyond protected ports, `ext:` stops are restricted to ports the daemon has
itself observed as configured preview servers: `reconcileRunning` records
which workspace's launch.json listed each externally-running port, and
`stopExternal` refuses any port without such an observation — and re-reads
that workspace's launch.json at stop time in case the config changed. This
closes the hole where an agent could pass an arbitrary `ext:<port>` id to
`preview_stop` and tree-kill an unrelated local service (a database, sshd,
another project's server).

Agent-initiated stops and log reads are additionally workspace-scoped: the
`preview_stop` / `preview_logs` tools pass the caller agent's cwd, and the
manager rejects servers belonging to a different workspace
(`DevServerManager.stop`'s `requireCwd` option). User-initiated stops via the
`preview.stop.request` RPC stay unscoped — the user may stop any server the
UI lists.

## launch.json

`.claude/launch.json`, resolved relative to the workspace's `cwd`
(`packages/server/src/server/preview/launch-config.ts` —
`LAUNCH_CONFIG_RELATIVE_PATH`), is the only location Otto reads; there's no
fallback path or alternate filename.

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "<unique-name>",
      "runtimeExecutable": "<command>",
      "runtimeArgs": ["<args>"],
      "port": 8200
    }
  ]
}
```

- `runtimeExecutable` — the command (`"npm"`, `"pwsh"`, `"python"`, …)
- `runtimeArgs` — argument array (`["run", "dev"]`)
- `port` — used both for readiness polling and for resolving the preview
  server's URL
- `env` — optional per-config environment overrides

This is deliberately the same format used by other preview harnesses, so a
project only needs one config file regardless of which agent is driving it.

### Capability detection

Detecting whether a project has Preview configured is just: does
`.claude/launch.json` exist, and does it parse? `readLaunchConfig(cwd)`
returns `null` on `ENOENT` (not configured — not an error), and throws a
`LaunchConfigError` with the offending path and a Zod validation message if
the file exists but is malformed. The `preview.list_config` RPC
(`session.ts`, `handlePreviewListConfigRequest`) wraps this into a response
carrying `configured`, the parsed `servers` list, and any currently
`runningServers` for that `cwd` — this is what both the Preview button and an
agent's own bootstrap check read.

There's no protocol-level capability flag (`server_info.features.*`) gating
Preview the way other recent features are gated per this repo's convention —
`DevServerManager` is constructed unconditionally at daemon bootstrap, so
availability is really "does the daemon have this code at all," which for a
running instance is always yes. A missing launch.json is a per-project
_configuration_ state, not a capability negotiation, and is handled entirely
by the `configured: false` response above rather than a COMPAT gate.

### Bootstrapping a new project

When a project has no `.claude/launch.json` yet, the canned entry point is a
user-style message auto-sent into the chat:

> Detect this project's dev servers and save their configurations to
> `.claude/launch.json` (create it if missing) using the format from the
> `preview_start` tool description. Then ask me which ones to start, and call
> `preview_start` for each one I pick.

The agent does the detection with its ordinary file-reading tools and writes
the file itself — nothing server-side is involved in generating it. This also
works unprompted: `preview_start`'s tool description embeds the file format
with create-if-missing instructions, and calling it against a project with no
config returns an actionable error naming the expected path, so an agent can
self-serve the same flow without the canned prompt.
