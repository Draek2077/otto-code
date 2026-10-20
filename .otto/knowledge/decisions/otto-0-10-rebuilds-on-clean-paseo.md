---
id: "otto-0-10-rebuilds-on-clean-paseo"
kind: "decision"
title: "Otto 0.10.0 rebuilds on a clean Paseo base"
status: "confirmed"
tags: ["upstream","paseo","fork-policy","rebrand","architecture"]
created_at: "2026-10-20T13:25:16.195Z"
updated_at: "2026-10-20T13:25:16.195Z"
---
# Otto 0.10.0 rebuilds on a clean Paseo base

<!-- compiled_truth -->

Otto 0.10.0 starts from a clean Paseo 0.12.0 tree instead of merging upstream into Otto 0.9. Otto honors product features and capabilities, not the code that implemented them in 0.9: nothing that modified Paseo carries over by default.

Rules:
1. **Rename only the identity surface.** Anything a user, operating system, app store or npm sees is Otto: on-screen labels and visible strings (i18n values, not keys), icons and assets, app/bundle/store ids, the `otto` command, `~/.otto`, port 6868, `OTTO_*` configuration, Otto URLs. Paseo class names, variables, comments and internal package names stay Paseo. Text agents read and repeat to users counts as visible.
2. **npm names change at publish time only.** Source keeps `@getpaseo/*`; the publish pipeline renames to `@otto-code/*`.
3. **`OTTO_*` environment variables map onto `PASEO_*` at each process entry point**, so existing Otto configuration keeps working without editing Paseo's readers.
4. **Otto code is named Otto and lives in Otto-owned places** (`src/otto/` directories or `packages/otto-*`). Every unavoidable edit to a Paseo file carries an `OTTO(<seam>)` marker so one search lists the whole patch set, which is tracked as a patch budget at every upstream merge. Plugins are used only where the Paseo plugin SDK genuinely fits the feature.
5. **No upstream contributions and no contact with Paseo.** Otto must be able to do everything itself.
6. **Paseo's relay and Hub are used as Paseo ships them.** Paseo's relay client is left untouched so Otto's relay traffic is protocol-identical to Paseo's; Otto does not fake identifiers. Otto's own relay hosting is retired.
7. **Continuity: this is the same product and the next release.** Same repository, same app ids, same names, same release pipeline. Existing user data in `~/.otto` must survive. The transition is one commit on `main` with two parents (the last Otto 0.9 commit and Paseo v0.12.0) whose tree is the new base.
8. **Order:** Phase 0 is clean Paseo plus Otto identity, building and release-capable. Phase 1 re-adds functionality only, with no Paseo UI or chat changes. UI tweaks, themes (applied only through Paseo's theme system), and chat systems come after a fresh evaluation of clean Paseo.

## Timeline

- time: "2026-10-20T13:25:16.195Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["upstream-mergeability-through-otto-owned-seams","otto-0-10-clean-paseo-rebuild","paseo-v012-upstream-integration","finding-2026-10-19-paseo-v012-merge-gap"]
- time: "2026-10-20T13:25:16.195Z"
  kind: "evidence"
  summary: "Explicit user direction, 2026-10-19/20, after the v0.8.0 to v0.12.0 drift audit ([[finding-2026-10-19-paseo-v012-merge-gap]]).\nMeasured identity surface in Paseo v0.12.0 (cafe4b01c): 15,446 source lines mention paseo, but the visible surface is about 600 edits: about 38 English label lines across 10 locale files, about 150 other visible strings in the CLI, server and desktop code, 76 app-id refs, 23 home-folder refs, 41 port refs, 79 URL refs. 8 published `@getpaseo/*` packages, imported on 1,567 lines. 361 distinct `PASEO_*` env vars.\nRelay check: the relay sees the server id, role, connection id and relay protocol version `v`; app and daemon versions travel inside the end-to-end encrypted channel (`encrypted-relay-socket.ts`, `relay-transport.ts`, `packages/relay/src/cloudflare-adapter.ts`). Hub's view of the client is not yet verified.\nSupersedes the merge plan in [[paseo-v012-upstream-integration]]."
