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
2. **No progress documents.** No findings files, no work-package reports, no dated batch triage, no
   second registry. Progress is a row in this file. If a document only records _what happened_, it
   does not belong in the tree — its conclusions go into the charter or into `docs/`, and the
   document is dropped.
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

| Project                                                                                         | Status             | What it is                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [agent-orchestration](agent-orchestration/agent-orchestration.md)                               | Charter            | The **control layer** — Teams as the way work is invoked, typed tasks, recognize → plan → delegate → synthesize. Quarter-scale. Companion: [invocation.md](agent-orchestration/invocation.md)                                       |
| [bug-reporting](bug-reporting/bug-reporting.md)                                                 | Charter            | In-app bug/suggestion reporting; the daemon files the GitHub issue so reporters need no account                                                                                                                                     |
| [claude-extensions](claude-extensions/claude-extensions.md)                                     | Charter            | Full plugin, marketplace, skill and MCP management from the Claude provider settings panel. **Deliberately Claude-only** — plugins are a Claude Code product concept, not a general agent one                                       |
| [computer-use](computer-use/computer-use.md)                                                    | Charter            | Agents see and control the desktop via a shared computer-control library; layered safety. Companion: [computer-control-library.md](computer-use/computer-control-library.md)                                                        |
| [context-management](context-management/context-management.md)                                  | Partial            | Everything sent before you type, plus the 3-pane tab. Built and committed. Open: demote-to-subdirectory, skills/MCP toggles, the §11 calibration                                                                                    |
| [dictation-refine](dictation-refine/dictation-refine.md)                                        | Charter            | AI cleanup over dictated text via a latency-ordered ladder (lexical → ONNX → optional LLM)                                                                                                                                          |
| [editor-repo-conventions](editor-repo-conventions/editor-repo-conventions.md)                   | Charter            | Honour the repo's own `.editorconfig` without configuring Otto; repo wins file-shaped settings, user wins view-shaped ones                                                                                                          |
| [e2e-qa-coverage](e2e-qa-coverage/e2e-qa-coverage.md)                                           | Partial            | Full-app Playwright QA across 3 tiers (mock / local-AI / real provider). T1 and T2 green. Companions: coverage-matrix, local-ai-tier, reporting                                                                                     |
| [file-rendering](file-rendering/file-rendering.md)                                              | Partial            | IDE-grade file rendering. Mermaid shipped; AsciiDoc preview in flight. Companions: [asciidoc-preview.md](file-rendering/asciidoc-preview.md), [relative-image-resolution.md](file-rendering/relative-image-resolution.md)           |
| [history-management](history-management/history-management.md)                                  | Charter            | Delete and bulk-clear for archived chats (none exists today) plus 4 retention bugs                                                                                                                                                  |
| [inline-widgets](inline-widgets/inline-widgets.md)                                              | Charter            | In-message widgets — a `show_widget` tool carrying an HTML/SVG fragment rendered inline. Distinct from artifacts; reuses their sandbox                                                                                              |
| [marketing-strategy](marketing-strategy/marketing-strategy.md)                                  | Charter            | Otto's public voice (Philippe, first person) and the channels still to create                                                                                                                                                       |
| [mobile-daemon](mobile-daemon/mobile-daemon.md)                                                 | Charter            | Embedded API-native daemon on the phone ("This device" host); no CLIs                                                                                                                                                               |
| [multiplayer](multiplayer/multiplayer.md)                                                       | Charter            | Presence, entering each other's workspaces, opt-in follow — never forced mirroring                                                                                                                                                  |
| [observed-subagents](observed-subagents/observed-subagents.md)                                  | Partial            | Provider subagents promoted to read-only track rows. Claude proof shipped; generalizing is adapter-only work. **[provider-adapters.md](observed-subagents/provider-adapters.md) is the adapter contract** and is cited from `docs/` |
| [outreach](outreach/outreach.md)                                                                | Charter            | Awareness strategy, website-scoped. Sells nothing. Companions: channels, content, pipeline, runbook                                                                                                                                 |
| [preview-file-tabs](preview-file-tabs/preview-file-tabs.md)                                     | Charter            | VSCode-style preview tabs (transient vs pinned); web-only idiom                                                                                                                                                                     |
| [refine](refine/refine.md)                                                                      | Partial            | AI rewrite loop with review, as its own job tab. Prose only, never code. Built. Open: the Context Management call site, a conflict test, i18n                                                                                       |
| [sidebar-reveal](sidebar-reveal/sidebar-reveal.md)                                              | Partial            | Increment 1 (reveal primitive) shipped. Increment 2 (tutorial create-workspace step) unbuilt — this folder holds the only plan for it                                                                                               |
| [site-demos](site-demos/site-demos.md)                                                          | Partial            | Marketing-site demo assets — staged repos, Playwright capture pipeline. Companion: [runbook.md](site-demos/runbook.md)                                                                                                              |
| [solution-view](solution-view/solution-view.md)                                                 | Charter (approved) | A second Files lens showing the tree as the build system sees it (.NET first), behind its own switch. "Solution", never "Project"                                                                                                   |
| [total-token-accounting](total-token-accounting/total-token-accounting.md)                      | Charter            | One honest per-chat token total, surfaced in a chat metrics toolbar                                                                                                                                                                 |
| [upstream-subagent-convergence](upstream-subagent-convergence/upstream-subagent-convergence.md) | Charter            | Stop forking upstream's provider-subagent ingestion — take theirs verbatim, project it into Otto's observed model                                                                                                                   |
| [visualizer-node-richness](visualizer-node-richness/visualizer-node-richness.md)                | Partial            | Discovery cards shipped. Open: the context-composition ring                                                                                                                                                                         |
| [visualizer-pip](visualizer-pip/visualizer-pip.md)                                              | Partial            | Audio-while-closed shipped. Open: PIP window, Arena mode                                                                                                                                                                            |
| [web-search-providers](web-search-providers/web-search-providers.md)                            | Charter            | Selectable web-search engine for the openai-compat provider settings panel                                                                                                                                                          |
| [workflow-decomposition](workflow-decomposition/workflow-decomposition.md)                      | Partial            | Decompose a Claude Workflow run into per-`agent()` observed-subagent rows. Path B built and live-verified                                                                                                                           |

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
- 🟡 **The context-composition ring.** Needs real daemon accounting plus a provider fallback ladder.
  Shares its instrumentation with the usage log's View B — do that instrumentation once.

