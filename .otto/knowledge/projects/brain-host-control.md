---
id: "brain-host-control"
kind: "project"
title: "Brain Host Control"
status: "confirmed"
tags: ["project-charter", "legacy-projects-migration"]
delivery_status: "partial"
created_at: "2026-08-08T06:17:21.505Z"
updated_at: "2026-08-08T06:19:43.695Z"
---

# Brain Host Control

<!-- compiled_truth -->

# brain-host-control

**Status:** Partial - daemon-managed lifecycle, Settings control, and the live
dashboard are **built and live-verified** end-to-end (real model start → completion
→ telemetry → stop, through the daemon RPCs on the dev daemon; see "Live-verify" below).
Named remainder: the websocket push feed, the tray menu item, and i18n extraction of
the page/dashboard body copy. **Owner:** unassigned.

## Why

`@otto-code/brain` is a **resident process** - `otto brain start` detaches a
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
- **CLI lifecycle - the headless quit path, cross-platform, done.**
  `otto brain start` (detached, pid-locked) / `stop` (SIGTERM + pid cleanup) /
  `restart` / `status` (scheme-aware `/health` probe). Works on a bare server with
  no desktop; this is the fallback the GUI never replaces.
- **Otto's Electron tray exists** (`packages/desktop/src/features/tray.ts`) - a
  cross-platform `Tray` with Show / Quit, currently shown only while no window is
  visible.

## What is built (compiles end-to-end and live-verified - see "Live-verify" below)

1. **Brain host API** (`packages/brain`) - one API the TUI and Otto GUI both
   consume, so they never drift: `/__host/status` (supervisor state, telemetry,
   scheduler, version), `/__host/config` (token masked), `/__host/evals`
   (rankings/variance/latest). Router options `version`/`getConfig`/`getEvals`
   wired in `serve.ts`.
2. **Protocol** (`packages/protocol`) - `features.brainControl` +
   `features.brainStatus`; a `brain` block on `MutableDaemonConfig` (enable/
   autostart, listen, model, auth, TLS); correlated RPCs `brain.host.status/
start/stop/restart` and `brain.evals.get`. Backward-compatible (all defaulted).
3. **Server** (`packages/server`) - `server/brain/brain-manager.ts`: spawns
   `otto brain serve` as a managed child, polls `/health`, registers in the
   managed-process ledger (`owner {provider:"brain", kind:"service"}`), restarts on
   crash (3 within 60s), **writes config through to the brain's `config.json`** (the
   brain's file stays authoritative), and **dies with the daemon** via
   `brainManager.shutdown()` in the daemon `stop()` block. Five RPC handlers in
   `session.ts`, hot-reload via `daemonConfigStore.onChange`, `brainControl`/
   `brainStatus` flags on, persisted `daemon.brain` block, `brain.authToken` in
   `SECRET_WIRE_PATHS`. `@otto-code/brain` is a server dependency (bin resolution).
4. **Client** (`packages/client`) - `brainHostStatus/start/stop/restart` +
   `brainEvalsGet` on `DaemonClient` (correlation auto-matched via `payload.requestId`).
5. **Settings control** (`packages/app`) - Settings → Host → **Local brain**
   (`screens/settings/host-brain-page.tsx`): status/version/model/endpoint,
   Start/Stop/Restart, and full config editing (server/auth/TLS). Gated on
   `brainControl`. Plus an **Otto Brain** provider catalog entry (`data/
acp-provider-catalog.ts`, extends openai-compatible) and the Material `Brain` icon.
6. **Live dashboard** (`components/brain-dashboard-sheet.tsx`) - a sheet with live
   status (2s poll: VRAM ring, telemetry verdict bars - the same reasoning-only/
   truncated/failed signals as the TUI) and an evals tab (per-model ranking bars +
   variance table), hand-rolled SVG per the dataviz skill.

## Named remainder (open)

- **Hugging Face model discovery - BUILT across six packages (2026-07-31), not yet
  live-verified through the app.** Brain: `models/hf.ts` (`searchModels`,
  `listRepoQuants`), the `otto brain search`/`add [--quant|--list-quants]` CLI verbs
  (`--json`), arbitrary-repo download with shard + shared-projector handling and an
  HF token (`config set hfToken`, env `HF_TOKEN` wins), plus TUI `f` (search-and-add),
  `g` (re-quant), `D` (delete-with-confirm) and a disk-usage line. Daemon→app: three
  RPCs behind `features.brainHfSearch` - `brain.hf.search` + `brain.hf.quants` (reads)
  and `brain.models.add` (a `pull` job, owner/repo + quant) - served by
  `BrainOpsManager.searchHf`/`repoQuants`/`addModel` (shell-out to the CLI, `gated`
  coerced string→bool at the daemon), matching `daemon-client.ts` methods, and a
  "Search Hugging Face" subsection in `host-brain-models.tsx` (query → results →
  per-repo quant list → Get, downloads flow through the existing jobs panel).
  **Open:** live-verify the app path end-to-end (search → add → installed); add
  `hfToken` to `MutableBrainConfigSchema` + `writeThroughConfig` so the token is
  editable from app settings (today the brain resolves its own from env/config, so
  gated repos already work); and the results list is a plain `.map()` - fine for ~30
  rows, virtualize if the limit grows. Contract: TUI and app share the brain code,
  one `--json`/RPC path, no new app↔brain network hop.
