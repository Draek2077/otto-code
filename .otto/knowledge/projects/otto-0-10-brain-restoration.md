---
id: "otto-0-10-brain-restoration"
kind: "project"
title: "Otto 0.10 Brain: complete working feature restoration"
status: "proposed"
tags: ["otto-0.10","brain","restoration"]
delivery_status: "in_build"
progress_completed: 5
progress_total: 10
progress_unit: "accepted Brain checkpoints"
created_at: "2026-10-22T23:04:38.192Z"
updated_at: "2026-11-12T19:43:54.252Z"
---
# Otto 0.10 Brain: complete working feature restoration

<!-- compiled_truth -->

# Otto 0.10 Brain restoration

Restore the complete working Brain product from Otto 0.9 on the clean Paseo 0.12 base. Brain is one coherent feature with independently verified implementation slices; a model endpoint or single-model proof does not complete this charter.

## Current checkpoint (reconciled 2026-11-12)

Brain is integrated and reachable in Otto 0.10: its original animated icon is in the bottom Home/Usage group, and Overview, Library, Models, Benchmark, Logs, friendly settings, standalone/Otto CLI/TUI, local/Remote host management and provider composition are present. The earlier B01–B05 library milestones remain historical accepted checkpoints, not a claim that today's code is only 50% implemented or that Brain is absent.

Current application proof is e9cc4d3ed3f7bb9cd88e751dad2f147947561f14 on otto-0.10/phase-0: full CI 43266928686 passed 21/21 jobs, Otto App Acceptance 43266923452 passed 90/90 journeys and Editor Runtime Acceptance 43266923668 passed. Product build proofs and their source-equivalence/iOS limits remain in the master. The documentation-only head 21a7510c26ad3e0194d89efb659f18f28b3a5586 passes normal formatting, whole-source lint, all-workspace typechecks and seam checks; application code is unchanged. These are automated/packaging results, not real model/GPU, account, native-device or personal-runtime acceptance. Philippe will perform his UI review himself; this basic review neither redesigns Brain nor accepts its UI for him.

The older pending-run/initial-load/cancellation reports below are historical evidence. Current complete app acceptance passed those synthetic-host journeys; no current red CI failure is carried forward by this reconciliation. The broader B06–B10 acceptance requirements remain open for actual native llama.cpp/model/GPU/backend operation, real terminal/personal runtime and device behavior, complete local/Remote permission/lifecycle checks and Philippe's product review. Do not label these merely unstarted code ports, or close them solely because synthetic fixtures pass. vLLM/SGLang remain the agreed follow-on scope. Review is requested; no next implementation starts.

## Accepted product direction

Philippe's 2026-10-22 instructions and answers establish:

- Preserve a self-contained Brain runtime usable without the Otto app, including its standalone command and Otto CLI integration.
- Restore Brain settings, local management, Remote Brain, runtime/model operations and the related Brain systems together.
- Preserve the existing Brain application UI for now. Preserve its distinctive artwork, status effects, transitions, dual-brain rendering and multi-brain activity. Settings may be reorganized using Paseo's normal controls and layout, with clear defaults and advanced options where appropriate.
- Keep the renderer in Otto-owned app files and expose it through a small typed UI bridge. Philippe explicitly selected this approach over expanding the general plugin graphics/animation API.
- Restore the complete working llama.cpp-based Brain first. Philippe explicitly deferred new vLLM/SGLang drivers to follow-on work; preserve that roadmap in [[managed-model-server-runtimes]].
- Keep Otto implementation separate and organized. Use existing Paseo placement, screen, settings, RPC and provider contracts; do not redesign Paseo themes, the shared UI or its agent/session systems.
- Finish the F01 provider usability CI/build checkpoint before starting Brain implementation. Continue one implementation slice at a time, with the five gates in [[otto-0-10-clean-paseo-rebuild]].

## Source of product behavior

The frozen Otto reference is `otto-0.9-final`, commit `95a19522a191394a874320041eaf05f6c5f3c682`. Read its Brain package, application surfaces, CLI, daemon adapters and relevant tests as evidence. Old charters can include unfinished work; distinguish implementation from aspirations instead of describing every old plan as shipped.

The package's recorded standalone contract includes `@otto-code/brain`, `otto-brain`, and `otto brain`. It owns model/runtime acquisition and can operate independently of a desktop app. Local Brain is opt-in; do not introduce model autostart as a side effect of restoring an app or settings screen.

Relevant prior contracts remain linked rather than duplicated: [[brain-host-control]], [[brain-console]], [[remote-brain]], [[remote-brain-functionality-is-host-owned-and-connection-neutral]], [[brain-managed-process-pool]], [[brain-model-bundles]], [[brain-all-model-operations-share-scheduler]], and [[brain-operations-use-resident-hosted-server]].

## Full restoration inventory

- **Standalone runtime and configuration:** headless operation, foreground/detached lifecycle, configuration precedence and atomic private persistence, ownership/locks, readiness, bounded shutdown and recovery, stable serving endpoint, authentication/TLS and existing sharing behavior.
- **Runtime management:** managed llama.cpp installation, discovery/verification/version/selection/update/removal, accelerator/platform handling, existing supported runtime variants and diagnostics. Existing LM Studio discovery can remain a supported path without becoming a required dependency. Preserve current distribution and packaging expectations.
- **Model library and artifacts:** catalog, search/discovery, local scans/import, GGUF quants/shards, projector and other supported bundle components, download/progress/resume validation, installed/loaded distinctions, safe deletion, storage/capacity and host ownership.
- **Hosting, scheduling and multiple models:** load/unload/switch, host-configured residency/process pool, per-model supervisors/ports/profiles, slot admission and queues, locking and eviction behavior, VRAM reservation/release, busy-request reliability, cancellation, and model-targeted operations using the common scheduler.
- **Capacity and quality operations:** calibration, reasoning-budget sweeps, benchmarks, results/reports/rescoring, prompt/template profiles and supported model settings. Preserve stable calibration/budget identities and component-aware accounting.
- **Operations and visibility:** status and real activity signals, lifecycle and runtime logs with source/operation tags, job/progress/results, diagnostics and operational views.
- **CLI/TUI:** restore existing command behavior for lifecycle, runtime, model discovery/acquisition, configuration, sharing, calibration, sweeps, benchmarks and reporting. Keep standalone and Otto CLI commands consistent; preserve the known Windows bundled-GUI-host TUI limitation honestly.
- **Daemon and Remote Brain:** host-owned local management, remote configuration/status/model/runtime/operation behavior, credentials and trust. Remote restart follows advertised host support; local start/stop remain owning-daemon operations. Paths, runtime and disk information belong to the Brain host, independent of how a client reaches it.
- **Provider integration:** use Paseo's full provider registration contract as the OpenAI Compatible Provider does. Reuse the Otto provider/tool harness through an explicit owned boundary rather than copying it or adding a parallel session model. Preserve permissions, MCP, tools, history, compaction and cancellation behavior through existing Paseo sessions.
- **Brain UI and icon:** preserve Overview, Library, Models, Benchmark and Logs and their existing operational behavior. Preserve the state-derived glyph, masks, glow/gradients, crossfades, two independent active halves and three-or-more activity presentation. Do not infer thinking/generating states without runtime evidence. Respect animations/reduced-motion controls and retained/hidden surface lifecycle.
- **Friendly settings:** use Paseo's settings conventions for local/remote configuration, runtime/storage/model defaults, access and advanced controls. Keep operational work on the existing Brain surfaces rather than rebuilding a confusing settings page.

