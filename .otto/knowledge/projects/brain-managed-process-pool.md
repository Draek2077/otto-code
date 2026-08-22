---
id: "brain-managed-process-pool"
kind: "project"
title: "Brain managed process pool"
status: "confirmed"
tags: ["brain","runtime","vram","process-pool"]
delivery_status: "complete"
progress_completed: 4
progress_total: 4
progress_unit: "phases"
created_at: "2026-08-11T07:20:22.495Z"
updated_at: "2026-08-22T02:25:54.150Z"
---
# Brain managed process pool

<!-- compiled_truth -->

## Outcome

Brain can keep multiple model bundles resident through a host-configured managed llama.cpp process pool.

## Contract

- Each resident model owns an independent Supervisor, llama-server process, internal port, profile, KV-slot scheduler, lifecycle, and complete VRAM reservation.
- The allocator sums resident reservations before admitting another model and never treats bundle components as shared across process boundaries.
- `maxLoadedModels` is host-owned daemon configuration, defaults to 1, and is editable from local Host settings or through the remote Brain configuration route.
- Requests for resident models route directly to their process. A request for an unloaded model claims a free process slot or evicts the least-recently-used idle resident. Busy residents are never evicted, and resident-model requests continue to use available slots while an eviction waits.
- With model locking enabled, the configured `lockedModels` set stays resident and requests outside that set are refused. The set is bounded by `maxLoadedModels`.
- The default model still auto-loads at most one model when there is no explicit locked set; additional process slots remain empty until requested.

## Acceptance criteria

- A second bundle is admitted only when its reservation and all resident reservations fit.
- Each process has an isolated port, supervisor lifecycle, profile, and request-slot scheduler.
- Failed or evicted processes release their reservation.
- Local and remote Settings expose the process limit and locked model set, and host status reports all residents.

## Timeline

- time: "2026-08-11T07:20:22.495Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["brain-model-bundles"]
- time: "2026-08-11T07:20:22.495Z"
  kind: "evidence"
  summary: "Confirmed user direction, 2026-08-11."
- time: "2026-08-22T02:25:14.648Z"
  kind: "decision"
  summary: "The user explicitly directed Brain to support a configurable multi-model resident pool with idle eviction, a lockable resident set, remote daemon-owned settings, and single default-model auto-load. The implementation and focused regression suite now verify those behaviors."
  source: "User direction and verified implementation, 2026-08-21"
  affects: ["brain-model-bundles","brain-all-model-operations-share-scheduler","remote-brain-functionality-is-host-owned-and-connection-neutral"]
- time: "2026-08-22T02:25:54.150Z"
  kind: "note"
  summary: "Delivered the host-owned process pool, VRAM reservation and idle-only eviction rules, multi-resident status and routing, local and remote process-limit settings, locked resident selection, and single default-model auto-load. Verification passed across 178 focused tests, Brain/server/app typechecks, targeted lint, and the full server build."
  affects: ["brain-managed-process-pool"]
