---
id: "paseo-v040-upstream-integration"
kind: "requirement"
title: "Integrate Paseo v0.4.0 and converge on upstream structure"
status: "confirmed"
tags: ["upstream","paseo","integration","v0-4-0","merge"]
created_at: "2026-08-21T13:40:49.704Z"
updated_at: "2026-08-21T21:27:26.197Z"
---
# Integrate Paseo v0.4.0 and converge on upstream structure

<!-- compiled_truth -->

Otto must integrate Paseo v0.4.0 from the v0.2.5 merge baseline on an isolated merge worktree. Supersedes the v0.3.1 target, which was current on 2026-08-09 and was overtaken by v0.4.0 on 2026-08-13.

**Target.** Paseo v0.4.0, commit `b44bb63cf4ce089ab5750b9fc621ed52827b2820`, from baseline `6fc491e62` (v0.2.5). Merge by SHA, never by tag name: Otto cut its own `v0.4.0`, so the local tag resolves to an Otto release commit. Do not merge `upstream/main` or any `-beta` tag. v0.4.0 is the newest stable release and puts Otto exactly at the two-minor-release cadence cap.

**Surface.** 280 commits, 1,715 upstream-changed paths, 696 overlapping with Otto, 631 clean new files, 35 delete/modify hazards, 62 hand-merge hotspots. Size and triage from `node scripts/upstream-status.mjs --at v0.4.0`, never from the `upstream/main` default, which overstates the work at 442 commits and 838 overlapping files.

**Governing principle.** Paseo's structure is the base. Where a concept exists on both sides, adopt upstream's storage, module layout, file paths, internals and UI shell, then raise it to Otto's standard by adding Otto's fields and capabilities on top. Leave no duplicate concept, no duplicate function and no rival tree behind. The reason is future merge cost: rival implementations at different paths never conflict and never appear in a merge diff, so they accumulate silently.

**Per-capability decisions.**

1. *Chat rooms and agent loops: follow upstream, remove both.* Delete `packages/cli/src/commands/chat/` and `commands/loop/`, `packages/server/src/server/chat/` and `loop-service.ts`. Adopt upstream's split of `session/chat/chat-schedule-loop-session.ts` into `session/schedule/schedule-session.ts`, which retains schedules. Take the query-shaped `AgentStorage` methods and the `import-sessions.ts` changes. Remove `skills/otto-loop/`, and clean `public-docs/skills.md`, `docs/architecture.md`, `docs/glossary.md`, `docs/data-model.md` and the website post on agent chat rooms. Otto was not using either subsystem, orchestration already covers looping with real phase runs and agent binding, and following upstream puts Otto on the correct side of the coming SQL storage migration. Existing installs are left with orphaned `$OTTO_HOME/chat/rooms.json` and `loops/loops.json`; upstream retained the wire schemas, so nothing breaks on the protocol.

2. *Mermaid: adopt upstream's renderer, delete Otto's.* Take `packages/app/src/components/markdown/fence/mermaid/`. Port Otto's `mermaid-theme.ts`, which exists because mermaid's khroma color math leaks the app theme into the scope, and preserve the single mount point serving chat, the file viewer and the pull-request panel. Delete `packages/app/src/components/markdown/mermaid/`. Otto's `markdown/fence.tsx` is a file and upstream's `markdown/fence/` is a directory, which requires manual resolution.

3. *Agent profiles and personalities: converge on upstream's structure.* Adopt upstream's module path `packages/app/src/agent-profiles/`, its storage key `MutableDaemonConfig.agentProfiles[]`, its internals (`capabilities.ts`, `materialize-profile.ts`, `profile-form-model.ts`), its settings shell (section, row, edit modal, appearance field) and its `AgentProfileApplyTarget` draft-or-running-agent abstraction. Then extend that structure with every Otto field and capability it lacks: `personalityPrompt` and `respectGlobalAppendPrompt`, `roles`, `voice` and `voiceCues`, `memoryEnabled` and the personality-memory subsystem, `effortLevel` with exact-id/level/nearest resolution and the `effortDegraded` flag, teams, and live switching through `agent.personality.set`. Take upstream's `icon`, `featureValues` and `notes`. Keep Otto's dual-color spinner system (`glowA`, `glowB`) *and* add upstream's single identity `color`; they serve different purposes and are not duplicates. Migrate `agentPersonalities` into the adopted structure, leaving the old key parsed-but-never-written for protocol back-compat. No second concept survives the merge.

   Otto-only wire message types (`agent.personality.set.*`, `personality.memory.*`, `agentPersonalities.*`) and persisted built-in ids (`personality_builtin_*`) are **not** renamed. Upstream has no counterpart to conflict with, so renaming buys zero merge-conflict reduction while breaking the protocol back-compat rule and invalidating live data on installed hosts. Structural convergence is where the merge-cost saving actually lives.

4. *Black theme: additive, no duplicate.* Otto's `blackTheme` is a Unistyles scoped key used only for `ScopedTheme name="black"` around chat panes and is never user-selectable, so upstream's Pure black theme fills a real gap. Add it as a user-selectable dark variant named Obsidian, expressed as a palette entry in Otto's own token structure. No UI change.

5. *File and folder actions: take upstream wholesale.* Upstream is a strict superset, adding copy relative path, duplicate, reveal in, revert and collapse folder, the backing server operations, and coverage in the Changes pane. Verify Otto's add-to-chat wiring and the `features.fileMutations` gate survive the swap, and reconcile upstream's revert against Otto's existing rollback-file so only one remains.