## Integration boundaries

1. Standalone Brain must not require the Paseo app or daemon to run.
2. The daemon/Brain host owns files, credentials, binary/model processes, configuration, scheduling and operations. Clients consume typed host contracts and render the UI on desktop and mobile.
3. Brain's client plugin uses existing `addScreen`, settings, sidebar/footer and header contributions. The current API supports custom component placement, but prohibits direct plugin imports of the old renderer's SVG/animation libraries. The accepted Otto-owned UI bridge addresses that narrow gap without changing themes or base layout.
4. Keep the provider integration plugin-based where supported. Determine a maintainable shared-harness and packaged-runtime boundary before coding it; never import daemon-private modules into plugin source.
5. All unavoidable Paseo edits are minimal, Otto-tagged and traceable. Discuss any additional missing public hook before implementing it.
6. Preserve existing Brain homes/configuration, model files/downloads, runtime installations, profiles/templates, calibrations, reports and remote credentials. Use copies and explicit migration checks; never reset or experiment on installed user data.
7. No deferred editor, profiles/teams, general chat, themes or Visualizer restoration is implied by Brain dependencies.

## B01 parity and integration map

### Source boundary and measured inventory

The review used frozen `otto-0.9-final` / `95a19522a191394a874320041eaf05f6c5f3c682` against clean rebuild source `3ed44a93a6aeaae614a322004267cec0f389cf2e`. This is a source/contract review, not a new runtime acceptance test.

Frozen path counts from `git ls-tree`:

| Area | Source-tree files | Test files included |
| --- | ---: | ---: |
| `packages/brain/src` | 127 | 39 |
| `packages/app/src/screens/brain` | 25 | 8 |
| `packages/app/src/components/brain` | 11 | 2 |
| `packages/server/src/server/brain` | 6 | 3 |

These counts exclude surrounding integration files and are not test-case or whole-feature totals. The standalone package's manifest has no daemon, app, client or protocol runtime dependency. References to the old protocol workspace in benchmark inputs/help are data, not package imports.

The source supplies one managed engine driver, `llamaCppRuntimeDriver` in `runtime/model-server-driver.ts`. vLLM/SGLang remain future driver work under the accepted scope. Old project pages with partial/stale delivery descriptions do not override the frozen implementation.

### Capability-to-owner map

| Contract to preserve | Frozen evidence | Rebuild ownership and integration |
| --- | --- | --- |
| Standalone host and stable public identity | `packages/brain/package.json`, `src/index.ts`, `src/main.ts`, `bin/otto-brain` | Restore an Otto-owned standalone workspace at `packages/otto-brain/`. Source workspace naming follows the publish-time mapping convention; npm remains `@otto-code/brain`, standalone command remains `otto-brain`. Keep its runtime independent of Paseo. Use narrow entry points so reading configuration or registering a command does not eagerly start/load the host. |
| Otto CLI and TUI | `src/cli.ts`, `src/commands/`, `src/output/`, old CLI `createBrainCommand()` registration | One command implementation shared by standalone and Otto CLI, registered through an Otto-owned CLI adapter and a small tagged root seam. Preserve output modes/errors and known Windows GUI-host TUI limitation. Keep command loading lazy where practical. |
| Runtime/model acquisition | `src/runtime/`, `src/models/`, `config/downloads.json` | Brain host owns runtime discovery/install/version/variants, model scans/search/download/resume/bundles/removal and resolved paths. Restore the seed catalog and package assets deliberately. Clients send identities/options and render typed progress; they do not guess remote paths. |
| Serving, security and operations | `service/serve.ts`, `router.ts`, `host-api.ts`, `tls.ts`, `tailscale.ts` | Keep stable serving/management endpoints, existing authentication/TLS and sharing policy in standalone Brain. Preserve model listing and routed completion APIs, service health versus model readiness, status/capabilities, jobs/cancellation and logs. |
| Multi-model hosting and admission | `service/process-pool.ts`, `scheduler.ts`, `supervisor.ts`, `activity.ts` | Preserve per-resident process/port/profile, VRAM accounting and release, slot queues, locking, eviction and cancellation. The same host data must drive operations and single/dual/multi-brain visuals. |
| Capacity/quality operations | `ops/`, `bench/`, `config/profiles.ts`, hosting-profile/template modules | Preserve calibration identities, reasoning sweeps, benchmarks/reports/rescoring, bundle-aware budgets and profile/template behavior. Keep model-targeted work on the host scheduler. Reuse measured behavior where valid rather than changing algorithms during integration. |
| Local and Remote Brain controller | Old `brain-manager.ts`, `brain-ops-manager.ts`, `brain-config-owner.ts` | New controller lives under the Brain plugin's `server/`, using Brain's authenticated HTTP/SSE API and public SDK process helpers. Supply daemon-resolved home/executable context through an Otto-owned host boundary. Do not import the old private daemon managers into plugin source. Preserve remote capability/write/restart gates and owning-host lifecycle. |
| Management RPCs | `packages/protocol/src/brain.ts` | Map operations into Brain-owned shared DTO/RPC contracts carried by Paseo's existing `plugin.rpc.invoke.request/response`. Do not restore 35 handlers to core `session.ts` or copy the old Brain wire union into Paseo. Sanitize secrets at the host boundary. |
| Provider and old provider identities | Old `agent/otto/provider-factories.ts`, `provider-manifest.ts`; current F01 provider and legacy reader | Restore provider ID `otto-brain` and its availability/error/model semantics through plugin registration. Share the tested Otto OpenAI agent/tool harness behind an explicit Otto-owned SDK server export, rather than copying it or bringing back private agent adapters. Preserve deferred Brain-derived aliases when their supported settings can be restored. Changes to this shared factory require F01 regression checks. |
| Existing Brain page | `screens/brain/brain-screen.tsx` and five tab implementations | Preserve Overview, Library, Models, Benchmark and Logs, their per-host selection, operation behavior and split-pane presentation. Reconnect data/navigation through the plugin screen and approved Otto-owned UI bridge instead of restoring old host/client hooks wholesale. |
| Icon and its state semantics | `brain-state.ts`, `brain-state-icon.tsx`, glyph/mask modules, rail hook and workspace button | Preserve artwork, masks, glow/gradients, crossfade, activity labels, independently animated halves for two active slots and spectrum for three or more. Use actual runtime phases; do not infer thinking from an open request. Keep animation/hidden-surface lifecycle controls. Use existing custom footer/header component slots. |
| Settings and continuity | Old host Brain settings, `config/paths.ts`, current `docs/otto-continuity.md` | Use Paseo-style settings with local/remote ownership made clear. Preserve standalone data and dormant daemon configuration; credentials stay private and do not become ordinary plugin settings. Keep the existing Brain operational UI rather than moving its work into another large settings form. |
| Builds and distribution | Old release workspace entry; current `scripts/publish-release-packages.mjs`, npm rename and desktop/plugin packaging | Restore Brain to build/typecheck/pack and release dependency order, with standalone and bundled CLI smoke checks. Keep the established published package name and binary. Verify external runtime resources/launch paths in packaged desktop and headless installations, plus the existing Android/Nix/Docker/site matrix and iOS gate. |

