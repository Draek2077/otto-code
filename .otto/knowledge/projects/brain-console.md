---
id: "brain-console"
kind: "project"
title: "Brain Console"
status: "confirmed"
tags: ["project-charter", "legacy-projects-migration"]
delivery_status: "partial"
created_at: "2026-08-08T06:17:20.937Z"
updated_at: "2026-08-08T06:19:43.357Z"
---

# Brain Console

<!-- compiled_truth -->

# Brain Console

A top-level page, outside workspaces, that does everything the brain's TUI does. Reached from the
main icon rail at the bottom left. Works identically against a local brain and a remote one.

Extends [brain-host-control](../brain-host-control/brain-host-control.md) (the daemon-managed
lifecycle and the first RPC surface) and [remote-brain](../remote-brain/remote-brain.md) (mode
local/remote, sharing, the trust model). Status for all three lives in
[`projects/README.md`](../README.md), not here.

## Why

Three problems, one page.

**The TUI is unreachable for most users.** On Windows it cannot run under the desktop app's bundled
`otto` at all: `Otto.exe` is a GUI-subsystem binary, so `stdin.isTTY` is false and `setRawMode` has
no console to switch (`packages/brain/CLAUDE.md`). The workaround is "install the npm CLI and use a
different terminal". That is not a workaround, it is a missing feature.

**Brain operations are buried in Settings.** Downloading a model, calibrating VRAM, sweeping a
reasoning budget and running a benchmark are not settings. They are work: long-running, progress-
bearing, result-producing. They sit today inside `Settings > Host > Brain` next to TLS certificate
paths, which is the wrong altitude for both.

**Remote brains are second class.** Everything operational reaches the brain by shelling out to
`otto-brain <verb> --json` from the daemon (`BrainOpsManager`). That path is local-only by
construction, so a remote brain gets status and evals and nothing else. This fork's stated mission is
that a capability is not done when one target has it. A brain on another machine should be as
manageable as the one on this one.

## The architectural decision

**Stop extending the shell-out path. Extend the brain's own `/__host/*` HTTP API, and have the daemon
proxy it.**

`BrainOpsManager` shells out. Every capability built that way needs a second implementation before
remote can have it. The brain already serves a management API (`/__host/status`, `/__host/config`,
`/__host/evals`) whose header comment states the intent plainly: "the single API both the TUI and
Otto's GUI consume, so the two never drift". `BrainManager` already resolves that endpoint by mode.
So a capability added there is reachable locally and remotely through the same code, with no second
path and no branch in the client.

The existing shell-out RPCs stay. They cover download, runtime install, calibrate, sweep and bench,
which are genuinely local jobs on a local model store, and they already work. Nothing new joins them.

### Capability negotiation

Two versions matter and they move independently: the daemon (does it know how to proxy this?) and the
brain (does it serve it?). Per `CLAUDE.md`, detection happens in one place and downstream code reads a
clean shape.

1. The brain serves `GET /__host/capabilities`, a flat object of booleans.
2. The daemon probes it and folds the result into `brain.host.status` as `capabilities`.
3. The daemon advertises `server_info.features.brainConsole` when it knows how to do steps 1 and 2.

The client reads `features.brainConsole` to decide whether the page exists at all, then reads
`status.capabilities` to decide which tabs are live. A brain too old to serve a capability shows
"Update the brain on this host to use this." No fallback path, no degraded reimplementation.

### Write authorization

`POST /__host/config` is already refused with 403 unless the owner set `allowRemoteConfig`, so "can
use this brain" does not imply "can reconfigure it". The new write endpoints inherit that gate,
because they are strictly more dangerous than changing a default model:

| Endpoint                                               | Gate                             |
| ------------------------------------------------------ | -------------------------------- |
| Any `GET /__host/*`                                    | auth token (as today)            |
| `POST /__host/model/profile`                           | auth token + `allowRemoteConfig` |
| `POST /__host/model/load`, `POST /__host/model/unload` | auth token + `allowRemoteConfig` |
| `DELETE /__host/model`                                 | auth token + `allowRemoteConfig` |

Deletion removes files from someone else's disk. It does not get a weaker gate than editing their
config.

## What the TUI does that nothing else can reach

Measured against `packages/brain/src/tui/app.ts`. Everything else in the TUI already has an RPC.