6. *HTML preview: replace Otto's with upstream's.* Take `html-preview.{tsx,web.tsx}`, `html-preview-csp.ts` and `html-preview-navigation.ts`, and delete `html-file-preview.{tsx,web.tsx,native.tsx}`. Otto's grants `allow-forms allow-modals allow-popups allow-scripts` with no CSP wrapper and no referrer policy; upstream's grants `allow-scripts` only, injects CSP, sets `referrerPolicy="no-referrer"` and documents the residual self-navigation hole. It slots into Otto's existing `RenderedDocumentKind` `"html"` path. This is a file-viewer render mode and does not touch the Preview subsystem.

7. *Command Center: take upstream wholesale.* Otto's `model-contributions.ts` is a stale copy of the file upstream renamed to `agent-control-contributions.ts`. Adopt `root-contributions.ts`, `workspace-contributions.ts`, their registration components and `workspace-file-search`. Anything Otto-unique that is lost becomes a later project rather than a merge-time reconstruction.

8. *Take outright, no rival exists:* Cmd/Ctrl+P workspace file search, forking a running agent, shortcut unassign with effective bindings, and the supported client TypeScript SDK rebranded to `@otto-code/client`.

9. *Deferred to head-to-heads inside the merge branch:* live task progress against `todo-task-list.tsx`, history search, the mobile terminal, orchestration skill selection, and the Markdown centered reading layout against Otto's Text Editor canvas.

**Mandatory safeguards.** Preserve Otto package versions; only `UPSTREAM_BASE_VERSION` becomes `0.4.0`, and assert the `UPSTREAM_BASE_NAME = "Paseo"` literal directly because that file is on the rebrand audit's exclusion list. Retain the permanent Hub exclusion and prove no daemon runtime import reaches `server/hub/`. Apply all protocol changes additively, preserve parsing in both directions, and generate validators before typechecking. Treat rebranding as semantic classification, never blanket replacement: Paseo attribution, upstream references, legal notices, external project names and URLs, the About base indicator and the marketing-site credit and sponsorship content must retain Paseo, and every remaining occurrence must be explicitly allowlisted with its reason.

**Execution gate.** Create an isolated worktree first, merge at the v0.4.0 SHA, resolve by subsystem, then verify targeted unit, browser, Playwright and desktop cases plus the protocol, Hub, rebrand, typecheck, lint and CI checks. Uncommitted work on `main` is out of scope and must remain untouched.

## Timeline

- time: "2026-08-21T13:40:49.704Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["paseo-v031-upstream-integration","finding-2026-08-21-paseo-v040-rival-features"]
- time: "2026-08-21T13:40:49.704Z"
  kind: "evidence"
  summary: "Target and surface measured on 2026-08-21 with `node scripts/upstream-status.mjs --at v0.4.0` after commits 46ab043ac and 6576ab46a fixed the drift report. Upstream releases resolved through the namespaced `refs/upstream-tags/` refspec, because Otto's own release tags shadow Paseo's by name: v0.3.0 at 7392e1b76 (2026-08-08), v0.3.1 at bfec7ac3a (2026-08-09), v0.4.0 at b44bb63cf (2026-08-13), with upstream/main mid-flight at v0.5.0-beta.3+24. Chat and loop removal traced to upstream commit 94bda1f92 (PR #3053, 2026-08-10), 73 files and 6,801 deletions, titled as prerequisite cleanup before the storage backend migration; Paseo's v0.4.0 CLI confirmed to register neither command. Per-capability decisions rest on the code-level comparison recorded in [[finding-2026-08-21-paseo-v040-rival-features]]. Decisions taken by the user on 2026-08-21."
- time: "2026-08-21T21:06:06.889Z"
  kind: "evidence"
  summary: "Delivery completed on isolated branch `merge/upstream-2026-08-v040`. Merge commit `d6cafbd03f8eddb150521e4e1ed2a17145732a2b` integrates Paseo v0.4.0 (`b44bb63cf4ce089ab5750b9fc621ed52827b2820`); merge commit `efcc30b778ab2110b17425b95e5c8cc1e34753ad` then incorporates current Otto `main` (`46511f5608e3905f8dc43225fc5aed8a91282293`). Both upstream and main are verified ancestors and the merge worktree is clean. Verification passed full repository format, lint, and typecheck; server, website production, and desktop main builds; patch-package application from pristine package tarballs; and focused tests across the semantically merged app/server/runtime/sidebar/menu/stream/profile/file-explorer/platform surfaces. The full local test suite was intentionally not run under repository policy; targeted tests were used instead. `npm ci` reported 69 pre-existing audit findings (7 low, 32 moderate, 30 high), with no automatic remediation applied."
  source: "Local Git history and merge-worktree verification on 2026-08-21"
- time: "2026-08-21T21:27:26.197Z"
  kind: "evidence"
  summary: "Final history shape supersedes the interim `efcc30b778ab2110b17425b95e5c8cc1e34753ad` reconciliation merge described immediately above. Paseo merge `d6cafbd03f8eddb150521e4e1ed2a17145732a2b` remains inserted at original Otto head `f90e8c851ec5a1b1edd8a2e6761001d22e6845fa` with Paseo v0.4.0 `b44bb63cf4ce089ab5750b9fc621ed52827b2820` as its second parent. All 25 commits formerly in `f90e8c851..46511f560` were then replayed in order; their 24 first-parent subjects match exactly and the original `merge: sync origin/main` remains a two-parent merge. Integration reconciliation head `ceb2e5c1033ca12f1919ef6bdfb66b6f0e97cf65` has the exact same Git tree (`47108c03de7b6d1f82732fb310f744280e72b36e`) as the previously verified semantic merge, and local `main` was moved to this replayed history. Recovery refs preserve the former histories at `backup/main-before-paseo-v040-20260821` and `backup/merge-v040-semantic-20260821`."
  source: "Final local history audit on 2026-08-21"
