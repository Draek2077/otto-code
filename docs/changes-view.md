# Changes view — what the diff is measured against

The Changes tab has two modes. **Uncommitted** diffs the working tree against `HEAD` and needs
no base. **Committed** diffs against a _base branch_, and everything below is about how that
base is chosen. Get it wrong and the view fills with commits the user never wrote — which is
the single most common way this feature stops being usable.

The engine is `packages/server/src/utils/checkout-git.ts`. Per-worktree state lives in
`<gitdir>/otto/worktree.json` (`packages/server/src/utils/worktree-metadata.ts`).

## The resolution ladder

1. **Which branch is the base?** `resolveBaseRefForCwd` takes the worktree's stored
   `baseRefName` when the checkout is an Otto worktree, else the repository default branch
   (`resolveRepositoryDefaultBranch`, which reads `refs/remotes/origin/HEAD` and prefers the
   local branch name over the remote-tracking one).
2. **Local ref or remote-tracking ref?** `resolveBestComparisonBaseRef` picks between `<name>`
   and `origin/<name>`. See the next section — this is the part that used to be wrong.
3. **Which commit?** `git merge-base <chosen ref> HEAD`. The diff is
   `merge-base..HEAD`, so commits that are only on the base branch never appear.

Everything that measures against the base — the diff (`getCheckoutDiff`), ahead/behind
(`getAheadBehind`), and the shortstat badge (`getCheckoutShortstat`) — funnels through step 2,
either directly or via the cached `comparisonBaseRef` on `getCheckoutSnapshotFacts`. Keep it
that way: three copies of this logic is three different answers to "what changed?".

## Local vs origin: pick the later fork point, not the fresher ref

`<name>` and `origin/<name>` routinely disagree. Local can be behind origin (nobody pulled),
ahead of it (nobody pushed), or the two can have diverged outright. Otto never fetches on the
read path, so it works with whatever refs the repo already has.

The rule is **not** "prefer origin" and **not** "prefer the fresher branch". It is: compute
`merge-base` with `HEAD` for both candidates and take the candidate whose merge-base is the
_later_ commit (`resolveLatestForkPointBaseRef` — ordering via `git merge-base --is-ancestor`).
That commit is the real branch point, so nothing the branch didn't author can leak in.

Only when both candidates fork at the same commit — where the choice cannot change the diff —
does it fall back to `pickMoreAdvancedBaseRef`, which prefers whichever ref carries more
commits the other lacks. That fallback exists for the ahead/behind counts, which _do_ want the
fresher ref so "behind by N" reflects reality.

Merge and pull targets deliberately do not use this. `resolveMostAheadBaseRef` (used by
`mergeFromBase`) always wants the freshest ref, because merging into a stale one silently drops
the other side's commits.

**Known gap:** if `origin/<name>` does not exist at all — never fetched, or a `remote.origin.fetch`
refspec that excludes it — there is only one candidate and merge-base math cannot help. A stale
base ref that nobody updates stays stale. Auto-fetching on workspace open is the obvious fix and
is deliberately not built: it puts network traffic on a read-only view.

## Per-worktree base override (stacked branches)

"Diff against the default branch" is the wrong question for a stacked branch. If `child` sits on
top of `parent`, the parent's commits are between the default branch and `child`'s HEAD, so they
show up inside the child's Changes view as if the user wrote them. A forge PR gets this right
because it carries an explicit base; `worktree.baseRef.set.request` makes that local.

- `setCheckoutBaseRef(cwd, baseRef | null)` validates the branch exists locally or on origin,
  refuses the branch you are on, and rewrites `worktree.json`. `null` resets to the repository
  default.
- **Otto worktrees only.** The base lives in per-worktree metadata; a plain checkout has nowhere
  to put it, so it gets the read-only "vs `<base>`" label and no picker.
- The stored base is **one source of truth**. `mergeToBase` and `createPullRequest` read the same
  `resolveBaseRefForCwd`, so repointing a stacked branch at its parent also makes "Create PR"
  target the parent — the Bitbucket behavior.
- Clients echo the base back on `compare.baseRef` and PR creation, and the daemon rejects a
  mismatch with `Base ref mismatch`. That is intentional: one stored value, edited explicitly,
  never an ad-hoc one-shot base. It also means a client holding a stale snapshot fails loudly
  rather than diffing against the wrong thing.
- At creation, a `branch-off` worktree already records the base branch the user picked, so
  cutting a worktree from a parent branch stacks correctly with no extra step.

Gated by `server_info.features.worktreeDiffBase` (`COMPAT(worktreeDiffBase)`, added v0.6.8).
Without it the client shows the label and hides the picker — there is no client-side fallback,
since only the daemon can write the worktree's metadata.

## UI

`packages/app/src/git/diff-base-switcher.tsx` renders the `vs <base>` chip beside the diff-mode
dropdown in the Changes toolbar, visible only in Committed mode. Naming the base is half the
value on its own: before this existed, the view never said what it was comparing against.

## Crossing between Files and Changes

The two directions are symmetric, and both go through ephemeral request slots on the panel store
rather than through props — the destination pane is usually not mounted when the request is made,
since the explorer shows one tab at a time.

| Direction       | Producer                                                        | Slot                   | Consumer                            |
| --------------- | --------------------------------------------------------------- | ---------------------- | ----------------------------------- |
| Changes → Files | "Find in files" in the diff row's context menu                  | `filesRevealRequest`   | `components/file-explorer-pane.tsx` |
| Files → Changes | "View changes" in the Files tree menus and the file tab toolbar | `changesRevealRequest` | `git/diff-pane.tsx`                 |

Each producer stashes the path, then switches the explorer tab; the consumer clears the slot on
mount and works toward the target. Revealing in Changes is a small state machine, not one shot:
the diff is usually still loading, so each pass un-collapses a blocking ancestor folder, expands
the file's body, or scrolls to its header, writing store state and re-running until the header is
reachable. The scroll then re-asserts once after 100ms, because rows above the target are
estimated heights until they render and measure themselves.

**"View changes" is offered only for files actually in the diff**, so it can never land on a tab
that does not list the file. There is no lightweight "which paths changed" RPC — the daemon serves
the whole diff or nothing — so `git/changes-reveal.ts` mounts the _same_ `useCheckoutDiffQuery`
the Changes pane mounts, deriving mode/baseRef/ignoreWhitespace identically so both resolve to one
query key: one cache entry, one daemon subscription however many surfaces ask. The cost is that an
open file tab or the Files tab now keeps that subscription alive, where before only the Changes
tab did. If you change how `GitDiffPane` derives those three parameters, change `changes-reveal.ts`
to match or the sharing silently becomes a second subscription.
