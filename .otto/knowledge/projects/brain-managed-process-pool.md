---
id: "brain-managed-process-pool"
kind: "project"
title: "Brain managed process pool"
status: "confirmed"
tags: ["brain", "runtime", "vram", "process-pool"]
delivery_status: "charter"
progress_completed: 0
progress_total: 4
progress_unit: "phases"
created_at: "2026-08-11T07:20:22.495Z"
updated_at: "2026-08-11T07:20:22.495Z"
---

# Brain managed process pool

<!-- compiled_truth -->

## Outcome

Brain may eventually keep multiple bundles resident only through a managed llama.cpp process pool.

## Contract

- Each independently loaded bundle owns one process and an explicit VRAM reservation based on its complete enabled component configuration.
- The allocator sums reservations across processes and never treats main weights, projector weights, or drafter weights as shared across process boundaries.
- Admission, eviction, lifecycle reporting, and UI state must make the process boundary explicit.
- The existing single-resident Supervisor remains the only runtime path until this allocator, port allocation, health supervision, and process-pool UI are delivered and verified.

## Acceptance criteria

- A second bundle is admitted only when its reservation and all resident reservations fit.
- Each process has an isolated port, logs, lifecycle, and profile identity.
- A failed process releases its reservation.
- No UI or API claims concurrent arbitrary model residency before these conditions hold.

## Timeline

- time: "2026-08-11T07:20:22.495Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["brain-model-bundles"]
- time: "2026-08-11T07:20:22.495Z"
  kind: "evidence"
  summary: "Confirmed user direction, 2026-08-11."
