---
id: "ci-parity-and-failure-triage"
kind: "requirement"
title: "CI parity and failure triage"
status: "proposed"
tags: ["ci", "testing", "reliability", "proposed"]
created_at: "2026-08-12T00:37:47.621Z"
updated_at: "2026-08-12T00:37:47.621Z"
---

# CI parity and failure triage

<!-- compiled_truth -->

Proposed recovery initiative: establish a reproducible local CI-parity entry point and a failure ledger that distinguishes deterministic product regressions, test-harness defects, and runner or infrastructure failures. A CI failure should be investigated from first-cause evidence, not by treating every failed shard or timeout as an independent test defect. Evidence from runs 31544681985 and 31546488149 indicates a small deterministic cache regression and a cross-shard Playwright timeout cascade, respectively. The exact implementation and acceptance thresholds require user approval.

## Timeline

- time: "2026-08-12T00:37:47.621Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-12T00:37:47.621Z"
  kind: "evidence"
  summary: "User report, 2026-08-11: repeated multi-million-token attempts have not made CI green. GitHub Actions run 31544681985: app-tests failed only checkout-status-cache.test.ts assertions (2 failures); all eight Playwright shards failed after roughly 38 minutes and the logs reported the configured global suite timeout. Run 31546488149 additionally had server and selected Playwright failures/cancellations."
