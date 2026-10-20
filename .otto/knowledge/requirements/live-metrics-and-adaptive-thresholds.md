---
id: "live-metrics-and-adaptive-thresholds"
kind: "requirement"
title: "Metrics reflect live state and adaptive resource warnings"
status: "proposed"
tags: ["metrics", "diagnostics", "performance", "resource-thresholds"]
created_at: "2026-08-09T14:26:10.731Z"
updated_at: "2026-08-09T14:29:14.659Z"
---

# Metrics reflect live state and adaptive resource warnings

<!-- compiled_truth -->

The application metrics bar should report current client resource state rather than retained historical counts: active agents, currently open chats, retained/live stream state, and current workspaces. Metric values that enter warning or danger ranges should be visually marked amber or red. Thresholds should be scaled from available system resources where possible, with documented hardcoded defaults when no reliable scale is available.

## Timeline

- time: "2026-08-09T14:26:10.731Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-09T14:26:10.731Z"
  kind: "evidence"
  summary: "User requirement stated on 2026-08-09. Existing implementation reads retained session maps and stream item counts in packages/app/src/components/client-resource-bar.tsx and packages/app/src/diagnostics/resource-report/collect-resource-metrics.ts."
- time: "2026-08-09T14:29:14.659Z"
  kind: "evidence"
  summary: "Implemented the first live-state and severity pass: the Chat state footer now reads distinct retained stream buffers, non-archived non-closed agents, open agent/draft chat tabs, and non-archiving workspaces. Heap warning/danger thresholds scale from jsHeapSizeLimit; instantaneous metrics use conservative defaults; cumulative traffic counters remain unclassified. Warning values render amber and danger values render red."
  source: "Implementation in packages/app/src/diagnostics/resource-report/{collect-resource-metrics.ts,resource-metrics.ts,metric-severity.ts} and packages/app/src/compone"
  affects: ["live-metrics-and-adaptive-thresholds"]