| TUI capability                                                                                                                             | Where it lives now                             | Gap                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- | --------------------------------------------------------------------------------- |
| The eight per-model profile fields: context, KV cache K, KV cache V, flash attention, vision, reasoning budget, GPU layers, parallel slots | `profiles.json`, written in process by the TUI | No endpoint **and no CLI verb**. `otto brain config set` is global config only    |
| VRAM budget panel: weights + projector + kv + overhead, fit verdict, measured vs theoretical source                                        | `vram.ts` `budget()`, called in process        | Pure function, nothing exposes it                                                 |
| Fit max context (the `m` key)                                                                                                              | `vram.ts` `maxContextThatFits()`               | Same                                                                              |
| Delete a model (`D`)                                                                                                                       | Nowhere                                        | No verb, no RPC                                                                   |
| Supervisor log tail (`l`)                                                                                                                  | `supervisor.logLines`, in memory               | No endpoint                                                                       |
| Load a specific model into the running host (`s`)                                                                                          | Supervisor swap, in process                    | The daemon can only restart its child, which a remote brain has no equivalent for |
| Live resources: cpu, ram, gpu util, vram, temperature, slots busy/total, disk free                                                         | `sysmon.sample()` + llama-server `/slots`      | Not on `/__host/status`                                                           |
| Per-model metadata (arch, layers, kv heads) and per-model bench score in one list                                                          | Split across `scan`, `gguf`, and `results`     | Never joined; the client would have to do it                                      |

`budget()` and `maxContextThatFits()` are already pure functions over `{model, profile, calibration,
totalVramBytes}`. Exposing them is wiring, not new logic.

## Phase 1: the brain's management API

Additive. Existing routes are untouched, and the handler claims only the paths it implements so an
unknown `/__host/*` still falls through as before.

**Model ids are relative file paths and contain slashes**, so model-scoped routes take `?id=` rather
than a path segment. A slash encoded as `%2F` inside a path is exactly the thing an intermediary
normalises, and the resulting failure reads as "model not found" instead of a routing bug.

| Route                                         | Does                                                                                                                                                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /__host/capabilities`                    | Flat booleans, including `writable` (the live `allowRemoteConfig` state)                                                                                                                                                  |
| `GET /__host/status?resources=1`              | Adds `resources` (cpu, ram, gpu, vram, slots) and `logLineCount`. **Opt-in**: the daemon's liveness probe polls status far more often than any UI, and must not pay an `nvidia-smi` spawn for a panel it is not rendering |
| `GET /__host/models`                          | The joined inventory plus disk usage                                                                                                                                                                                      |
| `GET /__host/model?id=`                       | One inventory row, for a detail pane that does not want the whole list                                                                                                                                                    |
| `GET /__host/model/fields?id=`                | The field descriptors a client renders the editor from                                                                                                                                                                    |
| `GET`/`POST /__host/model/profile?id=`        | Read and write the eight fields; the write returns the recomputed budget so an edit costs one round trip                                                                                                                  |
| `GET /__host/model/budget?id=&contextSize=&…` | The `Budget` breakdown and `maxContextThatFits`, against a **hypothetical** profile from the query, so the UI can show the budget updating as a field is scrubbed without persisting a value mid-drag                     |
| `POST /__host/model/load?id=`                 | Loads through the existing fit-to-VRAM path, refusing a profile that cannot start                                                                                                                                         |
| `POST /__host/model/unload`                   | Stops the supervisor                                                                                                                                                                                                      |
| `DELETE /__host/model?id=`                    | Deletes files and any unshared projector, refusing while loaded, and reports bytes freed                                                                                                                                  |
| `GET /__host/logs?limit=N`                    | Tails `supervisor.logLines`                                                                                                                                                                                               |

The inventory row is the join the client would otherwise have to do itself by correlating three
unrelated lists on display name: scan row, GGUF metadata, capability flags, saved profile,
calibration state (measured / inherited / stale / theoretical), VRAM budget, max context that fits,
benchmark score and rank, and load state.

**Where the field ranges live.** `config/profile-edit.ts` owns the editable surface: the field
descriptors a client renders from, the validator a write goes through, and the warnings a combination
earns. One module, because a validator that disagreed with the editor would either reject something
the UI offered or accept something that cannot start. It carries the three empirical rules: a
quantised V cache requires flash attention (blocking), an unrestricted reasoning budget is the
documented failure this package exists to prevent (advisory), and changing a cache type invalidates a
measured calibration.

The write path honours only the eight editable keys. `modelPath`/`mmprojPath`/`modelId` are
re-derived from the model on every read, so accepting them would be a lie at best and a path
traversal at worst; `extraArgs` is arbitrary process arguments and stays CLI-only.

## Phase 2: protocol and daemon

New RPCs, dotted with direction suffixes per [docs/rpc-namespacing.md](../../docs/rpc-namespacing.md),
all proxied through `BrainManager` so they resolve by mode with no local/remote branch:

`brain.models.inventory` · `brain.model.profile.get` · `brain.model.profile.set` ·
`brain.model.budget.get` · `brain.model.load` · `brain.model.unload` · `brain.model.delete` ·
`brain.logs.tail`

Wire schemas stay pure structural declarations: new fields optional with sensible defaults,
`z.discriminatedUnion` for the message union, no `.transform()` or `.catch()`. Passthrough on the
opaque sub-objects (budget, resources, metadata) so the brain can evolve them without a protocol bump,
matching how `BrainHostStatusSchema` already handles telemetry and scheduler.

`server_info.features.brainConsole`, with the single
`// COMPAT(brainConsole): added in v0.7.x, drop the gate when floor >= v0.7.x` marker.

