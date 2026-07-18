# E2E coverage matrix

One row per feature behavior. **Status:** ✅ covered · 🟡 partial · ❌ gap.
**Tier** (for gaps): T1 mock · T2 local-AI · T3 real provider · DT desktop-only (out of
Playwright-web scope, manual/capture-harness). **Pri:** P0 release-blocking journey · P1 shipped
feature without coverage · P2 polish/visual.

Spec paths are relative to `packages/app/e2e/`. Every `*.spec.ts` on disk must be claimed by at
least one row — `node scripts/e2e-coverage-check.mjs` enforces both directions.

## 1. Startup, routing & app shell

| Behavior                                                                                    | Status | Specs / plan                                                               | Tier | Pri |
| ------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------- | ---- | --- |
| Cold start with empty state renders sessions screen                                         | ✅     | `00-sessions-empty.spec.ts`                                                | T1   | —   |
| Startup loading states, no blank flash                                                      | ✅     | `startup-loading.spec.ts`                                                  | T1   | —   |
| Startup wire metrics / connection bring-up                                                  | ✅     | `startup-wire-metrics.spec.ts`                                             | T1   | —   |
| Launcher tab behavior                                                                       | ✅     | `launcher-tab.spec.ts`                                                     | T1   | —   |
| Route restore / navigation regressions (back, deep links)                                   | ✅     | `workspace-navigation-regression.spec.ts`                                  | T1   | —   |
| Desktop project picker                                                                      | ✅     | `project-picker-desktop.spec.ts`                                           | T1   | —   |
| Bottom sheets reopen cleanly after dismiss                                                  | ✅     | `bottom-sheet-reopen.spec.ts`                                              | T1   | —   |
| First-time wizard full flow (Mode→Providers→Personalities→Teams→Home), idempotent re-entry  | ❌     | fresh `OTTO_HOME` without fork → wizard must appear; complete + skip paths | T1   | P0  |
| Compact/mobile layout smoke (viewport 375px: sidebar overlay, tab switcher lists all panes) | ❌     | resize viewport per key screen                                             | T1   | P1  |
| Animations toggle disables page-fade + sidebar slide                                        | ❌     | toggle setting, assert transition styles absent                            | T1   | P2  |

## 2. Hosts & connectivity

| Behavior                                                       | Status | Specs / plan                                                                  | Tier | Pri |
| -------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------- | ---- | --- |
| Command center host switching                                  | ✅     | `command-center-host.spec.ts`                                                 | T1   | —   |
| Host settings page                                             | ✅     | `settings-host-page.spec.ts`                                                  | T1   | —   |
| Sidebar multi-host filtering                                   | ✅     | `sidebar-host-filter-multi.spec.ts`                                           | T1   | —   |
| Relay pairing (QR / code) — relay already runs in global setup | ❌     | pair a second client through the wrangler relay                               | T1   | P1  |
| Daemon disconnect → reconnect banner → recovery                | ❌     | kill/restart daemon via `helpers/daemon-restart.ts`, assert banner + recovery | T1   | P1  |

## 3. Projects, workspaces & worktrees

