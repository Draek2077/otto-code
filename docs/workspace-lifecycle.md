# Workspace and worktree lifecycle

How a workspace is archived, how an Otto-owned git worktree is cleaned up or revived, and how a workspace's activity signal is computed.

**Workspaces are not chats.** A workspace is one concrete `cwd` on one daemon; a chat is a conversation surface that happens to live in one. They have independent lifecycles - the only coupling is ownership: archiving a workspace archives everything it owns, including its chats. Nothing here should be read as chat lifecycle; that lives in [chat-lifecycle.md](chat-lifecycle.md).

## Worktree archive, branch cleanup, and re-attach

"Leave"/"detach" on a worktree workspace **is** archive - there is no separate detach verb.

**The branch is a separate concern from the directory.** `git worktree remove` throws away the working directory but **never** deletes the branch, because the branch holds your commits; deleting one is always an explicit `git branch -d/-D`. So cleanup splits by branch safety:

| Branch state                         | Meaning                                         | Disposition                                    |
| ------------------------------------ | ----------------------------------------------- | ---------------------------------------------- |
| Merged / PR-merged / pushed-and-gone | Commits live on in the base                     | Safe to delete - full clean                    |
| Unmerged commits                     | Deleting destroys work that exists nowhere else | Keep - this is what makes re-attach possible   |
| Uncommitted changes                  | Dirty worktree                                  | Existing `confirmRiskyWorktreeArchive` warning |

**Flow: detect → surface → ask → act.** `workspace.archive.preflight.request` returns a read-only `WorktreeArchiveBranchDetection` - branch name, base branch (from `.git/otto/worktree.json`), merge state (`merged`/`unmerged`/`unknown` via `rev-list --count base..branch`), unmerged commit count, whether `origin/<branch>` still exists, `branchCheckedOutElsewhere`, and whether archiving actually removes the backing directory (last-reference). The client shows one confirm dialog with an "Also delete branch X" checkbox; the archive request then carries `branchDisposition: "keep" | "delete"` and the response echoes `deletedBranch`.

**The default: merged branches pre-check delete, everything else defaults to keep** - so commits are never discarded by inertia. We still always ask; this is never silent auto-removal. Force delete (`git branch -D`) is used regardless of merge state, because the user has already been shown the merge state and chosen, and git's own `-d` check compares against the upstream rather than the base branch the user actually saw - so `-d` would spuriously refuse. Deletion only happens on the last-reference path, so a directory still backing another workspace never loses its branch.

**Re-attach** is the escape hatch for the kept-branch case. `worktree.reattach.list.request` enumerates re-attachable targets for a project - archived worktree records with a kept branch, plus orphaned on-disk Otto worktrees (`otto_worktree_list` minus live-workspace-backed ones) - and `worktree.reattach.request` revives one via `recreateOwningWorktreeForRestore`, unarchiving or minting the workspace record. Before this existed the only restore path was chat-tied (clicking an archived chat in History triggered `unarchiveOwningWorkspaceForAgent`), so a worktree with no owning archived chat was stranded.

This also fixed a quiet leave bug: archiving a worktree resolved `repoRoot = null`, which skipped `git worktree remove`/`prune` and only `rm -rf`'d the directory - leaving a **stale worktree registration** (phantom `git worktree list` entry, branch pinned as "already checked out").

**`cwd` is immutable.** A workspace's root is set at creation and never mutated; this is a re-attach primitive, not a mutable-root refactor. Ownership (chats, terminals) is keyed by `workspaceId`, never `cwd`, so the root is _technically_ movable - we deliberately keep it fixed to preserve the one-directory-one-live-workspace guard (`WorkspaceDirectoryOccupiedError`) and the reconciler contract. Swapping between a worktree and its base is therefore **navigation, not mutation**: "Open base checkout" ensures/reveals the project's base `local_checkout` workspace.

