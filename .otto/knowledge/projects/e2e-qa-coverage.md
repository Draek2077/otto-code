---
id: "e2e-qa-coverage"
kind: "project"
title: "E2e Qa Coverage"
status: "confirmed"
tags: ["project-charter","legacy-projects-migration"]
delivery_status: "partial"
created_at: "2026-08-08T06:17:54.313Z"
updated_at: "2026-08-30T01:06:15.983Z"
---
# E2e Qa Coverage

<!-- compiled_truth -->

# E2E QA Coverage - full-app Playwright test plan

**Goal:** every user-facing feature of Otto has locally runnable Playwright coverage, organized
by feature category, with a mechanical way to see what is covered and what is not - so cutting
a release means running known suites, not hoping.

This project does not replace the existing harness; it organizes and extends it. The harness in
`packages/app/e2e/` is already strong: 80+ specs, a fully isolated daemon/relay/Metro stack per
run (`global-setup.ts` forks a throwaway `OTTO_HOME`), a deterministic mock agent
(`helpers/mock-agent.ts`), and a credentialed real-provider tier (`*.real.spec.ts`). What is
missing is (1) a feature-complete map of what those specs cover, (2) coverage for the fork's
newer subsystems (personalities, teams, visualizer, permission modes, openai-compat native
tooling, artifacts, preview), and (3) a cheap way to run _live agent-loop_ journeys without
burning paid API credits.

## The three tiers

| Tier                 | Suffix                  | What it proves                                                                                                                                                                                      | Cost             | When it runs                         |
| -------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------ |
| **T1 Mock**          | `*.spec.ts`             | UI + daemon behavior with the deterministic mock agent. The bulk of coverage.                                                                                                                       | Free             | Every category run; CI shards        |
| **T2 Local-AI**      | `*.local.spec.ts` (new) | Full live agent loop - prompt → tool calls → file edits → diff/UI updates - via the **openai-compat provider pointed at LM Studio** (qwen3.6-27b-mtp over Tailscale). Real inference, zero dollars. | Free (local GPU) | Release validation; opt-in locally   |
| **T3 Real provider** | `*.real.spec.ts`        | Provider-specific integration (Claude/Codex/OpenCode/Pi rewind, session import).                                                                                                                    | Paid             | Release validation only, minimal set |

Design rule for T2/T3 specs: **assert on side effects, not on model prose.** A live-model spec
asks the agent to do something with an unambiguous observable outcome (create a file with exact
content, run a command) and asserts the outcome appears in the UI (diff row, tool call row,
terminal output). Never assert on the assistant's wording. See
[local-ai-tier.md](local-ai-tier.md) for the full tier design.

## Coverage model

The single source of truth is [coverage-matrix.md](coverage-matrix.md): one section per feature
category, one row per feature behavior, each row marked ✅ (covered), 🟡 (partial), or ❌ (gap),
with the covering spec files named inline.

`node scripts/e2e-coverage-check.mjs` keeps the matrix honest:

- **Stale rows** - matrix names a spec file that no longer exists → error.
- **Unmapped specs** - a spec file on disk that no matrix row claims → error. New specs must be
  added to the matrix in the same change; the check makes forgetting impossible.
- **Scoreboard** - per-category ✅/🟡/❌ counts, so "how covered is Git & Changes?" is one command.
  📊 instrument rows (§16) are counted separately and excluded from the percentage - a measurement
  harness asserts no behavior, so scoring it either way would lie about coverage.

The check is pure file analysis (no daemon, no browser, <1s) and **runs in CI's `lint` job** on
every push and pull request. It was hand-run only for one release cycle and drifted in exactly the
predicted way, which is what moved it out of the deferred phase.

The matrix is also what groups the **run report** - the reporter reads its sections to bucket
every test under its module, so the plan document and the run artifacts stay in lockstep. What a
run produces (per-module table of contents, per-test evidence directories, the money-shot digest,
the failure report) and the conventions for money shots and regression specs are in
[reporting.md](reporting.md).


## Module claim ledger and evidence discipline

The coverage matrix is an index of executable specs, not a substitute for a module's completion
argument. Every 0.9 feature charter maintains the associated claim ledger. For every end-user
promise, it records: current classification (**Proven**, **Implemented, not yet proven**,
**Provider or host limited**, **Planned**, or **Out of scope**); code owner; exact T1/T2/T3 or
manual proof; environment and command; principal failure/recovery case; documentation claim; and
release verdict.

Evidence is collected in two passes:

1. **Baseline assertion audit:** turn claims about already-shipped behavior into reproducible
   checks. Code inspection, screenshots, and an internal service are useful evidence but do not
   alone prove a product claim.
2. **End-user acceptance proof:** exercise the complete UI and daemon journey after implementation.
   T1 proves deterministic product plumbing. T2 or controlled live proof is mandatory whenever
   model behavior, a real daemon restart, provider behavior, rendering, or runtime coordination is
   material. Live-model assertions target durable side effects, never generated wording.

A capability becomes release-complete only when its happy path and principal recovery path have
the named passing evidence. Platform-specific claims additionally require the relevant
Electron/native or T3 evidence. An unavailable dependency is a recorded limitation with
remediation, not a green omission; documentation can describe general availability only after the
claim is Proven.

## 0.9 module proof map

This is the executable proof companion to [[release-0-9-product-completion]].
**Existing** means the named check is in the repository; **required** means it is a release
obligation and remains a gap until that check is written and passes. Browser-spec additions are
blocked on moving the live coverage matrix out of the read-only legacy `projects/` tree; do not
edit that source in place.

| Module | Existing deterministic evidence | Required T1 proof | Required controlled/live proof | Release verdict |
| --- | --- | --- | --- | --- |
| [[workflows]] | `packages/server/src/server/orchestration/*.test.ts`; `packages/server/src/server/daemon-e2e/orchestration.e2e.test.ts` | Workflow entry/library, AI dialog, Graph validation, gate/cancel/error browser journey | Local/controlled daemon fan-out, await/gate and output visualizer for AI and Graph | Required, not yet proven |
| [[artifacts]] | `artifact-store.test.ts`, `artifact-data.test.ts`, `artifact-store-resolver.test.ts`, HTML validator regression | Artifact library/open/status/error and update-versus-regenerate browser journey | Generation plus persisted data update proving the design survives | Required, not yet proven |
| [[schedules]] | `schedule-create-flow.spec.ts`, `schedules-edit-model-hydration.spec.ts`, `schedules-project-target.spec.ts`, `schedule-hidden-runs-promote.spec.ts`, `schedule-run-lifecycle.e2e.test.ts` | Workflow/artifact target configuration, missing-target remediation, history and retry UI | One controlled run per target adapter with an auditable result | Existing-agent path proven; 0.9 targets unproven |
| [[kanban]] | GitHub/Jira provider, session and project-target unit tests | Project Settings target, board read/create/link/move/edit/reconcile/error browser journey | GitHub Projects and Jira sandbox/live proof under documented scopes | Required, not yet proven |
| [[project-knowledge-context-management]] | Project Knowledge store/resolver/migration/service tests; Context Management graph/service tests; review-session tests | Knowledge management, roots/records/review/delivery/reference and context-selection browser journey | External edit refresh, pull-on-demand injection and review-retention daemon proof | Required, not yet proven |
| [[connectors]] | Connector OAuth/secret tests and settings catalog/config tests | Every catalog row’s setup, tool enumeration, enablement, scope and transport assertion | Vendor or sandbox proof per row, or explicit external-blocker verdict | Required, ledger not yet proven |
| [[managed-model-server-runtimes]] | Brain manager/ops, app Brain state and runtime-driver/supervisor tests | Brain route/capability/operations/error browser journey | Managed runtime lifecycle, queue/query/log/recovery proof per driver/platform | Required, not yet proven |

### Phase 1 harness boundary

Run `npm run e2e:coverage` after any matrix/spec migration or new browser-spec contribution.
It verifies only that every browser spec is mapped once and every referenced spec exists. It does
not run tests, prove a journey, or change a row to **Proven**.

The next shared-harness change is a deliberate migration, not a local edit: move
`projects/e2e-qa-coverage/coverage-matrix.md` to a non-legacy canonical location and update both
`scripts/e2e-coverage-check.mjs` and `packages/app/e2e/reporters/qa-reporter.ts` atomically.
Only then may new 0.9 browser specs enter the executable matrix. This is recorded as a Phase 1
blocker rather than silently bypassed.


## Running locally

