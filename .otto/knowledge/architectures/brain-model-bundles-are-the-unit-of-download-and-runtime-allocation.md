---
id: "brain-model-bundles-are-the-unit-of-download-and-runtime-allocation"
kind: "architecture"
title: "Brain model bundles are the unit of download and runtime allocation"
status: "confirmed"
tags: ["brain", "models", "vision", "vram", "runtime"]
created_at: "2026-08-11T06:50:25.513Z"
updated_at: "2026-08-11T06:50:25.513Z"
---

# Brain model bundles are the unit of download and runtime allocation

<!-- compiled_truth -->

A local AI model is represented as a bundle, not as a standalone text GGUF. A bundle has a stable ID, a primary language-model artifact, required companion artifacts such as a vision projector, optional artifacts such as a speculative drafter, declared capabilities, and measured memory profiles for each enabled component set. Catalog download, inventory readiness, profile selection, launch arguments, and VRAM allocation operate on the bundle.

A bundle is runnable only when its required artifacts are present and compatible with the selected runtime. Optional components are explicit configuration choices. Multiple bundles load as separate managed runtime processes with independent GPU reservations; weights are not assumed to be shared across processes. The allocator admits or queues a bundle based on measured resident weights, context-cache slope, component overhead, per-request image buffers, runtime overhead, and concurrency slots.

## Timeline

- time: "2026-08-11T06:50:25.513Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-11T06:50:25.513Z"
  kind: "evidence"
  summary: "User direction, 2026-08-11: Vision models and multi-file model releases must be treated as bundles. The current Brain profile already derives `modelPath` and `mmprojPath`, but the catalog and runtime lifecycle are still text-model-centric."