**A workspace's backing directory is not its `cwd`.** Otto opens a workspace at the package it was
launched on, so one worktree routinely backs a record at `<worktreeRoot>` and another at
`<worktreeRoot>/packages/app`. Archiving resolves each record to its **backing directory** first
(`resolveWorkspaceBackingDirectory`), preferring the durable placement fields on the record
(`isOttoOwnedWorktree` + `worktreeRoot` + `mainRepoRoot`) and falling back to filesystem ownership
discovery for records written before those were stamped. Everything downstream keys off that
directory, never the raw `cwd`:

- **Last-reference** (`isDirectoryUnreferenced`) asks whether any active workspace still points at
  the directory, matching against both a record's `cwd` and its backing directory, realpath-aware so
  two spellings of one path (a symlinked temp dir, `/var` vs `/private/var`) cannot slip past. This
  is what stops an archive from deleting a worktree that a nested sibling is still live on, and the
  mirror case where archiving the nested record would take the whole worktree with it.
- **Archive-by-path** takes every record the directory backs, not only the ones whose `cwd` is
  spelled exactly like it. A record nested inside the worktree is just as dead once it is gone.
- **Teardown belongs to the record, not the directory.** A workspace that is going away runs its
  teardown commands even when the directory survives for a sibling, and runs them from its own `cwd`
  so a nested `otto.json` teardown block is actually read. Commands are deduplicated per directory,
  so two records sharing the worktree root run the root teardown once.

## One directory = one live workspace

**Settled policy: prevent duplicates and steer to a worktree.** One directory is one physical git checkout, so two "independent" workspaces on it can never actually be independent - branch, diff, and status fan out to every same-`cwd` workspace. `createLocalCheckoutWorkspace` rejects a second _visible_ workspace on an occupied directory with `WorkspaceDirectoryOccupiedError`, surfaced as wire errorCode `workspace_directory_occupied` on `workspace.create.response`. Callers that just need somewhere to run (MCP `create_chat`, loops, agent-spawned terminals, the README button) **reuse the occupying workspace** rather than minting a duplicate.

The tempting alternative - several lightweight workspaces over one checkout instead of a worktree each - was investigated and rejected. It buys real per-`workspaceId` isolation (terminals, service ports, env, script runtimes, agent ownership) for zero disk, but Otto already serves "several tasks, one checkout" with **multiple chats inside one workspace**; the workspace is not the unit of task organisation, the chat is. And the clobbering hazard belongs to the _folder_, not the workspace count - N agents already share one working tree inside a single workspace - so allowing duplicates removes no hazard while promising an independence the filesystem cannot deliver.

**The steer.** Refusing without offering a way forward is what made callers work around the guard, so the client turns `workspace_directory_occupied` into a choice rather than a toast: **Open it** (navigates to the occupying workspace, resolved client-side from the sidebar list - the daemon does not send its id) or **Create a worktree** (replays the same submission with worktree isolation). Cancel leaves everything untouched; if the occupant cannot be resolved there is nothing to open, so it falls back to the plain error. Lives in `new-workspace-occupied-directory.ts`, wired through `new-workspace-screen.tsx`. The three-action dialog is the shared `confirmDialog` primitive's optional `alternateLabel` / `choice: "alternate"`.

**Schedule runs never reveal onto an occupied directory.** Per-run workspaces are minted `hidden: true` and are exempt from the guard - an exemption granted on the promise that the record stays invisible. `revealScheduleRunWorkspace` keeps that promise: if a visible workspace already backs the directory it **reattaches** the finished run (agents move to the occupant, the transient record is archived) instead of revealing a duplicate. The run is over by the time either caller reaches it - post-run disposal, or interrupted-run recovery at startup - so nothing is mid-flight, and the outcome stays visible in the workspace the user already has open. Worktree-isolation runs get a fresh directory and always take the plain reveal path.

