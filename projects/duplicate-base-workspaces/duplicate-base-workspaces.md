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

---

## Verdict — 2026-07-20

**Recommendation: prevent and steer to a worktree.** This is already the shipped
policy; the investigation's real finding is that the policy shipped with two
holes, and the duplicates users are seeing come entirely through them. The work
is not "decide", it is "finish".

### The framing question was already answered in-tree

The charter asks whether duplicate non-worktree workspaces are a deliberate
allowance or an oversight. Neither — the answer changed on **2026-07-16**
(`8d50f75f6`), after this charter was written.

`createLocalCheckoutWorkspace` now rejects a second visible workspace on an
occupied directory with `WorkspaceDirectoryOccupiedError` → wire errorCode
`workspace_directory_occupied`
([otto-worktree-service.ts:283](../../packages/server/src/server/otto-worktree-service.ts#L283)).
Its doc comment states the verdict this charter was asking for, and gives the
same reason:

> one directory is one physical git checkout, so two "independent" workspaces on
> it can never actually be independent (branch/diff/status fan out to every
> same-cwd workspace via `workspaceIdsOnCheckout`)

The invariant is stated as **"One directory = one live workspace"** in
[bootstrap.ts:1150](../../packages/server/src/server/bootstrap.ts#L1150), where
MCP `create_agent`, loops, and agent-spawned terminals were changed to _reuse_
the occupying workspace instead of minting a duplicate. The guard is covered by
green unit tests (verified: `otto-worktree-service.test.ts`, "rejects creating a
second local checkout workspace for an occupied directory", plus normalization
of trailing separators) and by a wire-level test asserting the error code
(`session.workspaces.test.ts:7622`).

So de-duplication intent now exists at **both** layers. The project-layer merge
(`merged_duplicate`) is about repo _identity_; the workspace guard is about
checkout _occupancy_. They are complementary, not evidence of an oversight.

### How users are actually getting them — hole #1, the reveal path

Not by deliberate effort, and not through the guarded path at all. **Schedule
runs.**

Schedule-run workspaces are minted `hidden: true` and are _deliberately exempt_
from the occupancy guard — reasonable in isolation, since a hidden record is
withheld from every client and disposed by its run lifecycle
([otto-worktree-service.ts:329](../../packages/server/src/server/otto-worktree-service.ts#L329),
with its own passing test: "hidden schedule-run workspaces bypass and do not
trigger the occupied-directory guard").

But `revealScheduleWorkspaceExternal`
([bootstrap.ts:1407](../../packages/server/src/server/bootstrap.ts#L1407)) flips
`hidden → false` on finish-and-keep or error with **no occupancy re-check**. The
exemption is granted on the promise that the record stays invisible, and the
reveal path silently breaks that promise. A run that errors on a directory the
user already has open promotes a hidden record straight into the forbidden
state — no gesture, no warning, no code path that could have said no.

Reproduced from the dev home's own registry
(`packages/desktop/.dev/otto-home/projects/workspaces.json`), no synthetic setup
needed:

- 89 workspace records total; **88 `local_checkout`, exactly 1 `worktree` ever**
- **75** point at the single `otto-code` directory
- 67 are schedule-run-shaped (created on the hour, hourly artifact-refresh runs)
- **15 of those are now visible** (`hidden` false), co-existing with the
  permanently-visible `"Qwen Development"` workspace on that same cwd

That is the charter's scenario, occurring in production data, entirely via the
reveal path. Note also that unnamed duplicates default to the **branch name** —
the registry contains several workspaces literally titled `"main"` and
`"master"` on one folder, i.e. the UI names them after the very state they share.

### Hole #2 — the legacy backlog is never cleaned up

The guard's comment concedes: _"Existing persisted duplicates from before this
guard are left untouched."_ There is no migration and no reconciliation rule.
`WorkspaceReconciliationService` merges duplicate **projects** by root but has no
equivalent for workspaces — and it actively _preserves_ every workspace during a
project merge, reparenting them onto the canonical project
([workspace-reconciliation-service.ts:228](../../packages/server/src/server/workspace-reconciliation-service.ts#L228)).
So a user who accumulated duplicates before 2026-07-16 keeps them forever, and
the guard reads to them as inconsistent: the state exists, but recreating it is
refused.

### What actually breaks

Weaker than the charter assumes, and that matters for the argument.

The registry does **not** go stale. `reconcileProject` re-reads real git for
every active workspace whose cwd exists and overwrites `branch` and `kind`, so
all same-cwd siblings converge on the true branch within the 60 s pass. The
branch label is honest; it is just _identical_ across siblings, and it changes
under a workspace the user never touched.

Everything Otto owns is already correctly per-`workspaceId` and is
extensively test-locked — agent ownership, status, attention, terminals, service
ports, env, script runtimes. `workspace-same-cwd-isolation.e2e.test.ts` exists
precisely to prove status never fans out across a shared cwd, and
`docs/agent-lifecycle.md:70` states the rule outright ("Ownership is never
derived from `cwd` — many workspaces may share one directory").

**So the real defect is not corruption — it is a false promise.** Everything
Otto controls is isolated; the two things it cannot control (the working tree and
HEAD) are shared, and those are exactly what the Changes tab and the branch label
put front and centre. Two rows that look independent, show identical diffs, and
move together when either commits.

Note the stale-test signal: `workspace-same-cwd-isolation.e2e.test.ts` has not
been touched since before the guard shipped, and still calls `createWorkspace`
twice on one cwd expecting success (line 456). Running it, the body is masked by
a Windows `EPERM` in the `finally` cleanup, so it fails for an unrelated reason —
which is likely why nobody noticed it now contradicts the guard.

### The case for allowing it — steelmanned

This is stronger than it first appears, and it is evidenced in the codebase.
Otto invested heavily in making a workspace an isolation unit for
**terminals, service ports, env, script runtimes, and agent ownership**. Two
workspaces on one checkout genuinely buys you two independent sets of all of
that, for zero disk and zero setup — legitimate for read-heavy work, for
single-branch repos, and for the common "several tasks against one checkout"
habit. Forcing a worktree taxes users who never needed branch isolation.

**Why it loses anyway:** Otto already serves that need with a cheaper mechanism
that doesn't lie. Several tasks against one checkout is what **multiple chats and
tabs inside one workspace** are for — the workspace is not the unit of task
organisation, the chat is. And the clobbering hazard is a property of the
_folder_, not of the workspace count: N agents editing one working tree is
already permitted inside a single workspace, so banning duplicates removes no
hazard. What it removes is a UI affordance that promises an independence the
filesystem cannot deliver. That is the whole value, and it is enough.

### Recommendation

Keep **prevent and steer**. Finish it:

1. **Re-check occupancy at reveal time.** `revealScheduleWorkspaceExternal` must
   not promote a hidden record onto an occupied directory. Preferred: reattach
   the run to the occupying workspace; otherwise archive-and-surface rather than
   reveal. This alone stops essentially all new duplicates.
2. **Reconcile the legacy backlog.** Give `WorkspaceReconciliationService` a
   workspace-level rule mirroring `mergeDuplicateProjectsByRoot` — keep the
   canonical (oldest visible) record, migrate agents/terminals, archive the rest,
   with a `merged_duplicate_workspace` change kind for the log.
3. **Update or delete the stale isolation tests**, and fix the Windows `EPERM`
   cleanup that is hiding their failure. They currently encode the _opposite_
   policy, in a file whose name implies it is the spec.
4. **Do not remove the per-`workspaceId` isolation machinery.** Pre-guard
   duplicates keep existing, worktrees legitimately share ancestry, and the
   scoping is load-bearing regardless.

### What would have to be true for me to be wrong

- If the per-workspace **terminals / service ports / env / script runtime** sets
  turn out to be what users actually want two of against one checkout, the right
  answer flips to _allow and make the sharing visible_ — and the fix is a shared
  banner plus one branch label per checkout, not a ban. The tell would be users
  asking for duplicates on purpose. The current data shows the opposite: of 75
  same-cwd records, only ~3 are deliberately named ("Qwen Development",
  "Sonnet Otto", "Graphify Setup"); the rest are machine-generated.
- If worktree creation is heavy enough on large repos that steering is real
  friction, the guard needs a cheap escape hatch rather than a hard refusal.
- If a future non-schedule path legitimately needs two visible workspaces on one
  cwd, the invariant is wrong rather than the reveal path.
