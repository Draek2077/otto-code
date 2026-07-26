# Development

## Prerequisites

- Node.js (see `.tool-versions` for exact version)
- npm workspaces (comes with Node)

### Windows: npm script shell

Some repo scripts (e.g. `scripts/dev-home.sh`) use bash syntax, but npm on
Windows defaults to `cmd.exe` for script execution regardless of the invoking
shell, which breaks them. Point npm at Git Bash in your **global** npm config,
not a repo-committed `.npmrc` — a project-level override applies to every
`npm ci`/`npm install` in CI too, and GitHub Actions runners are Linux, where
a hardcoded Windows path doesn't exist and breaks every workflow:

```powershell
npm config set script-shell "C:\Program Files\Git\bin\bash.exe" --location=global
```

## Running the dev server

```bash
npm run dev:server
npm run dev:app
npm run dev:desktop
```

**`npm run dev:win:desktop` (Windows) / `npm run dev:desktop` is the front-end dev command.**
It brings up Metro and the Electron shell together with the daemon in the Electron main
process — one command, the whole app. Reach for the split entrypoints below only for tests,
demos, CI, and agent-driven services.

Root checkout dev is otherwise split across terminals:

- `npm run dev:server` runs the dev daemon on `127.0.0.1:6788`.
- `npm run dev:app` runs Expo on `http://localhost:8081` and connects to the dev daemon.
- `npm run dev:desktop` runs its own Electron-flavored Expo server on the first free port from `8082` through `8089`. It never claims port `8081`.

`npm run dev` is only a shorthand for `npm run dev:server`.

Whichever you use, they all resolve through the same dev defaults, so they land on the same
daemon port and the same `OTTO_HOME` — see below.

### Lanes

**The installed Otto, the dev Otto, an agent's own instance, a test run, and a
demo run are all expected to be up at the same time.** Each owns its own ports
and its own running space, and nothing in one lane can reach into another:

| Lane              | Daemon port | `OTTO_HOME`                        | Metro         | Other fixed ports |
| ----------------- | ----------- | ---------------------------------- | ------------- | ----------------- |
| **Installed app** | `6868`      | `~/.otto`                          | —             | —                 |
| **Dev**           | `6788`      | `packages/desktop/.dev/otto-home`  | `8081`–`8089` | CDP `9223`        |
| **Agent**         | `6799`      | `packages/desktop/.dev/agent-home` | `8095` (web)  | —                 |
| **Tests** (e2e)   | dynamic     | `$TMP/otto-e2e-home-*`             | dynamic       | relay dynamic     |
| **Demos**         | dynamic     | `$TMP/otto-e2e-home-*`             | dynamic       | relay dynamic     |

(The heading deliberately does not count them — this table has grown twice.)

The fixed lanes get fixed ports because you need to _find_ them — you type
`localhost:6788` into a client, you attach a debugger to `9223`. Override the dev
port with `OTTO_DEV_DAEMON_PORT` and the CDP port with
`OTTO_ELECTRON_REMOTE_DEBUGGING_PORT`.

#### The agent lane

`npm run dev:win:agent` (Windows) / `npm run dev:agent` starts a daemon **and** an
Expo **web** front end that an AI agent can drive and screenshot on its own,
without touching anything you have running. Start it while the installed Otto and
the dev Otto are both up — nothing collides. That is the whole reason it exists.

It serves web rather than Electron on purpose: a web front end opens in Otto's
browser pane and can be verified with the browser tools, whereas an Electron
window would need its own userData for the single-instance lock and could only be
inspected over CDP.