## Phase 3: the page

Route `/brain`, registered in **both** places `docs/expo-router.md` requires: `RootStack` in
`packages/app/src/app/_layout.tsx` inside the `storeReady` guard, and the
`AppWithSidebar.shouldShowAppChrome` pathname allow-list. Missing the second gives a page with no
sidebar and no way back out.

A fourth button on the bottom-left rail in `components/sidebar/sidebar-footer-nav.tsx`, using the
`Brain` icon that already exists in `components/icons/material-icons.ts`. `SidebarFooterNavItem` and
`resolveSidebarFooterActiveItem` both extend, and the prop threads through both mount sites
(`left-sidebar.tsx` and `settings-screen.tsx`).

Layout follows `stats-screen.tsx`, which is the closest existing precedent: `MenuHeader` pinned at the
top, a `SegmentedControl` in a pinned toolbar band, exactly one scroll region below it, one
`useIsCompactFormFactor()` branch per component. A host picker sits in the toolbar when more than one
connected host has a brain. Per-host state, never a merged view.

Five tabs:

| Tab            | Replaces in the TUI                    | Contents                                                                                                                                                                                                                                                         |
| -------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Overview**   | Header, status panel, VRAM panel       | State, model, pid, uptime; VRAM ring; cpu/ram/gpu/temperature tiles; slots meter with the saturation warning; telemetry counters and the reasoning-only warning; disk; start, stop and restart                                                                   |
| **Models**     | The standard view, both panels         | Table of installed models with score badge, quant, size, capabilities, calibration state. Detail panel: metadata, the eight profile fields, the live VRAM budget breakdown and fit verdict, Fit max context, and Load, Stop, Calibrate, Sweep, Benchmark, Delete |
| **Library**    | HF search, quant picker, rescan        | Catalog, Hugging Face search, quant picker, runtimes and install, active jobs with progress and cancel                                                                                                                                                           |
| **Benchmarks** | The bench view and the evals dashboard | Leaderboard table, per-model scorecard, variance table, run the suite                                                                                                                                                                                            |
| **Logs**       | The logs view                          | Supervisor tail                                                                                                                                                                                                                                                  |

Standards from [docs/design.md](../../docs/design.md) that this page is specifically at risk of
getting wrong: the model list and the leaderboard are **tables, not cards**, with the pinned header
importing the same column widths as the rows; destructive actions (delete a model, reset benchmarks)
go through `confirmDialog`; page-level notices are `<Alert>`, never `SidebarCallout`; tokens only, no
raw hex and no off-scale spacing; `withUnistyles` on themed leaves rather than `useUnistyles()`.

The eight profile fields are the one place where the TUI's density is worth keeping. They are a
compact labelled grid with inline warnings (quantised V cache needs flash attention; changing a cache
type invalidates calibration; an unrestricted reasoning budget is the failure this package exists to
prevent), not eight `SettingsRow`s on a scroll.

## Phase 4: drain Settings

`Settings > Host > Brain` keeps connection, security and lifecycle: mode, host and port, default
model and lock, auth, TLS, Sharing, Remote configuration, and start/stop/restart. Those are setup.

`BrainModelsSection` and `BrainOperationsSection` move to the page and are deleted from
`host-brain-models.tsx`. `BrainDashboardSheet` is absorbed by the Overview and Benchmarks tabs and
deleted, along with its launcher. A link to the page replaces them.

## Phase 5: documentation

There is no `docs/` page for the brain at all today, only charters. This work creates
`docs/brain.md`, listed in [`docs/README.md`](../../docs/README.md), covering the `/__host/*` API as a
contract, the capability negotiation, the write authorization gate, and the local/remote equivalence
guarantee. A row in the E2E coverage matrix (`projects/e2e-qa-coverage/coverage-matrix.md`) lands in
the same change as the spec, per [docs/testing.md](../../docs/testing.md).

## Deliberately not in this

