---
id: "finding-2026-08-20-brain-runtime-portability-baseline"
kind: "finding"
title: "Otto Brain runtime portability baseline"
status: "proposed"
tags: ["brain","runtime","vllm","sglang","llama-cpp","architecture","finding"]
created_at: "2026-08-21T01:52:02.074Z"
updated_at: "2026-08-21T01:52:02.074Z"
---
# Otto Brain runtime portability baseline

<!-- compiled_truth -->

A code-level review of the current Otto Brain implementation finds that its **outer host architecture translates well** to managed vLLM and SGLang, while its runtime, artifact, capacity, and concurrency implementations are still strongly llama.cpp-specific. The portable layer includes the daemon-owned host boundary, stable public OpenAI-compatible endpoint, TLS/auth and remote trust, model-switch lifecycle, status/log event publishing, host API and management UI, daemon operation tracking, benchmark task definitions, and agent integration. The primary extraction work is in `packages/brain`: `Runtime` names a llama executable and `buildArgs()` emits llama-server CLI flags; model discovery/catalog/download are GGUF-oriented; `Profile`, calibration, VRAM budgeting, sysmon, router slot pinning/erasure, and scheduler capacity use llama.cpp metadata and `/slots` behavior. A `ModelServerRuntimeDriver` contract must own these concerns before a vLLM or SGLang driver can be safely introduced. This is a charter baseline, not an implementation-completeness measure.

## Timeline

- time: "2026-08-21T01:52:02.074Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["managed-model-server-runtimes","managed-model-server-runtime-capability-parity","brain-model-bundles-are-the-unit-of-download-and-runtime-allocation"]
- time: "2026-08-21T01:52:02.074Z"
  kind: "evidence"
  summary: "Code reviewed 2026-08-20: packages/brain/AGENTS.md; packages/brain/src/runtime/{index,args,managed,lmstudio}.ts; types.ts; config/schema.ts; models/{scan,hf,download,enrich}.ts; vram.ts; sysmon.ts; service/{supervisor,router,scheduler,serve,host-api,status-events}.ts; ops/{calibrate,sweep,results}.ts; packages/server/src/server/brain/{brain-manager,brain-ops-manager}.ts. Relevant charter: [[managed-model-server-runtimes]]."