The repo rule "never run the full Playwright suite locally" exists because whole-suite runs
freeze the machine. The unit of local execution is therefore the **category batch** - Playwright
already runs `workers: 1`, so one category at a time is tractable:

```powershell
npm run e2e -- e2e/terminal-*.spec.ts    # one category (filenames grouped per category in the matrix)
npm run e2e                              # T1: every mock spec
npm run e2e:local-ai                     # T2: *.local.spec.ts against LM Studio
npm run e2e:real                         # T3: *.real.spec.ts (paid)
npm run e2e:coverage                     # matrix <-> disk drift check (no daemon, <1s)
npm run e2e:report                       # open Playwright's HTML report from the last run
```

A full sweep should go to a file and be read afterwards, never watched:
`npm run e2e > $env:TEMP\e2e-sweep.txt 2>&1`.

**Browsers install themselves now.** `npm run e2e` runs `browsers:install` as a `pre` hook, so a
missing chromium downloads rather than failing the run. The rule that governs which browser, why
it is not Electron's, and how to read the `Executable doesn't exist at ...` failure lives in
[docs/testing.md](../../docs/testing.md#one-browser-and-which-one).

Phase 1 adds Playwright `@cat:*` tags to every `test.describe`, so category runs become
`--grep @cat:terminal` instead of filename globs, and the coverage check can verify tags too.

## Release validation runbook (target state)

When cutting a release (rides alongside the `release` skill, does not block it yet):

1. **T1 full sweep** - all categories, sequentially, locally overnight or via CI shards. Must be green.
2. **T2 local-AI journeys** - the ~10 core-journey `*.local.spec.ts` specs against LM Studio.
   Requires the qwen model loaded in LM Studio first.
3. **T3 real smoke** - the existing `rewind-flow.*.real.spec.ts` set plus one send/receive smoke
   per provider you actually ship against. Paid; smallest possible set.
4. `node scripts/e2e-coverage-check.mjs` - confirm no unmapped/stale drift entered the release.

## Phases

- **Phase 0 - DONE:** charter, coverage matrix seeded from all existing specs, local-AI tier
  design doc, coverage-check script.
- **Phase 2 - BUILT:** `local-ai` Playwright project + `test:e2e:local-ai`; global-setup
  preflights LM Studio (`/models`) and injects the openai-compat provider (values from the
  repo-root `.env.test`, never committed) into the isolated `OTTO_HOME` when `E2E_LOCAL_AI=1`;
  6 T2 specs written (loop, permissions, max-rounds, compaction, resume, rewind).
- **Phase 3 - BUILT (unvalidated):** 31 new T1 specs across personalities/teams, permissions +
  safe-unattended + wizard, chat/composer, git/changes, settings/visualizer, schedules/runs,
  files/editor. All 🟡 in the matrix until the iron-out pass. Supporting mock-provider
  extensions: synthetic tool-permission scenario, dev-only `dontAsk` mode, prompt-triggered
  suggestion/rate-limit/markdown/tool-call scenarios, structured title responder, no-op
  `applyPersonality`.
- **Phase 3.5 - NEXT: iron-out.** Run batches per [iron-out.md](../README.md#testing--tooling), fix
  selector/timing drift, promote 🟡 → ✅.
- **Phase 1 - organize (partly done):** coverage check **wired into CI** (`lint` job in
  `.github/workflows/ci.yml`, 2026-07-25). Still deferred: `@cat:*` tags on specs, category npm
  scripts, and teaching the check to verify tags too.
- **Phase 4 - remaining gaps:** work down the 24 ❌ rows in priority order (observed subagents,
  artifacts/preview, vision, relay pairing, compact-layout smoke, …); each new feature PR adds
  its matrix row + spec together.

## Out of Playwright-web scope

Electron-only behavior (GPU fallback relaunch, focus-mode caption strip, tray, native menus,
real desktop updates) cannot run in the web harness. These stay on the desktop side:
`docs/browser-capture-harness.md` for screenshot-level checks, plus a short manual checklist in
the release runbook. Native mobile flows belong to Maestro (`docs/mobile-testing.md`), not this
project.

---

## Companion document: coverage-matrix.md

# E2E coverage matrix

One row per feature behavior. **Status:** ✅ covered (validated in CI/local runs) · 🟡 partial
**or implemented-but-not-yet-validated** (every newly written spec starts here until the
iron-out pass promotes it) · ❌ gap · 📊 **instrument** - a measurement harness that asserts no
product behavior, deliberately uncounted in the scoreboard (see §16). **Tier** (for gaps): T1
mock · T2 local-AI · T3 real provider · DT desktop-only (out of Playwright-web scope,
manual/capture-harness). **Pri:** P0 release-blocking journey · P1 shipped feature without
coverage · P2 polish/visual.

Spec paths are relative to `packages/app/e2e/`. Every `*.spec.ts` on disk must be claimed by at
least one row - `node scripts/e2e-coverage-check.mjs` enforces both directions, and CI's `lint`
job runs it on every push and pull request so drift fails the build rather than waiting for
someone to run it by hand.

## 1. Startup, routing & app shell

| Behavior                                                                                                         | Status | Specs / plan                              | Tier | Pri |
| ---------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------- | ---- | --- |
| Cold start with empty state renders sessions screen                                                              | ✅     | `00-sessions-empty.spec.ts`               | T1   | -   |
| Startup loading states, no blank flash                                                                           | ✅     | `startup-loading.spec.ts`                 | T1   | -   |
| Startup wire metrics / connection bring-up                                                                       | ✅     | `startup-wire-metrics.spec.ts`            | T1   | -   |
| Launcher tab behavior                                                                                            | ✅     | `launcher-tab.spec.ts`                    | T1   | -   |
| Route restore / navigation regressions (back, deep links)                                                        | ✅     | `workspace-navigation-regression.spec.ts` | T1   | -   |
| Desktop project picker                                                                                           | ✅     | `project-picker-desktop.spec.ts`          | T1   | -   |
| Bottom sheets reopen cleanly after dismiss                                                                       | ✅     | `bottom-sheet-reopen.spec.ts`             | T1   | -   |
| First-time wizard flow (enters via `/setup`, happy path + Skip, idempotent, `hasCompletedSetupWizard` persisted) | ✅     | `first-time-wizard.spec.ts`               | T1   | -   |
| Compact/mobile layout smoke (viewport 375px: sidebar overlay, tab switcher lists all panes)                      | ❌     | resize viewport per key screen            | T1   | P1  |
| Animations toggle disables page-fade veil (durations 0 when off, no flash on re-enable)                          | ✅     | `appearance-theme-animations.spec.ts`     | T1   | -   |
| Command center lists and opens workspaces                                                                        | 🟡     | `command-center-workspaces.spec.ts`       | T1   | -   |
| Sidebar help entry point                                                                                         | ❌     | no sidebar help menu in Otto              | T1   | P2  |
| Sidebar resize handle (drag, persisted width)                                                                    | ❌     | Otto's own handles carry no testIDs       | T1   | P1  |
| Workspace focus mode (Ctrl+Shift+F chrome collapse)                                                              | 🟡     | `workspace-focus-mode.spec.ts`            | T1   | -   |

## 2. Hosts & connectivity

| Behavior                                                        | Status | Specs / plan                                    | Tier | Pri |
| --------------------------------------------------------------- | ------ | ----------------------------------------------- | ---- | --- |
| Command center host switching                                   | ✅     | `command-center-host.spec.ts`                   | T1   | -   |
| Host settings page                                              | ✅     | `settings-host-page.spec.ts`                    | T1   | -   |
| Sidebar multi-host filtering                                    | ✅     | `sidebar-host-filter-multi.spec.ts`             | T1   | -   |
| Relay pairing (QR / code) - relay already runs in global setup  | ❌     | pair a second client through the wrangler relay | T1   | P1  |
| Daemon restart mid-session → reconnecting toast → full recovery | ✅     | `daemon-reconnect-banner.spec.ts`               | T1   | -   |

## 3. Projects, workspaces & worktrees

| Behavior                                                                                        | Status | Specs / plan                                                           | Tier | Pri |
| ----------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------- | ---- | --- |
| New workspace creation (form, validation)                                                       | ✅     | `new-workspace.spec.ts`, `new-workspace-entry.spec.ts`                 | T1   | -   |
| New workspace provider/model preselect (last-used)                                              | ✅     | `new-workspace-preselect.spec.ts`                                      | T1   | -   |
| New workspace isolation memory                                                                  | ✅     | `new-workspace-isolation-memory.spec.ts`                               | T1   | -   |
| Codex mode preferences on create                                                                | ✅     | `new-workspace-codex-mode-preferences.spec.ts`                         | T1   | -   |
| Workspace lifecycle (create→work→archive)                                                       | ✅     | `workspace-lifecycle.spec.ts`                                          | T1   | -   |
| Multiple workspaces simultaneously                                                              | ✅     | `workspace-multiplicity.spec.ts`                                       | T1   | -   |
| Workspace cwd resolution                                                                        | ✅     | `workspace-cwd.spec.ts`                                                | T1   | -   |
| Occupied-directory guard (second workspace refused, steered to Open it / Create a worktree)     | ❌     | replaces the retired "two workspaces on one directory" row             | T1   | P1  |
| Worktree create + restore                                                                       | ✅     | `worktree-restore.spec.ts`                                             | T1   | -   |
| Worktree restore after daemon restart                                                           | ✅     | `worktree-restore-after-restart.spec.ts`                               | T1   | -   |
| Worktree archive (incl. dirty-tree risk warning)                                                | ✅     | `worktree-archive.spec.ts`, `worktree-archive-risk-warning.spec.ts`    | T1   | -   |
| Archive keyboard shortcut                                                                       | ✅     | `workspace-archive-shortcut.spec.ts`                                   | T1   | -   |
| Empty project persists across restart                                                           | ✅     | `empty-project-persists.spec.ts`                                       | T1   | -   |
| Project settings screen                                                                         | ✅     | `projects-settings.spec.ts`                                            | T1   | -   |
| Sidebar workspace rows (open, state)                                                            | ✅     | `sidebar-workspace.spec.ts`                                            | T1   | -   |
| Sidebar workspace rename                                                                        | ✅     | `sidebar-workspace-rename.spec.ts`                                     | T1   | -   |
| Sidebar context menus                                                                           | ✅     | `sidebar-context-menu.spec.ts`                                         | T1   | -   |
| Workspace pins                                                                                  | ✅     | `workspace-pins.spec.ts`                                               | T1   | -   |
| Pane remount stability                                                                          | ✅     | `workspace-pane-remount.spec.ts`                                       | T1   | -   |
| Open in external editor                                                                         | ✅     | `workspace-open-in-editor.spec.ts`                                     | T1   | -   |
| Workspace setup runtime + streaming                                                             | ✅     | `workspace-setup-runtime.spec.ts`, `workspace-setup-streaming.spec.ts` | T1   | -   |
| Gated multi-root: preview any file, edit gates (unlinked / linked-lifts-live / outside-project) | ✅     | `multi-root-edit-gate.spec.ts`                                         | T1   | -   |
| Per-worktree diff base configuration                                                            | ❌     | pending diff-base project ship                                         | T1   | P2  |
| Add-project flow (form, validation, appears in sidebar)                                         | 🟡     | `project-picker-desktop.spec.ts`, `empty-project-persists.spec.ts`     | T1   | -   |
| Every "New project" entry point reaches the New project page                                    | 🟡     | `open-project-home-regression.spec.ts`                                 | T1   | -   |
| Add project from GitHub (clone + register)                                                      | ❌     | retarget at the New project page's clone path                          | T3   | P2  |
| Directory bootstrap on first project add                                                        | 🟡     | `directory-bootstrap.spec.ts`                                          | T1   | -   |
| New-workspace composer draft survives the create flow                                           | 🟡     | `new-workspace-composer-draft.spec.ts`                                 | T1   | -   |
| New-workspace mode cycling stays safe across providers                                          | 🟡     | `new-workspace-mode-cycle-safety.spec.ts`                              | T1   | -   |
| Sidebar project grouping                                                                        | 🟡     | `sidebar-project-grouping.spec.ts`                                     | T1   | -   |
| Sidebar reorder (drag projects/workspaces)                                                      | 🟡     | `sidebar-reorder.spec.ts`                                              | T1   | -   |
| Workspace pin keyboard shortcut                                                                 | 🟡     | `sidebar-workspace-pin-shortcut.spec.ts`                               | T1   | -   |

## 4. Chat: composer & timeline

| Behavior                                                                           | Status | Specs / plan                                 | Tier | Pri |
| ---------------------------------------------------------------------------------- | ------ | -------------------------------------------- | ---- | --- |
| Composer attachments (files, images)                                               | ✅     | `composer-attachments.spec.ts`               | T1   | -   |
| Composer @-autocomplete                                                            | ✅     | `composer-autocomplete.spec.ts`              | T1   | -   |
| Client slash commands                                                              | ✅     | `client-slash-commands.spec.ts`              | T1   | -   |
| Agent stream rendering (tool calls, text)                                          | ✅     | `agent-stream-ui.spec.ts`                    | T1   | -   |
| Timeline pagination / backfill                                                     | ✅     | `agent-timeline-pagination.spec.ts`          | T1   | -   |
| User message UI contract                                                           | ✅     | `user-message-contract.ui-contract.spec.ts`  | T1   | -   |
| Question prompt pagination (AskUserQuestion-style)                                 | ✅     | `question-prompt-pagination.spec.ts`         | T1   | -   |
| Agent title handoff to tab                                                         | ✅     | `workspace-agent-title-handoff.spec.ts`      | T1   | -   |
| Agent tab rename                                                                   | ✅     | `workspace-agent-tab-rename.spec.ts`         | T1   | -   |
| Fork from assistant message                                                        | ✅     | `assistant-fork-menu.spec.ts`                | T1   | -   |
| Composer ghost-text suggestions (Tab), sent-history Up/Down, ESC clear-then-cancel | ✅     | `composer-suggestions-history.spec.ts`       | T1   | -   |
| Chat auto-title (writer ladder pinned to mock; explicit title never overwritten)   | ✅     | `chat-auto-title.spec.ts`                    | T1   | -   |
| Chat file links open in side pane, never displace chat                             | ✅     | `chat-file-link-side-open.spec.ts`           | T1   | -   |
| Chat markdown rendering (headings, lists, inline code, 12px spacing rhythm)        | ✅     | `chat-markdown-rendering.spec.ts`            | T1   | -   |
| Detached reader position survives an agent turn completing                         | ✅     | `turn-completion-scroll.spec.ts`             | T1   | -   |
| Streaming reveal (typewriter) + live turn token counters                           | ❌     | assert counters tick during mock stream      | T1   | P2  |
| Rate-limit warning strip in composer (allowed/warning/rejected states)             | ✅     | `rate-limit-warning-strip.spec.ts`           | T1   | -   |
| Friendly tool display names (canonical map + MCP humanizer)                        | ✅     | `tool-display-names.spec.ts`                 | T1   | -   |
| Steer queue (queued steering drains at idle)                                       | ❌     | charter not shipped; spec lands with feature | T1   | P2  |
| Add a changed file to the chat composer                                            | 🟡     | `add-changed-file-to-chat.spec.ts`           | T1   | -   |
| Tool-call shimmer while a call is running                                          | 🟡     | `tool-call-shimmer.spec.ts`                  | T1   | -   |

## 5. Agent lifecycle & control

| Behavior                                                                                                     | Status | Specs / plan                                                                                                                                                               | Tier | Pri |
| ------------------------------------------------------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --- |
| Model switch requires/handles restart                                                                        | ✅     | `workspace-model-restart.spec.ts`                                                                                                                                          | T1   | -   |
| Sidebar model display                                                                                        | ✅     | `sidebar-model-b.spec.ts`                                                                                                                                                  | T1   | -   |
| Codex plan approval flow                                                                                     | ✅     | `codex-plan-approval.spec.ts`                                                                                                                                              | T1   | -   |
| Archive tab semantics                                                                                        | ✅     | `archive-tab.spec.ts`                                                                                                                                                      | T1   | -   |
| Subagent detach                                                                                              | ✅     | `subagent-detach.spec.ts`                                                                                                                                                  | T1   | -   |
| Rewind menu UI contract                                                                                      | ✅     | `rewind-menu.ui-contract.spec.ts`                                                                                                                                          | T1   | -   |
| Rewind end-to-end per provider                                                                               | ✅     | `rewind-flow.claude.real.spec.ts`, `rewind-flow.codex.real.spec.ts`, `rewind-flow.opencode.real.spec.ts`, `rewind-flow.pi.real.spec.ts` (+ shared `rewind-flow.shared.ts`) | T3   | -   |
| Session import (OpenCode)                                                                                    | ✅     | `import-session.opencode.real.spec.ts`                                                                                                                                     | T3   | -   |
| Permission prompt approve/deny round-trip (mock synthetic tool permission)                                   | ✅     | `permission-prompt-roundtrip.spec.ts`                                                                                                                                      | T1   | -   |
| Safe unattended: deny-responder answers hidden prompts; a content-less failure archives its hidden workspace | ✅     | `safe-unattended-deny-responder.spec.ts`                                                                                                                                   | T1   | -   |
| Promote-on-error WITH content reveals the failed run's workspace                                             | ❌     | needs a mock scenario that streams content then errors (today's mock can only fail before producing any)                                                                   | T1   | P2  |
| Locked mode badge for unattended/dontAsk agents (Auto→Haiku coercion itself is provider-side, unit-tested)   | ✅     | `auto-mode-haiku-coercion.spec.ts`                                                                                                                                         | T1   | -   |
| Rewind on openai-compat provider (conversation rewind)                                                       | ✅     | `rewind-flow.openai-compat.local.spec.ts`                                                                                                                                  | T2   | -   |
| Observed subagents: read-only track rows appear for provider subagents                                       | ❌     | mock-agent subagent events → rows                                                                                                                                          | T1   | P1  |
| Subagent liveness (elapsed, current tool, tool count)                                                        | ❌     | pending charter ship                                                                                                                                                       | T1   | P2  |
| Archived Codex agent reopens from persistence                                                                | 🟡     | `archived-codex-agent.real.spec.ts`                                                                                                                                        | T3   | -   |
| Provider subagent rows (announce, settle, drill-in)                                                          | 🟡     | `provider-subagents.real.spec.ts`                                                                                                                                          | T3   | -   |
| Viewed-agent timeline retention across navigation                                                            | 🟡     | `viewed-agent-timelines.spec.ts`                                                                                                                                           | T1   | -   |

## 6. Providers & models

| Behavior                                                                                       | Status | Specs / plan                                                        | Tier | Pri |
| ---------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------- | ---- | --- |
| ACP provider catalog                                                                           | ✅     | `acp-provider-catalog.spec.ts`                                      | T1   | -   |
| Provider settings refresh                                                                      | ✅     | `provider-settings-refresh.spec.ts`                                 | T1   | -   |
| Provider usage settings + tooltip                                                              | ✅     | `provider-usage-settings.spec.ts`, `provider-usage-tooltip.spec.ts` | T1   | -   |
| openai-compat live loop: prompt → native tool call → file on disk → change visible             | ✅     | `openai-compat-loop.local.spec.ts`                                  | T2   | -   |
| openai-compat permission gating: Always Ask prompts on write; deny blocks, allow proceeds      | ✅     | `openai-compat-permissions.local.spec.ts`                           | T2   | -   |
| openai-compat compaction (/compact marker; session still completes a follow-up turn)           | ✅     | `openai-compat-compaction.local.spec.ts`                            | T2   | -   |
| openai-compat image attachment reaches model (vision)                                          | ❌     | needs a vision-capable pinned model; design in local-ai-tier.md     | T2   | P1  |
| openai-compat max tool rounds honored (provider config, live rebuild, exact cap message)       | ✅     | `openai-compat-max-rounds.local.spec.ts`                            | T2   | -   |
| openai-compat resume after daemon restart (prompt + tool call replay, on disk and in the chat) | ✅     | `openai-compat-resume.local.spec.ts`                                | T2   | -   |
| Settled action run collapses into one action group (tool row only inside the expanded group)   | 🟡     | asserted incidentally by `openai-compat-resume.local.spec.ts`       | T1   | P2  |
| Custom provider profiles (Z.AI / Qwen / custom binaries) render + validate                     | ❌     | catalog/settings-level assertions, no live calls                    | T1   | P2  |
| Effort selector per-model (effort unification)                                                 | ❌     | model picker shows correct effort levels per catalog                | T1   | P2  |
| Provider removal (settings, disappears from pickers)                                           | 🟡     | `provider-removal.spec.ts`                                          | T1   | -   |

## 7. Personalities & teams

| Behavior                                                                                              | Status | Specs / plan                                | Tier | Pri |
| ----------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------- | ---- | --- |
| Personality CRUD in settings (tabbed editor: name, role, prompt, provider/model)                      | ✅     | `personalities-settings-crud.spec.ts`       | T1   | -   |
| Personality applied on new chat (provider/model/mode/personality stamped on agent)                    | ✅     | `personality-new-chat-apply.spec.ts`        | T1   | -   |
| Personality preserved on new-chat autosubmit (create targets a workspace-free project)                | ✅     | `personality-autosubmit-regression.spec.ts` | T1   | -   |
| Live personality switch on running agent (agent.personality.set)                                      | ✅     | `personality-live-switch.spec.ts`           | T1   | -   |
| Model picker personality section/drill-down (rows exercised; dedicated submenu assertions still open) | ✅     | `personality-new-chat-apply.spec.ts`        | T1   | -   |
| Teams: create via editor, activate, switch, host-scoped activeTeamId                                  | ✅     | `agent-teams-switcher.spec.ts`              | T1   | -   |
| Team prompt stacks before personality prompt on spawn (persisted agent record)                        | ✅     | `agent-teams-prompt-stacking.spec.ts`       | T1   | -   |

## 8. Terminal

| Behavior                                   | Status | Specs / plan                            | Tier | Pri |
| ------------------------------------------ | ------ | --------------------------------------- | ---- | --- |
| Rendering performance pipeline             | ✅     | `terminal-performance.spec.ts`          | T1   | -   |
| Keystroke stress / latency                 | ✅     | `terminal-keystroke-stress.spec.ts`     | T1   | -   |
| Activity indicators (agent hook reporting) | ✅     | `terminal-activity-indicators.spec.ts`  | T1   | -   |
| Alternate screen (TUI apps)                | ✅     | `terminal-alternate-screen.spec.ts`     | T1   | -   |
| Protocol queries (OSC etc.)                | ✅     | `terminal-protocol-query.spec.ts`       | T1   | -   |
| Split + resize                             | ✅     | `terminal-split-resize.spec.ts`         | T1   | -   |
| Terminal tab rename                        | ✅     | `workspace-terminal-tab-rename.spec.ts` | T1   | -   |
| Terminal recovers from a stuck size        | 🟡     | `terminal-stuck-size.spec.ts`           | T1   | -   |

## 9. Files, editor & search

| Behavior                                                                                          | Status | Specs / plan                                                        | Tier | Pri |
| ------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------- | ---- | --- |
| Text editor (CM6): open, edit, save via daemon RPCs                                               | ✅     | `text-editor.spec.ts`                                               | T1   | -   |
| File finder (quick open)                                                                          | ✅     | `file-finder.spec.ts`                                               | T1   | -   |
| Project-wide search                                                                               | ✅     | `project-search.spec.ts`                                            | T1   | -   |
| File explorer collapse behavior                                                                   | ✅     | `file-explorer-collapse.spec.ts`                                    | T1   | -   |
| Scripts menu resize behavior                                                                      | ✅     | `workspace-scripts-menu-resize.spec.ts`                             | T1   | -   |
| Unified file tab mode bar (editor/split/preview surfaces + per-file mode memory across reopen)    | ✅     | `file-tab-mode-bar.spec.ts`                                         | T1   | -   |
| Formatted axis on the mode bar (markers hide/show, inert in preview, live in split, non-markdown) | ✅     | `file-tab-mode-bar.spec.ts`                                         | T1   | -   |
| Editor dirty guard (dot, no-autosave, confirm-on-close, second-file open, buffer survives switch) | ✅     | `editor-dirty-guard.spec.ts`                                        | T1   | -   |
| Markdown image paste/drop (writes under `assets/`, inserts a relative link, never clobbers)       | 🟡     | `markdown-image-drop.spec.ts`                                       | T1   | -   |
| File rendering: mermaid/images/CSV in preview mode                                                | ❌     | mermaid, AsciiDoc and relative images shipped; add per-format smoke | T1   | P2  |
| AI Refactor flow (real agent behind selection refactor)                                           | ❌     | good T2 candidate - deterministic small refactor                    | T2   | P2  |
| Assistant file link opens at its referenced line (`path:line`, re-applied on an open tab)         | ✅     | `file-editing.spec.ts`                                              | T1   | -   |
| BOM / CRLF preservation on save (no `lineSeparator` handling outside the dead `src/file-pane/`)   | ❌     | `file-editing.spec.ts` (skipped, ready once the capability exists)  | T1   | P2  |

## 10. Git & Changes

| Behavior                                                                                      | Status | Specs / plan                                | Tier | Pri |
| --------------------------------------------------------------------------------------------- | ------ | ------------------------------------------- | ---- | --- |
| Changes tab commit flow                                                                       | ✅     | `changes-commit.spec.ts`                    | T1   | -   |
| Branch switcher                                                                               | ✅     | `branch-switcher.spec.ts`                   | T1   | -   |
| PR pane (GitHub fixtures: `helpers/github-fixtures.ts`)                                       | ✅     | `pr-pane.spec.ts`                           | T1   | -   |
| Diff row alignment                                                                            | ✅     | `diff-row-alignment.spec.ts`                | T1   | -   |
| Git Log tab (daemon git _operation_ log records a UI commit's message + hash)                 | ✅     | `git-log-tab.spec.ts`                       | T1   | -   |
| Rollback file (git discard w/ confirm; cancel keeps changes)                                  | ✅     | `changes-rollback-file.spec.ts`             | T1   | -   |
| Commit CTA writer-agent confirm dialog (spawn not assertable: writer is an internal agent)    | ✅     | `changes-commit-agent-cta.spec.ts`          | T1   | -   |
| Push CTA reconcile: CTA returns after commit → re-dirty (CI-green; Windows-local EPERM noise) | 🟡     | `git-cta-push-reconcile.spec.ts`            | T1   | P1  |
| Bitbucket Cloud forge parity (PR pane against Bitbucket fixtures)                             | ❌     | mirror `pr-pane` with Bitbucket fixture set | T1   | P2  |
| Commit diff panel (open a commit, render its diff)                                            | 🟡     | `commit-diff-panel.spec.ts`                 | T1   | -   |

## 11. Settings & i18n

| Behavior                                                                                 | Status | Specs / plan                                              | Tier | Pri |
| ---------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------- | ---- | --- |
| Settings navigation                                                                      | ✅     | `settings-navigation.spec.ts`                             | T1   | -   |
| Settings sidebar scroll                                                                  | ✅     | `settings-sidebar-scroll.spec.ts`                         | T1   | -   |
| Settings i18n (all locales render)                                                       | ✅     | `settings-i18n.spec.ts`                                   | T1   | -   |
| Toggle/tab state regression                                                              | ✅     | `settings-toggle-tab-regression.spec.ts`                  | T1   | -   |
| Appearance: theme switch persists + token-level repaint                                  | ✅     | `appearance-theme-animations.spec.ts`                     | T1   | -   |
| Speech settings cards (engine, voice; no downloads triggered)                            | ❌     | assert UI only - global setup already disables speech env | T1   | P2  |
| Visualizer settings section (enable switch + dependent rows; GPU re-enable button is DT) | ✅     | `feature-flag-visualizer-gate.spec.ts`                    | T1   | -   |
| Feature-flag registry: disabling Visualizer removes surfaces + reaps open tabs           | ✅     | `feature-flag-visualizer-gate.spec.ts`                    | T1   | -   |
| Activity stats start-screen setting                                                      | ❌     | toggle + start screen presence                            | T1   | P2  |

## 11a. Brain

The page is a top-level route outside workspaces (`/brain`), reached from the Brain icon in the
bottom-left rail. See [docs/brain.md](../../docs/brain.md). Everything here is T1: the daemon's brain
manager and the brain itself are both mockable at the RPC boundary, and no row needs a real GPU.

| Behavior                                                                                         | Status | Specs / plan                                                                      | Tier | Pri |
| ------------------------------------------------------------------------------------------------ | ------ | --------------------------------------------------------------------------------- | ---- | --- |
| Brain rail icon navigates to `/brain`, and the page keeps app chrome (both router registrations) | ❌     | click `sidebar-brain`, assert `/brain` + sidebar still mounted                    | T1   | P1  |
| Rail marks Brain on `/brain` but Settings on `/settings/hosts/<id>/brain`                        | ✅     | `src/components/sidebar/sidebar-footer-nav.test.ts` (unit, not Playwright)        | T1   | -   |
| Page hidden without `features.brainConsole`; tabs gated per `status.capabilities`                | ❌     | serve a status with capabilities false, assert the "update the brain" copy        | T1   | P1  |
| Overview renders status, VRAM and resource tiles; lifecycle buttons disabled by phase            | ❌     | seed a running status with `resources`, assert tiles + Start disabled             | T1   | P1  |
| Models table lists installed models, benchmarked first; selecting one opens the detail panel     | ❌     | seed inventory, assert row order and `brain-model-*` detail                       | T1   | P1  |
| Profile editor renders the brain's field descriptors, and is read-only when `writable` is false  | ❌     | seed `writable: false`, assert no Save and dimmed controls                        | T1   | P1  |
| Editing a field re-prices the budget without saving; Save reports what the brain clamped         | ❌     | change context, assert budget call fired and Save surfaces `adjustments`          | T1   | P1  |
| A profile that cannot start (quantised V cache, flash attention off) shows the blocking warning  | ❌     | seed that combination, assert the error alert                                     | T1   | P1  |
| Delete confirms, and is refused while the model is loaded                                        | ❌     | assert `confirmDialog` and the disabled Delete on a loaded row                    | T1   | P1  |
| Library shows the remote-brain notice instead of downloads when `brain.mode` is remote           | ❌     | set mode remote, assert the notice and no catalog                                 | T1   | P2  |
| Benchmarks leaderboard and variance table render; Run is disabled while a bench job runs         | ❌     | seed evals + a running bench job                                                  | T1   | P2  |
| Logs tail renders and stops following once scrolled up                                           | ❌     | seed lines, scroll, assert "Jump to latest" appears                               | T1   | P2  |
| Settings → Host → Brain keeps connection/security/lifecycle and links out to the page            | ❌     | assert no Models/Operations cards, and `host-brain-open-console-button` navigates | T1   | P1  |

## 11b. Project knowledge

The Markdown store, project/reference metadata, summary calculations, and prompt-discovery
invariants have unit coverage. Browser-level management workflows remain explicit gaps here.

| Behavior                                                                         | Status | Specs / plan                                                    | Tier | Pri |
| -------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------- | ---- | --- |
| Manage knowledge opens and lists six roots plus atomic pages                     | ❌     | seed daemon store, open workspace menu, assert roots and pages  | T1   | P1  |
| Rich Markdown, wiki links, and complete timeline render in the page reader       | ❌     | seed rich page, assert rendered structures and timeline         | T1   | P1  |
| Root page editing saves through the daemon and survives reload                   | ❌     | edit architecture root, reload, assert rich body                | T1   | P1  |
| Proposed and superseded pages stay out of ordinary agent discovery and retrieval | ❌     | daemon integration assertion plus visible review filters        | T1   | P1  |
| Projects mode separates review state from delivery and reports progress metrics  | ❌     | create charter, update delivery, assert counts and percentage   | T1   | P1  |
| References mode records source URL plus adopted or rejected evaluation           | ❌     | create reference, update evaluation, reload and assert timeline | T1   | P1  |

## 12. Schedules & runs

| Behavior                                                                                              | Status | Specs / plan                             | Tier | Pri |
| ----------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------- | ---- | --- |
| Schedule edit form model hydration                                                                    | ✅     | `schedules-edit-model-hydration.spec.ts` | T1   | -   |
| Schedule project targeting                                                                            | ✅     | `schedules-project-target.spec.ts`       | T1   | -   |
| Schedule create full flow (form → daemon record → card → delete)                                      | ✅     | `schedule-create-flow.spec.ts`           | T1   | -   |
| Runs screen: run card renders, Visualize opens run-scoped tab                                         | ✅     | `runs-screen.spec.ts`                    | T1   | -   |
| Hidden schedule runs: healthy stays hidden, content-less failure archived, kept success revealed live | ✅     | `schedule-hidden-runs-promote.spec.ts`   | T1   | -   |
| Suggested tasks chips (spawn_task → chip → session)                                                   | ❌     | seed chip, click, assert session created | T1   | P2  |

## 13. Visualizer

| Behavior                                                                               | Status | Specs / plan                                                                | Tier | Pri |
| -------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------- | ---- | --- |
| Visualizer tab opens, guest iframe boots (ready handshake → session mirror; no pixels) | ✅     | `visualizer-open-boot.spec.ts`                                              | T1   | -   |
| Session lifecycle: new agent appears in mirror; archive removes a tab-less session     | ✅     | `visualizer-session-lifecycle.spec.ts`                                      | T1   | -   |
| New-chat redirect: draft never lands in Visualizer pane                                | ✅     | `visualizer-new-chat-redirect.spec.ts`                                      | T1   | -   |
| Toolbar render (boot spec) - actions + detail card content still untested              | ✅     | `visualizer-open-boot.spec.ts`                                              | T1   | -   |
| Discovery cards + context-composition ring populated                                   | ❌     | in-guest state; needs a host-observable seam                                | T1   | P2  |
| Node-graph internals (spawn/complete inside canvas)                                    | ❌     | inside sandboxed vendor iframe; no host-DOM projection (descoped by design) | -    | P2  |

## 14. Artifacts, preview & browser pane

| Behavior                                                         | Status | Specs / plan                                                                   | Tier  | Pri |
| ---------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------ | ----- | --- |
| Artifact produced by agent renders in artifact surface           | ❌     | mock-agent emits artifact → pane renders                                       | T1    | P1  |
| Preview: launch.json dev server starts, tab binds, logs readable | ❌     | daemon-level preview RPCs + web browser-pane fallback; full webview flow is DT | T1/DT | P1  |
| Browser-tools guardrails (tab binding enforced by daemon)        | ❌     | RPC-level assertions in server E2E (vitest `*.e2e.test.ts`), not Playwright    | -     | P2  |

## 15. Desktop-only (manual / capture harness - not Playwright-web)

| Behavior                                                  | Status | Specs / plan                      | Tier | Pri |
| --------------------------------------------------------- | ------ | --------------------------------- | ---- | --- |
| Desktop update flow UI (mocked feed)                      | ✅     | `desktop-updates.spec.ts`         | T1   | -   |
| GPU fallback auto-relaunch + re-enable button             | ❌     | manual checklist item             | DT   | P2  |
| Focus mode caption strip (Ctrl+Shift+F)                   | ❌     | manual checklist item             | DT   | P2  |
| Electron webview browser pane (real preview verification) | ❌     | `docs/browser-capture-harness.md` | DT   | P2  |

## 16. Performance instruments (measurement, not coverage)

**Not feature coverage.** The specs below exist to _produce numbers_, not to assert product
behavior - their only hard assertions are that the instrument itself produced a usable series.
They carry 📊 rather than ✅/🟡/❌ precisely so the scoreboard stays honest: ✅ would inflate
coverage with a spec that never proved a user-facing behavior, and ❌ would read as a gap
someone is supposed to close. Sections 1–15 answer "is this behavior tested?"; this one answers
"what do we have to measure with?".

Each is opt-in behind an environment variable because it is slow by construction, so a normal
run skips it and it appears as ⊘ in the run report. Read the numbers with the traps documented
alongside the instrument - a soak series is easy to misread, and has produced two wrong
diagnoses already.

| Instrument                                                          | Status | Specs / plan                                                                                                                                          | Tier | Pri |
| ------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --- |
| Client resource retention across repeated chat + navigation cycles  | 📊     | `client-resource-soak.spec.ts` - `OTTO_RESOURCE_SOAK_E2E=1`; method and traps in `docs/client-performance.md`                                         | T1   | -   |
| Cost of moving around a heavy install (long chats, many workspaces) | 📊     | `perf-corpus-soak.spec.ts` - `OTTO_CORPUS_SOAK_E2E=1`; seeds a synthetic conversation corpus, then times chat opens and workspace switches against it | T1   | -   |

**Known inconsistency, left as a separate call:** the two terminal perf specs in §8
(terminal-performance, terminal-keystroke-stress) are the same shape - opt-in instruments behind
`OTTO_TERMINAL_PERF_E2E=1` - but sit there marked ✅, so §8's "100% covered" counts two specs
that never run in CI. Moving them here would be the consistent thing; it also drops §8's ✅ count
and re-buckets them in every future run report, so it is recorded rather than done silently.
Their names are deliberately **not** backticked above: a backticked spec name anywhere in this
file counts as a matrix claim, and a second claim in prose would keep the drift check green if
the real §8 row were ever deleted.

---

## Companion document: local-ai-tier.md

# Tier 2: local-AI live-agent tests (`*.local.spec.ts`)

Live agent-loop coverage without API spend. The E2E daemon's openai-compat provider points at
the user's LM Studio instance (qwen3.6-27b-mtp), so specs exercise the **real** daemon-owned
tool loop - native tool injection, permission gating, compaction, rewind - with real inference.

## Why this tier exists

The mock agent (T1) proves the UI and daemon plumbing but scripts every agent event, so it can
never prove the loop itself: that a prompt actually becomes tool calls, that tool results feed
back correctly, that compaction preserves a usable session, that a permission denial actually
stops the tool. The paid tier (T3) proves that but costs money per run. A local model is the
missing middle: free, private, and - for the openai-compat provider specifically - it _is_ the
production code path, not a stand-in.

## Connection

Never hardcode endpoint or key in specs or docs. Values live in the **repo-root `.env.test`**
(gitignored; this is the file the app harness's global setup loads), read by global setup:

```
E2E_LOCAL_AI_BASE_URL=<LM Studio /v1 endpoint>      # current setup: Tailscale host, port 1235
E2E_LOCAL_AI_API_KEY=<LM Studio key>
E2E_LOCAL_AI_MODEL=qwen3.6-27b-mtp@q4_k_m           # pin one quant; do not "latest"
```

The user's dev `OTTO_HOME` (`packages/desktop/.dev/otto-home/config.json`) already carries a
working openai-compatible provider block - copy its values into `.env.test` once.

## Harness integration (Phase 2)

1. **Global setup:** when `E2E_LOCAL_AI=1` and all three env vars are present, write the
   openai-compatible provider block (env: `OPENAI_BASE_URL`, `OPENAI_API_KEY`) into the forked
   `OTTO_HOME`'s `config.json` after `forkOttoHomeMetadata()` runs. When absent, skip silently -
   T2 specs then fail fast with a clear "local AI not configured" error (no conditional skips
   inside specs; the tier is selected by Playwright project, mirroring how `real-provider` works).
2. **Playwright project:** add a `local-ai` project with `testMatch: ["**/*.local.spec.ts"]` and
   `testIgnore` it from the default project, exactly like `real-provider`.
3. **npm script:** `test:e2e:local-ai --workspace=@otto-code/app`.
4. **Preflight:** global setup pings `GET {baseUrl}/models` and asserts the pinned model is in
   the list - catches "LM Studio not running / model not loaded" in seconds instead of a
   60s spec timeout. (LM Studio JIT-loads on first completion; the preflight also warms it.)

## Writing T2 specs that don't flake

A 27B local model is smart enough to follow one concrete instruction, not smart enough for
multi-step ambiguity. Rules:

- **One imperative, one observable side effect.** "Create a file named `EXACTLY.txt` containing
  exactly `hello-e2e` and nothing else. Do not explain." Then assert the file row appears in
  Changes and the content matches via the daemon - never assert on chat prose.
- **Cap the blast radius.** Low max-tool-rounds for the spec's agent; temp workspace dir;
  60–120s generous timeouts (local inference is slow; MTP helps but budget for it).
- **Retries are legitimate here.** Unlike T1, one retry on a T2 spec is honest - inference is
  nondeterministic. Keep `retries: 1` on the `local-ai` project only.
- **Assert loop mechanics, not intelligence.** Good targets: a tool call row rendered, a
  permission prompt appeared and denial stopped execution, compaction event emitted and the
  session still answers, rewind truncates the timeline. Bad targets: summary quality, wording,
  multi-file refactors.

## Planned specs (build order)

| Spec                                      | Proves                                                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `openai-compat-loop.local.spec.ts`        | Flagship: prompt → native tool call → file created → diff visible in Changes                                     |
| `openai-compat-permissions.local.spec.ts` | Gated tool prompts; deny stops the tool; dontAsk + deny-responder path                                           |
| `openai-compat-max-rounds.local.spec.ts`  | Configured round cap halts the loop with the cap message                                                         |
| `openai-compat-compaction.local.spec.ts`  | /compact emits compaction, session usable after                                                                  |
| `openai-compat-resume.local.spec.ts`      | Daemon restart mid-session; history fidelity (tool calls + reasoning replayed)                                   |
| `rewind-flow.openai-compat.local.spec.ts` | Reuse `rewind-flow.shared.ts` against the local model                                                            |
| `openai-compat-vision.local.spec.ts`      | Image attachment reaches the model (only if the loaded model has vision; otherwise pin a vision-capable sibling) |

## Resolved decisions

- **Quant pinned:** `qwen3.6-27b-mtp@q4_k_m` (faster; change `E2E_LOCAL_AI_MODEL` in `.env.test`
  to swap).
- **Availability:** LM Studio is an always-on server in this setup, so the runbook needs no
  "start LM Studio" step; the global-setup preflight still fails fast if it's ever down.

## Status

Phase 2 infra is BUILT: `local-ai` Playwright project (240s project timeout, 1 retry, its own
`outputDir`), global-setup preflight + provider injection (`maxToolRounds: 25`),
`test:e2e:local-ai` npm script, `helpers/local-ai.ts`, repo-root `.env.test` populated.

**6/6 written specs are green** (2026-07-24). The whole batch runs in ~1.2 min of specs on a
warm model, on top of the ~2 min global-setup cold start. Only the vision spec is unwritten -
it waits on a vision-capable pinned model. Iron-out details in `iron-out.md`.

Two gotchas that cost the most time, worth knowing before touching this tier:

- **Never share `test-results/` with another Playwright run.** Playwright wipes a test's output
  dir as the test starts, so a concurrent run deletes your in-flight trace and the failure is
  reported as `ENOENT ... trace.zip` rather than the real assertion. Projects now each own an
  `outputDir`; pass `E2E_OUTPUT_DIR` (outside `packages/app`) when two agents run the same
  project.
- **A settled tool call may not render as `tool-call-badge`.** On a freshly loaded chat every
  action is settled, and a run of 2+ settled actions (e.g. a reasoning block plus the tool call
  a thinking model emits) collapses into one `action-group-badge`; the tool row only exists
  inside the expanded group. Assert on either shape - see `openai-compat-resume.local.spec.ts`.

---

## Companion document: reporting.md

# QA reporting & evidence

How a human validates that the e2e suite actually works - not just that it exits 0.

The suite produces four artifacts on every run. Three of them are generated; none
are committed (`e2e-report/` and `playwright-report/` are gitignored, regenerated
from scratch each run so a stale money shot can never be mistaken for proof).

## What a run produces

```
packages/app/
  e2e-report/
    index.md                      ← table of contents, per module
    failures.md                   ← every failure, with error + link to evidence
    run.log                       ← full chronological log (errors + test stdio)
    money-shots/
      index.md                    ← the digest: one confirming frame per test
      <module-slug>/<spec>__<test>.png
    modules/
      <module-slug>/<spec>/<test-slug>/
        result.md                 ← status, duration, evidence index
        01-…png 02-…png           ← every screenshot, in capture order
        stdio.log
  playwright-report/              ← Playwright's own HTML report (traces, videos)