The shared provider-factory export is a proposed small Otto-owned SDK addition, not an implemented contract. Its signatures, compiler exposure and packed-module behavior must be proven in B08 before that seam is adopted.

### CLI and management operation inventory

The frozen CLI implements bare interactive invocation and `ui`; `serve/start/stop/restart/status`; `scan/catalog/search/add/pull`; `calibrate/sweep/bench/report/rescore`; `runtime list/install/remove`; `config show/set`; and `share`. Preserve table/json/yaml, quiet, headers and color behavior. Real interactive/benchmark/model workloads need an explicit resource plan.

The frozen protocol declares **35 request tags**, grouped into these required adapters:

- Host/status and evaluations: host status/start/stop/restart, evals get.
- Discovery/acquisition: models list/scan/inventory, catalog list, Hugging Face search/quants, models add/pull, runtime list/install/remove.
- Model control: profile get/set, budget get, load/unload, rename/reset, model delete and component delete.
- Operations: calibrate/sweep/bench, jobs list/cancel.
- Remote/network: remote config get/patch and network discover.
- Logs: tail and watch.

The existing Brain management server implements capability/status/config/resource/model/runtime/catalog/Hugging Face routes, job starts/cancellation, profile/budget/model controls, restart and the authenticated `/__host/events` SSE stream. Preserve the HTTP method and capability checks, including read-only Remote Brain behavior. Route declarations alone are not live acceptance evidence.

### Live status without a second transport stack

The old Brain host already publishes complete status snapshots and log events over SSE. Its publisher samples active state at roughly one second and idle state at five seconds; semantic state changes drive the UI. Preserve that host-owned event source and one shared client status store.

Paseo 0.12's public plugin server API has typed asynchronous request/response handlers, not arbitrary plugin pub/sub events. The inspected plugin request deadline is 30 seconds; the client session RPC deadline is 60 seconds.

The preferred Brain-owned adapter is a versioned wait RPC over the existing plugin transport: immediate full snapshot on first use/reconnect, then a bounded wait below both deadlines for a new snapshot/log batch. Specify cursor/instance reset, bounded buffering, resynchronization, one demand-owned subscription per selected host, disconnect/teardown, and backoff. Do not busy-poll, guess state, misuse settings updates as telemetry, or open a browser-to-Brain connection that bypasses the owning daemon.

This is a **design to prove in B07/B09**, not a claimed tested implementation. Test transition latency, dual/multi-slot state, reconnect, cancellation/timeout and cleanup with fixture event sources. If it cannot preserve the required behavior, discuss a concrete minimal host extension before changing the base; do not silently deliver degraded status.

### Data continuity ledger

Keep the same resolved `OTTO_HOME` and `otto-brain/` root. Preserve:

- `config.json`, `profiles.json`, `catalog.json`, `rename-map.json`;
- `models/`, `runtimes/`, `templates/`, `results/`, `logs/`;
- `otto-brain.pid`, activity and log conventions, while validating process ownership rather than trusting a stale PID;
- dormant daemon Brain settings/credentials preserved in `otto-config.json` and its original backups;
- app persistence key `brain-layout`, version 1, including model/benchmark splitter preferences;
- provider identity `otto-brain`, model identities and existing chat references.

New installations remain opt-in. Preserve an existing user's explicit enablement/autostart intent through the migration contract; never load their actual model merely to test that contract. Fixture tests use copied or synthetic stores and isolated homes, malformed-state failures must be non-destructive, and saved secrets must not appear in client responses or logs.

### B02 verified standalone host foundation