| Behavior                                                                     | Status | Specs / plan                                                           | Tier | Pri |
| ---------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------- | ---- | --- |
| New workspace creation (form, validation)                                    | ✅     | `new-workspace.spec.ts`, `new-workspace-entry.spec.ts`                 | T1   | —   |
| New workspace provider/model preselect (last-used)                           | ✅     | `new-workspace-preselect.spec.ts`                                      | T1   | —   |
| New workspace isolation memory                                               | ✅     | `new-workspace-isolation-memory.spec.ts`                               | T1   | —   |
| Codex mode preferences on create                                             | ✅     | `new-workspace-codex-mode-preferences.spec.ts`                         | T1   | —   |
| Workspace lifecycle (create→work→archive)                                    | ✅     | `workspace-lifecycle.spec.ts`                                          | T1   | —   |
| Multiple workspaces simultaneously                                           | ✅     | `workspace-multiplicity.spec.ts`                                       | T1   | —   |
| Workspace cwd resolution                                                     | ✅     | `workspace-cwd.spec.ts`                                                | T1   | —   |
| Two workspaces on the same directory                                         | ✅     | `same-directory-workspaces.spec.ts`                                    | T1   | —   |
| Worktree create + restore                                                    | ✅     | `worktree-restore.spec.ts`                                             | T1   | —   |
| Worktree restore after daemon restart                                        | ✅     | `worktree-restore-after-restart.spec.ts`                               | T1   | —   |
| Worktree archive (incl. dirty-tree risk warning)                             | ✅     | `worktree-archive.spec.ts`, `worktree-archive-risk-warning.spec.ts`    | T1   | —   |
| Archive keyboard shortcut                                                    | ✅     | `workspace-archive-shortcut.spec.ts`                                   | T1   | —   |
| Empty project persists across restart                                        | ✅     | `empty-project-persists.spec.ts`                                       | T1   | —   |
| Project settings screen                                                      | ✅     | `projects-settings.spec.ts`                                            | T1   | —   |
| Sidebar workspace rows (open, state)                                         | ✅     | `sidebar-workspace.spec.ts`                                            | T1   | —   |
| Sidebar workspace rename                                                     | ✅     | `sidebar-workspace-rename.spec.ts`                                     | T1   | —   |
| Sidebar context menus                                                        | ✅     | `sidebar-context-menu.spec.ts`                                         | T1   | —   |
| Workspace pins                                                               | ✅     | `workspace-pins.spec.ts`                                               | T1   | —   |
| Pane remount stability                                                       | ✅     | `workspace-pane-remount.spec.ts`                                       | T1   | —   |
| Open in external editor                                                      | ✅     | `workspace-open-in-editor.spec.ts`                                     | T1   | —   |
| Workspace setup runtime + streaming                                          | ✅     | `workspace-setup-runtime.spec.ts`, `workspace-setup-streaming.spec.ts` | T1   | —   |
| Gated multi-root: preview any linked-root file, edit gate free/other/outside | ❌     | two linked projects, open cross-root file, assert edit gating          | T1   | P1  |
| Per-worktree diff base configuration                                         | ❌     | pending diff-base project ship                                         | T1   | P2  |

## 4. Chat: composer & timeline

| Behavior                                                                           | Status | Specs / plan                                           | Tier | Pri |
| ---------------------------------------------------------------------------------- | ------ | ------------------------------------------------------ | ---- | --- |
| Composer attachments (files, images)                                               | ✅     | `composer-attachments.spec.ts`                         | T1   | —   |
| Composer @-autocomplete                                                            | ✅     | `composer-autocomplete.spec.ts`                        | T1   | —   |
| Client slash commands                                                              | ✅     | `client-slash-commands.spec.ts`                        | T1   | —   |
| Agent stream rendering (tool calls, text)                                          | ✅     | `agent-stream-ui.spec.ts`                              | T1   | —   |
| Timeline pagination / backfill                                                     | ✅     | `agent-timeline-pagination.spec.ts`                    | T1   | —   |
| User message UI contract                                                           | ✅     | `user-message-contract.ui-contract.spec.ts`            | T1   | —   |
| Question prompt pagination (AskUserQuestion-style)                                 | ✅     | `question-prompt-pagination.spec.ts`                   | T1   | —   |
| Agent title handoff to tab                                                         | ✅     | `workspace-agent-title-handoff.spec.ts`                | T1   | —   |
| Agent tab rename                                                                   | ✅     | `workspace-agent-tab-rename.spec.ts`                   | T1   | —   |
| Fork from assistant message                                                        | ✅     | `assistant-fork-menu.spec.ts`                          | T1   | —   |
| Composer ghost-text suggestions (Tab), sent-history Up/Down, ESC clear-then-cancel | ❌     | uncommitted feature; needs spec alongside              | T1   | P0  |
| Chat auto-title (1–3 words from first message)                                     | ❌     | mock-agent title path                                  | T1   | P1  |
| Chat file links open in side pane, never displace chat                             | ❌     | click file link in agent output, assert side placement | T1   | P1  |
| Streaming reveal (typewriter) + live turn token counters                           | ❌     | assert counters tick during mock stream                | T1   | P2  |
| Rate-limit warning strip in composer                                               | ❌     | inject `rate_limit_updated`, assert strip + dismissal  | T1   | P1  |
| Friendly tool display names everywhere                                             | ❌     | assert `getToolDisplayName` output in stream rows      | T1   | P2  |
| Steer queue (queued steering drains at idle)                                       | ❌     | charter not shipped; spec lands with feature           | T1   | P2  |

## 5. Agent lifecycle & control

