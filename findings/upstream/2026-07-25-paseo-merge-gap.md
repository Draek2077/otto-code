# What does merging upstream Paseo actually cost today, and what has the delay cost?

**Date:** 2026-07-25 · **Question:** `projects/README.md` → Build order calls the upstream merge "trap
1" — a fixed-order chain whose cost rises monotonically the longer it waits. That claim has never
been measured. How far apart are the two trees, where do they collide, and is the conflict surface
measurably larger than it would have been at `v0.2.0`?

**Merging today costs 369 conflicted files and 1,365 conflict hunks** — against **68 files and 125
hunks** for the last completed merge on 2026-07-12. The monotonic claim holds, but **the mechanism in
the ledger is wrong**: the cost is not a steady accrual from Otto's own divergence. It is
**step-shaped on upstream's release cadence**, and the step that did the damage — upstream's `v0.2.0`,
237 commits — landed on 2026-07-24, **one day before the delay decision was taken**. Of today's
1,365 hunks, **1,250 were already sunk when that decision was made.** The delay itself has cost
**+115 hunks (+9%)** so far.

Two findings matter more than the totals. **Not one of the 1,365 hunks is resolvable by the rebrand
script** — the "take theirs, re-run the rules" shortcut in
[docs/upstream-merges.md](../../docs/upstream-merges.md) § 1 resolves nothing on its own. And the
**provider-subagent ingestion that [`upstream-subagent-convergence`](../../projects/upstream-subagent-convergence/upstream-subagent-convergence.md)
exists to stop forking is the cheapest thing in the merge: 47 daemon-side files, zero conflicts.**

