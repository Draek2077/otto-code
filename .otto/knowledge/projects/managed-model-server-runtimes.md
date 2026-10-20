---
id: "managed-model-server-runtimes"
kind: "project"
title: "Managed Model-Server Runtime Platform"
status: "confirmed"
tags: ["brain","model-serving","runtime","llama-cpp","vllm","sglang","architecture"]
delivery_status: "in_build"
progress_completed: 1
progress_total: 6
progress_unit: "Phase 1A vertical slices"
created_at: "2026-08-11T03:27:25.532Z"
updated_at: "2026-08-27T02:07:09.104Z"
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

## Refined implementation strategy — contract-first, pressure-tested

The delivery sequence is **contract-first, pressure-tested**:

- Extract llama.cpp behind the first typed `ModelServerRuntimeDriver` before adding a supported second runtime.
- Define the initial contract from seams already proven in the current implementation, then expand it only when the llama.cpp migration or a narrowly scoped vLLM/SGLang validation spike proves a new boundary is required.
- Do not add vLLM/SGLang through scattered `if (runtime === …)` paths, and do not design a speculative maximal interface that merely re-labels llama.cpp mechanics as generic abstractions.
- Normalize observable Otto outcomes and declared capabilities, not native mechanisms. For example, every driver reports readiness, model capabilities, operational status, and benchmark provenance; its CLI flags, metrics endpoint, artifact layout, KV/cache mechanism, and tuning controls remain driver-owned.

### Durable host vs. runtime-driver ownership

The Brain host remains the stable Otto product surface:

- public OpenAI-compatible endpoint, auth/TLS, remote trust, daemon integration, status and log events;
- model-selection policy and fair request scheduling;
- management RPCs, operation coordination, and UI composition;
- common benchmark task definitions, result/report shape, and agent integration.

Each runtime driver owns:

- runtime installation, verification, versioning, platform/accelerator support, and removal;
- artifact acquisition/import, inventory, bundle compatibility, and model identity;
- native launch/configuration, readiness probes, shutdown, crash diagnosis, and raw logs;
- normalized capability declaration plus driver-specific settings schema and defaults;
- telemetry/introspection adapters, including active/queued work and memory/capacity data where the engine exposes them;
- runtime-specific capacity estimator/calibration, sweep methodology where applicable, and benchmark configuration/provenance.

### Vertical extraction sequence

#### Phase 0A — Runtime inventory and semantic contract tests

- Inventory the current llama.cpp behavior by surface: runtime management, GGUF/bundle lifecycle, profile controls, launch, readiness, router behavior, scheduler, status, calibration, sweep, and benchmarks.
- Express existing user-observable guarantees as driver-agnostic semantic tests before moving implementation. Tests must cover install/verify, model load/switch/unload, failure/recovery, health/status, agentic OpenAI-compatible tool use, security, remote operation, and benchmark result persistence.
- Publish an initial capability matrix: **required**, **optional**, and **driver-specific**.

**Exit:** the current llama.cpp contract is explicit enough to detect behavioral regression without prescribing how another engine implements it.

#### Phase 1A — Extract llama.cpp in vertical slices

Migrate llama.cpp as the first concrete driver in dependency order:

1. runtime discovery, installation, verification, and executable launch;
2. GGUF and bundle discovery/download/compatibility;
3. process lifecycle, readiness, logs, crash detection, and native introspection;
4. profile translation, native settings validation, and capabilities;
5. capacity estimation, measured calibration, reasoning sweep, and benchmark setup;
6. llama-server slot telemetry, pinning/erasure, and any native concurrency adapter.

Keep the host API and UI behavior unchanged during each slice. The llama driver is the only place that may know llama-server command flags, GGUF metadata, `/slots`, `/props`, or llama-specific cache and GPU-layer semantics.

**Exit:** llama.cpp has feature parity behind the driver boundary; shared host code contains no unbounded llama-specific branches.

#### Phase 2A — Generalize shared host and UI from capabilities