```

- **`index.md`** - run verdict, a per-module scoreboard table, then every spec and
  test grouped under its module, each linking to its own evidence directory.
- **`money-shots/index.md`** - the digest, images inlined. Scroll it to eyeball the
  entire suite in one pass. This is the answer to "do these tests even work?"
- **`failures.md`** - the failure report. Summary table first, then one section per
  failure with the error text and a link to that test's evidence.
- **`run.log`** - flat text, greppable, everything in order.
- **`playwright-report/`** - traces, videos, step timelines. `npm run e2e:report`.

Both report roots are overridable so concurrent runs don't overwrite each other mid-write:
`E2E_REPORT_DIR` for the QA report, `E2E_HTML_REPORT_DIR` for Playwright's. The tier scripts
already set them (`e2e-report-local-ai/`, `e2e-report-real/`, and the matching
`playwright-report-*`), so a T2/T3 run never clobbers the T1 report. Trace/video/screenshot
artifacts are separated a level lower - each Playwright project owns an `outputDir` under
`test-results/<project>` (or under `E2E_OUTPUT_DIR`, which you should point outside
`packages/app`; see the Run mechanics section of [iron-out.md](../README.md#testing--tooling)).

Module grouping is derived from [`coverage-matrix.md`](coverage-matrix.md): the
reporter reads its `## <n>. <Title>` sections and the backtick-quoted spec names
inside them. The matrix stays the single source of truth for what belongs where,
and `npm run e2e:coverage` already enforces that every spec on disk is claimed by
exactly one section. **A spec showing up under "Unclassified" in the report means
the matrix drifted** - fix the matrix, not the reporter.

