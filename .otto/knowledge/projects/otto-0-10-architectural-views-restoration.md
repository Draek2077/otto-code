---
id: "otto-0-10-architectural-views-restoration"
kind: "project"
title: "Architectural Views / Archify restoration"
status: "proposed"
tags: ["otto-0.10","restoration","architectural-views","archify"]
delivery_status: "complete"
progress_completed: 8
progress_total: 8
progress_unit: "restoration checkpoints"
created_at: "2026-11-09T20:57:01.686Z"
updated_at: "2026-11-10T00:47:59.163Z"
---
# Architectural Views / Archify restoration

<!-- compiled_truth -->

# Architectural Views / Archify restoration on Paseo 0.12

Restore the complete shipped Otto 0.9 Interactive View product through the existing Otto 0.10 Knowledge, Artifact isolation, ordinary chat and plugin contribution owners. Philippe selected this as the next end-to-end feature after Schedule completion. Integration starts at f61be0d302dc4cb8465bcbd138ebf79817e4cf83 on otto-0.10/phase-0 in the existing .claude/worktrees/otto-0.10 checkout.

## Product contract

- Five typed diagram kinds: Architecture, Workflow, Sequence, Data Flow and Lifecycle.
- Knowledge-linked visual documents, not a replacement for canonical Markdown truth. Explicit source references, captured digests and current/stale/unknown disclosure survive publication.
- Durable published specifications, render receipts, staged drafts and retained published revisions. Recover existing repository and host .otto/architectural-views layouts without destructive read-time conversion.
- Create/update/refresh with a normal provider-neutral authoring chat and preview. Ordinary Paseo creation, provider/session, queue, permission, transcript and cancellation owners remain authoritative. No new chat engine, background turn loop or implicit takeover of an existing conversation.
- Bind authoring tools to the actual host/workspace/chat and draft. Read/update typed specification tools never publish automatically. A person explicitly reviews and publishes or discards.
- Publication pins the draft and original published revision; stale or uncertain writes retain local/durable intent and require explicit inspection/reload. Invalid render results preserve last-known-good published output and preview.
- Knowledge article/root creation menu and linked viewer, workspace published/authoring panels, library/navigation and existing workspace/Command Center conventions must be actually reachable.
- Wide content uses list/detail or chat/preview panes with page gutters; compact adapts the same content. Restore one normalized app-local chat/preview splitter preference across staged and ordinary-chat authoring.
- Otto owns viewer chrome and active theme/font projection. Retain find, semantic lens, route tracing, overview map, zoom/fit, applicable motion, source/error notices and status. No separate viewer theme/style product.
- Keep the isolated viewer offline and untrusted: no host DOM/storage, Node, arbitrary navigation or network access. Validate bounded guest messages and source identity. Export follows existing host file/download boundaries; preserve the shipped native reading/export capability distinction rather than claiming desktop export proof is native proof.
- CLI and provider-neutral MCP expose bounded on-demand inspect, draft/update, render, publish/discard and show operations without injecting the engine or whole documents into ordinary model catalogs.

## Renderer and persistence boundaries

Reuse the frozen vendor runtime pinned to Archify 9e35d2b0b39b155553ba9fcfe0b4f2a5198dd993, with preserved MIT/Cocoon notices, a separate vendor tree and recorded patches. Do not run or expose upstream opener, Preview server, browser launcher, brand capture or visual-check commands. Exclude the default brand catalogue and generated brand symbols through an explicit vendor patch if required by its module graph. A bounded daemon-owned render admission/deadline owns computation; reads and UI mounting never start models/apps/browsers.

The daemon resolves canonical project/workspace and the owning Knowledge store. Preserve existing repository/host identities and unknown legacy metadata. No client paths select stores. Source reads are on demand and bounded; no alternate Knowledge index or implicit confirmation is created. Cooperating writes reuse the existing no-link publisher/locking primitives; external-editor final compare/publish limits remain explicit. Prefer immutable revision objects plus one revision-checked publication pointer over an unguarded multi-file rewrite.

New typed contracts live in Otto-owned SDK modules and authenticated built-in RPCs. Keep existing protocol parsing additive and gate the new feature once through server_info.features with a dated COMPAT marker. App code lives under packages/app/src/otto/architectural-views; daemon code under packages/server/src/server/otto/architectural-views; contribution under plugins/otto-architectural-views. Every unavoidable Paseo edit is minimal, OTTO-tagged and seam-checked.

## Eight completion checkpoints

