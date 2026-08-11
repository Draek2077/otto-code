---
id: "runtime-update-to-latest-must-resolve-current-release"
kind: "requirement"
title: "Runtime update to latest resolves the current compatible upstream release"
status: "confirmed"
tags: ["brain", "runtime", "llama-cpp", "updates"]
created_at: "2026-08-11T05:27:22.598Z"
updated_at: "2026-08-11T05:28:37.580Z"
---

# Runtime update to latest resolves the current compatible upstream release

<!-- compiled_truth -->

The Runtime Manager has no “recommended build” concept. Its update action resolves the newest compatible upstream llama.cpp release at click time, installs that exact release, and selects it through the automatic runtime policy. It must never silently reinstall Otto’s packaged fallback build. Explicitly named build installs remain deliberate pins.

## Timeline

- time: "2026-08-11T05:27:22.598Z"
  kind: "decision"
  summary: "Knowledge page created."
- time: "2026-08-11T05:27:22.598Z"
  kind: "evidence"
  summary: "User direction on 2026-08-10: clicking “Update to latest” must mean latest in every sense; the prior path omitted --build and therefore reinstalled DEFAULT_LLAMA_BUILD b10265 instead of invoking the CLI’s latest-release resolver."
- time: "2026-08-11T05:28:37.580Z"
  kind: "decision"
  summary: "User clarified that no Otto-curated recommendation policy exists or should be implied for managed runtime updates."
  source: "User direction on 2026-08-10: “There is no recommendation, there is the latest build, period.”"
