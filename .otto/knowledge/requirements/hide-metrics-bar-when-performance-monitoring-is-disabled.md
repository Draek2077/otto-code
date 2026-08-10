---
id: "hide-metrics-bar-when-performance-monitoring-is-disabled"
kind: "requirement"
title: "Hide the Metrics bar while performance monitoring is disabled"
status: "confirmed"
tags: ["performance-monitoring", "metrics", "settings", "ui"]
created_at: "2026-08-09T18:13:45.480Z"
updated_at: "2026-08-09T18:13:45.480Z"
---

# Hide the Metrics bar while performance monitoring is disabled

<!-- compiled_truth -->

The client performance Metrics bar is hidden whenever performance monitoring is disabled, regardless of the all-pages footer preference. The all-pages footer preference control is disabled while monitoring is off and retains its saved value for when monitoring is re-enabled.

## Timeline

- time: "2026-08-09T18:13:45.480Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-09T18:13:45.480Z"
  kind: "evidence"
  summary: "User requirement in the 2026-08-09 bug report; implemented through the resource-bar placement policy and Diagnostics settings control."