| Behavior                                                                                      | Status | Specs / plan                                                                                                                                                               | Tier | Pri |
| --------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --- |
| Model switch requires/handles restart                                                         | ✅     | `workspace-model-restart.spec.ts`, `workspace-model-regressions.spec.ts`                                                                                                   | T1   | —   |
| Sidebar model display                                                                         | ✅     | `sidebar-model-b.spec.ts`                                                                                                                                                  | T1   | —   |
| Codex plan approval flow                                                                      | ✅     | `codex-plan-approval.spec.ts`                                                                                                                                              | T1   | —   |
| Archive tab semantics                                                                         | ✅     | `archive-tab.spec.ts`                                                                                                                                                      | T1   | —   |
| Subagent detach                                                                               | ✅     | `subagent-detach.spec.ts`                                                                                                                                                  | T1   | —   |
| Rewind menu UI contract                                                                       | ✅     | `rewind-menu.ui-contract.spec.ts`                                                                                                                                          | T1   | —   |
| Rewind end-to-end per provider                                                                | ✅     | `rewind-flow.claude.real.spec.ts`, `rewind-flow.codex.real.spec.ts`, `rewind-flow.opencode.real.spec.ts`, `rewind-flow.pi.real.spec.ts` (+ shared `rewind-flow.shared.ts`) | T3   | —   |
| Session import (OpenCode)                                                                     | ✅     | `import-session.opencode.real.spec.ts`                                                                                                                                     | T3   | —   |
| Permission prompt approve/deny round-trip (helpers exist: `helpers/permissions.ts`)           | 🟡     | exercised incidentally; needs a dedicated spec                                                                                                                             | T1   | P0  |
| Safe unattended: dontAsk mode, deny-responder answers hidden prompts, promote-on-error reveal | ❌     | unattended agent hits gated tool → deny → surfaced                                                                                                                         | T1   | P0  |
| Auto mode on Haiku coerces to dontAsk + LockedAgentModeBadge                                  | ❌     | settings + badge assertion                                                                                                                                                 | T1   | P1  |
| Rewind on openai-compat provider                                                              | ❌     | `rewind-flow` pattern against local model                                                                                                                                  | T2   | P1  |
| Observed subagents: read-only track rows appear for provider subagents                        | ❌     | mock-agent subagent events → rows                                                                                                                                          | T1   | P1  |
| Subagent liveness (elapsed, current tool, tool count)                                         | ❌     | pending charter ship                                                                                                                                                       | T1   | P2  |

## 6. Providers & models

| Behavior                                                                       | Status | Specs / plan                                                              | Tier | Pri |
| ------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------- | ---- | --- |
| ACP provider catalog                                                           | ✅     | `acp-provider-catalog.spec.ts`                                            | T1   | —   |
| Provider settings refresh                                                      | ✅     | `provider-settings-refresh.spec.ts`                                       | T1   | —   |
| Provider usage settings + tooltip                                              | ✅     | `provider-usage-settings.spec.ts`, `provider-usage-tooltip.spec.ts`       | T1   | —   |
| openai-compat live loop: prompt → native tool calls → file edit → diff visible | ❌     | **T2 flagship smoke spec**                                                | T2   | P0  |
| openai-compat compaction (/compact keeps recent, incremental)                  | ❌     | long session against local model, assert compaction event + usable resume | T2   | P1  |
| openai-compat image attachment reaches model (vision)                          | ❌     | attach image, assert image_url part accepted (tool-visible outcome)       | T2   | P1  |
| openai-compat max tool rounds setting honored                                  | ❌     | set low cap, assert loop stops with cap message                           | T2   | P1  |
| openai-compat resume replays tool calls + reasoning (history fidelity)         | ❌     | restart mid-session, assert timeline identical                            | T2   | P1  |
| Custom provider profiles (Z.AI / Qwen / custom binaries) render + validate     | ❌     | catalog/settings-level assertions, no live calls                          | T1   | P2  |
| Effort selector per-model (effort unification)                                 | ❌     | model picker shows correct effort levels per catalog                      | T1   | P2  |

## 7. Personalities & teams

