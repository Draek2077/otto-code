---
id: "brain-all-model-operations-share-scheduler"
kind: "requirement"
title: "Brain queues every model-targeted operation through one scheduler"
status: "confirmed"
tags: ["brain", "scheduler", "model-swap", "operations", "ui"]
created_at: "2026-08-15T04:09:26.640Z"
updated_at: "2026-08-16T13:16:07.474Z"
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
- time: "2026-08-16T13:16:07.474Z"
  kind: "evidence"
  summary: "2026-08-26: scheduler gained two capabilities, both reading runtime facts instead of guessing hardware. (1) Live slot admission: Scheduler takes an optional freeSlots sampler (wired in serve.ts from sysmon /slots idle count); the turn's worker pool is sized to the measured free-slot count, the pump waits (no deadline) when zero slots are free, and a null sample falls back to the static profile.parallelSlots ceiling. The static number stays the llama-server launch config that sizes the KV pool; the measured count is the admission gate. (2) Session affinity: jobs carry a session id; while a session's jobs are in flight, the next dispatch prefers another job from that session (its KV state is what llama-server's LCP selection just filled, avoiding eviction + re-prefill). Session identity is the STANDARD prompt_cache_key field in the OpenAI-compatible body - Otto's provider already sends its chat's stable session UUID there (openai-compat-agent.ts streamCompletion), so no new wire field and no change to the OpenAI-compatible contract; third-party clients that omit it get plain FIFO/model-fairness. Explicit user constraint: slot counts come from user settings per model profile, never derived from VRAM; Brain must work from 8GB (1 slot, serialized) to 512GB (many slots, parallel) with identical code. Also: profile-edit.ts parallelSlots warning now states the per-slot context consequence (~N context each, all resident)."