1. [x] Pinned renderer, licenses, bounded validation/rendering and packaged asset resolution for all five diagram kinds.
2. [x] Canonical durable storage, legacy data/unknown-field continuity, drafts/revisions, source freshness, CAS publication/discard/recovery and negative filesystem cases.
3. [x] Daemon composition, typed bounded RPCs, capability, demand-owned change observation and shutdown/admission safety.
4. [x] Provider-neutral scoped tools, CLI, ordinary authoring chat binding, show/navigation intent and no implicit publication or session replacement.
5. [x] Reachable Knowledge/library/workspace/authoring UI using current Paseo controls, wide/compact layouts, draft conflict/hidden lifetimes and persisted splitter.
6. [x] Isolated cross-platform viewer, typed bounded bridge, active theme/fonts, all applicable toolbar/status/export behavior and navigation/security tests.
7. [x] Indexed software/manual docs, targeted deterministic tests, real-renderer integration and controlled real-daemon/browser wide/compact authoring/publication/repair/export acceptance in CI.
8. [x] Normal hooks, full required CI, affected Windows/Linux/unsigned Mac/Android/Docker/Nix build evidence and final charter/master reconciliation.

No checkpoint closes for source-only helpers or an unregistered panel. Complete means the feature is usable end to end with all required proof, not merely rendered cards or a successful engine call.

## Operating constraints and non-goals

Use the existing integration checkout and preserve unrelated work; no agents or new worktrees. Installed Otto/home/6868 and local dev apps/models remain stopped/unchanged. Repository dependencies may be added when required. Serialize bounded local checks with limited workers; do not run full local suites. CI owns app/browser/native packaged acceptance and full suites. Existing iOS signing gate remains accepted. No main landing, release, publication, deployment, global configuration or unrelated cleanup is included. Do not retry denied scratch deletions.

Visualizer/PIP/background and the History audit remain next separate families. Profiles/teams, general chat changes, Context startup isolation, appearance/theme redesign and the rest of the deferred backlog are not silently restored as dependencies.

## Starting evidence

Frozen source 95a19522a191394a874320041eaf05f6c5f3c682 includes interactive-views documentation, service/renderer, draft chat presentation, five diagram kinds, viewer/theme/font/export bridge, CLI, agent tools and persisted view/revision/draft examples. These are behavior references, not current-code availability. The active f61 source has restored Knowledge/Artifacts and plugin seams but no Archify/vendor/view implementation yet. Baseline CI and product gates were green; no feature code or runtime acceptance is claimed at this charter's start.

References: [[reference-archify]], [[architectural-view-authoring-splitter-is-user-preference]], [[otto-0-10-clean-paseo-rebuild]].

## Verified completion (2026-11-10)

All eight restoration checkpoints are implemented and verified. The integrated head is `ee0b7d326c4c664d41f72d50d80134fec8010698` on `otto-0.10/phase-0` in the existing integration checkout. Product and packaging inputs are identical to `46c9c28233f196cdb4cb587c126d81da0146f599`; the later commits change only `packages/app/e2e/browser/otto-architectural-views.spec.ts`, `packages/app/e2e/browser/sidebar-nav-settings.spec.ts` and `packages/app/e2e/support/helpers/sidebar.ts`. A scoped Git comparison confirmed no production/packaging difference.

### Delivered product and ownership

- The registered Architectural Views header navigation, Knowledge source actions, workspace panel and Command Center lead to the actual library, five-kind reader, ordinary-chat authoring and live draft preview. Wide layouts retain the list/document or chat/preview panes; compact layouts expose the same operations in one pane. The version-1 authoring splitter preference is retained.
- The pinned offline renderer and its licenses ship with server/CLI, desktop, Docker and Nix. Daemon-owned validation, bounded child admission/deadline/shutdown, demand-scoped observation, bounded render/transfer cache and capability gate remain separate from app presentation. No parallel provider harness, chat queue/session engine, browser stack or global theme owner was introduced. Unavoidable Paseo seams are tagged and registered.
- Repository and persisted host-store origins, frozen pretty-JSON source hashes, raw historical specifications, unknown root/nested metadata, draft base review and revision history survive. Writes use canonical project ownership and revision-checked immutable objects/publication pointers. Drafts and uncertain outcomes remain inspectable; no read-time migration, target unlink, implicit publication or user-data reset was added.
- Provider-neutral read/contract/draft/update/show tools, revision-pinned compact source parts and the complete CLI lifecycle use the same service. Human publication/discard remain outside model tools. Ordinary provider/session/permission ownership is preserved.
- The isolated viewer uses the active Otto theme/font projection and existing controls for find/lens/route/map/guide, zoom/fit, applicable motion, status and export. Opaque guest identity, CSP/navigation containment, bounded messages and explicit pending-export MIME checks preserve the app boundary. Hidden preview guests/observers release their demand.

