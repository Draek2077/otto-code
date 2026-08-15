---
id: "brain-all-model-operations-share-scheduler"
kind: "requirement"
title: "Brain queues every model-targeted operation through one scheduler"
status: "confirmed"
tags: ["brain", "scheduler", "model-swap", "operations", "ui"]
created_at: "2026-08-15T04:09:26.640Z"
updated_at: "2026-08-15T04:09:26.640Z"
---

# Brain queues every model-targeted operation through one scheduler

<!-- compiled_truth -->

API completions, calibration, sweep, and benchmark are model-targeted requests that share Brain's single resident-model scheduler. Each operation waits for the active turn, swaps the resident model when its target differs, runs exclusively, then yields to the next queued turn. Calibration and sweep never restore the model that was resident before them, because the scheduler alone selects what runs next. The Models UI exposes queued, loading, unloading, ready, and active-operation states from this shared scheduler.

## Timeline

- time: "2026-08-15T04:09:26.640Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["brain-operations-use-resident-hosted-server","brain-managed-process-pool"]
- time: "2026-08-15T04:09:26.640Z"
  kind: "evidence"
  summary: "Explicit user direction, 2026-08-14. Implemented in packages/brain/src/service/scheduler.ts, serve.ts, host-api.ts, and packages/app/src/screens/brain/models-tab.tsx."
