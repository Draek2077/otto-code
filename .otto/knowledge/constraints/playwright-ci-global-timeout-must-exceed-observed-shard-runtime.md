---
id: "playwright-ci-global-timeout-must-exceed-observed-shard-runtime"
kind: "constraint"
title: "Playwright CI global timeout must exceed observed shard runtime"
status: "proposed"
tags: ["ci", "playwright", "testing"]
created_at: "2026-08-12T12:59:25.322Z"
updated_at: "2026-08-12T12:59:25.322Z"
---

# Playwright CI global timeout must exceed observed shard runtime

<!-- compiled_truth -->

The Playwright CI global timeout must leave enough budget for an eight-shard run with serial workers and CI retries. A 38-minute global timeout terminated every shard in workflow run 31563356097 mid-test, producing cascading false UI failures. The workflow now gives Playwright 55 minutes inside a 65-minute job cap so Playwright still reports a real overrun before GitHub kills the job.

## Timeline

- time: "2026-08-12T12:59:25.322Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-12T12:59:25.322Z"
  kind: "evidence"
  summary: "GitHub Actions run 31563356097 on 2026-08-12: all eight Playwright shards reached the configured 2280-second global timeout and then emitted missing-tab/URL failures from interrupted execution. Workflow updated in this working tree."
