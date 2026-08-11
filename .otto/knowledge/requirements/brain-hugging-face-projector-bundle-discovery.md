---
id: "brain-hugging-face-projector-bundle-discovery"
kind: "requirement"
title: "Hugging Face search detects projector bundles"
status: "confirmed"
tags: []
created_at: "2026-08-11T17:28:37.130Z"
updated_at: "2026-08-11T18:44:59.516Z"
---

# Hugging Face search detects projector bundles

<!-- compiled_truth -->

For Hugging Face search results, Otto detects projector-style GGUF companion files and presents them as optional bundle components alongside a selected primary quant. Once downloaded, the primary quant and selected projector are internalized as an Otto-managed installed bundle with the same component download, progress, deletion, and availability UI as curated catalog bundles. Curated manifests remain authoritative for speculative drafters, labels, defaults, and runtime compatibility.

## Timeline

- time: "2026-08-11T17:28:37.130Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["brain-model-bundles"]
- time: "2026-08-11T17:28:37.130Z"
  kind: "evidence"
  summary: "User-directed product decision on 2026-08-11."
- time: "2026-08-11T18:27:42.117Z"
  kind: "evidence"
  summary: "Hugging Face quant discovery now carries the detected shared vision projector (file and byte size) through the compatible `BrainRepoQuant` response. The quant picker presents this before download as a detected bundle. Catalog bundle rows now list their declared components and expose Bundle options before installation."
  source: "Implementation, 2026-08-11"
  affects: ["brain-model-bundles"]
- time: "2026-08-11T18:44:59.516Z"
  kind: "evidence"
  summary: "Verification, 2026-08-11: `otto-brain add unsloth/Qwen3.6-27B-MTP-GGUF --list-quants --json` returns `projector: { file: \"mmproj-F32.gguf\", sizeBytes: 1842940480 }` for every quant. The current app requests this data only after the user opens Quants and renders it as a small hint, so initial Hugging Face search rows do not visibly identify detected bundles."
  source: "Direct CLI verification and app code inspection, 2026-08-11."