The home is managed (its `config.json` is seeded with the lane's port) and
persistent — a throwaway home mints a new daemon keypair and `serverId` every run,
and a client that remembered the old identity refuses the new one.

Override with `OTTO_DEV_DAEMON_PORT`, `OTTO_AGENT_METRO_PORT`, or `OTTO_DEV_HOME`.
`OTTO_DEV_HOME` is the general escape hatch for standing up **another** managed
lane: unlike raw `OTTO_HOME` — which is honored but never written to — a managed
home gets its `config.json` seeded, so the lane actually answers on its own port
instead of inheriting `6868`.

##### Bootstrapping it

A brand-new lane home has no providers configured and boots into the first-run
wizard, which is friction on every single run. `npm run dev:agent:bootstrap`
removes it. The bootstrap has two halves, because the state lives in two places:

```bash
npm run dev:agent:bootstrap
```

- **Daemon half** (what the script does): copies the durable, machine-local half
  of another home's `config.json` — provider endpoints and keys, model tier
  overrides, personalities, teams, feature flags — into the agent home. Defaults
  to seeding from the dev home; `--from <home>` picks another, `--force`
  overwrites values already set. It deliberately never copies `daemon.*`, because
  inheriting someone else's `daemon.listen` is exactly how a lane ends up
  answering on the wrong port.
- **Client half** (what it prints): the first-run wizard and spotlight-tour flags
  are device-local app settings in the _client's_ AsyncStorage — for Expo web
  that is `localStorage` under key `@otto:app-settings` on the Metro origin, not
  anywhere under `OTTO_HOME`. The script prints a one-liner to run once in the
  browser pane, then reload.

Note the flags must be set to `true` explicitly. `migrateSetupWizardFlag` only
treats a device as an upgrader when the field is _absent_, and the app writes a
full settings blob with `false` on first boot — so seeding an empty blob does not
skip the wizard.

**Tests and demos stay dynamic on purpose — do not pin them to a band.** Both run
through `e2e/global-setup.ts`, which mints a throwaway `mkdtemp` `OTTO_HOME` per
run and asks the OS for free daemon/Metro/relay ports. That is what lets several
runs go at once — two e2e runs, or e2e and demos together, or one per worktree
under `otto.json` services. A fixed band would trade all of that away to solve a
collision the dynamic allocator does not have. Cross-lane safety instead comes
from subtraction: `RESERVED_LOCAL_PORTS` in `global-setup.ts` lists every fixed
port the other lanes own (`6868`, `6788`, `8081`–`8090`, `9223`, `4400`, plus
OpenCode's `61680`) and the allocator refuses all of them. **Add a row there
whenever a lane claims a new fixed port.**

Per-run output also stays separate: the tier scripts set `E2E_HTML_REPORT_DIR`
and `E2E_REPORT_DIR` so a demo or T2 run cannot wipe a T1 report mid-write.

The `6868`/`6788` split is the load-bearing one for the two fixed lanes. Two
daemons on `6868` do not coexist — the second either crash-loops fighting for the
port or, worse, the first one answers and hands dev clients your production
agents. `npm run cli` resolves through the same wrapper, so the in-repo CLI
always talks to the dev daemon.

The separate Electron userData (`packages/desktop/.dev/user-data`) is what lets
the dev app launch at all while the installed one is open: on a shared userData
the dev instance loses the single-instance lock and immediately quits.

**Dev builds wear a navy icon.** With both apps running, identical black icons
make the two taskbar buttons and tray entries indistinguishable, so an
unpackaged build loads its window, dock and tray art from
`packages/desktop/assets/dev/` — the same tile in blue-900 `#1e3a8a`. Generated
by `scripts/generate-brand-assets.mjs`, resolved by
`packages/desktop/src/features/dev-icon.ts`, and impossible to ship: the lookup
is gated on `!app.isPackaged` and nothing in `electron-builder.yml` copies that
folder. See [branding/README.md](../branding/README.md).

Two things do **not** separate, both cosmetic. You get two tray icons — expected,
they are two apps. And on Windows both processes call
`setAppUserModelId("ai.ottocode.desktop")`, so toast notifications are attributed
identically and a toast click may activate whichever window Windows picks.

Deliberately **shared**: `OTTO_LOCAL_MODELS_DIR` points both at
`~/.otto/models/local-speech` so local speech models are downloaded once, and
skills sync writes to the machine-level `~/.claude/skills`, `~/.codex/skills`,
and `~/.agents/skills` for both.

**Do not click "Install CLI" from a dev build.** It writes `~/.local/bin/otto`
from the _running_ app's bundled shim path, so a dev build overwrites the
installed app's working shim with one that only resolves inside the checkout.

`scripts/dev-home.sh` and `scripts/dev-home.ps1` hold these defaults, one per
shell. They are mirrors of each other — change one, change both.

### OTTO_HOME

`OTTO_HOME` is the directory that holds runtime state (agents, worktrees, workspace config, sockets, daemon log). Resolution rules:

- The **server itself** (e.g. when launched by the desktop app or `npm run start`) defaults to `~/.otto` (see `packages/server/src/server/otto-home.ts`).
- **Repo dev scripts** default to `$ROOT/packages/desktop/.dev/otto-home`, where `$ROOT` is the current checkout or worktree root. This keeps all dev state scoped to the checkout instead of the packaged desktop app. It lives under `packages/desktop` because that is where the desktop dev script originally put it and where the accumulated dev state sits; the other entrypoints were pointed at it rather than the reverse, so nobody has to relocate a populated home and its git worktrees.
- **`npm run cli -- ...`** runs through the same dev-home wrapper as the dev scripts, so the in-repo CLI automatically targets the current checkout's dev home and dev daemon endpoint.
- **Otto-created worktrees** seed `$OTTO_WORKTREE_PATH/packages/desktop/.dev/otto-home` from the source checkout's dev home by copying durable JSON metadata. Runtime files like pid files, sockets, and logs are not copied.
- **This repo's worktree setup** also best-effort seeds `packages/app/ios` and the newest `.dev/ios-build` entry from the source checkout so iOS simulator services can reuse native project and Xcode cache state when it is safe enough to do so.

An explicit `OTTO_HOME` is always honored and never rewritten — only the
script-managed dev home gets its `config.json` seeded with the dev port and
wildcard CORS, so pointing dev at a real home can never clobber it.

Override knobs:

```bash
OTTO_HOME=~/.otto-blue npm run dev           # explicit home
OTTO_DEV_DAEMON_PORT=6799 npm run dev        # explicit dev daemon port
OTTO_DEV_SEED_HOME=/path/to/home npm run dev # seed from a different source home
OTTO_DEV_RESET_HOME=1 npm run dev            # clear and reseed the derived worktree home
```

### Daemon endpoints

- Stable daemon launched by the installed desktop app: `localhost:6868`.
- Root checkout dev daemon: `localhost:6788`.
- Root checkout Expo: `http://localhost:8081`.
- Root checkout desktop dev Expo: first free port from `8082` through `8089`.
- Desktop dev Electron CDP: `127.0.0.1:9223`.

In Otto-managed worktree services, use the injected service environment rather than hardcoded root checkout ports.

**Windows gotcha:** `npm run dev:win` always spawns its own daemon — it has no mode to attach to one that's already running. If your Windows dev session already has a daemon on the dev port (e.g. from an earlier `dev:win`) and something else invokes `dev:win` again (a preview tool, a second terminal), the new daemon instance crash-loops fighting over the port. Use `npm run dev:app` instead when you just need Expo pointed at an already-running daemon; it never launches its own daemon.

### Expo Router

Route ownership, startup restore, and native blank-screen gotchas live in
[expo-router.md](expo-router.md). Read it before changing `packages/app/src/app`,
startup routing, remembered workspace restore, or active workspace selection.

### iOS simulator preview service

Otto worktrees expose the native iOS dev app through the `ios-simulator` service in `otto.json`. The service URL serves the simulator preview at `/.sim`, so the preview link is `${OTTO_URL}/.sim`.

The service is designed for concurrent worktrees: it derives a deterministic simulator identity from the worktree path, uses the worktree's assigned `OTTO_PORT`, pins `serve-sim` to that simulator UDID, and only tears down that worktree's helper/simulator state. It must not rely on the globally booted simulator or any fixed Metro port.

Worktree setup best-effort seeds the generated iOS project and newest native build cache from the source checkout before the service runs. The service still validates the native project by running Expo prebuild and Xcode; the seed only avoids paying all setup/build cost from a cold worktree every time.

Starting the service must not create, focus, reveal, or leave behind macOS Simulator.app windows. The browser preview is the user-visible simulator surface.

### Desktop renderer profiling

`npm run dev:desktop` starts Electron with Chromium remote debugging enabled on
`http://127.0.0.1:9223` so renderer CPU profiles can be captured through CDP.
It launches its own Electron-flavored Expo server and passes that URL to Electron.
Override the CDP port with `OTTO_ELECTRON_REMOTE_DEBUGGING_PORT` when `9223` is busy.

When running a dedicated Electron QA instance against a non-default Expo port, set
`EXPO_DEV_URL` explicitly. Desktop main defaults to `http://localhost:8081`, so
`OTTO_PORT=57928` alone starts Metro on 57928 but Electron still loads 8081.

### React render profiling

The app has a gated React render profiler in
`packages/app/src/utils/render-profiler.tsx`. Wrap the component boundary you want
to measure with `RenderProfile`, then open the app with `?renderProfile=1`. When
the query param is absent, `RenderProfile` returns children directly and records
nothing.

Captured samples are exposed on `globalThis.__OTTO_RENDER_PROFILE__`. Call
`globalThis.__OTTO_RESET_RENDER_PROFILE__?.()` after warm-up and before the
interaction you want to measure. If a memo comparator or subscription boundary
needs explanation, call `recordRenderProfileReasons(id, reasons)` while profiling;
reason counts are exposed on `globalThis.__OTTO_RENDER_PROFILE_REASONS__`.

Use this workflow for any render investigation:

1. Add stable `RenderProfile` boundaries around the suspected root and expensive
   children. Keep IDs specific enough to compare before and after.
2. Reproduce against real app state, not toy fixtures, whenever practical.
3. Record an idle baseline first. If idle is noisy, fix or account for that
   before optimizing the interaction.
4. Warm up the route, reset profiler samples, run the exact interaction, then
   compare `actualDuration`, render counts, and per-commit samples.
5. When a memo boundary still renders, record reasons before changing code. Do
   not guess from object identity alone.
6. Keep changes that move the measured profile. Remove probes or memo wrappers
   that do not move the number.

What this caught during the workspace tab investigation:

- A large apparent workspace cost was real interaction work, not daemon noise;
  the idle baseline stayed near zero.
- The expensive stream rerender was mostly prop identity churn from pane context
  callbacks and capability objects, not new stream data.
- Stabilizing provider actions at the pane boundary helped because every mounted
  panel consumes that context.
- Comparing value-shaped capability flags beat preserving object identity through
  unrelated stores.
- Some plausible fixes did not pay off: memoizing the tab row and composer draft
  object barely moved the profile, so they were removed.

Existing scenario script: workspace chat/terminal tab switching. Start Expo on
web, keep a daemon available, then run:

```bash
OTTO_PROFILE_SERVER_ID=<server-id> \
OTTO_PROFILE_WORKSPACE_ID=<workspace-path> \
OTTO_PROFILE_AGENT_ID=<agent-id> \
  npm run profile:workspace-tabs --workspace=@otto-code/app
```

This script opens the app with `?renderProfile=1`, creates a temporary terminal
tab, switches between a real chat and that terminal, prints aggregated React
Profiler timings, then removes the temporary terminal. It is an example of the
workflow above, not the only way to use the profiler. Useful knobs:

```bash
OTTO_PROFILE_APP_URL=http://localhost:19010 # Expo web URL
OTTO_PROFILE_SWITCH_COUNT=1                # number of agent/terminal switch pairs
OTTO_PROFILE_SWITCH_WAIT_MS=250            # delay after each click
OTTO_PROFILE_IDLE_WAIT_MS=3000             # idle baseline before switching
OTTO_PROFILE_DUMP_COMMITS=1                # include per-commit profiler samples
```

### Desktop macOS compositor watchdog

macOS display sleep can leave Chromium's GPU-process display link — the vsync
source that drives frame production — stuck on a stale display. The compositor
then stops producing frames and the window looks frozen: unresponsive to clicks
and keys even though the renderer and every process stay alive. It self-recovers
after a few minutes, which is too long for a foreground app.

`setupDarwinCompositorWatchdog`
(`packages/desktop/src/window/compositor-watchdog/index.ts`) guards against
this. It polls the renderer for frame production every couple of seconds and,
after a sustained stall while the window is visible and unlocked, restarts the
GPU process so Chromium rebuilds the display link. The probe is skipped while
the screen is locked or the window is hidden or minimized, since a window
legitimately stops producing frames then.

The watchdog deliberately leaves background throttling **enabled**. Calling
`webContents.setBackgroundThrottling(false)` would keep the compositor producing
frames non-stop, pinning ProMotion displays at 120Hz forever and draining the
battery while the app is idle — so do not re-add it. The probe's visibility
guards already prevent throttling from causing a false stall.

### Daemon logs

Check `$OTTO_HOME/daemon.log` for daemon logs. The default level is `info`; set
`OTTO_LOG_LEVEL=trace` before launching the daemon when you need full provider,
session, and agent-manager traces for stuck-state debugging.

The supervisor rotates `daemon.log`. Persisted `log.file.rotate` settings in
`$OTTO_HOME/config.json` win first. Without persisted config, the optional
`OTTO_LOG_ROTATE_SIZE` and `OTTO_LOG_ROTATE_COUNT` env vars override the
defaults. The default rotation is `10m` x `3` files everywhere.

### Agent Tool Catalog Measurement

Measure the MCP `tools/list` payload that Otto injects into agents with:

```bash
npm run measure:agent-tools --workspace=@otto-code/server
```

The command reports compact JSON bytes, estimated tokens, field totals, largest
tools, and the browser-tools delta. It defaults to the agent-scoped catalog; use
`-- --scope=top-level` for the unaffiliated `/mcp/agents` shape and `-- --json`
for machine-readable output.

## otto.json service scripts

`worktree.setup` and `worktree.teardown` accept either a multiline shell script or an array
of commands. Both run sequentially.

Lifecycle commands run in the worktree through a stable script shell: `bash`
resolved from `PATH` on macOS/Linux, and PowerShell with `-NoProfile` on
Windows. They inherit the daemon environment plus Otto's lifecycle variables;
login and interactive shell startup files are not loaded, and Bash's `BASH_ENV`
hook is unset. Daemon-run loop verify checks and ACP single-string terminal
commands use the same non-login Bash behavior on macOS/Linux, but preserve their
existing `cmd.exe /c` string semantics on Windows. Service scripts are separate:
they launch in a terminal and receive the service environment described below.

```json
{
  "worktree": {
    "setup": "npm ci\ncp \"$OTTO_SOURCE_CHECKOUT_PATH/.env\" .env\nnpm run db:migrate",
    "teardown": "npm run db:drop || true"
  }
}
```

Every `scripts` entry with `"type": "service"` receives these environment variables:

| Variable                   | Value                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `OTTO_SERVICE_<NAME>_URL`  | Proxied URL for a declared peer service. Prefer this for peer discovery; it survives peer restarts.                       |
| `OTTO_SERVICE_<NAME>_PORT` | Raw ephemeral port for a declared peer service. Use only as a bypass escape hatch; it can go stale if that peer restarts. |
| `OTTO_URL`                 | Self alias for `OTTO_SERVICE_<SELF>_URL`.                                                                                 |
| `OTTO_PORT`                | Self alias for `OTTO_SERVICE_<SELF>_PORT`.                                                                                |
| `HOST`                     | Bind host for the service process.                                                                                        |

Service proxy hostnames use the double-dash shape: `web--feature-auth--project.localhost` or, on the default branch, `web--project.localhost`. Optional public aliases use the same leftmost label under the configured public base host.

`<NAME>` is normalized from the script name by uppercasing it, replacing each run of non-`A-Z0-9` characters with `_`, and trimming leading or trailing `_`. For example, `app-server` and `app.server` both normalize to `APP_SERVER`; that collision fails at spawn time with an actionable error.

`PORT` is not injected by default. If a framework requires `PORT`, set it in the command:

```json
{
  "scripts": {
    "web": {
      "type": "service",
      "command": "PORT=$OTTO_PORT npm run dev:web"
    }
  }
}
```

## Bundled daemon web UI

> The user-facing guide for this feature (enabling it, reverse proxy, TLS, tunnels, security) lives at [public-docs/web-ui.md](../public-docs/web-ui.md). This section is the contributor/build reference: how the artifact is produced, bundled, and excluded from desktop packaging.

The daemon can optionally serve the browser web client from the same HTTP server. This is disabled by default.

Enable it for a running daemon with:

```bash
otto daemon start --web-ui
```

Or set the environment variable:

```bash
OTTO_WEB_UI_ENABLED=true otto daemon start
```

Or persist it in `config.json`:

```json
{
  "features": {
    "webUi": {
      "enabled": true
    }
  }
}
```

When enabled, opening the daemon HTTP origin (for example `http://localhost:6868/`) serves the web app. The same HTTP server continues to serve `/api/*`, `/mcp/*`, `/public/*`, the WebSocket upgrade, and service-proxy routes. Static files load without daemon bearer auth; API and WebSocket calls still enforce auth.

The served app auto-bootstraps a connection to the same origin, so opening `http://localhost:6868/` directly usually skips the Add Host step.

Build the artifact for packaging or measurement with:

```bash
npm run build:daemon-web-ui
```

This exports the normal browser web app (not the Electron-flavored desktop renderer) and copies it into `packages/server/dist/server/web-ui`, precompressing `.html`, `.js`, `.css`, and JSON assets as `.br` and `.gz`.

Measured bundle size for a standard Expo web export:

- raw: 10.77 MiB
- gzip: 2.55 MiB
- brotli: 1.93 MiB

The desktop-managed daemon disables the bundled web UI by default (`OTTO_WEB_UI_ENABLED=false`) because the desktop app already ships the renderer as `app-dist`. Shipping the same assets again inside `@otto-code/server` would duplicate the ~10.8 MiB install. Desktop packaging also excludes `node_modules/@otto-code/server/dist/server/web-ui/**` from the packaged app.

## Built workspace packages

Package imports resolve through package exports to compiled `dist/` output, not sibling `src/` files. This is true in local dev and in published packages: the app, daemon, CLI, and SDK consumers should all exercise the same runtime paths.

`npm run dev:server` builds the server-side workspace packages once, then keeps `@otto-code/protocol` and `@otto-code/client` fresh with TypeScript watch builds while the daemon runs. If you change protocol schemas or client code outside that watch workflow, rebuild the producer before trusting runtime behavior.

Use the named root build targets instead of remembering workspace dependency chains:

```bash
npm run build:client       # protocol -> client
npm run build:server-deps  # highlight -> relay -> protocol -> client
npm run build:server       # server-deps -> server -> cli
npm run build:app-deps     # highlight -> protocol -> client -> expo-two-way-audio
```

Use `npm run build:server` whenever you have changed any daemon/server-facing package and need clean cross-package types or runtime behavior.

The app Metro config disables Watchman and uses Metro's node crawler for exports. Keep that invariant unless you have verified production app exports on machines with and without Watchman installed; distro Watchman builds can differ in capabilities and change Metro's crawl behavior.

For tighter loops, you can rebuild a single workspace:

- Changed `packages/protocol/src/*` or `packages/client/src/*`: `npm run build:client`.
- Changed `packages/server/src/*`, `packages/cli/src/*`, `packages/relay/src/*`, or `packages/highlight/src/*`: `npm run build:server`.
- Changed app build dependencies: `npm run build:app-deps`.

## ACP provider catalog versions

The in-app ACP provider catalog pins package-runner entries (`npx`, `npm exec`,
and `uvx`) to exact package versions. Run the drift checker regularly — and
before releases — so catalog installs do not sit on stale agent versions:

```bash
npm run acp:version-drift        # report stale/non-exact package pins
npm run acp:version-drift:check  # same, exits non-zero on drift
npm run acp:version-drift:update # rewrite catalog pins to latest exact versions
```

The checker updates only package-runner catalog entries. Providers that use a
preinstalled binary such as `opencode acp`, `cursor-agent acp`, or `goose acp`
are reported as skipped because their versions are owned by the user's local
install.

## CLI reference

Use `npm run cli` to run the in-repo CLI from source (`npx tsx packages/cli/src/index.ts`). The script wraps the CLI with `scripts/dev-home.sh`, so it automatically uses this checkout's dev home (`packages/desktop/.dev/otto-home`) and the dev daemon on `6788` unless you pass an explicit override. The globally installed `otto` binary is a shim into the installed Otto desktop app, not this checkout — use it to drive the installed app's daemon on `6868`, and `npm run cli` when you want to talk to the CLI you are editing.

```bash
npm run cli -- ls -a -g              # List all agents globally
npm run cli -- ls -a -g --json       # Same, as JSON
npm run cli -- inspect <id>          # Show detailed agent info
npm run cli -- logs <id>             # View agent timeline
npm run cli -- daemon status         # Check daemon status
```

Use `--host <host:port>` to point the CLI at a different daemon:

```bash
npm run cli -- --host localhost:7777 ls -a
```

## Agent state

Agent data lives at:

```
$OTTO_HOME/agents/{cwd-with-dashes}/{agent-id}.json
```

Find an agent by ID:

```bash
find $OTTO_HOME/agents -name "{agent-id}.json"
```

Find by content:

```bash
rg -l "some title text" $OTTO_HOME/agents/
```

## Provider session files

Get the session ID from the agent JSON (`persistence.sessionId`), then:

**Claude:**

```
~/.claude/projects/{cwd-with-dashes}/{session-id}.jsonl
```

**Codex:**

```
~/.codex/sessions/{YYYY}/{MM}/{DD}/rollout-{timestamp}-{session-id}.jsonl
```

## Testing with Playwright MCP

Point Playwright MCP at the running Expo web target. For root checkout dev, `npm run dev:app` reserves `http://localhost:8081`. For Otto-managed worktree app services, use the service URL or port shown by Otto for that worktree.

Do NOT use browser history (back/forward). Always navigate by clicking UI elements or using `browser_navigate` with the full URL — the app uses client-side routing and browser history breaks state.

## App web deploys

`packages/app` exports a single-page Expo web app and deploys the `dist/`
directory to Cloudflare Pages with `npm run deploy:web --workspace=@otto-code/app`.

PWA install metadata lives in `packages/app/public/manifest.json` and is linked
from `packages/app/public/index.html`. Keep the install icons in `public/` so
Cloudflare serves them from stable root URLs after `expo export`.

Do not add service-worker caching casually. Otto is a live control surface for
agents, and an aggressive service worker can strand installed users on stale web
code. If offline behavior becomes a product requirement, add it deliberately
with an update strategy and test the installed-app upgrade path.

## Expo troubleshooting

```bash
npx expo-doctor
```

Diagnoses version mismatches and native module issues.

## Typecheck

Always run typecheck after changes:

```bash
npm run typecheck
```
