# Investigation: duplicate non-worktree workspaces on the same base folder

Users are ending up with **multiple non-worktree workspaces pointing at the same
base folder**. Run this as its own session.

**The deliverable is a verdict with reasoning, not a patch.** Come back with a
recommendation and the argument behind it: is allowing this a **bad idea** we
should prevent, or a **great idea** we should support properly? Either answer is
acceptable — an unargued "it depends" is not. Do not change behaviour in that
session; propose.

Related: [docs/agent-lifecycle.md](../../docs/agent-lifecycle.md),
`packages/server/src/server/workspace-reconciliation-service.ts`.

## The tension

It might be genuinely good. Users may want several workspaces organised around
one checkout — different tasks, different chats, same code — without paying the
disk and setup cost of a worktree per task.

But they all share **one working directory**, so they share one branch: switch
the branch in one workspace and every other workspace on that folder silently
follows. Uncommitted changes are shared too. That coupling is invisible in a UI
that presents workspaces as independent things.

## Establish the facts first

1. **Is it intended today?** `workspace-reconciliation-service.ts` already merges
   duplicate _project_ records pointing at the same repo root
   (`merged_duplicate`), so de-duplication intent exists at the project layer but
   not the workspace layer. Determine whether that's a deliberate allowance or an
   oversight.
2. **How are users getting them?** Reproduce the path that creates the second
   one. Whether it takes deliberate effort or happens by accident is most of the
   answer.
3. **What actually breaks?** Concretely: two workspaces on one folder, agents
   running in both, one switches branch. What does the other one show, and what
   happens to an agent mid-edit? Test it rather than reasoning about it.

## The argument to make

Build the case both ways and then pick one:

- **Why it's a bad idea** — the branch/working-tree coupling, agents clobbering
  each other, the UI implying an isolation that doesn't exist, and the fact that
  worktrees already exist precisely to give independent branches.
- **Why it's a great idea** — lighter than a worktree, legitimate for
  read-heavy or single-branch work, matches how people already keep several
  chats against one repo, and forcing worktrees adds friction and disk for users
  who don't need branch isolation.

Then recommend one of: **allow and make the sharing visible**, **prevent and
steer to a worktree**, or **allow silently** (status quo). Say what would have to
be true for you to be wrong.