## Money shots

A passing test that leaves no visual trace is unauditable. Every test therefore
ships one frame that confirms its claim.

```ts
import { moneyShot, qaShot } from "./helpers/evidence";

await qaShot(page, "changes tab open with one modified file"); // optional context
await moneyShot(page, "the commit lands and the file leaves the changes list");
```

- `moneyShot(page, claim)` - **the** confirming frame. `claim` is rendered as the
  caption in the digest, so write it as the assertion in plain English, not as a
  step name. One per test is the norm.
- `qaShot(page, label)` - intermediate frames. Kept with the test's own evidence,
  not promoted into the digest.

**Every passing test gets a money shot whether or not it asks for one.** The auto
fixture in `e2e/fixtures.ts` captures the final frame of any passing test that
never called `moneyShot`, labelled `final frame (auto)`. That guarantees 100%
digest coverage from day one, but the auto frame is captured at teardown - often
after the interesting state is gone. Treat `final frame (auto)` in the digest as a
TODO: it means that test's proof hasn't been curated yet.

Capture never fails a test: if the page is already closed, the screenshot is
skipped silently.

## Adding coverage

Adding a spec is three steps, and the checker enforces the middle one:

1. Write the spec in `packages/app/e2e/`, importing `test`/`expect` from
   `./fixtures` (never from `@playwright/test` - the auto fixture is what seeds
   the daemon host; without it the app sits on the pairing screen).