- Replace globally shaped `Model`, `Profile`, calibration, and runtime types with portable host records plus driver-owned payloads.
- Keep shared pages and concepts: Library, Models, Benchmark, Logs, host controls, bundles, and model lifecycle.
- Render driver-specific controls only from advertised settings/capabilities. Do not fabricate mappings such as llama.cpp GPU layers or KV quantization for vLLM/SGLang.
- Make reports comparable at the task/outcome level while preserving runtime, version, artifact, native configuration, and measurement provenance.

**Exit:** the UI retains one Brain point of view and a second driver can use it without a parallel management plane.

#### Phase 3A — Narrow validation spikes

Before supported vLLM/SGLang delivery, add narrowly scoped internal spikes at the applicable layer to validate uncertain seams, such as artifact compatibility, readiness/metrics, concurrency signals, and capacity measurement. A spike may revise the driver contract but is not a supported runtime, does not expose unfinished UI, and must not introduce legacy fallback paths.

**Exit:** each proposed vLLM/SGLang driver seam is supported by observed native behavior rather than assumed llama.cpp equivalence.

#### Phase 4 — Managed vLLM driver

Implement vLLM against the established contract and explicit first support matrix. Its native settings, Hugging Face-style artifacts, launch/lifecycle, batching/parallelism/cache behavior, telemetry, and capacity strategy are driver-owned. It is supported only after semantic host-contract and driver integration tests pass.

#### Phase 5 — Managed SGLang driver

Implement SGLang against the same host contract, reusing only confirmed shared primitives. Its lifecycle, artifacts, metrics, optimization settings, capacity strategy, and any scheduling adapter are independently driver-owned and proven by the same semantic acceptance suite.

### Design guardrails

- The shared host owns **policy**; a driver owns **engine mechanics**.
- A capability missing from a runtime is represented explicitly, not emulated through an inaccurate setting or hidden fallback.
- A calibration, sweep, or operational measurement is comparable only at a normalized report level; its native method and inputs remain attached as provenance.
- A driver contract method is added when it represents a real cross-runtime host need, not just because llama.cpp currently has an endpoint or flag.

## End-to-end delivery inventory

### Common user journey and UI
- One Brain product remains reachable through the existing Brain page and Host settings. Runtime choice, supported-platform state, install/import, model compatibility, load/switch/unload, native controls, queue activity, logs, calibration, benchmarks, and recovery must compose in the same Library, Models, Benchmark, Logs, Overview, and Host surfaces.
- The client renders only host-advertised, driver-namespaced settings and capabilities. It must show an actionable unsupported-platform, unavailable-driver, incompatible-artifact, or update-host state. It must never label a binary source as a separate user-facing Brain product.
- Migration preserves current llama.cpp UI and protocol shapes until a new runtime-aware capability is explicitly added and centrally gated.

### Artifacts, storage, and lifecycle
- The portable unit is a [[brain-model-bundles-are-the-unit-of-download-and-runtime-allocation|model bundle]] with a stable identity, required and optional artifacts, declared capabilities, and per-runtime compatibility evidence. A driver owns acquisition/import, inventory, compatibility, and deletion planning for its artifact formats.
- The common host owns selected model state, model locks, loaded-process reservation, lifecycle coordination, and durable normalized results. It does not infer GGUF-to-Hugging-Face conversion or artifact compatibility.
- Install, update, remove, partial-download cleanup, bundle mutation, model deletion, and storage rescan require deterministic recovery and must not delete artifacts owned by another driver.

### Host, daemon, security, and remote operation
- The Brain host owns its stable OpenAI-compatible endpoint, auth/TLS policy, remote trust, lifecycle orchestration, scheduler admission, status and log events, and management API.
- Drivers own native child launch/configuration, readiness probes, shutdown diagnosis, raw logs, introspection/metrics, and native capability/configuration translation.
- The daemon remains a remote-neutral authenticated proxy. It must not shell out locally for work that is owned by a selected remote Brain, and no driver may bypass the existing certificate pinning or remote-write authorization boundary.
- Every model-targeted completion, calibration, sweep, and benchmark operation stays behind the common host scheduler and process-pool ownership; driver adapters report native activity but do not create an alternate serving lane.