### Performance

- 🔴 **App-wide FPS degrades over time.** The Visualizer stays smooth while the rest degrades, which
  points at the JS thread, a leak, or daemon backpressure — **not** the GPU. Measure first.
- 🟡 **No resource reporting at all.** Memory and handle accounting across workspaces, chats, tabs,
  visualizers and diffs, plus overload protection. This is the instrument for the FPS item, so it
  comes first.

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
  does not exist yet, shared with the Visualizer's context ring. Also deferred: cursor pagination
  beyond "load more", and provider/kind filters.
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

---

## Build order

Waves 0–2 are complete. This section is the judgement layer over the inventory above: what to do
next, and why that rather than the highest-scoring item.

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
2. **App-wide FPS degradation** — the spine. Measurement-first: build the resource reporting, _then_
   find the leak.
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

### Wave 4 — provider parity and continuity

1. **Upstream merge → subagent convergence → provider adapters** (trap 1, non-negotiable order).
   Impact is conditional: transformative for OpenCode/Codex/Pi users, invisible to Claude users.
2. Shared context instrumentation → the Visualizer ring + usage-log View B (trap 3).
3. **total-token-accounting** and **history-management** — trust and tidiness.
4. **solution-view Phase 1** — the read-only Solution lens. Impact is provider-shaped in the same way
   the adapters are: a 5 for .NET developers, a 1 for everyone else. Phase 2 (general file mutations)
   is not .NET work and enables mutation paths beyond it.

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
share one working tree; this is roughly six sessions across five independently shippable phases, and
it touches disjoint code — the Claude provider adapter and one settings sheet, neither of which the
orchestration or mobile-daemon work goes near.

Two things to settle before Phase 4 rather than during it: whether v1 shows user-scope only (the
provider settings sheet is host-level, but plugins and MCP servers can be project-scoped), and how
this reconciles with context-management's open "skills/MCP toggles" tail — two surfaces will describe
the same installed set and must not each grow their own read path.

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
