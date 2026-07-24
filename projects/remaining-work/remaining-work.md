# Remaining work — consolidated registry

The single place to see everything open. Aggregated from the live sources —
`projects/bug-batch-2026-07-24/`, `projects/bug-batch-2026-07-23/`,
`projects/todos/`, and the unbuilt charters in the CLAUDE.md Projects table.
(The older aggregators — a 2026-07-16 "bug bash" and 2026-07-17 "changeset
review" — were already drained/deleted per the "delete the folder once the batch
ships" convention, so they carry no open items.)

When you finish an item, strike it here **and** in its source doc. When a whole
source doc is drained, fold its keepers into `docs/` and delete the folder.

Legend: 🔴 bug · 🟡 feature/enhancement · 🔵 investigation/decision · ⚪ charter (unbuilt)

---

## Editor / markdown

- 🟡 **"Explain this to me" over a selection (AI, read-only)** — batch-07-24 #5.
  First AI action in the editor toolbar; uses `controller.getSelection()`
  (`editor-core.ts:501`); needs a provider-neutral daemon "explain snippet"
  capability streamed into a side panel/sheet. Not Refine (read-only). Open:
  render target, throwaway vs real turn, how much surrounding context. Shares the
  focused-controller dispatch path with the shortcut overhaul's "Full" stage.
- 🟡 **Go-to-definition — client bridge + multi-hit picker** — `projects/todos/editor-go-to-definition.md`.
  Daemon `code.symbols` RPC (behind `features.codeIndex`) is shipped; the client
  never calls it. Add word-under-cursor resolution, a "Go to definition" action,
  and a picker (reuse `refactor-dialog.tsx`) for >1 hit.
- 🔴 **Mermaid doesn't render in markdown preview** — batch-07-23. Chartered by
  `projects/file-rendering/file-rendering.md`.
- 🔵 **Verify caret auto-scroll follow + search-match-scroll fixes** — batch-07-23.
  Both marked fixed but carry "verify on the live repro across plain and split
  mode before deleting the note." (See memory `editor-caret-follow-reassert`.)

## Keyboard shortcuts

- 🟡 **Full shortcut overhaul + "File Editor" section** — batch-07-24 #8.
  **Detailed plan: [keyboard-shortcut-overhaul.md](keyboard-shortcut-overhaul.md).**
  Editor shortcuts become first-class, customizable, and override general Otto
  bindings while the editor is focused (specificity in the matcher; registry→CM6
  bridge). The acute Cmd+S=Save fix already shipped this batch.

## Git / Changes / comments

- 🔴 **"Push" disabled after commit — GitHub only (Bitbucket fine)** — batch-07-24 #2.
  Root-caused: push policy is correct (`git/policy.ts:576`); the GitHub PR-status
  poll re-broadcasts a full `checkout_status_update` from stale `target.latestGit`
  (`workspace-git-service.ts:1776-1822` → `checkout-session.ts:401-422`) that wins
  the post-commit race and ships `aheadOfOrigin: 0`; client overwrites
  unconditionally (`checkout-status-cache.ts:36-51`). Fix server-side (poll must
  not publish git-tracking state) + defense-in-depth client guard.
- 🟡 **Resolved vs unresolved PR comments** — batch-07-23. Approved counts,
  unresolved/total, mark-resolved, comment→task. GitHub resolution lives on review
  threads (GraphQL `isResolved`), absent from the REST comment list. Capability bit
  first, GitHub as proof (`docs/git-providers.md`).
- 🔵 **Comment behavior across workspace operations is undefined** — batch-07-23.
  Needs a decision, not just a fix.
- 🔴 **Can't re-read your own file comments after sending** — batch-07-23.
  Reopening the comment tile should show its contents. Marked "not critical."

## Background tasks / Subagents

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

- 🟡 **Queued messages should merge into one send** — batch-07-23. Interacts with
  `projects/steer-queue/`.
- 🔴 **Large pasted code blocks overflow the composer** — batch-07-23. Pushes the
  send button off-screen; needs max-height + internal scroll.

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
- 🔵 **Do models volunteer suggested tasks at Claude Desktop's rate?** — from the
  drained suggested-tasks work. The trigger-first description rewrite (2026-07-20)
  fixed reachability; the open question is unprompted call _rate_ in real use. If it
  is still low, the next lever is prompt-level guidance rather than more description
  text. Persistence of cards across daemon restart is separately deferred (in-memory
  by design). See `docs/suggested-tasks.md`.

---

## Unbuilt charters (Projects table)

Initiatives that are Charter / Plan / Investigation, not yet shipped — the long
backlog, tracked one folder each:

first-time-wizard · computer-use · dictation-refine · observed-subagents (rest) ·
subagent-liveness · steer-queue · session-decomposition · mobile-daemon ·
file-rendering · web-search-providers · site-demos · personality-memory ·
diff-base · preview-file-tabs · total-token-accounting · workflow-decomposition ·
visualizer-node-richness (context ring) · history-management · context-management ·
refine · visualizer-pip · upstream-subagent-convergence ·
duplicate-base-workspaces · git-hosting-providers (GitLab+) ·
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