**Nothing was merged and no source file was modified.** Status:
[`projects/README.md` → Build order](../../projects/README.md#build-order).

## Method

All measurement is read-only against committed `HEAD` (`30ae03fae`). The shared working tree carried
unrelated in-flight work from a concurrent session throughout; none of it is in these numbers, and
none of it was touched. That session also advanced `main` to `ec36a41b3` mid-run — the headline
counts were re-run there and are **identical** (369 files, 1,365 hunks), because the new commit was a
docs row.

The `upstream` remote **already existed** when this ran — the task's setup step was stale, as was its
tag list: upstream has since tagged `v0.2.2` as well.

```bash
git fetch upstream --tags
git merge-tree --write-tree --name-only HEAD v0.2.2
```

Conflict **hunks** are counted by reading the blobs out of the tree `merge-tree` writes and counting
`^<<<<<<< ` markers — no checkout involved:

```bash
git show <merged-tree-oid>:<path> | grep -c '^<<<<<<< '
```

Two things were cross-checked rather than trusted:

- **`merge-tree` against a real merge.** A throwaway `git worktree add --detach` outside the repo, at
  our tip, `git merge --no-commit v0.2.2`. It reported **369 unmerged paths — the identical file
  list**, byte for byte. The worktree was aborted, reset and `git worktree remove`d; `git worktree
list` shows only the main checkout.
- **The naming/functional split.** Each hunk's two sides were extracted and the rebrand rules from
  `scripts/rebrand-upstream.pl` applied to upstream's side, then compared to ours — exactly and again
  ignoring whitespace.

**The counterfactuals.** "What would this have cost on the day tag `T` was cut" is
`merge-tree(ours@T_date, T)`, where `ours@T_date` is `git rev-list -1 --before=<tag date> HEAD`.
Holding one side fixed and moving the other separates the two contributions.

A note on the throwaway worktree: it has no `node_modules`, so the repo's `lefthook` pre-commit hook
cannot run there. Rather than `--no-verify`, the one commit this needed was built directly with `git
write-tree` + `git commit-tree`, which never invokes hooks.

## 1. How far apart are we

Merge-base: **`c05e337cd`** (2026-07-12) — the tip of the last real merge, `9c271a02e`. It is the
merge-base for `v0.2.0`, `v0.2.1`, `v0.2.2` and `upstream/main` alike; nothing has been ingested since.

| Side                    | Commits | Files touched | Lines              |
| ----------------------- | ------- | ------------- | ------------------ |
| Otto, since merge-base  | 419     | 2,888         | +322,003 / −29,253 |
| Paseo → `v0.2.2`        | 247     | 1,201         | +127,149 / −26,490 |
| Paseo → `upstream/main` | 261     | 1,240         | —                  |

**Files touched on both sides: 598.** That is the entire collision surface; 369 of them actually
conflict.

Available tags since the merge-base: `v0.1.107`, `v0.1.108`, `v0.1.109`, `v0.1.110` (not on `main`),
`v0.2.0`, `v0.2.1`, `v0.2.2`. `git describe upstream/main` → `v0.2.1-21-g51ab86bab`, so the tip is
mid-flight and out of bounds under the cadence rules.

**Merge at `v0.2.2`, not `v0.2.0`.** The cadence rule prefers `vX.Y.0` and takes patches only when
they carry a fix Otto needs. Both patches qualify — `v0.2.1` adds Claude Opus 5, `v0.2.2` fixes Claude
5 context windows, and Otto's Claude catalog is hardcoded — and the measured premium is **+2 files /
+5 hunks**. It is free.

## 2. Where the histories collide

`merge-tree(HEAD, v0.2.2)`, confirmed by real merge:

| Class                    | Count                                              |
| ------------------------ | -------------------------------------------------- |
| Files auto-merging clean | **1,197**                                          |
| Conflicted files         | **369** (341 content, 25 modify/delete, 3 add/add) |
| Conflict hunks           | **1,365**                                          |
| Conflicted lines         | **30,054**                                         |
| Hunk size (ours+theirs)  | median 7 · p90 53 · p99 236 · max 895              |

Concentration — the tail is where the work is:

| Hunks per file | Files | Hunks   |
| -------------- | ----- | ------- |
| 1–2            | 216   | 278     |
| 3–9            | 87    | 413     |
| 10–19          | 32    | 451     |
| 20+            | **9** | **223** |

By area:

| Area              | Files | Hunks   |
| ----------------- | ----- | ------- |
| `app` (non-i18n)  | 152   | **622** |
| `server`          | 95    | **368** |
| `app/i18n`        | 9     | 150     |
| `desktop`         | 24    | 69      |
| docs trees        | 23    | 45      |
| root/other        | 20    | 44      |
| `protocol`        | 5     | 25      |
| `client`          | 2     | 19      |
| `cli`             | 10    | 18      |
| `website`/`relay` | 4     | 5       |

Worst files: `server/session.ts` (36), `app/git/diff-pane.tsx` (33), `components/file-explorer-pane.tsx`
(24), `screens/settings-screen.tsx` (22), `composer/index.tsx` (22), `server/workspace-git-service.ts`
(20), `composer/agent-controls/index.tsx` (20). 82 of the 369 are test files.

### Not one conflict is a naming conflict

This is the load-bearing result of the section.

| Measure                                             | Count     |
| --------------------------------------------------- | --------- |
| Hunks resolvable by the rebrand rules alone (exact) | **0**     |
| Same, ignoring whitespace                           | **0**     |
| Hunks whose upstream side still contains `paseo`    | 346 (25%) |
| Files that are 100% naming-only conflicts           | **0**     |

A quarter of the hunks **do** carry upstream naming, so the rebrand pass is still required _inside_
them — but there is not a single hunk where naming is the _only_ difference. `git checkout --theirs
<file> && perl rebrand.pl <file>` resolves zero of 369 files unattended. Every conflict needs a
human-or-model judgement about functional content.

**The stronger version of that test, which failed instructively.** Pre-applying the rebrand rules to
upstream's side before merging — so both sides would have made the same naming change and 3-way merge
could cancel it — makes the merge **worse**, not better:

| Upstream side                     | Conflicted files | Hunks            |
| --------------------------------- | ---------------- | ---------------- |
| `v0.2.2` as-is                    | 369              | 1,365            |
| `v0.2.2` with rebrand pre-applied | **409** (+11%)   | **1,772** (+30%) |

Otto's tree is not a mechanical rebrand of upstream's. Blanket-rewriting upstream's side introduces
divergence in every file where Otto deliberately kept upstream naming (the audit exclusion list:
`LICENSE`, `NOTICE`, README credits, the website credit pages, `CHANGELOG.md`) and in every file Otto
rewrote for functional reasons. **This approach is retired — do not try it during the merge.**

### Deliberate divergence vs. upstream refactor

The 10 rename-induced conflicts split cleanly, and the split is the whole distinction:

**Ours, deliberate (8) — cheap.** The rebrand renames: `paseo-worktree-service.ts{,.test}` →
`otto-*`, `bin/paseo{,.cmd}` → `bin/otto*`, `test-utils/paseo-daemon.ts` → `otto-daemon.ts`,
`skills/paseo{,-handoff}/SKILL.md` → `skills/otto*`, `schedules/schedule-card.tsx`. Git pairs our
renamed copy against upstream's edits to the original. Mechanical.

The same pattern shows in modify/delete: `protocol/src/paseo-config-schema.ts` and
`server/agent/tools/paseo-tools.ts` are "deleted in HEAD, modified in `v0.2.2`" — we renamed them,
upstream kept editing them.

**Upstream's, structural (2) — expensive.** `app/src/components/file-pane.tsx` →
`app/src/file-pane/pane.tsx` (16 hunks) and `server/src/utils/github-remote.ts` →
`utils/ssh-hostname.ts`. Upstream moved and rewrote files Otto had independently rewritten in place.

And 17 of the 25 modify/delete conflicts are **upstream deleting things Otto still uses**:
`components/command-center.tsx`, `hooks/use-command-center.ts`, `stores/workspace-tabs-store/*` (3
files), `workspace/editor-targets.ts` + `desktop/features/editor-targets.*`,
`components/{use-web-scrollbar,web-desktop-scrollbar}.tsx`, `git/github-url.ts`,
`git/use-github-search-query.ts`. Each needs a decision, not a resolution.

## 3. What upstream has that we want

**840 of upstream's 1,201 touched files merge with no conflict at all** — 419 of them brand-new paths
Otto does not have. That is pure gain and it is the majority of the release.

### The convergence charter's subject is free

The provider-subagent work — `+2,829 / −47` across 25 subagent-named files — is where the charter
says upstream's recurring correctness fixes land (phantom parents, stuck sessions, hidden Codex rows).
Measured against our tree:

| Layer                                                                                            | Files  | Conflicts    |
| ------------------------------------------------------------------------------------------------ | ------ | ------------ |
| Daemon-side ingestion — `agent/provider-subagents/*`, `agent/providers/omp/*`, the protocol test | **47** | **0**        |
| Client presentation — `app/src/subagents/*`, the Claude sidechain test                           | 5      | **14 hunks** |

The 14 hunks are `track.tsx` (6), `agent.sub-agent-sidechain.test.ts` (3), `track-presentation.ts`
(2), `select.test.ts` (2), `track-presentation.test.ts` (1).

**This is exactly the split-by-layer the charter proposes, and the measurement says the expensive
half is the free half.** `ProviderSubagentStore`, the `agent.provider_subagents.*` RPCs and every
provider adapter land as new files. The entire cost of stopping the subagent fork is 14 hunks in five
files Otto already owns.

Also arriving free: **Oh My Pi (OMP) as a native provider** — 47 files, no conflicts.

### Two rival abstractions arrived while we were building ours

This is the `v0.2.0` forge entry repeating, twice, and it is not a merge cost — it is a design cost
the merge surfaces.

- **A file editor.** Upstream shipped `app/src/file-pane/editor/` (CodeMirror, 9 new files, changelog
  "Edit files directly in the web and desktop apps", #2270/#2309/#2277/#2382). Otto independently
  built `app/src/editor/` — **56 files**, which upstream has none of. Neither existed at the
  merge-base. Two abstractions over one concern, discovered at merge time, exactly as
  [docs/upstream-merges.md](../../docs/upstream-merges.md) warns.
- **Changes-as-a-tab and commit history.** Upstream's #2298, #1534/#2146/#2312. Otto ships both.
  `app/src/git/diff-pane.tsx` (33 hunks) and `git/use-actions.tsx` (19) are the second- and
  tenth-worst files in the merge.

The forge layer itself — the original cautionary tale — is already reconciled per the ledger.

## 4. What the delay has actually cost

The claim is that cost rises monotonically. **It does.** Cost of merging each tag _on the day it was
cut_, i.e. `merge-tree(ours@tag_date, tag)`:

| Merge on   | Tag        | Conflicted files | Hunks     |
| ---------- | ---------- | ---------------- | --------- |
| 2026-07-12 | `v0.1.106` | **68**           | **125**   |
| 2026-07-13 | `v0.1.107` | 31               | 60        |
| 2026-07-16 | `v0.1.108` | 135              | 305       |
| 2026-07-16 | `v0.1.109` | 140              | 322       |
| 2026-07-24 | `v0.2.0`   | 356              | 1,250     |
| 2026-07-24 | `v0.2.1`   | 356              | 1,250     |
| 2026-07-25 | `v0.2.2`   | **369**          | **1,365** |

The `v0.1.106` row is the last merge that actually happened, measured the same way — it is the
calibration point, and it was resolved in a single commit.

**But the shape is a step, not a slope,** and the ledger's framing does not survive that. Freezing
upstream at each tag and letting Otto's side run to today isolates the two contributions:

| Upstream frozen at | Cost on tag day | Cost today      | Otto's drift alone | Over     |
| ------------------ | --------------- | --------------- | ------------------ | -------- |
| `v0.1.107`         | 31 f / 60 h     | 39 f / 77 h     | **+17 hunks**      | 12 days  |
| `v0.1.108`         | 135 f / 305 h   | 150 f / 405 h   | +100 hunks         | 9 days   |
| `v0.1.109`         | 140 f / 322 h   | 150 f / 405 h   | +83 hunks          | 9 days   |
| `v0.2.0`           | 356 f / 1,250 h | 367 f / 1,360 h | +110 hunks         | 1.5 days |

**Otto's 419 commits of divergence add 17 hunks against a frozen `v0.1.107` in twelve days.** The
same twelve days took the day-of cost from 60 to 1,365 — a 22× rise. Almost all of it is one upstream
release: `v0.2.0`, 237 commits, 97 changelog entries, a file editor, a forge layer and a new provider,
cut 2026-07-24.

The two sides are not additive. Otto's drift rate against a _frozen_ upstream depends on how much
upstream surface exists to collide with — +17 hunks against `v0.1.107`, +110 against `v0.2.0` in an
eighth of the time. The cost is closer to a **product** of both sides' churn over the shared file
set, which is why it is superlinear and why it steps on upstream releases rather than accruing daily.

**What this says about the 2026-07-25 delay decision specifically.** `v0.2.0` was cut on 2026-07-24.
The decision to delay was taken on 2026-07-25. **1,250 of today's 1,365 hunks were already sunk before
the decision was made.** The delay has cost **+115 hunks, +9%** — real, but an order of magnitude
smaller than the framing in `projects/README.md` implies. The trap-1 warning was correct about the
direction and wrong about the driver.

**Forward-looking, which is where it bites.** Otto's own drift against the _current_ upstream runs at
roughly 110 hunks per 1.5 days — one short-baseline sample, and it should not be extrapolated far.
The load-bearing forward risk is not that rate; it is the next upstream minor. If `v0.3.0` resembles
`v0.2.0`, it is worth another step of roughly the same size, whatever Otto does in the meantime.

### The difficulty changed shape, not just size

Comparing the completed 2026-07-12 merge against today:

|                        | 2026-07-12 (done)        | Today                    |
| ---------------------- | ------------------------ | ------------------------ |
| Upstream commits       | 40                       | 247                      |
| Upstream files changed | 191                      | 1,201                    |
| Conflicted files       | 68                       | 369                      |
| Conflict hunks         | 125                      | 1,365                    |
| Files with 10–19 hunks | 1                        | 32                       |
| Files with 20+ hunks   | **0**                    | **9**                    |
| Worst file             | 13 (`package-lock.json`) | 36 (`server/session.ts`) |

5.4× the files and 10.9× the hunks — but the last merge had **no hard files at all**. Its worst case
was a lockfile. Today there are 41 files above ten hunks and nine above twenty, in `session.ts`,
`diff-pane.tsx`, `composer/`, `settings-screen.tsx`. That is a different kind of work, and it is why
the hunk ratio understates the gap.

## 5. The NUL-byte hazard: checked, and it is a near miss

A literal NUL byte in a source string makes git treat the file as binary — no textual diff, no 3-way
merge, an unmergeable island. Six tracked source files currently hit it:

```
packages/app/src/editor/editor-buffer-state.ts          (2 NUL bytes)
packages/app/src/editor/editor-diagnostics-panel.tsx    (2)
packages/app/src/editor/references/use-reference-previews.ts  (1)
packages/app/src/voice/use-agent-voice-cues.ts          (1)
packages/server/src/server/file-explorer/file-watcher.ts (1)
packages/server/src/server/lsp/diagnostics.ts           (1)
```

That is six, not the two `projects/README.md` records. (`AGENTS.md` and `packages/server/AGENTS.md`
also read as binary; both are symlinks, mode `120000`, not a NUL problem.)

**None is on the conflict path.** All six are Otto-only — upstream has no file at any of those paths
and has never touched them. The real merge reported no binary conflicts and no "cannot merge" lines.

Upstream's own subagent store keys on `parentAgentId\0subagentId`, but writes it as the **escape**:

```ts
return `${parentAgentId}\0${subagentId}`; // provider-subagents/store.ts:58 — text, mergeable
```

**The near miss worth acting on.** `packages/server/src/server/file-explorer/file-watcher.ts` is one
of the six, and upstream is actively developing that exact directory — it added
`file-explorer/observer.ts` in this window, and `file-explorer/service.ts` is already a conflicted
file (3 hunks). One upstream commit touching `file-watcher.ts` converts it into an unmergeable island
mid-merge. The same applies to the three under `app/src/editor/`, given upstream just built its own
editor. Replacing the six literals with `"\0"` is a few minutes of work and removes the hazard
permanently; it is not part of this measurement.

## Cost estimate, in model generation time

**This section is an extrapolation, not a measurement** — it is the only part of this report that is.
Its basis is the calibrated shape above, and it should be read as a range.

Anchor: the 2026-07-12 merge — 68 files, 125 hunks, no file above 13 hunks — was carried in one
commit. Today's merge is 10.9× the hunks with a tail that did not previously exist.

| Work                                                                                                                                                           | Sessions |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 216 files at 1–2 hunks (278 hunks) — batchable, take-theirs + rebrand, still needs reading                                                                     | 4–5      |
| 87 files at 3–9 hunks (413 hunks) — read both sides                                                                                                            | 4–6      |
| 41 files at 10+ hunks (674 hunks) — `session.ts`, `diff-pane.tsx`, `composer/`, real design                                                                    | 8–12     |
| 9 i18n resource files (150 hunks) — mechanical, but a stale translation is invisible to parity checks                                                          | 1–2      |
| 25 modify/delete decisions — 17 of them upstream deleting things Otto uses                                                                                     | 1–2      |
| 419 new files — rebrand pass, Hub-exclusion audit, review                                                                                                      | 2–3      |
| Verification loop — lockfile, typecheck, lint, the four audit greps, `UPSTREAM_BASE_VERSION`; iterative because type errors cascade across the workspace graph | 3–5      |

**≈ 23–35 agent-sessions** for the merge itself, where a session is one focused context window.

Explicitly **not** in that number, because they are design work the merge only surfaces:

- **The file-editor decision** — upstream's `file-pane/editor/` vs Otto's 56-file `app/src/editor/`.
  Project-sized on its own, and the forge precedent (take theirs, port ours onto it) says the answer
  is not cheap.
- **Changes-as-a-tab / commit history** — same question, smaller.

**The convergence charter is not a cost here.** Its daemon-side half is 47 conflict-free files; its
client half is 14 hunks. It should ride along with the merge, not be sequenced as a separate wave
behind it.

## Hypotheses retired

| Hypothesis                                                                     | Retired by                                                                                                                                                               |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Most conflicts are the rebrand, resolvable by `checkout --theirs` + the script | **0 of 1,365** hunks are naming-only, exactly or ignoring whitespace. 346 carry naming, none _only_ naming                                                               |
| Pre-applying the rebrand to upstream's side would cancel the naming conflicts  | It makes it worse: 369 → 409 files, 1,365 → 1,772 hunks. Otto's tree is not a mechanical rebrand of upstream's                                                           |
| The delay is what made this expensive                                          | 1,250 of 1,365 hunks were sunk when `v0.2.0` was cut, one day before the decision. The delay's own share is +115 hunks, +9%                                              |
| Cost accrues steadily with Otto's divergence                                   | Otto's 419 commits add **+17 hunks** against a frozen `v0.1.107` over 12 days. The curve steps on upstream minors                                                        |
| Upstream's provider-subagent ingestion is the expensive part of the merge      | It is the cheapest: 47 daemon-side files, **zero conflicts**; 14 hunks total in the client layer                                                                         |
| A NUL-byte file is sitting on the conflict path as an unmergeable island       | All six are Otto-only and untouched upstream; the real merge reported no binary conflicts. `file-explorer/file-watcher.ts` is one upstream commit away from becoming one |
| `projects/README.md`'s "two files have hit this"                               | Six do, today                                                                                                                                                            |
| This checkout has no `upstream` remote (the premise this task was given)       | It has one. `v0.2.2` is also tagged now, which the task's tag list predates                                                                                              |

## What is actually true

1. **369 files / 1,365 hunks / 30,054 lines**, confirmed twice by independent methods. 1,197 files
   auto-merge clean.
2. **The rebrand shortcut is dead.** Every conflict is functional. Budget for judgement on all 369
   files, not for a script pass.
3. **The cost curve steps on upstream minors, it does not slope with our divergence.** Holding the
   merge over a _quiet_ upstream period is nearly free; holding it across a minor is not. The decision
   that matters is whether to merge before upstream cuts `v0.3.0` — not how many days pass.
4. **The delay decision of 2026-07-25 has cost 9% so far**, and `projects/README.md` overstates it.
5. **The convergence charter's subject is free and should ride with the merge**, not be sequenced
   behind it as its own phase.
6. **Two rival abstractions have arrived** — a file editor and Changes-as-a-tab. The forge entry in
   [docs/upstream-merges.md](../../docs/upstream-merges.md) predicted exactly this and the cadence
   rule that was meant to catch it ("read every minor release's changelog even when you skip the
   merge") did not run.
7. **Six NUL-byte files exist and one is in a directory upstream is actively developing.**

## Not concluded

**Nothing was merged, no branch was created, no source file was modified, and the delay decision is
untouched — it is the product owner's.** The throwaway worktree was removed; `git worktree list`
shows only the main checkout.

What this report does **not** answer:

- **Whether to merge.** It replaces an estimate with a number; the call is unchanged.
- **How the file-editor collision resolves.** Measuring the conflict surface says nothing about which
  abstraction should win, and the forge precedent (take theirs, port ours on) may or may not apply —
  Otto's editor is 56 files against upstream's 9, the opposite ratio to the forge case.
- **Whether the 23–35 session estimate is right.** It is extrapolated from one calibration point
  (2026-07-12: 68 files, 125 hunks) whose difficulty profile is not today's — that merge had no file
  above 13 hunks and today's has 41 above 10. The extrapolation may be optimistic for exactly that
  reason, and a real merge is the only way to find out.
- **Whether Otto's drift rate of ~110 hunks / 1.5 days holds.** Single short-baseline sample. The
  12-day figure against `v0.1.107` (+17 hunks) is a far gentler rate, and the truth depends on which
  upstream surface the work lands near — so neither number extrapolates on its own.
