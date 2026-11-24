---
id: "otto-0-10-visualizer-restoration"
kind: "project"
title: "Visualizer, PIP and background restoration"
status: "proposed"
tags: ["otto-0.10","restoration","visualizer","paseo-boundary"]
delivery_status: "complete"
progress_completed: 8
progress_total: 8
progress_unit: "restoration checkpoints"
created_at: "2026-11-10T19:45:26.952Z"
updated_at: "2026-11-11T00:43:41.565Z"
---
# Visualizer, PIP and background restoration

<!-- compiled_truth -->

# Visualizer restoration on Paseo 0.12

Philippe selected the final feature additions after Architectural Views completion. Restore F10–F12 together: the complete shipped Otto 0.9 Visualizer, its PIP and chat-background behavior, reimplemented against the current Paseo owners. Work starts from ee0b7d326c4c664d41f72d50d80134fec8010698 in the existing otto-0.10/phase-0 integration checkout. F22 History/global search/archive comparison follows only after this family's CI/build gates pass. No other deferred feature is selected.

## Product contract

- Recover the frozen 95a19522a191394a874320041eaf05f6c5f3c682 render-layer behavior and license/attribution, never its provider ingestion, relay, watchers or agent harness. The UI name is Visualizer, never the vendor trademark.
- Preserve agent/root/session selection, focused-chat following and pinning, current-workspace aggregate, existing parent/child topology, tools and results/failures, file activity/collisions, context/discovery details, latest assistant-visible node bubbles, timeline/replay and available renderer controls. Values not reported by the current provider remain unavailable rather than invented.
- Project Paseo's canonical agent/workspace/timeline state. Root/session registration must appear immediately; bounded history hydration may follow. Reconnect establishes a coherent reset/replay frontier. No duplicate socket, raw-provider log reader, host-side alternate transcript, polling loop or chat/session ownership model.
- Reuse the current canonical timeline demand owner and already-restored Speech owner. Activity speech may continue without a visible graph, as it already does; Visualizer restoration must not create a second cue generator/playback queue or change microphone ownership. Rendering sound effects remain separately controlled.
- Provide a real workspace companion panel, reachable header/Command Center controls and settings through current contribution surfaces and narrowly marked app seams. Reuse Paseo toolbar, menu, settings, error/loading and responsive conventions while retaining the original Visualizer's rendering language.
- At most one active tab or PIP guest per app window. Inactive workspaces keep their tab descriptors/targets and preferences; switching away destroys guest/simulation/subscriptions without deleting saved tabs. PIP/tab handoff retires the old guest before restoring the next from canonical state. Visible chat backgrounds are the only singleton exception and hidden backgrounds unload.
- On web/Electron PIP belongs to the full window overlay, above resident browser surfaces, below transient sidebars and interaction overlays. Preserve two sizes, pin/follow/expand/close, deliberate hover behavior, dragging and near-edge anchoring on resize. Zero-size first measurement, interrupted drag, host/workspace switch, minimize and restored duplicate descriptors require explicit lifetime tests.
- Restore the shipped fixed-viewport chat background, deliberately hidden/hovered conversation state, Composer exclusion and usability, preserved state across sends, and native latest-assistant bubble. Do not port unrelated Otto chat layout, scrolling, queued delivery, models or profiles.
- Retain exact old preference identities and supported configuration through an Otto-owned compatibility boundary. No settings reset, destructive conversion or old protocol fallback. One app-owned versioned bridge validates bounded messages and available actions; guest content has no network, app DOM/storage, Node, arbitrary navigation or arbitrary host file access.
- Demo remains available only with no open chat tabs and no reported sessions, with explicit start/stop and no live/demo data mixing.
- Lazy rendering bundle, bounded event/message caches, deduplicated demand and no inactive rAF/simulation/audio work. User-selected quality and render/panel settings remain available. Theme/font projection must not subscribe the whole app tree or change Paseo themes.

## Eight completion checkpoints

1. Frozen renderer/build inputs, licenses/trademark attribution and an offline packaged build; no vendor collectors or runtime services.
2. Pure current-Paseo projection, stable host/workspace/agent/session identity, bounded tools/messages/context/file data, replay and negative/cancellation cases.
3. Canonical timeline demand/connection integration and a single validated host/guest bridge with teardown, caps and error recovery.
4. Reachable main companion panel, native controls, session selection/follow/pin/demo and preserved device preferences/settings.
5. Window singleton and full-viewport PIP, input/drag/resize/layering/focus/host-switch lifetimes, saved-tab continuity and responsive/native alternatives.
6. Shipped chat background behavior and existing Speech integration, with Composer/reader ownership preserved and no duplicate capture/streams/renderers.
7. Indexed software/manual docs, focused production-port/simulation tests and controlled real-daemon/browser wide/compact renderer, handoff, reconnect, layering, hidden lifecycle and failure acceptance.
8. Normal hooks, full required CI and affected Windows/Linux/unsigned Mac/Android APK+AAB/Docker/Nix matrix; accurate feature/master reconciliation and explicit remaining device/provider review limits.

Complete means fully registered, usable and proven through these gates. Source-only renderer helpers, screenshots of a demo alone, or a hidden unregistered panel do not close the product.

## Boundaries

Existing integration checkout only. No agents/new worktrees. Preserve unrelated edits. Installed Otto/home/6868 and local dev apps/daemons/native-provider CLIs/models stay untouched/stopped. Pure fixtures and bounded serial repository tooling are allowed; CI owns app/runtime and full-suite proof. Repository dependencies may be added as required. No main landing, release/tag/publication/deployment, global configuration or unrelated cleanup. Do not retry any previously denied scratch deletion. Retain the accepted iOS signing gate.

