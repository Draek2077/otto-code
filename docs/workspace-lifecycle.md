# Workspace and worktree lifecycle

How a workspace is archived, how an Otto-owned git worktree is cleaned up or revived, and how a workspace's activity signal is computed.

**Workspaces are not chats.** A workspace is one concrete `cwd` on one daemon; a chat is a conversation surface that happens to live in one. They have independent lifecycles — the only coupling is ownership: archiving a workspace archives everything it owns, including its chats. Nothing here should be read as chat lifecycle; that lives in [chat-lifecycle.md](chat-lifecycle.md).

## Worktree archive, branch cleanup, and re-attach

"Leave"/"detach" on a worktree workspace **is** archive — there is no separate detach verb.

**The branch is a separate concern from the directory.** `git worktree remove` throws away the working directory but **never** deletes the branch, because the branch holds your commits; deleting one is always an explicit `git branch -d/-D`. So cleanup splits by branch safety:

| Branch state                         | Meaning                                         | Disposition                                    |
| ------------------------------------ | ----------------------------------------------- | ---------------------------------------------- |
| Merged / PR-merged / pushed-and-gone | Commits live on in the base                     | Safe to delete — full clean                    |
| Unmerged commits                     | Deleting destroys work that exists nowhere else | Keep — this is what makes re-attach possible   |
| Uncommitted changes                  | Dirty worktree                                  | Existing `confirmRiskyWorktreeArchive` warning |

**Flow: detect → surface → ask → act.** `workspace.archive.preflight.request` returns a read-only `WorktreeArchiveBranchDetection` — branch name, base branch (from `.git/otto/worktree.json`), merge state (`merged`/`unmerged`/`unknown` via `rev-list --count base..branch`), unmerged commit count, whether `origin/<branch>` still exists, `branchCheckedOutElsewhere`, and whether archiving actually removes the backing directory (last-reference). The client shows one confirm dialog with an "Also delete branch X" checkbox; the archive request then carries `branchDisposition: "keep" | "delete"` and the response echoes `deletedBranch`.

**The default: merged branches pre-check delete, everything else defaults to keep** — so commits are never discarded by inertia. We still always ask; this is never silent auto-removal. Force delete (`git branch -D`) is used regardless of merge state, because the user has already been shown the merge state and chosen, and git's own `-d` check compares against the upstream rather than the base branch the user actually saw — so `-d` would spuriously refuse. Deletion only happens on the last-reference path, so a directory still backing another workspace never loses its branch.

**Re-attach** is the escape hatch for the kept-branch case. `worktree.reattach.list.request` enumerates re-attachable targets for a project — archived worktree records with a kept branch, plus orphaned on-disk Otto worktrees (`otto_worktree_list` minus live-workspace-backed ones) — and `worktree.reattach.request` revives one via `recreateOwningWorktreeForRestore`, unarchiving or minting the workspace record. Before this existed the only restore path was chat-tied (clicking an archived chat in History triggered `unarchiveOwningWorkspaceForAgent`), so a worktree with no owning archived chat was stranded.

This also fixed a quiet leave bug: archiving a worktree resolved `repoRoot = null`, which skipped `git worktree remove`/`prune` and only `rm -rf`'d the directory — leaving a **stale worktree registration** (phantom `git worktree list` entry, branch pinned as "already checked out").

**`cwd` is immutable.** A workspace's root is set at creation and never mutated; this is a re-attach primitive, not a mutable-root refactor. Ownership (chats, terminals) is keyed by `workspaceId`, never `cwd`, so the root is _technically_ movable — we deliberately keep it fixed to preserve the one-directory-one-live-workspace guard (`WorkspaceDirectoryOccupiedError`) and the reconciler contract. Swapping between a worktree and its base is therefore **navigation, not mutation**: "Open base checkout" ensures/reveals the project's base `local_checkout` workspace.

Gated behind `server_info.features.worktreeArchiveBranchCleanup` (`COMPAT(worktreeArchiveBranchCleanup)`, added in v0.6.7) and `features.worktreeReattach`. Without them the client archives exactly as before — risk warning only, branch untouched. Key files: `workspace-archive-branch.ts` (`detectWorktreeArchiveBranch`, `deleteLocalBranch`), `worktree-reattach.ts`, `workspace-archive-service.ts`, and on the client `git/worktree-archive-warning.ts` + `workspace/use-workspace-archive.ts`.

## Workspace activity

Workspace status is an aggregate activity signal computed **per `workspaceId`**: a workspace's status reflects only records whose `workspaceId === workspace.id`. Ownership is never derived from `cwd` — many workspaces may share one directory, and same-`cwd` siblings do not clump under one status.

A root chat contributes its normal state bucket to its owning workspace only. Running subagents contribute `running` to their root parent's owning workspace (by the parent chat's `workspaceId`), not to the subagent's current `cwd` or worktree. Non-running subagent attention, permission, and error states stay in the parent's subagents track and do not escalate the workspace bucket.

Chat status stays literal and does not aggregate upward into its own row: a parent chat is `idle` when its own turn is idle, even if a child is running.
