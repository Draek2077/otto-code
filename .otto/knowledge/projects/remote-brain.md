---
id: "remote-brain"
kind: "project"
title: "Remote Brain"
status: "confirmed"
tags: ["project-charter", "legacy-projects-migration"]
delivery_status: "partial"
created_at: "2026-08-08T06:17:58.615Z"
updated_at: "2026-08-08T06:19:50.289Z"
---

# Remote Brain

<!-- compiled_truth -->

# Remote Brain

**Status: Partial** (read-only remote, phases 1-3, shipped). Companion to
[brain-host-control](../brain-host-control/brain-host-control.md), which is the control surface for the
_local_ daemon-managed brain. This charter extends that surface so a single daemon can manage a
**remote** brain (an `@otto-code/brain` running on another Otto host) as a first-class target: the same
config, status, telemetry, and perf/bench views, and the same auto-wired provider, whether the brain
lives on this machine or across the network.

**Built:** phases 1-3 below (config model, `BrainManager` remote read path, Local/Remote UI) and the
phase-5 config-write path (brain `POST /__host/config` writes config.json and live-applies model/lock;
daemon `brain.remote.config.get/patch` proxy; a "Remote configuration" UI section for the remote
brain's default model + lock). **Open:** phase 4 (provider auto-provisioning); live-editing remote
bind/TLS/auth (needs a remote restart mechanism, so still host-owned); per-client quotas/priority. The
per-phase detail below is the design of record; live status is the row in
[projects/README.md](../README.md).

## The problem this solves

Today the Brain settings page manages one thing: a brain the daemon spawns and supervises locally.
A brain on another server is reachable only as a hand-configured OpenAI-compatible provider, and that
gives you inference and nothing else. No status, no VRAM readout, no eval rankings, no config view,
and you configure the endpoint and token twice (once as "the server", once as "a provider").

The goal: pick **Local** or **Remote** on the Brain page. In both cases the daemon knows the endpoint
and token, surfaces the full brain UI, and provisions the consuming provider for you. The user should
never hand-wire a provider to reach their own brain, and the perf/bench/config views should look
identical for local and remote.

## The key fact that makes this cheap

The daemon already talks to the brain **purely over HTTP**. It never reaches into the brain's process;
it spawns a child and then speaks to `/health` and the read-only host API:

- `/__host/status` (version, state, model, VRAM, telemetry, scheduler, recent)
- `/__host/config` (the effective config, secrets redacted)
- `/__host/evals` (benchmark rankings, variance, latest)

`brain.host.status` and `brain.evals.get` are already thin proxies over those endpoints (see
`BrainManager.status()` / `.evals()`). So the **read path for remote is almost free**: point the
daemon's probe endpoint at the remote host, port, token, and TLS instead of loopback, and status +
evals + config-view light up unchanged.

What does _not_ exist yet is a **write/control path over the network**. Lifecycle (start/stop/restart)
and config editing are local-only: the daemon spawns a child and writes `otto-brain/config.json` on
local disk. A remote brain cannot be spawned by this daemon, and its disk is not reachable. Managing a
remote brain's config or lifecycle therefore requires the brain to expose a write/control API. That is
the one substantial new surface this initiative adds.

## Serving many Ottos at once

A remote brain is a shared resource: several Otto hosts point at one brain. Two things this needs are
**already built** in the brain, and one is a new policy knob just added.

- **Concurrency and queueing already exist.** The brain's `Scheduler` (`service/scheduler.ts`)
  multiplexes clients on a single GPU: requests for the resident model run concurrently up to that
  model's `parallelSlots`; requests for a _different_ model wait for a turn, and the scheduler
  alternates turns so a steady stream for model A cannot starve model B. Two Ottos wanting different
  models share the GPU by taking turns; many Ottos wanting the same model run concurrently. `stats()`
  already reports `queued` / `waiting` / `lastTurn`, which the status UI surfaces.
- **Model policy: the lock.** With many clients, uncontrolled model switching thrashes the GPU (every
  cross-model request forces a reload). The **Lock model** option (`config.lockModel`, shipped) pins
  the host to one model: the default/resident model is served, and any completion naming a different
  model is refused with `409` instead of queuing a switch. That is the "load one model, deny switches"
  control an operator running a shared brain wants. Enforced at the source in `router.decideModelGate`.
- **Model requirements.** VRAM fit is already measured per model (`vram.fitToBudget`, calibration);
  a model that will not fit is refused rather than half-loaded. For a shared host this is the backstop
  that keeps one client's oversized request from wedging everyone.

Open for this initiative: per-client auth identity and quotas/priority (today the token authorizes,
it does not distinguish clients), admission control when a requested model cannot fit alongside demand,
and whether the lock and queue policy are editable remotely (they ride the write/control API in phase 5).

## Shape of the work

### 1. Config model

Add a mode discriminator to the daemon's `brain` block:

- `brain.mode: "local" | "remote"` (default `"local"`, so existing installs are unchanged).
- `brain.remote: { host, port, secure, authToken }` for the remote target.

`local` behaves exactly as today. The existing `listen`/`tls`/`auth` fields stay the local server's
config; `remote` is a separate, small block so the two never bleed into each other.

### 2. BrainManager remote endpoint (read path)

When `mode === "remote"`, `BrainManager` does not spawn a child and does not write config through to
disk. It sets its `endpoint` to the remote target and answers `status()`/`evals()` by probing the
remote host API (it already builds requests against `this.endpoint`, so this is mostly a matter of not
forcing loopback in `resolveProbeHost`). "Running" for remote means the remote `/health` answers; there
is no pid. Start/stop/restart are disabled unless the remote advertises the control API (phase 5).

### 3. UI

A **Local / Remote** switch at the top of the Brain page. Remote reveals host/port/HTTPS/token fields
(the network pick-list and Tailscale detect already built for local bind can be reused for entering a
remote address). Status, dashboard, and eval views are unchanged: they read the same RPCs. Lifecycle
controls hide (or, with phase 5, proxy) for remote.

### 4. Provider auto-provisioning

The daemon owns the `otto-brain` OpenAI-compatible provider entry and keeps it pointed at the **effective**
brain endpoint, local or remote, with the right base URL and token. The user selects the brain once; the
provider follows. This is the "besides the provider, no configuration" ask: the provider still exists (it
is how inference is consumed), but the daemon configures it from the brain settings rather than the user
configuring it by hand.

### 5. Brain `/__host/*` write/control API (the new brain-side surface)

To manage a remote brain (not just observe it), `@otto-code/brain` grows an authenticated write/control
surface alongside its read API:

- `POST /__host/config` (apply an editable-projection patch; the brain writes its own `config.json`).
- model load/unload and `restart` control (so remote lifecycle buttons work).
- A capability marker the daemon detects, so an older remote brain degrades to read-only cleanly.

All guarded by the existing bearer token, and only meaningful over a secured transport (this is exactly
what the built-in TLS modes are for). This phase is where the security review lives: exposing control,
not just reads, over the network.

## Boundaries

- Read-only remote (phases 1 to 4) is the first shippable increment and covers "see everything the same
  way." Remote config editing and lifecycle (phase 5) are a deliberate follow-on gated on the brain's new
  API.
- One brain per daemon still holds: this is about _where_ that brain runs, not running several at once.
- The brain does not grow a tray or its own desktop presence; Otto remains the desktop, the CLI the
  headless path. Same rule as [brain-host-control](../brain-host-control/brain-host-control.md).

## Open questions

- Provider identity when switching local ↔ remote: reuse one `otto-brain` entry repointed, or distinct
  entries. Leaning toward one repointed entry so model references in saved chats stay valid.
- Control-API auth scope: is the bearer token enough to authorize writes, or should control require a
  second, separately-issued capability. Decide in phase 5's security pass.

## Timeline

- time: "2026-08-08T06:17:58.615Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-08T06:17:58.615Z"
  kind: "evidence"
  summary: "Migrated from `projects/remote-brain/remote-brain.md` and the legacy `projects/README.md` ledger. Legacy status: Partial. Ledger summary: Let one daemon manage a **remote** `@otto-code/brain` (on another Otto host) as a first-class target. **Built (read-only remote, phases 1-3):** `brain.mode` local/remote + `brain.remote {host,port,secure,authToken}` (secret-masked) behind `features.brainRemote`; `BrainManager` remote mode repoints the probe endpoint at the remote `/__host/*` so status/evals work unchanged (no spawn, lifecycle refused); the Brain page's Local/Remote switch with remote host fields, hiding the local server/lifecycle blocks. **Built (phase 5, remote config):** brain `POST /__host/config` (auth-guarded) writes config.json and live-applies model/lock (router reads both via live getters); daemon `brain.remote.config.get/patch` proxy; a \"Remote configuration\" UI section to change the remote brain's default model + lock. Network/TLS/auth stay host-owned by design. **Built (sharing opt-in + control gate):** a brain is loopback-only until its owner opts in - `otto brain share` CLI and a local-only **Sharing** UI section (bind, access = open or a generated key, HTTPS, \"allow reconfigure\"). `POST /__host/config` is refused (403) unless `allowRemoteConfig` is on, so \"can use\" ≠ \"can configure\"; `allowInsecureBind` gates an open non-loopback bind. Remote-config UI shows read-only when the far side hasn't allowed it. **Open:** phase 4 - provider auto-provisioning (daemon wires the `otto-brain` OpenAI-compatible provider from the effective endpoint so inference needs no hand-config); per-client quotas/priority; live-editing remote bind/TLS/auth (needs a remote restart mechanism). Extends [brain-host-control](brain-host-control/brain-host-control.md) | phase 4 - provider auto-provisioning (daemon wires the `otto-brain` OpenAI-compatible provider from the effective endpoint so inference needs no hand-config); per-client quotas/priority; live-editing remote bind/TLS/auth (needs a remote restart mechanism). Extends [brain-host-control](brain-host-control/brain-host-control.md)"
- time: "2026-08-08T06:19:50.289Z"
  kind: "note"
  summary: "Migrated from the repository's existing authoritative project or reference documentation at the user's request. New status: confirmed."