Arena/separate-window aggregation, rich-media node-reader roadmap, arbitrary widgets, new observed-agent ingestion, teams/profiles, general chat/appearance redesign, Context startup-isolation investigation and the remaining deferred list are follow-on work, not hidden dependencies.

References: [[visualizer-pip]], [[visualizer-singleton-active-lifecycle]], [[visualizer-pip-window-overlay-and-edge-anchoring]], [[swooped-sidebars-remain-transient-and-layer-above-visualizer]], [[visualizer-demo-available-with-no-active-chats]], [[reference-agent-flow]], [[otto-0-10-clean-paseo-rebuild]].

## Starting evidence

The Archify final head has green CI21/21, app83/83 and complete required build-only proof. Current 0.10 has the canonical timeline owner, restored Speech playback/cues, generic workspace plugin contributions and an existing web overlay/resident-browser plane. Frozen 0.9 contains the renderer package, patched vendor web runtime, projection/controls/settings, singleton/PIP/background owners and behavioral references. Historical status/proof on those pages is not current 0.10 availability.

## Timeline

- time: "2026-11-10T19:45:26.952Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-11-10T19:45:26.952Z"
  kind: "evidence"
  summary: "Philippe requested resuming the final items on 2026-11-10. Scope is based on the current master, confirmed singleton/window-overlay/background requirements and frozen 95a19522 render layer. Current implementation has not yet been restored; no completed feature or live/native proof is claimed."
- time: "2026-11-10T21:52:44.254Z"
  kind: "note"
  summary: "Verified checkpoints 1–2 in the existing integration checkout, pushed through 675202a62cea46237bb4be22daf721f9a82edee4. Frozen Apache render layer only, offline/fonts/licenses packaged reproducibly, current-Paseo projection and bounded data ports implemented; projection29, bundle2, feed8, other focused fixtures and normal formatting/lint/all-workspace typechecks pass. CI on 7f2f3abd proved actual root/child sessions, normal provider tool failures, file attention/collision and unknown usage labels before failing PIP handoff. Its compact Knowledge/Artifacts layering regression was corrected in the root web sheet boundary; full app acceptance on that fix continued beyond those cases. The private built-in workspace bridge now uses the canonical app query client; this fixes the identified plugin-cache/settings ownership mismatch, but its PIP acceptance is still pending. Import-time bridge regression was corrected without adding mocks; representative registry11 and settings7 tests pass. Current dedicated Visualizer run42908926681, full app42908922948 and CI42908966628 are pending; do not claim checkpoints3–8 or full feature complete. Older891 build-only Docker/Nix/Windows/Linux/installed Linux/unsigned Macarm64 proof is historical, not exact current-source closure; unsigned Macx64 and Android APK+AAB still running there. Full current-source build/desktop/browser/device boundaries remain open. No local app/daemon/model/provider-CLI launch, installed data, release/publication or main landing."
  affects: ["otto-0-10-visualizer-restoration"]
- time: "2026-11-10T23:50:10.480Z"
  kind: "note"
  summary: "Verified implementation and automated acceptance checkpoints 1–7 at bfccf88f8e85521df67cb3ebec0205606e609cf9 on otto-0.10/phase-0. Both real browser shards passed all 86 journeys, including the wide and compact canonical graph, File activity/Reported cost/Failures switching, PIP handoff, real Composer follow-up and draft conversion, and the empty workspace demo: https://github.com/Draek2077/otto-code/actions/runs/42923789566. Linux Electron passed the private offline guest, hide/restore with a new guest and channel, real PIP hover/expand, and tab-close teardown: https://github.com/Draek2077/otto-code/actions/runs/42923791542/job/130205278692. Reconnect and bounded replay also have focused canonical-feed fixtures. Full required CI and exact build-only Desktop, Android, Docker and Nix are still in flight, so checkpoint 8 and F10–F12 delivery remain open. Runtime proof uses disposable CI hosts; no physical-device or installed-user-data test or release is claimed."
  affects: ["otto-0-10-visualizer-restoration"]
- time: "2026-11-11T00:43:41.565Z"
  kind: "note"
  summary: "All eight restoration checkpoints passed on bfccf88f8e85521df67cb3ebec0205606e609cf9 (otto-0.10/phase-0). Full CI: 21/21, including 35 Linux desktop renderer tests and the actual Electron browser journey (private offline guest, native hide/recreate, hover, expand and close): https://github.com/Draek2077/otto-code/actions/runs/42923791542. Otto browser acceptance: 86/86, including wide, compact and empty-workspace Visualizer: https://github.com/Draek2077/otto-code/actions/runs/42923789566. Editor acceptance: https://github.com/Draek2077/otto-code/actions/runs/42923789571. Exact-source build-only Desktop Windows/Linux/installed Linux/unsigned macOS arm64 and x64: https://github.com/Draek2077/otto-code/actions/runs/42926465943; Android verified APK and AAB artifacts: https://github.com/Draek2077/otto-code/actions/runs/42926467214; Docker: https://github.com/Draek2077/otto-code/actions/runs/42926466852; Nix Linux and Darwin: https://github.com/Draek2077/otto-code/actions/runs/42926467151. Packaged daemon smoke logs show the built-in Visualizer loading on all Desktop platforms. The existing iOS signing gate remains. No release, physical-device test, or modification of installed Otto or user data is claimed. F22 compare-first is the next authorized item."
  affects: ["otto-0-10-visualizer-restoration"]
