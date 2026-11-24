---
id: "otto-0-10-rebuilds-on-clean-paseo"
kind: "decision"
title: "Otto 0.10.0 rebuilds on a clean Paseo base"
status: "proposed"
tags: ["upstream","paseo","fork-policy","rebrand","architecture"]
created_at: "2026-10-20T13:25:16.195Z"
updated_at: "2026-10-21T22:57:32.250Z"
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
8. **Order:** Phase 0 is clean Paseo plus Otto identity, building and release-capable. Phase 1 reimplements selected functional capabilities using Paseo's current contracts and design principles. Keep base UI and chat/session semantics in place; add feature-owned screens/panels through existing contribution patterns where required. General UI tweaks, themes (only through Paseo's theme system), icon/language/appearance changes and chat systems follow a separate evaluation.
9. **The feature scope lives in the rebuild charter.** [[otto-0-10-clean-paseo-rebuild]] records Philippe's selected, conditional and deferred families. Scope-setting must be allowed to finish; selection does not waive baseline acceptance. A selected feature cannot silently restore deferred profiles, teams, chat systems or editor behavior as a dependency.
10. **Rebuild capabilities in a new way.** Compare Paseo's current implementation first, reuse what it supplies and restore only the wanted delta. Historical Otto code, UI, reliability patches and MCP tools are inputs for review, not a code-port checklist.
11. **Changes to Paseo stay discoverable.** Mark every unavoidable changed block with OTTO(<seam>); use an explicit registry exception for non-commentable formats. Keep the owning feature, reason, boundary and proof traceable through the seam registry, indexed software docs and Knowledge records. Run the seam checks and measure the patch budget and actual overlap during future upstream intake. Mergeability is a maintained obligation, not a guarantee of zero conflicts.
12. **Tools and shared integrations are assessed piece by piece.** Review each MCP tool and customization with its owning feature, including provider access and output/context cost. Reuse the existing browser/tool/audio/session infrastructure where it fits. Remote Host Browser is explicitly wanted; browser extensions must be justified by actual missing capabilities rather than replacing Paseo's browser stack.
13. **Function first, polish later.** The selected features return through a coherent base Otto. Themes are intended to return later; presentation images and store screenshots are revisited after examining Paseo's approach. Do not mix those later efforts into functional restoration.
14. **One feature at a time, with a durable checklist.** [[otto-0-10-clean-paseo-rebuild]] is the master baseline/selected/deferred task list. Scope and finish one usable slice, collect proof and review it before the next. Deferred features remain available for later selection; they are not automatically cancelled or restored as dependencies.
15. **Five completion gates apply to every implementation.** Required CI is green; all required product outputs keep building and user-facing features work on Desktop and Mobile; porting rules, visible Otto identity and existing-user continuity are preserved; daemon/frontend ownership follows Paseo's architecture; new Otto implementation is kept in separate Otto-owned files. Keep unavoidable upstream integrations minimal and marked. The charter specifies the evidence and the already accepted iOS signing boundary. A failing CI gate blocks advancing to the next feature.

## Timeline

- time: "2026-10-20T13:25:16.195Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["upstream-mergeability-through-otto-owned-seams","otto-0-10-clean-paseo-rebuild","paseo-v012-upstream-integration","finding-2026-10-19-paseo-v012-merge-gap"]
- time: "2026-10-20T13:25:16.195Z"
  kind: "evidence"
  summary: "Explicit user direction, 2026-10-19/20, after the v0.8.0 to v0.12.0 drift audit ([[finding-2026-10-19-paseo-v012-merge-gap]]).\nMeasured identity surface in Paseo v0.12.0 (cafe4b01c): 15,446 source lines mention paseo, but the visible surface is about 600 edits: about 38 English label lines across 10 locale files, about 150 other visible strings in the CLI, server and desktop code, 76 app-id refs, 23 home-folder refs, 41 port refs, 79 URL refs. 8 published `@getpaseo/*` packages, imported on 1,567 lines. 361 distinct `PASEO_*` env vars.\nRelay check: the relay sees the server id, role, connection id and relay protocol version `v`; app and daemon versions travel inside the end-to-end encrypted channel (`encrypted-relay-socket.ts`, `relay-transport.ts`, `packages/relay/src/cloudflare-adapter.ts`). Hub's view of the client is not yet verified.\nSupersedes the merge plan in [[paseo-v012-upstream-integration]]."
- time: "2026-10-21T21:37:25.790Z"
  kind: "decision"
  summary: "Philippe explicitly strengthened the clean-base strategy: new implementations through Paseo's current design, functional changes first, every core edit OTTO-tagged and traceable for future updates, piece-by-piece MCP/customization review, and separate later UI/themes/appearance work. Preserve the existing decision and add those durable constraints. Status returned to proposed for review."
  source: "Philippe's latest scope-setting and rebuilding-principles instructions."
  affects: ["otto-0-10-clean-paseo-rebuild","otto-0-10-feature-restoration-inventory"]
- time: "2026-10-21T22:57:32.250Z"
  kind: "decision"
  summary: "Philippe added explicit always-on delivery gates and requested full future retention of deferred features with one-at-a-time checkable tracking. Extend the existing rebuild decision to make those obligations durable and point to the charter as the single task list."
  source: "Philippe's latest five numbered standing requirements and request to retain all deferred items."
  affects: ["otto-0-10-clean-paseo-rebuild"]