### Contract, protocol, and compatibility
- Introduce a typed `ModelServerRuntimeDriver` contract from observed host seams. It must cover driver identity, install/verification and support discovery, artifact compatibility, native launch/readiness/introspection/log adaptation, native setting descriptors/defaults, normalized capability/telemetry, capacity/calibration, and benchmark provenance. Methods are added only for a real cross-runtime host need.
- Existing wire fields remain backward-compatible. A future runtime-aware wire surface is additive, capability-gated in `server_info.features.*`, and uses driver-namespaced payloads. It does not rename existing llama-runtime records in place.
- Shared Brain host code must not branch on a runtime identifier. Driver selection and capability metadata are the routing boundary; UI controls derive from that metadata in one place.

### Quality, diagnostics, and evidence
- Define semantic contract tests for install/verify, artifact compatibility, load/switch/unload, queue admission, readiness/crash/bounded shutdown, auth/TLS and remote proxying, event/status recovery, OpenAI-compatible agent/tool use, settings validation, calibration/sweep/benchmark persistence, and no-regression of llama.cpp behavior.
- Each benchmark report retains runtime driver and version, artifact/bundle identity, native configuration, requested versus effective context, calibration method, metrics source, timestamps, and failure verdict. Common task outcomes may be compared; native measurements are never presented as interchangeable.
- The support matrix names runtime, driver version, OS/architecture, accelerator/backend, artifact family, native dependencies, install source, and proof tier. vLLM and SGLang remain unsupported until that matrix and the semantic suite pass on each claimed target.

## First adversarial completeness review — 2026-08-26

### Verified current state
- `packages/brain/src/runtime/` resolves and installs a **llama.cpp executable source** (managed or LM Studio). It is not a generalized model-server-driver layer.
- `packages/brain/src/service/supervisor.ts` directly builds llama-server arguments and loader environment, probes `/health`, reads `/props`, and formats native child logs. This is the first safe vertical extraction seam.
- The host already owns the stable proxy endpoint, TLS/auth, remote trust, status/log event stream, scheduler/process pool, and remote management proxy. These are host responsibilities to preserve.
- Models and profiles are currently GGUF/llama-specific. Bundle companion artifacts already exist, but driver compatibility and non-GGUF inventory are not yet represented.
- `BrainRuntime` protocol/UI records and daemon operations describe/install llama.cpp binaries. Brain operation management also invokes llama-oriented CLI verbs. These public shapes cannot be reinterpreted as generalized drivers without an additive migration.
- Current tests cover many pure llama.cpp helpers and some source-structure boundaries, but there is no fake-driver semantic host contract suite or driver parity matrix.

### Resolved plan gaps
- Phase 1A begins with a typed driver-owned launch/introspection adapter for llama.cpp. The common `Supervisor` retains process ownership, host state, bounded shutdown, and scheduler-facing behavior.
- This first slice adds no new RPC, configuration migration, UI control, remote protocol change, vLLM/SGLang package, or artifact conversion. It creates the tested seam the later slices require while preserving the current wire/UI contract.
- Later Phase 1A slices explicitly move discovery/install, GGUF/bundle compatibility, native activity/slot adapters, profile schema and settings translation, calibration/sweep/benchmark adapters, and native job routing. Each must add semantic tests before it moves behavior.
- A Phase 3A validation gate is required before vLLM or SGLang support: explicit platform/accelerator matrix, managed distribution and artifact-source policy, health/metrics observations, scheduler/concurrency semantics, capacity method, benchmark provenance, remote-host proof, and failure/recovery evidence.

