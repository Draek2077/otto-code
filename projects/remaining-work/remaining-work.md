# Remaining work — consolidated registry

The single place to see everything open. Aggregated from the live sources —
`projects/bug-batch-2026-07-24/`, `projects/bug-batch-2026-07-23/`,
`projects/todos/`, and the unbuilt charters in the CLAUDE.md Projects table.
(The older aggregators — a 2026-07-16 "bug bash" and 2026-07-17 "changeset
review" — were already drained/deleted per the "delete the folder once the batch
ships" convention, so they carry no open items.)

When you finish an item, strike it here **and** in its source doc. When a whole
source doc is drained, fold its keepers into `docs/` and delete the folder.

**For build order, see [prioritization.md](prioritization.md)** — this file is the
inventory of what is open; that one scores every initiative (scope / difficulty /
impact), records the four ordering traps, and lays out the Wave 0–4 sequence.

Legend: 🔴 bug · 🟡 feature/enhancement · 🔵 investigation/decision · ⚪ charter (unbuilt)

---

## Editor / markdown

- 🟡 **"Explain this to me" over a selection (AI, read-only)** — batch-07-24 #5.
  First AI action in the editor toolbar; uses `controller.getSelection()`
  (`editor-core.ts:501`); needs a provider-neutral daemon "explain snippet"
  capability streamed into a side panel/sheet. Not Refine (read-only). Open:
  render target, throwaway vs real turn, how much surrounding context. Shares the
  focused-controller dispatch path with the shortcut overhaul's "Full" stage.
- ✅ ~~**Go-to-definition — client bridge + multi-hit picker**~~ — SHIPPED.
  `getWordAtCursor` editor command (`word-at-cursor.ts`, unit-tested) + a
  toolbar action and Mod-B/F12 binding calling `code.symbols`; one hit jumps,
  several open `definition-picker-dialog.tsx`, none is a plain toast. Gated on
  `features.codeIndex` (`use-code-index-feature.ts`), which also corrected the
  outline and fuzzy-finder gates that were reading `projectSearch`. Folded into
  [docs/text-editor.md](../../docs/text-editor.md).
- ✅ ~~**Mermaid doesn't render in markdown preview**~~ — SHIPPED.
  ` ```mermaid ` fences render in chat, the viewer and the PR panel, plus `.mmd`/`.mermaid`
  files; web/Electron render in-page, iOS/Android in a self-contained webview payload.
  Durable facts folded into
  [docs/markdown-rendering.md](../../docs/markdown-rendering.md).
- 🟡 **LSP code intelligence — Phases 4–5** — Phases 1–3 complete (2026-07-25).
  `packages/server/src/server/lsp/` (uri / connection / registry / pool / documents /
  service) with a real `typescript-language-server` handshake and a real `csharp-ls` one;
  `code.definition` + `code.document.*` behind `features.lsp`; and a **Daemon → Code**
  settings section (master switch, per-language rows with cost copy, running-servers
  table with Stop). Go-to-definition is position-based now, with the ctags index demoted
  to the no-server fallback. **Never run against a live daemon** — every test is
  daemon-side or type-level. Open: Angular's second server per document (Phase 4), hover /
  references / rename / diagnostics (Phase 5), and a live pass over the editor path and
  the settings screen. Charter:
  [lsp-code-intelligence.md](../lsp-code-intelligence/lsp-code-intelligence.md).
- 🔵 **Verify caret auto-scroll follow + search-match-scroll fixes** — batch-07-23.
  Both marked fixed but carry "verify on the live repro across plain and split
  mode before deleting the note." (See memory `editor-caret-follow-reassert`.)

## Keyboard shortcuts

- ✅ ~~**Full shortcut overhaul + "File Editor" section**~~ — batch-07-24 #8. SHIPPED.
  A **File Editor** section in `SHORTCUT_BINDINGS` (save / find / go to line / go to
  definition + F12 alias / find references Shift+F12 / rename symbol F2), all
  `focusScope: "code-editor"`; `bindingSpecificity` in the matcher so a binding that
  names the focused surface beats an unscoped one on the same combo; and
  `editor/editor-key-bindings.ts` turning the user's _effective_ File Editor rows into
  the CM6 keymap (own `Compartment`, so a rebind lands without a remount). `editor.*`
  routes nowhere on purpose — matching-then-doing-nothing is what makes the shadowed
  general action stand down. `codeEditor: false` is gone: a hardcoded guard could not
  follow a rebind. Durable rules folded into
  [docs/text-editor.md](../../docs/text-editor.md#keyboard-shortcuts-the-file-editor-scope).
  Deferred from the plan: the "Full" dispatch stage (§4) — CM6 stays the executor, which
  batch-07-24 #5's focused-controller path can revisit — and the dev-friendliness audit
  (§6), now much smaller since the section removes the reason for per-binding guards.

## Git / Changes / comments

- ~~🔴 **"Push" disabled after commit — GitHub only (Bitbucket fine)** — batch-07-24 #2.~~
  **FIXED.** The PR-status poll now tags its emission `prStatusOnly`
  all the way to the wire, and every status payload carries `gitStateAt` (when the
  daemon measured the git block) so the client drops an out-of-order push instead of
  clobbering fresher git-tracking state. See
  [../bug-batch-2026-07-24/bug-batch-2026-07-24.md](../bug-batch-2026-07-24/bug-batch-2026-07-24.md).
- 🟡 **Resolved vs unresolved PR comments** — batch-07-23. Approved counts,
  unresolved/total, mark-resolved, comment→task. GitHub resolution lives on review
  threads (GraphQL `isResolved`), absent from the REST comment list. Capability bit
  first, GitHub as proof (`docs/git-providers.md`).
- 🔵 **Comment behavior across workspace operations is undefined** — batch-07-23.
  Needs a decision, not just a fix.
- 🔴 **Can't re-read your own file comments after sending** — batch-07-23.
  Reopening the comment tile should show its contents. Marked "not critical."
- 🔵 **Changes-view base: auto-fetch decision + non-worktree override** — the rest of
  `projects/diff-base/`. Phases 1 (fork-point base resolution) and 2 (per-worktree
  base override, `features.worktreeDiffBase`) shipped 2026-07-24; semantics live in
  `docs/changes-view.md`. Left: (a) **product decision** — does a read-only view get a
  throttled background `git fetch` of the base? Without one, a base ref nobody updates
  stays stale and merge-base math cannot help. (b) Plain (non-worktree) checkouts have
  nowhere to store a base override — needs a second store keyed by workspace, and that
  store would have to feed `resolveBaseRefForCwd` or the base stops being one source of
  truth for merge/PR. (c) Phase 3 polish: suggest a detected stacked parent in the
  picker; "base is N behind origin" hint chip (depends on (a)).

## Background tasks / Subagents

- ✅ ~~**Sub-agent row liveness — tool-use count + current tool**~~ — subagent-liveness
  6b/6c. SHIPPED 2026-07-25, draining the charter (folder deleted). Additive optional
  `toolUseCount` + `currentTool` on the agent snapshot; provider-reported for observed
  rows, timeline-derived where no task report exists. Row now reads
  `elapsed · tokens · N tools · Tool`. See
  [docs/chat-lifecycle.md](../../docs/chat-lifecycle.md#the-subagents-track).
- 🔵 **Possible double-counting of background tasks + sub-agents** — batch-07-23.
  Check whether a provider emits one unit into both `backgroundShellTasks` and the
  subagents track.
- 🔴 **Research personality paused for plan approval instead of returning its result**
  — batch-07-23. Sub-agent hit `ExitPlanMode`, got approval, then stopped rather
  than handing its report up. A research-role personality probably shouldn't have
  the plan-exit tool in scope. See `docs/safe-unattended.md`, `projects/observed-subagents/`.
- 🟡 **Promote an unattended run on a guardrail denial + denial timeline entry** —
  `projects/todos/unattended-denial-promote.md`. Closes a `TODO(safe-unattended Phase 3)`
  in `agent-manager.ts` (~L4108). Daemon-only.
- 🟡 **Bind a personality to a schedule from the client form** —
  `projects/todos/schedule-form-personality-binding.md`. Server shipped; client form
  has no personality field. Product decision first (persisted re-resolve vs one-time
  fill). Gate on `features.agentPersonalities`.

## Visualizer

- 🔴 **Actions disappear while still running** — batch-07-23. Long bash/read/write
  shows, hides, reappears on completion. Suspected fixed-TTL node vs lifecycle tied
  to the tool call.
- 🟡 **Discoveries should fade; their colors read as wrong/unexplained** — batch-07-23.
  Owned by `projects/visualizer-node-richness/`.
- 🟡 **Skill activation isn't shown at all** — batch-07-23. No node/badge on skill fire.

## Composer

- ~~🟡 **Queued messages should merge into one send** — batch-07-23. Interacts with
  `projects/steer-queue/`.~~ — FIXED (2026-07-25, shipped with steer-queue). Consecutive
  **user** messages in the queue are delivered as ONE turn, joined in FIFO order with a
  blank line; images/attachments concatenate and the head entry's `runOptions` win. Three
  notes dropped during a long turn are one instruction set, not three — and separate turns
  paid a full context re-send each. System-injected entries (mentions, schedule fires,
  notify-on-finish, agent-to-agent sends) never merge. See `docs/chat-lifecycle.md`
  (Delivery).
- ~~🔴 **Large pasted code blocks overflow the composer** — batch-07-23. Pushes the
  send button off-screen; needs max-height + internal scroll.~~ — FIXED. The cap
  and the internal scroll existed but were measured against the window, not the
  pane, and covered only the text input. `composer/input/max-height.ts` now bounds
  the whole composer against a host-measured viewport (0.5 regular / 0.4 compact,
  less 68px of chrome). See `projects/bug-batch-2026-07-23/` item 13.

## Performance / resource management

- 🔴 **App-wide FPS degrades over time** — batch-07-23. Visualizer stays smooth while
  the rest degrades → JS thread / leak / daemon backpressure, not GPU. Measure first.
- 🟡 **No resource reporting at all** — batch-07-23. Memory/handle accounting across
  workspaces/chats/tabs/visualizers/diffs + overload protection. The instrument for
  the FPS item. Related: `docs/activity-stats.md`, `docs/terminal-performance.md`.

## Onboarding / UX

- 🟡 **Vertical tab rail — Step 8 polish** — `projects/todos/vertical-tabs-rail-polish.md`.
  5 pull-offs: rail chip styling, cross-pane drag indicator, non-split desktop
  fallback, i18n extraction, on-device verification.
- ⚪ **In-app bug/suggestion reporting** — batch-07-23 / `projects/bug-reporting/`.
  Anonymous free text + optional environment pickers. Chartered, not started.

## Other

- 🟡 **Themed avatar image set for agent teams** — `projects/todos/agent-teams-themed-avatars.md`.
  Schema reserved (`AgentTeamAvatarSchema.imageId`); need ~2 dozen keyed image assets,
  render `imageId` everywhere (fallback to color), picker grid in
  `agent-teams-section.tsx`. No protocol work.
- 🔴 **Files module flashes an error referencing a stale URL** — batch-07-23. Likely a
  cached query/path or a persisted tab pointing at a dead path. Needs a repro.
- ⚪ **Dead i18n cleanup from the edit-outside change** — batch-07-24. Now-dead
  `editor.outOfProject.editOutside*/editOther*` (8 locales) + `suppressOutOfProjectWarning`
  in `editor-prefs-store.ts`. Non-blocking sweep.
- ⚪ **i18n lag: worktree branch-cleanup + re-attach strings** — from the drained
  worktree projects. Only `en.ts` has the branch-cleanup and re-attach keys; the 7
  non-English locales still lag. Batch translate pass. See `docs/chat-lifecycle.md`.
- 🟡 **Usage log: per-row context composition (View B)** — deferred from the drained
  usage-ledger project. Expanding a turn row would break down catalog / personality /
  team / CLAUDE.md contribution; needs exact-injected instrumentation that does not
  exist yet. Overlaps the `visualizer-node-richness` context-composition ring — do the
  instrumentation once. Also deferred there: cursor pagination UI beyond "load more",
  and provider/kind filters. See `docs/activity-stats.md`.
- ⚫ **Duplicate base workspaces — CLOSED AND ARCHIVED, do not re-open.**
  Investigation closed 2026-07-24; verdict **prevent and steer to a worktree**,
  which is already the shipped policy. Three execution gaps fixed the same day:
  the client steer (`new-workspace-occupied-directory.ts` — Open it / Create a
  worktree), the schedule-reveal occupancy bypass (`schedule-workspace-reveal.ts`
  — reattach instead of reveal), and the stale same-`cwd` e2e tests (two of them,
  plus the Windows `EPERM` teardown that was masking the failures). Behaviour is
  documented in `docs/workspace-lifecycle.md`. **Still deferred by choice:**
  workspace-level reconciliation of pre-guard duplicates — no standing duplicates
  observed, so it stays unbuilt. Folder in
  `projects/_archive/duplicate-base-workspaces/`; listed here only so it is not
  rediscovered as new work.
- 🔴 **Metro dies mid-E2E when Playwright churns `packages/app/test-results`** — found
  running the chat/composer iron-out batch (2026-07-24). Playwright's default
  `outputDir` sits **inside Metro's watched project root**, so when a run deletes its
  `.playwright-artifacts-N/traces/resources` scratch dir, Metro's watcher throws
  `ENOENT: ... watch '...test-results\.playwright-artifacts-0\traces\resources'`, the
  Expo CLI rethrows, and the bundler exits. Every later navigation then fails with
  `ERR_CONNECTION_REFUSED`, so specs report bogus navigation failures instead of their
  real result. Hits any second run in a checkout that still has artifacts on disk (and
  `test-results` can be left `Device or resource busy`, so it cannot simply be deleted).
  Workaround today: `E2E_OUTPUT_DIR=<path outside packages/app>`. Real fix: default
  `outputRoot` outside the Metro root, or add `test-results` to a Metro `blockList`
  (`packages/app` currently has **no** `metro.config.js`). `playwright.config.ts:10-17`
  already documents the sibling artifact-collision hazard — this is the same root cause
  killing the bundler rather than just the trace.
- 🔵 **Pinned metadata-generation providers silently fall through when the provider
  can't do a tool-less completion** — found via `chat-auto-title.spec.ts` (2026-07-24).
  Only `claude` and `openai-compat` implement `generateBareCompletion`; every other
  provider throws in `AgentManager.generateBareCompletion`
  (`agent-manager.ts:1794`) and the ladder moves on — by design
  (`generateStructuredAgentResponseWithFallback`). Consequence: a host that pins
  `metadataGeneration.providers` to such a provider gets its pin quietly bypassed and
  **another provider billed**. Confirmed live: the spec pins the chain to `mock`, the
  daemon logs `Structured generation: provider failed, trying next` and then
  `succeeded after fallback` with `provider: "claude"` — a real Claude call. Two
  angles: (a) product — should a pinned-but-incapable provider warn/surface rather than
  silently re-route spend? (b) test harness — the mock provider has no
  `generateBareCompletion`, so **no E2E can pin metadata generation deterministically**
  (titles, commit messages, branch names, voice cues, run summaries). The auto-title
  spec is therefore not hermetic and would likely fail on a runner without Claude auth.
- 🔵 **Do models volunteer suggested tasks at Claude Desktop's rate?** — from the
  drained suggested-tasks work. The trigger-first description rewrite (2026-07-20)
  fixed reachability; the open question is unprompted call _rate_ in real use. If it
  is still low, the next lever is prompt-level guidance rather than more description
  text. Persistence of cards across daemon restart is separately deferred (in-memory
  by design). See `docs/suggested-tasks.md`.
- 🔵 **Should system-injected prompts queue instead of interrupt?** — from the shipped
  steer-queue work. Chat @mentions, schedule fires, and notify-on-finish all still send
  `delivery: "interrupt"`, so they clobber a running turn. That is arguably a bug and the
  strongest correctness argument for the queue — but flipping it changes existing behavior
  on paths nobody asked to change, so it was left explicitly out of scope. Decide it on
  its own. See `projects/steer-queue/`. **Scheduled at the head of Wave 3** —
  [prioritization.md](prioritization.md) §5.
- 🟡 **Reorder queued entries** — steer-queue shipped the queue preview and per-item
  removal, but not drag-to-reorder. Small.
- 🟡 **Consume the Claude interrupt receipt** — SDK ≥ 0.3.212 resolves `query.interrupt()`
  to `{ still_queued: string[] }`, feature-detected via `interrupt_receipt_v1` in
  `system/init`. Captured and debug-logged today; nothing reconciles against it. Small,
  Claude-only.
- 🟡 **Refine Phase 4 — Context Management call site.** The one unbuilt phase of the Refine
  plan: the per-file action calling `openRefineTab({ path, presetId })`. The tab target
  already carries `presetId` and the panel already seeds from it, so this is a call site,
  not a feature. Also open: the conflict-path integration test (the `stale` phase writes
  nothing on conflict — written and typed, untested) and i18n. See `projects/refine/` §14.5.

---

## Unbuilt charters (Projects table)

Initiatives that are Charter / Plan / Investigation, not yet shipped — the long
backlog, tracked one folder each:

first-time-wizard · computer-use · dictation-refine · observed-subagents (rest) ·
session-decomposition · mobile-daemon ·
file-rendering · web-search-providers · site-demos · personality-memory ·
preview-file-tabs · total-token-accounting · workflow-decomposition ·
visualizer-node-richness (context ring) · history-management · context-management ·
visualizer-pip · upstream-subagent-convergence · solution-view (charter v3 approved) ·
git-hosting-providers (GitLab+) ·
git-file-history (presentation) · e2e-qa-coverage (build-out) ·
marketing-strategy · outreach _(non-product)_.

---

## Recently drained (for reference)

`bug-batch-2026-07-24` fixed: clear-tasks no-confirm, completed-group gap, editor
Ctrl+S save, edit-outside → red banner, **darker editor background**, **copy path
full+relative**. Remaining from that batch are #2/#5/#8 above.

**Project folders drained + deleted 2026-07-24** (shipped, committed, facts folded
into `docs/` per the projects/ lifecycle rule): `usage-ledger` → `docs/activity-stats.md`;
`worktree-archive-branch-cleanup` + `worktree-reattach` → `docs/chat-lifecycle.md`;
`suggested-tasks` + `suggested-task-visibility` → new `docs/suggested-tasks.md`. Their
residual open items are listed under **Other** above. Note `sidebar-reveal` was
_considered_ and deliberately kept — its Increment 1 primitive shipped, but the
tutorial create-workspace step (Increment 2) is unbuilt and that folder holds the
only plan for it.