- **Websocket push feed.** The dashboard live status is a 2s `brainHostStatus`
  poll today. `features.brainStatus` reserves the capability; a
  `subscribe_brain_status` / `brain_status_changed` push (mirroring checkout-diff/
  terminals) is the later optimization. The eval snapshot stays a periodic RPC.
- **Tray menu item (optional, desktop only).** Kill-on-shutdown already works via
  daemon-stop → `brainManager.shutdown()`. A literal `buildTrayMenu` entry
  ("Local brain: running ● / Stop") remains - no native dependency, reuses Otto's
  cross-platform `Tray`. Open question: Otto's tray only shows when no window is
  visible; decide whether the brain toggle justifies a persistent tray.
- **i18n extraction.** The new Host page + dashboard copy is inline English
  (matching the existing Host-page precedent). Extracting keys needs real
  translations across the 7 non-English locale files.
- **Live-verify pass - DONE (2026-07-30).** Exercised end-to-end on the dev daemon
  (6788) through the real UI path: `patchDaemonConfig({brain:{enabled,defaultModel}})`
  → `brainHostStart(null)` spawned `otto brain serve` as a managed child (ready in
  ~5.2s, LM Studio CUDA 12 runtime, `Qwen3-4B-Thinking-2507-Q4_K_M`), `/__host/status`
  reported version/model/modelId/vram/loadSeconds, a real `/v1/chat/completions`
  returned HTTP 200 ("2 + 2 equals 4.", finish_reason stop) with the router
  classifying the verdict `ok` (809 reasoning chars vs 15 content - reasoning-budget
  cap working, not reasoning-only), telemetry incremented (requests 1 / ok 1) and
  `recent[]` captured the trace the dashboard renders, `brain.evals.get` returned an
  empty-but-valid structure (runCount 0, no benchmark runs yet), and
  `brainHostStop()` killed the child cleanly - VRAM fully released, port freed, no
  orphaned process, `brain-manager` ledger record removed.
  **Model switch while running - also verified (2026-07-30):** a completion naming a
  different catalog model drove the scheduler through a live swap
  (A `Qwen3-4B-Thinking` → B `Qwen3.5-2B-Distilled` → back to A), served HTTP 200 each
  time; concurrent status sampling captured the full turn (`ready` → `stopping`
  qd=1/waiting={B:1} → `starting` loaded=B → `ready`), VRAM re-sampled across the swap
  (21.9 → 6.0 GiB), `scheduler.lastTurn` tracked each model, telemetry `requests 3 /
ok 3`. Switch latency ~3.0–3.2s (unload + load + inference). Not yet checked: a
  non-loopback/TLS bind and the crash-restart policy under a real crash.
- **Ownership on quit (product decision).** Quitting Otto stops the daemon (unless
  `keepRunningAfterQuit`), which cascades to the brain. Whether to offer "keep the
  brain running for headless reuse" separately is undecided; tie into
  `packages/desktop/src/daemon/quit-lifecycle.ts`.

## Timeline

- time: "2026-08-08T06:17:21.505Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-08T06:17:21.505Z"
  kind: "evidence"
  summary: "Migrated from `projects/brain-host-control/brain-host-control.md` and the legacy `projects/README.md` ledger. Legacy status: Partial. Ledger summary: The resident local-brain's **control surface**. **Built (compiles across six packages, not yet run live):** daemon-managed lifecycle (`BrainManager` spawns `otto brain serve`, health-polls, ledger-registers, restarts on crash, config write-through, dies with the daemon), the `brain.host.*`/`brain.evals.get` RPCs behind `features.brainControl`/`brainStatus`, the Settings → Host → **Local brain** page (status + start/stop/restart + config editing), the **Otto Brain** provider catalog entry, and a live status + eval/ranking **dashboard**. Built-in HTTPS + API-key already retired `otto-brain-relay`'s TLS/auth job. **Built (2026-07-30, TUI-parity model management, verified live in the agent lane):** the daemon drives the otto-brain CLI via a new `BrainOpsManager` (shell-out, never in-process) - reads `brain.models.scan`/`brain.catalog.list`/`brain.runtime.list` and runs `brain.models.pull`/`brain.runtime.install`/`brain.calibrate`/`brain.sweep`/`brain.bench` as tracked jobs the client polls (`brain.jobs.list`/`cancel`), all behind `features.brainManage`; the Brain page gains a **Models** section (runtime install, installed-model list with set-default, catalog with live-progress downloads + cancel + busy-gating) and an **Operations** section (calibrate/sweep/benchmark, gated on a runtime being present); new `otto brain catalog` CLI verb annotates each catalog entry with an installed flag; `pull` now derives the GGUF filename from the catalog id so downloads need no `--file`. Verified end-to-end in the preview (a real HuggingFace download progressed to 5% and canceled cleanly). **Remainder:** websocket push feed (dashboard/jobs poll at 2s today), tray menu item, i18n extraction, richer bench-progress parsing. The brain does not grow its own tray - Otto is the desktop presence; the CLI stays the headless quit path"
- time: "2026-08-08T06:19:43.695Z"
  kind: "note"
  summary: "Migrated from the repository's existing authoritative project or reference documentation at the user's request. New status: confirmed."