| Behavior                                                     | Status | Specs / plan                                      | Tier | Pri |
| ------------------------------------------------------------ | ------ | ------------------------------------------------- | ---- | --- |
| Personality CRUD in settings (roles, colors, prompt)         | ❌     | settings editor sheet flow                        | T1   | P0  |
| Personality applied on new chat (provider/model/mode/prompt) | ❌     | create agent via personality, assert config       | T1   | P0  |
| Personality preserved on new-chat autosubmit (regression)    | ❌     | regression spec for `resolveDraftPersonality` fix | T1   | P1  |
| Live personality switch on running agent                     | ❌     | `agent.personality.set` against mock/local agent  | T1   | P1  |
| Model picker personality drill-down submenu                  | ❌     | uncommitted feature; spec alongside               | T1   | P1  |
| Teams: create template, set active team, instant switcher    | ❌     | host-scoped activeTeamId assertions               | T1   | P1  |
| Team prompt stacks before personality prompt on spawn        | ❌     | inspect spawned agent system-prompt composition   | T1   | P1  |

## 8. Terminal

| Behavior                                   | Status | Specs / plan                            | Tier | Pri |
| ------------------------------------------ | ------ | --------------------------------------- | ---- | --- |
| Rendering performance pipeline             | ✅     | `terminal-performance.spec.ts`          | T1   | —   |
| Keystroke stress / latency                 | ✅     | `terminal-keystroke-stress.spec.ts`     | T1   | —   |
| Activity indicators (agent hook reporting) | ✅     | `terminal-activity-indicators.spec.ts`  | T1   | —   |
| Alternate screen (TUI apps)                | ✅     | `terminal-alternate-screen.spec.ts`     | T1   | —   |
| Protocol queries (OSC etc.)                | ✅     | `terminal-protocol-query.spec.ts`       | T1   | —   |
| Split + resize                             | ✅     | `terminal-split-resize.spec.ts`         | T1   | —   |
| Terminal tab rename                        | ✅     | `workspace-terminal-tab-rename.spec.ts` | T1   | —   |

## 9. Files, editor & search

| Behavior                                                       | Status | Specs / plan                                                      | Tier | Pri |
| -------------------------------------------------------------- | ------ | ----------------------------------------------------------------- | ---- | --- |
| Text editor (CM6): open, edit, save via daemon RPCs            | ✅     | `text-editor.spec.ts`                                             | T1   | —   |
| File finder (quick open)                                       | ✅     | `file-finder.spec.ts`                                             | T1   | —   |
| Project-wide search                                            | ✅     | `project-search.spec.ts`                                          | T1   | —   |
| File explorer collapse behavior                                | ✅     | `file-explorer-collapse.spec.ts`                                  | T1   | —   |
| Scripts menu resize behavior                                   | ✅     | `workspace-scripts-menu-resize.spec.ts`                           | T1   | —   |
| Unified file tab mode bar (editor/split/preview + mode memory) | ❌     | mode switch + memory across reopen                                | T1   | P1  |
| File rendering: markdown/mermaid/images/CSV in preview mode    | ❌     | pending file-rendering project; add per-format smoke as they ship | T1   | P2  |
| AI Refactor flow (real agent behind selection refactor)        | ❌     | good T2 candidate — deterministic small refactor                  | T2   | P2  |

## 10. Git & Changes

| Behavior                                                          | Status | Specs / plan                                | Tier | Pri |
| ----------------------------------------------------------------- | ------ | ------------------------------------------- | ---- | --- |
| Changes tab commit flow                                           | ✅     | `changes-commit.spec.ts`                    | T1   | —   |
| Branch switcher                                                   | ✅     | `branch-switcher.spec.ts`                   | T1   | —   |
| PR pane (GitHub fixtures: `helpers/github-fixtures.ts`)           | ✅     | `pr-pane.spec.ts`                           | T1   | —   |
| Diff row alignment                                                | ✅     | `diff-row-alignment.spec.ts`                | T1   | —   |
| Git Log tab                                                       | ❌     | `checkout.git.log` UI assertions            | T1   | P1  |
| Rollback file (git discard w/ confirm)                            | ❌     | dirty file → rollback → clean               | T1   | P1  |
| Commit CTA writer-agent confirm (`checkout.git.commit_agent`)     | ❌     | confirm dialog + agent spawn assertion      | T1   | P1  |
| Push CTA state reconcile after commit/push                        | ❌     | regression spec for split-button vanish     | T1   | P1  |
| Bitbucket Cloud forge parity (PR pane against Bitbucket fixtures) | ❌     | mirror `pr-pane` with Bitbucket fixture set | T1   | P2  |

## 11. Settings & i18n

