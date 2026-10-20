---
id: "finding-2026-08-09-settings-ownership-and-visibility"
kind: "finding"
title: "Settings ownership and visibility catalog"
status: "confirmed"
tags: ["finding","settings-catalog"]
created_at: "2026-08-16T22:16:11.514Z"
updated_at: "2026-09-02T14:09:01.926Z"
---
# Settings ownership and visibility catalog

<!-- compiled_truth -->

Date: 2026-08-24  
Question: Which settings belong to the local App versus a Host, and how are they organized and indexed?

## Current ownership rule

Settings keep the App/Host split. App owns device-local preferences and Electron-only desktop preferences; Host owns daemon-persisted configuration shared by clients connected to that daemon. A Host page may still describe device-local connection state, so those headings say `(on this device)` without renaming the Host navigation category.

## Canonical organization

- App has a dedicated **Chat** page for agent/chat behavior, task-list behavior, and chat presentation.
- App **Editor** owns Diff presentation.
- App **Integrations** owns device-local voice cues, wake-word/dictation controls, and voice playback volume.
- App **Permissions & notifications** is one page.
- App **Diagnostics** owns device-local preview cache storage and clearing.
- Host **Metadata** owns both metadata-generation behavior and model selection.
- Host **Brain** owns configuration plus read-only connection verification. It shows the configured endpoint and detected Brain connection, endpoint, version, state, model, VRAM, and last error so users can validate host, port, TLS, and authentication settings in place. Mutating lifecycle controls, loaded-model operations, console, models, downloads, benchmarks, and logs belong to the normal Brain surface.
- Host **Connections** and **Pair device** remain separate.
- Host **Usage** remains separate from Providers.
- Connectors and provider-native GitHub/Jira/Bitbucket authorization remain as currently modeled while their integration architecture converges.

## Audited inventory and search

The generated Markdown inventory is `outputs/settings-inventory/settings-index.md`. At this revision it contains **405** Settings entries: **174 App** and **231 Host**, grouped into **103** tables. The inventory includes preferences, permissions, credentials, actions, conditional information, read-only connection verification, dynamic row patterns, keyboard commands, and finite catalog choices; it excludes navigation-only controls and mutating/progress-bearing Brain operations that no longer render in Settings.

The in-app Settings search catalog is generated from that same audited inventory. It contains **405 unique records**, with exact user-facing label, description, scope, canonical page, group, audience, and Advanced metadata. A permanent test compares all 405 report rows with the live catalog field-for-field. Search descriptions name the owning tool/configuration layer where that distinction helps disambiguate similar controls.

## Persistence scopes

| Scope | Meaning |
| --- | --- |
| App | Stored on the current device and affects this client |
| Desktop | Stored by the Electron wrapper on this computer |
| Host | Stored by the daemon and shared by connected clients |
| Project | Stored in project configuration on the selected Host |

The exhaustive row-level details live in the generated inventory rather than being duplicated in this finding.

## Timeline

- time: "2026-08-16T22:16:11.514Z"
  kind: "migration"
  summary: "Migrated from the legacy findings report without discarding its evidence."
  source: "findings/settings-catalog/2026-08-09-settings-ownership-and-visibility.md"
- time: "2026-08-20T05:37:30.799Z"
  kind: "evidence"
  summary: "Implemented a central Settings search catalog with scope, owning section, developer visibility, and aliases for App, Desktop, and Host settings. The Settings search surface merges this catalog as the effective source (catalog entries overwrite legacy duplicate ids), so Bitbucket, Difftastic, Git-fetch/SSH/private-key, Vim/Neovim/vimrc, provider, terminal, Brain, code-intelligence, connector, storage, and lifecycle vocabulary all resolve. Developer-only settings are now discoverable in User mode and explicitly state that Developer mode must be enabled to edit them, rather than disappearing. Added catalog unit tests that pin unique ids, required metadata, empty-query behavior, and key product aliases. Targeted lint, app typecheck, formatting, and the three-test catalog suite passed."
  source: "Implementation verification, 2026-08-19"
  affects: ["settings-search-navigates-to-setting-row","settings-opens-to-search-first-overview","tester-feedback-2026-08-19-first-run-discoverability-and-workflow-friction"]
