# Changes view - what the diff is measured against

The Changes tab has two modes. **Uncommitted** diffs the working tree against `HEAD` and needs
no base. **Committed** diffs against a _base branch_, and everything below is about how that
base is chosen. Get it wrong and the view fills with commits the user never wrote - which is
the single most common way this feature stops being usable.

The engine is `packages/server/src/utils/checkout-git.ts`. Per-worktree state lives in
`<gitdir>/otto/worktree.json` (`packages/server/src/utils/worktree-metadata.ts`), and the
per-branch base lives beside it in `<gitdir>/otto/diff-base.json`
(`packages/server/src/utils/checkout-diff-base-store.ts`).

## The resolution ladder

`resolveBaseRefLadder` is the **single** answer to "what is this diffed against?". It used to be
computed in two places; that is exactly how you get two different answers to the same question, so
`resolveBaseRefForCwd` and `getCheckoutSnapshotFacts` both call the one ladder now.

1. **The branch's remembered base** - `diff-base.json`, keyed by branch name. Either a user pick
   or a parent detected earlier. **Sticky by design**: see below.
2. **An Otto worktree's creation-time base** - the `baseRefName` in `worktree.json`, which already
   records the branch the worktree was cut from.
3. **The inferred parent branch** (`checkout-git-parent-branch.ts`), then written to
   `diff-base.json` so step 1 answers from here on.
4. **The repository default branch** - `resolveRepositoryDefaultBranch`, which reads
   `refs/remotes/origin/HEAD` and prefers the local branch name over the remote-tracking one.
5. **`origin/<branch>` when steps 1-4 land on the branch you are standing on.** On the default
   branch `merge-base(main, HEAD)` is HEAD, so "vs main" is empty by definition. Comparing against
   the remote-tracking ref shows unpushed local commits, which is the only useful answer there.

Then, as before:

- **Local ref or remote-tracking ref?** `resolveBestComparisonBaseRef` picks between `<name>` and
  `origin/<name>` - unless the base is remote-qualified, which is a pin it honours verbatim.
- **Which commit?** `git merge-base <chosen ref> HEAD`. The diff is `merge-base..HEAD`, so commits
  that are only on the base branch never appear.

Everything that measures against the base - the diff (`getCheckoutDiff`), ahead/behind
(`getAheadBehind`), and the branch shortstat (`getCheckoutShortstat`) - funnels through the
comparison step, either directly or via the cached `comparisonBaseRef` on
`getCheckoutSnapshotFacts`. Keep it that way: three copies of this logic is three different answers
to "what changed?".

The committed Changes view, its base chip, and ahead/behind counts therefore all answer the same
branch-history question. When detection repoints a stacked branch at its parent, they shrink to that
branch's own work in the same pass.

The workspace-list `+N/-N` indicator intentionally answers a different question by default:
`workingTreeDiffStat` comes from `getCheckoutUncommittedShortstat`, which diffs `HEAD` against the
working tree and adds untracked lines. It clears on commit, like a terminal git-status prompt. The
Appearance → Layout → **Workspace change indicator** preference can instead show the legacy
branch-versus-base `diffStat` or hide the count. The workspace hover card labels branch history as
`vs <base> · N commits`, so it cannot be confused with uncommitted work.

## Parent detection is a heuristic, and has to look like one

**Git does not record a branch's parent.** There is no field to read, so
`inferParentBranchRef` reconstructs it from the commit graph: enumerate up to 50 recent local and
`origin/` refs, `merge-base` each against HEAD, drop candidates whose merge-base _is_ HEAD (those
are children, not parents), and take the candidate whose merge-base is the **latest** commit. That
commit is the nearest branch point, so the fewest commits the branch did not author leak in.

Four things about this are load-bearing, and each has a regression test:

- **The default branch has no parent, and must not be asked.** This is the one that bit in
  practice: on `main` the scan proposed a long-merged feature branch. Every branch ever merged into
  `main` has a tip that is an ancestor of HEAD, which is **graph-identical to a stacked parent** -
  and since `main` is excluded from its own candidate list, a merged branch always wins. So
  `currentBranch === defaultBranch` returns `null` up front and the ladder falls to step 5.
  Off the default branch the ambiguity resolves itself: once a branch merges, the default branch's
  own fork point with HEAD is _later_ than the merged branch's tip, so the default branch wins.