The independently packaged host is implemented at `packages/otto-brain/`. Source workspace `@getpaseo/brain` packs to the existing public identity `@otto-code/brain`, with executable `otto-brain` and explicit root, configuration, host and CLI entry points. The package includes the shipped catalog; installed-package help/import/catalog smoke checks passed. Its configuration/TLS support is adapted from the frozen standalone package without importing old daemon, app or session patches. Current behavior is documented in [docs/otto-brain.md](https://github.com/Draek2077/otto-code/blob/52482b7206616f85175d651d284f354fd3027035/docs/otto-brain.md).

Implemented and verified:

- Existing home/config/profile/catalog paths and schemas, private atomic persistence, environment precedence, unknown profile-store data and malformed-file preservation.
- Opt-in standalone `serve`, `status` and side-effect-free help/imports. Loading configuration preserves enablement/autostart/default-model intent without starting a model.
- Exclusive home ownership before listener startup, per-lifetime instance IDs, live-owner refusal, cleanup after bind/start failure, conservative malformed/reused-PID behavior and recovery after an abruptly exited fixture host.
- HTTP/HTTPS host liveness, masked configuration, token authorization/non-loopback policy, existing file/self-signed/Tailscale certificate support, an unloaded model listing and explicit unavailable completion responses.
- A typed engine-attachment boundary, runtime-error sanitization, active-socket closure, idempotent teardown, cancellation and a six-second engine-teardown deadline.
- Build/typecheck/release-pack registration, catalog packaging, executable permissions, Linux/Windows fixture coverage in the existing CI jobs, and a refreshed Nix hash obtained from the verified identical lockfile.

The 35 focused cases cover configuration/catalog continuity, ownership, transport and cancellation, TLS/certificate behavior, built imports/help and actual short-lived standalone Node-process crash/recovery. They use synthetic homes and loopback endpoints; no installed user store, real model, dev app or GPU workload was used. The installed Otto daemon remained PID 34604 with its original 2026-10-20 start time, and dev ports 6788/6978 remained stopped.

B02 closed the **host-shell and attachment-contract** foundation. B03 below now covers the concrete driver and fixture model-child supervision/readiness/termination proof; residency and scheduling remain B04. The full CLI/TUI remains B06, local/Remote Brain integration B07, provider B08, original UI/icon B09 and friendly settings/full acceptance B10. Management capabilities remain false for unavailable operations, and the app exposes no replacement Brain UI.

Exact-source verification for `52482b7206616f85175d651d284f354fd3027035`:

| Gate | Result |
| --- | --- |
| [CI 39976080015](https://github.com/Draek2077/otto-code/actions/runs/39976080015) | All 21 jobs passed, including standalone Brain fixtures on Linux and Windows, all-workspace typechecks and renamed release-package packing. |
| [Desktop 39976085166](https://github.com/Draek2077/otto-code/actions/runs/39976085166) | Windows, Linux, installed-Linux verification and unsigned Mac x64/arm64 passed. Existing Apple signing gate retained. |
| [Android 39976090225](https://github.com/Draek2077/otto-code/actions/runs/39976090225) | Signed APK/AAB build and verification passed; uploaded `otto-android-apk` (112827738 bytes) and `otto-android-aab` (176463499 bytes). |
| [Nix 39976095009](https://github.com/Draek2077/otto-code/actions/runs/39976095009) | Linux daemon/desktop and Darwin desktop passed. |
| [Docker 39976099473](https://github.com/Draek2077/otto-code/actions/runs/39976099473) | Build passed; publishing disabled. |

The earlier CI/Nix runs on `80e2b4203` were deliberately superseded after recovering the Nix input hash and adding process-recovery coverage. They are not failures of the final source. Keep the accepted iOS signing boundary; no signed iOS or physical-device acceptance is claimed.

## B03 verified runtime and model acquisition

Implementation lives entirely in the Otto-owned `packages/otto-brain/` package, with its software contract in [docs/otto-brain.md](https://github.com/Draek2077/otto-code/blob/89f17ae1eb1f223d12a7653c0c48825494dfdaa6/docs/otto-brain.md). No Paseo runtime, relay/Hub transport, app UI, theme or private daemon manager was patched for this checkpoint.

Implemented and verified:

- Inert root, runtime and model library exports; explicit runtime resolution preserves managed, LM Studio and configured executable choices. Help/imports do not resolve user homes, start listeners or load models.
- The concrete llama.cpp argument/environment/log adapter and a single-child supervisor: private loopback port checks, launch errors, readiness deadlines, properties, cancellation before/during loading, early exits, resident crashes, owned termination and bounded logs. Real short-lived Node HTTP children exercise the production supervisor and concrete driver's argument/environment construction. Ready identity attaches to the existing host/model listing; HTTP inference/load/delete/job capabilities remain unavailable until their owning checkpoints.
- Managed runtime release/version/variant discovery, staged acquisition, archive path/link inspection, executable verification, inventory and explicit removal. Failed installation does not replace an existing runtime. Real system tar and Windows ZIP extraction run against synthetic archives; the executable probe uses a fixture child, not a downloaded llama.cpp binary. Windows explicitly selects system tar to avoid Git tar treating drive letters as remote hosts. Pinned b10265 asset names and launch-argument spellings were checked read-only against its published release/source.
- Model catalog enrichment, Hugging Face search/quant/shard discovery, isolated/configured source scans, bounded GGUF metadata, stable artifact identities, managed-source precedence, display names, projectors and manifest bundles. Nested quant directories resolve companions from the model-store root.
- Shared safe download paths reject traversal/links; per-file operation claims reject concurrent ownership and recover proven dead fixture owners. Resume requires strong ETag/range/length identity. Cancellation and real loopback HTTP truncation preserve valid partials without publishing incomplete models. Existing files count toward aggregate bundle progress.
- Storage plans/accounting handle shards and shared companions, retain a projector while another quant remains, and protect primary/required components. Cross-repository companions remain conservative until the host can establish references; resident/shared component checks belong to the later owning host adapter. Malformed rename metadata remains readable as unrenamed inventory but all rename writes fail without overwriting the original.
- Existing configuration/profile/catalog continuity cases remain green. Full model selection, residency/scheduling, GPU accounting, quality operations, CLI/TUI, local/Remote Brain, provider and original UI/icon remain in B04 through B10; no original product scope was removed.

### B03 exact-source verification

- Focused local changed-file tests used isolated repository `.tmp/` fixtures and one worker. Package build, npm pack dry-run, formatting, lint, full workspace pre-commit typechecking and the Otto seam check passed. No full local test suite ran.
- [CI 39991207212](https://github.com/Draek2077/otto-code/actions/runs/39991207212): all 21 jobs passed. Brain's 21 test files passed on both Windows and Linux: **198 cases on Windows; 197 passed and one Windows-only ZIP case skipped on Linux**. The full CI also built the website, daemon web UI and release packages.
- [Desktop 39991211851](https://github.com/Draek2077/otto-code/actions/runs/39991211851): Windows/Linux, unsigned Mac x64/arm64 and installed-Linux verification passed. Existing signing gates remain intact.
- [Android 39991216702](https://github.com/Draek2077/otto-code/actions/runs/39991216702): signed APK and optional signed AAB collection/verification passed. Uploaded artifacts are `otto-android-apk` (112827724 bytes) and `otto-android-aab` (176463504 bytes). GitHub Release upload was skipped because publishing was disabled.
- [Nix 39991221361](https://github.com/Draek2077/otto-code/actions/runs/39991221361): Linux daemon/desktop and Darwin desktop passed.
- [Docker 39991226751](https://github.com/Draek2077/otto-code/actions/runs/39991226751): build-only attempt 2 passed. Attempt 1 failed during npm dependency acquisition with ECONNRESET before compilation; the failed job was retried on the identical source without weakening checks or publishing.
- Earlier verification on 26bb5362b was deliberately superseded after the malformed-rename preservation fix. Only the final exact-source runs above establish this checkpoint.

The agent did not launch development apps, real runtimes or models. Philippe independently opened the dev app during review; the absent Brain UI is an implementation boundary, not a missing toggle. Final checks found no dev-daemon/Metro listener or llama-server process. Installed Otto remained PID 34604 on 6868 with its unchanged 2026-10-20 start time. No shared scratch cleanup or previously denied deletion was attempted.

Real native llama.cpp/model/GPU behavior and physical-device acceptance remain untested under the agreed resource limits. Keep the accepted iOS signing gate. Those limits do not make the complete Brain feature ready or authorize starting model workloads.

## B04 residency and scheduling checkpoint

Implementation is entirely in `packages/otto-brain/`, with its actual library contract in `docs/otto-brain.md`. There are no Paseo app/relay/Hub changes in this checkpoint.

- Shared slot scheduler preserves FIFO model turns, per-session KV affinity, unique slot pinning, erase-before-handoff, measured idle-capacity admission, exclusive model operations, queued cancellation and bounded shutdown. Running callback cancellation still requires its host/transport to honor the supplied signal.
- Typed resident process pool owns model-specific supervisors/schedulers/ports and VRAM reservations. It serializes load admission and administrative maintenance, evicts idle residents only, retains busy work, prevents unrelated queued loads from blocking resident requests, and reaps late loads on shutdown. Loader ports receive lifetime/operation cancellation and must honor it before native launch.
- Pure selected-model locking and per-request activity/status signals are restored. Operation identities prevent an older same-process operation from clearing a newer activity record. Complete demand-owned status sampling coalesces semantic changes, retains queued model identities and stops after final listener teardown; no stale in-flight replay is emitted after unsubscribe.
- Focused fixtures include two short-lived Node HTTP children through production supervisor/pool code, no llama.cpp binary/model. CI runs 26 Brain fixture files: Windows 304 passing cases; Linux 303 passing plus one Windows-only ZIP skip.
- Exact-source CI/build links are above. Android APK and optional AAB collection/verification and both artifact uploads passed; Desktop includes Windows/Linux, installed-Linux smoke and unsigned Mac Intel/ARM. iOS retains its explicitly accepted signing gate. All runs are build-only; installed Otto was not restarted, and no dev app or real model was launched.
- This completes library-level residency/scheduling, not the public serving/management composition or Brain app. Those remain explicitly owned by B06–B10. B05 work is underway locally and is not included in B04 proof.

## B05 capacity and quality library checkpoint

The Otto-owned package restores calibration and reasoning sweeps through injected pool-owned leases, benchmark task/scoring/replay/history/report libraries, profile/template controls and diagnostic samplers. Operations honor cancellation and use explicit host environments; repository tasks execute only in an owned disposable copy, never reset the source checkout. Report exports preserve permissions of existing user-selected parent directories. A CI-only memory-assumption failure was corrected by testing explicit host-memory values, without changing the production warning policy.

All final exact-source gates for `da9a9181d4663dbbcc5348cd7b10cf6941ad3fc1` passed as linked above. Brain's remote test run passed 45 files on each platform: 468 cases on Windows; 467 cases plus one Windows-only extraction skip on Linux. The normal commit hooks and workspace typechecks passed. Native runtime/model/GPU workloads, actual terminals, physical devices and app-visible Brain remain outside this library proof. The installed app was left running; no dev app/model launch or installation was performed. Keep the accepted iOS signing gate. Public host operation composition, full CLI/TUI, daemon/Remote Brain, provider and original graphical placement/settings still require B06-B10.

## Sequential delivery checkpoints

These checkpoints keep the complete outcome visible. Each becomes a bounded active slice only after its contracts and proof are specified. No checkpoint by itself means the full Brain feature has returned.

- [x] **B01 — Parity inventory and integration map:** enumerate frozen implemented capabilities, standalone/public identities, state signals, UI/CLI operations and dormant data; separate unfinished roadmap; define the package/plugin/UI/CLI boundaries and first slice.
- [x] **B02 — Standalone host foundation:** configuration/persistence, standalone host launch/lifecycle, authenticated transport, typed engine attachment/cancellation and headless/package behavior. Concrete model-engine/process proof remains B03/B04.
- [x] **B03 — Runtime and model acquisition:** concrete llama.cpp driver/model-server launch and readiness proof, managed runtime operations, model catalog/search/scanning, bundles, safe downloads/resume and storage lifecycle.
- [x] **B04 — Residency and scheduling:** shared scheduler, process pool, model selection/locking, admission/eviction, cancellation and multi-model status signals.
- [x] **B05 — Capacity and quality operations:** calibration, sweeps, benchmarks/results/reports, template/profile behavior and logs.
- [ ] **B06 — CLI/TUI coverage:** complete standalone and Otto CLI command coverage, output conventions and supported terminal/platform behavior.
- [ ] **B07 — Daemon and Remote Brain:** typed management/operations contracts, local ownership, remote parity/trust/configuration and continuity.
- [ ] **B08 — Brain provider plugin:** shared Otto harness, endpoint/model identity and agent/session parity without base chat changes.
- [ ] **B09 — Existing Brain UI and animated icon:** restore the established surfaces and full state/effect behavior through the approved bridge and existing placement slots.
- [ ] **B10 — Friendly settings and full acceptance:** local/remote settings in Paseo's style, full data/platform/provider checks, complete required builds, green exact-source CI and Philippe's product review.

## Verification and resource boundary

Every implemented slice requires focused tests, appropriate type/lint/format/seam checks, green remote CI, the required build matrix and truthful desktop/mobile proof. Keep the existing accepted iOS signing gate.

The user's machine encountered CPU pressure during F01 dev activity. Keep local app/model launches and heavy local builds stopped during the current wrap-up. Plan real-model/visual verification with an explicit resource budget before starting any host workload; do not automatically relaunch the dev app or load models.

The first integration review must name any choices still needed. Avoid asking the user to choose routine internal implementation details; bring concrete product, distribution or missing-extension tradeoffs with a recommendation.

## Timeline

- time: "2026-10-22T23:04:38.192Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-10-22T23:04:38.192Z"
  kind: "evidence"
  summary: "Philippe's 2026-10-22 Brain instructions and explicit choices: Otto-owned renderer with a small typed bridge; restore complete working llama.cpp Brain before new vLLM/SGLang drivers. Frozen reference 95a19522a191394a874320041eaf05f6c5f3c682; public plugin buttons/contracts and plugin import documentation inspected. F01 exact-source CI/build acceptance is still pending."
- time: "2026-10-22T23:30:55.644Z"
  kind: "decision"
  summary: "The F01 predecessor gate passed on its final source, unblocking B01 parity/integration planning for the full Brain restoration. Preserve the accepted complete-working-Brain scope and keep implementation/resource boundaries explicit."
  source: "F01 exact-source CI/build closure; Philippe's Brain restoration request and accepted renderer/runtime choices."
- time: "2026-10-22T23:31:19.200Z"
  kind: "note"
  summary: "Philippe requested Brain next after the provider phase. The predecessor's final CI and full build matrix are green. Begin B01 parity/integration planning under the accepted complete-working-llama.cpp scope and Otto-owned renderer bridge; no Brain implementation or local model launch has started."
  affects: ["otto-0-10-brain-restoration"]
- time: "2026-10-23T14:15:04.686Z"
  kind: "decision"
  summary: "Complete the B01 source-grounded parity/integration review requested as the next phase: measured frozen file inventory, full CLI/35-request operation map, runtime/plugin/UI/CLI owners, continuity ledger, public API constraints and scoped B02 acceptance. No executable source or model workload changed."
  source: "Frozen 95a19522a191394a874320041eaf05f6c5f3c682 Brain package, CLI, protocol/brain.ts, daemon adapters, Brain screen/icon/layout store; current public plugin co"
- time: "2026-10-23T14:15:56.712Z"
  kind: "note"
  summary: "B01 parity/integration source review completed with the accepted standalone/runtime/Remote Brain/CLI/UI/icon scope, measured frozen inventories, public-contract mapping, explicit proposed seams and scoped B02 proof. No executable source changed; current exact-head CI remains green."
  affects: ["otto-0-10-brain-restoration"]
- time: "2026-10-23T16:07:08.210Z"
  kind: "decision"
  summary: "Verified the bounded standalone host-shell checkpoint at 52482b720 with 35 fixture cases, all 21 CI jobs and the exact-source product build matrix. Explicitly retain concrete llama.cpp model-process proof and all remaining Brain product work in following checkpoints; no complete Brain/runtime-model acceptance is claimed."
  source: "https://github.com/Draek2077/otto-code/commit/52482b7206616f85175d651d284f354fd3027035"
- time: "2026-10-23T16:07:43.435Z"
  kind: "note"
  summary: "B02's bounded host-shell/engine-attachment foundation is verified at 52482b720: 35 focused fixtures, Linux/Windows Brain CI, all 21 required CI jobs, and Desktop/Android/Nix/Docker builds passed. Concrete llama.cpp model-child lifecycle remains B03/B04; the full Brain product remains in build."
  affects: ["otto-0-10-brain-restoration"]
- time: "2026-10-23T17:59:00.501Z"
  kind: "decision"
  summary: "Complete Philippe's explicitly requested B03 continuation after exact-source CI and all required build-only gates passed at 89f17ae1e; record the runtime/acquisition proof and his accurate observation that app-visible Brain is still absent. Preserve the full agreed scope and all resource/release boundaries."
  source: "Philippe's 2026-10-23 B03 continuation and dev-app review; commits 26bb5362b and 89f17ae1e; CI/Desktop/Android/Nix/Docker verification linked in the statement."
- time: "2026-10-23T17:59:32.469Z"
  kind: "note"
  summary: "B03's bounded standalone runtime/model-acquisition slice is verified at 89f17ae1e: 198 Windows/197 Linux fixture cases, all 21 CI jobs and exact-source Desktop/Android/Nix/Docker builds passed. App-visible Brain is still absent; full Brain remains in build and B04 residency/scheduling is next."
  affects: ["otto-0-10-brain-restoration"]
- time: "2026-10-23T19:22:53.299Z"
  kind: "decision"
  summary: "Verified all five exact-source B04 workflows terminal success, 21 CI jobs and 26 Brain fixture files with 304 Windows/303 Linux plus one platform skip, Android APK/AAB verification/artifacts. Record completed library checkpoint without implying app-visible/full Brain or testing uncommitted B05."
  source: "297dc04ea2a4f468b0d6d58b321097c9fdd6015c; GitHub Actions 40004816342,40004821215,40004825170,40004829430,40004833180."
- time: "2026-10-23T19:22:53.924Z"
  kind: "note"
  summary: "B04 library residency/scheduling and complete exact-source build-only gates are verified. B05 active; full Brain UI/provider/Remote/CLI remain incomplete."
  affects: ["otto-0-10-brain-restoration"]
- time: "2026-10-23T19:49:26.663Z"
  kind: "evidence"
  summary: "B05 capacity/quality library implementation committed and pushed as a0baa71ab9df6126338b26afaa40a46a0cd0dd5f. All code remains Otto-owned in packages/otto-brain plus indexed docs. Focused calibration/sweep/benchmark/replay/history/profile/log/slot fixtures passed locally, including short synthetic child/HTTP/Python/git fixtures only; public import/help remains inert. Normal precommit formatting/lint and complete workspace typecheck passed without bypass. Same-instant histories/logs are distinct and host-scoped; repository tasks now mutate generated owned copies rather than their source; operation leases/cancellation are explicit. This is not full Brain/CLI/app/Remote/provider restoration. Exact-source CI40014203937, Desktop40014208639, Android APK/AAB40014213121, Nix40014217463 and Docker40014221872 were dispatched build-only and are pending, not green evidence. Installed port6868 still PID34604; no6788/8081 listener, app/model launch, installation, release or main merge occurred."
  source: "a0baa71ab9df6126338b26afaa40a46a0cd0dd5f and corresponding GitHub Actions build-only dispatches, 2026-10-23."
- time: "2026-10-23T20:33:13.499Z"
  kind: "evidence"
  summary: "First approved Brain app renderer slice is prepared as uncommitted source exclusively under packages/app/src/otto/brain (19 files). Original seven Material glyph strings are SHA-256 pinned against otto-0.9-final; visual table/state labels match frozen source. Native/web masks, glow/gradients, crossfade, independent dual halves and >=3 spectrum are restored behind feature-owned BrainUiBridge v1 and structural input types, with injected lifecycle/animation/reduced-motion controls and cadence-shared clocks. User approved two frozen correctness fixes: liveness overrides stale multi-slot rows, and actual joined proxy stages apply consistently to single/dual pictures. Slot joins use modelId+residentId+slot, preserving overlapping slot0 across residents and process lifetimes. Normal format:files and npm lint passed (19 files, zero warnings/errors). Exact pure fixtures passed sequentially using read-only integration Vitest4.1.7 with own-root scratch config/cache: state 38, bridge 9, glyphs 7 (54 total). Test config needs JSON-string esbuild.tsconfigRaw to bypass dependency-free worktree Expo-extends resolution; earlier configuration attempts collected zero tests. No app typecheck/build, rendered/browser/native/clock-runtime acceptance, registration, full operational screens, commit or push is claimed. B09/full Brain remains incomplete; parent owns validated DTO mapping/store/transport/navigation seams. Installed Otto and home data were untouched."
  source: "Approved isolated branch otto-0.10/brain-ui at base 8e13bdadb263446d4be207e5a3452f9bffbc433c; frozen source 95a19522a191394a874320041eaf05f6c5f3c682; exact owne"
- time: "2026-10-23T21:45:41.202Z"
  kind: "decision"
  summary: "B05's pushed exact source now passes all 21 CI jobs plus Desktop, Android APK/AAB, Nix and Docker build-only gates. Record the completed library checkpoint separately from newer uncommitted host/UI restoration; preserve native and app-availability proof limits."
  source: "Exact source da9a9181d4663dbbcc5348cd7b10cf6941ad3fc1; CI40020458524, Desktop40020462354, Android40020466378, Nix40020470657, Docker40020475463; Linux/Windows s"
- time: "2026-10-23T21:45:43.214Z"
  kind: "note"
  summary: "B05 capacity/quality operation libraries passed exact-source CI/build gates. B06-B10, app availability and real native/model acceptance remain unfinished."
  affects: ["otto-0-10-brain-restoration"]
- time: "2026-10-24T08:24:53.609Z"
  kind: "evidence"
  summary: "Current verified integration supersedes the old absence assumption as evidence, without completing B06–B10: ce20f1316deeb413170ef60c0e92161b7f1957e8 passed all21 CI jobs (40071732369), Desktop40071733967, APK/AAB40071735585, Nix40071737497 and Docker40071739077; no publishing/version/tag/main merge. The registered Brain plugin now supplies Configure Brain in Host>Plugins, enabled-host sidebar icon, original five operational screens and friendly settings; wide/compact unloaded navigation and F01 provider UI passed Otto App Acceptance40071354106. Explicit Remote owner restart f5b5810d97e485b9afc9dab872fcc76c0fa75b19 passed focused acceptance40073457062. New pushed b9ee7027126656e55a47f4138ac4e29d0de61d01 wires both standalone and Otto CLI TUI to canonical owner metadata/status/resources/profile CAS/jobs, pins lifetime on writes and retains jobs/residents after UI close. Normal hooks (format/lint/all-workspace typecheck), owning stack build, Brain production/fixture strict checks, CLI/server fixture declarations and exact synthetic HTTP/Node-engine/TTY-preflight regressions passed. B9 latest CI40077845577 and app acceptance40077827532 are in progress, not yet green evidence. Full CLI command parity including reports/config/share/output semantics, complete operational app journeys, native terminal/llama/model/GPU/device checks and B06–B10 acceptance remain open; progress stays5/10. No native apps/models launched locally and installed Otto unchanged."
  source: "Verified restoration commits and exact-source workflow runs"
- time: "2026-10-24T08:43:56.337Z"
  kind: "evidence"
  summary: "Follow-up verification: all21 jobs of CI40077845577 completed SUCCESS, and Otto App Acceptance40077827532 completed SUCCESS, on pushed b9ee7027126656e55a47f4138ac4e29d0de61d01. This establishes the TUI host-composition checkpoint's remote CI/app regression gate. Product build matrix remains ce20f1316deeb413170ef60c0e92161b7f1957e8 provenance; no newer build artifacts claimed. Further shared CLI registration/selected-owner parity work is uncommitted and excluded from these runs. B06/full Brain remain open; no native terminal/model/device acceptance, installed changes, release or main merge."
  source: "GitHub Actions exact-source b9ee7027126656e55a47f4138ac4e29d0de61d01"
- time: "2026-10-24T09:45:51.497Z"
  kind: "evidence"
  summary: "Verified follow-on: shared CLI model/catalog/search/download/calibration/sweep/runtime handlers were committed19647c92c860ecbe4e18576287a5aca05b59fe1b. Its full CI exposed an import-cost test incorrectly counting deferred import chunks as loaded during registration; the static-graph fix0601eab26c4b0c4d9d49871a5adf029516d9068e retained unused eager re-exports and added a real esbuild regression. Required OTTO(test) seam tag fixed in29994183b2ff18042ab708bfaa214fb92f07d833. All21 CI40081705334 and app acceptance40081704782 passed on29994183b. New pushed c2bcac298f13f642bde9cd1573f88a6465809c02 adds owner-bound report export and cancellable CPU transcript replay using the same shared CLI handlers. Focused real HTTP fixtures prove selected-owner environment isolation, historical missing model IDs, unchanged score bytes, no model launch and job-only revision changes; root CLI catalog/YAML, report/quiet, replay/no-execute and lease release pass. Current UI labels replay correctly and does not animate it as inference; optional benchmarkMode preserves the existing benchmark operation category for older receivers. Normal owning builds, production/fixture typechecks, lint/format/seams and normal hooks passed. CI40083217626 on c2 is newly running and not green evidence yet. Full B06 still lacks the remaining Root scan/bench/serve/config/share parity; B07–B10/native/device/full UI acceptance and complete product restoration remain open. Latest full product build matrix is still ce20 provenance, not c2; no release/main merge/version change or installed-home changes."
  source: "Verified CLI integration and CI source gates"
- time: "2026-10-24T10:24:03.547Z"
  kind: "evidence"
  summary: "Verified selected-owner CLI continuation: scan uses the canonical owning-host scanner and calibration projection, preserves --no-metadata without replacing full resident metadata, and avoids GPU/native launches. Its 2 HTTP-owner cases, 14 fixed-request cases and changed Root CLI case passed; all 21 CI jobs (40084047917) and app acceptance (40084047951) passed at 96d6166a32b1d535bd9e893e608022d089315f87. Further committed/pushed work at db74a46ee041a5deea297eb5256498cb02cc81ac adds shared bench/config/share command composition. External endpoint benchmarks are durable owner jobs, preserve raw owner repository paths, support explicit cancellation and do not animate an unloaded resident (3 actual synthetic endpoint cases, 17 bench cases, 1 request case, 1 changed Root CLI case and 2 app activity cases passed). Passive config uses separate daemon connection and actual owner CAS domains, edits one validated leaf only, never round-trips redaction placeholders, and works on disabled/unreachable-owner connections (18 standalone config cases and 5 Root adapter cases passed). Sharing reuses one policy with atomic owner-side generation/persistence, explicit capabilities, staged restart reporting and no implicit launch; 6 standalone sharing, 4 owner settings, 2 Root sharing and 1 real daemon-to-HTTP-owner bridge cases passed. Owning declaration/build checks, normal formatting/lint, seam checks and unbypassed commit hooks passed for these commits. Full CI 40085725442 and current app acceptance are pending for db74a46ee. This is B06 engineering evidence only: foreground serve remains to integrate; B06 native terminal/model/device acceptance and full Brain/B09/B10 completion are NOT claimed. No main merge, release, native/model/GPU launch, installed-home write or broader feature completion."
  source: "B06 selected-owner CLI integration; commits 96d6166a3, 8aa3b7813, 3dbc4596b, db74a46ee"
- time: "2026-10-24T12:00:27.213Z"
  kind: "evidence"
  summary: "Actual acceptance boundary: ae13404b3d7106cb7b50a6ab78483aa521fc3a49 was pushed and its new wide/compact operational browser journey did not collect tests. App Acceptance 40091741898 and Playwright CI shards failed because Playwright transformed the built Brain ESM graph through CommonJS (ReferenceError: exports is not defined, config/paths.js). This is fixture module loading, not UI acceptance. The fix switches the fixture to the existing daemon-client-loader file-URL pattern, retaining built public Brain class identity and unchanged assertions; local format/lint/app strict typecheck pass, normal commit hooks currently running. A separate real-daemon settings-conflict browser journey is committed at f6f8344d7 but not yet executed remotely. Full Brain and all later feature obligations remain open; no model/native/terminal/device or complete app-operation claim."
  source: "Otto 0.10 integration / ae13404b3 remote acceptance"
- time: "2026-10-24T12:37:12.779Z"
  kind: "evidence"
  summary: "Verified integration checkpoint 537ba64a99b7554df764cc023a0dd44f8d927af6 is pushed: all 21 CI jobs passed (40093257939), and Otto App Acceptance 40093257456 passed all 11 journeys. New wide/compact journeys exercise actual selected-daemon -> Remote Brain owner transport, discovered model library, revisioned profile Context autosave 16384 -> 8192, persisted rename, synthetic Node resident load/unload, real host log clipboard copy and reload persistence. Separate real-daemon settings journeys prove stale connection-save rejection, retained user draft, declined/confirmed explicit reload and a new explicit save without starting local Brain. The browser exposed and drove fixes for short stepper taps and stringified budget values; assertions were not weakened. Screenshots inspected at both widths. Synthetic inference does not prove a native llama.cpp/model/GPU, real terminal, device, all operation surfaces or full Brain completion. Current exact-product build artifacts remain an older SHA; no publication, main merge or installed-data mutation. New running-benchmark cancellation acceptance is authored, not yet executed; full remaining Brain/Kanban/Knowledge scope stays open."
  source: "https://github.com/Draek2077/otto-code/actions/runs/40093257456"
- time: "2026-10-24T18:29:14.805Z"
  kind: "evidence"
  summary: "A later acceptance run at production-code commit 14e6f8766 failed its running-benchmark cancellation journey: after the UI Cancel click, actual owner job polling still reported running after the unchanged 10-second assertion deadline. Two preceding operational wide/compact journeys passed; 21 later journeys, including new Knowledge purge assertions, did not run because the workflow stops at first failure. Cancellation source is unchanged from bed4d9ba2, whose all-24 acceptance run 40118057246 passed, but that does not explain this failure or prove it harmless. The standard failure screenshot is taken after fixture teardown restores daemon Brain connection settings and cannot identify live click-time state. Source-only diagnosis traced UI action mapping, daemon management request, host cancelRequested flag, operation AbortSignal, resident startup/cleanup and shared resource lifecycle; no causal production fix is established. Diagnostic-only commit 10dc7c805 adds retain-on-failure tracing plus sanitized actual-owner id/state/cancelRequested capture and a screenshot BEFORE fixture teardown. All original assertions/timeouts remain unchanged; normal formatter/lint/all-workspace commit hooks passed. Instrumented acceptance 40120432138 is pending. No native/GPU/model/app/daemon launch on the user's computer or installed Otto operation was performed. Do not claim this cancellation issue fixed, full Brain completion, or new purge browser acceptance from prior green runs."
  source: "Otto App Acceptance 40119464704; diagnostic commit 10dc7c805004dd064a5958e8b8f0b91ca82470ce"
- time: "2026-10-25T22:10:52.412Z"
  kind: "decision"
  summary: "Reconcile the user-authorized integration and completion tracking with pushed source and measured browser outcomes. Retire the obsolete claim that Brain is absent; keep B06-B10 and the newly observed initial-load failure open. No review confirmation or completion is requested."
  source: "Integration commits ff027b154, 7b3450309; GitHub Actions 40236324941, 40237029629; current checks dispatched at exact full SHA."
- time: "2026-11-05T14:22:40.817Z"
  kind: "decision"
  summary: "Philippe requested accurate checklist reconciliation and review. Replace stale child-only/pending/failed-run claims with current integrated behavior and final green CI, preserving unproved native/provider/vendor/product acceptance gates and parked research. No feature or review confirmation is granted."
  source: "https://github.com/Draek2077/otto-code/actions/runs/41958046132"
  affects: ["otto-0-10","restoration-checklist","review"]
- time: "2026-11-12T19:43:48.914Z"
  kind: "decision"
  summary: "Refresh current automated-proof identity for the requested basic rebuild review and explicitly preserve Philippe's UI review and all B06-B10 native/product gates. Keep the original renderer/effects and accepted checkpoint count unchanged."
  source: "https://github.com/Draek2077/otto-code/actions/runs/43266928686"
- time: "2026-11-12T19:43:54.252Z"
  kind: "note"
  summary: "Clarify that 5/10 counts the accepted historical Brain checkpoints and is not an estimate of missing implementation. Do not advance B06-B10 from fixture/CI evidence or close Philippe's native/product/UI review."
  affects: ["otto-0-10-brain-restoration"]