2. Add a row to the right `##` section of `coverage-matrix.md`. New specs start at
   🟡 (implemented, not yet validated) and are promoted to ✅ once a real run
   passes them.
3. Call `moneyShot()` at the moment the behavior is proven.

Then `npm run e2e:coverage` to confirm the matrix and disk agree.

## Regression tests for fixed bugs

Every bug we fix should leave a test behind, and the test should say which bug it
guards. The convention:

- **Name it after the behavior, suffixed `-regression`** -
  `personality-autosubmit-regression.spec.ts`, not `bug-1234.spec.ts`. The suffix
  makes the regression set greppable; the behavior name keeps it readable when the
  original bug is long forgotten.
- **Head the spec with a docblock stating the bug, the symptom, and the fix**, so
  the next person knows what breaking this test actually means. Symptom first -
  "the composer dropped the selected personality when a new chat auto-submitted"
  is a maintainable test; "regression for #482" is not.
- **Assert the symptom, not the implementation.** The fix will be refactored; the
  symptom is what must never come back.
- **Row goes in the module the bug lived in**, not a separate regressions section -
  a personality bug is personality coverage. The matrix stays organized by feature,
  which is how you read it when asking "what does this module guarantee?"
- **`moneyShot()` the frame showing the symptom is absent.** That frame is the
  durable record that the bug is fixed.