- time: "2026-08-25T00:19:51.359Z"
  kind: "evidence"
  summary: "2026-08-24 search-index reconciliation against the exhaustive rendered Settings inventory: the live hand-maintained catalog has 61 entries for 408 indexed Settings rows (226 preference rows). Exact displayed-label queries find 83/408 rows and route to the owning page for 43/408; among preferences they find 65/226 and route correctly for 31/226. All page slugs are represented, so the current focused test passes (5/5), but it only asserts page coverage and selected aliases. The catalog schema contains no canonical row target, group, audience, advanced state, or project persistence scope; result selection only changes section and cannot reveal, scroll to, or highlight a row. `settings-search-overview.tsx` also retains an unused 23-entry exported catalog that has already drifted from the live canonical catalog (for example personalities points to Agents there versus Teams in the live catalog)."
  source: "packages/app/src/screens/settings-search-catalog.ts; packages/app/src/screens/settings-search-overview.tsx; packages/app/src/screens/settings-search-catalog.tes"
  affects: ["settings-search-navigates-to-setting-row","settings-opens-to-search-first-overview"]
- time: "2026-08-25T00:27:56.514Z"
  kind: "evidence"
  summary: "Correction to the 2026-08-24 search-index evidence: the generated inventory initially misclassified eight Provider controls by placing their choices in the Kind column. After correcting and re-validating the 408-row Markdown inventory, there are 234 preference rows; exact displayed-label search finds 66/234 and routes correctly for 32/234. The catalog-wide totals remain 61 catalog entries, 83/408 exact-label matches, and 43/408 correctly routed exact-label matches."
  source: "outputs/settings-inventory/settings-index.md"
  affects: ["settings-search-navigates-to-setting-row"]
- time: "2026-08-25T01:03:56.918Z"
  kind: "decision"
  summary: "The user approved the reviewed Settings reorganization, explicitly retained Connections/Pair device and Usage/Providers as separate pages, and requested that the exhaustive report and live search catalog be reconciled to the new canonical locations."
  source: "Verified implementation and inventory/search reconciliation on 2026-08-24"
  affects: ["settings-search-navigates-to-setting-row","settings-opens-to-search-first-overview"]
- time: "2026-08-25T01:34:13.292Z"
  kind: "evidence"
  summary: "A post-reorganization control-level audit found two real regressions and one index-schema gap before handoff: the eight device-local voice/wake rows had become unreachable outside desktop because the Integrations route was desktop-gated; the Brain start/restart model override had been removed instead of relocated; and Project persistence was omitted from the Settings search scope type. The voice/wake group now remains on App > Integrations on every supported client while desktop connector UI stays desktop-gated. The model override now lives beside Start/Stop/Restart on Brain Overview, passes the selected installed model to start/restart, and preserves Stop/Restart confirmation. Project is now a first-class search scope. A full reconciliation then found 106 report/search metadata mismatches (mostly stale scope labels and encoding/copy drift); regeneration reduced this to zero across all 397 rows. A permanent unit test compares the Markdown inventory with the live search catalog field-for-field and separately guards the eight App voice rows and 29 configuration-only Host Brain rows."
  source: "outputs/settings-inventory/settings-index.md; packages/app/src/screens/settings-search-generated.ts; packages/app/src/screens/settings-search-catalog.test.ts; p"
  affects: ["settings-search-navigates-to-setting-row","settings-opens-to-search-first-overview"]
- time: "2026-08-25T01:44:58.849Z"
  kind: "decision"
  summary: "The user clarified that connection verification is part of the Brain settings workflow even when lifecycle controls move elsewhere. The implementation now restores a read-only Detected Brain section and the audited inventory/search totals increase from 397 to 405."
  source: "User correction and verified implementation on 2026-08-24"
  affects: ["settings-search-navigates-to-setting-row","settings-opens-to-search-first-overview"]
- time: "2026-09-02T14:09:01.926Z"
  kind: "evidence"
  summary: "Release-preparation reconciliation regenerated the live catalog from `outputs/settings-inventory/settings-index.md` and verified **433** unique Settings entries: **183 App** and **250 Host**. The catalog’s field-for-field inventory test passes. The audit corrected stale inventory summary and contents counts, repaired two source links that pointed beyond their files after code moved, and added permanent test guards for summary totals, every contents-table count, and source-link existence/line validity. Focused catalog tests (15/15), targeted lint, and App typecheck passed."
  source: "Release-preparation audit, 2026-09-02"
  affects: ["settings-opens-to-search-first-overview","settings-search-navigates-to-setting-row"]