### Explicit non-goals for the first slice
- No vLLM or SGLang installation, packaging, UI, or support claim.
- No fake lowest-common-denominator settings or automatic artifact conversion.
- No new fallback path for older daemon/client pairs.
- No change to host authentication, TLS, remote certificate pinning, scheduler policy, process-pool ownership, or existing model data.
## Completion definition and release-evidence audit

The feature is complete only when a release owner can answer, for each advertised runtime and platform tuple, **what Otto manages, what the user can do, what can fail, how it recovers, and what evidence proves the answer**. A screen, endpoint, or driver interface alone is not completion.

### 1. Public product contract

The end-user contract distinguishes three things that must never be conflated:

| Product state | Meaning | Documentation rule |
| --- | --- | --- |
| **Managed Otto Brain runtime** | Otto installs or verifies the runtime, validates compatible artifacts, owns host lifecycle/security/scheduling, exposes one Brain surface, and has passed the applicable evidence gates. | May appear in the supported-runtime matrix. |
| **External OpenAI-compatible endpoint** | Otto can connect its OpenAI-compatible agent client to a server the user operates. | Document as externally managed local/remote inference, never as a managed Brain runtime. |
| **Planned or validation-only runtime** | A driver target or an internal spike has not passed the support matrix and semantic suite. | Do not present it as available to an end user. |

The stable user journey for every supported managed driver is: discover support on the selected host → install or verify the runtime → acquire or import a compatible bundle → configure only advertised native controls → load/switch/unload → use it through Otto agents → inspect queue, status, logs and resources → calibrate/benchmark where supported → recover from an actionable failure → reconnect or operate remotely with the same host-owned security posture.

### 2. Capability matrix that must be maintained

Every driver/platform support row must have a verdict for each capability. **Required** means no support claim without it. **Native** means present only where the driver advertises it. **Not applicable** requires an explanation, not a blank cell.

| Capability group | Completion test | Evidence required |
| --- | --- | --- |
| Platform and distribution | Exact OS, architecture, accelerator/backend, native dependency and version are detected and either supported or rejected before a misleading install/load attempt. | Automated detection tests plus a verified install/verify/remove run for each supported matrix row. |
| Runtime lifecycle | Install, verify/version, select, update/remove, bounded shutdown and crash detection leave no ambiguous state or unsafe partial install. | Driver integration tests and an operator recovery proof. |
| Artifacts and bundles | A compatible primary model and every required component can be acquired/imported, identified, validated, loaded and deleted without affecting another bundle/driver. | Compatibility fixtures, failure tests, storage-cleanup proof. |
| Model lifecycle and locks | Load, unload, switch, delete and concurrent requests honor locks, process reservations and selected-host ownership. | Semantic host tests covering race, busy and cancellation cases. |
| Stable serving boundary | The same authenticated OpenAI-compatible Brain endpoint remains valid through model changes and returns clear unavailable/busy/recovery behavior. | Agent/provider integration tests, including model switch and restart. |
| Scheduler and capacity | Completions, calibration, sweep and benchmarks share host admission; busy work is never silently evicted or routed to an unobserved sidecar. | Queue/process-pool semantic tests plus an observed contention run. |
| Settings and capabilities | Host-wide policy stays common; every native setting is driver-namespaced, validated and rendered only when advertised. Unsupported controls are absent with an actionable explanation. | Driver schema tests, UI capability-gate tests, protocol compatibility tests. |
| Diagnostics and recovery | Readiness, raw/native logs, normalized status, resource/capacity signals, crashes, TLS/auth failures and artifact failures give a specific recovery action. | Failure-injection tests and documented remediation journeys. |
| Remote operation and security | Remote reads, authorized writes, restart authority, TLS system trust/self-signed pinning, token protection and status/log events work without a local shell-out fallback. | Local and remote integration proof for each claimed operation. |
| Agent capability parity | OpenAI-compatible tool loop, permissions, persistence, rewind, compaction, context/usage reporting, applicable modalities and tool-result behavior work or expose a precise capability limitation. | T1 mock coverage plus T2 local-AI or controlled live proof by runtime. |
| Calibration and benchmarks | Driver-specific method is explicit; result includes runtime/driver/version, artifact identity, requested/effective configuration, metric origin, timestamps and failure verdict. | Result-schema tests and repeatable benchmark provenance inspection. |
| Backwards compatibility | Existing clients parse new host data; existing hosts remain usable; new behavior has one centralized daemon capability gate and no scattered legacy fallback. | Protocol parse regression tests and capability-gate tests. |
| Documentation and support | An end user can determine whether their runtime is managed, their platform/model is supported, how to operate it, and how to recover. | Reviewed public guide, support matrix, and troubleshooting verification. |

