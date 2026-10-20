---
id: "brain-runtime-selection-restarts-host-for-cleanup"
kind: "requirement"
title: "Brain runtime selection restarts the local host before cleanup"
status: "proposed"
tags: ["brain", "runtime", "windows", "reliability"]
created_at: "2026-08-14T18:23:30.711Z"
updated_at: "2026-08-14T18:23:30.711Z"
---

# Brain runtime selection restarts the local host before cleanup

<!-- compiled_truth -->

When the configured local Brain runtime changes, Otto restarts the managed Brain host so the selected executable is actually running and obsolete managed runtimes are not left locked on Windows. If a managed runtime removal job fails, the Runtime Manager shows the daemon error instead of appearing to remove the runtime.

## Timeline

- time: "2026-08-14T18:23:30.711Z"
  kind: "decision"
  summary: "Knowledge page created."
  affects: ["managed-model-server-runtimes","brain-host-control"]
- time: "2026-08-14T18:23:30.711Z"
  kind: "evidence"
  summary: "2026-08-14: A user reported that removing an unused managed runtime showed “Removing…” but the runtime returned after refresh. The configured runtime was absent from BrainManager's restart signature, allowing the prior llama-server executable to keep its runtime directory locked. The runtime removal job already returns terminal errors; the Runtime Manager did not display them."
