---
id: "otto-0-10-clean-paseo-rebuild"
kind: "project"
title: "Otto 0.10.0: rebuild on clean Paseo 0.12"
status: "confirmed"
tags: ["upstream","paseo","release","rebrand","architecture"]
delivery_status: "charter"
progress_completed: 0
progress_total: 3
progress_unit: "phases"
created_at: "2026-10-20T13:25:41.860Z"
updated_at: "2026-10-20T13:25:41.860Z"
---
# Otto 0.10.0: rebuild on clean Paseo 0.12

<!-- compiled_truth -->

# Otto 0.10.0: rebuild on clean Paseo 0.12

Otto 0.10.0 is the next Otto release, built from a clean Paseo v0.12.0 tree (cafe4b01c) instead of from Otto 0.9's code. The rules are in [[otto-0-10-rebuilds-on-clean-paseo]]. In short: rename only the identity surface, keep Otto code in Otto-owned places with `OTTO(<seam>)` markers on every Paseo edit, honor features rather than old code, and stay protocol-compatible with Paseo's relay and Hub.

## Phase 0: Otto-branded clean Paseo, release-capable

Work happens in an isolated worktree branch until it is ready to land on `main`.

1. **Freeze point.** Tag the last Otto 0.9 commit on `main` after 0.9.35 ships.
2. **Base tree.** Start from Paseo v0.12.0 (or its newest stable patch at start), resolved by SHA from `refs/upstream-tags/`.
3. **Carry over Otto infrastructure:** `.github/` workflows, release scripts and the release skill, the website and `public-docs/` (rebased onto Paseo's content where they overlap), `.otto/knowledge/`, dev-home isolation (`scripts/dev-home.*`, dev port 6788, the checkout-local `OTTO_HOME`), lockfile and Nix hash automation, `LICENSE` verbatim.
4. **Identity surface** (about 600 edits): on-screen labels in all 10 locales (values only), visible CLI, server and desktop strings, agent-facing product name, app, bundle and store ids (`ai.ottocode.desktop`, `me.ottocode.mobile`), the `otto` command, `~/.otto`, port 6868, Otto URLs, icons and assets. The relay default stays `relay.paseo.sh`.
5. **Publish-time npm rename** from `@getpaseo/*` to `@otto-code/*`, keeping the current Otto package names and the CI trusted-publishing flow.
6. **`OTTO_*` to `PASEO_*` env mapping** at each entry point (daemon, CLI, desktop main, app config).
7. **Seam convention:** a marker lint or script that lists every `OTTO(<seam>)` and reports the patch budget.
8. **Docs and agent rules:** Paseo's `docs/` and AGENTS.md come in; keep Otto's process docs (release, development and dev isolation, writing style, upstream merges rewritten for the new model). Otto 0.9 engineering docs retire to git history.

**Phase 0 gates:**
- typecheck, lint and CI green; desktop (Windows, macOS, Linux), Android and CLI artifacts build through Otto's pipeline;
- **data safety:** a 0.9 user's `~/.otto` opens without loss. Paseo's config, agent and workspace stores must not drop Otto-only fields when they rewrite files, proven by a fixture from a real 0.9 home;
- **relay and Hub:** pairing and remote use over `relay.paseo.sh` work; Hub behavior with an Otto daemon is verified, including any daemon version floor (Otto reports 0.10.0 while running Paseo 0.12 code);
- dev and installed lanes stay isolated (6788 vs 6868).

**Landing:** one commit on `main` with two parents, the frozen 0.9 commit and the Paseo base, whose tree is the Phase 0 result. After it lands, `git merge-base HEAD upstream/main` is the Paseo base and future upstream merges stay small.

## Phase 1: functionality back, no Paseo UI changes

Build a feature manifest from Knowledge projects and requirements plus Otto 0.9 docs. Each feature gets one disposition before work starts: rebuild in Otto-owned code, rebuild as a plugin (only where the SDK fits), already supplied by Paseo (drop), or defer. Philippe decides each one.

Candidates: Brain, Project Knowledge, Visualizer, Hey Otto and voice, Zoom recorder and Communications, the OpenAI-compatible provider with its daemon-owned tool loop, Preview and browser tools, artifacts, workflows, schedules and orchestration, agent profiles and teams, git hosting (Bitbucket), Kanban, Refine, LSP code intelligence.

Out of scope for Phase 1: Otto UI tweaks to Paseo screens, chat behavior changes and chat systems, themes. Those wait for Phase 2, after a fresh evaluation of clean Paseo.

## Phase 2: UI, themes, chat

Themes come back only through Paseo's theme system. UI tweaks and chat systems return feature by feature after evaluating clean Paseo.

## Open questions

1. Which Phase 1 features are the minimum before 0.10.0 is published? Until then Phase 0 and Phase 1 builds are release-capable but not published.
2. If Hub enforces a daemon version floor, how should Otto's version relate to the Paseo base?

## Timeline

- time: "2026-10-20T13:25:41.860Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["otto-0-10-rebuilds-on-clean-paseo","upstream-mergeability-through-otto-owned-seams","paseo-v012-upstream-integration","finding-2026-10-19-paseo-v012-merge-gap"]
- time: "2026-10-20T13:25:41.860Z"
  kind: "evidence"
  summary: "Charter written at the user's request on 2026-10-20 after agreeing the plan in [[otto-0-10-rebuilds-on-clean-paseo]]. Sizing from [[finding-2026-10-19-paseo-v012-merge-gap]]. Starts after the Otto 0.9.35 release completes."
