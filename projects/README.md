# Projects — charters and the open-work ledger

**This file is the single source of truth for what is done and what is not.** It stays at the base of
`projects/` permanently. Nothing else in this tree tracks status.

Navigation: [Repository documentation index](../README.md#documentation) ·
[Software documentation (`docs/`)](../docs/README.md) · [Agent working rules (`CLAUDE.md`)](../CLAUDE.md)

## Contents

- [What belongs here](#what-belongs-here)
- [The rules](#the-rules)
- [Active charters](#active-charters)
- [Open work](#open-work) — [Editor & code intelligence](#editor--code-intelligence) ·
  [Git, changes & comments](#git-changes--comments) ·
  [Subagents & background tasks](#subagents--background-tasks) · [Visualizer](#visualizer) ·
  [Performance](#performance) · [Onboarding & UX](#onboarding--ux) ·
  [Providers & accounting](#providers--accounting) · [Testing & tooling](#testing--tooling) ·
  [i18n](#i18n)
- [Build order](#build-order)
- [Deferred indefinitely](#deferred-indefinitely)
- [Owed fold-ins](#owed-fold-ins)

---

## What belongs here

`projects/` holds **point-in-time plans**: a charter for something not yet built, a build plan for
work in flight, a design document for a decision being taken. One initiative, one folder.

It is not documentation. Durable, evergreen facts about how Otto works live in
[`docs/`](../docs/README.md). The distinction is the tense: a charter says _what we will build_; a doc
says _how it works_.

## The rules

1. **One folder per initiative**, named for the initiative. The charter is
   `<folder-name>/<folder-name>.md`. Sub-plans the work genuinely needs (a phase breakdown, a
   library evaluation, a runbook) sit beside it in the same folder.
2. **No progress documents.** No work-package reports, no dated batch triage, no second registry.
   Progress is a row in this file. If a document only records _what happened_, it does not belong in
   the tree — its conclusions go into the charter or into `docs/`, and the document is dropped.
   **Measured investigations are the one exception with a home of their own:** they go to
   [`findings/`](../findings/README.md), never here.
3. **Status lives here, not in the charter.** A charter may describe its own phases; it does not get
   to be a competing ledger.
4. **When a project ships, it drains and leaves.** Fold the durable facts into the relevant `docs/`
   page, move any remaining tail into [Open work](#open-work) below, then remove the folder. A
   shipped project sitting in `projects/` is the most common way this tree rots.
5. **Removed folders go to `archive/`** at the repo root, which is gitignored. Nothing is destroyed;
   it simply stops being part of the repo. If something is genuinely dead — never to be explored
   again — it does not even earn the archive.

## Active charters

Everything currently in this tree. Status vocabulary: **Charter** (nothing built) · **In build** ·
**Partial** (shipped in part, a named remainder open) · **Reference** (not work).

| Project                                                                                         | Status  | What it is                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [agent-orchestration](agent-orchestration/agent-orchestration.md)                               | Charter | The **control layer** — Teams as the way work is invoked, typed tasks, recognize → plan → delegate → synthesize. Quarter-scale. Companion: [invocation.md](agent-orchestration/invocation.md)                                       |
| [bug-reporting](bug-reporting/bug-reporting.md)                                                 | Charter | In-app bug/suggestion reporting; the daemon files the GitHub issue so reporters need no account                                                                                                                                     |
| [claude-extensions](claude-extensions/claude-extensions.md)                                     | Charter | Plugins, marketplaces, skills and MCP in the Claude provider settings panel — management plus the always-on context budget nothing else totals. **Deliberately Claude-only**                                                        |
| [computer-use](computer-use/computer-use.md)                                                    | Charter | Agents see and control the desktop via a shared computer-control library; layered safety. Companion: [computer-control-library.md](computer-use/computer-control-library.md)                                                        |
| [context-management](context-management/context-management.md)                                  | Partial | Everything sent before you type, plus the 3-pane tab. Built and committed. Open: demote-to-subdirectory, skills/MCP toggles, the §11 calibration                                                                                    |
| [dictation-refine](dictation-refine/dictation-refine.md)                                        | Charter | AI cleanup over dictated text via a latency-ordered ladder (lexical → ONNX → optional LLM)                                                                                                                                          |
| [editor-repo-conventions](editor-repo-conventions/editor-repo-conventions.md)                   | Charter | Honour the repo's own `.editorconfig` without configuring Otto; repo wins file-shaped settings, user wins view-shaped ones                                                                                                          |
| [e2e-qa-coverage](e2e-qa-coverage/e2e-qa-coverage.md)                                           | Partial | Full-app Playwright QA across 3 tiers (mock / local-AI / real provider). T1 and T2 green. Companions: coverage-matrix, local-ai-tier, reporting                                                                                     |
| [file-rendering](file-rendering/file-rendering.md)                                              | Partial | IDE-grade file rendering. Mermaid shipped; AsciiDoc preview in flight. Companions: [asciidoc-preview.md](file-rendering/asciidoc-preview.md), [relative-image-resolution.md](file-rendering/relative-image-resolution.md)           |
| [inline-widgets](inline-widgets/inline-widgets.md)                                              | Charter | In-message widgets — a `show_widget` tool carrying an HTML/SVG fragment rendered inline. Distinct from artifacts; reuses their sandbox                                                                                              |
| [marketing-strategy](marketing-strategy/marketing-strategy.md)                                  | Charter | Otto's public voice (Philippe, first person) and the channels still to create                                                                                                                                                       |
| [mobile-daemon](mobile-daemon/mobile-daemon.md)                                                 | Charter | Embedded API-native daemon on the phone ("This device" host); no CLIs                                                                                                                                                               |
| [multiplayer](multiplayer/multiplayer.md)                                                       | Charter | Presence, entering each other's workspaces, opt-in follow — never forced mirroring                                                                                                                                                  |
| [observed-subagents](observed-subagents/observed-subagents.md)                                  | Partial | Provider subagents promoted to read-only track rows. Claude proof shipped; generalizing is adapter-only work. **[provider-adapters.md](observed-subagents/provider-adapters.md) is the adapter contract** and is cited from `docs/` |
| [outreach](outreach/outreach.md)                                                                | Charter | Awareness strategy, website-scoped. Sells nothing. Companions: channels, content, pipeline, runbook                                                                                                                                 |
| [preview-file-tabs](preview-file-tabs/preview-file-tabs.md)                                     | Charter | VSCode-style preview tabs (transient vs pinned); web-only idiom                                                                                                                                                                     |
| [refine](refine/refine.md)                                                                      | Partial | AI rewrite loop with review, as its own job tab. Prose only, never code. Built. Open: the Context Management call site, a conflict test, i18n                                                                                       |
| [sidebar-reveal](sidebar-reveal/sidebar-reveal.md)                                              | Partial | Increment 1 (reveal primitive) shipped. Increment 2 (tutorial create-workspace step) unbuilt — this folder holds the only plan for it                                                                                               |
| [site-demos](site-demos/site-demos.md)                                                          | Partial | Marketing-site demo assets — staged repos, Playwright capture pipeline. Companion: [runbook.md](site-demos/runbook.md)                                                                                                              |
| [solution-view](solution-view/solution-view.md)                                                 | Partial | Phases 0 and 1 built — the read-only Solution lens, its sidecar, and its switch. Architecture folded into [docs/solution-view.md](../docs/solution-view.md). Open: Phases 2–4, below                                                |
| [upstream-subagent-convergence](upstream-subagent-convergence/upstream-subagent-convergence.md) | Charter | Stop forking upstream's provider-subagent ingestion — take theirs verbatim, project it into Otto's observed model                                                                                                                   |
| [visualizer-node-richness](visualizer-node-richness/visualizer-node-richness.md)                | Partial | Discovery cards shipped. Open: the context-composition ring                                                                                                                                                                         |
| [visualizer-pip](visualizer-pip/visualizer-pip.md)                                              | Partial | Audio-while-closed shipped. Open: PIP window, Arena mode                                                                                                                                                                            |
| [web-search-providers](web-search-providers/web-search-providers.md)                            | Charter | Selectable web-search engine for the openai-compat provider settings panel                                                                                                                                                          |
| [workflow-decomposition](workflow-decomposition/workflow-decomposition.md)                      | Partial | Decompose a Claude Workflow run into per-`agent()` observed-subagent rows. Path B built and live-verified                                                                                                                           |

---

## Open work

Legend: 🔴 bug · 🟡 feature/enhancement · 🔵 investigation or decision · ⚪ unbuilt charter tail

### Editor & code intelligence

- 🟡 **"Explain this to me" over a selection (AI, read-only).** The first AI action in the editor
  toolbar; uses `controller.getSelection()` (`editor-core.ts:501`). Needs a provider-neutral daemon
  "explain snippet" capability streamed into a side panel or sheet. Not Refine — read-only. Open:
  render target, throwaway vs real turn, how much surrounding context. Shares the focused-controller
  dispatch path with the shortcut overhaul's deferred "Full" stage.
- 🟡 **LSP: a live pass over the editor path and the Daemon → Code screen.** Every test is
  daemon-side or type-level; the UI itself has never been clicked through. **Never run the test
  suite against a live daemon.** Architecture: [docs/code-intelligence.md](../docs/code-intelligence.md).
- ⚪ **LSP Phase 4 (Angular / second server per document)** — deferred indefinitely. The multi-server
  binding it existed to prove now has a real production user in the `oxlint` row.
- 🟡 **Refine: the Context Management call site.** The per-file action calling
  `openRefineTab({ path, presetId })`. The tab target already carries `presetId` and the panel
  already seeds from it — a call site, not a feature. Also open: the conflict-path integration test
  (the `stale` phase writes nothing on conflict — written and typed, untested) and i18n.
- 🔵 **Verify caret auto-scroll follow + search-match-scroll.** Both marked fixed but carry "verify on
  the live repro across plain and split mode before closing."
- 🟡 **ctags fallback: incremental re-index.** Build once, then re-index only the written file (the
  write path already knows the path) instead of invalidating the workspace. Removes the latency
  complaint for the no-server case.
- ✅ **Solution view, Phases 0 and 1.** Built 2026-07-25. The read-only Solution lens, the
  `OttoDotnetProbe` sidecar (`packages/dotnet-probe/`, 257 KB portable IL), the daemon subsystem
  (`packages/server/src/server/solution-model/`), three `code.solution.*` RPCs behind
  `features.solutionView`, and the "Microsoft .NET Solution Management" switch — a separate row from
  Code Intelligence, **default off**, and off does no work. Architecture:
  [docs/solution-view.md](../docs/solution-view.md).
  **Phase 0's remaining open question is answered by measurement:** raw `Microsoft.Build` evaluation
  beats Buildalyzer 9.0 — 33× faster on a 12-project solution, 70× smaller, one runtime major lower,
  and more correct for a file tree (a design-time build reports generated `obj/*.AssemblyInfo.cs` as
  sources). Numbers in [packages/dotnet-probe/README.md](../packages/dotnet-probe/README.md).
- 🔵 **Solution view: a live pass over the lens.** Same shape as the LSP item above — every test is
  daemon-side, type-level, or against the pure row builder, plus six end-to-end against the real
  sidecar. The switcher, the picker, the tree and the failed-project tooltip have never been clicked
  through. **Never run the test suite against a live daemon.**
- ⚪ **Solution view Phase 2 — general file mutations.** _Otto has no file create, delete, rename or
  move RPC at all._ The whole mutation surface is `file.write`, `file.replace` and `file.upload`.
  "Manage files within projects" therefore has a prerequisite strictly larger than the Solution view
  itself — and it benefits the Files lens identically, so it must not be smuggled in as .NET work.
  For SDK-style projects it alone delivers add/remove correctly, because membership is implicit:
  creating a `.cs` file _is_ adding it to the project. Explicit-item projects are the minority that
  needs real editing, and the daemon already reports which items are implicit
  (`SolutionProjectNode.isImplicit`), so they are detectable.
- ⚪ **Solution view Phase 3 — solution and project mutations.** Add/remove a project, manage solution
  folders, new project from template, references and packages. **Via SolutionPersistence's writer,
  which round-trips both formats** — `.sln`/`.slnx` are never written by hand. The sidecar has no
  mutation verb today, deliberately; Phase 3 is where one is added.
- ⚪ **Solution view Phase 4 — pin `csharp-ls` to the selected solution.** `csharp-ls` accepts
  `--solution`; today `rootPath` is just the workspace `cwd`, so in a repo with two solutions the
  server picks one on its own and we cannot tell which. The client already remembers the user's
  choice (`explorerSolutionByCheckout`), so what remains is a registry extension: `args` are static
  per row (`lsp/registry.ts`), with no mechanism for per-workspace dynamic arguments.
- ⚪ **Solution view: solution filters (`.slnf`).** Explicitly out of scope for Phase 1. Listed so
  nobody assumes they work.

### Git, changes & comments

- 🟡 **Resolved vs unresolved PR comments.** Approved counts, unresolved/total, mark-resolved,
  comment → task. GitHub resolution lives on review threads (GraphQL `isResolved`), absent from the
  REST comment list. Capability bit first, GitHub as proof.
- 🔵 **Comment behaviour across workspace operations is undefined.** Needs a decision, not a fix.
- 🔴 **Can't re-read your own file comments after sending.** Reopening the comment tile should show
  its contents. Marked not critical.
- 🔵 **Changes-view base: the auto-fetch decision and the non-worktree override.** Fork-point base
  resolution and the per-worktree override shipped; semantics live in
  [docs/changes-view.md](../docs/changes-view.md). Left: (a) **product decision** — does a read-only
  view get a throttled background `git fetch` of the base? Without one, a base ref nobody updates
  stays stale and merge-base math cannot help. (b) Plain checkouts have nowhere to store a base
  override — needs a second store keyed by workspace, and that store would have to feed
  `resolveBaseRefForCwd` or the base stops being one source of truth. (c) Polish: suggest a detected
  stacked parent in the picker; a "base is N behind origin" hint chip, which depends on (a).
- ⚪ **Git hosting: GitLab and beyond.** The provider-neutral forge layer supports GitHub and
  Bitbucket Cloud. Deferred until a GitLab user exists.
- ⚪ **Git file history: presentation.** The capability shipped; what remains is a side pane, gutter
  blame, and the mobile treatment.
- ⚪ **History delete: multi-select.** Per-row delete and bulk **Clear archived** shipped 2026-07-25
  ([docs/chat-lifecycle.md § Delete](../docs/chat-lifecycle.md#delete)). What is missing is the middle
  ground — selecting specific archived rows and deleting that set. It needs the
  `history.agents.delete.request` RPC the charter sketched (explicit ids, per-item outcome), which was
  **deliberately not built** because an RPC with no caller is dead protocol surface. Build the
  selection UI and the RPC together or neither.
- ⚪ **History delete: automatic retention.** A daemon config `historyRetentionDays`, **default off** —
  Otto should never silently delete a user's history — hot-reloadable via `MutableDaemonConfig` like
  rate-limit-warnings/speech, with a settings row. The sweep it would drive
  (`history.agents.clear_archived`, with `olderThanDays` already on the wire) exists, so this is a
  config surface plus a timer. Motivating cost is startup latency, not disk: `AgentStorage.load()`
  reads **every** `agents/**/*.json` into memory at daemon start with no age filter, so a large archive
  is a permanent boot and RAM tax.
- 🔵 **Cross-client delete propagation.** `agent_deleted` is emitted on the requesting session only
  (`this.emit`), same as it always was — another connected client keeps the row until it refetches.
  Archive propagates globally; delete does not. Noticed while wiring delete, not caused by it. Decide
  whether delete should broadcast the way `runs.cleared.notification` does.

### Subagents & background tasks

- 🔵 **Possible double-counting of background tasks and subagents.** Check whether a provider emits
  one unit into both `backgroundShellTasks` and the subagents track.
- 🔴 **A research personality paused for plan approval instead of returning its result.** The subagent
  hit `ExitPlanMode`, got approval, then stopped rather than handing its report up. A research-role
  personality probably should not have the plan-exit tool in scope.
- 🟡 **Promote an unattended run on a guardrail denial, and emit a denial timeline entry.** Closes a
  `TODO(safe-unattended Phase 3)` in `agent-manager.ts` (~L4108). Daemon-only. Two verified gaps: a
  guardrail denial does not promote the run the way a hard error does, and no denial entry reaches
  the timeline. Detail: `archive/projects/todos/unattended-denial-promote.md`.
- ⚪ **Observed subagents: the remaining provider adapters.** Claude is the shipped reference; the
  3-step adapter contract is in [docs/subagent-accounting.md](../docs/subagent-accounting.md).
  Sequenced behind the upstream merge — see [Build order](#build-order).

### Visualizer

- 🔴 **Actions disappear while still running.** A long bash/read/write shows, hides, then reappears on
  completion. Suspected fixed-TTL node versus a lifecycle tied to the tool call.
- 🟡 **Discoveries should fade; their colours read as wrong or unexplained.**
- 🟡 **Skill activation is not shown at all.** No node or badge when a skill fires.
- ✅ **The context-composition ring.** Built 2026-07-25 (uncommitted). Unified onto the provider's
  own accounting — `AgentUsage.contextCategories`, the same reading
  `agent.context.get_usage` serves the context meter, so the graph and the meter can no longer
  disagree. Open-ended labels, not a 5-way enum. Claude + openai-compat report a real split; Codex,
  Copilot and OpenCode report occupancy only and stay on the daemon's timeline estimate.
  See [docs/visualizer.md](../docs/visualizer.md) "Context ring".
  **Correction:** this does _not_ share instrumentation with the usage log's View B — see that entry.

### Performance

- ✅ **Resource reporting.** Built 2026-07-25 — `packages/app/src/diagnostics/resource-report/`:
  frame timing, a retained-state census over every store, react-query cache and DOM counts, live
  timer counts, and daemon-traffic accounting (including main-thread handler time). Surfaced live
  along the bottom of the Metrics screen, in the app diagnostic report, and to the soak harness via
  `window.__ottoResourceMonitor`. Off switch: `Settings › Diagnostics › Performance monitoring`.
  Soak: `packages/app/e2e/client-resource-soak.spec.ts` (`OTTO_RESOURCE_SOAK_E2E=1`). Documented in
  [docs/client-performance.md](../docs/client-performance.md).
- 🔴 **App-wide FPS degrades over time — measured, not yet fixed.** Findings in
  [docs/client-performance.md](../docs/client-performance.md#what-the-client-actually-does-with-resources).
  Retired by measurement: timer leak, query-cache growth, observer leak, message-decode cost (0.25%
  of wall clock). Confirmed: **mounted workspace trees are never released** — 1 → 3 workspaces costs
  ~35% of the frame rate and never comes back. The remaining sub-items are below.
- 🔴 **Decide workspace-tree retention.** Evict cold workspace trees (LRU, remount on switch-back),
  or keep today's retain-everything trade? Product decision; it blocks the main FPS fix.
- 🟡 **Instrument render cost per inbound daemon message.** The one gap keeping "daemon volume is the
  bottleneck" alive: `traffic.handlerMs` covers decode, validate and dispatch, **not** the React
  re-render each store write triggers. Cost is plausibly `push rate × mounted subscriber count`, and
  both factors grow over a session.
- 🟡 **Navigation refetches state the client already holds.** Four `fetch_agent_timeline` calls per
  workspace round-trip plus `terminals_changed` fan-out. Cheapest concrete win, and it is what the
  connection indicator is reacting to.
- 🟡 **`agentStreamTail`/`agentStreamHead` have no per-agent eviction.** Cleared only by
  `clearSession`, so every timeline item for every agent opened this session is retained. Needs a cap
  or a release path on chat close/archive.

### Onboarding & UX

- 🟡 **Vertical tab rail polish.** Five pull-offs: rail chip styling, cross-pane drag indicator,
  non-split desktop fallback, i18n extraction, on-device verification. Detail:
  `archive/projects/todos/vertical-tabs-rail-polish.md`.
- 🟡 **Themed avatar image set for agent teams.** The schema is already reserved and
  forward-compatible (`AgentTeamAvatarSchema.imageId`, where `imageId` wins over `color` and colour
  stays the fallback). Needs ~2 dozen keyed image assets, `imageId` rendered everywhere, and a picker
  grid in `agent-teams-section.tsx`. No protocol work. Detail:
  `archive/projects/todos/agent-teams-themed-avatars.md`.
- 🟡 **Bind a personality to a schedule from the client form.** The server side is fully shipped —
  a schedule config carries an optional `personality` and the run path re-resolves it per run. The
  client form has no personality field. **Settle the product decision first:** persisted re-resolve
  versus a one-time fill. Gate on `features.agentPersonalities`. Detail:
  `archive/projects/todos/schedule-form-personality-binding.md`.
- 🔴 **The Files module flashes an error referencing a stale URL.** Likely a cached query or path, or
  a persisted tab pointing at a dead path. Needs a repro.
- 🔵 **Do models volunteer suggested tasks at Claude Desktop's rate?** The trigger-first description
  rewrite fixed reachability; the open question is the unprompted call _rate_ in real use. If it is
  still low, the next lever is prompt-level guidance rather than more description text. Card
  persistence across daemon restart is separately deferred — in-memory by design.

### Providers & accounting

- ✅ **Total token accounting.** Shipped 2026-07-25. One honest number per chat: a per-agent lifetime
  in/cache/out split plus the provider's own de-inflated cost (`cumulativeUsage`,
  `COMPAT(cumulativeUsage)`), summed by one selector (`subagents/chat-totals.ts`) and surfaced in a
  chat metrics toolbar (`settings.chatMetricsBar`, off by default). The Visualizer's rate-table cost
  estimate is **gone** — cost is reported or blank. Rules in
  [docs/subagent-accounting.md § Chat totals](../docs/subagent-accounting.md#chat-totals-one-honest-number-per-chat);
  vocabulary in [docs/glossary.md](../docs/glossary.md). Remaining tail below.
- 🔵 **Should the in/out split be its own readout?** The daemon now carries the real
  in / cache-read / cache-write / out split per agent, but the toolbar collapses input to one figure
  and nothing surfaces the cache-read share — which is the number that explains why a long chat costs
  less than its token count suggests. The data is there; the presentation decision is not made.
- 🟡 **Reconcile the sub-agents track header with the chat total.** `formatHeaderLabel` still sums
  children only (parent excluded) — correct for a track header, but it now sits next to a toolbar
  showing a strictly larger number with no explanation of the difference.
- 🔵 **Verify the cumulative-reporter fix against real Pi and OpenCode hosts.** `toTurnSpend`'s
  per-provider scopes are unit-tested and were read off the provider adapters, but neither provider
  has been run live since. A wrong scope over-counts silently.
- 🔵 **Pinned metadata-generation providers silently fall through** when the provider cannot do a
  tool-less completion. Only `claude` and `openai-compat` implement `generateBareCompletion`; every
  other provider throws in `AgentManager.generateBareCompletion` (`agent-manager.ts:1794`) and the
  ladder moves on — by design. Consequence: a host that pins `metadataGeneration.providers` to such a
  provider gets its pin quietly bypassed and **another provider billed**. Confirmed live. Two angles:
  (a) product — should a pinned-but-incapable provider warn rather than silently re-route spend?
  (b) test harness — the mock provider has no `generateBareCompletion`, so **no E2E can pin metadata
  generation deterministically**, which makes the auto-title spec non-hermetic.
- 🔵 **Should a schedule firing into a busy chat queue, fail, or skip?** The one part of
  system-injected delivery left open. It never interrupted — `executeSchedule` fails the run with
  "already has an active run" — and it cannot be flipped with a flag, because it uses the blocking
  `runAgent` to collect the run record while the queue dispatches fire-and-forget. Underneath is a
  product question: is a schedule a deadline or a task? The cheapest fix is probably recording the
  run as **skipped** rather than failed.
- 🟡 **Usage log: per-row context composition (View B).** Expanding a turn row would break down
  catalog / personality / team / `CLAUDE.md` contribution. Needs exact-injected instrumentation that
  does not exist yet. Also deferred: cursor pagination beyond "load more", and provider/kind filters.

  **Correction (2026-07-25):** this was recorded as sharing instrumentation with the Visualizer's
  context ring — "do that instrumentation once". That is wrong, and building it that way would have
  produced a breakdown that cannot answer View B's question. The ring's source is the **provider's**
  reported split, where everything Otto injects (catalog, personality, team, `CLAUDE.md`) is
  invisible inside one opaque "System prompt" bucket. View B needs Otto to instrument **its own
  prompt assembly** — a genuinely different measurement that no provider can report. What the ring
  work _does_ hand View B is the transport and the shape: `AgentContextCategory[]` is open-ended, so
  injection-level categories ride the existing field with no protocol change. Sequence View B behind
  the prompt-assembly instrumentation, not behind the ring.

- 🔵 **Personality memory: calibrate the injection budget.** `MEMORY_BRIEF_TOKEN_BUDGET` is 1,500 — a
  judgement call against a 200K default window, and ~4.7% of a 32K local model's. Context Management
  now _measures_ the figure per personality, so it can be tuned with evidence instead of argued.
  Architecture: [docs/agent-personalities.md § Memory](../docs/agent-personalities.md#memory-accrued-lessons).
- 🟡 **Personality memory: a smarter merge on transfer.** Transfer-on-delete merges near-duplicates
  lexically, like every other dedup in the subsystem. Asking the destination personality to reconcile
  two overlapping lessons is the natural extension of the `review_lessons` loop — the one place in
  this feature where a model is the right tool.

### Testing & tooling

- 🔴 **Metro dies mid-E2E when Playwright churns `packages/app/test-results`.** Playwright's default
  `outputDir` sits **inside Metro's watched project root**, so deleting a scratch dir makes Metro's
  watcher throw `ENOENT`, the Expo CLI rethrow, and the bundler exit. Every later navigation then
  fails with `ERR_CONNECTION_REFUSED`, so specs report bogus navigation failures instead of their
  real result. Hits any second run in a checkout that still has artifacts on disk.
  **Workaround:** `E2E_OUTPUT_DIR=<path outside packages/app>`. **Real fix:** default `outputRoot`
  outside the Metro root, or add `test-results` to a Metro `blockList` — `packages/app` currently has
  no `metro.config.js`.
- 🟡 **E2E build-out.** Tiers 1 and 2 are green (all T1 batches, T2 local-AI 6/6); the coverage
  matrix and its drift guard (`scripts/e2e-coverage-check.mjs`) track the rest. Three known items
  remain: the scoped `personality-autosubmit-regression` rework, the Windows-only
  `git-cta-push-reconcile` limitation, and the deferred vision spec, which needs a vision-capable
  pinned model.

### i18n

- ⚪ **Dead i18n cleanup from the edit-outside change.** Now-dead
  `editor.outOfProject.editOutside*` / `editOther*` across 8 locales, plus
  `suppressOutOfProjectWarning` in `editor-prefs-store.ts`. Non-blocking sweep.
- ⚪ **i18n lag: worktree branch-cleanup and re-attach strings.** Only `en.ts` has these keys; the 7
  non-English locales lag. Batch translate pass.
- ⚪ **i18n: the setup wizard, Refine and personality memory.** All shipped English-only.
- ⚪ **i18n: the Solution view.** `workspace.solution.*` and `settings.host.code.solution*` are
  present in all 8 locales but carry the English strings in the 7 non-English ones — the resource
  types require every key to exist, so they were seeded rather than left absent. Batch translate pass.
- ⚪ **i18n lag: history delete.** `sessions.filters.*`, `sessions.actions.clearArchived` /
  `clearingArchived`, and the `emptyActive` / `emptyArchived` / `emptyForHost` empty states carry
  **English values in all 7 non-English locales** (the resource type requires key parity), each marked
  with a lag comment. The destructive confirm copy is not in i18n at all — it lives as pure English in
  `app/src/history/delete-dialogs.ts`, matching `clear-completed-subagents.ts`; translating it means
  deciding whether that whole family of dialog resolvers moves into i18n, which is a bigger call than
  one feature.

---

## Build order

**Waves 0–4 are complete** (Wave 4 landed 2026-07-25 in `beb4b833a`, minus its delayed item 1). This
section is the judgement layer over the inventory above: what to do next, and why that rather than
the highest-scoring item.

**Next up is not a wave — it is a release.** See [Toward 0.7.0](#toward-070) below.

### Four ordering traps that outrank raw scoring

1. **Upstream merge → subagent convergence → provider adapters is a fixed order.** It gets _more_
   expensive the longer it waits, not less. It is the last item whose whole point is reducing
   divergence cost.
2. **Measurement precedes the fix.** The FPS item cannot start before resource reporting exists.
3. **Shared instrumentation is built once.** The Visualizer's context ring and the usage log's View B
   need the same exact-injected accounting.
4. **A prerequisite-only refactor is not independently justified.** `session-decomposition` is an
   impact-1 refactor that only makes sense as `mobile-daemon`'s prerequisite. If mobile-daemon is not
   the pick, do not do it.

### Wave 3 — memory, the performance floor, polish (in flight)

Cut 2026-07-25. The four items touch different code on purpose.

1. ✅ **personality-memory** — done 2026-07-25. Pulled forward from Wave 4 and expanded. Impact is
   compounding: every spawn used to start from zero, so the same corrections got re-taught forever.
   Shipped design: [docs/agent-personalities.md § Memory](../docs/agent-personalities.md#memory-accrued-lessons).
2. 🔄 **App-wide FPS degradation** — the spine, and the only item still open. The instrument came
   first as planned: `app/src/diagnostics/resource-report/`, `client/daemon-client-runtime-metrics.ts`,
   and a soak harness (`e2e/client-resource-soak.spec.ts` + `e2e/helpers/resource-monitor.ts`). The
   fix is being wrapped up. Trap 2 held — nothing was optimized before it was measured.
3. ✅ **System-injected delivery decision** — done. Mentions and notify-on-finish queue; the schedule
   case turned out to be a different question and is tracked above. Both steer-queue tails (reorder,
   interrupt receipt) shipped with it.
4. ✅ **References and sources index** — done. [docs/references.md](../docs/references.md). Explicitly
   groundwork for the Wave 5 candidate below.

**Dropped from this wave:** computer-use Phase 0, deferred by the product owner — the vision
capability is not the current focus.

#### personality-memory — the settled design (shipped)

These seven decisions were the spec, and all seven are built. The architecture they produced is
[docs/agent-personalities.md § Memory](../docs/agent-personalities.md#memory-accrued-lessons),
which also records what was considered and rejected. Kept here because the decisions themselves are
the reasoning, and the charter has drained to `archive/`.

- **Underneath, these are just stored memories.** No exotic representation.
- **Recording is fire-and-forget.** The agent states what it learned; the system handles storage,
  dedup and placement. No ids to track, no index to maintain. _If recording is harder than that,
  agents will not do it_ — this is the load-bearing constraint.
- **A "review lessons" tool** reads the accrued set back, forms updates, and asks the user clarifying
  questions in a session, rewriting the lesson from the answers. This is how lessons improve instead
  of accumulating as noise.
- **Context Management is the one place** to see and manage them, with a selector for _which
  personality you are viewing context for_. Entries are editable there.
- **Personality dialogs show accrual, not management** — enough that you would not delete one
  casually, but not full CRUD. A deliberate scope limit.
- **Deleting a personality offers delete _or transfer_** of its lessons to another personality.
  Required, not a follow-up — accrued knowledge must not be silently destroyed.
- **Injected context must be inspectable.** Memory is only trustworthy if you can see it.

### ✅ Wave 4 — provider parity and continuity — COMPLETE (2026-07-25)

**Dispatched without item 1**, which the product owner delayed; items 2, 3 and 4 ran in parallel and
all landed in `beb4b833a`. Two project folders drained and left (history-management,
total-token-accounting), which is rule 4 working as intended.

The wave's own header said "provider parity", and with item 1 delayed **that is not what shipped** —
what shipped was the Solution view, history delete, honest token totals and the context wiring. Worth
naming: the parity thesis is now a wave behind, not discharged.

**Standing note on item 1.** Its cost is monotonically increasing, and Wave 3 widened the gap on
purpose — personality memory has no upstream counterpart to merge against, and the Wave 5 candidate
would widen it much further. It is the last item whose whole point is reducing divergence cost, so
every wave it waits, it buys less. Delaying it is a legitimate call; forgetting it is not. Note its
own charter still records itself as blocked on upstream `v0.2.0` being untagged — **that is stale**,
upstream has since tagged `v0.2.0` and `v0.2.1`. There is also a setup step: this checkout has no
`upstream` remote (only `origin` and `agentflow`).

1. ⏸️ **Upstream merge → subagent convergence → provider adapters** (trap 1, non-negotiable
   order) — **delayed by the product owner, 2026-07-25.** Not being taken this wave. Its cost keeps
   rising while it waits, so it is the first thing to reconsider when the wave reopens.
2. **Shared context instrumentation** — the Visualizer readout and the usage log (trap 3). **Trap 3
   is largely already discharged**; see the correction below.
3. ✅ **total-token-accounting** and ✅ **history-management** — trust and tidiness. Both shipped
   2026-07-25; history-management once its decision gate was answered (see below). Accounting rules
   folded into [docs/subagent-accounting.md § Chat totals](../docs/subagent-accounting.md#chat-totals-one-honest-number-per-chat)
   and the spend/occupancy/cost vocabulary into [docs/glossary.md](../docs/glossary.md).
4. ✅ **solution-view Phase 1** — done 2026-07-25, together with the Phase 0 groundwork it needed.
   The read-only Solution lens, its sidecar and its switch; architecture in
   [docs/solution-view.md](../docs/solution-view.md), remaining phases in
   [Open work](#editor--code-intelligence). Impact was provider-shaped in the same way the adapters
   are: a 5 for .NET developers, a 1 for everyone else. Phase 2 (general file mutations) is not .NET
   work and enables mutation paths beyond it.
   `claude-extensions` belongs to **Wave 5**, not here — product owner's call, 2026-07-25. It is
   deliberately Claude-only, which would have blurred the meaning of a wave whose whole theme is
   provider parity, and it would have competed for the same hours as item 1 without item 1's compounding
   cost. See its treatment under Wave 5 below.

#### Correction: the context instrumentation is mostly built (2026-07-25)

The [visualizer-node-richness](visualizer-node-richness/visualizer-node-richness.md) charter says the
ring and bar are blank because the adapter omits `contextBreakdown`, over a fixed 5-way breakdown
(`systemPrompt · userMessages · toolResults · reasoning · subagentResults`). **Both halves of that are
now wrong**, and the charter needs correcting:

- **The accounting exists.** `agent.context.get_usage` (`COMPAT(agentContextUsage)`, v0.3.4) returns
  `{ categories: [{ name, tokens, isDeferred? }], totalTokens, maxTokens }`. Categories are
  **provider-supplied display labels**, an open-ended list — not a fixed enum. Three providers report
  it (Claude, openai-compat, Pi); Codex, Copilot and OpenCode do not. Two surfaces already render it:
  `context-window-meter.tsx` and `context-management/summary.tsx`
- **The display changed.** `contextDisplay` is `'ring' | 'bar'` (default `ring`) and draws **one**
  readout, not both — the page used to show the same number twice. Sub-agent nodes never had a ring

So trap 3's "build the hard part once" is **already discharged**. What remains is narrower than the
charter implies: wire `breakdown` through `use-visualizer-event-adapter.ts` (which never sends it),
give the usage log the same numbers rather than a second path, and extend provider coverage.

#### Decided, then shipped: what delete does to provider data (2026-07-25)

history-management's `[PROPOSED]` gate was answered by the product owner. **Deleting a chat removes
Otto's record only; the provider's own transcript is left in place.** An opt-in switch to also delete
provider data was considered and **rejected** — _"that seems dangerous grounds."_ It was not built, and
no disabled placeholder for it exists.

Two consequences rode with that decision: the UI is **honest that the provider still has its
transcript** (leaving data recoverable is worthless if nobody knows it is there), and **bulk clear
carries the same rule** rather than becoming a back door in aggregate. The CLI's `agent delete` carries
the same semantics — a CLI that deletes more than the app would be the worst kind of surprise.

**Built the same day.** Per-row delete (long-press an archived row → destructive confirm), bulk
**Clear archived** with an All / Active / Archived filter, the `history.agents.clear_archived` sweep
(`dryRun` first, defaulting to true), the `features.historyDelete` gate, the react-query reconcile that
made deleted rows actually disappear, `--archived` / `--include-archived` on the CLI, and all four
retention bugs. Durable semantics — including what was rejected and why — live in
[docs/chat-lifecycle.md § Delete](../docs/chat-lifecycle.md#delete) and
[docs/activity-stats.md § Retention](../docs/activity-stats.md#retention). Charter drained to
`archive/projects/history-management/`; the remaining tails are in
[Open work → Git, changes & history](#git-changes--comments).

One decision the build added, worth not re-litigating: the sweep has **no `scope: "all"`**. Delete is
reachable only for a chat that was archived first, and that is enforced twice — the app offers it only
on an archived row, _and_ `selectArchivedForDeletion` refuses any record without an `archivedAt`
whatever the cutoff. The dangerous branch was never built, so it cannot be reached by accident.

#### Readiness, item by item (checked 2026-07-25)

| Item                              | Ready?               | What actually gates it                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. upstream merge → convergence   | ✅ **now unblocked** | The convergence charter records "blocked on the Phase 1 merge landing (upstream `v0.2.0`, currently untagged)". **That blocker is stale** — upstream has tagged `v0.2.0` and `v0.2.1`. Setup step first: this checkout has no `upstream` remote (only `origin` and `agentflow`)                                                                            |
| 1b. provider adapters             | ✅ ready, cheap      | The contract is two events plus one optional method, and nothing in the protocol, daemon projection or client says "claude". Per-provider sub-agent accounting rides the same stream. The risk is all in convergence, not here                                                                                                                             |
| 2. shared context instrumentation | 🟡 half done         | Visualizer ring ✅ 2026-07-25 — unified onto the provider's own accounting (`AgentUsage.contextCategories`, open-ended labels), so the ring and the context meter read one source. **Trap 3 was wrong:** View B does _not_ share this accounting — it needs Otto's own prompt-assembly instrumentation, which no provider can report. See the View B entry |
| 3a. total-token-accounting        | ✅ **shipped**       | Built 2026-07-25 on the 2026-07-17 audit. The audit's four findings held, plus a fifth it missed: Pi and OpenCode report a running SESSION total, so the ledger re-booked it every turn. Charter drained                                                                                                                                                   |
| 3b. history-management            | ✅ **shipped**       | The `[PROPOSED]` set was answered 2026-07-25 and built the same day (Phases 0, 1 and 3; Phase 2 was deleted outright by the answer, not deferred). Open tail: multi-select, auto-retention, i18n. Charter drained                                                                                                                                          |
| 4. solution-view Phase 1          | ✅ **done**          | Built 2026-07-25. The spike's 193 KB estimate landed at 257 KB once `Microsoft.Build.Locator` was in; two corrections came out of finishing it — `RollForward=LatestMajor` is required (a `net8.0` payload will not start on a .NET 9/10-only host), and Buildalyzer was rejected on measurement                                                           |

**The shape this implies.** Item 1 is the wave — it is the only item whose cost rises with delay, and
its stated blocker just cleared. Items 3a and 3b are **done**; item 2 is half done. What remains of
the wave is item 1, the usage log's View B, and item 4, all spawn-ready today.

### Toward 0.7.0

**27 commits are unreleased against `v0.6.7`** — Waves 2, 3 and 4 in their entirety. That is a
genuinely larger product cut than a patch: Refine, the full LSP set, the steer queue, personality
memory, the Solution view, history delete, honest token totals, AsciiDoc, mermaid, resource
reporting. Note the release playbook's standing rule — **releases are always patch unless the product
owner says "minor"** ([docs/release.md](../docs/release.md)). This section is the argument that this
one is a minor; the call is not ours.

Four things are worth taking **before** the cut, in this order.

**1. The FPS fix — and it is blocked on one decision only.** This is the sharpest item on the board.
The investigation is complete and honest: the instrument exists, four hypotheses were retired by
measurement, and the cause is confirmed — **mounted workspace trees are never released**, costing
~35% of the frame rate at three workspaces and never recovering. But **the fix is not built**, and it
cannot start until someone answers: _evict cold workspace trees (LRU, remount on switch-back), or
keep today's retain-everything trade?_ That is a product decision about a real trade-off — instant
switch-back versus a frame rate that survives the day.

Shipping 0.7.0 with a measured 35% degradation and no fix would be the weakest part of an otherwise
strong release. Two cheaper sub-items can go with it and do not need the decision: navigation
refetching state the client already holds (the cheapest concrete win), and per-agent eviction for
`agentStreamTail`/`agentStreamHead`.

**2. i18n — this is the translate moment.** The standing rule is _build first, translate last_, and
the last three waves were built English-first by design. The debt is now six entries in
[i18n](#i18n) and it is unusually well-characterised: the setup wizard, Refine and personality memory
shipped English-only; the Solution view and history delete carry **English strings seeded into all
seven non-English locales** because the resource types require key parity. A release is exactly the
moment that debt is meant to be paid — after this, the seeded-English keys are indistinguishable from
translated ones without reading the lag comments.

One decision hides inside it: history delete's destructive confirm copy is not in i18n at all, and
translating it means deciding whether that whole family of dialog resolvers moves into i18n. That is
a bigger call than one feature — settle it deliberately or leave it out deliberately, not by default.

**3. The six owed fold-ins.** Rule 4 says a shipped project cannot leave until its durable facts
reach `docs/`, and six are outstanding — context-management, refine, site-demos, e2e-qa-coverage,
workflow-decomposition, visualizer-node-richness. Cheap, and it is the difference between `projects/`
being a ledger and being a graveyard. Cutting a release over an unreconciled tree is how the next
assessment starts with "five charters disagree with the code".

**4. A real pass over what shipped.** Three waves landed largely in parallel sessions against a
shared tree. Nothing has exercised Refine, the Solution view, history delete and the steer queue
_together_ under one user's hands. The e2e tiers exist for this; use them.

**Explicitly not before 0.7.0:** the Wave 5 bets below, and the upstream merge chain. The merge is
the one thing whose cost keeps rising — but starting it days before a release cut is how a release
slips.

### Wave 5 candidate — agentic architectures for coding tasks

Added 2026-07-25. **The thesis:** once the IDE-grade platform is solid — coding tasks executed,
shown, and reviewable by a human — the orchestration system is unlocked, and the payoff is _reusable
coding pattern templates_: structures for building software features that replace the growth pains of
bad prompting and ad-hoc AI use. It is the reason the platform work came first, not a separate
ambition.

This is a wave-scale architecture consolidation, not a feature. It builds on
[agent-orchestration](agent-orchestration/agent-orchestration.md) (the control layer) and the built
graph engine and designer. Its groundwork is
[docs/references.md](../docs/references.md) — specifically
[§12, the ordered reading list](../docs/references.md#12-reading-list-for-the-agentic-coding-templates-initiative),
which exists for exactly this.

**Against Wave 5's "pick one" rule:** this and agent-orchestration are not independent bets.
Agent-orchestration is the substrate this stands on, so if this is the direction, that is the pick.

### Wave 5 — the big bet

Pick **one** of agent-orchestration or (session-decomposition → mobile-daemon). Both are
quarter-scale and both are strategically defensible; running them concurrently in one shared working
tree is not.

**Alongside the big bet: [claude-extensions](claude-extensions/claude-extensions.md).** Added
2026-07-25 at the product owner's direction. Full plugin, marketplace, skill and MCP management in
the Claude provider settings panel — the most-asked-for capability Otto does not have, and today the
one thing you still have to leave the app and SSH into the host to do.

It does **not** consume the pick-one slot. That rule exists because two quarter-scale bets cannot
share one working tree; this is roughly seven to nine sessions across five independently shippable
phases, and it touches disjoint code — the Claude provider adapter and one settings sheet, neither of
which the orchestration or mobile-daemon work goes near.

**The scope is enablement, not CRUD.** Install/remove is the floor. The reason this earns a wave slot
is the context budget: `claude plugin details` reports each plugin's always-on token cost, nothing in
Claude Code totals it across everything installed, and users accumulate plugins for months without
knowing what they pay before typing a word. Otto can total it, rank by it, and put it next to the
Disable button — the same move [docs/token-economy.md](../docs/token-economy.md) makes everywhere
else. That ships in Phase 1, not later. Behind it: installed-vs-actually-loaded (Otto is the only
place that knows both), MCP failures reported as cause-and-next-action rather than a red dot, and a
plugin authoring loop built on `plugin eval --json`, which scores against a no-plugin baseline.

Three things to settle before the phase that needs them, not during it: whether v1 shows user-scope
only (the provider settings sheet is host-level, but plugins and MCP servers can be project-scoped);
how the token-cost presentation stays unified with context-management's open "skills/MCP toggles"
tail — two surfaces will describe the same context consumption in different units if nobody decides;
and the default cost ceiling for `plugin eval`, which spends real money per run.

### ⚠️ Divergence from upstream Paseo

The fork has always aimed to keep merge capability with upstream
([docs/upstream-merges.md](../docs/upstream-merges.md)), **and we are nearing the divergence point.**
The waves above are what push past it — personality memory, an agentic orchestration layer and a
per-personality context model have no upstream counterpart to merge against.

Two consequences worth acting on rather than discovering later:

- The trap-1 ordering gets **more** expensive the longer it waits.
- **Watch for anything that silently forfeits merge capability.** A concrete instance: a literal NUL
  byte in a string makes git treat the whole file as **binary** — no textual diff, no 3-way merge.
  Use the `"\0"` escape instead. Two files have hit this.

## Deferred indefinitely

Not dead, but not scheduled, and not to be picked up opportunistically:

multiplayer · Visualizer Arena mode · computer-use beyond Phase 0 · bug-reporting (a different user
than ours) · git-hosting GitLab (until a GitLab user exists) · LSP Phase 4 / Angular · workspace-level
reconciliation of pre-guard duplicate base workspaces (no standing duplicates observed).

**Closed — do not re-open:** duplicate base workspaces. The investigation closed with the verdict
_prevent and steer to a worktree_, which is already the shipped policy; its three execution gaps were
fixed and the behaviour is documented in
[docs/workspace-lifecycle.md](../docs/workspace-lifecycle.md). Listed here only so it is not
rediscovered as new work. Folder: `archive/projects/duplicate-base-workspaces/`.

## Owed fold-ins

Shipped work whose durable facts have **not yet** reached `docs/`. Each is a debt against rule 4 —
until it is paid, the project folder cannot leave.

| Project                                                                          | Owes                                                                                                                                     |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [context-management](context-management/context-management.md)                   | A `docs/context-management.md`: the inventory model, % of context window as the severity unit, the three-pane tab, the load-mode control |
| [refine](refine/refine.md)                                                       | A `docs/refine.md`: the propose-then-accept invariant, the job-tab shape, the document/reference set model, prose-only scope             |
| [site-demos](site-demos/site-demos.md)                                           | A `docs/site-demos.md`: the capture pipeline as process knowledge                                                                        |
| [e2e-qa-coverage](e2e-qa-coverage/e2e-qa-coverage.md)                            | A tiers section in [docs/testing.md](../docs/testing.md)                                                                                 |
| [workflow-decomposition](workflow-decomposition/workflow-decomposition.md)       | A note in [docs/subagent-accounting.md](../docs/subagent-accounting.md)                                                                  |
| [visualizer-node-richness](visualizer-node-richness/visualizer-node-richness.md) | The shipped discovery cards belong in [docs/visualizer.md](../docs/visualizer.md)                                                        |
