---
id: "finding-brain-benchmark-persistence-package-relative"
kind: "finding"
title: "Brain benchmark persistence was package-relative"
status: "proposed"
tags: ["brain","benchmark","persistence","packaging","reliability"]
created_at: "2026-08-21T18:54:36.129Z"
updated_at: "2026-08-22T02:00:43.945Z"
---
# Brain benchmark persistence was package-relative

<!-- compiled_truth -->

Brain benchmark inference can finish successfully while the host job fails during result persistence when score and transcript paths are derived from the installed package directory. Benchmark scores and raw exchanges must use the canonical host-owned `$OTTO_HOME/otto-brain/results` store.

## Timeline

- time: "2026-08-21T18:54:36.129Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-21T18:54:36.129Z"
  kind: "evidence"
  summary: "User-provided Brain log, 2026-08-21: `operation benchmark: Concurrency: done` was immediately followed by `job ... failed: ENOTDIR, not a directory`, with no benchmark record. Code inspection showed `runResidentJob` calls `results.save` only after `bench.runSuite` completes, while `packages/brain/src/ops/results.ts` and `archive.ts` previously derived storage from the module/package root. `packages/brain/src/config/paths.ts` already defines `resolveBrainPaths().resultsDir` under `$OTTO_HOME/otto-brain`. Fix routes both stores through that path; focused results/archive path tests pass, Brain typecheck and targeted lint pass."
- time: "2026-08-22T02:00:43.945Z"
  kind: "evidence"
  summary: "A subsequent run against the remote Greyskull Brain reproduced the same terminal sequence: every benchmark task completed, the host job ended with `ENOTDIR, not a directory`, and `/__host/evals` still reported `runCount: 0`. The remote host identified itself as version 0.8.12. Git ancestry shows the persistence fix commit `389bb705c` is not contained by tag `v0.8.12`, so this run exercised the pre-fix packaged path rather than disproving the host-home fix. The remote Brain must be updated to a build containing that commit before the benchmark is rerun."
  source: "User-uploaded Brain benchmark session, 2026-08-21; Git tag ancestry."
