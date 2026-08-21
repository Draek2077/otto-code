---
id: "brain-runtime-abstraction-is-contract-first-and-pressure-tested"
kind: "architecture"
title: "Brain runtime abstraction is contract-first and pressure-tested"
status: "proposed"
tags: ["brain","runtime","architecture","llama-cpp","vllm","sglang"]
created_at: "2026-08-21T02:08:24.108Z"
updated_at: "2026-08-21T02:08:24.108Z"
---
# Brain runtime abstraction is contract-first and pressure-tested

<!-- compiled_truth -->

Proposed implementation direction: extract llama.cpp behind a small typed runtime-driver contract before adding vLLM or SGLang, while deliberately growing the contract only at seams demonstrated by the llama.cpp migration and the next runtime. The shared Otto Brain host remains runtime-neutral and owns public endpoint, security, status, remote control, host API, scheduling policy, management UI composition, and common benchmark reports. Each driver owns native installation, artifact discovery/acquisition, compatibility, process launch, readiness/introspection, telemetry adapters, settings schema, capacity/calibration, and benchmark configuration/provenance.\n\nAvoid both extremes: do not add vLLM/SGLang directly through scattered runtime conditionals, and do not design a speculative maximal interface before a second runtime proves every method. Use llama.cpp as the first executable driver and migrate it in vertical slices with contract tests. Add a thin vLLM/SGLang discovery spike only when needed to validate a proposed seam, without treating the spike as supported runtime delivery.

## Timeline

- time: "2026-08-21T02:08:24.108Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["managed-model-server-runtimes","managed-model-server-runtime-capability-parity"]
- time: "2026-08-21T02:08:24.108Z"
  kind: "evidence"
  summary: "User proposed this direction and requested a recommendation in chat on 2026-08-20. Existing charter [[managed-model-server-runtimes]] already requires a ModelServerRuntimeDriver contract and llama.cpp extraction before new runtimes. Current portability baseline: [[finding-2026-08-20-brain-runtime-portability-baseline]]."
