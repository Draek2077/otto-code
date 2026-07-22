# Worktree archive branch cleanup

**Status:** BUILT (uncommitted) — 2026-07-21.

## Problem

Archiving a git-worktree workspace removed the worktree directory but left the
worktree's local branch behind in the shared repo. Over time a repo accumulates
dozens of dead `feature/*` branches from archived worktrees. The archive flow
should instead **detect** the leftover branch, **surface** its state to the
user, **ask** what to do, then **act**.

## Flow: detect → confirm → act

1. **Detect** (daemon, read-only): `workspace.archive.preflight.request` →
   `WorktreeArchiveBranchDetection`. For an Otto-owned worktree it reports the
   branch name, its base branch (from `.git/otto/worktree.json`), the merge
   state (`merged` / `unmerged` / `unknown` via `rev-list --count base..branch`),
   the unmerged commit count, whether `origin/<branch>` still exists, whether
   the branch is checked out in another worktree, and whether archiving will
   actually remove the backing directory (last-reference).
2. **Surface + ask** (client): a single confirmation dialog (reuses
   `confirmDialogWithCheckbox`) that shows the existing risk reasons
   (uncommitted / unpushed) plus a branch section, with a **"Also delete branch
   X"** checkbox.
3. **Act**: archive request carries `branchDisposition: "keep" | "delete"`. On
   `"delete"` the daemon re-detects (ownership re-check), removes the worktree
   directory, then `git branch -D <branch>` from the shared repo — only on the
   last-reference path, so a directory still backing another workspace never
   loses its branch. The response echoes `deletedBranch`.

## The default (decided)

**Merged branches default to delete; everything else defaults to keep.** The
dialog pre-checks the delete box only when `mergeState === "merged"`
(`checkboxDefaultChecked`). Unmerged/unknown default to keep so commits are
never discarded by inertia. We still always ask — the flow is
detect → surface → **ask** → act, not silent auto-removal.

Force delete (`git branch -D`) is used regardless of merge state: the user has
already been shown the merge state and made an explicit choice, and git's own
`-d` merged-check compares against the upstream, not the base branch the user
saw, so it would spuriously refuse.

## Wire (all back-compat)

- `archive_workspace_request.branchDisposition?: "keep" | "delete"` — absent =
  keep (old-client behavior).
- `archive_workspace_response.payload.deletedBranch?: string | null`.
- `workspace.archive.preflight.request` / `.response` (new dotted-namespace pair).
- `server_info.features.worktreeArchiveBranchCleanup` gates the client
  preflight+dialog. Without it the client archives exactly as before (risk
  warning only, branch untouched). `COMPAT(worktreeArchiveBranchCleanup)` added
  in v0.6.7.

## Key files

- `packages/protocol/src/messages.ts` — schemas, feature flag, types.
- `packages/server/src/server/workspace-archive-branch.ts` — `detectWorktreeArchiveBranch`, `deleteLocalBranch`.
- `packages/server/src/server/workspace-archive-service.ts` — `branchCleanup` in `ArchiveByScopeRequest`, branch delete inside `maybeRemoveDirectory`, `deletedBranch` in `ArchiveResult`.
- `packages/server/src/server/session.ts` — preflight handler + archive handler wiring.
- `packages/server/src/server/websocket-server.ts` — feature flag `true`.
- `packages/app/src/git/worktree-archive-warning.ts` — `canOfferBranchDeletion`, `buildWorktreeArchiveBranchDialog`.
- `packages/app/src/workspace/use-workspace-archive.ts` — detect → confirm → act orchestration.
- `packages/app/src/workspace/workspace-archive.ts` — threads `branchDisposition` / `deletedBranch`.
- `packages/app/src/utils/confirm-dialog.ts` + `confirm-dialog-host.tsx` — `checkboxDefaultChecked`.
- i18n: `packages/app/src/i18n/resources/en.ts` (English only; other locales TODO).

## Related / follow-ups

- Companion task: **"Worktree re-attach & swap workspace base."**
- i18n: only `en.ts` has the branch-cleanup strings; translate once verified.
- The `branchCheckedOutElsewhere` guard is defensive — a branch is checked out
  in at most one worktree, so in practice it is false for the branch being
  archived; kept for correctness and future multi-checkout cases.
