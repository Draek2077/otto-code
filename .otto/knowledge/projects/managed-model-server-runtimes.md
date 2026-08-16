---
id: "managed-model-server-runtimes"
kind: "project"
title: "Managed Model-Server Runtime Platform"
status: "confirmed"
tags: ["brain", "model-serving", "runtime", "llama-cpp", "vllm", "sglang", "architecture"]
delivery_status: "charter"
progress_completed: 0
progress_total: 5
progress_unit: "delivery phases"
created_at: "2026-08-11T03:27:25.532Z"
updated_at: "2026-08-11T03:27:25.532Z"
---

# Managed Model-Server Runtime Platform

<!-- compiled_truth -->

## Outcome

Replace the llama.cpp-specific internals of Otto Brain with a **managed model-server runtime platform**. Otto will ship and operate multiple first-class runtimes, beginning with llama.cpp, then vLLM and SGLang. Each runtime is installed, configured, launched, monitored, benchmarked, and managed by Otto rather than being merely an arbitrary external OpenAI-compatible endpoint.

A runtime is **supported** only when it meets the managed-host capability floor. Runtime-specific model formats, optimization controls, telemetry, and benchmark implementations are first-class additions rather than forced into a false lowest-common-denominator UI.

## Product contract

Otto Brain remains the durable host boundary:

```text
Otto Brain host
  common host: auth/TLS, stable public endpoint, request scheduling, status events,
               remote control, logs, model selection, OpenAI compatibility, UI RPCs
  runtime drivers:
    llama.cpp | vLLM | SGLang
```

The common host owns security, lifecycle orchestration, status/event delivery, the stable OpenAI-compatible endpoint, daemon integration, and the management UI. A runtime driver translates its native process model, artifact format, launch semantics, health/metrics APIs, and tuning options into that contract.

## Scope

### Required managed-runtime capability floor

Every supported runtime must provide or implement:

1. Runtime lifecycle: install/verify/version/remove; supported-platform and accelerator detection; actionable failures.
2. Model lifecycle: inventory, acquisition/import, compatibility validation, load, unload, switch, delete, and model-lock behavior.
3. Serving lifecycle: start, stop, restart, readiness, crash detection, bounded shutdown, logs, and stable host endpoint across model changes.
4. Security and remote operation: Otto-owned auth/TLS policy, remote-host trust, status events, and management RPCs.
5. Model capabilities: normalized context window, modalities, reasoning controls where supported, tool-calling compatibility, and model identity.
6. Operations: normalized health, active/queued work where available, memory/capacity information, operator-visible diagnostics, and host status.
7. Capacity and quality operations: a runtime-specific capacity estimator/calibration and benchmark executor whose results feed a common Otto report shape.
8. Agent integration: the existing OpenAI-compatible provider, daemon-owned tool loop, permissions, MCP, persistence, rewind, usage/context reporting, and compaction keep working through every driver.

### Explicitly not required

- Identical model files across runtimes. llama.cpp uses GGUF; vLLM/SGLang generally use Hugging Face artifacts and their own quantization/layout requirements.
- Identical settings across runtimes. No fake mapping from llama.cpp-specific controls such as GPU layers or KV cache types to vLLM/SGLang settings.
- Immediate universal platform parity. The first managed vLLM/SGLang delivery may target a narrow, explicit support matrix such as Linux + NVIDIA. Platform expansion follows verified packaging and driver support.
- User-managed arbitrary endpoints as a substitute for this project. Existing OpenAI-compatible providers remain useful but do not satisfy managed-runtime support.

## Architecture decisions

- Introduce a typed `ModelServerRuntimeDriver` contract. It has lifecycle, model artifact, serve, introspection, telemetry, capacity, benchmark, and feature-schema responsibilities.
- Split the current `Model` and `Profile` domain types into portable concepts:
  - a model artifact/locator and compatibility record;
  - a normalized served-model descriptor;
  - a driver-owned configuration schema and defaults;
  - normalized operational and benchmark result shapes.
- Retain the current llama.cpp behavior by moving it behind the first driver before adding a second runtime. This is a behavior-preserving extraction, not a simultaneous rewrite.
- Keep the Brain host’s public API runtime-neutral. New driver-specific data is capability-gated and namespaced; clients render only advertised controls.
- Define semantic parity tests against the host contract, plus per-driver integration tests. A driver may implement an operation differently, but its observable Otto behavior must satisfy the same acceptance tests.
- Do not add scattered `if (runtime === ...)` branches throughout the host and app. Driver capability metadata is the single source for routing and UI availability.

## Delivery plan

### Phase 0 — Charter and capability contract

- Inventory all existing `@otto-code/brain` capabilities, RPCs, UI surfaces, status fields, lifecycle operations, profile settings, benchmarks, and tests.
- Publish the runtime-driver TypeScript contract and a capability matrix that distinguishes **required**, **optional**, and **runtime-specific** features.
- Define semantic acceptance tests and an operator-facing support matrix.
- Decide the first vLLM packaging target, distribution method, supported accelerator/OS matrix, and artifact source policy.

