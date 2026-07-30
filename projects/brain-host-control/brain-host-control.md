# brain-host-control

**Status:** Charter (nothing built beyond what already exists in the CLI). **Owner:** unassigned.

## Why

`@otto-code/brain` is a **resident process** — `otto brain start` detaches a
`llama-server`-fronting service that stays in memory until stopped. A resident
process needs an obvious, cross-platform way to see that it is running and to quit
it. Today that exists only as CLI verbs. The old `otto-brain-relay` had a Windows
tray icon for exactly this (start / stop / restart / health / settings); when its
HTTPS job moved into the brain (see [docs below](#what-already-shipped)), its
_control_ job did not come with it. This charter is that control surface, done the
right way for the new architecture: **the Otto daemon owns the brain as a managed
child, and Otto's existing cross-platform Electron tray + Settings drive it.**

The reframe that decided the shape: the brain does **not** grow its own tray. Otto
is already the resident desktop presence with a real cross-platform `Tray`
(`packages/desktop/src/features/tray.ts`). A standalone brain-owned tray would mean
a native `systray`-style module and a second GUI stack that is meaningless on a
headless server. The CLI stays the headless/remote quit path; the GUI story lives
in Otto.

## What already shipped (do not rebuild)

- **Built-in HTTPS + API-key in the brain.** `config.tls` (`off` / `files` /
  `self-signed` / `tailscale`), hot-swap renewal, `listen.host: "tailscale"`
  tailnet-only bind, and `x-api-key` auth parity. This retires the relay's TLS,
  credential, and CORS jobs. Architecture in `packages/brain/CLAUDE.md`
  ("Built-in HTTPS").
- **CLI lifecycle — the headless quit path, cross-platform, done.**
  `otto brain start` (detached, pid-locked) / `stop` (SIGTERM + pid cleanup) /
  `restart` / `status` (scheme-aware `/health` probe). Works on a bare server with
  no desktop; this is the fallback the GUI never replaces.
- **Otto's Electron tray exists** (`packages/desktop/src/features/tray.ts`) — a
  cross-platform `Tray` with Show / Quit, currently shown only while no window is
  visible.

## What this charter adds

1. **Daemon-managed brain lifecycle.** The Otto daemon spawns/monitors/stops the
   brain as a managed child when `config.enabled` / `config.autoStart` opt in
   (mirrors how the daemon spawns its own children; see the brain's
   `docs/integration-notes.md` "Service model"). New daemon RPCs behind a
   `server_info.features.brainControl` capability flag:
   `brain.host.status.request/response`, `brain.host.start.*`, `brain.host.stop.*`.
   Follow [docs/rpc-namespacing.md](../../docs/rpc-namespacing.md) and the
   capability-gate rule in [CLAUDE.md](../../CLAUDE.md) (no fallback paths; the
   client detects the capability or shows "update the host").
2. **Otto Settings control.** A "Local brain" section: running/stopped state, the
   endpoint (`scheme://displayHost:port`), model, and start/stop/restart. This is
   the always-reachable home (a tray is a shortcut, Settings is the surface).
3. **Tray menu items (optional, desktop only).** Extend `buildTrayMenu` with a
   "Local brain: running ● / Stop" entry wired to the same RPCs. Reuses Otto's
   cross-platform tray — no native dependency, no second GUI stack.

## Open questions

- **Tray presence.** Otto's tray only appears when no window is visible. A brain
  toggle is arguably wanted while a window is open too. Decide whether the brain
  entry justifies a persistent tray, or whether Settings is enough and the tray
  item is a windowless-only convenience.
- **Ownership on quit.** If the daemon manages the brain, quitting Otto should
  offer to stop the brain (a resident child) vs. leave it running for headless
  reuse. Tie into `packages/desktop/src/daemon/quit-lifecycle.ts`.
- **Health/telemetry surfacing.** The brain's `/__host/status` already exposes
  reasoning-only telemetry and scheduler stats; decide how much of that reaches the
  Settings panel vs. stays CLI-only.

## Sequencing

Independent of, and after, the TLS work. Prerequisite is the daemon-managed
lifecycle (item 1); items 2 and 3 are UI consumers of the same RPCs and can land
together or in either order once the capability exists.
