# QA reporting & evidence

How a human validates that the e2e suite actually works — not just that it exits 0.

The suite produces four artifacts on every run. Three of them are generated; none
are committed (`e2e-report/` and `playwright-report/` are gitignored, regenerated
from scratch each run so a stale money shot can never be mistaken for proof).

## What a run produces

```
packages/app/
  e2e-report/
    index.md                      ← table of contents, per module
    failures.md                   ← every failure, with error + link to evidence
    run.log                       ← full chronological log (errors + test stdio)
    money-shots/
      index.md                    ← the digest: one confirming frame per test
      <module-slug>/<spec>__<test>.png
    modules/
      <module-slug>/<spec>/<test-slug>/
        result.md                 ← status, duration, evidence index
        01-…png 02-…png           ← every screenshot, in capture order
        stdio.log
  playwright-report/              ← Playwright's own HTML report (traces, videos)
```

- **`index.md`** — run verdict, a per-module scoreboard table, then every spec and
  test grouped under its module, each linking to its own evidence directory.
- **`money-shots/index.md`** — the digest, images inlined. Scroll it to eyeball the
  entire suite in one pass. This is the answer to "do these tests even work?"
- **`failures.md`** — the failure report. Summary table first, then one section per
  failure with the error text and a link to that test's evidence.
- **`run.log`** — flat text, greppable, everything in order.
- **`playwright-report/`** — traces, videos, step timelines. `npm run e2e:report`.

Module grouping is derived from [`coverage-matrix.md`](coverage-matrix.md): the
reporter reads its `## <n>. <Title>` sections and the backtick-quoted spec names
inside them. The matrix stays the single source of truth for what belongs where,
and `npm run e2e:coverage` already enforces that every spec on disk is claimed by
exactly one section. **A spec showing up under "Unclassified" in the report means
the matrix drifted** — fix the matrix, not the reporter.

## Money shots

A passing test that leaves no visual trace is unauditable. Every test therefore
ships one frame that confirms its claim.

```ts
import { moneyShot, qaShot } from "./helpers/evidence";

await qaShot(page, "changes tab open with one modified file"); // optional context
await moneyShot(page, "the commit lands and the file leaves the changes list");
```

- `moneyShot(page, claim)` — **the** confirming frame. `claim` is rendered as the
  caption in the digest, so write it as the assertion in plain English, not as a
  step name. One per test is the norm.
- `qaShot(page, label)` — intermediate frames. Kept with the test's own evidence,
  not promoted into the digest.

**Every passing test gets a money shot whether or not it asks for one.** The auto
fixture in `e2e/fixtures.ts` captures the final frame of any passing test that
never called `moneyShot`, labelled `final frame (auto)`. That guarantees 100%
digest coverage from day one, but the auto frame is captured at teardown — often
after the interesting state is gone. Treat `final frame (auto)` in the digest as a
TODO: it means that test's proof hasn't been curated yet.

Capture never fails a test: if the page is already closed, the screenshot is
skipped silently.

## Adding coverage

Adding a spec is three steps, and the checker enforces the middle one:

1. Write the spec in `packages/app/e2e/`, importing `test`/`expect` from
   `./fixtures` (never from `@playwright/test` — the auto fixture is what seeds
   the daemon host; without it the app sits on the pairing screen).
2. Add a row to the right `##` section of `coverage-matrix.md`. New specs start at
   🟡 (implemented, not yet validated) and are promoted to ✅ once a real run
   passes them.
3. Call `moneyShot()` at the moment the behavior is proven.

Then `npm run e2e:coverage` to confirm the matrix and disk agree.

## Regression tests for fixed bugs

Every bug we fix should leave a test behind, and the test should say which bug it
guards. The convention:

- **Name it after the behavior, suffixed `-regression`** —
  `personality-autosubmit-regression.spec.ts`, not `bug-1234.spec.ts`. The suffix
  makes the regression set greppable; the behavior name keeps it readable when the
  original bug is long forgotten.
- **Head the spec with a docblock stating the bug, the symptom, and the fix**, so
  the next person knows what breaking this test actually means. Symptom first —
  "the composer dropped the selected personality when a new chat auto-submitted"
  is a maintainable test; "regression for #482" is not.
- **Assert the symptom, not the implementation.** The fix will be refactored; the
  symptom is what must never come back.
- **Row goes in the module the bug lived in**, not a separate regressions section —
  a personality bug is personality coverage. The matrix stays organized by feature,
  which is how you read it when asking "what does this module guarantee?"
- **`moneyShot()` the frame showing the symptom is absent.** That frame is the
  durable record that the bug is fixed.

Bugs found _by_ the suite during an iron-out pass are recorded in
[`iron-out.md`](iron-out.md) with their diagnosis; once fixed, they graduate into a
regression spec by the rules above.