- **Ancestry, not dates.** Ordering uses `merge-base --is-ancestor`, because commit timestamps are
  rebase- and clock-controlled and routinely disagree with topology. Fork points are all ancestors
  of HEAD but form a DAG rather than a chain (any merge in HEAD's history splits them), so the scan
  repeats until it stops moving instead of trusting one greedy pass.
- **It reports a branch, not a ref.** A winning `origin/X` collapses to `X` when a local branch of
  that name exists. Otherwise the chip would read "vs origin/main" for someone who simply branched
  off `main`, and the comparison step already picks the right side. The qualifier survives only for
  a parent that exists _solely_ on origin, and for an explicit user pin.
- **`%(refname:short)` renders `refs/remotes/origin/HEAD` as bare `origin`**, which reads as an
  ordinary branch and beats real candidates on merge-base. Enumeration uses full `%(refname)` and
  shortens explicitly to keep that case identifiable.

The merge-base probes run through a bounded pool (`MERGE_BASE_CONCURRENCY`), because a git
subprocess costs ~60ms on Windows and 50 serial probes is measurably seconds. Diverged candidates
cannot be skipped: a parent that gained commits after you branched off it is diverged from you, and
that is the common case, not an edge case.

Detection is **sticky**: the first computed answer is written down and never recomputed, including
when it came from the step-4/5 fallback rather than the graph. Two reasons. A heuristic that
silently re-decides itself every read is worse than no heuristic, because the base moves under the
user between two views of the same branch. And without persisting the negative case, the 50-candidate
scan would re-run on every snapshot refresh for every branch with no detectable parent - the default
branch most of all, which is where most sessions sit.

Because sticky makes a wrong guess _persistent_, the provenance is on the wire (`baseSource`:
`user` / `inferred` / `worktree` / `default`) and the chip says which. The picker's **"Detect parent
branch"** row (`redetect` on the RPC) clears the stored entry and runs the ladder again. Treat those
two as part of the feature, not polish: they are what makes a heuristic acceptable.

**Self-healing.** If a stored base names a branch that no longer resolves on either side - the
ordinary case where a parent merges and someone deletes it - the entry re-resolves **once** to the
repository default and is rewritten. Guarded on the current branch itself resolving, so a repo
mid-fetch or mid-clone does not trade a good base for the default permanently.

Because a detected base is this daemon's guess rather than a user contract, the `Base ref mismatch`
rejection below applies only when `baseSource` is `user` or `worktree`. An ad-hoc `compare.baseRef`
may override a guess; overriding an explicit choice still fails loudly.

## Local vs origin: pick the later fork point, not the fresher ref

`<name>` and `origin/<name>` routinely disagree. Local can be behind origin (nobody pulled),
ahead of it (nobody pushed), or the two can have diverged outright. Otto never fetches on the
read path, so it works with whatever refs the repo already has.

The rule is **not** "prefer origin" and **not** "prefer the fresher branch". It is: compute
`merge-base` with `HEAD` for both candidates and take the candidate whose merge-base is the
_later_ commit (`resolveLatestForkPointBaseRef` - ordering via `git merge-base --is-ancestor`).
That commit is the real branch point, so nothing the branch didn't author can leak in.

Only when both candidates fork at the same commit - where the choice cannot change the diff -
does it fall back to `pickMoreAdvancedBaseRef`, which prefers whichever ref carries more
commits the other lacks. That fallback exists for the ahead/behind counts, which _do_ want the
fresher ref so "behind by N" reflects reality.

Merge and pull targets deliberately do not use this. `resolveMostAheadBaseRef` (used by
`mergeFromBase`) always wants the freshest ref, because merging into a stale one silently drops
the other side's commits.

If `origin/<name>` does not exist at all - never fetched, or a `remote.origin.fetch` refspec that
excludes it - there is only one candidate and merge-base math cannot help. Otto can fetch active
workspaces in the background, but that is a Host setting rather than a read-path side effect:
**Settings → Host → Workspaces → Fetch active workspaces automatically** controls whether it runs
and how often. **Fetch** in the workspace Git tools runs `git fetch origin --prune` on demand.

## Base override (stacked branches)

"Diff against the default branch" is the wrong question for a stacked branch. If `child` sits on
top of `parent`, the parent's commits are between the default branch and `child`'s HEAD, so they
show up inside the child's Changes view as if the user wrote them. A forge PR gets this right
because it carries an explicit base; `worktree.baseRef.set.request` makes that local. Detection
now handles the common case automatically, and this is the override when it guesses wrong or you
want a different comparison.

- `setCheckoutBaseRef(cwd, baseRef | null, context, { redetect })` validates the branch exists
  locally or on origin, refuses the branch you are on, and records the pick. `null` pins the
  repository default; `redetect` forgets the pick and re-runs the ladder.
- **Any git checkout, not just Otto worktrees.** The base is stored per branch in
  `diff-base.json`, which is what makes this work outside a worktree: a plain checkout's gitdir is
  shared by _every_ branch you check out, so a single scalar base would bleed one branch's
  comparison onto the next branch you switch to. An Otto worktree additionally keeps writing
  `worktree.json`, since that record is what merge and PR creation read.
- At creation, a `branch-off` worktree already records the base branch the user picked, so
  cutting a worktree from a parent branch stacks correctly with no extra step.

### `main` and `origin/main` are separate choices

The two disagree whenever local is behind, ahead of, or diverged from origin, so the picker offers
both rows and a remote-qualified pick is stored **with** its qualifier
(`validateBaseRefNameAllowingRemote`). `resolveBestComparisonBaseRef` then honours it verbatim
instead of re-picking a side by fork point: an explicit pin beats the heuristic. A bare name keeps
the auto-pick behaviour exactly as before.

**This deliberately splits the "one source of truth" rule, and the split is the point.** The
remote qualifier is _comparison-only_. Merge and PR targets collapse back to the local branch name
(`mergeToBase` normalizes, `resolveMostAheadBaseRef` wants the freshest ref, and an Otto worktree's
`worktree.json` always stores the local name) because **there is no such thing as opening a pull
request against a remote-tracking ref**. If you find that asymmetry and think it is a bug, it is
not - deleting it breaks PR creation for anyone who pinned `origin/<branch>`.

Otherwise the stored base remains one source of truth: `mergeToBase` and `createPullRequest` read
the same ladder, so repointing a stacked branch at its parent also makes "Create PR" target the
parent (the Bitbucket behavior). Clients echo the base back on `compare.baseRef` and PR creation,
and the daemon rejects a mismatch with `Base ref mismatch` - but only for a base someone actually
chose (`baseSource` of `user` or `worktree`), per the ladder section above.

Gated by `server_info.features.worktreeDiffBase` (`COMPAT(worktreeDiffBase)`, added v0.6.8).
Repointing a plain checkout, detection, the `origin/` pin and the re-detect action additionally need
`server_info.features.checkoutDiffBaseAnyRepo` (`COMPAT(checkoutDiffBaseAnyRepo)`, added v0.7.4).
Without them the client shows the label and hides the picker - there is no client-side fallback,
since only the daemon can write the stored base.

## UI

`packages/app/src/git/diff-base-switcher.tsx` renders the `vs <base>` chip beside the diff-mode
dropdown in the Changes toolbar, visible only in Committed mode. Naming the base is half the
value on its own: before this existed, the view never said what it was comparing against.

Capability detection lives in one place in that file (`checkoutQualifies`), per the feature-contract
rule - downstream code reads a single boolean rather than branching on daemon version. Branch rows
come from `getBranchSuggestions`, whose `branchDetails` already carry `hasLocal` / `hasRemote`, which
is what lets the picker render `main` and `origin/main` as separate rows without a new RPC.

## The patch is machine output, so personal git config cannot reach it

A user's `~/.gitconfig` is theirs, and every one of these settings used to empty the
entire Changes view: `diff.mnemonicPrefix` (headers become `c/path w/path`), a custom
`diff.srcPrefix`/`dstPrefix`, `color.ui = always` (ANSI escapes around every patch line),
and `diff.external` (difftastic, delta, meld replace the patch wholesale). The failure is
silent and total rather than noisy: the file rows and their `+N/-N` come from
`--name-status` and `--numstat`, which none of that touches, while the patch stops
parsing, so every file lists correctly and renders blank in both Line and Structural.

Two layers keep that out:

- **Invocation.** `runGitCommand` pins `MACHINE_READABLE_GIT_CONFIG` on every git call,
  the way it already pinned `core.quotepath=false`. Patch-producing commands add
  `MACHINE_READABLE_DIFF_FLAGS` (`--no-ext-diff --no-textconv`), which config cannot
  express: `diff.external` set to an empty value makes git exit with "external diff died".
  Their own terminal `git diff` is untouched, since only the daemon's reads are pinned.
- **Parsing.** `parseDiff` derives the prefix from the header instead of assuming `a/`
  and `b/`, because a patch from an agent, a forge, or a paste was produced under
  someone else's config. Renames read the prefix-free `rename to` line. Both copies of
  the parser (`packages/server/src/server/utils/diff-highlighter.ts` and
  `packages/app/src/utils/diff-highlighter.ts`) carry the same rule.

Regression coverage is `packages/server/src/utils/checkout-git.user-git-config.test.ts`,
one case per setting. Add a case there rather than a defensive branch downstream when a
new setting turns up.

## Switching branches with uncommitted changes

Otto stages agent edits, so it does not expose a second Unstaged-files surface merely to make branch
switching possible. When Git rejects a branch switch because the working tree is dirty, the branch
switcher offers **Stash, Switch & Pop**. It creates an Otto stash with untracked files included,
switches to the requested branch, then immediately pops that stash so the work travels with the user.

The workflow stops at the first failure. A failed checkout leaves the new stash on the source branch;
a failed pop, including a conflict, leaves the stash intact on the destination branch. In either case
the UI surfaces Git's error and never tries to drop or overwrite the user's work. The usual clean
branch switch remains unchanged, including its separate prompt for a previously saved Otto stash
belonging to the destination branch.

## Review comments live in per-view buckets, so the bulk delete sweeps the branch

Draft review comments anchor to line numbers in one specific diff, so `buildReviewDraftKey`
scopes them by host, workspace, **branch, diff mode, base ref, and whitespace setting**. Two of
those parts move under the reader: committing flips Uncommitted to Committed, and the whitespace
toggle is one menu item away. Either one swaps the visible bucket, and comments written in the
previous one stop being displayed. They are not lost, but nothing on screen says where they went,
and per-comment delete cannot reach a comment that is not rendered.

**Delete all review comments** in the Changes menu is the way out. It sweeps
`buildReviewDraftBranchKeyPrefix` - every bucket for this workspace on this branch, across both
diff modes and both whitespace settings - not the one key the reader can see. Two consequences
follow, and both are deliberate:

- The action is offered whenever the **branch** holds comments, even when the current view shows
  none. Gating it on the visible bucket would hide the only control that reaches the stranded ones.
- The confirmation states the comment count, the file count, and the branch, and says outright that
  it includes comments the current view does not show. A confirmation that said "this diff" would
  understate what the button takes, and consent to an irreversible action described wrongly is not
  consent (same rule as the History clear-archive dialog).

The prefix ends on a `:` separator. Without it, `branch=main` would also match `branch=main-2`, and
clearing one branch would silently take another's comments with it.

Removing the composer's review attachment pill is a different gesture and keeps the narrow scope:
it clears the single draft key that snapshot was built from.

## Crossing between Files and Changes

The two directions are symmetric, and both go through ephemeral request slots on the panel store
rather than through props - the destination pane is usually not mounted when the request is made,
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
that does not list the file. There is no lightweight "which paths changed" RPC - the daemon serves
the whole diff or nothing - so `git/changes-reveal.ts` mounts the _same_ `useCheckoutDiffQuery`
the Changes pane mounts, deriving mode/baseRef/ignoreWhitespace identically so both resolve to one
query key: one cache entry, one daemon subscription however many surfaces ask. The cost is that an
open file tab or the Files tab now keeps that subscription alive, where before only the Changes
tab did. If you change how `GitDiffPane` derives those three parameters, change `changes-reveal.ts`
to match or the sharing silently becomes a second subscription.