**Still open - pre-guard duplicates are never reconciled.** `WorkspaceReconciliationService` merges duplicate _projects_ by root but has no workspace-level equivalent, and preserves every workspace during a project merge. Deliberately deferred: no standing duplicates have been observed since the reveal path was fixed, and a rule that migrates agents and archives workspace records is not worth building against zero data. Same-`cwd` siblings therefore still exist on disk, which is why per-`workspaceId` scoping stays load-bearing (see `workspace-same-cwd-isolation.e2e.test.ts`, whose seeded duplicates are now the only way to reach that state).

Full reasoning and evidence: `archive/projects/duplicate-base-workspaces/` - archived, closed, **do not re-open**.

Gated behind `server_info.features.worktreeArchiveBranchCleanup` (`COMPAT(worktreeArchiveBranchCleanup)`, added in v0.6.7) and `features.worktreeReattach`. Without them the client archives exactly as before - risk warning only, branch untouched. Key files: `workspace-archive-branch.ts` (`detectWorktreeArchiveBranch`, `deleteLocalBranch`), `worktree-reattach.ts`, `workspace-archive-service.ts`, and on the client `git/worktree-archive-warning.ts` + `workspace/use-workspace-archive.ts`.

## A project's name has two carriers, so it needs its own channel

A project's resolved name (`customName ?? displayName`) reaches the client on **two** buckets, and which one applies depends on state the client cannot infer from the message alone:

- **`projectDisplayName` / `projectCustomName` on each workspace descriptor** - for a project that currently has visible workspaces.
- **the empty-project descriptor** (`fetch_workspaces_response.emptyProjects`, and `workspace_update{kind:"remove", emptyProject}`) - for a project whose workspaces are all archived or hidden. The sidebar still renders it, so it still needs a name.

`project.rename.request` originally propagated **only** by re-emitting workspace descriptors. That made the rename invisible for exactly the projects in the second bucket: no visible workspaces ⇒ no descriptors ⇒ nothing emitted ⇒ the name only changed on the next full `fetch_workspaces` (reconnect or sidebar refetch). From the user's side this reads as "renaming sometimes doesn't work at all, and sometimes fixes itself later".

The fix is `project.updated.notification` - a **project-level** channel that fires on every rename regardless of workspace count, carries the project descriptor plus `hasActiveWorkspaces`, and is fanned out to **every** connected session (`SessionOptions.broadcastToAllSessions`) because project metadata is host-global, not per-client. The client applies it in one place (`applyProjectDescriptor`): it writes the empty-project bucket **and** patches the name fields of that project's workspace descriptors, so the update lands without waiting on the workspace channel. Old clients ignore the unknown message type and fall back to their next fetch - no capability gate, no fallback path.

Two rules follow for anything that changes project-level metadata:

- **Never fan a project change out over the workspace channel alone.** Announce the project itself.
- **Only list workspaces the client can see** when re-emitting descriptors. Archived and hidden workspaces resolve to no descriptor, so the emission chokepoint turns each one into a spurious `remove` - a rename on a long-lived project used to emit one per archived worktree.

The client's project list is derived from the store, not from a react-query cache: `useProjects` → `buildProjects` reads `session.workspaces` + `session.emptyProjects`. `invalidateQueries({queryKey:["projects"]})` does not refresh it - only a store write does.

## Workspace activity

Workspace status is an aggregate activity signal computed **per `workspaceId`**: a workspace's status reflects only records whose `workspaceId === workspace.id`. Ownership is never derived from `cwd` - many workspaces may share one directory, and same-`cwd` siblings do not clump under one status.

A root chat contributes its normal state bucket to its owning workspace only. Running subagents contribute `running` to their root parent's owning workspace (by the parent chat's `workspaceId`), not to the subagent's current `cwd` or worktree. Non-running subagent attention, permission, and error states stay in the parent's subagents track and do not escalate the workspace bucket.

Chat status stays literal and does not aggregate upward into its own row: a parent chat is `idle` when its own turn is idle, even if a child is running.
