# Worktree re-attach, branch-aware leave, and swap-to-base

**Status:** BUILT (uncommitted, 2026-07-21). `cwd` stays immutable per decision;
this is a re-attach primitive, not a mutable-root refactor. Phase 1 (branch-aware
Leave) was already in the tree; Phases 2 (re-attach RPCs + server) and 3 (Reopen
worktree picker + Open base checkout) shipped in this pass. Server typecheck +
lint green; `worktree-reattach.test.ts` 6/6 green. i18n: English `en.ts` only per
house rule — the 7 non-English locales still lag (they were already missing the
branch-cleanup keys), to be synced in a batch translate pass.

## The problem

When a worktree workspace is "left" (archived from the sidebar), there is no way
back to it. The only restore path today is agent-tied: clicking an archived
**agent** in History triggers `unarchiveOwningWorkspaceForAgent`, which recreates
the worktree from its kept branch. If you are looking at the workspace rather than
an owning archived agent — or the worktree never had one — the worktree is
stranded.

The leave path is also quietly broken. Archiving a worktree workspace resolves
`repoRoot = null`, so `deleteOttoWorktree` **skips `git worktree remove` and
`git worktree prune`** and only `rm -rf`s the directory. Result: the directory is
gone, git keeps a **stale worktree registration** (phantom `git worktree list`
entry, branch pinned as "already checked out"), and the branch survives as an
incidental side effect the agent-restore path later exploits.

## The model (facts, immutable-`cwd` world)

- A workspace is one `PersistedWorkspaceRecord` with a single `cwd` (its root),
  `kind ∈ {local_checkout, worktree, directory}` re-derived from live git by the
  reconciler, plus `branch` / `baseBranch`. **`cwd` is set at creation and never
  mutated.** (`workspace-registry.ts`)
- A project groups a base checkout (`rootPath`) and its worktree workspaces. An
  Otto worktree is a daemon-owned dir under `<ottoHome>/worktrees/<hash>/<slug>`.
- Invariant: **one directory = one live workspace** (`WorkspaceDirectoryOccupiedError`).
- Ownership (agents/terminals) is keyed by `workspaceId`, never `cwd`; agent
  storage is keyed by each agent's own snapshotted cwd. So a workspace's root is
  _technically_ movable, but we deliberately keep it immutable to preserve the
  occupancy guard and the reconciler contract.
- "Leave"/"detach" is **archive**; there is no separate detach verb for worktrees.

## Why the branch is a separate concern from the worktree

`git worktree remove` throws away the working directory; it **never** deletes the
branch, because the branch holds your commits. Deleting a branch is always an
explicit `git branch -d/-D`. So "clean up a worktree" splits by branch safety:

- **Merged / PR-merged / pushed-and-gone** → commits live on in the base; the
  branch is safe to delete. Full clean. (`auto-archive-on-merge` is precedent.)
- **Unmerged commits** → deleting the branch destroys work that exists nowhere
  else. Keep it. This kept branch is precisely what makes the worktree
  **re-attachable**.
- **Uncommitted changes** → the existing dirty-worktree warning
  (`confirmRiskyWorktreeArchive`).

Re-attach is therefore the escape hatch for the unmerged-branch case — the one
case where we intentionally leave something behind — not a keep-everything default.

## Confirmed decisions

1. **Re-attach primitive, `cwd` immutable.** No mutable-root refactor.
2. **Branch-safety-tiered Leave.** Merged ⇒ delete dir + branch + prune. Unmerged
   ⇒ delete dir + prune (fixing the stale registration), **keep branch** by
   default, surface "kept branch `x` (N unmerged commits) — [Delete anyway]"
   (force `-D`). Dirty ⇒ existing warning. Merged branches delete automatically.
3. **Leftover-branch handling is in scope** (it _is_ the leave design above).
4. **Swap ⇄ base is navigation, not mutation.** Base is a `local_checkout`
   workspace; each worktree is its own workspace under the project. "Open base
   checkout" ensures/reveals the base workspace (occupancy-guarded); worktrees are
   already listed under the project.

## Plan (vertical slices)

### Phase 1 — Branch-aware Leave (server) + stale-registration fix — ALREADY BUILT (uncommitted)

**Discovery (2026-07-21):** this slice already exists in the working tree, so it is
NOT rebuilt here. It matches the confirmed policy exactly:

- `packages/server/src/server/workspace-archive-branch.ts` —
  `detectWorktreeArchiveBranch` (Otto-ownership + branch + merge state via
  `origin/<base>..branch` rev-list + `branchCheckedOutElsewhere`) and
  `deleteLocalBranch` (`git branch -D`).
- Wire: `workspace.archive.preflight.request/response` →
  `WorktreeArchiveBranchDetection` { isOttoWorktree, branchName, baseBranch,
  mergeState (merged|unmerged|unknown), unmergedCommitCount, hasRemoteBranch,
  branchCheckedOutElsewhere, directoryWillBeRemoved };
  `archive_workspace_request.branchDisposition: keep|delete` + response
  `deletedBranch`.
- App: `workspace/workspace-archive.ts`, `git/actions-store.ts`
  (`restoreWorktreeArchiveState`).

Remaining Phase-1 checks to verify (not rebuild): the confirm-dialog UX actually
consumes the preflight (surfaces "kept branch, N unmerged, [Delete anyway]"), and
the stale-registration cleanup on unmerged leave. Treat as done unless a gap shows.

### Phase 2 — Re-attach primitive (server + protocol)

- `worktree.reattach.list.request/response` — for a project, list re-attachable
  targets: archived worktree records with a kept branch **and** orphaned on-disk
  Otto worktrees (`otto_worktree_list` minus live-workspace-backed ones).
- `worktree.reattach.request/response` — revive a target: reuse
  `recreateOwningWorktreeForRestore` (git worktree add of the kept branch to its
  slug) and unarchive/mint the workspace record, emit `workspace_update` upsert.
- Capability flag `server_info.features.worktreeReattach` with a `COMPAT(...)` note.

### Phase 3 — Re-attach + swap UI (app)

- Project row: **"Reopen worktree…"** beside "New worktree" → picker of
  re-attachable targets (branch name, unmerged count, last active) → revive.
- Worktree workspace "…" menu: **"Open base checkout"** → ensure/reveal the
  project's base `local_checkout` workspace, then navigate.
- Leave confirm: show branch state; on unmerged keep, toast with **"Delete branch
  anyway."**
- i18n (English first per house rule), tests.

## Follow-on / out of scope

- Mutable workspace root (rejected for now; revisit only if users ask to move a
  single workspace's checkout in place).
- Workspace-level duplicate reconciliation (`merged_duplicate_workspace`) — noted
  in `projects/duplicate-base-workspaces`; complementary but separate.
