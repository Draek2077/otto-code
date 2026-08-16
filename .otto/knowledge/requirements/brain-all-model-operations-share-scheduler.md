---
id: "brain-all-model-operations-share-scheduler"
kind: "requirement"
title: "Brain queues every model-targeted operation through one scheduler"
status: "confirmed"
tags: ["brain", "scheduler", "model-swap", "operations", "ui"]
created_at: "2026-08-15T04:09:26.640Z"
updated_at: "2026-08-16T21:22:34.624Z"
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
- time: "2026-08-16T21:22:34.624Z"
  kind: "evidence"
  summary: "2026-08-16: the scheduler was rebuilt as a single dispatcher after two chats on a 2-slot profile were measured trading one slot instead of holding one each (Overview reported 1/2 in use throughout; the Brain log showed every `dispatching` immediately preceded by a `completed`, with llama-server slot ids alternating 0/1). Two independent defects.\n\n(1) A turn was a closed batch. `#takeTurn` snapshotted the queue at turn start and the worker pool was sized `min(freeSlots, snapshot.length)`, and the pump was single-flight, so it could not re-evaluate until the whole snapshot drained. Agentic traffic arrives one request per chat per turn, never as a burst, so the snapshot was always length 1 and the pool always 1 worker: chat B's request waited for chat A's turn to finish, then took its own 1-worker turn. Strict alternation on one slot. The unit test that appeared to prove concurrency (\"two sessions run concurrently across two slots\") only passed because it submitted all four jobs in one tick.\n\n(2) A live-sample double count. `free - inFlight`, where `free` is llama-server's `/slots` idle count, subtracts our running jobs twice: the engine's idle count already excludes them. With 2 slots and one chat live the engine reports 1 idle, `1 - 1 = 0`, so no second chat is ever admitted. This bites only with the sampler wired (serve.ts), which is production; the fake samplers in the tests returned a constant and hid it.\n\nThe replacement has one entry point, `#dispatch`, called by every event (submit, job settle, load complete, slot poll), guarded by a `#busy`/`#dirty` pair so passes cannot interleave. No worker pool, no parked promises, no wake generation, no claim lock. A pass applies, in order: exclusivity (an operation owns a drained engine alone), residency (a turn may only begin on a drained engine, so `#running` never mixes models), turn absorption (a drained batch pulls the queue head when it is a non-exclusive job of the same model, which is what keeps two chats on two slots), fairness (absorption stops at another model's job or an exclusive op, so the FIFO head bounds any wait to the currently running jobs), and capacity as `min(parallelSlots - running, measuredFreeSlots)` - combined, never both subtracted. `stats().queued` now also counts jobs claimed into a batch but not yet started, which it previously under-reported for the whole duration of a turn.\n\nThree regression tests cover the shipped symptoms and fail against the previous implementation: a second chat taking the free slot while the first still streams, a live sampler not double-counting in-flight jobs, and a third chat queueing on a 2-slot pool then starting the moment a slot frees. Full scheduler, router, serve and host-api suites pass (98 tests); brain typecheck, lint and format clean."
  source: "Implementation and regression coverage, packages/brain/src/service/scheduler.ts, 2026-08-16"
