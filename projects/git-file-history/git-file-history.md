# Git investigation tools for files and selections

From a file open in the editor, be able to investigate it through git — history,
blame, who wrote a line and when. The bar is **JetBrains-grade functionality**
with a better UI.

Related: [docs/text-editor.md](../../docs/text-editor.md),
[docs/git-providers.md](../../docs/git-providers.md),
[projects/diff-base](../diff-base/diff-base.md).

## Scope

Acting on **a file, or a selection within a file**:

- **View git history** for the file — the list of commits that touched it.
- **Diffs per history entry** — pick an entry, see what that commit did to this
  file.
- **Blame** — per-line author and commit.
- **Original commit** — who first committed the file.
- History for a **selected range**, not just the whole file (`git log -L`).

UI is explicitly unsettled. **A popup window is acceptable for now** while the
real UI is worked out; the point is to get the capability in and iterate on
presentation.

## Where it plugs in

- Daemon side: new `checkout.git.*` RPCs alongside the existing commit/log ones
  (`checkoutGitCommit` / `checkoutGitLog` flags — see
  [docs/rpc-namespacing.md](../../docs/rpc-namespacing.md) for naming; these are
  `domain.provider.operation.request`/`.response` pairs).
- App side: entry points from the file tab and from an editor selection's
  context menu.

## Design notes

- This is **local git**, not a hosting provider — it must work with no remote
  and no GitHub/Bitbucket connection. Keep it out of the forge layer.
- Blame on a large file is expensive; needs to stream or page rather than block.
- Follow renames (`git log --follow`) or the history stops at the rename, which
  is exactly when people reach for this.
- Provider-neutral by construction (it's git), so there's no per-provider
  rollout — unusual for this repo, and worth stating so nobody looks for one.
