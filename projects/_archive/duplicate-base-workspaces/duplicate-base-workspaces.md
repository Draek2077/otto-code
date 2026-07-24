# Investigation: duplicate non-worktree workspaces on the same base folder

> **ARCHIVED 2026-07-24 — closed, do not re-open.** Verdict: **prevent and steer
> to a worktree**. Items 1–3 of the revised recommendation were implemented the
> same day (client steer, schedule-reveal reattach, stale e2e tests + the `EPERM`
> teardown that was masking them). Item 4 (workspace-level reconciliation of
> pre-guard duplicates) stays deliberately deferred. Current behaviour is
> documented in [docs/workspace-lifecycle.md](../../../docs/workspace-lifecycle.md)
> — read that first; everything below is the reasoning that produced it, kept for
> the record.

Users are ending up with **multiple non-worktree workspaces pointing at the same
base folder**. Run this as its own session.

**The deliverable is a verdict with reasoning, not a patch.** Come back with a
recommendation and the argument behind it: is allowing this a **bad idea** we
should prevent, or a **great idea** we should support properly? Either answer is
acceptable — an unargued "it depends" is not. Do not change behaviour in that
session; propose.

Related: [docs/chat-lifecycle.md](../../docs/chat-lifecycle.md),
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

> **Correction (2026-07-24 re-verification):** that last bullet conflated
> `hidden: false` with _live_. Re-measured, 23 records on that cwd have
> `hidden: false` but **22 are archived — exactly 1 is live and visible**. The
> duplicates were real and did co-exist, but the user manually drained them. See
> the re-verification section at the end; the conclusion is unchanged and the
> reveal-path finding gets stronger, not weaker.

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
`docs/chat-lifecycle.md:70` states the rule outright ("Ownership is never
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

---

## Re-verification — 2026-07-24

Re-ran the verdict against current `main`. **The recommendation stands: prevent
and steer to a worktree.** Every structural claim above still holds in code. Two
factual claims needed correcting, and one gap was missed entirely — the missed
gap is now the highest-value item on the list.

### Confirmed unchanged

| Claim                                                                        | Where                                                                      |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Guard exists and rejects a 2nd visible workspace on an occupied dir          | `otto-worktree-service.ts:340-352`                                         |
| Guard is wired to the user-facing RPC, not just an internal helper           | `session.ts:6091` maps it to `workspace_directory_occupied`                |
| Hidden schedule-run records are exempt                                       | `findOccupyingWorkspaceForCwd` skips `archivedAt \|\| hidden` (`:319`)     |
| `revealScheduleWorkspaceExternal` flips `hidden → false` with no re-check    | `bootstrap.ts:1416-1427` — the whole body, no occupancy call               |
| Reconciler has no workspace-level dedup, and _preserves_ workspaces on merge | `workspace-reconciliation-service.ts:230-249`                              |
| Branch labels stay honest, just identical across siblings                    | `reconcileProject` overwrites `branch` per workspace (`:348`)              |
| The isolation e2e test encodes the opposite policy                           | `workspace-same-cwd-isolation.e2e.test.ts:456-509` creates a 2nd _and_ 3rd |

### Correction 1 — the standing backlog is empty, so fix #2 is speculative

Fresh measurement of `packages/desktop/.dev/otto-home/projects/workspaces.json`:

- 90 records (up 1); 88 `local_checkout`, 1 `worktree`, 1 `directory`
- 75 still on the `otto-code` directory — but of those, **1 is live and visible**
  (`"Qwen Development"`), 52 are hidden, 74 are archived
- **0 directories anywhere in the registry currently hold more than one visible,
  active workspace**

The 22 archived-but-`hidden: false` records are the reveal path's fingerprints:
hourly `"Artifact refresh"` / `"Artifacts refresh"` / `"Artifact maintenance"`
runs, revealed onto the occupied directory, then cleared by hand — six of them
archived inside the same 5-second burst at `2026-07-18T23:37`, which is what a
user mass-selecting rows in the sidebar looks like.

Two consequences:

- **Fix #1 (reveal-time re-check) gets stronger.** This is not a theoretical
  hole. It minted ~22 unwanted visible rows across ~2 days of hourly runs and
  cost the user a manual cleanup pass. It is a recurring tax, not a one-off.
- **Fix #2 (reconcile the legacy backlog) gets weaker and should drop in
  priority.** There is no standing backlog to migrate here — the user already
  drained it manually. Writing a `merged_duplicate_workspace` reconciliation rule
  that mutates workspace records, migrates agents and terminals, and archives
  rows is a genuinely risky piece of automation to build against zero observed
  data. Ship #1 first; only build #2 if duplicates are still found in the wild
  afterwards.

Caveat on the clean reading: the newest record on that cwd is
`2026-07-19T00:00`, so no schedule has run in five days. The zero-duplicate state
reflects an idle schedule plus a manual cleanup, **not** a fix. Re-enable the
hourly schedule and the duplicates come back.

### Correction 2 — "steer" was never built; only "prevent" shipped

This is the miss. `workspace_directory_occupied` has **zero handlers anywhere in
`packages/app/src`** — no error-code branch, no dedicated UI. The client renders
the daemon's raw message string:

> This directory already backs the workspace "X". Open that workspace instead, or
> archive it before creating a new one here.

The copy is good, but it is a dead end: there is no button to open workspace X,
and **no offer to create a worktree instead** — which is the entire point of
"steer to a worktree". The user is told what they cannot do and left to find the
alternative themselves.

Meanwhile individual internal callers each hand-roll their own reuse workaround
rather than surfacing the error — `bootstrap.ts:1150` for MCP `create_agent`,
loops, and agent-spawned terminals, and `new-workspace-view-documentation.ts:36`
for the README button, whose comment says it plainly: _"without this the button
just surfaces that error instead of opening the file the user asked for."_ Every
caller that cared has independently discovered that raw refusal is the wrong
answer, and patched around it locally. That is the shape of a missing shared
affordance.

**This is now the top item.** A guard that refuses without offering the
alternative is exactly the "adds friction" failure mode the steelman warned
about, and it is the difference between users experiencing the policy as helpful
and experiencing it as a wall.

### Correction 3 — reveal has two call sites, not one

A fix for #1 must cover both, or interrupted runs keep leaking duplicates:

1. `schedule/service.ts:1185` — post-run, on finish-and-keep or error
2. `schedule/service.ts:683` → `:716` — interrupted-run recovery after a daemon
   restart, which deliberately reveals so a kept run is not orphaned hidden
   forever

Both call the same unchecked `revealWorkspace`. The cleanest fix is to put the
occupancy decision inside `revealScheduleWorkspaceExternal` itself rather than at
either call site, so both inherit it and any third caller does too.

### Revised recommendation — same verdict, reordered

1. **Build the steer.** Handle `workspace_directory_occupied` in the client with
   two real actions: _Open "X"_ and _Create a worktree here instead_. Without
   this the shipped policy is prevention only.
2. **Re-check occupancy at reveal time**, inside
   `revealScheduleWorkspaceExternal` so both call sites are covered. Prefer
   reattaching the run to the occupying workspace; otherwise archive-and-surface
   instead of revealing.
3. **Update or delete the stale isolation tests** and fix the Windows `EPERM`
   cleanup masking their failure. They currently assert the opposite policy in a
   file whose name implies it is the spec.
4. **Defer the legacy-backlog reconciliation** until duplicates are observed
   after (2) lands. No standing backlog exists to justify it today.
5. **Do not remove the per-`workspaceId` isolation machinery** — unchanged from
   the original verdict, and load-bearing regardless.

### What would still have to be true for the verdict to be wrong

Unchanged from above, with one sharpened tell: the original said the giveaway
would be _users asking for duplicates on purpose_. The re-measured data makes
that test cleaner — of 75 same-cwd records, exactly **one** is a deliberate,
human-named, still-live workspace. Every other same-cwd record was machine-minted
and has since been archived. Nobody is asking for this. If that ratio inverts,
revisit.