### 3. Phase completion gates

#### Gate A — llama.cpp parity behind the driver boundary

This gate closes only when all existing user-observable llama.cpp behavior is behind declared driver seams: runtime discovery/install, GGUF and bundle compatibility, launch/readiness/introspection/logs, native profiles/settings, capacity/calibration/sweep/benchmark adapters, and slot/concurrency telemetry. The host may retain policy and process ownership; it may not contain unbounded llama.cpp branches, flags, artifact assumptions, native endpoint paths, or diagnostic rules.

Proof requires the semantic matrix above to pass for every currently supported llama.cpp platform row, plus no-regression comparison of current host/API/UI behavior and persisted benchmark/profile/result compatibility.

#### Gate B — runtime-neutral host and UI

This gate closes when the common host uses portable model/artifact, served-model, settings, telemetry, diagnostics and benchmark-report records; the app derives availability from advertised capabilities; protocol additions are additive and centrally gated; and fake drivers exercise the same semantic suite without a second management plane.

Proof requires a fixture driver that can demonstrate unavailable capability, native setting descriptors, failed readiness, status recovery, queue admission and benchmark provenance through shared host/UI paths.

#### Gate C — managed vLLM support

This gate starts only after an explicit first platform and distribution policy is recorded. It closes only when vLLM passes every **Required** row on that exact matrix, including Hugging Face-style artifact handling, native settings, batching/parallelism/cache telemetry, capacity method, benchmark provenance, remote operation, tool-loop proof, crash/recovery and documentation. A generic external vLLM endpoint is not evidence for this gate.

#### Gate D — managed SGLang support

This gate has the same required floor as vLLM, proved independently with SGLang-native artifacts, lifecycle, metrics, optimization semantics, capacity method and recovery. Reuse is limited to already-proven host primitives.

#### Gate E — release-ready multi-runtime feature

The feature is release-complete only when every runtime advertised in the support matrix has passed Gates A/B and its driver gate; public documentation states supported versus externally managed versus planned correctly; appropriate T1/T2/T3 evidence exists; and the release owner can trace every matrix verdict to a test, controlled run, or explicit unsupported limitation.

### 4. Completion-review questions

Before a phase or release is marked complete, review these questions and record any negative verdict as a remaining requirement, an explicit non-goal, or a support-matrix limitation:

1. Can a new user identify whether their server is managed by Otto or merely connected as an external endpoint?
2. Can the selected host prove the exact driver, version, OS/accelerator and artifact bundle it is operating?
3. Can the user perform the full lifecycle without a terminal or undocumented manual state repair?
4. Does each control shown correspond to a real driver capability, and does every missing capability explain itself?
5. Do completion, calibration, sweep and benchmark work share one scheduler and observed lifecycle?
6. Does a remote host keep authorization, TLS trust, token handling, storage and recovery on the owning host?
7. Can an operator reproduce or correctly qualify a benchmark from its saved provenance?
8. Do crash, failed readiness, full capacity, incompatible artifacts, auth failure and unsupported platform have distinct recovery stories?
9. Does the same Otto agent/tool experience work, or is every limitation explicitly detected and disclosed?
10. Does a six-month-old client/daemon still parse the wire contract correctly, without a hidden fallback that changes feature behavior?
11. Would the public guide let an end user distinguish a verified claim from a roadmap statement without reading source code?
12. Is every advertised support-matrix cell backed by proof, rather than an inference from another runtime?