**Exit:** reviewed contract says exactly what “at least everything we do now” means and establishes no-regression tests for llama.cpp.

### Phase 1 — Extract llama.cpp as driver one

- Move runtime discovery/download, GGUF artifact handling, llama launch arguments, supervisor probes, activity parsing, capacity calibration, sweep, and benchmark paths behind the driver boundary.
- Preserve existing config migrations, host APIs, daemon integration, UI behavior, and results.
- Replace llama-specific host types with portable host types plus driver-owned payloads.
- Run parity tests against the existing llama.cpp user flows.

**Exit:** llama.cpp remains feature-equivalent, while the common host contains no unbounded llama-specific control flow.

### Phase 2 — Generalize host and UI

- Generalize the model library, host console, status/event protocol, profile editor, logs, and benchmark reports around capability metadata.
- Keep llama.cpp controls visible only for llama.cpp; establish reusable UI primitives for driver settings and telemetry.
- Preserve wire compatibility: new fields optional, capability flags centralized, and old clients keep parsing host messages.
- Add fixture/fake drivers for deterministic host contract tests.

**Exit:** a second driver can be added without changing shared host behavior or creating a parallel management plane.

### Phase 3 — Managed vLLM driver

- Implement managed installation/verification for the agreed first platform matrix.
- Support Hugging Face-style artifacts, vLLM launch/configuration, load/readiness, logs, metrics, model catalog, and safe lifecycle ownership.
- Map vLLM-native context, batching, memory, parallelism, prefix-cache, and compatible reasoning/tool features into driver capabilities.
- Implement a vLLM capacity/benchmark strategy that feeds common Otto reports without claiming equivalence to llama.cpp measurements.
- Validate agentic coding, tool loops, compaction, remote operation, model switches, crashes, and recovery.

**Exit:** vLLM meets the complete managed-runtime capability floor on its declared platform matrix.

### Phase 4 — Managed SGLang driver

- Repeat the vLLM delivery against the same contract, using SGLang-native lifecycle, artifact, telemetry, and optimization semantics.
- Reuse only proven host primitives; do not copy vLLM implementation assumptions into SGLang.
- Add SGLang-specific settings and benchmark/calibration strategy as declared driver capabilities.

**Exit:** SGLang meets the same managed-runtime floor and supports its declared platform matrix.

### Phase 5 — Hardening and expansion

- Compare runtime results using common benchmark/task definitions while retaining runtime-specific evidence and configuration.
- Expand OS/accelerator support only through explicit tested matrices.
- Add further runtimes only after the driver contract has proven stable across llama.cpp, vLLM, and SGLang.
- Fold the durable runtime contract and support matrix into `docs/`; record measured performance investigations as Otto Knowledge finding pages.

## Acceptance criteria

1. A user can install/select a supported runtime, obtain compatible models, configure native controls, and operate a model server wholly through Otto.
2. The same Otto Brain endpoint, security posture, agent tools, daemon integration, remote management, logs, and lifecycle controls work for all supported drivers.
3. llama.cpp retains its current managed capabilities after extraction.
4. vLLM and SGLang each satisfy every required capability on their explicitly published platform matrices.
5. The UI never presents an unsupported control or fabricates a cross-runtime setting mapping.
6. A common benchmark report can compare task outcomes and normalized operational measurements, while preserving native configuration and measurement provenance.
7. Contract and integration tests prove lifecycle, failure handling, model switching, security, status events, agentic tool use, and backwards-compatible protocol behavior for every driver.
8. Documentation distinguishes host-wide behavior, required driver capabilities, and runtime-specific features.

## Risks and gates

- **Packaging/platform risk:** vLLM and SGLang have materially different dependency and accelerator ecosystems from self-contained llama.cpp. Gate Phase 3 on an explicit initial support matrix and managed distribution design.
- **Artifact-model risk:** model compatibility must be declared and validated per driver; no automatic GGUF ↔ Hugging Face conversion is implied.
- **Metric-comparability risk:** capacity and benchmark values must carry runtime/configuration provenance. Normalize report shapes, not the underlying measurements.
- **Regression risk:** Phase 1 must pass llama.cpp parity before a new driver is allowed to depend on the abstraction.
- **Scope risk:** browser, provider, and daemon features stay untouched unless the runtime contract requires a narrowly scoped protocol change.

## Initial sequencing

Start with Phase 0 and Phase 1. Do not begin vLLM implementation until the contract, capability matrix, and llama.cpp extraction plan have passed architecture review.

## Timeline

- time: "2026-08-11T03:27:25.532Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["managed-model-server-runtime-capability-parity"]
- time: "2026-08-11T03:27:25.532Z"
  kind: "evidence"
  summary: "User explicitly confirmed the direction and requested this full project charter in chat on 2026-08-10. Current implementation evidence: packages/brain/src/runtime, packages/brain/src/service, packages/server/src/server/brain, and docs/custom-providers.md."
