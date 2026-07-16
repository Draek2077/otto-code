# Charter: Changes-view diff base — fresh merge-base + stacked-branch parent

**Status:** Not started — charter drafted 2026-07-16 from a user's field report.
**Lineage:** Extends the checkout git engine
([checkout-git.ts](../../packages/server/src/utils/checkout-git.ts)) and worktree metadata
([worktree-metadata.ts](../../packages/server/src/utils/worktree-metadata.ts)). Sibling to the shipped
git-hosting layer ([docs/git-providers.md](../../docs/git-providers.md)) — Bitbucket/GitHub PRs carry an
explicit base branch; Otto's local diff view should be able to as well.

## The report

A user on a stacked branch (AI-388 atop AI-369, repo default `master`) sees Otto's Changes view full of
noise Bitbucket doesn't show. Two separate gaps, only one of which needs a new feature:

1. **Stale local base (bug-shaped).** Their local `master` is 177 commits behind `origin/master`; the
   view appears to diff against the stale local branch, so unrelated files (other teams' merged work)
   show as "changes". Diffing against the merge-base with `origin/master` makes them disappear.
2. **Stacked branches (feature-shaped).** Even with a perfectly fresh base, "diff against the default
   branch" is the wrong question for a stacked branch — AI-369's commits show inside the AI-388 view.
   Bitbucket gets it right because the PR carries an explicit base branch. Otto needs a **per-worktree
   diff base** you can point at the parent branch, defaulting to
   `merge-base HEAD origin/<default>`, overridable.

## What the code actually does today (investigation starting point)

The engine is closer to correct than the report suggests — the first task is pinning down where it
falls back to stale-local in practice:

- [checkout-git.ts:2427](../../packages/server/src/utils/checkout-git.ts) `resolveCheckoutDiffRefs` —
  base = stored worktree base ?? repo default branch, then `resolveBestComparisonBaseRef` (:1407)
  **already prefers `origin/<name>` when the remote-tracking ref exists**, then
  `tryResolveMergeBase` (:586) takes `git merge-base <base> HEAD`.
- So the stale-local symptom means one of: (a) the remote-tracking ref is missing/never fetched in that
  worktree (`resolveBestComparisonBaseRef` silently falls back to local), (b) `origin/<name>` itself is
  stale because nothing fetches it (Otto never fetches on the diff path — by design, it's read-only),
  or (c) one of the OTHER base consumers skips the origin-preference: **ahead/behind**
  (`getAheadBehind` :1465, `comparisonBaseRef` in `getCheckoutSnapshotFacts` :1722) and **shortstat**
  (`resolveShortstatComparisonRef` :2092) duplicate the logic — verify they agree.
- `resolveMostAheadBaseRef` (:1432) — existing prior art that compares local vs `origin/<name>` with
  `git rev-list --left-right --count` and picks the fresher side. Reuse it.
- Per-worktree base already exists in storage: `baseRefName` in `<gitdir>/otto/worktree.json`
  ([worktree-metadata.ts](../../packages/server/src/utils/worktree-metadata.ts), v1+v2 schemas,
  validated, `origin/`-stripped). It's set at worktree creation and **never editable afterward** —
  that's the actual gap for stacked branches, plus a UI to set it.
- The client sends `compare: {mode, baseRef?}` and the daemon **rejects a `baseRef` that differs from
  the stored one** (`checkout-git.ts:2440` "Base ref mismatch") — so the override path must go through
  editing the stored metadata (or relaxing that check deliberately).

## Design

### Phase 1 — freshness (bug fix, no new UI)

1. Reproduce the stale-local case; instrument which of (a)/(b)/(c) actually bites.
2. Make every base consumer (diff, ahead/behind, shortstat) resolve through ONE shared helper that
   prefers the fresher of local vs `origin/<name>` (`resolveMostAheadBaseRef` semantics) before taking
   the merge-base. Kill the duplicated logic.
3. Decide the fetch story: a read-only view can't rely on the user fetching. Lean: an opportunistic
   background `git fetch origin <base> --no-tags` on workspace open (throttled, e.g. ≥15min since last),
   config-gated so privacy-sensitive setups can turn it off. (This is the part that actually fixes
   "177 commits behind" — merge-base math can't beat a ref nobody updates.)

### Phase 2 — per-worktree configurable base (the feature)

4. `worktree.baseRef.set.request/.response` RPC (dotted namespacing per
   [docs/rpc-namespacing.md](../../docs/rpc-namespacing.md)): validates the ref exists
   (local or origin), rewrites `worktree.json` `baseRefName`, invalidates the checkout snapshot.
5. UI: a base-branch selector in the Changes header (current base shown as a chip; tap → branch picker,
   default-branch reset row). Feature flag `features.worktreeDiffBase`, no fallback path.
6. Stacked-branch affordance at creation: when creating a worktree FROM another Otto worktree's branch,
   default `baseRefName` to that parent branch instead of the repo default (this metadata already
   flows through `sourcePlan.metadataBaseRefName`, [worktree.ts:1215](../../packages/server/src/server/worktree.ts)).
7. Keep merge/PR flows honest: PR creation (`session.ts:963`) and merge-to-base (`session.ts:801`)
   already read `snapshot.git.baseRef` — verify they pick up the custom base so "Create PR" targets the
   parent branch like Bitbucket does.

### Phase 3 — polish / deferred

- Auto-detect a stacked parent (`git log --first-parent` / branch-point heuristics) as a suggestion, not
  automatic.
- Surface "base is N commits behind origin" as a passive hint chip.

## Open questions

- **Auto-fetch default:** on or off? (Lean: on, throttled, config-gated — without it Phase 1 only helps
  users who fetch.)
- **Base ref mismatch check:** keep the client→daemon `compare.baseRef` echo strict (edit-then-request)
  or allow ad-hoc one-shot bases without persisting? (Lean: strict — one source of truth in
  worktree.json.)
- Does the Changes tab need a visible "vs <base>" label even when unconfigured? (Lean: yes — half the
  confusion in the report is not knowing what the diff is against.)

## Cross-cutting

- Daemon changes ⇒ `npm run build:server`; protocol additions are additive optional leaves +
  `features.worktreeDiffBase`.
- Fold-in on ship: base-resolution semantics into a docs file (likely a new short
  `docs/changes-view.md` or a section in an existing git doc), then delete this folder.
