---
id: "managed-model-server-runtime-capability-parity"
kind: "requirement"
title: "Managed model-server runtimes must meet Otto Brain capability parity"
status: "confirmed"
tags: ["brain", "model-serving", "runtime", "vllm", "sglang", "architecture"]
created_at: "2026-08-11T03:22:34.348Z"
updated_at: "2026-08-11T03:27:26.698Z"
---

# Managed model-server runtimes must meet Otto Brain capability parity

<!-- compiled_truth -->

The product direction under evaluation is a generalized managed model-server runtime layer that can support llama.cpp, vLLM, and SGLang as first-class runtimes. A runtime must meet the existing Otto Brain operational capability floor before it is supported; runtime-specific features may be additive after parity. User-managed OpenAI-compatible endpoints are not a substitute for this requirement.

## Timeline

- time: "2026-08-11T03:22:34.348Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-11T03:22:34.348Z"
  kind: "evidence"
  summary: "User statement in chat on 2026-08-10. Current implementation evidence: packages/brain/src/runtime, service/supervisor.ts, service/router.ts, and docs/custom-providers.md."
- time: "2026-08-11T03:27:26.698Z"
  kind: "note"
  summary: "User explicitly confirmed this direction in chat on 2026-08-10 and requested a full charter. New status: confirmed."