| Behavior                                                          | Status | Specs / plan                                              | Tier | Pri |
| ----------------------------------------------------------------- | ------ | --------------------------------------------------------- | ---- | --- |
| Settings navigation                                               | ✅     | `settings-navigation.spec.ts`                             | T1   | —   |
| Settings sidebar scroll                                           | ✅     | `settings-sidebar-scroll.spec.ts`                         | T1   | —   |
| Settings i18n (all locales render)                                | ✅     | `settings-i18n.spec.ts`                                   | T1   | —   |
| Toggle/tab state regression                                       | ✅     | `settings-toggle-tab-regression.spec.ts`                  | T1   | —   |
| Appearance: theme switch light/dark applies                       | ❌     | token-level assertion on a known surface                  | T1   | P1  |
| Speech settings cards (engine, voice; no downloads triggered)     | ❌     | assert UI only — global setup already disables speech env | T1   | P2  |
| Visualizer settings section incl. GPU re-enable button visibility | ❌     | web-safe subset (button is Electron-gated)                | T1   | P2  |
| Feature-flag registry: disabling Visualizer removes its surfaces  | ❌     | flag off → panel/tab absent                               | T1   | P1  |
| Activity stats start-screen setting                               | ❌     | toggle + start screen presence                            | T1   | P2  |

## 12. Schedules & runs

| Behavior                                                   | Status | Specs / plan                                      | Tier | Pri |
| ---------------------------------------------------------- | ------ | ------------------------------------------------- | ---- | --- |
| Schedule edit form model hydration                         | ✅     | `schedules-edit-model-hydration.spec.ts`          | T1   | —   |
| Schedule project targeting                                 | ✅     | `schedules-project-target.spec.ts`                | T1   | —   |
| Schedule create form (golden form-kit example) full flow   | ❌     | create → appears in list → fires (manual trigger) | T1   | P1  |
| Runs screen: run rows, Visualize action                    | ❌     | seed run, assert row + visualize opens tab        | T1   | P1  |
| Hidden schedule runs stay hidden; promote-on-error reveals | ❌     | seeded failing run → sidebar reveal               | T1   | P1  |
| Suggested tasks chips (spawn_task → chip → session)        | ❌     | seed chip, click, assert session created          | T1   | P2  |

## 13. Visualizer

| Behavior                                                                                 | Status | Specs / plan                                  | Tier | Pri |
| ---------------------------------------------------------------------------------------- | ------ | --------------------------------------------- | ---- | --- |
| Visualizer tab opens, canvas boots (WebGL under swiftshader OK)                          | ❌     | assert bridge/DOM state, never pixels         | T1   | P0  |
| Agent start → node appears; turn end → node settles idle (context_update fix regression) | ❌     | mock-agent session mirrored to canvas state   | T1   | P1  |
| Archive agent → session removed from canvas                                              | ❌     | regression for close-session path             | T1   | P1  |
| New-chat redirect: draft never lands in Visualizer pane                                  | ❌     | `resolveWorkspaceNewChatPlacement` regression | T1   | P1  |
| Toolbar actions + detail card (right side) render node data                              | ❌     | select node → card fields                     | T1   | P2  |
| Discovery cards + context-composition ring populated                                     | ❌     | requires usage events from mock agent         | T1   | P2  |

## 14. Artifacts, preview & browser pane

| Behavior                                                         | Status | Specs / plan                                                                   | Tier  | Pri |
| ---------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------ | ----- | --- |
| Artifact produced by agent renders in artifact surface           | ❌     | mock-agent emits artifact → pane renders                                       | T1    | P1  |
| Preview: launch.json dev server starts, tab binds, logs readable | ❌     | daemon-level preview RPCs + web browser-pane fallback; full webview flow is DT | T1/DT | P1  |
| Browser-tools guardrails (tab binding enforced by daemon)        | ❌     | RPC-level assertions in server E2E (vitest `*.e2e.test.ts`), not Playwright    | —     | P2  |

## 15. Desktop-only (manual / capture harness — not Playwright-web)

| Behavior                                                  | Status | Specs / plan                      | Tier | Pri |
| --------------------------------------------------------- | ------ | --------------------------------- | ---- | --- |
| Desktop update flow UI (mocked feed)                      | ✅     | `desktop-updates.spec.ts`         | T1   | —   |
| GPU fallback auto-relaunch + re-enable button             | ❌     | manual checklist item             | DT   | P2  |
| Focus mode caption strip (Ctrl+Shift+F)                   | ❌     | manual checklist item             | DT   | P2  |
| Electron webview browser pane (real preview verification) | ❌     | `docs/browser-capture-harness.md` | DT   | P2  |
