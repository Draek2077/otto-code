# Charter: Changes-view diff base — fresh merge-base + stacked-branch parent

**Status:** Phases 1 and 2 SHIPPED 2026-07-24 (uncommitted). Durable semantics folded into
[docs/changes-view.md](../../docs/changes-view.md). Phase 3 and one product decision remain —
this folder stays until they are resolved.
**Lineage:** Extends the checkout git engine
([checkout-git.ts](../../packages/server/src/utils/checkout-git.ts)) and worktree metadata
([worktree-metadata.ts](../../packages/server/src/utils/worktree-metadata.ts)). Sibling to the shipped
git-hosting layer ([docs/git-providers.md](../../docs/git-providers.md)) — Bitbucket/GitHub PRs carry an
explicit base branch; Otto's local diff view now can as well.

## The report

A user on a stacked branch (AI-388 atop AI-369, repo default `master`) sees Otto's Changes view full of
noise Bitbucket doesn't show. Two separate gaps, only one of which needs a new feature:

1. **Stale local base (bug-shaped).** Their local `master` is 177 commits behind `origin/master`; the
   view appears to diff against the stale local branch, so unrelated files (other teams' merged work)
   show as "changes". Diffing against the merge-base with `origin/master` makes them disappear.
2. **Stacked branches (feature-shaped).** Even with a perfectly fresh base, "diff against the default
   branch" is the wrong question for a stacked branch — AI-369's commits show inside the AI-388 view.
   Bitbucket gets it right because the PR carries an explicit base branch. Otto needs a **per-worktree
   diff base** you can point at the parent branch.

---

## What shipped

### Phase 1 — freshness (the bug)

**What the investigation actually found.** The charter guessed the engine was falling back to the
stale _local_ branch. It wasn't — `resolveBestComparisonBaseRef` preferred `origin/<name>`
**unconditionally**. Reproduced with a real two-clone git fixture
([checkout-git-diff-base.test.ts](../../packages/server/src/utils/checkout-git-diff-base.test.ts)):

| Scenario                                                                 | Before  |
| ------------------------------------------------------------------------ | ------- |
| local `main` behind `origin/main`, branch cut from origin                | ✅ pass |
| local `main` behind, branch merged `origin/main` in (the report's shape) | ✅ pass |
| **`origin/main` stale, local `main` carries unpushed commits**           | ❌ fail |
| ahead/behind in that same case                                           | ❌ fail |
| shortstat in that same case                                              | ❌ fail |

So the reported symptom is real but its cause is broader than "prefers local": the resolver was
picking a side by a rule that has nothing to do with where the branch actually forked. Diverged or
unpushed base branches drag the base branch's own commits into the view.

**The fix.** `resolveBestComparisonBaseRef` now delegates to `resolveLatestForkPointBaseRef` when
both `<name>` and `origin/<name>` exist: compute `merge-base` with `HEAD` for each candidate and
take the one whose merge-base is the _later_ commit (ordered with `git merge-base --is-ancestor`).
That commit is the real branch point, so nothing the branch didn't author can appear. On a tie —
where the choice provably cannot change the diff — it falls back to the old "more advanced ref"
rule (extracted as `pickMoreAdvancedBaseRef`, still used verbatim by `resolveMostAheadBaseRef` for
merge/pull, which genuinely wants the freshest ref).

The charter also asked whether diff / ahead-behind / shortstat had drifted apart. They had not —
all three already funneled through `resolveBestComparisonBaseRef` (directly or via the cached
`comparisonBaseRef` on the snapshot facts), so the one fix covers all three. Two of them were only
missing the `CheckoutContext` pass-through; that is now threaded so they share the logger.

### Phase 2 — per-worktree configurable base (the feature)

- `worktree.baseRef.set.request` / `.response` (dotted namespacing), handled in `session.ts`,
  backed by `setCheckoutBaseRef` in `checkout-git.ts`. Validates the ref exists locally or on
  origin, refuses the branch you're on, refuses non-Otto-worktree checkouts, rewrites
  `worktree.json`, drops the shortstat/PR caches and forces a snapshot refresh.
- `setOttoWorktreeBaseRefName` in `worktree-metadata.ts` preserves the v2 fields
  (`firstAgentBranchAutoName`, `runtime`) that `writeOttoWorktreeMetadata` would have dropped by
  rewriting the file as v1.
- `baseRef: null` resets to the repository default — the client never has to resolve it.
- Feature-gated on `server_info.features.worktreeDiffBase` (`COMPAT(worktreeDiffBase)`, v0.6.8).
- UI: `diff-base-switcher.tsx` — a `vs <base>` chip beside the diff-mode dropdown, visible in
  Committed mode. Read-only label without the capability or on a plain checkout; searchable branch
  picker with a "Default branch" reset row otherwise. This also answers the charter's third open
  question ("does the tab need a visible `vs <base>` label?" — yes, and it is the half of the fix
  that helps every user, not just stacked ones).

**Charter items verified, no code needed:** item 6 (stacked default at creation) already works —
a `branch-off` worktree records the base branch the user picked as `metadataBaseRefName`. Item 7
holds — `mergeToBase` and `createPullRequest` both read `resolveBaseRefForCwd`, so a repointed base
retargets "Create PR" at the parent branch, exactly like a Bitbucket PR.

**Open questions resolved:** the `compare.baseRef` echo stays **strict** (one stored value, edited
explicitly; a stale client fails loudly instead of silently diffing against the wrong base).

---

## What is left

### The fetch story (product decision — needs an answer before Phase 3 is worth doing)

Phase 1 cannot help when `origin/<name>` **does not exist or is itself stale** — never fetched, or a
`remote.origin.fetch` refspec that excludes it. With one candidate there is no fork point to compare
and merge-base math can't beat a ref nobody updates. The fix is an opportunistic background
`git fetch origin <base> --no-tags` on workspace open (throttled, e.g. ≥15 min), config-gated.

**Not built, deliberately:** it puts network traffic on what is today a strictly read-only view, and
that is a product call about defaults and privacy, not an implementation detail. Decide: on by
default (throttled + config-gated), off by default, or not at all.

### Non-worktree checkouts cannot override the base

The override lives in `<gitdir>/otto/worktree.json`, which only Otto worktrees have. A plain
checkout of a stacked branch — plausibly the reporting user's own setup — gets the read-only label
and nothing more. Giving it an override needs a second store keyed by workspace, and then the base
stops being one source of truth for merge/PR unless that store feeds `resolveBaseRefForCwd` too.
Worth doing only if the plain-checkout case turns out to be common.

### Phase 3 — polish

- Auto-detect a stacked parent (`git log --first-parent` / branch-point heuristics) as a
  _suggestion_ in the picker, not an automatic base change.
- Surface "base is N commits behind origin" as a passive hint chip (depends on the fetch story —
  without a fetch, "behind" is only as true as the last manual `git fetch`).