### 5. Living end-user documentation deliverable

Before Gate E, publish a user-facing **Otto Brain managed runtimes** guide. It must be maintained from the evidence matrix and contain:

- current managed runtime/platform matrix, with versions and accelerator requirements;
- a separate externally-managed OpenAI-compatible endpoint path;
- compatible artifact/bundle guidance and clear non-conversion policy;
- setup, daily operation, native controls, queues, calibration and benchmark interpretation;
- remote-host authorization and trust model;
- diagnostics/recovery playbooks and data-retention/deletion behavior;
- a visible “planned, not supported” section only when it cannot be read as a present capability.

[docs/brain.md](../../docs/brain.md) remains the engineering truth for the current llama.cpp host. It is not sufficient as end-user documentation because it exposes implementation topology without a concise support matrix, setup journey, or clear distinction between managed and externally operated servers.
## Executable assertion and acceptance strategy

The test program has two obligations. First, characterize the observable llama.cpp Brain behavior before a seam moves. Second, run the same driver-neutral semantic suite against every runtime/platform cell before that cell is advertised. A source-text boundary test is a useful tripwire, but it is not acceptance evidence.

### Baseline characterization suite

Before each remaining llama.cpp extraction slice, add or strengthen deterministic tests for the current observable behavior:

| Surface | Characterization assertion |
| --- | --- |
| Driver launch | Resolved executable, working directory, loader environment, native arguments, slot persistence path, readiness path, introspection path, native log adaptation, and launch/exit diagnostics match the current llama.cpp behavior. |
| Service lifecycle | No runtime, successful readiness, readiness timeout, spawn failure, post-ready crash, bounded stop, and restart yield distinct host status and operator-visible errors. |
| Model and bundle lifecycle | Compatible/incompatible primary artifacts, required/optional components, partial download cleanup, load/unload/switch/delete, lock conflict and cancellation preserve ownership and recovery. |
| Host boundary and scheduler | The stable OpenAI-compatible endpoint, process-pool reservations, queue admission, busy model protection, model switch, calibration, sweep and benchmark remain one observed lifecycle with no sidecar server. |
| Settings and status | Persisted profiles, calibration staleness, capability disclosure, normalized status/log events and unavailable native controls remain correct through driver transitions. |
| Remote security | Local versus remote ownership, token forwarding, TLS system trust, self-signed certificate pinning, remote write denial and authorized remote restart retain their existing contract. |
| Results and wire compatibility | Benchmark/calibration results retain reproducible setup and provenance; additive status/profile/protocol fields parse across old and new peer fixtures. |

### T1 — deterministic contract tests

Build a fake-driver and controlled model-server fixture. It must simulate successful readiness, delayed readiness, never-ready timeout, crash before/after readiness, absent introspection, missing capability, incompatible artifact, capacity/full queue, and driver-native setting descriptors. Shared host and app tests assert visible status, controls, recovery messages, queueing, persisted results and capability gates, rather than inspecting implementation branches.

Every new driver method receives at least one fake-driver contract test proving why the host needs it. The fake must be able to demonstrate unavailable capabilities, native setting descriptors, failed readiness, status recovery, queue admission and benchmark provenance through the same shared paths as llama.cpp.

### T2 — controlled managed-host proof

For each candidate support row, run targeted local-AI tests against the managed runtime and a suitable actual model. Assert side effects rather than model prose: model installed/imported, model reached ready, an Otto agent completed a deterministic tool/file action, queue/model-switch behavior was visible, and a controlled failure recovered with the stated remediation. A generic external endpoint is not T2 proof for a managed driver.

### T3 — release hardware and remote proof