Bugs found _by_ the suite during an iron-out pass are recorded in
[`iron-out.md`](../README.md#testing--tooling) with their diagnosis; once fixed, they graduate into a
regression spec by the rules above.
## Managed Brain runtime proof obligations

[[managed-model-server-runtimes]] adds a driver/platform evidence matrix to the release-quality program. This charter owns the test-tier rule and coverage reporting; the managed-runtimes charter owns driver contract details and the product support matrix.

### Required coverage rows

The live coverage matrix must gain rows when executable specs land, covering:

| Behavior | Required tier |
| --- | --- |
| Capability-gated Brain entry, unavailable state and driver-native controls | T1 |
| Host lifecycle, status/log recovery, model load/unload/switch, queue/busy state and actionable error surface | T1 |
| Protocol compatibility and centralized upgrade boundary for runtime-aware additions | T1 |
| Managed bundle compatibility, component lifecycle and failure recovery | T1 |
| Remote-host read/write authorization, certificate trust/pinning and restart authority | T1, plus T3 when advertised |
| Otto agent tool-loop side effect through a managed runtime | T2 |
| Real runtime install/verify, model readiness, lifecycle/crash recovery and benchmark provenance for a claimed platform row | T2 or T3 according to hardware availability |
| Native-only OS/accelerator checks | T3 or desktop/manual release evidence, never silently excluded |

### Evidence discipline

A browser mock can prove the shared user journey but cannot prove a runtime, accelerator, TLS boundary or model server. T1 tests must therefore be paired with the managed-runtimes semantic host/driver tests; T2/T3 prove the actual engine and hardware. Assertions on live models use deterministic side effects, not generated prose.

The coverage matrix records only executable coverage. The runtime support matrix records the companion hardware/provenance verdict. A release may advertise a runtime/platform tuple only when both records point to passing evidence. A missing native proof is an explicit unsupported or planned matrix cell, not a partially covered claim.

## Timeline

- time: "2026-08-08T06:17:54.313Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-08T06:17:54.313Z"
  kind: "evidence"
  summary: "Migrated from `projects/e2e-qa-coverage/e2e-qa-coverage.md` and the legacy `projects/README.md` ledger. Legacy status: Partial. Ledger summary: Full-app Playwright QA across 3 tiers. T1 and T2 green; Phase 3.5 iron-out and the ❌ rows remain. Tier design folded into [docs/testing.md](../docs/testing.md). **[coverage-matrix.md](e2e-qa-coverage/coverage-matrix.md) is live tooling, not a plan** - `scripts/e2e-coverage-check.mjs` and the QA reporter read it at runtime, so this folder cannot drain"
- time: "2026-08-08T06:19:46.351Z"
  kind: "note"
  summary: "Migrated from the repository's existing authoritative project or reference documentation at the user's request. New status: confirmed."
- time: "2026-08-08T06:37:07.203Z"
  kind: "decision"
  summary: "Re-synchronized the retained legacy migration source before its final retirement."
- time: "2026-08-12T23:43:59.082Z"
  kind: "evidence"
  summary: "2026-08-12 cleanup verification: the active file route is the unified FileTabPane/CodeEditor path; the former packages/app/src/file-pane implementation is unmounted and has been removed. The active editor/daemon path preserves CRLF line endings on save; BOM preservation remains an explicit skipped coverage gap in file-editing.spec.ts. The duplicate skipped dirty-draft/conflict test was removed because editor-dirty-guard.spec.ts already covers the live dirty-close behavior."
  source: "packages/app/src/editor/editor-core.ts; packages/app/src/editor/editor-buffer-state.ts; packages/server/src/server/session/files/workspace-files-session.ts; pac"
  affects: ["vim-neovim-developer-workflows"]
- time: "2026-08-12T23:56:06.847Z"
  kind: "evidence"
  summary: "Follow-up correction, 2026-08-12: the former packages/app/src/file-pane/ tree was restored as an unmounted Paseo reference/merge surface. It is intentionally retained for future upstream comparison and porting; the active app graph still uses FileTabPane/CodeEditor. Only the redundant skipped dirty-draft/conflict E2E was removed."
  source: "packages/app/src/file-pane/; packages/app/e2e/file-editing.spec.ts"
  affects: ["vim-neovim-developer-workflows"]
- time: "2026-08-27T02:07:21.412Z"
  kind: "decision"
  summary: "User requested the managed-runtime testing insights be reflected in the release QA charter without treating planned test coverage as executable coverage."
  affects: ["managed-model-server-runtimes"]
- time: "2026-08-27T02:08:57.474Z"
  kind: "decision"
  summary: "User requested every module charter use a traceable current-state assertion audit and end-user acceptance evidence model rather than treating test existence as completion."
  source: "User direction, 2026-08-26; [[release-0-9-product-completion]] completion contract; docs/testing.md."
  affects: ["release-0-9-product-completion","workflows","artifacts","schedules","kanban","project-knowledge-context-management","connectors","managed-model-server-runtimes"]
- time: "2026-08-27T02:15:43.606Z"
  kind: "decision"
  summary: "Phase 1 added the 0.9 module proof map, separating existing deterministic checks from required T1, controlled-local and provider/live evidence, and recording the legacy coverage-matrix migration boundary."
  source: "Phase 1 release-completion audit, 2026-08-27"
  affects: ["release-0-9-product-completion","workflows","artifacts","schedules","kanban","project-knowledge-context-management","connectors","managed-model-server-runtimes"]
- time: "2026-08-28T23:40:58.252Z"
  kind: "evidence"
  summary: "Workflows validation baseline gained a deterministic daemon integration proof using the existing FakeAgentClient's opt-in exact-response callback. It verifies an ordered structured-data hand-off in the Brief → Decision Graph without provider credentials or token spend. It is not app browser E2E coverage and does not change the Workflow UI coverage verdict."
  source: "Verified locally on 2026-08-28: focused server orchestration integration test passed; targeted lint and server typecheck passed."
  affects: ["workflows"]
- time: "2026-08-28T23:50:59.372Z"
  kind: "evidence"
  summary: "Workflows deterministic daemon coverage now includes an explicitly failed fake worker followed by a bounded Graph retry and structured downstream recovery. This remains non-browser integration evidence; it does not change the UI E2E coverage verdict."
  source: "Verified locally on 2026-08-28: focused server orchestration integration proof (2 passed, 10 skipped); targeted lint and server typecheck passed."
  affects: ["workflows"]
- time: "2026-08-29T18:55:53.288Z"
  kind: "evidence"
  summary: "Workflow E2E coverage remains truthfully T1 in `projects/e2e-qa-coverage/coverage-matrix.md`: the row maps `graph-workflow-authoring.spec.ts` and `runs-screen.spec.ts` to browser proof of Graph authoring/lifecycle and AI planning/lifecycle. `npm run e2e:coverage` passed after documentation reconciliation, reporting all 194 browser specs claimed. Separately, the non-Playwright `npm run live:orchestration -- --bootstrap-sonnet ...` harness proved the controlled real-provider AI declaration and `fanOut: 2` managed-worker boundary with Claude Sonnet 5 at low effort. It is release evidence, not a claim that the browser matrix has a T3 spec or that every provider is proven."
  source: "2026-08-29 Workflow coverage and controlled provider proof"
  affects: ["workflows","release-0-9-product-completion"]
- time: "2026-08-29T23:19:27.203Z"
  kind: "evidence"
  summary: "Coverage correction for Artifacts: `packages/app/e2e/browser/artifact-preview-security.spec.ts` exists but its asserted Chromium run was not performed by the Artifact audit and is not evidence in this correction. Any active or migrated coverage projection that marks the Artifact preview-security row ✅ is superseded by this record: classify it as 🟡 implemented-but-not-yet-validated / T1 pending until the exact targeted Playwright command passes in an isolated daemon/browser environment and leaves its result. Do not infer Electron, native, CLI E2E, or live-provider proof from that browser spec. The same audit executed only deterministic server T1 (11 files / 68 tests passed) and found the focused CLI surface suite not clean because `cli-surface.test.ts` expects `--project <project>` while the implemented command declares `--project <root>`. The legacy `projects/e2e-qa-coverage/coverage-matrix.md` was deliberately not edited: matrix migration and canonical ownership remain this charter's work."
  source: "Artifact proof-ledger correction, 2026-08-29"
  affects: ["artifacts","release-0-9-product-completion"]
- time: "2026-08-29T23:19:29.379Z"
  kind: "note"
  summary: "Artifact coverage correction: the Artifact preview-security row must remain partial until its targeted Playwright run is recorded. Deterministic daemon T1 does not substitute for browser, Electron, CLI E2E, or provider proof."
  affects: ["e2e-qa-coverage"]
- time: "2026-08-29T23:39:28.727Z"
  kind: "evidence"
  summary: "Artifacts has one passing non-browser real-platform proof: `OTTO_DESKTOP_E2E_ARTIFACT_ONLY=1 npm run test:e2e:browser-tabs --workspace=@otto-code/desktop`. It launches the actual Electron app with an isolated daemon and verifies a private `otto-artifact-preview` WebView guest against hostile canonical-CSP HTML: interactivity works; network, popup, navigation, and host-global escape attempts are blocked; the loopback probe observes zero requests. The canonical matrix migration still prohibits adding or counting an app Playwright Artifact spec while the live matrix remains in read-only `projects/`; native WebView proof is also outstanding."
  source: "Focused real Electron Artifact preview smoke, 2026-08-29"
  affects: ["artifacts"]
- time: "2026-08-30T01:06:15.983Z"
  kind: "evidence"
  summary: "Workflow browser evidence remains partial. Exact command attempted: `npm --workspace=@otto-code/app run test:e2e -- e2e/browser/runs-screen.spec.ts`. First isolated Chromium execution: 3/4 passed (persisted Graph card/Visualizer, Graph restart failure, pending AI restart failure); the fourth exposed an obsolete provider-failure expectation after AI declared plans began pausing for daemon-owned start confirmation. After the test was corrected to approve that confirmation, the required exact rerun timed out in Metro warmup before Playwright began. `graph-workflow-authoring.spec.ts` has not been rerun for Fable 5. `npm run e2e:coverage` is intentionally not counted as browser execution proof."
  source: "Focused isolated Chromium verification, 2026-08-29"
  affects: ["workflows"]
