---
id: "finding-2026-07-25-workspace-tree-retention"
kind: "finding"
title: "Does the workspace deck evict, and what does a retained tree cost?"
status: "confirmed"
tags: ["finding", "client-performance"]
created_at: "2026-08-16T22:16:11.440Z"
updated_at: "2026-08-16T22:16:11.440Z"
---

# Does the workspace deck evict, and what does a retained tree cost?

<!-- compiled_truth -->

**Date:** 2026-07-25 · **Question:** the earlier finding concluded that mounted workspace trees are
never released and that ~35% of the frame rate goes with them. An eviction cap already existed. Was
that conclusion an artifact of a harness that never crossed it?

**Yes.** Eviction fires, and it fully releases the tree. The retention diagnosis in
[[finding-2026-07-25-fps-degradation]] is withdrawn, and so is the
frame-rate number attached to it - which turns out to come from a statistic that flips sign between
identical runs.

Instrument: [`docs/client-performance.md`](../../../docs/client-performance.md). Status:
[`projects/README.md` → Performance](../../../projects/README.md#performance).

## The premise being tested

`screens/workspace/workspace-deck-retention.ts` defines
`WORKSPACE_DECK_MAX_MOUNTED_WORKSPACES = 3`, consumed as `maxMountedWorkspaces` by the workspace
deck route. **The earlier soak seeded exactly three workspaces and measured 1 → 3** - entirely at or
below the cap, so the eviction path could not have run. At three workspaces, "retained because
nothing reclaims it" and "retained because the cap was never reached" produce the identical series.

## Method

Same instrument, same navigation-only soak. Three changes:

- **`OTTO_RESOURCE_SOAK_WORKSPACES`** (new, default 4 - deliberately above the cap). Six workspaces,
  all six visited, so eviction has to run.
- **Mounted-tree count**, read every cycle from `[data-testid^="workspace-deck-entry-"]`. This is
  the cause; `query.observers` is only the consequence. Having both is what separates "eviction
  never ran" from "eviction ran and released nothing".
- **Switch-back latency**, so the cap is never argued from one side only.

```bash
OTTO_RESOURCE_SOAK_E2E=1 OTTO_RESOURCE_SOAK_CYCLES=12 OTTO_RESOURCE_SOAK_WORKSPACES=6 \
E2E_BROWSER_CHANNEL=msedge npx playwright test client-resource-soak -g "workspace switching alone"
```

Cap values were swept by editing the constant between runs and restoring it; **two runs per cap
value**, which turned out to be the whole ballgame. **Environment:** dev build (unminified bundle,
React dev build), msedge via Playwright, mock provider, 6 workspaces, 12 cycles. Absolute numbers
are dev-mode - the comparisons are the finding.

**Since measured:** `WORKSPACE_DECK_MAX_MOUNTED_WORKSPACES` no longer exists. The cap became the
user setting `mountedWorkspaceLimit` (device-local, default 5), and `maxMountedWorkspaces` is now a
required argument with no constant behind it. The numbers below are read against the constant as it
stood; to reproduce them, sweep the setting rather than the source - which also avoids the reload
hazard recorded below.

**A harness error worth recording,** in the same family as the two in the earlier report. The first
version timed switch-back with `expectComposerVisible`, which resolves `.first()` across _every_
retained panel. During a cold switch the deck deliberately keeps the outgoing workspace painted
(`useDeferredValue` on a cold selection), so that assertion can be satisfied by the workspace being
navigated **away from**. It under-reported cold switches by 40% - 211ms against 353ms median once
the timer waited on the _target's_ own deck entry instead. An inactive deck entry is
`display: none`, so its own visibility is the unambiguous signal.

## Results

### Eviction fires, and it releases the tree

Six workspaces visited, cap 3, twelve cycles. Mounted trees, then observers:

```
mounted trees      1    2    3    3    3    3    3    3    3    3    3    3    3
query.observers  216  334  452  452  452  452  452  452  452  452  452  452  452  452
dom.nodes        523  710  874  874  874  874  860  874  874  856  874  874  874  874
```

Three steps, then flat for ten cycles **while three more distinct workspaces were visited**. The
deck holds the cap exactly, and the resident set stops at the 3-tree cost (452 observers) rather
than the 6-tree cost - which the cap-6 arm below shows to be 511–806. Reproduced across two runs
with identical numbers.

Corroborating signal in the same run: `query.unobserved` climbs 4 → 60. Observers being dropped
while their query entries survive as unobserved and gc-eligible is precisely the signature of a
React unmount. Nothing is holding the tree.

Cap 1 and cap 6 behave as the mechanism says they should:

```
cap 1   mounted trees     1    1    1    1    1    1    1    1    1    1    1    1    1
        query.observers 216  216  216  216  216  218  216  216  216  216  216  216  216  216
cap 6   mounted trees     1    2    3    4    5    6    6    6    6    6    2    3    4
        query.observers 216  334  452  570  688  806  806  806  806  806  806  280  452  570
```

### What one retained tree costs

From the cap-6 ramp, marginal cost is exactly linear in the resident set:

| Reading           | Per additional mounted workspace |
| ----------------- | -------------------------------- |
| `query.observers` | +59 to +118                      |
| `dom.nodes`       | +76 to +169                      |

The range is real, not measurement error: the two cap-6 runs stepped by +118 and +59 respectively.
A tree's cost depends on what that workspace has open, so **"cost per workspace" is a range, not a
constant** - any cap policy reasoned from a single number is reasoning from one arrangement of tabs.

### The frame-rate claim does not survive

The earlier report's headline - 1 → 3 workspaces costs ~35% of the frame rate - comes from the
`Client frame drift (first vs last decile)` line. At 12 cycles the sample count is ~14, and
`formatFpsDriftSection` computes `bucket = max(1, floor(n / 10))`, so **the "decile" is one
sample**. The headline is one 10-second frame window compared against one other.

Run the same configuration twice and the verdict changes:

| Cap | Run A                      | Run B                      |
| --- | -------------------------- | -------------------------- |
| 1   | no degradation (63.5→74.5) | **degraded** (93.4→76.8)   |
| 3   | no degradation (70.9→65.0) | **degraded** (90.9→59.5)   |
| 6   | **degraded** (71.5→54.7)   | no degradation (41.1→70.9) |

Every cap value produced both verdicts. The line is reading noise, not retention.

**At cap 1 the app holds exactly one tree for the entire run - retention is provably constant - and
the instrument still reports "frame rate degraded over the session".** A statistic that fires on a
configuration with no retention at all cannot be evidence about retention.

Mean fps across cycles does order with the resident set, but weakly:

| Resident trees | Mean fps, run A | Mean fps, run B |
| -------------- | --------------- | --------------- |
| 1              | 70.1            | 63.9            |
| 3              | 59.0            | 60.7            |
| 6              | 57.8            | 57.9            |

The 1 → 6 gap (~9 fps) is barely larger than the run-to-run spread inside the cap-1 arm (6.2 fps),
and single frame windows inside one steady state ranged from 29 to 85 fps. **This harness cannot
resolve a per-tree frame cost.** What it can say is that the cost is nowhere near the −35% that was
attributed to it, and that at the shipping cap the resident set is bounded at three regardless.

### Switch-back latency

Time until the target workspace's own deck entry is on screen, 12 switches per run:

| Cap | Switch back to               | Median    | Worst |
| --- | ---------------------------- | --------- | ----- |
| 1   | an evicted tree (cold mount) | 298–353ms | 838ms |
| 3   | a resident tree (warm)       | 356ms     | 482ms |
| 6   | a resident tree (warm)       | 392ms     | 512ms |

Warm and cold are indistinguishable here, and the _heavier_ app is if anything slower. Read this
narrowly: it measures **painted**, not **usable**. A cold mount paints its panel before the
timeline refetch lands, and that refetch is a separate open item. The "instant switch-back" that
retention is supposed to buy is not visible in this measure, and demonstrating it needs a
usable-not-painted signal.

### The second harness error: a concurrent source edit reloads the app mid-soak

Two anomalies appeared in the cap-6 runs and in one cap-1 run. Both are the **same harness fault**,
and neither is a property of the app. Recording it because it is the subtlest of the three and it
survived a first pass at diagnosis.

The resident set appeared to collapse and rebuild mid-run:

```
mounted trees      1    2    3    4    5    6    6    6    2    3    4    5    6
query.observers  216  216  275  334  393  452  511  511  511   59  275  334  393  452  511
dom.nodes        527  523  622  698  774  854  908  926  926  222  604  698  774  836  926
```

The first reading of that was the deck evicting its inactive entries -
`shouldKeepWorkspaceDeckEntryMounted` drops any inactive entry whose workspace is momentarily absent
from the hydrated session store, which would do exactly this. **The numbers rule it out.** A single
mounted tree measures 216 observers and ~525 DOM nodes, pinned by both clean cap-1 runs. The dip
goes to **59 observers and 222 DOM nodes** - below the one-tree floor. Deck-level eviction cannot go
below its own active tree, because the active tree is never evicted. Only a whole-app rebuild
reaches those numbers.

The cause: **editing app source while a soak is in flight.** Metro Fast Refresh re-evaluates the
changed module graph, which rebuilds the React tree and re-creates the resource monitor singleton
with an empty sample ring. This checkout had a second session editing `use-settings/storage.ts`
during these runs. It is the `page.goto` mistake from the earlier report wearing a different hat -
the same state reset, arriving from the editor instead of from the harness.

It also explains the other anomaly: one cap-1 run finished with 3 samples in a ring that should have
held 14, reporting "not enough samples to fit a trend" while the daemon-traffic counters ran
continuously through it. A fresh monitor singleton beside a surviving daemon client is precisely
that shape. **That was read as a possible instrument defect. It was not; the instrument was fine.**

**Which runs this touches, and which conclusions it does not.** The two cap-6 runs and one cap-1
latency run are affected; their ramps before the reset are still clean, and the cap-6 steady state
(806 observers at six trees) is read off the pre-reset plateau. Every load-bearing conclusion rests
on runs with no reset in them: **both cap-3 runs and both clean cap-1 runs**. In particular the
verdict-flipping result does not depend on a contaminated run - cap 3 flips between two clean runs
(no degradation, then degraded), and so does cap 1 (63.5→74.5, then 93.4→76.8).

## Hypotheses retired

| Hypothesis                                              | Retired by                                                                                                                         |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Mounted workspace trees are never released              | Mounted-tree series flat at the cap while 6 workspaces were visited                                                                |
| A `RetainedPanel` going inactive is masking a live tree | `query.unobserved` 4 → 60: observers dropped, query entries left gc-eligible                                                       |
| Retained trees cost ~35% of the frame rate              | The statistic behind it flips verdict between identical runs, and fires at cap 1                                                   |
| The cap is too generous for its frame cost              | Cap 3 vs cap 6 is within run-to-run noise on every frame metric measured                                                           |
| The deck drops its whole resident set mid-session       | The dip goes below the one-tree floor (59 vs 216 observers) - an app rebuild, from a concurrent source edit hot-reloading the page |
| The monitor silently loses samples                      | Same cause. A fresh singleton beside a surviving daemon client, not a ring-buffer defect                                           |

## What is actually true

1. **Eviction works.** The deck is an LRU capped at 3, it fires above the cap, and unmounting
   releases the tree's `useQuery` observers and DOM. Retention is bounded by the cap, not by
   workspaces-visited.
2. **The cost of a session is not a function of how many workspaces it has touched.** It is a
   function of the cap, which is a constant.
3. **The cap is not a frame-rate lever at these sizes.** Doubling the resident set from 3 to 6 costs
   ~350 observers and ~490 DOM nodes and no frame rate this instrument can measure. Lowering the cap
   buys nothing measurable and costs switch latency; that is the wrong direction.
4. **The remaining Performance items are untouched by this.** Navigation refetch, `agentStreamTail` /
   `agentStreamHead` eviction, and render-cost-per-inbound-message are all still open, and the third
   is now the _only_ live mechanism for the reported symptom - this soak drives idle agents, so it
   never exercises `push rate × mounted subscriber count`.

## Not concluded

No behaviour changed. The cap constant was restored to 3 after the sweep. Whether the default should
move is a live question, but it belongs to the "make the cap a setting" item and should be decided
on switch latency and the working-set-of-4 thrashing case - **not** on frame rate, which is what
this report removes from the argument.

## Timeline

- time: "2026-08-16T22:16:11.440Z"
  kind: "migration"
  summary: "Migrated from the legacy findings report without discarding its evidence."
  source: "findings/client-performance/2026-07-25-workspace-tree-retention.md"