### Acceptance evidence

Normal formatting, lint and all-workspace typecheck hooks passed without bypasses. Focused renderer, legacy/CAS/corruption/concurrency, lifecycle, source-budget/schema, UI draft/controller/lease, CLI, SDK/compiler and compiled-runtime tests passed; full remote suites cover the integrated source.

- [Required CI 42725349791](https://github.com/Draek2077/otto-code/actions/runs/42725349791) passed **21/21 jobs** at the final head.
- [Full Otto app acceptance 42725348211](https://github.com/Draek2077/otto-code/actions/runs/42725348211) passed **83/83 journeys**, split 42 + 41, at the final head.
- [Architectural Views acceptance 42725355282](https://github.com/Draek2077/otto-code/actions/runs/42725355282) passed **2/2 wide/compact journeys**: real daemon and normal provider tool loop; exact bound draft; invalid-coordinate rejection and repair; native chat/preview; explicit publication; workspace Show; five real diagram renderers; legacy base review/publication with original bytes and unknown metadata retained; SVG and actual PNG/JPEG/WebP download signatures. Screenshots were inspected and the wide sidebar width is asserted.
- [Editor/runtime acceptance 42725348096](https://github.com/Draek2077/otto-code/actions/runs/42725348096) passed at the final head.
- [Desktop 42722357866](https://github.com/Draek2077/otto-code/actions/runs/42722357866) passed Windows, Linux, unsigned macOS x64/arm64 and installed-Linux smoke.
- [Android 42722363874](https://github.com/Draek2077/otto-code/actions/runs/42722363874) passed APK and AAB verification; both `otto-android-apk` and `otto-android-aab` artifacts are present.
- [Docker 42722369350](https://github.com/Draek2077/otto-code/actions/runs/42722369350) passed its native image/Host Browser acceptance. [Nix 42722375256](https://github.com/Draek2077/otto-code/actions/runs/42722375256) passed both Linux and Darwin builds.

The three product workflows above and Nix use the matching production head `46c9c28233f196cdb4cb587c126d81da0146f599`, not a rebuild of the later test-only head. Publishing was disabled; existing v0.9.35 metadata was used solely for build verification.

### Retained limits and next boundary

The ordinary authoring proof uses an isolated loopback OpenAI-compatible provider, not a paid/vendor account or native model/GPU run. Responsive browser proof is not physical-device proof. Native WebView/device interaction and personal provider review remain explicit acceptance limits; native export is not exposed. Signed iOS remains behind Philippe's previously accepted signing gate. The portable external-editor final compare/rename interval remains documented.

Software behavior is indexed in `docs/otto-architectural-views.md`; the public manual is `public-docs/architectural-views.md`. No local app, daemon, browser/native-provider CLI or model was launched; installed Otto/home/6868, release settings and user data were untouched. No main landing, tag, publication or deployment occurred. Review status remains proposed, not human-confirmed. Visualizer/PIP/background and F22 remain separate, unstarted selections.

## Timeline

- time: "2026-11-09T20:57:01.686Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-11-09T20:57:01.686Z"
  kind: "evidence"
  summary: "Philippe requested end-to-end implementation on 2026-11-09. Scope recovered from frozen 95a19522 and confirmed Archify/splitter requirements, compared with the active f61 Knowledge/Artifact/plugin architecture. No agents, new worktrees, local app/model/daemon launch or vendor update is authorized by this charter."
- time: "2026-11-10T00:47:19.816Z"
  kind: "decision"
  summary: "The requested end-to-end restoration has now passed all eight checkpoints: exact final-source full CI and app/runtime acceptance, matching production-source complete product builds, source/data continuity and responsive review. Record actual completion without confirming human review or starting another family."
  source: "https://github.com/Draek2077/otto-code/actions/runs/42725349791"
- time: "2026-11-10T00:47:59.163Z"
  kind: "note"
  summary: "All eight acceptance checkpoints passed. Final ee0b7d326 source has CI21/21, app83/83, dedicated wide/compact2/2 and editor/runtime success. Matching production46c9c2823 passed Windows/Linux, both unsigned Mac architectures, installed Linux, APK+AAB, Docker and Nix. Preserve proposed review status, physical-device/personal-provider limits and existing iOS signing gate. No next family, main landing or release is started."
  affects: ["otto-0-10-architectural-views-restoration"]