- **Replacing the TUI.** It stays. It is the headless path and it works over SSH.
- **A second browser or inference stack.** The page drives the brain's API; it does not talk to
  `llama-server`.
- **Editing a remote brain's bind, TLS or auth.** Still host-owned, still needs a remote restart
  mechanism, still tracked in [remote-brain](../remote-brain/remote-brain.md).
- **Websocket push.** The dashboard polls at 2s today and the TUI polls at 2s. Polling stays until
  the push feed lands as its own piece of work, already open under brain-host-control.

## Timeline

- time: "2026-08-08T06:17:20.937Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-08T06:17:20.937Z"
  kind: "evidence"
  summary: "Migrated from `projects/brain-console/brain-console.md` and the legacy `projects/README.md` ledger. Legacy status: Partial. Ledger summary: **Built (all six phases, compiles and unit-tests green across five packages; not yet run live).** The brain grew a real management API (`service/host-api.ts`): `/__host/capabilities`, the joined `/__host/models` inventory, `/__host/model/profile` read+write, `/__host/model/budget` against a **hypothetical** profile so the UI can re-price mid-drag, `/__host/model/load`+`unload`, `DELETE /__host/model`, `/__host/logs`, and an opt-in `?resources=1` on status (opt-in because that route is also the daemon's liveness poll and must not pay an `nvidia-smi` spawn per probe). Field ranges, the write validator and the three empirical warnings now live in ONE module (`config/profile-edit.ts`) so the editor and the thing that rejects a write cannot disagree. 8 new RPC pairs behind `features.brainConsole`, proxied through `BrainManager` so local and remote share one path. Capability negotiation is two-level and `capabilities` rides INLINE on the status (a separately cached copy goes stale the moment `allowRemoteConfig` is toggled, since `writable` lives in it). `/brain` registered in both expo-router places, a Brain icon on the bottom-left rail, and five tabs (Overview, Models, Library, Benchmarks, Logs) on the stats-screen layout. Settings drained to connection/security/lifecycle plus a link out; `BrainModelsSection`, `BrainOperationsSection` and the whole `brain-dashboard-sheet.tsx` deleted. Folded into the new [docs/brain.md](../docs/brain.md). **Open:** never run against a live brain, so every path is compile-verified only; 12 ❌ rows in the E2E matrix (§11a); the per-model bench scorecard (throughput, context held, per-task categories) that the TUI's bench sidebar shows is not on the Benchmarks tab yet, only the leaderboard and variance; no i18n extraction (English-only labels, matching the `stats` precedent). Supersedes the dashboard/tray remainder in [brain-host-control](brain-host-control/brain-host-control.md), whose \"dashboard\" is now these tabs. Original charter (for the reasoning): A top-level **Brain** page outside workspaces, on the bottom-left icon rail, doing everything the brain TUI does, identically for a local and a remote brain. The TUI is unreachable on Windows under the bundled `otto` (GUI-subsystem binary, no TTY for `setRawMode`), and brain _operations_ (download, calibrate, sweep, benchmark) are work rather than settings, so they leave `Settings > Host > Brain`, which keeps connection, security and lifecycle. **The architectural call: stop extending `BrainOpsManager`'s shell-out path** (local-only by construction, which is why a remote brain gets status and evals and nothing else) **and extend the brain's own `/__host/*` HTTP API instead**, which `BrainManager` already resolves by mode, so one implementation serves both. Eight TUI capabilities have no endpoint _and no CLI verb_ today: the per-model profile fields (context, KV cache K/V, flash attention, vision, reasoning budget, GPU layers, parallel slots), the VRAM budget breakdown and fit-max-context (`vram.ts` `budget()`/`maxContextThatFits()` are already pure functions, so exposing them is wiring), model delete, the supervisor log tail, loading a specific model into a running host, live resources/slots/disk, and the metadata+bench-score join. Capability negotiation is two-level because daemon and brain version independently: the brain serves `GET /__host/capabilities`, the daemon folds it into `brain.host.status` and advertises `features.brainConsole`. New write endpoints inherit the existing `allowRemoteConfig` 403 gate, since deleting someone's model files is strictly more dangerous than changing their default model. Five tabs (Overview, Models, Library, Benchmarks, Logs) on the `stats-screen.tsx` layout; `/brain` needs **both** expo-router registrations. Creates the first real `docs/brain.md`. Extends [brain-host-control](brain-host-control/brain-host-control.md) and [remote-brain](remote-brain/remote-brain.md)"
- time: "2026-08-08T06:19:43.357Z"
  kind: "note"
  summary: "Migrated from the repository's existing authoritative project or reference documentation at the user's request. New status: confirmed."