For each advertised OS/architecture/accelerator/runtime row, capture a controlled operator run covering install or verification, compatible bundle acquisition/import, load, agent use, lifecycle/recovery, calibration or declared non-applicability, benchmark provenance, logs/status, and remote operation where advertised. Test the native platform outside the web harness when needed; do not downgrade a native requirement into an unverified Playwright claim.

### Acceptance ledger

A support-matrix cell is **Supported** only when it links to its T1 contract coverage and the required T2/T3 evidence. A missing test, unavailable hardware, or unresolved native behavior makes the cell **Planned** or **Unsupported**, not implicitly complete. Release review verifies the ledger before changing documentation or delivery status.

### Immediate testing sequence

1. Complete the llama.cpp characterization suite around the existing driver seams before moving discovery/install, bundles, profiles, scheduler telemetry, calibration and benchmark adapters.
2. Add fake-driver semantic host tests before generalizing the host/UI.
3. Add runtime-specific T2/T3 rows only after a first vLLM/SGLang support matrix is selected.
4. Keep assertion scope targeted: changed unit/contract tests locally, broader matrix runs in CI or a deliberate release-validation environment.

## Timeline

- time: "2026-08-11T03:27:25.532Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["managed-model-server-runtime-capability-parity"]
- time: "2026-08-11T03:27:25.532Z"
  kind: "evidence"
  summary: "User explicitly confirmed the direction and requested this full project charter in chat on 2026-08-10. Current implementation evidence: packages/brain/src/runtime, packages/brain/src/service, packages/server/src/server/brain, and docs/custom-providers.md."
- time: "2026-08-21T02:09:41.906Z"
  kind: "decision"
  summary: "User requested the charter be refined with the agreed contract-first, pressure-tested runtime-abstraction plan on 2026-08-20."
  source: "User direction in chat, 2026-08-20; supporting baseline: [[finding-2026-08-20-brain-runtime-portability-baseline]]."
- time: "2026-08-27T01:46:31.560Z"
  kind: "decision"
  summary: "User requested the Phase 0 inventory and adversarial completeness review before implementation; repository inspection verified the initial driver extraction seam and its current boundaries."
- time: "2026-08-27T01:49:32.481Z"
  kind: "note"
  summary: "Verified the first Phase 1A slice: llama.cpp native launch, readiness/properties paths, and log adaptation now enter the host through ModelServerRuntimeDriver; no later driver extraction or second runtime is claimed."
  affects: ["managed-model-server-runtimes"]
- time: "2026-08-27T01:49:41.184Z"
  kind: "evidence"
  summary: "Implemented `packages/brain/src/runtime/model-server-driver.ts` with the first `ModelServerRuntimeDriver` and `llamaCppRuntimeDriver`. `Supervisor` now delegates native launch plan, readiness/properties paths, and log formatting while retaining host lifecycle ownership. Verified with `npx vitest run packages/brain/src/runtime/model-server-driver.test.ts packages/brain/src/runtime/args.test.ts packages/brain/src/service/supervisor.test.ts --bail=1` (5 files, 27 tests passed), targeted `npm run lint -- …` (0 warnings/errors), `npm run typecheck --workspace=@otto-code/brain`, formatter, and `git diff --check`."
  source: "Repository inspection and targeted verification, 2026-08-26"
- time: "2026-08-27T01:50:34.629Z"
  kind: "evidence"
  summary: "Extended the same first driver slice to keep llama.cpp-specific launch-failure and process-exit diagnostics inside the driver. Re-ran the targeted driver/args/supervisor Vitest command: 5 files and 27 tests passed; targeted lint had 0 warnings/errors; brain package typecheck, formatting, and diff check passed."
  source: "Follow-up targeted verification, 2026-08-26"
- time: "2026-08-27T02:02:20.331Z"
  kind: "decision"
  summary: "User requested a complete, evidence-based definition of done so the feature plan can be audited for completeness before release claims."
- time: "2026-08-27T02:07:09.104Z"
  kind: "decision"
  summary: "User requested the test assertions and final feature-acceptance strategy be recorded as an auditable part of the managed-runtime delivery plan."
